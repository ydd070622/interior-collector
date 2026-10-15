let database;
async function db() {
  if (!database) database = new Promise((resolve,reject) => {
    const request = indexedDB.open('interior-collector', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function loadDirectory() {
  const database = await db();
  return new Promise((resolve,reject) => {
    const r = database.transaction('settings').objectStore('settings').get('directory');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function saveDirectory(handle) {
  const database = await db();
  return new Promise((resolve,reject) => {
    const tx = database.transaction('settings','readwrite');
    tx.objectStore('settings').put(handle, 'directory');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
export async function loadCaseHistory() {
  const database = await db();
  return new Promise((resolve,reject) => {
    const r=database.transaction('settings').objectStore('settings').get('case-history');
    r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);
  });
}
export async function saveCaseHistory(records) {
  const database = await db();
  return new Promise((resolve,reject) => {
    const tx=database.transaction('settings','readwrite');
    tx.objectStore('settings').put(records,'case-history');
    tx.oncomplete=()=>{notifyCaseHistoryChanged();resolve();};tx.onerror=()=>reject(tx.error);
  });
}
async function readSetting(key) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const request=database.transaction('settings').objectStore('settings').get(key);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function writeSetting(key,value) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('settings','readwrite');tx.objectStore('settings').put(value,key);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('索引保存中断'));
  });
}
async function directoryHistoryKey(directory) {
  const entries=await readSetting('case-directories')||[];
  for(const entry of entries){try{if(await directory.isSameEntry(entry.handle))return 'case-directory:'+entry.id;}catch{/* A removed folder must not block other libraries. */}}
  const id=crypto.randomUUID();entries.push({id,handle:directory});
  await writeSetting('case-directories',entries);return 'case-directory:'+id;
}
export async function loadDirectoryCaseHistory(directory) {
  return readSetting(await directoryHistoryKey(directory));
}
export async function saveDirectoryCaseHistory(directory,records) {
  await writeSetting(await directoryHistoryKey(directory),records);
  notifyCaseHistoryChanged();
}
function notifyCaseHistoryChanged(){try{const channel=new BroadcastChannel('interior-case-history');channel.postMessage('updated');channel.close();}catch{}}
export function withCaseHistoryLock(operation) {
  return globalThis.navigator?.locks?.request?globalThis.navigator.locks.request('interior-case-history-write',operation):operation();
}
export async function replaceCaseLibraryDirectory(key,directory) {
  const entries=await readSetting('case-directories')||[];
  const entry=entries.find(e=>'case-directory:'+e.id===key);
  if(!entry)throw Error('找不到原文件夹记录');
  for(const other of entries)if(other!==entry){let same=false;try{same=await directory.isSameEntry(other.handle);}catch{}if(same)throw Error('该文件夹已属于其他素材目录，请从左侧选择');}
  entry.handle=directory;await writeSetting('case-directories',entries);notifyCaseHistoryChanged();
}
// Enumerate stored fingerprints only; other roots are not rescanned for every download.
export async function loadCaseLibraries() {
  const entries=await readSetting('case-directories')||[];
  const libraries=[{key:'case-history',name:'默认下载／室内灵感',directory:null,records:await loadCaseHistory()}];
  for(const entry of entries){
    const key='case-directory:'+entry.id;
    libraries.push({key,name:entry.handle.name||'保存文件夹',directory:entry.handle,records:await readSetting(key)||[]});
  }
  return libraries;
}
export async function caseLibraryDirectory(key) {
  if(key==='case-history')return null;
  const entries=await readSetting('case-directories')||[];
  const entry=entries.find(e=>'case-directory:'+e.id===key);
  if(!entry)throw new Error('找不到原保存文件夹，请重新选择该文件夹建立索引');
  return entry.handle;
}
export async function uniqueFile(directory, name) {
  const dot = name.lastIndexOf('.');
  for (let i = 0; i < 10000; i++) {
    const candidate = i ? `${name.slice(0,dot)} (${i})${name.slice(dot)}` : name;
    try { await directory.getFileHandle(candidate); }
    catch (e) { if (e.name === 'NotFoundError') return directory.getFileHandle(candidate,{create:true}); throw e; }
  }
  throw new Error('同名文件过多，请更换保存目录');
}
