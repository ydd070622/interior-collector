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
export async function uniqueFile(directory, name) {
  const dot = name.lastIndexOf('.');
  for (let i = 0; i < 10000; i++) {
    const candidate = i ? `${name.slice(0,dot)} (${i})${name.slice(dot)}` : name;
    try { await directory.getFileHandle(candidate); }
    catch (e) { if (e.name === 'NotFoundError') return directory.getFileHandle(candidate,{create:true}); throw e; }
  }
  throw new Error('同名文件过多，请更换保存目录');
}
