import {imageSavePath} from './note-paths.js';
import {discoverListNotes} from './discover-notes.js';
import {collectListAlbums} from './list-albums.js';
import {readXhsPage} from './albums.js';
import {scanPage} from './scan.js';
import {loadDirectory,saveDirectory,uniqueFile} from './files.js';
import {fetchImage,convertImage,thumbnail} from './images.js';
const $ = id => document.getElementById(id);
let sourceTab;
let directory, worker, active = false, saving = false, stopped = false;
let items = [], workerId = 0;
let workerReady;
const pending = new Map();
function status(text) { $('status').textContent = text; }
function log(text) { const li = document.createElement('li'); li.textContent = text; $('logs').append(li); }
function count() { $('count').textContent = `${items.length} 张室内图片`; $('empty').hidden = items.length > 0; }
function controls() {
  $('rescan').disabled = active || saving; $('stop').disabled = !active;
  $('download').disabled = active || saving || !items.length;
  $('folder').disabled = saving; $('format').disabled = saving; $('quality').disabled = saving;
  document.querySelectorAll('.card button').forEach(b => b.disabled = active || saving);
}
function failWorker(error) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); }
function startWorker() {
  worker?.terminate(); failWorker(new Error('识别已停止'));
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
  const meta = document.createElement('small'); meta.textContent = `${item.width} × ${item.height} · 室内匹配 ${Math.round(item.confidence*100)}%`;
  const button = document.createElement('button'); button.textContent = '下载图片'; button.disabled = active;
  button.onclick = () => download([item]);
  info.append(title,meta,button); card.append(image,info); $('grid').append(card); count();
}
async function scan() {
  if (active || saving) return;
  active = true; stopped = false; controls();
  for (const item of items) URL.revokeObjectURL(item.preview);
  items = []; $('grid').replaceChildren(); $('logs').replaceChildren(); count();
  $('progress').value = 0; startWorker();
  let rejected = 0, failures = 0, frameFailures = 0;
  try {
    const tab = await chrome.tabs.get(sourceTab);
    if (!/^https?:/i.test(tab.url || '')) throw new Error('请在普通 HTTP/HTTPS 网页点击插件，浏览器内部页与商店页面无法采集');
    $('source').textContent = `${tab.title || ''} · ${new URL(tab.url).hostname}`;
    status('正在扫描图片与网页背景…');
    let frames;
    try { frames = await chrome.scripting.executeScript({target:{tabId:sourceTab,allFrames:true},func:scanPage}); }
    catch (e) {
      frameFailures++; log(`部分嵌入页面不可访问，仅扫描主页面：${e.message}`);
      frames = await chrome.scripting.executeScript({target:{tabId:sourceTab},func:scanPage});
    }
    let pageImages = frames.flatMap(f => f.result?.images || []);
    let albumMessage = '';
    let albumFailed = false;
    if (/(^|\.)xiaohongshu\.com$/i.test(new URL(tab.url).hostname)) {
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
        } else if (album?.notes?.length) {
          // List covers are deliberately excluded: only confirmed detail albums enter classification.
          pageImages = [];
          const discovered = await discoverListNotes({sourceTab,initial:album,isStopped:()=>stopped,onProgress:status});
          log('自动加载：已发现 ' + discovered.notes.length + ' 篇；' + discovered.reason);
          const result = await collectListAlbums({sourceTab,notes:discovered.notes,isStopped:()=>stopped,onProgress:status,onLog:log});
          pageImages = result.images;
          if(!result.success && result.failures && !stopped) {
            albumFailed = true;
            const reason=result.failureReasons?.[0] || '详情页未提供图集';
            albumMessage='图集读取失败：'+reason+'。展开采集记录查看每篇原因。';
            $('logs').closest('details').open=true;
          }
          if(!albumFailed) albumMessage = '列表图集：已发现 ' + result.total + ' 篇，成功 ' + result.success + ' 篇，失败 ' + result.failures + ' 篇' + (result.stopped ? '（已停止）' : '') + '。已自动滚动加载；此数量不是账号笔记总数。';
          log(albumMessage);
        } else {
          pageImages = [];
          albumMessage = '没有找到可访问的笔记链接。请等待列表加载完成后重新扫描。';
        }
      } catch(e) { pageImages = []; albumMessage = '图集读取失败，请查看采集记录。'; log(albumMessage + ' ' + e.message); }
    }
    const candidates = [...new Map(pageImages.map(i => [(i.noteId || '') + '|' + i.url,i])).values()];
    $('progress').max = Math.max(1,candidates.length);
    log(`发现 ${candidates.length} 个去重后的候选；小图标和 SVG 已预先排除。`);
    for (let i = 0; i < candidates.length && !stopped; i++) {
      const item = candidates[i];
      status(`自动识别 ${i+1} / ${candidates.length} · 已保留 ${items.length} 张`);
      let bitmap, thumb;
      try {
        ({bitmap} = await fetchImage(item.url));
        if (Math.min(bitmap.width,bitmap.height)<180 || Math.max(bitmap.width,bitmap.height)/Math.min(bitmap.width,bitmap.height)>4) { rejected++; continue; }
        item.width = bitmap.width; item.height = bitmap.height;
        thumb = await thumbnail(bitmap);
      } catch(e) { failures++; log(`图片读取失败：${item.url} · ${e.message}`); continue; }
      finally { bitmap?.close(); $('progress').value = i+1; }
      if (stopped) break;
      // A model error stops the scan; never substitute URL keywords for visual classification.
      const result = await classify(thumb);
      if (stopped) break;
      if (!result.keep) { rejected++; continue; }
      Object.assign(item,{confidence:result.confidence,preview:URL.createObjectURL(thumb)});
      items.push(item); addCard(item);
    }
    status(`${stopped ? '已停止' : '识别完成'} · 保留 ${items.length} 张 · 排除 ${rejected} 张 · 读取失败 ${failures} 张${frameFailures ? ' · 部分框架未扫描' : ''}`);
    if(albumFailed) status('图集读取失败 · 尚未进入图片识别');
    $('notice').textContent = albumMessage || '默认仅显示本地模型认定的室内图片。匹配分数是类别间的相对分数，可能存在误判或漏选。未加载图片请滚动原网页后重新扫描。';
  } catch(e) {
    if (!stopped) { status(`采集未完成：${e.message}`); log(e.message); $('notice').textContent = '请确认 models 与 vendor 文件夹完整，然后重新加载插件。已完成识别的图片仍可下载。'; }
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
      error ? reject(error) : resolve();
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
  const permission = directory ? directory.requestPermission({mode:'readwrite'}) : Promise.resolve('granted');
  saving = true; controls();
  const format = $('format').value, quality = Number($('quality').value);
  const destination = directory;
  let success = 0, failures = 0;
  try {
    if (await permission !== 'granted') throw new Error('未获得文件夹写入授权，请重新选择保存文件夹');
    for (let i=0;i<selected.length;i++) {
      const item = selected[i]; let bitmap;
      status(`转换并保存 ${i+1} / ${selected.length}`);
      try {
        ({bitmap} = await fetchImage(item.url));
        const blob = await convertImage(bitmap,format,quality);
        const {folder,name} = imageSavePath(item,items,format);
        const relativePath=folder ? folder+'/'+name : name;
        if (destination) {
          const noteDirectory=folder ? await destination.getDirectoryHandle(folder,{create:true}) : destination;
          const file = await uniqueFile(noteDirectory,name);
          const writable = await file.createWritable();
          try { await writable.write(blob); await writable.close(); }
          catch(e) { await writable.abort().catch(()=>{}); throw e; }
        } else await browserDownload(blob,relativePath);
        success++; log(`已保存：${relativePath}`);
      } catch(e) { failures++; log(`保存失败：${item.url} · ${e.message}`); }
      finally { bitmap?.close(); }
    }
    status(`保存完成 · 成功 ${success} 张 · 失败 ${failures} 张`);
  } catch(e) { status(e.message); log(e.message); }
  finally { saving = false; controls(); }
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
$('stop').onclick = () => { stopped = true; worker?.terminate(); failWorker(new Error('识别已停止')); status('正在停止…'); };
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
  await scan();
}
initialize();
