const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const history=fs.readFileSync(path.join(__dirname,'../case-history.js'));
const assets=process.env.FINGERPRINT_TEST_DIRECTORY?fs.readdirSync(process.env.FINGERPRINT_TEST_DIRECTORY).filter(n=>/\.png$/i.test(n)).map(n=>({name:n,data:fs.readFileSync(path.join(process.env.FINGERPRINT_TEST_DIRECTORY,n)).toString('base64')})):[];
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/javascript');res.end(req.url==='/image-upgrade.js'?fs.readFileSync(path.join(__dirname,'../image-upgrade.js')):req.url==='/files.js'?'export function uniqueFile(){}':history);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async({assets,url})=>{
   const {fingerprint,imageDistance,matchImages,refreshCaseRecord}=await import(url),originals=[],copies=[],metrics=[],files=[],dimensions=[];
   const {hasAdditionalDetail,canUpgradeImage}=await import(new URL('./image-upgrade.js',url).href);
   for(let i=0;i<(assets.length||7);i++){
    let bitmap;
    if(assets.length)bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+assets[i].data)).blob());
    else{const c=document.createElement('canvas');c.width=720;c.height=960;const ctx=c.getContext('2d');ctx.fillStyle=`rgb(${70+i*20},${90+i*12},${120-i*10})`;ctx.fillRect(0,0,720,960);for(let k=0;k<12;k++){ctx.fillStyle=`rgb(${(i*47+k*33)%256},${(i*31+k*23)%256},${(i*19+k*71)%256})`;ctx.fillRect((k*53)%720,(k*83)%960,190,140);}bitmap=await createImageBitmap(c);}
    dimensions.push([bitmap.width,bitmap.height]);const a=await fingerprint(bitmap),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);
    const png=await new Promise(r=>c.toBlob(r,'image/png')),pngBitmap=await createImageBitmap(png),same=await fingerprint(pngBitmap);
    if(imageDistance(a,same)!==0)throw Error('Lossless PNG changed fingerprint');pngBitmap.close();
    files.push(new File([png],String(i+1).padStart(3,'0')+'.png',{type:'image/png',lastModified:100}));
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9)),copy=await createImageBitmap(blob),b=await fingerprint(copy);
    originals.push({fp:a});copies.push({fp:b});
    metrics.push({name:assets[i]?.name||String(i),colour:a.rgb.reduce((sum,v,j)=>sum+Math.abs(v-b.rgb[j]),0)/768,edges:a.bits.reduce((sum,v,j)=>sum+(v!==b.bits[j]),0)/240,matched:Number.isFinite(imageDistance(a,b))});
    bitmap.close();copy.close();
   }
   const folder={async *entries(){for(const file of files)yield [file.name,{kind:'file',getFile:async()=>file}];}};
   const root={getDirectoryHandle:async()=>folder};
   const stale={folder:'old-case',images:files.slice(0,4).map(file=>({name:file.name,size:file.size,modified:100,fp:{}}))};
   const refreshed=await refreshCaseRecord(root,stale,()=>{},{rebuild:true});
   const recovered=matchImages(originals,refreshed.images).length;
   const pairs=assets.length===10?[[0,7],[1,8],[2,9]].map(([i,j])=>({names:[assets[i].name,assets[j].name],dimensions:[dimensions[i],dimensions[j]],ratio:originals[i].fp.ratio/originals[j].fp.ratio,colour:originals[i].fp.rgb.reduce((sum,v,k)=>sum+Math.abs(v-originals[j].fp.rgb[k]),0)/768,edges:originals[i].fp.bits.reduce((sum,v,k)=>sum+(v!==originals[j].fp.bits[k]),0)/240,matched:Number.isFinite(imageDistance(originals[i].fp,originals[j].fp))})):[];
   const upgrades=[];
   if(assets.length===10)for(const [i,j]of [[0,7],[1,8],[2,9]]){
    const low=await createImageBitmap(files[i]),high=await createImageBitmap(files[j]);
    const c=document.createElement('canvas');c.width=high.width;c.height=high.height;c.getContext('2d').drawImage(low,0,0,c.width,c.height);
    const enlarged=await createImageBitmap(c);
    upgrades.push({candidate:canUpgradeImage(originals[j],{name:files[i].name,...originals[i]}),real:hasAdditionalDetail(high,low),enlarged:hasAdditionalDetail(enlarged,low)});
    low.close();high.close();enlarged.close();
   }
   const repeatMatches=assets.length===10?matchImages([originals[7],originals[8],originals[9],...originals.slice(3,7)],originals.slice(0,7)).length:null;
   return {metrics,pairs,upgrades,repeatMatches,matches:matchImages(originals,copies).length,recovered,total:originals.length,cross:originals.map((a,i)=>originals.filter((b,j)=>i!==j&&Number.isFinite(imageDistance(a.fp,b.fp))).length)};
  },{assets,url:'http://127.0.0.1:'+server.address().port+'/case-history.js'});
  console.log(JSON.stringify(result));assert.equal(result.matches,result.total,'same pictures after re-encoding must all match');assert.equal(result.recovered,result.total,'rebuild must recover incomplete and incorrect cached fingerprints');
  if(result.pairs.length){assert.ok(result.pairs.every(p=>p.matched),'actual duplicate files must match');assert.equal(result.repeatMatches,7,'real mixed-resolution recollection must match all seven originals');assert.deepEqual(result.cross,[1,1,1,0,0,0,0,1,1,1],'only known duplicate pairs may match across files');}
  if(result.upgrades.length)assert.ok(result.upgrades.every(u=>u.candidate&&u.real&&!u.enlarged),'real detail upgrades pass; simple enlargements are rejected');
  else assert.ok(result.cross.every(n=>n===0),'different views must stay separate');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
