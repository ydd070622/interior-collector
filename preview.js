export async function openImagePreview(item) {
  const params=new URLSearchParams({url:item.url,title:item.label||item.noteTitle||'原图预览'});
  const height=Math.min(screen.availHeight-60,1000);
  const ratio=item.width&&item.height?item.width/item.height:0.8;
  const width=Math.min(screen.availWidth-60,Math.max(540,Math.round(height*ratio)));
  try {
    await chrome.windows.create({url:chrome.runtime.getURL('preview.html')+'?'+params,type:'popup',width,height,
      left:Math.round(screen.availLeft+(screen.availWidth-width)/2),top:Math.round(screen.availTop+(screen.availHeight-height)/2),focused:true});
  } catch(error) {
    const status=document.getElementById('status');if(status)status.textContent='原图预览打开失败：'+error.message;
  }
}
export function enableImagePreview(image,item) {
  image.classList.add('preview-trigger');image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','预览原图：'+(item.label||item.noteTitle||'室内设计图片'));image.title='点击预览原图';
  image.onclick=()=>openImagePreview(item);
  image.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openImagePreview(item);}};
}
