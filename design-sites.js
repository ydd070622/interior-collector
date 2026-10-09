import {api as chrome} from './background-api.js';
import {createDetailTab,releaseDetailTab} from './detail-port.js';
export function readDesignPage(){

 const detailId=location.pathname.match(/^\/(?:work|works|project|projects|case|cases|article|articles|detail|design)\/([^/]+?)(?:\.html)?$/)?.[1];
 const title=(document.querySelector('h1')?.textContent||document.title.replace(/[_|｜].*$/,'').replace(/[-–]\s*站酷.*$/,'')).trim();
 const notes=new Map(),images=new Map(),videoNoteIds=[];
 for(const a of document.querySelectorAll('a[href]')){try{const u=new URL(a.getAttribute('href'),location.href),id=u.pathname.match(/^\/(?:work|works|project|projects|case|cases|article|articles|detail|design)\/([^/]+?)(?:\.html)?$/)?.[1];if(!id||u.origin!==location.origin)continue;const card=a.closest('article,.card-box,.work-card,[class*="workCard"],[class*="cardBox"]')||a;const r=card.getBoundingClientRect();if(!r.width||!r.height)continue;
 if(card.querySelector('video,[class*="video-icon"],[class*="videoIcon"]')||[...card.querySelectorAll('use')].some(el=>/video|play/i.test(el.getAttribute('href')||el.getAttribute('xlink:href')||''))){videoNoteIds.push(id);continue;}
 const existing=notes.get(id),note={id,href:u.href,label:(a.getAttribute('title')||a.textContent||'作品').trim(),visualTop:Math.round(r.top+window.scrollY),visualLeft:Math.round(r.left)};if(!existing||note.visualTop<existing.visualTop)notes.set(id,note);
 }catch{}}
 if(detailId){
 const scopes=[...document.querySelectorAll('article,[itemprop="articleBody"],.article-content,.article-body,.project-content,.case-content,.detail-content,.work-show-box,.work-content')];
 if(!scopes.length)return {detailId,notes:[],images:[],videoNoteIds:[]};
 const candidates=scopes.length?[...new Set(scopes.flatMap(el=>[...el.querySelectorAll('img')]))]:[...document.querySelectorAll('img')];
 for(const img of candidates){if(img.closest('header,nav,footer,[class*="recommend"],[class*="Recommend"],[class*="related"],[class*="avatar"],[class*="comment"],[class*="Comment"]'))continue;
 const link=img.closest('a[href]');if(link){try{const u=new URL(link.href,location.href);if(/^\/(?:work|works|project|projects|case|cases|article|articles|detail|design)\//.test(u.pathname)&&!u.pathname.includes(detailId))continue;}catch{}}
 const rect=img.getBoundingClientRect();let raw=img.getAttribute('data-original')||img.getAttribute('data-src')||img.getAttribute('data-lazy-src');if(!raw&&img.srcset)raw=img.srcset.split(',').map(x=>x.trim().split(/\s+/)).sort((a,b)=>parseInt(b[1]||0)-parseInt(a[1]||0))[0]?.[0];raw=raw||img.currentSrc||img.src;
 if(!raw||!/^https?:|^\/\//i.test(raw))continue;
 if(!scopes.length&&Math.max(rect.width,img.naturalWidth,Number(img.getAttribute('width'))||0)<320)continue;
 try{const u=new URL(raw,location.href);if(/\.svg(?:$|\?)/i.test(u.href))continue;
 if(/\.(?:jpg|jpeg|png|webp)@/i.test(u.pathname))u.pathname=u.pathname.split('@')[0];
 if(!images.has(u.href))images.set(u.href,{url:u.href,page:location.href,noteId:detailId,noteTitle:title||'未命名作品',imageIndex:images.size,noteOrder:1,label:(title||'作品')+' · '+(images.size+1),album:true});
 }catch{}}
 }
 const sorted=[...notes.values()].filter(n=>!videoNoteIds.includes(n.id)).sort((a,b)=>Math.round(a.visualTop/24)-Math.round(b.visualTop/24)||a.visualLeft-b.visualLeft);
 const video=!!detailId&&!!document.querySelector('.work-show-box video,.work-content video,.workShowBox video');
 return {detailId,notes:sorted,images:video?[]:[...images.values()],videoNoteIds:video?[...videoNoteIds,detailId]:videoNoteIds};
}
export async function readDesignAlbum(note,isStopped,api=chrome){
 const tab=await createDetailTab(note.href,api,note.windowId),images=new Map();let stable=0;
 try{for(let round=0;round<50&&!isStopped();round++){
 const current=await api.tabs.get(tab.id);if(current.status!=='complete'){await new Promise(r=>setTimeout(r,500));continue;}
 const [r]=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readDesignPage});const data=r.result;if(data?.videoNoteIds?.includes(note.id))return {video:true};const before=images.size;
 for(const image of data?.images||[])if(image.noteId===note.id&&!images.has(image.url))images.set(image.url,{...image,imageIndex:images.size});
 stable=before===images.size?stable+1:0;if(images.size&&stable>=4)return {images:[...images.values()]};
 await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:scrollDesignDetail});await new Promise(r=>setTimeout(r,650));
 }if(isStopped())return {images:[]};if(images.size)return {images:[...images.values()]};throw Error('未取得作品正文图集，请检查页面加载或验证提示');
 }finally{await api.tabs.remove(tab.id).catch(()=>{});releaseDetailTab(tab.id);}
}
export function scrollDesignDetail(){window.scrollBy(0,Math.max(600,innerHeight*0.85));}
export async function collectZcoolAlbums({sourceTab,notes,maxNotes,isStopped,onProgress,onLog,loadMore,api=chrome,read=readDesignAlbum}){
 const queue=[...notes],seen=new Set(queue.map(n=>n.id)),videoIds=[],images=[];let processed=0,success=0,failures=0;const source=await api.tabs.get(sourceTab);
 for(let i=0;i<queue.length&&!isStopped()&&(!maxNotes||processed<maxNotes);i++){const note=queue[i];onProgress('读取作品图集 '+(processed+1)+' / '+(maxNotes||queue.length));
 try{const data=await read({...note,windowId:source.windowId},isStopped,api);if(isStopped())break;if(data.video){videoIds.push(note.id);onLog('跳过视频作品（不占篇数）');}else{processed++;if(!data.images?.length)throw Error('作品正文没有图片');images.push(...data.images.map(image=>({...image,noteOrder:processed})));success++;onLog('作品 '+processed+'：取得 '+data.images.length+' 张正文图片');}}
 catch(e){if(isStopped())break;if(processed<success+failures+1)processed++;failures++;onLog('作品读取失败：'+e.message);}
 if(i===queue.length-1&&maxNotes&&processed<maxNotes&&videoIds.length&&loadMore&&!isStopped())for(const n of await loadMore(videoIds))if(!seen.has(n.id)){seen.add(n.id);queue.push(n);}
 }return {images,total:processed,success,failures,skippedVideos:videoIds.length};
}
