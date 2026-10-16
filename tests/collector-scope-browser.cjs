const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'collector.html';if(name.includes('..')){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,name)));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:450,height:610}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const settings={collectionScope:'page',imageMode:'all'};window.__commands=[];
   const tab={id:1,windowId:1,url:'https://example.com/products',title:'商品页面'};
   const state={items:[],logs:[],hasStarted:false,active:false,saving:false,status:'准备提取',imageMode:'all'};
   window.chrome={tabs:{query:async()=>[tab],get:async()=>tab,update:async()=>{}},windows:{update:async()=>{}},storage:{local:{get:async()=>settings,set:async value=>Object.assign(settings,value)}},runtime:{onMessage:{addListener(){}},sendMessage:async message=>{if(message.type==='CURRENT_SOURCE')return {tab};if(message.type==='JOB'){__commands.push(message);return {state};}return {};}}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/collector.html?tab=1');await page.waitForFunction(()=>document.getElementById('source').textContent==='商品页面');
  await page.waitForFunction(()=>document.querySelector('input[value="all"]').checked);
  assert.equal(await page.locator('#collectionScope').count(),0,'scope selection removed');
  assert.equal(await page.locator('input[value="all"]').isChecked(),true);assert.equal(await page.locator('#noteLimit').isVisible(),true);
  await page.locator('#rescan').click();await page.waitForFunction(()=>__commands.some(c=>c.command==='scan'));
  let payload=await page.evaluate(()=>__commands.find(c=>c.command==='scan').payload);assert.equal(payload.collectionScope,'smart');assert.equal(payload.imageMode,'all');assert.equal(payload.noteLimit,null);
  assert.equal(await page.locator('#selectRegion').count(),0);
  await page.setViewportSize({width:350,height:610});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS: actual collector uses正文 by default, ignores previously saved scope, retains image filter and note limit, no scope/region controls, narrow layout');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
