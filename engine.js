import {readCoolPage,readCoolAlbum,advanceCoolPage} from './cool-de.js';
import {readDesignPage,readDesignAlbum} from './design-sites.js';
import {readZcoolPage,readZcoolAlbum,collectZcoolAlbums} from './zcool.js';
import {api as chrome} from './background-api.js';
import {discoverListNotes} from './discover-notes.js';
import {collectListAlbums} from './list-albums.js';
import {readXhsPage,deduplicateImages} from './albums.js';
import {collectPageImages} from './page-collector.js';
import {getSiteAdapter} from './site-adapters.js';
import {prepareLargeImage} from './image-candidates.js';
import {readDouyinPage} from './douyin.js';
import {imageDistance,sourceIdentity} from './case-history.js';
import {loadDirectory,saveDirectory} from './files.js';
import {saveCases} from './case-download.js';
const $ = id => document.getElementById(id);
let sourceTab, noteLimit=null, imageMode='interior',collectionScope='smart',regionSelector=null;
let directory, worker, active = false, saving = false, stopped = false;
let items = [], workerId = 0;
let workerReady;
let downloadComplete=false;
let casePrompt=null,caseDecision=null;
function decideCase(prompt) {
  casePrompt={...prompt,token:crypto.randomUUID()};
  status('发现可能重复的案例，请选择合并、单独保存或跳过');
  publish();
  return new Promise(resolve=>{caseDecision=resolve;});
}
const pending = new Map();
function status(text) { $('status').textContent = text; }
function log(text) { const li = document.createElement('li'); li.textContent = text; $('logs').append(li); }
function count() { $('count').textContent = `${items.length} 张${imageMode==='all'?'':'室内'}图片`; $('empty').hidden = items.length > 0; }
function controls() {
  $('rescan').disabled = active || saving; $('stop').disabled = !active;
  $('download').disabled = active || saving || !items.length;
  $('folder').disabled = saving; $('format').disabled = saving; $('quality').disabled = saving;
  document.querySelectorAll('.card button').forEach(b => b.disabled = active || saving);
}
function failWorker(error) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); }
function startWorker() {
  if(worker)return;
  failWorker(new Error('识别已停止'));
  worker = new Worker('classifier.js',{type:'module'});
  let readyResolve, readyReject;
  workerReady = new Promise((resolve,reject) => { readyResolve = resolve; readyReject = reject; });
  workerReady.catch(()=>{});
  const readyTimeout = setTimeout(()=>readyReject(new Error('识别组件启动超时，请重新加载插件')),30000);
  worker.onerror = e => { clearTimeout(readyTimeout); const error = new Error(e.message || '本地模型无法启动'); readyReject(error); failWorker(error); };
  worker.onmessage = ({data}) => {
    if (data.type === 'ready') { clearTimeout(readyTimeout); readyResolve(); return; }
    if (data.type === 'progress') {
      const p = data.progress;
      if (p.status === 'stage') status(p.text);
      if (p.status === 'progress') status(`加载本地模型 ${p.file || ''} ${Math.round(p.progress || 0)}%`);
      return;
    }
    const job = pending.get(data.id); if (!job) return;
    clearTimeout(job.timer); pending.delete(data.id);
    if (data.type === 'error') job.reject(new Error(data.error)); else job.resolve(data);
  };
}
async function classify(blob) {
  await workerReady;
  return new Promise((resolve,reject) => {
    const id = ++workerId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('模型识别超时，请检查网络或重新扫描')); },600000);
    pending.set(id,{resolve,reject,timer}); worker.postMessage({id,blob});
  });
}
function addCard(item) {
  const card = document.createElement('article'); card.className = 'card';
  const image = document.createElement('img'); image.src = item.preview; image.alt = item.label || '室内设计图片';
  const info = document.createElement('div'); info.className = 'info';
  const title = document.createElement('strong'); title.textContent = item.label || `室内灵感 ${String(items.length).padStart(3,'0')}`;
  const meta = document.createElement('small'); meta.textContent = `${item.width} × ${item.height}${item.confidence==null?' · 不限题材':' · 室内匹配 '+Math.round(item.confidence*100)+'%'}`;
  const button = document.createElement('button'); button.textContent = '下载图片'; button.disabled = active;
  button.onclick = () => download([item]);
  info.append(title,meta,button); card.append(image,info); $('grid').append(card); count();
}
async function scan() {
  if (active || saving) return;
  active = true; stopped = false; downloadComplete=false; controls();
  for (const item of items) URL.revokeObjectURL(item.preview);
  items = []; $('grid').replaceChildren(); $('logs').replaceChildren(); count();
  $('progress').value = 0; if(imageMode==='interior')startWorker();
  let rejected=0,smallImages=0,nonInterior=0,duplicates=0,failures=0,frameFailures=0;
  const batchFingerprints=[];
  try {
    const tab = await chrome.tabs.get(sourceTab);
    const adapter=getSiteAdapter(tab.url);
    if (!/^https?:/i.test(tab.url || '')) throw new Error('请在普通 HTTP/HTTPS 网页点击插件，浏览器内部页与商店页面无法采集');
    $('source').textContent = `${tab.title || ''} · ${new URL(tab.url).hostname}`;
    status('正在读取页面图片…');
    let pageImages=[];
    let albumMessage = '';
    let albumFailed = false;
    if (collectionScope==='smart'&&adapter.id==='xiaohongshu') {
      try {
        const [result] = await chrome.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readXhsPage});
        const album = result.result;
        if (album?.detailId) {
          if (album.images.length) {
            pageImages = album.images;
            log('当前笔记：取得 ' + album.images.length + ' 张图集图片。');
          } else {
            pageImages = [];
            albumMessage = '未取得当前笔记的完整图集，请检查登录状态或网页验证提示。';
          }
        } else if (album?.notes?.length || album?.videoNoteIds?.length) {
          // List covers are deliberately excluded: only confirmed detail albums enter classification.
          pageImages = [];
          const discovered = await discoverListNotes({sourceTab,maxNotes:noteLimit,initial:album,isStopped:()=>stopped,onProgress:status});
          log('自动加载：已发现 ' + discovered.notes.length + ' 篇；' + discovered.reason);
          const result = await collectListAlbums({sourceTab,maxNotes:noteLimit,loadMore:async excludeIds=>(await discoverListNotes({sourceTab,maxNotes:noteLimit,excludeIds,initial:album,isStopped:()=>stopped,onProgress:status})).notes,notes:discovered.notes,isStopped:()=>stopped,onProgress:status,onLog:log});
          pageImages = result.images;
          if(!result.success && result.failures && !stopped) {
            albumFailed = true;
            const reason=result.failureReasons?.[0] || '详情页未提供图集';
            albumMessage='图集读取失败：'+reason+'。展开采集记录查看每篇原因。';
            $('logs').closest('details').open=true;
          }
          if(!albumFailed) albumMessage = '列表图集：已发现 ' + result.total + ' 篇，成功 ' + result.success + ' 篇，失败 ' + result.failures + ' 篇，详情中跳过视频 ' + result.skippedVideos + ' 篇（不占图文篇数）' + (result.stopped ? '（已停止）' : '') + '。已自动滚动加载；此数量不是账号笔记总数。';
          log(albumMessage);
        } else {
          pageImages = [];
          albumMessage = '没有找到可访问的笔记链接。请等待列表加载完成后重新扫描。';
        }
      } catch(e) { pageImages = []; albumMessage = '图集读取失败，请查看采集记录。'; log(albumMessage + ' ' + e.message); }
    }
    if (collectionScope==='smart'&&adapter.id==='zcool') {
      pageImages=[];
      try {
        const [page]=await chrome.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readZcoolPage});const data=page.result;
        if(data?.detailId){const result=await readZcoolAlbum({id:data.detailId,href:tab.url,windowId:tab.windowId},()=>stopped);pageImages=result.images||[];albumMessage=result.video?'已跳过视频作品':'当前作品：取得 '+pageImages.length+' 张正文图片';}
        else if(data){const discover=excludeIds=>discoverListNotes({sourceTab,maxNotes:noteLimit,excludeIds,readPage:readZcoolPage,initial:data,isStopped:()=>stopped,onProgress:status});const found=await discover([]);const result=await collectZcoolAlbums({sourceTab,notes:found.notes,maxNotes:noteLimit,isStopped:()=>stopped,onProgress:status,onLog:log,loadMore:async ids=>(await discover(ids)).notes});pageImages=result.images;albumMessage='作品图集：成功 '+result.success+' 篇，失败 '+result.failures+' 篇，跳过视频 '+result.skippedVideos+' 篇';}
        log(albumMessage);
      }catch(e){albumFailed=true;albumMessage='作品图集读取失败：'+e.message;log(albumMessage);}
    }
    if(collectionScope!=='smart'||!adapter.album){
      pageImages=[];
      if(collectionScope==='smart'&&adapter.id==='generic')try{const [r]=await chrome.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readDesignPage});const data=r.result;
        if(data?.detailId){const detail=await readDesignAlbum({id:data.detailId,href:tab.url,windowId:tab.windowId},()=>stopped);pageImages=detail.images||[];}
        else if(data?.notes?.length){const discover=excludeIds=>discoverListNotes({sourceTab,maxNotes:noteLimit,excludeIds,readPage:readDesignPage,initial:data,isStopped:()=>stopped,onProgress:status});const found=await discover([]);const result=await collectZcoolAlbums({sourceTab,notes:found.notes,maxNotes:noteLimit,read:readDesignAlbum,isStopped:()=>stopped,onProgress:status,onLog:log,loadMore:async ids=>(await discover(ids)).notes});pageImages=result.images;}
        if(!pageImages.length)log('未发现完整案例图集，尝试通用大图提取');
      }catch(e){albumMessage='案例图集读取失败：'+e.message;log(albumMessage);}
      if(!pageImages.length&&!stopped){
        const result=await collectPageImages({api:chrome,tabId:sourceTab,scope:collectionScope,selector:regionSelector,adapter,isStopped:()=>stopped,onProgress:status});
        pageImages=result.images;frameFailures+=result.frameFailures;
        albumMessage=result.scopeFound?adapter.label+' · 正文区域 · 仅保留实际解码后的大图':'未找到明确正文，请打开具体文章、商品或图集详情后重试';
        log(albumMessage);
      }
    }
    if(collectionScope==='smart'&&adapter.id==='cool-de'){
      pageImages=[];
      try{const [r]=await chrome.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readCoolPage});const data=r.result;
        if(data?.detailId){const result=await readCoolAlbum({id:data.detailId,href:new URL('/thread-'+data.detailId+'-1-1.html',tab.url).href,windowId:tab.windowId},()=>stopped);pageImages=result.images||[];}
        else if(data){const discover=excludeIds=>discoverListNotes({sourceTab,maxNotes:noteLimit,excludeIds,readPage:readCoolPage,advancePage:advanceCoolPage,initial:data,isStopped:()=>stopped,onProgress:status});const found=await discover([]);log('联盟案例：已发现 '+found.notes.length+' 篇；'+found.reason);const result=await collectZcoolAlbums({sourceTab,notes:found.notes,maxNotes:noteLimit,read:readCoolAlbum,isStopped:()=>stopped,onProgress:status,onLog:log,loadMore:async ids=>(await discover(ids)).notes});pageImages=result.images;albumMessage='联盟案例：成功 '+result.success+' 篇，失败 '+result.failures+' 篇，跳过视频 '+result.skippedVideos+' 篇';}
        if(!pageImages.length)albumMessage=albumMessage||'没有取得案例首帖正文图片，请检查登录或访问提示';log(albumMessage);
      }catch(e){albumFailed=true;albumMessage='联盟案例读取失败：'+e.message;log(albumMessage);}
    }
    if(adapter.id==='douyin'){
      const [result]=await chrome.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readDouyinPage});
      pageImages=result.result?.images||[];albumMessage=pageImages.length?'抖音当前正文图集：'+pageImages.length+' 张':'未取得当前抖音正文图集，请打开具体图文作品后重试';log(albumMessage);
    }
    const candidates = deduplicateImages(pageImages);
    $('progress').max = Math.max(1,candidates.length);
    log(`发现 ${candidates.length} 个去重后的候选；小图标和 SVG 已预先排除。`);
    const prepared=new Map();
    function prefetch(index) {
      if(index>=candidates.length)return;
      prepared.set(index,(async()=>{
        return prepareLargeImage(candidates[index],{isStopped:()=>stopped});
      })());
    }
    for(let index=0;index<Math.min(3,candidates.length);index++)prefetch(index);
    for (let i = 0; i < candidates.length && !stopped; i++) {
      const item = candidates[i];
      status(`${imageMode==='all'?'提取图片':'自动识别'} ${i+1} / ${candidates.length} · 已保留 ${items.length} 张`);
      const image=await prepared.get(i);prepared.delete(i);if(!stopped)prefetch(i+3);
      $('progress').value=i+1;
      if(image.error){failures++;log('图片读取失败：'+item.url+' · '+image.error);continue;}
      if(image.excluded){rejected++;smallImages++;log('尺寸不足：'+(item.label||item.url)+' · 实际最大 '+image.width+' × '+image.height);continue;}
      const group=sourceIdentity(item)||item.page;
      const duplicate=batchFingerprints.find(entry=>entry.group===group&&imageDistance(entry.fp,image.fp)<=2);
      if(duplicate){
        duplicates++;const previous=items[duplicate.index];
        if(image.width*image.height>previous.width*previous.height){
          URL.revokeObjectURL(previous.preview);Object.assign(previous,{url:image.url,width:image.width,height:image.height,preview:URL.createObjectURL(image.thumb)});duplicate.fp=image.fp;
          const card=$('grid').children[duplicate.index];card.querySelector('img').src=previous.preview;card.querySelector('small').textContent=previous.width+' × '+previous.height+(previous.confidence==null?' · 不限题材':' · 室内匹配 '+Math.round(previous.confidence*100)+'%');
        }
        log('同次采集重复，保留较大版本：'+(item.label||item.url));continue;
      }
      const {thumb}=image;item.url=image.url;item.width=image.width;item.height=image.height;
      if (stopped) break;
      // A model error stops the scan; never substitute URL keywords for visual classification.
      const result = imageMode==='all'?{keep:true,confidence:null}:await classify(thumb);
      if (stopped) break;
      if (!result.keep) { rejected++;nonInterior++;log('分类排除：'+(item.label||item.url)+' · '+image.width+' × '+image.height+' · 室内匹配 '+Math.round(result.confidence*100)+'% · '+(result.label||''));continue; }
      batchFingerprints.push({fp:image.fp,group,index:items.length});
      Object.assign(item,{confidence:result.confidence,preview:URL.createObjectURL(thumb)});
      items.push(item); addCard(item);
    }
    status(`${stopped ? '已停止' : imageMode==='all'?'提取完成':'识别完成'} · 保留 ${items.length} 张 · 尺寸不足 ${smallImages} 张 · 非室内 ${nonInterior} 张 · 重复 ${duplicates} 张 · 读取失败 ${failures} 张${frameFailures ? ' · 部分框架未扫描' : ''}`);
    if(albumFailed) status('图集读取失败 · 尚未进入图片识别');
    $('notice').textContent = albumMessage || (imageMode==='all'?'不限图片题材，保留去重和尺寸过滤。':'默认仅显示本地模型认定的室内图片。匹配分数是类别间的相对分数，可能存在误判或漏选。未加载图片请滚动原网页后重新扫描。');
  } catch(e) {
    if (!stopped) { status(`采集未完成：${e.message}`); log(e.message); $('notice').textContent = /模型|识别组件|worker/i.test(e.message)?'请确认 models 与 vendor 文件夹完整，然后重新加载插件。已完成识别的图片仍可下载。':'请检查网页加载与登录状态，或重新选择采集区域。已完成识别的图片仍可下载。'; }
  } finally { active = false; controls(); }
}
async function browserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  let id, settled = false;
  return new Promise(async (resolve,reject) => {
    let timer;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(changed); URL.revokeObjectURL(url);
      error ? reject(error) : resolve({id});
    };
    const changed = delta => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      if (delta.state?.current === 'interrupted') finish(new Error(`下载中断：${delta.error?.current || '请查看 Chrome 下载记录'}`));
    };
    chrome.downloads.onChanged.addListener(changed);
    timer = setTimeout(() => finish(new Error('下载等待超时，请查看 Chrome 下载记录')),120000);
    try {
      id = await chrome.downloads.download({url,filename:`室内灵感/${filename}`,saveAs:false,conflictAction:'uniquify'});
      const [download] = await chrome.downloads.search({id});
      if (download?.state === 'complete') finish();
      if (download?.state === 'interrupted') finish(new Error('下载被中断'));
    } catch(e) { finish(e); }
  });
}
async function download(selected) {
  if (saving || active) return;
  // Called immediately from the click handler so directory permission has a user gesture.
  const permission = directory ? directory.queryPermission({mode:'readwrite'}) : Promise.resolve('granted');
  saving = true; downloadComplete=false; controls();
  const format = $('format').value, quality = Number($('quality').value);
  const destination = directory;
  try {
    if (await permission !== 'granted') throw new Error('未获得文件夹写入授权，请重新选择保存文件夹');
    const result=await saveCases({selected,destination,downloads:chrome.downloads,format,quality,browserDownload,decide:decideCase,status,log});
    downloadComplete=result.failures===0&&result.success>0&&selected.length===items.filter(item=>!item.excluded).length;
    status(`保存完成 · 新增 ${result.success-result.upgraded} 张 · 高清升级 ${result.upgraded} 张 · 跳过 ${result.skipped} 张 · 失败 ${result.failures} 张`);
  } catch(e) { status(e.message); log(e.message); }
  finally { saving = false; controls(); publish(); }
}
$('folder').onclick = async () => {
  try {
    const picked = await showDirectoryPicker({id:'interior-collector',mode:'readwrite'});
    await saveDirectory(picked); directory = picked;
    $('folderName').textContent = `已授权文件夹：${picked.name}（图片直接保存到此目录）`;
  } catch(e) { if(e.name !== 'AbortError') status(`选择文件夹失败：${e.message}`); }
};
$('rescan').onclick = scan;
$('download').onclick = () => download([...items]);
$('stop').onclick = () => { stopped = true; worker?.terminate(); worker=null; failWorker(new Error('识别已停止')); status('正在停止…'); };
for (const name of ['format','quality']) $(name).onchange = () => chrome.storage.local.set({[name]:$(name).value});
async function initialize() {
  try {
    const explicitTab = new URLSearchParams(location.search).get('tab');
    if (explicitTab !== null) sourceTab = Number(explicitTab);
    else {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      sourceTab = tab?.id;
    }
    const settings = await chrome.storage.local.get(['format','quality']);
    if (settings.format) $('format').value = settings.format;
    if (settings.quality) $('quality').value = settings.quality;
    directory = await loadDirectory();
    if (directory) $('folderName').textContent = `记住的文件夹：${directory.name}（下载时确认写入授权）`;
  } catch(e) { log(`读取设置失败：${e.message}`); }
}


