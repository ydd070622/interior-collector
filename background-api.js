// Offscreen documents expose runtime only. Privileged browser operations are routed to the service worker.
const downloadListeners=new Set();
globalThis.chrome?.runtime?.onMessage.addListener(message=>{
  if(message.type==='ENGINE_DOWNLOAD_EVENT')for(const listener of downloadListeners)listener(message.delta);
});
async function rpc(operation,args) {
  const response=await globalThis.chrome.runtime.sendMessage({type:'ENGINE_API',operation,args});
  if(response?.error)throw new Error(response.error);
  return response?.result;
}
export const api={
  get runtime(){return globalThis.chrome.runtime;},
  tabs:{update:(id,options)=>rpc('tabs.update',[id,options]),get:id=>rpc('tabs.get',[id]),query:q=>rpc('tabs.query',[q]),remove:id=>rpc('tabs.remove',[id])},
  scripting:{executeScript:options=>rpc('scripting.executeScript',[{target:options.target,world:options.world,funcName:options.func.name,args:options.args}])},
  storage:{local:{get:keys=>rpc('storage.get',[keys]),set:values=>rpc('storage.set',[values])}},
  downloads:{download:options=>rpc('downloads.download',[options]),search:query=>rpc('downloads.search',[query]),onChanged:{addListener:f=>downloadListeners.add(f),removeListener:f=>downloadListeners.delete(f)}}
};
