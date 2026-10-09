import {api as chrome} from './background-api.js';
import {readXhsPage} from './albums.js';
export function moveNoteList(restore) {
  const candidates=[...document.querySelectorAll('main,section,div')].filter(el=>{
    const r=el.getBoundingClientRect();return r.width>250&&r.height>250&&el.scrollHeight>el.clientHeight+50&&/auto|scroll/.test(getComputedStyle(el).overflowY);
  }).sort((a,b)=>b.clientHeight*b.clientWidth-a.clientHeight*a.clientWidth);
  const target=candidates[0]||document.scrollingElement;
  if(!target)return {top:0};
  const previous=target.scrollTop;
  target.scrollTop=restore===undefined?Math.min(target.scrollHeight,target.scrollTop+Math.max(500,target.clientHeight*0.85)):restore;
  return {top:previous};
}
export async function discoverListNotes({sourceTab,initial,isStopped,onProgress,api=chrome,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxRounds=100,maxNotes=null,excludeIds=[],readPage=readXhsPage,advancePage=advanceListPage}) {
  const excluded=new Set([...excludeIds,...(initial.videoNoteIds||[])]);
  const notes=new Map(initial.notes.filter(n=>n.type!=='video'&&!excluded.has(n.id)).map(n=>[n.id,n]));let pageIndex=0;const originalTab=await api.tabs.get(sourceTab);let navigated=false;
  let stable=0,original,reason='达到自动加载时间上限';
  try {
    if(maxNotes) {
      const [position]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:moveNoteList,args:[0]});
      original=position.result?.top||0;await wait(1200);
      const [first]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readPage});
      for(const id of first.result?.videoNoteIds||[])excluded.add(id);
      notes.clear();for(const n of first.result?.notes||[])if(n.type!=='video'&&!excluded.has(n.id))notes.set(n.id,n);
    }
    for(let round=0;round<maxRounds&&!isStopped();round++) {
      if(maxNotes&&notes.size>=maxNotes){reason='已达到设定的 '+maxNotes+' 篇图文笔记';break;}
      onProgress(`自动加载笔记列表 · 已发现 ${notes.size} 篇图文笔记`);
      const [position]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:moveNoteList});
      original??=position.result?.top||0;
      await wait(1200);
      if(isStopped()){reason='用户停止加载';break;}
      const [result]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readPage});
      const before=notes.size;
      for(const id of result.result?.videoNoteIds||[]){excluded.add(id);notes.delete(id);}
      for(const note of result.result?.notes||[]) {
        if(note.type==='video'||excluded.has(note.id))continue;
        const existing=notes.get(note.id);
        if(!existing||(!new URL(existing.href).searchParams.has('xsec_token')&&new URL(note.href).searchParams.has('xsec_token')))notes.set(note.id,{...note,visualTop:existing?.visualTop??((note.visualTop||0)+pageIndex*10000000),visualLeft:existing?.visualLeft??note.visualLeft});
      }
      stable=notes.size===before?stable+1:0;
      if(stable>=3){
        const signature=(result.result?.notes||[]).map(n=>n.id).join('|');
        const [next]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:advancePage});
        if(!next.result){reason='列表已到底或没有可识别的下一页';break;}
        navigated=true;let changed;
        for(let attempt=0;attempt<20&&!isStopped();attempt++){await wait(600);try{const [r]=await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:readPage});if(r.result?.notes?.length&&r.result.notes.map(n=>n.id).join('|')!==signature){changed=r.result;break;}}catch{}}
        if(!changed){reason='下一页未加载成功，可能需要验证';break;}
        pageIndex++;stable=0;
        for(const id of changed.videoNoteIds||[]){excluded.add(id);notes.delete(id);}
        for(const n of changed.notes||[])if(!excluded.has(n.id)&&n.type!=='video'&&!notes.has(n.id))notes.set(n.id,{...n,visualTop:(n.visualTop||0)+pageIndex*10000000});
      }
    }
    if(isStopped())reason='用户停止加载';
  }finally{
    if(navigated){await api.tabs.update(sourceTab,{url:originalTab.url});for(let i=0;i<20;i++){await wait(300);if((await api.tabs.get(sourceTab)).status==='complete')break;}}
    if(original!==undefined)await api.scripting.executeScript({target:{tabId:sourceTab},world:'MAIN',func:moveNoteList,args:[original]}).catch(()=>{});
  }
  return {notes:[...notes.values()].sort((a,b)=>(Math.round((a.visualTop ?? 0)/24)-Math.round((b.visualTop ?? 0)/24)) || ((a.visualLeft ?? 0)-(b.visualLeft ?? 0))).slice(0,maxNotes||undefined),reason};
}

export function advanceListPage(){
 const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!/disabled/i.test(el.className||'');};
 const regions=[...document.querySelectorAll('[class*="pagination"],[class*="Pagination"],[class*="pager"],[class*="Pager"],.pageturning,.page-list,.page-box,[class*="pageList"],[class*="pageBox"],nav[aria-label*="分页"],nav[aria-label*="pagination"]')];
 const all=[...new Set([...document.querySelectorAll('a[rel="next"],button[aria-label*="下一页"],a[aria-label*="下一页"]'),...regions.flatMap(el=>[...el.querySelectorAll('a,button')])])].filter(visible);
 let next=all.find(el=>el.getAttribute('rel')==='next'||/下一页|next page|^next$|^[›»>]$/i.test((el.getAttribute('aria-label')||el.textContent||'').trim())||/(?:^|[-_ ])next(?:$|[-_ ])/i.test(el.className||''));
 if(!next){for(const region of regions){const active=region.querySelector('[aria-current="page"],.active,.current,[class*="active"]');const number=Number(active?.textContent?.trim());if(number>0)next=[...region.querySelectorAll('a,button')].find(el=>visible(el)&&Number(el.textContent.trim())===number+1);if(next)break;}}
 if(!next)return false;next.click();return true;
}
