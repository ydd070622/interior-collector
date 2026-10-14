const params=new URLSearchParams(location.search);
const image=document.getElementById('original'),message=document.getElementById('message'),viewport=document.getElementById('viewport');
document.title=params.get('title')||'原图预览';image.alt=document.title;
document.getElementById('close').onclick=()=>window.close();
document.addEventListener('keydown',event=>{if(event.key==='Escape')window.close();});
image.onclick=()=>viewport.classList.toggle('actual');
image.onload=()=>{message.hidden=true;};
image.onerror=()=>{message.hidden=false;message.textContent='原图加载失败，请重新扫描后重试';};
try {const url=new URL(params.get('url'));if(!/^https?:$/.test(url.protocol))throw Error();image.src=url.href;}
catch {message.textContent='原图地址无效';}
