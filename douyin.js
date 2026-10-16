// Self-contained: only the current photo post, never recommendations or video streams.
export function readDouyinPage(){
  const detailId=location.pathname.match(/^\/(?:note|video)\/(\d+)/)?.[1]||new URL(location.href).searchParams.get('modal_id');
  if(!detailId)return {images:[],detailId:null};
  let found=null,visited=0;
  function walk(value,depth=0){
    if(!value||typeof value!=='object'||depth>24||++visited>40000)return;
    const id=value.awemeId||value.aweme_id;
    if(String(id)===detailId&&Array.isArray(value.images)&&value.images.length){found=value;return;}
    for(const [key,child]of Object.entries(value))if(!/recommend|related|comment|author|music/i.test(key))walk(child,depth+1);
  }
  const render=document.getElementById('RENDER_DATA')?.textContent;
  if(render)try{walk(JSON.parse(decodeURIComponent(render)));}catch{}
  if(!found)for(const script of document.scripts){
    const text=script.textContent;if(!text.startsWith('self.__pace_f.push(')||!text.includes(detailId)||text.length>1500000)continue;
    try{const payload=JSON.parse(text.slice(text.indexOf('(')+1,text.lastIndexOf(')')))[1];if(typeof payload==='string'&&/^\w+:/.test(payload))walk(JSON.parse(payload.slice(payload.indexOf(':')+1)));}catch{}
    if(found)break;
  }
  const title=found?.desc||document.title.replace(/\s*[-–]\s*抖音.*$/,'');
  const rows=found?.images||[],images=[];
  for(const [index,row]of rows.entries()){
    const urls=[...new Set((row.urlList||row.url_list||[]).filter(raw=>{try{return /^https?:$/.test(new URL(raw).protocol);}catch{return false;}}))];
    if(!urls.length)continue;
    images.push({url:urls[0],urls,width:row.width||0,height:row.height||0,noteId:detailId,noteTitle:title,page:location.href,imageIndex:index,album:true,label:title+' · '+(index+1)+'/'+rows.length});
  }
  // DOM fallback remains confined to the current player and excludes recommendation covers.
  if(!images.length){
    const player=document.querySelector('[data-e2e="player-container"]');const groups=new Map();
    for(const img of player?.querySelectorAll('.dySwiperSlide img')||[]){
      const urls=[img.currentSrc,img.src].filter(Boolean);let identity;
      try{const u=new URL(urls[0]);if(!/(^|\.)douyinpic\.com$/.test(u.hostname))continue;identity=u.pathname.split('~')[0];}catch{continue;}
      if(!groups.has(identity))groups.set(identity,{url:urls[0],urls,noteId:detailId,noteTitle:title,page:location.href,imageIndex:groups.size,album:true,label:title});
    }
    images.push(...groups.values());
  }
  return {images,detailId,expectedCount:rows.length||images.length};
}
