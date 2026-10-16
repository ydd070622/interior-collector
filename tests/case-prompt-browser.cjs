const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'collector.html';if(!['collector.html','style.css','case-prompt.js'].includes(name)){res.writeHead(404);res.end();return;}let data=fs.readFileSync(path.join(root,name),'utf8');if(name==='collector.html')data=data.replace(/<script type="module" src="popup.js"><\/script>/,'');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(data);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:450,height:590}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(async()=>{
   const {renderCasePrompt}=await import('./case-prompt.js');window.renderPrompt=renderCasePrompt;
   for(const id of ['grid','empty','download'])document.getElementById(id).hidden=true;
   const preview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="tan"/></svg>');
   window.promptFixture={token:'one',title:'测试案例',total:7,matches:[{id:'old',title:'原案例',folder:'20-原案例',sameSource:true,shared:7,upgradeCandidates:2,canMerge:true,examples:Array.from({length:7},()=>({incoming:preview,previous:preview}))}]};
   renderCasePrompt(window.promptFixture,async choice=>{window.choice=choice;});
  });
  assert.equal(await page.locator('#collectionSettings').evaluate(el=>el.open),false);
  let list=await page.locator('.case-examples').boundingBox(),first=await page.locator('.case-examples>div').first().boundingBox();assert.ok(first.y+first.height<=list.y+list.height,'default window shows a whole comparison pair');
  const merge=page.getByRole('button',{name:'合并并检查高清升级'}),secondary=page.getByRole('button',{name:'单独保存'});
  assert.ok((await merge.boundingBox()).y<(await secondary.boundingBox()).y,'primary action has a dedicated row');
  await page.locator('#collectionSettings>summary').click();assert.equal(await page.locator('#collectionSettings').evaluate(el=>el.open),true);
  await page.evaluate(()=>renderPrompt(promptFixture,async()=>{}));assert.equal(await page.locator('#collectionSettings').evaluate(el=>el.open),true,'state updates preserve manually expanded settings');
  await page.locator('#collectionSettings>summary').click();
  await page.setViewportSize({width:850,height:720});assert.equal(await page.locator('.case-examples').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  await page.evaluate(()=>renderPrompt(promptFixture,async choice=>{window.choice=choice;throw Error('授权失效，请重新选择');}));
  // A new token installs the retry callback.
  await page.evaluate(()=>{promptFixture.token='two';renderPrompt(promptFixture,async choice=>{window.choice=choice;throw Error('授权失效，请重新选择');});});
  await merge.click();await page.getByRole('alert').filter({hasText:'授权失效'}).waitFor();assert.equal(await merge.isEnabled(),true);
  await page.evaluate(()=>renderPrompt(null,async()=>{}));assert.equal(await page.locator('#collectionSettings').evaluate(el=>el.open),true);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('reviewing-case')),false);
  assert.deepEqual(errors,[]);console.log('PASS: compact prompt, complete pair at 450x590, settings folding and restoration, responsive group count, primary action layout, retry errors');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
