const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/scan.js'?'text/javascript':'text/html');res.end(req.url==='/scan.js'?fs.readFileSync(require('node:path').join(__dirname,'../scan.js')):'<div></div>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/detail/133998133/0');
  const result=await page.evaluate(async()=>{
   const {scanPage}=await import('/scan.js');
   document.body.innerHTML='<div class="detailCasePageContainer"><div class="detailInfoContentBox"><img src="/small.jpg"></div><div class="related"><img src="/recommend.jpg"></div></div>';
   const script=document.createElement('script');script.id='__NEXT_DATA__';script.type='application/json';
   script.textContent=JSON.stringify({props:{pageProps:{initialViewData:{data:{caseInfo:{caseId:133998133,titleOrigin:'测试案例'},contents:[{caseId:133998133,type:0,sort:2,imgUrl:'https://image.linggan.znzmo.com/second.jpeg'},{caseId:999,type:0,imgUrl:'/other-case.jpg'},{caseId:133998133,type:1,imgUrl:'/text.jpg'},{caseId:133998133,type:0,sort:1,imgUrl:'https://image.linggan.znzmo.com/first.jpeg',caseImageList:[{url:'/thumb.jpg'}]}]}}}}});document.body.append(script);
   const current=scanPage({scope:'smart',site:'znztv'});script.remove();const fallback=scanPage({scope:'smart',site:'znztv'});
   return {current,fallback};
  });
  assert.deepEqual(result.current.images.map(i=>i.url),['https://image.linggan.znzmo.com/first.jpeg','https://image.linggan.znzmo.com/second.jpeg']);
  assert.ok(result.current.images[0].urls.some(url=>url.endsWith('/thumb.jpg')));
  assert.equal(result.current.scopeFound,true);assert.equal(result.fallback.images.length,1);assert.ok(result.fallback.images[0].url.endsWith('/small.jpg'));
  console.log('PASS: 知末当前案例图片元数据、顺序、大图候选、推荐隔离及正文容器回退');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
