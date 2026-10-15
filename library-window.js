// Window placement for the material library, opened beside the collection window.
export const LIBRARY_PAGE='library.html';
export const COMPACT_QUERY='?view=compact';
const COMPACT={minWidth:720,width:880,maxWidth:1040,minHeight:460,maxHeight:920};
const SCREEN_MARGIN=8,GAP=10,CHROME_RESERVE=112,DEFAULT_SCREEN={width:1920,height:1080};
function readScreen(source) {
  const width=Number(source?.width)>0?Number(source.width):1280;
  const height=Number(source?.height)>0?Number(source.height):800;
  const screenWidth=Number(source?.screenWidth)>0?Number(source.screenWidth):Math.max(width,DEFAULT_SCREEN.width);
  const screenHeight=Number(source?.screenHeight)>0?Number(source.screenHeight):Math.max(height,DEFAULT_SCREEN.height);
  return {width,height,screenWidth,screenHeight,left:Number(source?.left)||0,top:Number(source?.top)||0};
}
// Prefer the right edge of the collection window, then the left, then overlap it.
// Height comes from the screen, never from the collection window: the library needs the full
// column or its last row of thumbnails gets cut off at the bottom.
export function placeBeside(source,prefs) {
  const area=readScreen(source);
  const maxHeight=Math.max(area.screenHeight-CHROME_RESERVE,prefs.minHeight);
  const height=Math.round(Math.min(prefs.maxHeight,maxHeight));
  // Never exceed what the screen can show; a screen narrower than the preferred minimum still
  // opens at that minimum, because a usable window matters more than a perfect fit.
  const room=Math.max(area.screenWidth-2*SCREEN_MARGIN,prefs.minWidth);
  let width=Math.round(Math.min(Math.max(prefs.width,prefs.minWidth),Math.min(prefs.maxWidth,room)));
  let left=area.left+area.width+GAP;
  if(left+width>area.screenWidth-SCREEN_MARGIN){
    const leftwards=area.left-GAP-width;
    left=leftwards>=SCREEN_MARGIN?leftwards:Math.max(SCREEN_MARGIN,Math.min(left,area.screenWidth-SCREEN_MARGIN-width));
  }
  const top=Math.min(Math.max(area.top,SCREEN_MARGIN),Math.max(SCREEN_MARGIN,area.screenHeight-SCREEN_MARGIN-height));
  return {left:Math.round(left),top:Math.round(top),width,height};
}
export function compactWindowBounds(source){return placeBeside(source,COMPACT);}
// Match our own pages by prefix instead of a tab URL filter: match patterns for
// chrome-extension:// URLs are unreliable, and the extension may always see its own tabs.
export async function extensionWindowIds(api) {
  const origin=api.runtime.getURL('');
  const ids=new Set();
  for(const tab of await api.tabs.query({}))if(String(tab.url||'').startsWith(origin)&&tab.windowId!=null)ids.add(tab.windowId);
  return ids;
}
async function ownPages(api,page) {
  const prefix=api.runtime.getURL(page);
  return (await api.tabs.query({})).filter(tab=>String(tab.url||'').startsWith(prefix));
}
// Place the library in the window that hosts the toolbar popup, so it lands beside the collection window.
export async function collectorWindowId(api) {
  const [tab]=await ownPages(api,'collector.html');
  return tab?.windowId??null;
}
export async function isExtensionWindow(api,windowId) {
  if(windowId==null)return false;
  return (await extensionWindowIds(api)).has(windowId);
}
export async function openLibraryWindow(api) {
  const prefix=api.runtime.getURL(LIBRARY_PAGE);
  const existing=(await api.tabs.query({})).find(tab=>String(tab.url||'').startsWith(prefix));
  if(existing){
    await api.windows.update(existing.windowId,{focused:true});
    return {reused:true};
  }
  const windowId=await collectorWindowId(api);
  let source=null;
  if(windowId!=null){try{source=await api.windows.get(windowId);}catch{source=null;}}
  // chrome.windows.create() has no windowId option; the popup is placed by absolute bounds instead.
  await api.windows.create({url:prefix+COMPACT_QUERY,type:'popup',...compactWindowBounds(source)});
  return {reused:false};
}