let hasStarted=false,broadcastTimer;
function snapshot() {
  return {sourceTab,imageMode,collectionScope,hasStarted,active,saving,downloadComplete,items,casePrompt,status:$('status').textContent,source:$('source').textContent,notice:$('notice').textContent,progress:$('progress').value,max:$('progress').max,logs:[...$('logs').children].slice(-500).map(li=>li.textContent),detailsOpen:$('logs').closest('details').open};
}
function publish() {
  if(broadcastTimer)return;
  broadcastTimer=setTimeout(()=>{broadcastTimer=null;chrome.runtime.sendMessage({type:'JOB_UPDATE',state:snapshot()}).catch(()=>{});},120);
}
const observer=new MutationObserver(publish);
observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='ENGINE_COMMAND')return;
  (async()=>{
    await engineInitialized;
    const payload=message.payload||{};
    if(message.command==='scan'&&!active&&!saving){
      collectionScope='smart';regionSelector=null;
    }
    if(message.command==='case-decision'){
      if(!casePrompt||payload.token!==casePrompt.token)throw new Error('提示已过期，请重新查看');
      if(!['skip','separate','merge'].includes(payload.action))throw new Error('未知的案例操作');
      if(payload.action==='merge'&&!casePrompt.matches.some(m=>m.id===payload.targetId&&m.canMerge))throw new Error('找不到合并目标');
      const resolve=caseDecision;casePrompt=null;caseDecision=null;resolve(payload);publish();
    }
    if(message.command==='scan' && !active && !saving){if(payload.noteLimit!=null&&(!Number.isSafeInteger(payload.noteLimit)||payload.noteLimit<1))throw new Error('采集篇数必须为正整数');sourceTab=payload.sourceTab;noteLimit=payload.noteLimit??null;imageMode=payload.imageMode==='all'?'all':'interior';hasStarted=true;scan();}
    else if(message.command==='stop')$('stop').onclick();
    else if(message.command==='exclude' && !active && !saving){
      if(!Number.isInteger(payload.index)||!items[payload.index])throw new Error('图片已变化，请重新选择');
      items[payload.index].excluded=payload.excluded===true;downloadComplete=false;publish();
    }
    else if(message.command==='download' && !active && !saving){
      directory=await loadDirectory();
      $('format').value=payload.format||'png';$('quality').value=String(payload.quality||1);
      const selected=(payload.index===undefined?[...items]:items[payload.index]?[items[payload.index]]:[]).filter(item=>!item.excluded);
      if(selected.length)download(selected);
    }
    return {state:snapshot()};
  })().then(respond,error=>respond({error:error.message}));return true;
});
const engineInitialized=initialize();
