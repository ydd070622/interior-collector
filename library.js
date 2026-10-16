import {loadCaseLibraries,removeCaseLibrary} from './files.js';
import {flattenLibraries,selectLibraryCases,safePreview,readLibraryImage,importLibraryDirectory,relinkLibraryDirectory,caseDateLabel,caseDisplayTitle} from './library-data.js';

const $=id=>document.getElementById(id);
// ?view=compact marks the narrow window opened beside the collection window.
const compactView=new URLSearchParams(location.search).get('view')==='compact';
if(compactView)document.body.classList.add('compact');
// The sidebar width is user-resizable and remembered; the stored value is validated on every restore.
const SIDEBAR_KEY='library-sidebar-width';
const sidebarLimits=()=>[140,Math.max(140,Math.min(800,window.innerWidth-300)),compactView?200:220];
let sidebarLimit=sidebarLimits();
function sidebarWidth(){return Math.round(document.querySelector('aside').getBoundingClientRect().width);}
function clampSidebar(width,{commit=false}={}){
  const [min,max]=sidebarLimits();
  return Math.max(min,Math.min(Math.round(width),max));
}
function setSidebarWidth(width,{persist=false}={}){
  const value=clampSidebar(width,{commit:persist});
  document.documentElement.style.setProperty('--sidebar',value+'px');
  document.getElementById('sidebarResizer').setAttribute('aria-valuenow',String(value));
  document.getElementById('sidebarResizer').setAttribute('aria-valuemin',String(sidebarLimit[0]));
  document.getElementById('sidebarResizer').setAttribute('aria-valuemax',String(sidebarLimit[1]));
  if(persist)try{localStorage.setItem(SIDEBAR_KEY,String(value));}catch{}
  return value;
}
function restoreSidebarWidth(){
  sidebarLimit=sidebarLimits();
  setSidebarWidth(sidebarLimit[2],{persist:false});
  let saved;try{saved=Number(localStorage.getItem(SIDEBAR_KEY));}catch{}
  if(Number.isFinite(saved)&&saved>0)setSidebarWidth(saved,{persist:false});
}
function wireSidebarResizer(){
  const handle=$('sidebarResizer');
  let startX=0,startWidth=0,dragPointer=null;
  const onMove=event=>{if(event.pointerId!==dragPointer)return;setSidebarWidth(startWidth+event.clientX-startX,{persist:false});};
  const onUp=event=>{
    if(event.pointerId!==dragPointer)return;
    dragPointer=null;handle.classList.remove('dragging');document.body.classList.remove('resizing');
    handle.removeEventListener('pointermove',onMove);handle.removeEventListener('pointerup',onUp);handle.removeEventListener('pointercancel',onUp);
    setSidebarWidth(sidebarWidth(),{persist:true});
  };
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();dragPointer=event.pointerId;startX=event.clientX;startWidth=sidebarWidth();
    handle.classList.add('dragging');document.body.classList.add('resizing');
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove',onMove);handle.addEventListener('pointerup',onUp);handle.addEventListener('pointercancel',onUp);
  });
  handle.addEventListener('dblclick',()=>{try{localStorage.removeItem(SIDEBAR_KEY);}catch{}setSidebarWidth(sidebarLimits()[2],{persist:false});});
  handle.addEventListener('keydown',event=>{
    const step=event.shiftKey?40:12;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setSidebarWidth(sidebarWidth()+(event.key==='ArrowLeft'?-step:step),{persist:true});}
    else if(event.key==='Home'){event.preventDefault();setSidebarWidth(sidebarLimits()[0],{persist:true});}
  });
}
restoreSidebarWidth();wireSidebarResizer();
let sidebarResizeTimer;
window.addEventListener('resize',()=>{clearTimeout(sidebarResizeTimer);sidebarResizeTimer=setTimeout(()=>{if(window.innerWidth>540)setSidebarWidth(parseFloat(document.documentElement.style.getPropertyValue('--sidebar'))||sidebarLimits()[2]);},150);});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={folder:'all',caseKey:null,mode:'cases',query:'',sort:'folder-desc',limit:120};
let libraries=[],entries=[],byKey=new Map(),busy=false,reloadTimer,dirty=false,viewerEntry=null,viewerIndex=0,viewerToken=0,originalUrl=null;
const thumbnails=new Map(),pendingThumbs=new Set(),thumbnailQueue=[];let thumbnailActive=0;
const imageObserver=new IntersectionObserver(changes=>{for(const change of changes)if(change.isIntersecting){imageObserver.unobserve(change.target);thumbnailQueue.push(change.target);drainThumbnails();}},{rootMargin:'250px'});
const dateLabel=caseDateLabel;
const status=text=>{$('syncState').textContent=text;};
function sidebarIcon(kind){
  const paths={images:'<rect x="7" y="3" width="13" height="15" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10M10 13l3-3 4 4M15 7h.01"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',panel:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>'};
  return '<svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[kind]+'</svg>';
}
$('toggleFolders').innerHTML=sidebarIcon('panel');
function applySidebarCollapsed(collapsed){
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  $('toggleFolders').setAttribute('aria-expanded',String(!collapsed));
  $('toggleFolders').title=collapsed?'展开文件夹栏':'收起文件夹栏';
  $('toggleFolders').setAttribute('aria-label',collapsed?'展开文件夹栏':'收起文件夹栏');
  $('folderSection').hidden=false;
}
try{applySidebarCollapsed(localStorage.getItem('library-sidebar-collapsed')==='true');}catch{applySidebarCollapsed(false);}
$('toggleFolders').onclick=()=>{const collapsed=!document.body.classList.contains('sidebar-collapsed');applySidebarCollapsed(collapsed);try{localStorage.setItem('library-sidebar-collapsed',String(collapsed));}catch{}};
let treeStates=new Map();
try{const saved=JSON.parse(localStorage.getItem('library-folder-expansion')||'[]');if(Array.isArray(saved))treeStates=new Map(saved.filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&typeof row[1]==='boolean'));}catch{}
function rememberTree(key,open){treeStates.set(key,open);try{localStorage.setItem('library-folder-expansion',JSON.stringify([...treeStates].slice(-2000)));}catch{}}
$('folders').addEventListener('toggle',event=>{const tree=event.target;if(tree.isConnected&&tree.dataset.treeKey)rememberTree(tree.dataset.treeKey,tree.open);},true);
function notice(text){$('notice').textContent=text||'';$('notice').hidden=!text;}
function selectedEntry(){return byKey.get(state.caseKey);}
function selectedLibrary(){return selectedEntry()?.library||libraries.find(l=>l.key===state.folder);}
function currentCases(){return selectLibraryCases(entries,state);}
function caseAction(entry){return '<button class="folder-button case-folder" data-action="case" data-key="'+escape(entry.key)+'" aria-current="'+(state.caseKey===entry.key?'page':'false')+'"><span class="label" title="'+escape(entry.location)+'">'+escape(caseDisplayTitle(entry.record))+'</span><small>'+entry.record.images.length+'</small></button>';}
function folderTree(rows,depth=0,prefix=''){
  const leaves=[],groups=new Map();
  for(const {entry,parts}of rows){if(!parts.length)leaves.push(entry);else{if(!groups.has(parts[0]))groups.set(parts[0],[]);groups.get(parts[0]).push({entry,parts:parts.slice(1)});}}
  let html=leaves.map(caseAction).join('');
  for(const [name,children]of groups){if(children.length===1&&!children[0].parts.length){html+=caseAction(children[0].entry);continue;}
    const key=prefix+'/'+encodeURIComponent(name),open=treeStates.get(key)??children.some(c=>c.entry.key===state.caseKey);
    html+='<details class="folder-tree" data-tree-key="'+escape(key)+'" '+(open?'open':'')+'><summary>'+escape(name)+'</summary>'+folderTree(children,depth+1,key)+'</details>';
  }
  return html;
}
function renderFolders(){
  const counts=new Map();for(const entry of entries)counts.set(entry.library.key,(counts.get(entry.library.key)||0)+entry.record.images.length);
  $('all').innerHTML=sidebarIcon('images')+'<span class="label">全部素材</span><small>'+entries.reduce((sum,e)=>sum+e.record.images.length,0)+'</small>';$('all').setAttribute('aria-current',state.folder==='all'&&!state.caseKey?'page':'false');
  $('folders').innerHTML=libraries.filter(l=>l.directory||l.records.length).map(library=>{
    const rows=entries.filter(e=>e.library.key===library.key),selected=state.folder===library.key||selectedEntry()?.library.key===library.key;
    const treeKey='root:'+library.key,open=treeStates.get(treeKey)??selected;
    return '<details class="folder-tree" data-tree-key="'+escape(treeKey)+'" '+(open?'open':'')+'><summary><button class="folder-button" data-action="folder" data-key="'+escape(library.key)+'" aria-expanded="'+open+'" aria-current="'+(selected?'page':'false')+'">'+sidebarIcon('folder')+'<span class="label" title="'+escape(library.name)+'">'+escape(library.name)+'</span><span class="short-label" aria-hidden="true">'+escape(Array.from(library.name).slice(0,4).join(''))+'</span><small>'+String(counts.get(library.key)||0)+'</small></button></summary>'+folderTree(rows.slice(0,200).map(entry=>({entry,parts:(entry.record.folder||'').split('/').filter(Boolean)})),0,treeKey)+(rows.length>200?'<button class="folder-button" data-action="folder" data-key="'+escape(library.key)+'">查看全部 '+rows.length+' 个案例</button>':'')+'</details>';
  }).join('');
}
function imageMarkup(entry,index){
  const image=entry.record.images[index],preview=safePreview(image);
  return '<img '+(preview?'src="'+escape(preview)+'"':'')+' alt="'+escape(image.name||'案例封面')+'" loading="lazy" data-entry="'+escape(entry.key)+'" data-index="'+index+'">';
}
function tile(entry,index){
  const isCase=index===undefined,imageIndex=isCase?0:index,image=entry.record.images[imageIndex];
  const origin=!isCase&&!state.caseKey?'<small class="image-origin" title="'+escape(entry.location)+'">'+escape(caseDisplayTitle(entry.record))+'</small>':'';
  return '<button class="tile '+(isCase?'':'image-tile')+'" data-action="'+(isCase?'case':'preview')+'" data-key="'+escape(entry.key)+'" data-index="'+imageIndex+'" aria-label="'+escape((isCase?'打开案例：':'预览图片：')+(isCase?entry.record.title:image.name))+'"><div class="tile-cover">'+imageMarkup(entry,imageIndex)+(isCase?'<span class="tile-count">'+entry.record.images.length+' 张</span>':'')+'</div><div class="tile-info" title="'+escape(entry.location)+'"><span class="tile-title" title="'+escape(isCase?caseDisplayTitle(entry.record):image.name)+'">'+escape(isCase?caseDisplayTitle(entry.record):image.name)+'</span>'+origin+'</div></button>';
}
function renderGallery(){
  imageObserver.disconnect();thumbnailQueue.length=0;const entry=selectedEntry(),cases=entry?[entry]:currentCases(),imageMode=!!entry||state.mode==='images';
  const rows=imageMode?cases.flatMap(item=>item.record.images.map((_,index)=>({entry:item,index}))):cases.map(entry=>({entry,index:undefined}));
  $('gallery').innerHTML=rows.slice(0,state.limit).map(row=>tile(row.entry,row.index)).join('');
  $('loadMore').hidden=rows.length<=state.limit;$('loadMore').textContent='加载更多（还有 '+Math.max(0,rows.length-state.limit)+' 项）';
  $('empty').hidden=!!rows.length;
  $('emptyTitle').textContent=state.query?'没有找到对应素材':'还没有素材';
  $('emptyDescription').textContent=state.query?'试试其他名称，或清空搜索。':'导入已有素材文件夹，或在采集窗口保存图片后回来刷新。';
  $('gallery').querySelectorAll('img[data-entry]').forEach(img=>imageObserver.observe(img));
}
function render(){
  const entry=selectedEntry(),library=selectedLibrary(),cases=entry?[entry]:currentCases();
  $('heading').textContent=entry?caseDisplayTitle(entry.record):library?library.name:'全部素材';
  $('summary').textContent=entry?entry.record.images.length+' 张图片 · '+dateLabel(entry.record):cases.length+' 个案例 · '+cases.reduce((sum,e)=>sum+e.record.images.length,0)+' 张图片';
  $('breadcrumbs').replaceChildren();
  if(entry){const button=document.createElement('button');button.className='back-library';button.type='button';button.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18"/></svg><span>返回素材库</span>';button.onclick=()=>changeFolder(entry.library.key);$('breadcrumbs').append(button);
    for(const raw of entry.record.sourceUrls||[]){try{const url=new URL(raw);if(!/^https?:$/.test(url.protocol))continue;const link=document.createElement('a');link.className='source-link';link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='查看原文';$('breadcrumbs').append(link);}catch{}}
  }
  $('toolbar').hidden=!!entry;$('caseView').setAttribute('aria-pressed',String(state.mode==='cases'));$('imageView').setAttribute('aria-pressed',String(state.mode==='images'));
  $('folderFilters').hidden=!!entry;
  $('folderFilters').replaceChildren();
  for(const [key,name]of [['all','全部'],...libraries.filter(l=>l.records.length).map(l=>[l.key,l.name])]){
    const button=document.createElement('button');button.textContent=name;button.dataset.action='filter-library';button.dataset.key=key;button.setAttribute('aria-pressed',String(state.folder===key));$('folderFilters').append(button);
  }
  renderFolders();renderGallery();
}
function changeFolder(folder){state.folder=folder;state.caseKey=null;state.query='';state.limit=120;$('search').value='';notice('');render();}
async function reload(){
  if(busy||$('viewer').open){dirty=true;return;}
  try{libraries=await loadCaseLibraries();entries=flattenLibraries(libraries);byKey=new Map(entries.map(entry=>[entry.key,entry]));
    if(state.caseKey&&!byKey.has(state.caseKey))state.caseKey=null;
    if(state.folder!=='all'&&!libraries.some(l=>l.key===state.folder))state.folder='all';
    dirty=false;render();status('本地素材 · '+entries.length+' 个案例');
  }catch(error){status('读取失败');notice('无法读取素材索引：'+error.message);}
}
async function drainThumbnails(){
  if(thumbnailActive>=3)return;
  const img=thumbnailQueue.shift();if(!img)return;
  if(!img.isConnected){drainThumbnails();return;}
  const entry=byKey.get(img.dataset.entry),image=entry?.record.images[Number(img.dataset.index)];
  if(!entry?.library.directory||!image){drainThumbnails();return;}
  const cacheKey=entry.key+'|'+image.name+'|'+image.modified+'|'+image.size;
  if(thumbnails.has(cacheKey)){img.src=thumbnails.get(cacheKey);drainThumbnails();return;}
  if(pendingThumbs.has(cacheKey)){drainThumbnails();return;}
  pendingThumbs.add(cacheKey);thumbnailActive++;
  let bitmap;
  try{
    const file=await readLibraryImage(entry,image);bitmap=await createImageBitmap(file);
    // Match the card's physical pixels; the 160px history preview is only a placeholder.
    const cover=img.closest('.tile-cover').getBoundingClientRect();
    const pixels=Math.min(3,window.devicePixelRatio||1);
    const target=Math.max(960,Math.ceil(Math.max(cover.width,cover.height)*pixels));
    const factor=Math.min(1,target/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));if(!blob)return;
    const url=URL.createObjectURL(blob);thumbnails.set(cacheKey,url);
    for(const current of $('gallery').querySelectorAll('img[data-entry]')){
      const descriptor=byKey.get(current.dataset.entry)?.record.images[Number(current.dataset.index)];
      if(current.dataset.entry===entry.key&&descriptor?.name===image.name&&descriptor?.modified===image.modified&&descriptor?.size===image.size)current.src=url;
    }
    if(thumbnails.size>240){const oldest=thumbnails.keys().next().value;URL.revokeObjectURL(thumbnails.get(oldest));thumbnails.delete(oldest);}
  }catch(error){if(img.isConnected){
    img.title=error.name==='NotAllowedError'?'请授权读取清晰图片':'原图可能已移动或删除；当前显示历史缩略图';
    if(error.name==='NotAllowedError'&&!$('notice').querySelector('button')){
      notice('当前显示低清历史缩略图，读取原文件夹后可显示清晰图片。 ');
      const button=document.createElement('button');button.textContent='读取清晰图片';
      button.onclick=()=>authorizeFolder(entry.library).catch(error=>notice(error.message));
      $('notice').append(button);
    }
  }}
  finally{bitmap?.close();pendingThumbs.delete(cacheKey);thumbnailActive--;drainThumbnails();}
  if(thumbnailActive<3)drainThumbnails();
}
async function operation(task){
  if(busy)return;busy=true;$('import').disabled=true;$('refresh').disabled=true;notice('');
  try{await task();status('素材索引已更新');}
  catch(error){if(error.name!=='AbortError')notice(error.message);}
  finally{busy=false;$('import').disabled=false;$('refresh').disabled=false;await reload();}
}
async function authorizeFolder(library){
  if(await library.directory.requestPermission({mode:'read'})!=='granted')throw Error('未获得文件夹读取授权');
  renderGallery();notice('已授权读取 '+library.name+'，点击图片查看原图。');
}
async function scanFolder(library){
  if(await library.directory.requestPermission({mode:'read'})!=='granted')throw Error('请先授权读取原素材文件夹');
  await importLibraryDirectory(library.directory,status);
}
async function importFolder(){
  // Invoke the picker directly in the click turn; no real files are copied or moved.
  const directory=await showDirectoryPicker({id:'interior-material-library',mode:'read'});
  await operation(()=>importLibraryDirectory(directory,status));
}
function cleanOriginal(){if(originalUrl){URL.revokeObjectURL(originalUrl);originalUrl=null;}}
function fitViewer(){
  const image=$('original');if(!$('viewer').open||!image.naturalWidth||!image.naturalHeight)return;
  const recovery=!$('authorize').hidden||!$('showDownload').hidden;
  const availableHeight=Math.max(80,innerHeight-(recovery?150:110));
  const scale=Math.min(Math.max(80,innerWidth-64)/image.naturalWidth,availableHeight/image.naturalHeight);
  const width=Math.round(image.naturalWidth*scale),height=Math.round(image.naturalHeight*scale);
  $('viewer').style.setProperty('--viewer-width',Math.max(240,width+26)+'px');
  if(!$('viewer').querySelector('.viewer-stage').classList.contains('actual')){image.style.width=width+'px';image.style.height=height+'px';}
}
async function loadOriginal(request=false){
  const entry=viewerEntry,image=entry?.record.images[viewerIndex];if(!image)return;
  const token=++viewerToken;cleanOriginal();const preview=safePreview(image);if(preview)$('original').src=preview;else $('original').removeAttribute('src');$('original').alt=image.name;
  $('viewerTitle').textContent=caseDisplayTitle(entry.record)+' · '+(viewerIndex+1)+'/'+entry.record.images.length;
  $('viewerTitle').title=$('viewerTitle').textContent;
  $('imageName').textContent=image.name;$('imageLocation').textContent=entry.location;
  $('viewerStatus').textContent='正在读取本地原图…';$('authorize').hidden=!entry.library.directory;$('showDownload').hidden=!image.downloadId;
  $('viewer').querySelector('.viewer-stage').classList.remove('actual');
  try{
    const file=await readLibraryImage(entry,image,{request});if(token!==viewerToken||!$('viewer').open)return;
    originalUrl=URL.createObjectURL(file);$('original').src=originalUrl;$('viewerStatus').textContent='';$('authorize').hidden=true;
  }catch(error){if(token!==viewerToken)return;$('viewerStatus').textContent=error.name==='NotAllowedError'?'当前显示历史缩略图，请授权读取原图。':error.name==='NotFoundError'?'原图已移动或删除，请关闭预览后重新关联文件夹。':error.message;}
}
function openPreview(entry,index){viewerEntry=entry;viewerIndex=index;$('viewer').showModal();loadOriginal(true);}
function stepImage(direction){if(!viewerEntry)return;viewerIndex=(viewerIndex+direction+viewerEntry.record.images.length)%viewerEntry.record.images.length;loadOriginal();}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action,key=target.dataset.key;
  if(action==='folder'||action==='filter-library'){
    event.preventDefault();
    const tree=target.closest('summary')?.parentElement;
    if(action==='folder'&&tree?.dataset.treeKey)rememberTree(tree.dataset.treeKey,document.body.classList.contains('sidebar-collapsed')?tree.open:!tree.open);
    changeFolder(key);
  }
  else if(action==='case'){state.caseKey=key;state.limit=120;notice('');render();window.scrollTo({top:0});}
  else if(action==='preview'){const entry=byKey.get(key);if(entry)openPreview(entry,Number(target.dataset.index));}
});
$('home').onclick=event=>{event.preventDefault();changeFolder('all');};$('all').onclick=()=>changeFolder('all');
$('search').oninput=()=>{state.query=$('search').value;state.limit=120;render();};
$('sort').onchange=()=>{state.sort=$('sort').value;state.limit=120;render();};
$('caseView').onclick=()=>{state.mode='cases';state.limit=120;render();};$('imageView').onclick=()=>{state.mode='images';state.limit=120;render();};
$('loadMore').onclick=()=>{state.limit+=120;renderGallery();};$('refresh').onclick=reload;
$('import').onclick=()=>importFolder().catch(error=>{if(error.name!=='AbortError')notice(error.message);});
$('closeViewer').onclick=()=>$('viewer').close();$('previous').onclick=()=>stepImage(-1);$('next').onclick=()=>stepImage(1);
$('viewer').onclose=()=>{viewerToken++;cleanOriginal();$('original').removeAttribute('src');viewerEntry=null;if(dirty)reload();};
$('authorize').onclick=()=>loadOriginal(true);
$('original').onload=fitViewer;
window.addEventListener('resize',fitViewer);
$('original').ondblclick=()=>{if(!originalUrl)return;const actual=$('viewer').querySelector('.viewer-stage').classList.toggle('actual');if(actual){$('original').style.width=$('original').naturalWidth+'px';$('original').style.height=$('original').naturalHeight+'px';}else fitViewer();};
let swipeStart=null,lastWheel=0;
const viewerStage=$('viewer').querySelector('.viewer-stage');
viewerStage.addEventListener('pointerdown',event=>{if(event.target.closest('button')||event.button!==0||viewerStage.classList.contains('actual'))return;swipeStart={x:event.clientX,y:event.clientY,id:event.pointerId};viewerStage.setPointerCapture(event.pointerId);});
viewerStage.addEventListener('pointerup',event=>{if(!swipeStart||swipeStart.id!==event.pointerId)return;const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;swipeStart=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3)stepImage(dx<0?1:-1);});
viewerStage.addEventListener('pointercancel',()=>{swipeStart=null;});
viewerStage.addEventListener('wheel',event=>{if(viewerStage.classList.contains('actual'))return;event.preventDefault();const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(Math.abs(delta)<15||performance.now()-lastWheel<300)return;lastWheel=performance.now();stepImage(delta>0?1:-1);},{passive:false});
$('original').onerror=()=>{if(originalUrl&&$('viewer').open)$('viewerStatus').textContent='该原图无法解码，请在原文件夹中检查文件格式或完整性。';};
$('showDownload').onclick=async()=>{try{const image=viewerEntry.record.images[viewerIndex];const [download]=await chrome.downloads.search({id:image.downloadId});if(!download||download.exists===false)throw Error('下载文件已移动或删除，请导入新的保存文件夹');chrome.downloads.show(image.downloadId);}catch(error){$('viewerStatus').textContent=error.message;}};
document.addEventListener('keydown',event=>{if(!$('viewer').open)return;if(event.key==='ArrowLeft'){event.preventDefault();stepImage(-1);}if(event.key==='ArrowRight'){event.preventDefault();stepImage(1);}});
const historyChannel=new BroadcastChannel('interior-case-history');historyChannel.onmessage=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(reload,800);};
function renderManagedFolders(){
  $('managedFolders').replaceChildren();
  const roots=libraries.filter(l=>l.directory);
  if(!roots.length){$('managedFolders').textContent='没有已导入的文件夹';return;}
  for(const library of roots){
    const row=document.createElement('div');row.className='managed-folder';
    const label=document.createElement('div'),name=document.createElement('strong'),count=document.createElement('small');
    name.textContent=library.name;count.textContent=library.records.reduce((n,r)=>n+(r.images?.length||0),0)+' 张图片';label.append(name,count);
    const button=document.createElement('button');button.textContent='移除';button.setAttribute('aria-label','移除文件夹：'+library.name);
    button.onclick=async()=>{
      $('managerError').textContent='';busy=true;
      $('managedFolders').querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await removeCaseLibrary(library.key);state.folder='all';state.caseKey=null;}
      catch(error){$('managerError').textContent=error.message;}
      finally{busy=false;await reload();renderManagedFolders();}
    };
    const actions=document.createElement('div');actions.className='managed-folder-actions';
    const authorize=document.createElement('button');authorize.textContent='授权读取';authorize.hidden=true;
    authorize.setAttribute('aria-label','授权读取：'+library.name);
    const scan=document.createElement('button');scan.textContent='更新索引';scan.setAttribute('aria-label','更新索引：'+library.name);
    const relink=document.createElement('button');relink.textContent='重新关联';relink.setAttribute('aria-label','重新关联：'+library.name);
    const run=async task=>{
      if(busy)return;busy=true;$('managerError').textContent='';
      $('managedFolders').querySelectorAll('button').forEach(b=>b.disabled=true);
      $('import').disabled=true;$('refresh').disabled=true;
      try{await task();}
      catch(error){if(error.name!=='AbortError')$('managerError').textContent=error.message;}
      finally{busy=false;$('import').disabled=false;$('refresh').disabled=false;await reload();if($('folderManager').open)renderManagedFolders();}
    };
    authorize.onclick=()=>run(()=>authorizeFolder(library));
    scan.onclick=()=>run(()=>scanFolder(library));
    relink.onclick=()=>run(async()=>{
      const directory=await showDirectoryPicker({id:'interior-material-library',mode:'read'});
      await relinkLibraryDirectory(library,directory,status);
    });
    Promise.resolve().then(()=>library.directory.queryPermission({mode:'read'})).then(permission=>{if(row.isConnected)authorize.hidden=permission==='granted';}).catch(()=>{if(row.isConnected)authorize.hidden=false;});
    actions.append(authorize,scan,relink,button);row.append(label,actions);$('managedFolders').append(row);
  }
}
$('manageFolders').onclick=()=>{$('managerError').textContent='';renderManagedFolders();$('folderManager').showModal();};
$('closeFolderManager').onclick=()=>$('folderManager').close();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)reload();});window.addEventListener('focus',()=>{if(!busy&&!$('viewer').open)reload();});
window.addEventListener('pagehide',()=>{cleanOriginal();historyChannel.close();imageObserver.disconnect();for(const url of thumbnails.values())URL.revokeObjectURL(url);});
reload();
