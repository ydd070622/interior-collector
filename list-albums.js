import {api as chrome} from './background-api.js';
import {readXhsPage,parseInitialState,extractNoteAlbum,getNoteType} from './albums.js';
import {createDetailTab,releaseDetailTab} from './detail-port.js';

// Fetch from the source page context so the website receives its normal session cookies.
export async function fetchXhsNoteHtml(href) {
  const url=new URL(href,location.href);
  if(url.origin!==location.origin)throw new Error('笔记链接不属于当前网站');
  const response=await fetch(url.href,{credentials:'include',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('详情页 HTTP '+response.status);
  const html=await response.text();
  if(html.length>8000000)throw new Error('详情页数据过大');
  return html;
}

export async function readRenderedAlbum(note,isStopped,api=chrome) {
  const tab=await createDetailTab(note.href,api,note.windowId);
  try {
    const deadline=Date.now()+18000;
    while(Date.now()<deadline&&!isStopped()) {
      const current=await api.tabs.get(tab.id);
      if(current.status==='complete') {
        if(current.url) {
          const u=new URL(current.url);
          if(u.pathname.startsWith('/website-login')||u.pathname.startsWith('/404'))throw new Error(u.searchParams.get('error_msg')||'网站要求登录或验证，无法读取图集');
        }
        try {
          const [result]=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readXhsPage});
          if(result.result?.videoNoteIds?.includes(note.id))return {type:'video'};
          const images=result.result?.images?.filter(i=>i.noteId===note.id)||[];
          if(images.length)return images;
        }catch{}
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error(isStopped()?'已停止':'详情页未返回完整图集（可能需要登录或验证）');
  }finally{await api.tabs.remove(tab.id).catch(()=>{});releaseDetailTab(tab.id);}
}

export async function collectListAlbums({sourceTab,notes,isStopped,onProgress,onLog,api=chrome,render=readRenderedAlbum,maxNotes=null,loadMore}) {
  const images=[];const failureReasons=[];let success=0,failures=0,skippedVideos=0,processed=0;const videoIds=[];
  const unique=[...new Map(notes.map(n=>[n.id,n])).values()];const seenIds=new Set(unique.map(n=>n.id));
  for(let i=0;i<unique.length&&!isStopped()&&(!maxNotes||processed<maxNotes);i++) {
    const note=unique[i];let video=note.type==='video';
    try {
      const url=new URL(note.href);
      if(!/(^|\.)xiaohongshu\.com$/i.test(url.hostname)||!/^https:$/.test(url.protocol)||!/^[a-f0-9]{24}$/i.test(note.id))throw new Error('笔记链接无效');
      onProgress(`读取笔记图集 ${i+1} / ${unique.length} · 已取得 ${images.length} 张`);
      let album=[];
      if(!video)try {
        const [result]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:fetchXhsNoteHtml,args:[note.href]});
        if(result.error)throw new Error(result.error.message||'详情读取失败');
        const state=parseInitialState(result.result);video=video||getNoteType(state,note.id)==='video';
        if(!video) {
          const doc=new DOMParser().parseFromString(result.result,'text/html');
          const title=doc.querySelector('#detail-title, .note-content .title, .note-detail .title')?.textContent?.trim()
            ||doc.title.replace(/\s*[-–—|]\s*小红书.*$/,'').trim();
          album=extractNoteAlbum(state,note.id,note.href,/^小红书$/.test(title)?'':title);
        }
      }catch(e){onLog(`笔记 ${i+1}：尝试加载详情页（${e.message}）`);}
      if(isStopped())break;
      if(!video&&!album.length){ const windowId=api.tabs?.get ? (await api.tabs.get(sourceTab)).windowId : undefined; album=await render({...note,windowId},isStopped,api); }
      if(isStopped())break;
      if(album?.type==='video')video=true;
      if(video){skippedVideos++;videoIds.push(note.id);onLog(`已跳过视频笔记（不占图文篇数）：${note.id}`);}
      else {processed++;
      if(!album.length)throw new Error('未取得图集');
      images.push(...album.map(image=>({...image,noteOrder:processed})));success++;
      onLog(`图文笔记 ${processed}：取得 ${album.length} 张图集图片。`);
      }
    }catch(e){if(isStopped())break;if(processed<success+failures+1)processed++;failures++;failureReasons.push(e.message);onLog(`笔记 ${i+1} 图集读取失败：${e.message}${new URL(note.href).searchParams.has('xsec_token')?'':'（该链接缺少 xsec_token 访问参数）'}`);}
    if(i===unique.length-1&&loadMore&&maxNotes&&processed<maxNotes&&skippedVideos&&!isStopped()){
      const more=await loadMore(videoIds);for(const next of more||[])if(!seenIds.has(next.id)){seenIds.add(next.id);unique.push(next);}
    }
  }
  return {images,success,failures,skippedVideos,failureReasons,total:processed,stopped:isStopped()};
}
