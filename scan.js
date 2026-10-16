// Self-contained: Chrome serializes this function into each accessible frame.
export function scanPage({scope='page',selector,site='generic'}={}) {
  const results = new Map();
  const reject = /(?:^|[\/_.-])(favicon|logo|avatar|sprite|icon|emoji|badge)(?:[\/_.-]|$)/i;
  function valid(raw){if(typeof raw!=='string'||!raw.trim())return null;try{const url=new URL(raw,document.baseURI);return /^(https?:|data:image\/(?!svg)|blob:)/i.test(url.href)&&! /\.svg(?:[?#]|$)|image\/svg/i.test(url.href)&&!reject.test(url.href)?url.href:null;}catch{return null;}}
  function add(raw, el, width = 0, height = 0,alternatives=[]) {
    if (!raw) return;
    let url;
    try { url = new URL(raw, document.baseURI).href; } catch { return; }
    if (!/^(https?:|data:image\/(?!svg)|blob:)/i.test(url) || /\.svg(?:[?#]|$)|image\/svg/i.test(url) || reject.test(url)) return;
    if (width && height && Math.min(width, height) < 180&&!alternatives.length) return;
    const label = `${el.getAttribute('alt') || ''} ${el.getAttribute('title') || ''}`.trim().slice(0, 200);
    if (/^(logo|icon|avatar|图标|头像|标志)$/i.test(label)) return;
    const urls=[...new Set([url,...alternatives.map(valid).filter(Boolean)])];
    if (!results.has(url)) results.set(url, {url,urls,label:label||document.title,width,height,page:location.href,noteTitle:document.title});
  }
  function sourceSet(raw){
    // Responsive lists with data URLs cannot be safely comma-split; preserve currentSrc instead.
    if(!raw||/data:/i.test(raw))return [];
    const entries=[...raw.matchAll(/(\S+)\s+(\d+(?:\.\d+)?)[wx](?=\s*(?:,|$))/g)];
    if(entries.length)return entries.sort((a,b)=>Number(b[2])-Number(a[2])).map(m=>m[1].replace(/^,/,''));
    return raw.split(/,\s+/).map(s=>s.trim()).filter(Boolean);
  }
  if(site==='znztv'&&scope==='smart'){
    // Read only the current case's image URLs supplied by the page itself.
    const script=document.getElementById('__NEXT_DATA__'),caseId=location.pathname.match(/^\/detail\/(\d+)(?:\/|$)/)?.[1];
    try{
      const data=JSON.parse(script?.textContent||'null')?.props?.pageProps?.initialViewData?.data;
      if(caseId&&String(data?.caseInfo?.caseId)===caseId&&Array.isArray(data.contents)){
        for(const item of [...data.contents].sort((a,b)=>(a.sort??0)-(b.sort??0))){
          if(String(item.caseId)!==caseId||Number(item.type)!==0)continue;
          const urls=[item.imgUrlExplicit,item.imgUrl,...(item.caseImageList||[]).map(image=>image.url)].map(valid).filter(Boolean);
          if(urls.length)add(urls[0],script,0,0,urls.slice(1));
        }
        if(results.size)return {title:data.caseInfo.titleOrigin||document.title,page:location.href,scopeFound:true,images:[...results.values()]};
      }
    }catch{}
  }
  let selected=document,scopeFound=false;
  if(scope==='region'){
    try{selected=selector&&document.querySelector(selector);}catch{}
    if(!selected||selected===document)throw Error('框选区域已失效，请重新选择区域');scopeFound=true;
  }else if(scope==='smart'){
    const roots=[...document.querySelectorAll('article,[itemprop="articleBody"],[role="main"],main,.article-content,.article-body,.project-content,.case-content,.detail-content,.work-content,#content,#main')];
    if(site==='znztv')roots.unshift(...document.querySelectorAll('.detailCasePageContainer .detailInfoContentBox'));
    const score=el=>(el.matches('article,[itemprop="articleBody"],.article-content,.article-body,.project-content,.case-content,.detail-content,.work-content')?100:0)+Math.min(40,el.querySelectorAll('img,picture').length);
    selected=roots.sort((a,b)=>score(b)-score(a)).find(el=>el.querySelector('img,picture'))||document;
    scopeFound=selected!==document;
    if(!scopeFound)return {title:document.title,page:location.href,scopeFound:false,images:[]};
  }
  function visit(root) {
    for (const el of [...(root.nodeType===1?[root]:[]),...root.querySelectorAll('*')].slice(0,15000)) {
      if(results.size>=2000)break;
      if(scope==='smart'&&el.closest('header,nav,footer,aside,[class*="avatar"],[class*="recommend"],[class*="related"],[class*="comment"],[aria-label*="推荐"]'))continue;
      if (el.tagName === 'IMG') {
        const explicit=['data-original','data-origin','data-full','data-full-src','data-large','data-zoom-image','data-pin-media'].map(name=>el.getAttribute(name)).filter(Boolean);
        const link=el.closest('a[href]');let linked=link?.href;
        if(linked&&!/\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/i.test(linked))linked=null;
        const responsive=sourceSet(el.getAttribute('data-srcset')||el.getAttribute('srcset'));
        const picture=[...(el.closest('picture')?.querySelectorAll('source')||[])].flatMap(s=>sourceSet(s.getAttribute('data-srcset')||s.getAttribute('srcset')));
        const urls=[...explicit,linked,...responsive,...picture,el.getAttribute('data-src'),el.getAttribute('data-lazy-src'),el.getAttribute('data-lazy'),el.currentSrc,el.src].map(valid).filter(Boolean);
        if(urls.length)add(urls[0],el,0,0,urls.slice(1));
      }
      const bg = getComputedStyle(el).backgroundImage;
      for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) add(match[1], el);
      if (el.shadowRoot) visit(el.shadowRoot);
      if(el.tagName==='A'&&/^(bing-images|google-images|yandex-images)$/.test(site)){
        try{const u=new URL(el.href,document.baseURI);for(const key of ['imgurl','mediaurl','img_url'])if(u.searchParams.has(key))add(u.searchParams.get(key),el);}catch{}
        if(site==='bing-images')try{const data=JSON.parse(el.getAttribute('m')||'{}');if(data.murl)add(data.murl,el);}catch{}
      }
    }
  }
  visit(selected);
  if(scope==='page'){
    for(const meta of document.querySelectorAll('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]'))add(meta.content,meta);
    for(const script of document.querySelectorAll('script[type="application/ld+json"]')){
      if(script.textContent.length>1000000)continue;
      try{const data=JSON.parse(script.textContent);let visited=0;
        function walk(value,depth=0){if(!value||depth>8||++visited>3000)return;if(Array.isArray(value)){value.forEach(v=>walk(v,depth+1));return;}if(typeof value!=='object')return;
          const type=[value['@type']].flat();
          const picture=type.includes('ImageObject')?value.contentUrl||value.url:value.image;
          for(const image of [picture].flat().filter(Boolean))if(typeof image==='string')add(image,script);else if(image.contentUrl||image.url)add(image.contentUrl||image.url,script);
          for(const [key,v]of Object.entries(value))if(!['video','audio','thumbnailUrl'].includes(key))walk(v,depth+1);
        }walk(data);
      }catch{}
    }
  }
  return {title:document.title,page:location.href,scopeFound,images:[...results.values()]};
}
export function scrollImagePage(action,position){
  if(action==='position')return {x:scrollX,y:scrollY};
  if(action==='restore')window.scrollTo(position.x,position.y);
  if(action==='next')window.scrollBy(0,Math.max(500,innerHeight*.85));
}
export function pickImageRegion(){
  return new Promise(resolve=>{
    const box=document.createElement('div'),hint=document.createElement('div');
    box.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #8c623e;background:#8c623e18;';
    hint.textContent='点击要采集的内容区域 · Esc 取消';hint.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 20px;border-radius:8px;background:#fffdfa;color:#403b34;box-shadow:0 2px 20px #0003;font:14px sans-serif;pointer-events:none';
    document.documentElement.append(box,hint);let selected;
    const move=e=>{let el=e.target;if(el===box||el===hint)return;if(el.tagName==='IMG')el=el.parentElement;selected=el;const r=el.getBoundingClientRect();Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
    const finish=selector=>{clearTimeout(timer);document.removeEventListener('mousemove',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);box.remove();hint.remove();resolve({selector});};
    const click=e=>{e.preventDefault();e.stopImmediatePropagation();if(!selected)selected=e.target;if(!selected?.setAttribute)return;document.querySelectorAll('[data-interior-selected-region]').forEach(el=>el.removeAttribute('data-interior-selected-region'));const id='region-'+Date.now();selected.setAttribute('data-interior-selected-region',id);finish('[data-interior-selected-region="'+id+'"]');};
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(null);}};
    const timer=setTimeout(()=>finish(null),60000);document.addEventListener('mousemove',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true);
  });
}
