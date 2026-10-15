import {resolveCurrentPage} from './current-page.js';
import {openLibraryWindow,isExtensionWindow} from './library-window.js';
import {readCoolPage,scrollCoolDetail,advanceCoolPage} from './cool-de.js';
import {readDesignPage,scrollDesignDetail} from './design-sites.js';
import {advanceListPage} from './discover-notes.js';
import {readZcoolPage,scrollZcoolDetail} from './zcool.js';
import {scanPage} from './scan.js';
import {readXhsPage} from './albums.js';
import {moveNoteList} from './discover-notes.js';
import {fetchXhsNoteHtml} from './list-albums.js';
// Clean up extension-owned detail tabs even when the toolbar popup closes.
chrome.runtime.onConnect.addListener(port => {
  if(port.name!=='album-detail-tabs')return;
  const owned=new Set();let closed=false;
  port.onDisconnect.addListener(()=>{closed=true;for(const id of owned)chrome.tabs.remove(id).catch(()=>{});owned.clear();});
  port.onMessage.addListener(async message=>{
    if(message.type==='ping'){try{port.postMessage({type:'pong'});}catch{}return;}
    if(message.type==='release'){owned.delete(message.tabId);return;}
    if(message.type!=='create')return;
    try{
      const url=new URL(message.url);
      if(!/^https?:$/.test(url.protocol))throw new Error('不支持的笔记链接');
      const tab=await chrome.tabs.create({url:url.href,active:false,...(Number.isInteger(message.windowId)?{windowId:message.windowId}:{})});
      if(closed){await chrome.tabs.remove(tab.id).catch(()=>{});return;}
      owned.add(tab.id);port.postMessage({requestId:message.requestId,tab});
    }catch(e){if(!closed)port.postMessage({requestId:message.requestId,error:e.message});}
  });
});

let engineCreating;
let libraryOpening;
chrome.windows.onFocusChanged.addListener(async id=>{
  if(id===chrome.windows.WINDOW_ID_NONE)return;
  try {
    const window=await chrome.windows.get(id,{populate:true});
    // The collection window and the material library must never replace the page being collected.
    if(window.type!=='normal'||await isExtensionWindow(chrome,id))return;
    await chrome.storage.session.set({sourceWindowId:id});
  } catch {}
});
async function ensureEngine() {
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('engine.html')]});
  if(contexts.length)return;
  if(!engineCreating)engineCreating=chrome.offscreen.createDocument({url:'engine.html',reasons:['WORKERS','BLOBS'],justification:'Keep local image classification and conversion running when the toolbar popup closes.'}).finally(()=>engineCreating=null);
  await engineCreating;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='OPEN_LIBRARY'){
    libraryOpening ||= openLibraryWindow(chrome).finally(()=>{libraryOpening=null;});
    libraryOpening.then(()=>respond({ok:true}),error=>respond({error:error.message}));return true;
  }
  if(message.type==='CURRENT_SOURCE') {
    (async()=>{
      const {sourceWindowId}=await chrome.storage.session.get('sourceWindowId');
      return {tab:await resolveCurrentPage(chrome,sourceWindowId)};
    })().then(respond,error=>respond({error:error.message}));return true;
  }
  if(message.type==='JOB') {
    (async()=>{
      await ensureEngine();
      for(let i=0;i<30;i++){
        try{return await chrome.runtime.sendMessage({type:'ENGINE_COMMAND',command:message.command,payload:message.payload});}
        catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,100));}
      }
    })().then(respond,e=>respond({error:e.message}));return true;
  }
  if(message.type==='ENGINE_API') {
    const functions={scanPage,readXhsPage,moveNoteList,fetchXhsNoteHtml,readZcoolPage,scrollZcoolDetail,readDesignPage,scrollDesignDetail,advanceListPage,readCoolPage,scrollCoolDetail,advanceCoolPage};
    (async()=>{
      const args=message.args||[];
      switch(message.operation){
        case 'tabs.update':return chrome.tabs.update(...args);
        case 'tabs.get':return chrome.tabs.get(...args);
        case 'tabs.query':return chrome.tabs.query(...args);
        case 'tabs.remove':return chrome.tabs.remove(...args);
        case 'storage.get':return chrome.storage.local.get(...args);
        case 'storage.set':return chrome.storage.local.set(...args);
        case 'downloads.download':return chrome.downloads.download(...args);
        case 'downloads.search':return chrome.downloads.search(...args);
        case 'scripting.executeScript':{
          const options=args[0],func=functions[options.funcName];
          if(!func)throw new Error('Unsupported page operation');
          return chrome.scripting.executeScript({target:options.target,world:options.world,func,...(options.args?{args:options.args}:{})});
        }
        default:throw new Error('Unsupported browser operation');
      }
    })().then(result=>respond({result}),error=>respond({error:error.message}));return true;
  }
});
chrome.downloads.onChanged.addListener(delta=>chrome.runtime.sendMessage({type:'ENGINE_DOWNLOAD_EVENT',delta}).catch(()=>{}));

// Open a persistent native window instead of an auto-dismiss toolbar popup.
function collectorWindowBounds(source) {
 const width=Math.min(470,Math.max(350,(source.width||1280)-32));
 const height=Math.min(610,Math.max(320,(source.height||800)-104));
 return {width,height,left:Math.round((source.left||0)+Math.max(8,(source.width||1280)-width-160)),top:Math.round((source.top||0)+Math.min(88,Math.max(8,(source.height||800)-height-8)))};
}
let collectorOpening;
chrome.action.onClicked.addListener(tab=>{
 if(collectorOpening)return;
 collectorOpening=(async()=>{
  await chrome.storage.session.set({sourceWindowId:tab.windowId});
  const base=chrome.runtime.getURL('collector.html');
  const url=base+'?tab='+tab.id;
  const windows=await chrome.windows.getAll({populate:true,windowTypes:['popup']});
  const existing=windows.find(w=>w.tabs?.some(t=>t.url?.startsWith(base)));
  if(existing){const ui=existing.tabs.find(t=>t.url?.startsWith(base));
   if(ui.url!==url)await chrome.tabs.update(ui.id,{url});
   await chrome.windows.update(existing.id,{focused:true});return;
  }
  const source=await chrome.windows.get(tab.windowId);
  await chrome.windows.create({url,type:'popup',...collectorWindowBounds(source),focused:true});
 })().catch(error=>console.error('无法打开采集窗口：',error)).finally(()=>collectorOpening=null);
});
