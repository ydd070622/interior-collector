import {loadDirectoryCaseHistory,saveDirectoryCaseHistory,withCaseHistoryLock,replaceCaseLibraryDirectory} from './files.js';
import {readFolderHistory,removeLegacyFolderHistory,resolveCaseDirectory} from './case-history.js';

export function flattenLibraries(libraries) {
  return libraries.flatMap(library=>(library.records||[]).filter(record=>record.images?.length).map(record=>({
    key:encodeURIComponent(library.key)+'|'+encodeURIComponent(record.id),library,record,
    location:[library.name,record.folder].filter(Boolean).join('／')
  })));
}
export function caseDateLabel(record) {
  for(const [value,prefix]of [[record.downloadedAt,''],[record.importedAt,'导入于 ']]){
    if(!value)continue;
    const date=new Date(value);if(Number.isFinite(date.getTime()))return prefix+date.toLocaleDateString('zh-CN');
  }
  return '日期未知';
}
// The leading number of the folder name is the download order, so it is the natural material order.
export function folderNumber(record) {
  const match=String(record?.folder||'').match(/^(\d+)/);
  return match?Number(match[1]):-1;
}
function newestFirst(a,b) {
  return String(b.record.updatedAt||b.record.downloadedAt||'').localeCompare(String(a.record.updatedAt||a.record.downloadedAt||''));
}
// Unknown folder numbers sort last, which keeps hand-made folders out of the numbered list.
function byFolderNumber(direction) {
  return (a,b)=>{
    const left=folderNumber(a.record),right=folderNumber(b.record);
    if(left!==right){
      if(left<0)return 1;
      if(right<0)return -1;
      return direction*(left-right);
    }
    return String(a.record.folder).localeCompare(String(b.record.folder),'zh-CN',{numeric:true});
  };
}
export function selectLibraryCases(entries,{folder='all',query='',sort='folder-desc'}={}) {
  const text=query.trim().toLocaleLowerCase();
  return entries.filter(entry=>(folder==='all'||entry.library.key===folder)&&(!text||[
    entry.record.title,entry.location,...(entry.record.sourceUrls||[]),...(entry.record.images||[]).map(i=>i.name)
  ].join(' ').toLocaleLowerCase().includes(text))).sort((a,b)=>{
    if(sort==='name')return String(a.record.title).localeCompare(String(b.record.title),'zh-CN');
    if(sort==='folder-asc')return byFolderNumber(1)(a,b);
    if(sort==='recent')return newestFirst(a,b)||byFolderNumber(-1)(a,b);
    return byFolderNumber(-1)(a,b)||newestFirst(a,b);
  });
}
export function safePreview(image) {
  const preview=image?.fp?.preview;
  return typeof preview==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(preview)?preview:null;
}
export async function readLibraryImage(entry,image,{request=false}={}) {
  if(!entry.library.directory)throw Error('默认下载记录仅有历史缩略图；请导入下载文件夹以读取原图');
  const root=entry.library.directory;
  const permission=await root[request?'requestPermission':'queryPermission']({mode:'read'});
  if(permission!=='granted')throw new DOMException('请授权读取该素材文件夹','NotAllowedError');
  if(!image.name||/[\\/]/.test(image.name)||image.name==='.'||image.name==='..')throw Error('图片名称不合法');
  const directory=await resolveCaseDirectory(root,entry.record.folder);
  return (await directory.getFileHandle(image.name)).getFile();
}
export async function importLibraryDirectory(directory,onProgress=()=>{}) {
  onProgress('等待当前下载完成后更新素材索引…');
  return withCaseHistoryLock(async()=>{
    const records=await readFolderHistory(directory,onProgress,await loadDirectoryCaseHistory(directory));
    if(!records.length)throw Error('该文件夹及子文件夹中没有可读取的图片');
    await saveDirectoryCaseHistory(directory,records);
    try{await removeLegacyFolderHistory(directory);}catch(e){onProgress('已导入；旧索引文件暂未移除：'+e.message);}
    return records;
  });
}
export async function relinkLibraryDirectory(library,directory,onProgress=()=>{}) {
  onProgress('等待当前下载完成后重新关联…');
  return withCaseHistoryLock(async()=>{
    let found=false;
    for(const record of library.records){try{const folder=await resolveCaseDirectory(directory,record.folder);for(const image of record.images||[]){try{await folder.getFileHandle(image.name);found=true;break;}catch{}}}catch{}if(found)break;}
    if(!found)throw Error('未找到原案例图片，请选择移动后的原素材根目录；其他素材请使用导入');
    const records=await readFolderHistory(directory,onProgress,library.records);
    await replaceCaseLibraryDirectory(library.key,directory);
    await saveDirectoryCaseHistory(directory,records);
    return records;
  });
}
