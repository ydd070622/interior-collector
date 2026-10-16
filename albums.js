// Run in the page MAIN world; only return note image metadata, never cookies or tokens unrelated to note links.
export function readXhsPage() {
  if (!/(^|\.)xiaohongshu\.com$/i.test(location.hostname)) return null;
  const root = window.__INITIAL_STATE__ || window.__NUXT__;
  const albums = new Map(), notes = [], seen = new WeakSet();
  const detailId = location.pathname.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/i)?.[1];
  const ids = new Set(), videoIds=new Set();
  if(detailId&&[...document.querySelectorAll('video')].some(el=>{const r=el.getBoundingClientRect();return r.width>100&&r.height>100&&getComputedStyle(el).visibility!=='hidden';}))videoIds.add(detailId);
  function addNote(id, href, position) {
    if (!id) return;
    const existing=notes.find(n=>n.id===id);
    if(existing) {
      if(!new URL(existing.href).searchParams.has('xsec_token') && new URL(href).searchParams.has('xsec_token'))existing.href=href;
      return;
    }
    ids.add(id); notes.push({id,href,...position});
  }
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href'),location.href);
      const id = u.pathname.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/i)?.[1];
      if (u.origin === location.origin && id) {
        const card=a.closest('.note-item,section[data-note-id],[data-note-id]') || a;
        if([...card.querySelectorAll('use')].some(el=>/play|video/i.test(el.getAttribute('href')||el.getAttribute('xlink:href')||'')))videoIds.add(id);
        if(card.querySelector('video,.video-icon,.play-icon,[class*="video-icon"],use[href*="play"],use[href*="video"],.video-player,[data-note-type="video"]'))videoIds.add(id);
        const rect=card.getBoundingClientRect();
        let scroll=window.scrollY;
        for(let parent=card.parentElement;parent&&parent!==document.body&&parent!==document.documentElement;parent=parent.parentElement)scroll+=parent.scrollTop;
        addNote(id,u.href,{visualTop:Math.round(rect.top+scroll),visualLeft:Math.round(rect.left)});
      }
    } catch {}
  }
  function titleFor(value,id) {
    const title=[value.title,value.displayTitle,value.display_title].find(t=>typeof t==='string'&&t.trim());
    if(title)return title.trim();
    if(id!==detailId)return '未命名笔记';
    const heading=document.querySelector('#detail-title, .note-content .title, .note-detail .title');
    const domTitle=heading?.textContent?.trim();
    if(domTitle)return domTitle;
    const pageTitle=(document.title||'').replace(/\s*[-–—|]\s*小红书.*$/,'').trim();
    return pageTitle&&!/^(小红书|小红书 - 你的生活指南)$/.test(pageTitle)?pageTitle:'未命名笔记';
  }
  let visited=0;
  function walk(value,depth=0,inheritedId) {
    if (!value || typeof value!=='object' || depth>18 || seen.has(value) || ++visited>30000) return;
    seen.add(value);
    const id=value.noteId || value.note_id || value.id || inheritedId;
    const card=value.noteCard||value.note_card;
    const kind=value.type||value.noteType||value.note_type||card?.type;
    if(String(kind).toLowerCase()==='video'||value.video?.media?.stream||card?.video?.media?.stream)videoIds.add(id);
    if(value.type==='video') {const videoId=id||value.noteCard?.noteId||value.noteCard?.id||value.note_card?.id;if(videoId)videoIds.add(videoId);}
    const token=value.xsecToken || value.xsec_token || value.noteCard?.xsecToken || value.note_card?.xsec_token;
    if(typeof id==='string' && ids.has(id) && typeof token==='string' && token) {
      const existing=notes.find(n=>n.id===id);
      const link=new URL(existing.href);
      if(!link.searchParams.has('xsec_token')) {
        link.searchParams.set('xsec_token',token);
        if(!link.searchParams.has('xsec_source'))link.searchParams.set('xsec_source','pc_user');
        addNote(id,link.href);
      }
    }
    const list=value.imageList || value.image_list;
    if (Array.isArray(list) && typeof id==='string' && /^[a-f0-9]{24}$/i.test(id) && (!detailId || id===detailId)) {
      const images=[];
      if (value.type !== 'video') for (let index=0;index<list.length;index++) {
        const image=list[index];
        const info=image.infoList || image.info_list || [];
        const preferred=info.filter(x => /original|WB_DFT/i.test(x.imageScene || x.image_scene || '')).map(x=>x.url);
        const urls=[...new Set([...preferred,image.urlDefault,image.url_default,image.url,...info.map(x=>x.url),image.urlPre].filter(x=>typeof x==='string'&&x).map(raw=>{try{const u=new URL(raw,location.href);if(u.protocol==='http:'&&/(^|\.)xhscdn\.com$/i.test(u.hostname))u.protocol='https:';return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}).filter(Boolean))];
        const raw=urls[0];
        if (typeof raw!=='string') continue;
        try {
          const url=new URL(raw.startsWith('//')?`https:${raw}`:raw,location.href);
          if (!/^https?:$/.test(url.protocol)) continue;
          images.push({url:url.href,urls,label:`${titleFor(value,id)} · ${index+1}/${list.length}`,width:0,height:0,page:location.href,noteId:id,noteTitle:titleFor(value,id),imageIndex:index,album:true});
        } catch {}
      }
      const previous=albums.get(id);
      if(images.length&&(!previous||images.length>previous.length))albums.set(id,images);
      else if(previous&&images.length===previous.length)for(let i=0;i<images.length;i++)previous[i].urls=[...new Set([...(previous[i].urls||[previous[i].url]),...images[i].urls])];
    }
    for (const [key,child] of Object.entries(value)) {
      if (/^(userInfo|author|comments|comment|recommend|recommendations)$/i.test(key)) continue;
      walk(child,depth+1,/^[a-f0-9]{24}$/i.test(key)?key:id);
    }
  }
  try { walk(root); } catch {}
  notes.sort((a,b)=>Math.round(a.visualTop/24)-Math.round(b.visualTop/24)||a.visualLeft-b.visualLeft);
  return {images:[...albums.values()].flat().filter(i=>!videoIds.has(i.noteId)),notes:notes.filter(n=>!videoIds.has(n.id)&&(!detailId||n.id===detailId)),skippedVideos:videoIds.size,videoNoteIds:[...videoIds].filter(Boolean),detailId,page:location.href};
}

