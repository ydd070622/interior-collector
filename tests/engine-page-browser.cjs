const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),assets=new Map();
const mock=`
const frame=document.createElement('iframe');frame.hidden=true;frame.src='/fixture';document.body.append(frame);const ready=new Promise(r=>frame.onload=r);
export const api={tabs:{get:async()=>({id:1,url:location.origin+'/fixture',title:'通用商品页面',windowId:1}),query:async()=>[]},scripting:{executeScript:async({func,args=[]})=>{await ready;return [{result:await frame.contentWindow.eval('('+func.toString()+')(...'+JSON.stringify(args)+')')}];}},storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async message=>{if(message.type==='JOB_UPDATE')window.__latest=message.state;return {};},onMessage:{addListener(fn){window.__engineListener=fn;}}}};
`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1);
  if(assets.has(name)){res.setHeader('Content-Type','image/png');res.end(assets.get(name));return;}
  if(name==='fixture'){res.setHeader('Content-Type','text/html');res.end('<article><h1>大图测试商品</h1><img src="/thumb.png" data-original="/full.png"><img src="/small.png"><img src="/long.png"><img src="/duplicate-large.png"></article>');return;}
  if(name==='background-api.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return;}
  if(name.includes('..')){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,name)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const images=await page.evaluate(()=>[['thumb.png',120,120],['small.png',200,200],['full.png',1000,1400],['long.png',800,6000],['duplicate-large.png',2000,2800]].map(([name,w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').fillRect(0,0,w,h);return {name,data:c.toDataURL('image/png').split(',')[1]};}));
  for(const image of images)assets.set(image.name,Buffer.from(image.data,'base64'));
  await page.goto('http://127.0.0.1:'+server.address().port+'/engine.html?tab=1');
  await page.waitForFunction(()=>window.__engineListener);
  const start=scope=>page.evaluate(scope=>new Promise(resolve=>__engineListener({type:'ENGINE_COMMAND',command:'scan',payload:{sourceTab:1,imageMode:'all',collectionScope:scope}},{},resolve)),scope);
  await start('smart');await page.waitForFunction(()=>window.__latest?.hasStarted&&!window.__latest.active,{},{timeout:20000});
  let state=await page.evaluate(()=>__latest);assert.equal(state.items.length,2,'unknown site retains generic large images instead of clearing them');
  assert.ok(state.items.some(i=>i.url.endsWith('/duplicate-large.png')&&i.width===2000),'repeated image keeps the larger version');assert.ok(state.items.some(i=>i.url.endsWith('/long.png')&&i.height===6000));assert.ok(state.items.every(i=>i.confidence===null),'all pictures bypass the classifier');
  assert.ok(state.status.includes('尺寸不足 1 张')&&state.status.includes('重复 1 张'),'size exclusions and duplicates are reported separately');
  await start('page');await page.waitForFunction(()=>window.__latest?.collectionScope==='smart'&&!window.__latest.active,{},{timeout:20000});
  state=await page.evaluate(()=>__latest);assert.equal(state.items.length,2);assert.deepEqual(errors,[]);
  console.log('PASS: actual engine:正文 only, original alternatives, small-image rejection, long images, same-batch duplicate URL removal with larger version retained, separate exclusion counters, ignores old page-scope setting');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
