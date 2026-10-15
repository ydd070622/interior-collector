// Run with PLAYWRIGHT_MODULE_PATH and BROWSER_EXECUTABLE when not installed globally.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
// The fixture image must survive createImageBitmap: several Chromium builds reject 1x1 PNGs
// even though <img> decodes them, which would skip the import path entirely. 64x48 always decodes.
const fixturePng=(()=>{const w=64,h=48,raw=Buffer.alloc((w*3+1)*h);
 for(let y=0;y<h;y++){const row=y*(w*3+1);raw[row]=0;for(let x=0;x<w;x++){raw[row+1+x*3]=0x8c;raw[row+2+x*3]=0x62;raw[row+3+x*3]=0x3e;}}
 const table=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
 const crc32=buf=>{let c=0xffffffff;for(const byte of buf)c=table[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
 const chunk=(type,body)=>{const head=Buffer.from(type,'ascii');const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([head,body])),0);const len=Buffer.alloc(4);len.writeUInt32BE(body.length,0);return Buffer.concat([len,head,body,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',require('node:zlib').deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');})();
let assets=[fixturePng,fixturePng,fixturePng];
if(process.env.LIBRARY_TEST_IMAGES){const html=fs.readFileSync(process.env.LIBRARY_TEST_IMAGES,'utf8');assets=JSON.parse(html.match(/<script type="application\/json" id="ml-image-data">([\s\S]*?)<\/script>/)[1]).slice(0,6);}
const fixture=`
const assets=${JSON.stringify(assets)};
function notFound(){return new DOMException('missing','NotFoundError');}
function makeRoot(name,spec){
 const base={name,kind:'directory',permission:'granted',policy:'granted',permissionRequests:0,children:new Map()};
 function directory(name){return {name,kind:'directory',children:new Map(),async *entries(){yield* this.children;},async getDirectoryHandle(key){const child=this.children.get(key);if(!child||child.kind!=='directory')throw notFound();return child;},async getFileHandle(key){const child=this.children.get(key);if(!child||child.kind!=='file')throw notFound();return child;}};}
 Object.assign(base,directory(name));base.queryPermission=async()=>base.permission;base.requestPermission=async()=>{base.permissionRequests++;return base.permission=base.policy;};base.isSameEntry=async other=>base===other;
 for(const [relative,names]of Object.entries(spec)){let folder=base;for(const part of relative.split('/').filter(Boolean)){if(!folder.children.has(part))folder.children.set(part,directory(part));folder=folder.children.get(part);}names.forEach((filename,i)=>{const raw=assets[i%assets.length];const bytes=Uint8Array.from(atob(raw.split(',')[1]),c=>c.charCodeAt(0));const file=new File([bytes],filename,{type:raw.startsWith('data:image/png')?'image/png':'image/jpeg',lastModified:100});folder.children.set(filename,{kind:'file',name:filename,getFile:async()=>file});});}
 return base;
}
const style=makeRoot('意式极简',{'参考/01-客厅':['001.jpg','002.jpg'],'02-卧室':['001.jpg']});
const incoming=makeRoot('项目 B',{'01-新案例':['001.jpg','002.jpg']});
const moved=makeRoot('意式极简-新位置',{'参考/01-客厅':['001.jpg','002.jpg'],'02-卧室':['001.jpg']});
async function record(root,folder,id,title){let directory=root;for(const name of folder.split('/'))directory=await directory.getDirectoryHandle(name);const images=[];let i=0;for await(const [name,handle]of directory.entries()){const file=await handle.getFile();images.push({name,size:file.size,modified:100,fp:{preview:assets[i++%assets.length]}});}return {id,title,folder,images,sources:[],sourceUrls:['https://example.com/design'],downloadedAt:'2026-10-15T00:00:00Z'};}
const libraries=[{key:'case-history',name:'默认下载／室内灵感',directory:null,records:[{id:'default',title:'默认下载案例',folder:'01-默认下载',images:[{name:'001.jpg',downloadId:7,fp:{preview:assets[0]}}]}]},{key:'case-directory:style',name:style.name,directory:style,records:[await record(style,'参考/01-客厅','living','客厅案例'),await record(style,'02-卧室','bedroom','卧室案例')]}];
export const loadCaseLibraries=async()=>libraries.map(l=>({...l,name:l.directory?.name||l.name,records:l.records.map(r=>({...r,images:[...r.images]}))}));
export const loadDirectoryCaseHistory=async root=>libraries.find(l=>l.directory===root)?.records;
export async function saveDirectoryCaseHistory(root,records){let library=libraries.find(l=>l.directory===root);if(!library){library={key:'case-directory:new',name:root.name,directory:root};libraries.push(library);}library.records=records;}
export const withCaseHistoryLock=operation=>navigator.locks.request('fixture-index',operation);
export async function replaceCaseLibraryDirectory(key,root){libraries.find(l=>l.key===key).directory=root;}
globalThis.__libraryFixture={style,incoming,moved,libraries,pickerRoot:incoming};
window.showDirectoryPicker=async()=>globalThis.__libraryFixture.pickerRoot;
window.chrome={downloads:{search:async()=>[{id:7,exists:true,state:'complete'}],show:id=>{globalThis.__shownDownload=id;}}};
`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/files.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1240,height:920}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/library.html');
  await page.getByText('3 个案例 · 4 张图片',{exact:true}).waitFor();assert.equal(await page.locator('.tile').count(),3);
  assert.equal(await page.locator('.sidebar-note').count(),0);
  assert.ok(await page.locator('aside').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight)<2),'directory panel fills the available window height');
  const separator=page.getByRole('separator',{name:'调整左侧栏宽度'});
  const handle=await separator.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+30);await page.mouse.down();await page.mouse.move(handle.x+180,handle.y+30,{steps:10});await page.mouse.up();
  assert.ok(await page.locator('aside').evaluate(el=>el.getBoundingClientRect().width)>350,'sidebar freely widens');
  await page.reload();await page.getByText('3 个案例 · 4 张图片',{exact:true}).waitFor();
  assert.ok(await page.locator('aside').evaluate(el=>el.getBoundingClientRect().width)>350,'sidebar width survives reload');
  await separator.dblclick();
  assert.equal(await page.locator('aside').evaluate(el=>Math.round(el.getBoundingClientRect().width)),220);
  assert.ok(await page.locator('main').evaluate(el=>innerHeight-el.getBoundingClientRect().bottom)>=16,'scrolling area leaves bottom breathing room');
  await page.locator('#toggleFolders').click();
  assert.ok(await page.locator('aside').evaluate(el=>el.getBoundingClientRect().width)<90,'whole sidebar collapses');
  assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width>innerWidth-100),'gallery fills space after sidebar collapse');
  const collapsedFolder=page.locator('[data-action="folder"][data-key="case-directory:style"]');
  assert.equal(await collapsedFolder.isVisible(),true,'folders remain available in the collapsed rail');
  await collapsedFolder.click();assert.equal(await page.locator('.tile').count(),2,'collapsed folder shortcut filters gallery');
  assert.ok(await page.locator('aside').evaluate(el=>el.getBoundingClientRect().width)<90,'folder navigation keeps rail collapsed');
  await page.locator('#all').click();
  await page.reload();await page.getByText('3 个案例 · 4 张图片',{exact:true}).waitFor();
  assert.ok(await page.locator('aside').evaluate(el=>el.getBoundingClientRect().width)<90,'collapsed rail survives refresh');
  assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width>innerWidth-100),'restored collapsed layout retains gallery width');
  await page.locator('#toggleFolders').click();
  assert.equal(await page.locator('aside').evaluate(el=>Math.round(el.getBoundingClientRect().width)),220,'expanding restores sidebar width');
  await page.locator('[data-action="folder"][data-key="case-directory:style"]').click();assert.equal(await page.locator('.tile').count(),2);
  const rootTree=page.locator('details[data-tree-key="root:case-directory:style"]');
  assert.equal(await rootTree.evaluate(el=>el.open),true);
  await page.locator('[data-action="folder"][data-key="case-directory:style"]').click();
  assert.equal(await rootTree.evaluate(el=>el.open),false,'same directory click closes its tree');
  await page.locator('#refresh').click();await page.getByText('2 个案例 · 3 张图片',{exact:true}).waitFor();
  assert.equal(await rootTree.evaluate(el=>el.open),false,'index refresh does not reopen a closed directory');
  await page.locator('[data-action="folder"][data-key="case-directory:style"]').click();
  assert.equal(await rootTree.evaluate(el=>el.open),true,'directory can reopen');
  await page.getByRole('button',{name:'打开案例：客厅案例',exact:true}).click();assert.equal(await page.locator('.image-tile').count(),2);
  await page.getByRole('button',{name:'预览图片：001.jpg',exact:true}).click();await page.waitForFunction(()=>document.getElementById('original').src.startsWith('blob:'));
  await page.waitForFunction(()=>document.getElementById('original').complete&&document.getElementById('original').naturalWidth>0);
  assert.ok(await page.locator('#viewer').evaluate(el=>el.getBoundingClientRect().width-document.getElementById('original').getBoundingClientRect().width<32),'lightbox retains a modest image frame instead of wide side panels');
  assert.equal(await page.locator('#viewer footer').isVisible(),false,'no permanent metadata footer');
  await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.getElementById('imageName').textContent==='002.jpg');
  await page.keyboard.press('ArrowLeft');await page.waitForFunction(()=>document.getElementById('imageName').textContent==='001.jpg');
  const originalBounds=await page.locator('#original').boundingBox();
  await page.mouse.move(originalBounds.x+originalBounds.width/2+60,originalBounds.y+originalBounds.height/2);await page.mouse.down();await page.mouse.move(originalBounds.x+originalBounds.width/2-60,originalBounds.y+originalBounds.height/2,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>document.getElementById('imageName').textContent==='002.jpg');
  await page.mouse.wheel(0,-120);await page.waitForFunction(()=>document.getElementById('imageName').textContent==='001.jpg');
  await page.getByRole('button',{name:'下一张',exact:true}).click();await page.waitForFunction(()=>document.getElementById('imageName').textContent==='002.jpg');
  await page.getByRole('button',{name:'关闭预览'}).click();
  await page.locator('#all').click();await page.getByRole('searchbox').fill('卧室');assert.equal(await page.locator('.tile').count(),1);
  await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'图片',exact:true}).click();assert.equal(await page.locator('.image-tile').count(),4);
  await page.getByRole('button',{name:'案例',exact:true}).click();
  await page.locator('#import').click();await page.getByText('4 个案例 · 6 张图片',{exact:true}).waitFor();assert.equal(await page.locator('.tile').count(),4);
  // Thumbnails never request permission; a deliberate preview can request it.
  await page.evaluate(()=>{__libraryFixture.style.permission='prompt';__libraryFixture.style.policy='denied';__libraryFixture.style.permissionRequests=0;});
  await page.getByRole('button',{name:'打开案例：客厅案例',exact:true}).click();assert.equal(await page.evaluate(()=>__libraryFixture.style.permissionRequests),0);
  await page.getByRole('button',{name:'预览图片：001.jpg',exact:true}).click();await page.getByText('当前显示历史缩略图，请授权读取原图。',{exact:true}).waitFor();
  await page.evaluate(()=>{__libraryFixture.style.policy='granted';});await page.getByRole('button',{name:'授权读取原图',exact:true}).click();await page.waitForFunction(()=>document.getElementById('original').src.startsWith('blob:'));
  await page.getByRole('button',{name:'关闭预览'}).click();
  // Moving the old root can be repaired without copying files.
  await page.evaluate(()=>{__libraryFixture.style.children.clear();__libraryFixture.pickerRoot=__libraryFixture.moved;});
  await page.getByRole('button',{name:'预览图片：001.jpg',exact:true}).click();await page.getByText('原图已移动或删除，请关闭预览后重新关联文件夹。',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭预览'}).click();
  await page.getByRole('button',{name:'重新关联',exact:true}).click();await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('意式极简-新位置'));
  await page.getByRole('button',{name:'预览图片：001.jpg',exact:true}).click();await page.waitForFunction(()=>document.getElementById('original').src.startsWith('blob:'));await page.getByRole('button',{name:'关闭预览'}).click();
  await page.locator('#all').click();await page.getByRole('button',{name:'打开案例：默认下载案例',exact:true}).click();await page.getByRole('button',{name:'预览图片：001.jpg',exact:true}).click();await page.getByRole('button',{name:'在文件夹中显示',exact:true}).click();assert.equal(await page.evaluate(()=>__shownDownload),7);await page.getByRole('button',{name:'关闭预览'}).click();
  await page.locator('#all').click();
  // The sidebar stays put while only the gallery column scrolls.
  await page.evaluate(()=>{const gallery=document.getElementById('gallery');for(let i=0;i<40;i++)gallery.append(gallery.firstElementChild.cloneNode(true));});
  const scrolling=await page.evaluate(()=>{
   const main=document.querySelector('main');main.scrollTop=main.scrollHeight;window.scrollTo(0,600);
   return {docScrollable:document.documentElement.scrollHeight>innerHeight+1,windowScrollY:window.scrollY,
    mainScrollable:main.scrollHeight>main.clientHeight+1,mainScrolled:main.scrollTop>0,
    asideVisible:document.querySelector('aside').getBoundingClientRect().top>=0};
  });
  assert.equal(scrolling.docScrollable,false,'the window itself must not scroll');
  assert.equal(scrolling.windowScrollY,0,'scrolling the gallery must not move the window');
  assert.equal(scrolling.mainScrolled,true,'the gallery column scrolls on its own');
  assert.equal(scrolling.asideVisible,true,'the sidebar stays visible while the gallery scrolls');
  if(process.env.LIBRARY_TEST_OUTPUT){fs.mkdirSync(process.env.LIBRARY_TEST_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.LIBRARY_TEST_OUTPUT,'library-implemented-wide.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'narrow screen does not overflow horizontally');
  if(process.env.LIBRARY_TEST_OUTPUT)await page.screenshot({path:path.join(process.env.LIBRARY_TEST_OUTPUT,'library-implemented-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: real library page with simulated filesystem: folder navigation, nested case, originals, next image, search, views, import and fingerprinting, permission denial/retry, missing originals, relinking, default download reveal, fixed sidebar with gallery-only scroll, narrow layout');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
