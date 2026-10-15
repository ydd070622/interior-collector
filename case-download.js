import {loadCaseHistory,saveCaseHistory,loadDirectoryCaseHistory,saveDirectoryCaseHistory,loadCaseLibraries,uniqueFile} from './files.js';
import {safeTitle,openNoteDirectory} from './note-paths.js';
import {fetchImage,convertImage} from './images.js';
import {sourceIdentity,originalSourceUrl,fingerprint,findCaseMatches,matchImages,refreshCaseRecord,readFolderHistory,removeLegacyFolderHistory} from './case-history.js';

export async function saveCases({selected,destination,downloads,format,quality,browserDownload,decide,status,log}) {
  const persist=records=>destination?saveDirectoryCaseHistory(destination,records):saveCaseHistory(records);
  let records=destination?await readFolderHistory(destination,status,await loadDirectoryCaseHistory(destination)):await loadCaseHistory();
  if(!destination){
    // Chrome may have deleted files since the last run. Never offer to merge into missing history.
    const live=[];
    for(const record of records){const images=[];for(const image of record.images){const [entry]=image.downloadId?await downloads.search({id:image.downloadId}):[];if(entry?.state==='complete'&&entry.exists!==false)images.push(image);}if(images.length)live.push({...record,images});}
    records=live;
  }
  await persist(records);
  if(destination)try{await removeLegacyFolderHistory(destination);}catch(e){log('历史已保存到插件，旧索引文件暂未移除：'+e.message);}
  const libraries=await loadCaseLibraries();
  let currentLibrary;
  for(const library of libraries){
    if(!destination&&!library.directory){currentLibrary=library;break;}
    if(destination&&library.directory){try{if(await destination.isSameEntry(library.directory)){currentLibrary=library;break;}}catch{}}
  }
  if(!currentLibrary)throw Error('保存位置尚未加入案例索引，请重新选择保存文件夹');
  currentLibrary.records=records;
  const persistLibrary=library=>library.directory?saveDirectoryCaseHistory(library.directory,library.records):saveCaseHistory(library.records);
  const groups=new Map();
  for(const item of selected){const key=sourceIdentity(item)||item.page||item.url;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  let success=0,failures=0,skipped=0;
  let next=records.reduce((n,r)=>Math.max(n,Number(r.folder?.match(/^(\d+)-/)?.[1]||0)),0);
  if(destination)for await(const [name,h]of destination.entries())if(h.kind==='directory')next=Math.max(next,Number(name.match(/^(\d+)-/)?.[1]||0));
  for(const [source,items]of groups){
    const incoming={source,title:items[0].noteTitle||items[0].label||'未命名案例',images:[]};
    for(const item of items){let bitmap;try{
      status('正在检查案例图片：'+incoming.title+' · '+(incoming.images.length+1)+'/'+items.length);
      ({bitmap}=await fetchImage(item.url));incoming.images.push({item,fp:await fingerprint(bitmap)});
    }catch(e){failures++;log('图片检查失败：'+e.message);}finally{bitmap?.close();}}
    if(!incoming.images.length)continue;
    const matches=libraries.flatMap(library=>findCaseMatches(incoming,library.records).map(m=>({...m,library,key:library.key+'|'+m.record.id})));
    matches.sort((a,b)=>Number(b.sameSource)-Number(a.sameSource)||b.pairs.length-a.pairs.length);
    let target=null,pairs=[],targetLibrary=currentLibrary;
    if(matches.length){
      const choice=await decide({title:incoming.title,total:incoming.images.length,matches:matches.map(m=>({
        id:m.key,libraryKey:m.library.key,title:m.record.title,folder:m.record.folder,location:m.library.name+'/'+m.record.folder,date:m.record.downloadedAt,sameSource:m.sameSource,shared:m.pairs.length,
        // Keep the original source identifiable even if images changed.
        examples:m.pairs.map(p=>({incoming:incoming.images[p.i].fp.preview,previous:m.record.images[p.j].fp.preview})),
        canMerge:!!m.record.folder,sourceUrls:m.record.sourceUrls||[]
      }))});
      if(choice.action==='skip'){skipped+=incoming.images.length;log('已跳过案例：'+incoming.title);continue;}
      if(choice.action==='merge'){
        const match=matches.find(m=>m.key===choice.targetId);if(!match)throw Error('案例匹配已变化，请重试');target=match.record;targetLibrary=match.library;pairs=match.pairs;
        if(targetLibrary.directory){
          if(await targetLibrary.directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('原文件夹未授权，请重新下载并选择单独保存或授权合并');
          // Refresh only the chosen case, so missing or changed files are never skipped on stale fingerprints.
          Object.assign(target,await refreshCaseRecord(targetLibrary.directory,target,status));pairs=matchImages(incoming.images,target.images);
        }else{
          const live=[];for(const image of target.images){const [entry]=image.downloadId?await downloads.search({id:image.downloadId}):[];if(entry?.state==='complete'&&entry.exists!==false)live.push(image);}
          target.images=live;pairs=matchImages(incoming.images,target.images);
        }
      }
    }
    if(!target)target={id:crypto.randomUUID(),title:incoming.title,folder:String(++next).padStart(2,'0')+'-'+safeTitle(incoming.title),images:[],sources:[],sourceUrls:[]};
    const duplicateIndexes=new Set(pairs.map(p=>p.i));
    let noteDirectory;
    const targetRecords=targetLibrary.records,targetDirectory=targetLibrary.directory;
    if(targetDirectory){
      if(targetRecords.includes(target))noteDirectory=await targetDirectory.getDirectoryHandle(target.folder);
      else {const map=new Map();const opened=await openNoteDirectory(targetDirectory,target.folder,map,source);noteDirectory=opened.directory;target.folder=opened.folder;}
    }
    let number=target.images.reduce((n,i)=>Math.max(n,Number(i.name?.match(/^(\d+)/)?.[1]||0)),0);
    if(noteDirectory)for await(const [name,h]of noteDirectory.entries())if(h.kind==='file')number=Math.max(number,Number(name.match(/^(\d+)/)?.[1]||0));
    let added=0;
    for(let i=0;i<incoming.images.length;i++){
      if(duplicateIndexes.has(i)){skipped++;continue;}
      const image=incoming.images[i];
      let bitmap;
      try{
        status('正在保存案例：'+incoming.title+' · '+(i+1)+'/'+incoming.images.length);
        ({bitmap}=await fetchImage(image.item.url));const blob=await convertImage(bitmap,format,quality);
        const entry={name:String(++number).padStart(3,'0')+'.'+format,fp:image.fp};
        if(noteDirectory){
          const file=await uniqueFile(noteDirectory,entry.name);entry.name=file.name;const w=await file.createWritable();
          try{await w.write(blob);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
          const saved=await file.getFile();entry.size=saved.size;entry.modified=saved.lastModified;
        }else{const download=await browserDownload(blob,target.folder+'/'+entry.name);entry.downloadId=download.id;entry.name=download.filename?.split(/[\\/]/).pop()||entry.name;}
        target.images.push(entry);added++;success++;
        if(!target.imported)target.downloadedAt=target.downloadedAt||new Date().toISOString();
        target.updatedAt=new Date().toISOString();
        target.sources=[...new Set([...target.sources,source])];
        target.sourceUrls=[...new Set([...target.sourceUrls,...items.map(originalSourceUrl).filter(Boolean)])];
        if(!targetRecords.includes(target))targetRecords.push(target);
      }catch(e){failures++;log('保存失败：'+image.item.url+' · '+e.message);}
      finally{bitmap?.close();}
      // Persist outside the image error handler: an index failure must stop the batch.
      if(added)await persistLibrary(targetLibrary);
    }
    if(targetRecords.includes(target)){
      if(pairs.length){target.sources=[...new Set([...target.sources,source])];target.sourceUrls=[...new Set([...target.sourceUrls,...items.map(originalSourceUrl).filter(Boolean)])];}
      await persistLibrary(targetLibrary);
    }
    log((pairs.length?'已合并到：':'已保存案例：')+target.folder+' · 新增 '+added+' 张');
  }
  return {success,failures,skipped};
}
