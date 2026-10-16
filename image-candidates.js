import {fetchImage,thumbnail} from './images.js';
import {isLargeImage} from './site-adapters.js';
import {fingerprint} from './case-history.js';
export async function prepareLargeImage(candidate,{fetch=fetchImage,makeThumbnail=thumbnail,describe=fingerprint,isStopped=()=>false}={}){
  const urls=[...new Set([candidate.url,...(candidate.urls||[])])].slice(0,8);
  let best,lastError,decoded=false,largestRejected={width:0,height:0};
  try{
    for(const url of urls){
      if(isStopped())break;let bitmap;
      try{
        ({bitmap}=await fetch(url));decoded=true;
        if(!isLargeImage(bitmap.width,bitmap.height)){if(bitmap.width*bitmap.height>largestRejected.width*largestRejected.height)largestRejected={width:bitmap.width,height:bitmap.height};continue;}
        if(!best||bitmap.width*bitmap.height>best.bitmap.width*best.bitmap.height){best?.bitmap.close();best={url,bitmap};bitmap=null;}
      }catch(error){lastError=error;}finally{bitmap?.close();}
    }
    if(!best)return decoded?{excluded:true,...largestRejected}:{error:lastError?.message||'图片读取已停止'};
    return {url:best.url,width:best.bitmap.width,height:best.bitmap.height,fp:await describe(best.bitmap),thumb:await makeThumbnail(best.bitmap)};
  }catch(error){return {error:error.message};}finally{best?.bitmap.close();}
}
