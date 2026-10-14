export async function resolveCurrentPage(api,preferredWindowId) {
  const windows=await api.windows.getAll({populate:true,windowTypes:['normal']});
  let last;
  try { last=await api.windows.getLastFocused({windowTypes:['normal']}); } catch {}
  const window=windows.find(w=>w.focused)
    ||windows.find(w=>w.id===preferredWindowId)
    ||windows.find(w=>w.id===last?.id)
    ||windows[0];
  const tab=window?.tabs?.find(t=>t.active);
  if(!tab)throw new Error('没有找到当前网页，请先在浏览器打开要采集的页面');
  if(!/^https?:/i.test(tab.url||''))throw new Error('请先切换到要采集的普通网页，再点击重新扫描');
  return tab;
}