// Parse a JSON-like hydration object without evaluating scripts from a website.
export function parseInitialState(html) {
  const match=/(?:window\.)?__INITIAL_STATE__\s*=\s*/g.exec(html);
  if(!match) throw new Error('详情页没有提供可读取的笔记数据');
  const start=html.indexOf('{',match.index+match[0].length);
  if(start<0) throw new Error('笔记数据结构无法识别');
  let depth=0,quoted=false,escaped=false,out='';
  for(let i=start;i<html.length;i++) {
    const c=html[i];
    if(quoted) { out+=c; if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue; }
    if(c==='"'){quoted=true;out+=c;continue;}
    if(html.startsWith('undefined',i) && !/[\w$]/.test(html[i-1] || '') && !/[\w$]/.test(html[i+9] || '')){out+='null';i+=8;continue;}
    out+=c;
    if(c==='{'||c==='[')depth++;
    else if(c==='}'||c===']'){depth--;if(depth===0)return JSON.parse(out);}
  }
  throw new Error('详情页笔记数据不完整');
}

export function extractNoteAlbum(state,id,page,fallbackTitle='') {
  if(getNoteType(state,id)==='video')return [];
  let images=[];const seen=new WeakSet();let visited=0;
  function walk(value,depth=0) {
    if(!value||typeof value!=='object'||depth>18||seen.has(value)||++visited>30000)return;
    seen.add(value);
    const noteId=value.noteId||value.note_id||value.id;
    const list=value.imageList||value.image_list;
    if(noteId===id&&Array.isArray(list)&&value.type!=='video') {
      const albumImages=[];
      const title=[value.title,value.displayTitle,value.display_title,fallbackTitle].find(t=>typeof t==='string'&&t.trim())?.trim()||'未命名笔记';
      for(let index=0;index<list.length;index++) {
        const image=list[index], info=image.infoList||image.info_list||[];
        const preferred=info.filter(x=>/original|WB_DFT/i.test(x.imageScene||x.image_scene||'')).map(x=>x.url);
        const urls=[...new Set([...preferred,image.urlDefault,image.url_default,image.url,...info.map(x=>x.url),image.urlPre].filter(x=>typeof x==='string'&&x).map(raw=>{try{const u=new URL(raw,page);if(u.protocol==='http:'&&/(^|\.)xhscdn\.com$/i.test(u.hostname))u.protocol='https:';return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}).filter(Boolean))];
        const raw=urls[0];
        if(typeof raw!=='string')continue;
        try { const url=new URL(raw.startsWith('//')?`https:${raw}`:raw,page);if(!/^https?:$/.test(url.protocol))continue;
          albumImages.push({url:url.href,urls,label:`${title} · ${index+1}/${list.length}`,width:0,height:0,page,noteId:id,noteTitle:title,imageIndex:index,album:true});
        }catch{}
      }
      if(albumImages.length>images.length)images=albumImages;
      else if(albumImages.length===images.length)for(let i=0;i<images.length;i++)images[i].urls=[...new Set([...(images[i].urls||[images[i].url]),...albumImages[i].urls])];
    }
    for(const child of Object.values(value))walk(child,depth+1);
  }
  walk(state);return images;
}

export function getNoteType(state,targetId){
 const seen=new WeakSet();let visited=0,video=false;
 function walk(value,depth=0,inheritedId){if(!value||typeof value!=='object'||depth>18||seen.has(value)||++visited>30000)return;seen.add(value);
 const id=value.noteId||value.note_id||value.id||inheritedId,card=value.noteCard||value.note_card;
 const kind=value.type||value.noteType||value.note_type||card?.type;
 if(id===targetId&&(String(kind).toLowerCase()==='video'||value.video?.media?.stream||card?.video?.media?.stream))video=true;
 for(const [key,child] of Object.entries(value))walk(child,depth+1,/^[a-f0-9]{24}$/i.test(key)?key:id);
 }walk(state);return video?'video':'unknown';
}

// Album slots identify a picture even when CDN hosts or resize parameters differ.
export function deduplicateImages(images) {
  const unique=new Map();
  for(const image of images) {
    const key=image.album&&image.noteId&&Number.isInteger(image.imageIndex)
      ?image.noteId+'|slot:'+image.imageIndex:(image.noteId||'')+'|url:'+image.url;
    if(!unique.has(key))unique.set(key,{...image,urls:[...new Set([image.url,...(image.urls||[])])]});
    else {const previous=unique.get(key);previous.urls=[...new Set([...(previous.urls||[previous.url]),image.url,...(image.urls||[])])];}
  }
  return [...unique.values()];
}
