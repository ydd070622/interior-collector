// Versioned, local image descriptors. No image is uploaded to a service.
export function sourceIdentity(item) {
  try {
    const u=new URL(item.page);const host=u.hostname.replace(/^www\./,'');
    if(item.noteId)return host+'|'+item.noteId;
    u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|xsec_|source|from|spm|share|ref)/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();return u.href;
  }catch{return '';}
}
export function originalSourceUrl(item) {
  try {
    const u=new URL(item.page),id=item.noteId;
    if(id&&/(^|\.)xiaohongshu\.com$/.test(u.hostname))return 'https://www.xiaohongshu.com/explore/'+encodeURIComponent(id);
    if(id&&/(^|\.)zcool\.com\.cn$/.test(u.hostname))return 'https://www.zcool.com.cn/work/'+encodeURIComponent(id)+'.html';
    if(id&&/(^|\.)cool-de\.com$/.test(u.hostname))return 'https://www.cool-de.com/forum.php?mod=viewthread&tid='+encodeURIComponent(id);
    return /^https?:$/.test(u.protocol)?u.href:null;
  }catch{return null;}
}
export function describePixels(pixels,width,height) {
  const rgb=Array.from(pixels).filter((_,i)=>i%4!==3);
  const gray=Array.from({length:256},(_,i)=>rgb[i*3]*.299+rgb[i*3+1]*.587+rgb[i*3+2]*.114);
  const bits=[];for(let y=0;y<16;y++)for(let x=0;x<15;x++)bits.push(gray[y*16+x]>gray[y*16+x+1]?1:0);
  return {version:1,ratio:width/height,rgb,bits};
}
export async function fingerprint(bitmap) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=16;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,16,16);ctx.drawImage(bitmap,0,0,16,16);
  const fp=describePixels(ctx.getImageData(0,0,16,16).data,bitmap.width,bitmap.height);
  canvas.width=160;canvas.height=Math.max(1,Math.round(160/fp.ratio));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  fp.preview=canvas.toDataURL('image/jpeg',.65);return fp;
}
export function imageDistance(a,b) {
  if(!a||!b||a.version!==1||b.version!==1||a.rgb?.length!==768||b.rgb?.length!==768||a.bits?.length!==240||b.bits?.length!==240||Math.abs(a.ratio/b.ratio-1)>.025)return Infinity;
  // Require both local colour agreement and the same edge layout. Different views stay separate.
  const colour=a.rgb.reduce((sum,v,i)=>sum+Math.abs(v-b.rgb[i]),0)/768;
  const edges=a.bits.reduce((sum,v,i)=>sum+(v!==b.bits[i]?1:0),0)/240;
  return colour<=9&&edges<=.08?colour+edges*30:Infinity;
}
export function matchImages(incoming,previous) {
  const candidates=[];
  incoming.forEach((image,i)=>previous.forEach((old,j)=>{const distance=imageDistance(image.fp,old.fp);if(Number.isFinite(distance))candidates.push({i,j,distance});}));
  candidates.sort((a,b)=>a.distance-b.distance);const usedI=new Set(),usedJ=new Set(),pairs=[];
  for(const pair of candidates)if(!usedI.has(pair.i)&&!usedJ.has(pair.j)){usedI.add(pair.i);usedJ.add(pair.j);pairs.push(pair);}
  return pairs;
}
export function findCaseMatches(incoming,records) {
  return records.map(record=>{
    const pairs=matchImages(incoming.images,record.images||[]);
    const sameSource=!!incoming.source&&(record.sources||[]).includes(incoming.source);
    return {record,pairs,sameSource};
  }).filter(m=>m.sameSource||m.pairs.length>=2||m.pairs.length===1&&Math.min(incoming.images.length,m.record.images.length)===1)
    .sort((a,b)=>Number(b.sameSource)-Number(a.sameSource)||b.pairs.length-a.pairs.length);
}
const indexName='.interior-case-history.json';
const isImage=name=>/\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(name);
export async function refreshCaseRecord(directory,record,onProgress=()=>{}) {
  const handle=await directory.getDirectoryHandle(record.folder);
  const images=[];
  for await(const [name,fileHandle]of handle.entries()){
    if(fileHandle.kind!=='file'||!isImage(name))continue;
    const file=await fileHandle.getFile(),cached=(record.images||[]).find(i=>i.name===name&&i.size===file.size&&i.modified===file.lastModified);
    if(cached){images.push(cached);continue;}
    onProgress('正在检查原案例：'+record.folder+' / '+name);
    let bitmap;try{bitmap=await createImageBitmap(file);images.push({name,size:file.size,modified:file.lastModified,fp:await fingerprint(bitmap)});}finally{bitmap?.close();}
  }
  return {...record,images};
}
export async function readFolderHistory(directory,onProgress=()=>{},cachedRecords) {
  let records=cachedRecords;
  if(records===undefined){
    records=[];
    try {const file=await (await directory.getFileHandle(indexName)).getFile();const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.records))throw Error('历史索引格式不支持');records=data.records;}
    catch(e){if(e.name!=='NotFoundError')throw Error('无法读取案例历史：'+e.message);}
  }
  const current=[];
  for await(const [folder,handle]of directory.entries()){
    if(handle.kind!=='directory'||folder.startsWith('.'))continue;
    const record=records.find(r=>r.folder===folder)||{id:crypto.randomUUID(),folder,title:folder.replace(/^\d+-/,''),sources:[],sourceUrls:[],images:[],imported:true};
    const images=[];
    for await(const [name,fileHandle]of handle.entries()){
      if(fileHandle.kind!=='file'||!isImage(name))continue;
      const file=await fileHandle.getFile(),cached=record.images.find(i=>i.name===name&&i.size===file.size&&i.modified===file.lastModified);
      if(cached){images.push(cached);continue;}
      onProgress('正在建立旧案例图片索引：'+folder+' / '+name);
      let bitmap;try{bitmap=await createImageBitmap(file);images.push({name,size:file.size,modified:file.lastModified,fp:await fingerprint(bitmap)});}catch(e){throw Error('旧图片读取失败：'+folder+'/'+name+' · '+e.message);}finally{bitmap?.close();}
    }
    if(images.length)current.push({...record,images});
  }
  return current;
}
// Call only after the imported index has been durably saved inside the extension.
export async function removeLegacyFolderHistory(directory) {
  try {
    const file=await (await directory.getFileHandle(indexName)).getFile();
    const data=JSON.parse(await file.text());
    if(data.version!==1||!Array.isArray(data.records))throw Error('旧索引格式不支持');
    await directory.removeEntry(indexName);
  }catch(e){if(e.name!=='NotFoundError')throw e;}
}
