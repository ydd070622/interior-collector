const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!['scan.js','page-collector.js'].includes(name)){res.setHeader('Content-Type','text/html');res.end('<main></main>');return;}res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,name)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:900,height:700}});await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async()=>{
   const {scanPage,pickImageRegion}=await import('./scan.js'),{collectPageImages}=await import('./page-collector.js');
   document.body.innerHTML=`<nav><img src="/nav-large.jpg"></nav><article id="content"><img src="/thumb.jpg" data-original="/full.jpg" srcset="/small.jpg 320w,/largest.jpg 2000w"><picture><source srcset="/picture-large.webp 2000w"><img src="/picture.jpg"></picture><div style="height:200px;background-image:url('/background.jpg')"></div><a href="/linked-original.png"><img src="/linked-thumb.jpg"></a><div id="shadow"></div></article><aside><img src="/other.jpg"></aside><a id="bing" m='{"murl":"https://images.example.com/search-full.jpg"}' href="/search"></a><a href="/imgres?imgurl=https%3A%2F%2Fimages.example.com%2Fgoogle-original.jpg">result</a><script type="application/ld+json">{"@type":"Product","image":["https://images.example.com/product.jpg"]}</script><div style="height:4000px"></div>`;
   const shadow=document.getElementById('shadow').attachShadow({mode:'open'});shadow.innerHTML='<img data-src="/shadow-large.jpg">';
   const smart=scanPage({scope:'smart'}),all=scanPage({scope:'page',site:'bing-images'});
   const img=smart.images.find(i=>i.url.endsWith('/full.jpg'));
   const options={site:'google-images',scope:'page'};const google=scanPage(options);
   document.getElementById('content').setAttribute('data-interior-selected-region','test');
   const region=scanPage({scope:'region',selector:'[data-interior-selected-region="test"]'});
   let invalid=false;try{scanPage({scope:'region',selector:'#missing'});}catch{invalid=true;}
   window.scrollTo(0,200);let calls=0;
   const api={scripting:{executeScript:async({func,args=[]})=>{calls++;return [{result:await func(...args)}];}}};
   const collected=await collectPageImages({api,tabId:1,scope:'page',adapter:{id:'bing-images'},rounds:6,wait:async()=>{}});
   const restored=Math.abs(scrollY-200)<2;
   const selecting=pickImageRegion();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const cancel=await selecting;
   const selectingAgain=pickImageRegion(),target=document.getElementById('content');target.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));const selection=await selectingAgain;
   const selectionWorks=document.querySelector(selection.selector)===target;
   const comma=document.createElement('img');comma.srcset='/upload/w_400,c_scale/test.jpg 400w, /upload/w_1200,c_scale/test.jpg 1200w';target.append(comma);
   const commaCandidate=scanPage({scope:'page'}).images.find(i=>i.url.includes('w_1200,c_scale'));
   const wrapper=document.createElement('main');document.body.append(wrapper);wrapper.append(target);const related=document.createElement('section');related.className='related';related.innerHTML=Array.from({length:30},(_,i)=>'<img src="/related-'+i+'.jpg">').join('');wrapper.append(related);
   const focused=scanPage({scope:'smart'}).images;
   document.body.innerHTML='<img src="/outside.jpg">';const noBody=scanPage({scope:'smart'}).images;
   return {smart:smart.images.map(i=>i.url),all:all.images.map(i=>i.url),google:google.images.map(i=>i.url),region:region.images.map(i=>i.url),img,invalid,restored,collected:collected.images.length,calls,cancel,selectionWorks,commaCandidate,focused:focused.map(i=>i.url),noBody,overlayText:document.body.textContent.includes('Esc 取消')};
  });
  assert.ok(result.img.urls.some(u=>u.endsWith('/largest.jpg')));assert.ok(!result.smart.some(u=>u.endsWith('/nav-large.jpg')));assert.ok(result.smart.some(u=>u.endsWith('/shadow-large.jpg')));assert.ok(result.smart.some(u=>u.endsWith('/linked-original.png')));assert.ok(result.smart.some(u=>u.endsWith('/picture-large.webp')));
  assert.ok(result.all.includes('https://images.example.com/search-full.jpg'));assert.ok(result.google.includes('https://images.example.com/google-original.jpg'));assert.ok(result.all.includes('https://images.example.com/product.jpg'));
  assert.ok(!result.region.some(u=>u.endsWith('/other.jpg')));assert.ok(result.invalid);assert.ok(result.restored);assert.ok(result.collected>0);assert.equal(result.cancel.selector,null);assert.ok(result.selectionWorks);assert.ok(result.commaCandidate);assert.equal(result.overlayText,false);
  assert.ok(!result.focused.some(u=>u.includes('/related-')),'article beats a main containing more recommendation pictures');assert.deepEqual(result.noBody,[],'missing正文 never silently falls back to all-page collection');
  console.log('PASS: real DOM scanner: original alternatives, srcset/picture, CSS backgrounds, shadow DOM, search metadata, product JSON-LD, smart/region isolation, invalid regions, lazy page collection and scroll restoration, selection cancellation');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
