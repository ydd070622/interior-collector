import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../library-window.js',import.meta.url),'utf8');
const {openLibraryWindow,collectorWindowId,isExtensionWindow,compactWindowBounds,LIBRARY_PAGE}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
// A maximised-ish collector on a 1920x1000 screen: the library lands against its right edge.
const collectorOnWideScreen={left:400,top:60,width:460,height:610,screenWidth:1920,screenHeight:1000};
const compact=compactWindowBounds(collectorOnWideScreen);
assert.equal(compact.left,400+460+10,'library hugs the collection window right edge');
assert.equal(compact.top,60);assert.equal(compact.width,880);
// Height follows the screen, not the collection window, so the last row of thumbnails is not cut off.
assert.equal(compact.height,888,'uses the full available screen height');
const shortCollector=compactWindowBounds({...collectorOnWideScreen,height:320});
assert.equal(shortCollector.height,888,'a short collection window must not shorten the library');
// No room on the right: move left instead of falling off screen, staying behind the collection window.
const rightEdge=compactWindowBounds({left:1200,top:30,width:200,height:700,screenWidth:1440,screenHeight:900});
assert.ok(rightEdge.left+rightEdge.width<=1440,'window stays on screen');
assert.ok(rightEdge.left<1200,'prefers the left side when the right edge has no room');
// A screen too narrow for the default width falls back to a smaller window instead of overflowing.
const narrowScreen=compactWindowBounds({left:0,top:20,width:460,height:600,screenWidth:700,screenHeight:900});
assert.equal(narrowScreen.width,720,'narrow host screen falls back to the minimum width');
assert.equal(narrowScreen.left,8,'never placed at a negative coordinate when the screen is too narrow');
const tiny=compactWindowBounds({left:0,top:0,width:400,height:500,screenWidth:800,screenHeight:600});
assert.ok(tiny.left>=8&&tiny.left+tiny.width<=800,'clamped to a small screen');
assert.ok(tiny.height<=600,'height never exceeds the screen');
// An unknown collection window still produces a usable, on-screen box.
const fallback=compactWindowBounds(null);
assert.ok(fallback.left>=8&&fallback.top>=8&&fallback.width===880);
console.log('PASS: library placement prefers right edge, falls back left, clamps to small screens');
let calls=[],existing=[],collector=null;
function makeApi(){
  const runtime={getURL:path=>'chrome-extension://test/'+path};
  return {runtime,tabs:{
    async query(filter){
      if(!filter||!filter.url)return [...existing,...(collector?[collector]:[])];
      const urls=Array.isArray(filter.url)?filter.url:[filter.url].filter(Boolean);
      if(urls.some(u=>String(u).includes(LIBRARY_PAGE)))return existing;
      if(urls.some(u=>String(u).includes('collector.html')))return collector?[collector]:[];
      return [];
    },
    async update(...args){calls.push(['tabUpdate',...args]);}
  },
  windows:{
    async get(id){if(collector&&collector.windowId===id)return{id,type:'popup',...collectorOnWideScreen};throw Error('no such window');},
    async create(options){calls.push(['create',options]);return{id:9};},
    async update(...args){calls.push(['focus',...args]);}
  }};
}
const api=makeApi();
// Opens a popup beside the collection window. chrome.windows.create must not receive windowId.
collector={id:5,windowId:3,url:'chrome-extension://test/collector.html?tab=1'};
calls=[];existing=[];
await openLibraryWindow(api);
assert.equal(calls.length,1);
assert.equal(calls[0][0],'create');
assert.equal(calls[0][1].type,'popup','library opens as a popup window');
assert.ok(calls[0][1].url.endsWith('library.html?view=compact'));
assert.equal(calls[0][1].left,870,'positioned against the collection window right edge');
assert.equal(calls[0][1].top,60);
assert.equal(calls[0][1].width,880,'the library opens wide enough to read');
assert.equal(calls[0][1].windowId,undefined,'windows.create() rejects windowId');
assert.equal(calls[0][1].focused,undefined,'placement comes from bounds only');
// Re-clicking focuses the existing window instead of stacking a second one.
calls=[];existing=[{id:7,windowId:4,url:'chrome-extension://test/library.html?view=compact'}];
await openLibraryWindow(api);
assert.deepEqual(calls,[['focus',4,{focused:true}]],'existing library window is reused');
// A library window left open on the plain URL is still reused.
calls=[];existing=[{id:8,windowId:5,url:'chrome-extension://test/library.html'}];
await openLibraryWindow(api);
assert.deepEqual(calls,[['focus',5,{focused:true}]]);
// A missing collection window still opens a library window rather than failing.
calls=[];existing=[];collector=null;
await openLibraryWindow(api);
assert.equal(calls[0][0],'create');
assert.equal(calls[0][1].left,1032,'falls back to the default screen when the collection window is gone');
assert.deepEqual(await collectorWindowId(makeApi()),null);
// Extension-owned windows are recognised by tab scan so they cannot become the collection source.
const ownTabs=[{id:1,windowId:11,url:'chrome-extension://test/collector.html?tab=9'},
  {id:2,windowId:12,url:'chrome-extension://test/library.html?view=compact'},
  {id:3,windowId:99,url:'https://www.xiaohongshu.com/explore/abc'}];
const guardApi={runtime:{getURL:path=>'chrome-extension://test/'+path},tabs:{async query(filter){
  if(filter&&filter.url)return ownTabs.filter(tab=>String(tab.url).startsWith(String(filter.url).replace(/\*$/,'')));
  return ownTabs;
}}};
assert.equal(await isExtensionWindow(guardApi,11),true,'collection window is extension-owned');
assert.equal(await isExtensionWindow(guardApi,12),true,'library window is extension-owned');
assert.equal(await isExtensionWindow(guardApi,99),false,'a normal browsing window is the valid collection source');
assert.equal(await isExtensionWindow(guardApi,null),false,'missing window id never matches');
assert.equal(await collectorWindowId(guardApi),11,'the collection window is found by scanning tabs');
console.log('PASS: popup beside the collection window, bounds-only placement, window reuse, missing collection window, extension-window guard');
