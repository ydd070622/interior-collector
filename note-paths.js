export function safeTitle(title) {
  return Array.from(String(title||'未命名笔记').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\s+/g,' ').trim()).slice(0,80).join('').replace(/[. ]+$/g,'')||'未命名笔记';
}
export function allocateNoteFolders(all, existing=[]) {
  const folders=new Map(), byTitle=new Map();let next=0;
  for(const name of existing) {
    const match=/^(\d+)-(.+)$/.exec(name);
    if(!match)continue;
    next=Math.max(next,Number(match[1]));
    if(!byTitle.has(match[2]))byTitle.set(match[2],name);
  }
  for(const item of all) {
    if(!item.noteId||folders.has(item.noteId))continue;
    const title=safeTitle(item.noteTitle);
    const reused=byTitle.get(title);
    folders.set(item.noteId,reused||`${String(++next).padStart(2,'0')}-${title}`);
    if(reused)byTitle.delete(title);
  }
  return folders;
}
export async function destinationNoteFolders(all,directory,downloads) {
  const existing=[];
  if(directory) {
    for await(const [name,handle] of directory.entries())if(handle.kind==='directory')existing.push(name);
  } else {
    const history=await downloads.search({filenameRegex:'[\\\\/]室内灵感[\\\\/]'});
    for(const item of history) {
      const match=/[\\/]室内灵感[\\/]([^\\/]+)[\\/]/.exec(item.filename||'');
      if(match)existing.push(match[1]);
    }
  }
  return allocateNoteFolders(all,existing);
}
export function imageSavePath(item,all,format,folders) {
  if(item.noteId) {
    const ids=[...new Set(all.filter(i=>i.noteId).map(i=>i.noteId))];
    const order=Number.isInteger(item.noteOrder)&&item.noteOrder>0?item.noteOrder:ids.indexOf(item.noteId)+1;
    const folder=folders?.get(item.noteId)||`${String(Math.max(1,order)).padStart(2,'0')}-${safeTitle(item.noteTitle)}`;
    const index=Number.isInteger(item.imageIndex)?item.imageIndex+1:all.filter(i=>i.noteId===item.noteId).indexOf(item)+1;
    return {folder,name:`${String(Math.max(1,index)).padStart(3,'0')}.${format}`};
  }
  const host=new URL(item.page).hostname.replace(/[^a-z0-9.-]/gi,'_');
  return {folder:null,name:`${host}_${String(all.indexOf(item)+1).padStart(3,'0')}.${format}`};
}

export async function openNoteDirectory(destination,folder,folders,noteId) {
  try { return {directory:await destination.getDirectoryHandle(folder,{create:true}),folder}; }
  catch(error) {
    if(!/Name is not allowed/i.test(error.message||''))throw error;
    // Retain readable text while dropping punctuation and symbols rejected by the browser.
    const prefix=folder.match(/^\d+-/)?.[0]||'';
    const title=folder.slice(prefix.length).replace(/[^\p{L}\p{N} _-]/gu,'').trim().replace(/[. ]+$/g,'')||'未命名笔记';
    const fallback=prefix+title;
    if(fallback===folder)throw error;
    const directory=await destination.getDirectoryHandle(fallback,{create:true});
    folders.set(noteId,fallback);
    return {directory,folder:fallback};
  }
}
