import {api as chrome} from './background-api.js';
import {createDetailTab,releaseDetailTab} from './detail-port.js';
export function readCoolPage(){
 if(!/(^|\.)cool-de\.com$/i.test(location.hostname))return null;
 function thread(url){const u=new URL(url,location.href);if(!/(^|\.)cool-de\.com$/i.test(u.hostname))return null;return u.pathname.match(/\/thread-(\d+)-\d+-\d+\.html/)?.[1]||(u.pathname.endsWith('/forum.php')&&u.searchParams.get('mod')==='viewthread'?u.searchParams.get('tid'):null);}
 const detailId=thread(location.href),notes=new Map(),images=[],videoNoteIds=[];
 if(!detailId){const region=document.querySelector('#threadlist,.slst,.tl');if(region)for(const a of region.querySelectorAll('a[href]')){try{const id=thread(a.href);if(!id)continue;const title=(a.getAttribute('title')||a.textContent||'').trim();if(!title||!a.closest('h3,h2,th')&&!a.classList.contains('xst')&&!a.classList.contains('xs3'))continue;const r=a.getBoundingClientRect();if(!r.width||!r.height)continue;if(!notes.has(id))notes.set(id,{id,href:new URL('/thread-'+id+'-1-1.html',location.origin).href,label:title,visualTop:Math.round(r.top+scrollY),visualLeft:Math.round(r.left)});}catch{}}
 }else{
 const body=document.querySelector('[id^="postmessage_"]');const title=(document.querySelector('#thread_subject')?.textContent||document.querySelector('h1')?.textContent||document.title.split('_')[0]).trim();
 if(body){if(body.querySelector('video,embed,object,iframe[src*="bilibili"],iframe[src*="youku"]'))videoNoteIds.push(detailId);
 else{const seen=new Set();for(const img of body.querySelectorAll('img')){if(img.closest('.quote,.pstatus,.sign')||/smiley|avatar|icon|qr[-_]?code/i.test(img.className+' '+img.src))continue;
 const raw=img.getAttribute('zoomfile')||img.getAttribute('file')||img.getAttribute('data-original')||img.getAttribute('data-src')||img.getAttribute('src');if(!raw)continue;
 try{const u=new URL(raw,location.href);if(!/^https?:$/.test(u.protocol)||/\.svg(?:$|\?)/i.test(u.href)||seen.has(u.href))continue;
 if(!img.hasAttribute('aid')&&!img.hasAttribute('zoomfile')&&!/\/attachment\/|\/uploads\//i.test(u.pathname))continue;
 seen.add(u.href);images.push({url:u.href,page:location.href,noteId:detailId,noteTitle:title||'未命名案例',noteOrder:1,imageIndex:images.length,label:(title||'案例')+' · '+(images.length+1),album:true});}catch{}}
 }}
 }
 return {detailId,notes:[...notes.values()].sort((a,b)=>a.visualTop-b.visualTop||a.visualLeft-b.visualLeft),images,videoNoteIds};
}
export function scrollCoolDetail(){window.scrollBy(0,Math.max(600,innerHeight*0.85));}
export function advanceCoolPage(){const next=document.querySelector('.pg a.nxt,a[rel="next"]');if(!next||next.getAttribute('aria-disabled')==='true'||next.classList.contains('disabled'))return false;const r=next.getBoundingClientRect();if(!r.width||!r.height)return false;next.click();return true;}
export async function readCoolAlbum(note,isStopped,api=chrome){
 const tab=await createDetailTab(note.href,api,note.windowId),images=new Map();let stable=0;
 try{for(let round=0;round<50&&!isStopped();round++){
 const current=await api.tabs.get(tab.id);if(current.status!=='complete'){await new Promise(r=>setTimeout(r,500));continue;}
 const [r]=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readCoolPage});const data=r.result;if(data?.videoNoteIds?.includes(note.id))return {video:true};const before=images.size;
 for(const image of data?.images||[])if(image.noteId===note.id&&!images.has(image.url))images.set(image.url,{...image,imageIndex:images.size});
 stable=before===images.size?stable+1:0;if(images.size&&stable>=4)return {images:[...images.values()]};
 await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:scrollCoolDetail});await new Promise(r=>setTimeout(r,650));
 }if(isStopped())return {images:[]};if(images.size)return {images:[...images.values()]};throw Error('未取得作品正文图集，请检查页面加载或验证提示');
 }finally{await api.tabs.remove(tab.id).catch(()=>{});releaseDetailTab(tab.id);}
}
