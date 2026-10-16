import {uniqueFile} from './files.js';

export function canUpgradeImage(incoming,previous) {
  const a=incoming?.fp,b=previous?.fp;
  return !!(a&&b&&/\.(png|jpe?g)$/i.test(previous.name)&&
    a.width>b.width*1.1&&a.height>b.height*1.1&&a.width*a.height>b.width*b.height*1.25);
}
// Reject common nearest/bilinear/bicubic enlargements of the same low-resolution pixels.
export function hasAdditionalDetail(bitmap,previous) {
  const sample=document.createElement('canvas');sample.width=sample.height=192;
  const ctx=sample.getContext('2d',{willReadFrequently:true});
  const enlarged=document.createElement('canvas');enlarged.width=bitmap.width;enlarged.height=bitmap.height;
  const up=enlarged.getContext('2d');
  const patches=[[.15,.15],[.5,.2],[.85,.2],[.2,.5],[.5,.5],[.8,.5],[.15,.85],[.5,.8],[.85,.85]];
  for(const quality of ['nearest','low','medium','high']){
    up.imageSmoothingEnabled=quality!=='nearest';up.imageSmoothingQuality=quality==='nearest'?'low':quality;
    up.drawImage(previous,0,0,bitmap.width,bitmap.height);let error=0,count=0;
    for(const [px,py]of patches){
      const size=Math.min(192,bitmap.width,bitmap.height),x=Math.round((bitmap.width-size)*px),y=Math.round((bitmap.height-size)*py);
      ctx.drawImage(bitmap,x,y,size,size,0,0,192,192);const a=ctx.getImageData(0,0,192,192).data;
      ctx.drawImage(enlarged,x,y,size,size,0,0,192,192);const b=ctx.getImageData(0,0,192,192).data;
      for(let i=0;i<a.length;i++)if(i%4!==3){error+=Math.abs(a[i]-b[i]);count++;}
    }
    if(error/count<1.5)return false;
  }
  return true;
}
async function write(file,blob){
  const stream=await file.createWritable();
  try{await stream.write(blob);await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}
}
export async function replaceWithBackup(directory,previous,blob) {
  const file=await directory.getFileHandle(previous.name),old=await file.getFile();
  if(old.size!==previous.size||old.lastModified!==previous.modified)throw Error('原图片已变化，请重新下载并核对后再升级');
  const backupDirectory=await directory.getDirectoryHandle('.interior-backups',{create:true});
  const backup=await uniqueFile(backupDirectory,Date.now()+'-'+crypto.randomUUID()+'-'+previous.name);
  await write(backup,old);
  const backed=await backup.getFile();if(backed.size!==old.size)throw Error('原图备份校验失败，已停止替换');
  await write(file,blob);
  const saved=await file.getFile();
  return {size:saved.size,modified:saved.lastModified,backup:'.interior-backups/'+backup.name};
}
