import assert from 'node:assert/strict';
import fs from 'node:fs';
const history=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../case-history.js',import.meta.url),'utf8')).toString('base64'));
let records=[],writes=[],choice={action:'merge',targetId:'case-history|old'},fail=false,indexFail=false,prompts=0,externalLibraries=[],foreignSaved;
const pixels=seed=>Array.from({length:1024},(_,i)=>i%4===3?255:(Math.floor(i/4)*37+seed)%256);
const fp=seed=>history.describePixels(pixels(seed),1200,800);
globalThis.__caseDeps={...history,
  loadDirectoryCaseHistory:async()=>undefined,saveDirectoryCaseHistory:async(directory,value)=>{foreignSaved={directory,records:structuredClone(value)};},
  loadCaseLibraries:async()=>[{key:'case-history',name:'默认下载',directory:null,records:structuredClone(records)},...externalLibraries],
  loadCaseHistory:async()=>structuredClone(records),saveCaseHistory:async value=>{if(indexFail)throw Error('index full');records=structuredClone(value);},
  uniqueFile:async(directory,name)=>directory.getFileHandle(name,{create:true}),safeTitle:s=>s,openNoteDirectory:async()=>{},
  fetchImage:async url=>({bitmap:{url,close(){}}}),convertImage:async bitmap=>{if(fail)throw Error('write failed');return bitmap.url;},
  fingerprint:async bitmap=>fp(Number(bitmap.url)),
};
let source=fs.readFileSync(new URL('../case-download.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
source='const {'+Object.keys(globalThis.__caseDeps).join(',')+'}=globalThis.__caseDeps;\n'+source;
const {saveCases}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const options={selected:[0,80,150].map(n=>({url:String(n),page:'https://other.com/case',noteId:'new',noteTitle:'新标题'})),destination:null,downloads:{search:async({id})=>[{id,state:'complete',exists:true}]},format:'png',quality:1,status(){},log(){},decide:async()=>{prompts++;return choice;},browserDownload:async(blob,name)=>{writes.push(name);return {id:10+writes.length};}};
const reset=()=>{records=[{id:'old',title:'旧标题',folder:'22-旧标题',sources:['old|id'],sourceUrls:[],downloadedAt:'2026-10-01',images:[{name:'001.png',fp:fp(0),downloadId:1},{name:'002.png',fp:fp(80),downloadId:2}]}];writes=[];};
reset();let result=await saveCases(options);assert.equal(result.success,1);assert.equal(result.skipped,2);assert.deepEqual(writes,['22-旧标题/003.png']);assert.equal(records.length,1);assert.equal(records[0].images.length,3);assert.equal(records[0].downloadedAt,'2026-10-01');assert.ok(records[0].sources.includes('other.com|new'));
choice={action:'skip'};reset();result=await saveCases(options);assert.equal(result.success,0);assert.equal(result.skipped,3);assert.equal(writes.length,0);
choice={action:'separate'};reset();await saveCases(options);assert.equal(records.length,2);assert.ok(writes.every(n=>n.startsWith('23-新标题/')));
reset();fail=true;await saveCases(options);assert.equal(records.length,1,'failed download must not add history');fail=false;
indexFail=true;await assert.rejects(saveCases(options),/index full/);indexFail=false;
reset();prompts=0;await saveCases({...options,downloads:{search:async()=>[{state:'complete',exists:false}]}});assert.equal(prompts,0,'deleted files do not produce merge prompts');
console.log('PASS: partial overlap merge, only new images saved, skip, separate, failed writes, index failure, deleted file history');
// An old style folder participates when the new destination is the default downloads root.
reset();const old=structuredClone(records[0]);old.images.forEach(i=>{i.size=10;i.modified=99;});records=[];
const files=new Map(old.images.map(i=>[i.name,{size:10,lastModified:99}]));let foreignWrites=0;
const caseDirectory={async *entries(){for(const [name,file]of files)yield [name,{kind:'file',getFile:async()=>file}];},async getFileHandle(name){return {name,getFile:async()=>({size:10,lastModified:99}),createWritable:async()=>({write:async()=>{foreignWrites++;files.set(name,{size:10,lastModified:99});},close:async()=>{}})};}};
const root={name:'意式极简',queryPermission:async()=> 'granted',getDirectoryHandle:async name=>{assert.equal(name,old.folder);return caseDirectory;}};
externalLibraries=[{key:'case-directory:style',name:'意式极简',directory:root,records:[old]}];
choice={action:'merge',targetId:'case-directory:style|old'};
let shown;result=await saveCases({...options,decide:async prompt=>{shown=prompt;return choice;}});
assert.equal(shown.matches[0].location,'意式极简/22-旧标题');assert.equal(foreignWrites,1);assert.equal(result.skipped,2);
assert.equal(foreignSaved.directory,root);assert.equal(foreignSaved.records[0].images.length,3);assert.equal(records.length,0,'merge must update original library only');
// A second download sees new history without needing to rescan every library.
externalLibraries[0].records=foreignSaved.records;
choice={action:'separate'};writes=[];await saveCases(options);assert.equal(records.length,1);assert.ok(writes.every(n=>n.startsWith('01-新标题/')),'separate saves into current destination with its own numbering');
// A deleted original image must be downloaded again instead of skipped on a stale fingerprint.
records=[];externalLibraries[0].records=[structuredClone(old)];files.delete('002.png');files.delete('003.png');choice={action:'merge',targetId:'case-directory:style|old'};foreignWrites=0;
result=await saveCases(options);assert.equal(result.skipped,1);assert.equal(foreignWrites,2);
root.queryPermission=async()=> 'denied';await assert.rejects(saveCases(options),/原文件夹未授权/);
console.log('PASS: cross-folder matches, original location, cross-folder append, independent numbering, stale-file refresh, lost permission');
// The same merge works when both old and current destinations are selected folders.
root.queryPermission=async()=> 'granted';records=[];files.set('002.png',{size:10,lastModified:99});files.delete('003.png');files.delete('004.png');
const currentRoot={name:'原木风',async isSameEntry(other){return other===this;},async *entries(){},async getFileHandle(){throw new DOMException('missing','NotFoundError');},getDirectoryHandle(){throw Error('must not write merged files into current root');}};
externalLibraries=[{key:'case-directory:style',name:'意式极简',directory:root,records:[structuredClone(old)]},{key:'case-directory:current',name:'原木风',directory:currentRoot,records:[]}];
foreignWrites=0;choice={action:'merge',targetId:'case-directory:style|old'};
result=await saveCases({...options,destination:currentRoot});assert.equal(result.success,1);assert.equal(result.skipped,2);assert.equal(foreignWrites,1);assert.equal(foreignSaved.directory,root);
console.log('PASS: selected-folder to selected-folder merge writes exclusively to original root');
