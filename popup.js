import {loadDirectory,saveDirectory} from './files.js';
const $=id=>document.getElementById(id);
let state,sourceTab,rendered=[],listMode=false;
function showFolder(directory){const name=directory?.name;$('folderName').textContent=name||'选择保存文件夹';$('folder').title=name?`保存到：${name}（点击更换文件夹）`:'点击选择保存文件夹；未选择时使用 Chrome 下载目录 / 室内灵感';}
function configureScanRow(){const row=$('noteLimit').closest('.limit-row');row.hidden=false;row.querySelector('label').hidden=false;$('noteLimit').hidden=false;$('noteLimit').title='列表页设置采集篇数；单篇详情读取全部图片';}
function isOpenXhsNote(){
  if(!/(^|\.)xiaohongshu\.com$/i.test(location.hostname))return false;
  if(/\/(?:explore|discovery\/item)\/[a-f0-9]{24}/i.test(location.pathname))return true;
  return [...document.querySelectorAll('.note-detail-mask,.note-detail')].some(el=>{const r=el.getBoundingClientRect();return r.width>100&&r.height>100&&getComputedStyle(el).visibility!=='hidden';});
}
function scanPayload(){const raw=$('noteLimit').value.trim();const noteLimit=raw===''?null:Number(raw);if(noteLimit!==null&&(!Number.isSafeInteger(noteLimit)||noteLimit<1))throw new Error('采集篇数请输入正整数，或留空不限');return {sourceTab,noteLimit};}
async function startScan(){try{const payload=scanPayload();await chrome.storage.local.set({noteLimit:payload.noteLimit});await job('scan',payload);}catch(e){$('status').textContent=e.message;}}
async function job(command,payload={}) {
  const result=await chrome.runtime.sendMessage({type:'JOB',command,payload});
  if(result?.error)throw new Error(result.error);
  if(result?.state)render(result.state);
  return result?.state;
}
function render(next) {
  state=next;$('source').textContent=next.source;$('status').textContent=next.status;$('notice').textContent=next.notice||'收起弹窗后任务仍会继续，再次打开可查看进度。';
  $('count').textContent=`${next.items.length} 张室内图片`;$('empty').hidden=!!next.items.length;
  $('progress').max=next.max||1;$('progress').value=next.progress||0;
  const busy=next.active||next.saving;
  $('noteLimit').disabled=busy;$('rescan').textContent=listMode?'开始提取':'重新扫描';$('rescan').disabled=busy;$('stop').disabled=!next.active;$('download').disabled=busy||!next.items.length;
  $('folder').disabled=next.saving;$('format').disabled=next.saving;
  const previews=next.items.map(i=>i.preview);
  if(previews.length!==rendered.length||previews.some((p,i)=>p!==rendered[i])) {
    $('grid').replaceChildren();rendered=previews;
    next.items.forEach((item,index)=>{
      const card=document.createElement('article');card.className='card';
      const image=document.createElement('img');image.src=item.preview;image.alt=item.label||'室内设计图片';
      const info=document.createElement('div');info.className='info';
      const title=document.createElement('strong');title.textContent=item.label||`室内灵感 ${index+1}`;
      const meta=document.createElement('small');meta.textContent=`${item.width} × ${item.height} · 室内匹配 ${Math.round(item.confidence*100)}%`;
      const button=document.createElement('button');button.textContent='下载图片';button.onclick=()=>download(index);
      info.append(title,meta,button);card.append(image,info);$('grid').append(card);
    });
  }
  document.querySelectorAll('.card button').forEach(button=>button.disabled=busy);
  $('logs').replaceChildren(...next.logs.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  if(next.detailsOpen)$('logs').closest('details').open=true;
}
async function download(index) {
  try {
    // Only the visible popup can request filesystem permission with the user's click.
    const directory=await loadDirectory();
    if(directory && await directory.requestPermission({mode:'readwrite'})!=='granted')throw new Error('请重新选择保存文件夹并授权写入');
    await job('download',{index,format:$('format').value,quality:1});
  }catch(e){$('status').textContent=e.message;}
}
chrome.runtime.onMessage.addListener(message=>{if(message.type==='JOB_UPDATE')render(message.state);});
$('rescan').onclick=startScan;
$('noteLimit').onchange=()=>{try{const {noteLimit}=scanPayload();chrome.storage.local.set({noteLimit});}catch(e){$('status').textContent=e.message;}};
$('stop').onclick=()=>job('stop').catch(e=>$('status').textContent=e.message);
$('download').onclick=()=>download();
$('folder').onclick=async()=>{
  try {const directory=await showDirectoryPicker({id:'interior-collector',mode:'readwrite'});await saveDirectory(directory);showFolder(directory);}
  catch(e){if(e.name!=='AbortError')$('status').textContent=e.message;}
};
for(const field of ['format'])$(field).onchange=()=>chrome.storage.local.set({[field]:$(field).value});
(async()=>{
  try {
    const explicit=new URLSearchParams(location.search).get('tab');
    sourceTab=explicit!==null?Number(explicit):(await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id;
    const tab=await chrome.tabs.get(sourceTab);
    const url=new URL(tab.url||'https://invalid.local');
    listMode=/(^|\.)xiaohongshu\.com$/i.test(url.hostname)&&!/\/(?:explore|discovery\/item)\/[a-f0-9]{24}/i.test(url.pathname);
    if(/(^|\.)xiaohongshu\.com$/i.test(url.hostname)&&listMode){const [detail]=await chrome.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:isOpenXhsNote});if(detail?.result)listMode=false;}
    if(!/(^|\.)xiaohongshu\.com$/i.test(url.hostname))listMode=!(/(^|\.)zcool\.com\.cn$/i.test(url.hostname)&&/^\/work\/[^/]+/.test(url.pathname));
    if(!/(^|\.)(xiaohongshu\.com|zcool\.com\.cn)$/i.test(url.hostname))listMode=!/^\/(?:work|works|project|projects|case|cases|article|articles|detail|design)\/[^/]+/.test(url.pathname);
    if(/(^|\.)cool-de\.com$/i.test(url.hostname))listMode=!( /\/thread-\d+-\d+-\d+\.html/.test(url.pathname)||(url.pathname.endsWith('/forum.php')&&url.searchParams.get('mod')==='viewthread'&&url.searchParams.has('tid')));
    configureScanRow();
    const settings=await chrome.storage.local.get(['format','noteLimit']);if(settings.format)$('format').value=settings.format;
    if(Number.isSafeInteger(settings.noteLimit)&&settings.noteLimit>0)$('noteLimit').value=settings.noteLimit;
    const directory=await loadDirectory();showFolder(directory);
    const current=await job('state');
    if(listMode) {
      $('rescan').textContent='开始提取';
      if(!current?.active&&!current?.saving){
        $('noteLimit').disabled=false;
        $('source').textContent=tab.title||url.hostname;
        $('status').textContent='准备提取';
        $('notice').textContent='按网页列表顺序提取前 N 篇图文笔记；留空不限，视频不计入。';
        if(!current?.hasStarted||current.sourceTab!==sourceTab){$('grid').replaceChildren();rendered=[];$('count').textContent='0 张室内图片';$('empty').hidden=false;$('download').disabled=true;}
      }
    }else if(!current?.hasStarted || (!current.active && !current.saving && current.sourceTab!==sourceTab))await job('scan',scanPayload());
  }catch(e){$('status').textContent='后台任务启动失败：'+e.message;}
})();


