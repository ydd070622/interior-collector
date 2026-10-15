import assert from 'node:assert/strict';
import fs from 'node:fs';
const encode=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const history=await import(encode(fs.readFileSync(new URL('../case-history.js',import.meta.url),'utf8')));
const cached={name:'001.png',size:10,modified:20,fp:{preview:'data:image/jpeg;base64,AAAA'}};
const file={kind:'file',getFile:async()=>({size:10,lastModified:20,name:'001.png'})};
const child={kind:'directory',async *entries(){yield ['001.png',file];},async getFileHandle(name){assert.equal(name,'001.png');return file;}};
const middle={kind:'directory',async *entries(){yield ['01-客厅',child];},getDirectoryHandle:async name=>{assert.equal(name,'01-客厅');return child;}};
const directory={name:'风格素材',kind:'directory',queryPermission:async()=> 'granted',async *entries(){yield ['原木风',middle];},getDirectoryHandle:async name=>{assert.equal(name,'原木风');return middle;}};
const record={id:'one',folder:'原木风/01-客厅',title:'客厅',images:[cached],sources:[]};
const scanned=await history.readFolderHistory(directory,()=>{},[record]);assert.equal(scanned[0].folder,record.folder);assert.equal(scanned[0].id,'one');
assert.equal(await history.resolveCaseDirectory(directory,''),directory);
await assert.rejects(history.resolveCaseDirectory(directory,'../secret'),/不合法/);
await assert.rejects(history.resolveCaseDirectory(directory,'a\\b'),/不合法/);
let saved,replaced;
globalThis.__libraryTest={cached:[record],save:async(d,r)=>saved={directory:d,records:r},replace:async(key,d)=>replaced={key,directory:d}};
const fileModule=encode('export const loadDirectoryCaseHistory=async()=>globalThis.__libraryTest.cached;export const saveDirectoryCaseHistory=(...args)=>globalThis.__libraryTest.save(...args);export const withCaseHistoryLock=fn=>fn();export const replaceCaseLibraryDirectory=(...args)=>globalThis.__libraryTest.replace(...args);');
const historyModule=encode(fs.readFileSync(new URL('../case-history.js',import.meta.url),'utf8'));
const dataSource=fs.readFileSync(new URL('../library-data.js',import.meta.url),'utf8').replace("'./files.js'",JSON.stringify(fileModule)).replace("'./case-history.js'",JSON.stringify(historyModule));
const {flattenLibraries,selectLibraryCases,safePreview,readLibraryImage,importLibraryDirectory,relinkLibraryDirectory}=await import(encode(dataSource));
const libraries=[{key:'a',name:'风格素材',directory,records:[record]},{key:'b',name:'项目',directory:null,records:[{...record,id:'one',folder:'01-卧室',title:'卧室',updatedAt:'2026-10-15'}]}];
const entries=flattenLibraries(libraries);assert.equal(entries.length,2);assert.notEqual(entries[0].key,entries[1].key);
assert.equal(selectLibraryCases(entries,{query:'原木风'})[0].record.title,'客厅');assert.equal(selectLibraryCases(entries,{query:'001.png'}).length,2);
assert.equal(selectLibraryCases(entries,{folder:'b'})[0].record.title,'卧室');
// Materials default to the download order: the highest folder number first.
const ordered=[
  {record:{folder:'07-七',title:'七'},library:{key:'a',name:'a'}},
  {record:{folder:'24-二十四',title:'二十四'},library:{key:'a',name:'a'}},
  {record:{folder:'10-十',title:'十',downloadedAt:'2026-10-15T00:00:00Z'},library:{key:'a',name:'a'}},
  {record:{folder:'手动文件夹',title:'手动',downloadedAt:'2026-09-01T00:00:00Z'},library:{key:'a',name:'a'}}
];
assert.deepEqual(selectLibraryCases(ordered).map(e=>e.record.folder),['24-二十四','10-十','07-七','手动文件夹'],'default order is folder number descending, unknown numbers last');
assert.deepEqual(selectLibraryCases(ordered,{sort:'folder-asc'}).map(e=>e.record.folder),['07-七','10-十','24-二十四','手动文件夹']);
assert.equal(selectLibraryCases(ordered,{sort:'recent'})[0].record.folder,'10-十','recent order uses the download date');
assert.equal(selectLibraryCases(ordered,{sort:'name'})[0].record.folder,'24-二十四','name order sorts by title');
assert.equal(entries.length,2);
assert.equal(safePreview(cached),'data:image/jpeg;base64,AAAA');assert.equal(safePreview({fp:{preview:'javascript:alert(1)'}}),null);
assert.equal((await readLibraryImage(entries[0],cached)).name,'001.png');
await assert.rejects(readLibraryImage(entries[1],cached),/导入下载文件夹/);
await assert.rejects(readLibraryImage(entries[0],{name:'../secret'}),/不合法/);
const denied={...entries[0],library:{...libraries[0],directory:{...directory,queryPermission:async()=> 'denied'}}};
await assert.rejects(readLibraryImage(denied,cached),{name:'NotAllowedError'});
const importRoot={...directory,getFileHandle:async()=>{throw new DOMException('missing','NotFoundError');}};
await importLibraryDirectory(importRoot);assert.equal(saved.records[0].folder,record.folder);
await relinkLibraryDirectory(libraries[0],importRoot);assert.equal(replaced.key,'a');assert.equal(saved.directory,importRoot);
await assert.rejects(relinkLibraryDirectory(libraries[0],{getDirectoryHandle:async()=>{throw Error('missing');}}),/未找到原案例/);
console.log('PASS: nested folder indexing, stable IDs, path safety, cross-library IDs, searching, safe previews, local originals, denied permissions, import, relinking');
