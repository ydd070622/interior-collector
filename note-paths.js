export function safeTitle(title) {
  return Array.from(String(title||'未命名笔记').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\s+/g,' ').trim()).slice(0,80).join('').replace(/[. ]+$/g,'')||'未命名笔记';
}
export function imageSavePath(item,all,format) {
  if(item.noteId) {
    const ids=[...new Set(all.filter(i=>i.noteId).map(i=>i.noteId))];
    const order=Number.isInteger(item.noteOrder)&&item.noteOrder>0?item.noteOrder:ids.indexOf(item.noteId)+1;
    const folder=`${String(Math.max(1,order)).padStart(2,'0')}-${safeTitle(item.noteTitle)}`;
    const index=Number.isInteger(item.imageIndex)?item.imageIndex+1:all.filter(i=>i.noteId===item.noteId).indexOf(item)+1;
    return {folder,name:`${String(Math.max(1,index)).padStart(3,'0')}.${format}`};
  }
  const host=new URL(item.page).hostname.replace(/[^a-z0-9.-]/gi,'_');
  return {folder:null,name:`${host}_${String(all.indexOf(item)+1).padStart(3,'0')}.${format}`};
}
