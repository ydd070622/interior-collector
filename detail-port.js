let manager,heartbeat;
function connect(api) {
  if(manager)return manager;
  const port=api.runtime.connect({name:'album-detail-tabs'});manager=port;
  function reset(){if(manager===port){manager=null;clearInterval(heartbeat);}}
  port.onDisconnect.addListener(reset);
  heartbeat=setInterval(()=>{try{port.postMessage({type:'ping'});}catch{reset();}},20000);
  return port;
}
export async function createDetailTab(url,api,windowId) {
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const port=connect(api);
      return await new Promise((resolve,reject)=>{
        const requestId=crypto.randomUUID();
        const timer=setTimeout(()=>{cleanup();reject(new Error('详情页启动超时'));},20000);
        function cleanup(){clearTimeout(timer);port.onMessage.removeListener(receive);port.onDisconnect.removeListener(disconnect);}
        function disconnect(){cleanup();reject(new Error('后台连接已断开'));}
        function receive(message){if(message.requestId!==requestId)return;cleanup();message.error?reject(new Error(message.error)):resolve(message.tab);}
        port.onMessage.addListener(receive);port.onDisconnect.addListener(disconnect);
        try{port.postMessage({type:'create',requestId,url,windowId});}catch(e){cleanup();if(manager===port)manager=null;clearInterval(heartbeat);reject(e);}
      });
    }catch(e){if(attempt===1||!/disconnect|断开/i.test(e.message))throw e;}
  }
}
export function releaseDetailTab(id){try{manager?.postMessage({type:'release',tabId:id});}catch{}}
