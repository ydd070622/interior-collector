import {scanPage,scrollImagePage} from './scan.js';
export async function collectPageImages({api,tabId,scope='smart',selector,adapter,isStopped=()=>false,onProgress=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),rounds=20}){
  const images=new Map();let initial,stable=0,scopeFound=false,frameFailures=0;
  const scan=async()=>{
    const options={scope,selector,site:adapter?.id};let frames;
    try{frames=await api.scripting.executeScript({target:{tabId,allFrames:scope!=='region'},func:scanPage,args:[options]});}
    catch(error){if(scope==='region')throw error;frameFailures++;frames=await api.scripting.executeScript({target:{tabId},func:scanPage,args:[options]});}
    for(const frame of frames){scopeFound||=!!frame.result?.scopeFound;for(const image of frame.result?.images||[]){
      const key=image.url,old=images.get(key);
      if(old)old.urls=[...new Set([...(old.urls||[old.url]),...(image.urls||[image.url])])];else images.set(key,image);
    }}
  };
  try{
    [initial]=await api.scripting.executeScript({target:{tabId},func:scrollImagePage,args:['position']});
    await scan();
    for(let round=0;round<rounds&&!isStopped();round++){
      const before=images.size;
      await api.scripting.executeScript({target:{tabId},func:scrollImagePage,args:['next']});
      await wait(450);if(isStopped())break;await scan();
      stable=images.size===before?stable+1:0;
      onProgress('正在加载页面图片 · 已找到 '+images.size+' 个候选');
      if(stable>=4||images.size>=2000)break;
    }
    return {images:[...images.values()],scopeFound,frameFailures};
  }finally{
    if(initial?.result)await api.scripting.executeScript({target:{tabId},func:scrollImagePage,args:['restore',initial.result]}).catch(()=>{});
  }
}
