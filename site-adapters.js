// Site-specific albums remain isolated; all other pages can use the same image pipeline.
const adapters=[
  {id:'xiaohongshu',label:'小红书图集',hosts:['xiaohongshu.com'],album:true},
  {id:'zcool',label:'站酷作品',hosts:['zcool.com.cn'],album:true},
  {id:'cool-de',label:'室内设计联盟',hosts:['cool-de.com'],album:true},
  {id:'douyin',label:'抖音图集',hosts:['douyin.com'],album:true},
  {id:'znztv',label:'知末案例',hosts:['news.znztv.com']},
  {id:'bing-images',label:'Bing 图片页面',hosts:['bing.com']},
  {id:'google-images',label:'Google 图片页面',hostPattern:/(^|\.)google\.[a-z.]+$/i},
  {id:'yandex-images',label:'Yandex 图片页面',hosts:['yandex.com','yandex.ru']},
  {id:'generic',label:'通用图片提取',hosts:[]}
];
export function getSiteAdapter(raw){
  let host;try{host=new URL(raw).hostname.toLowerCase();}catch{return adapters.at(-1);}
  return adapters.find(a=>a.hosts?.some(h=>host===h||host.endsWith('.'+h))||a.hostPattern?.test(host))||adapters.at(-1);
}
export function isLargeImage(width,height){
  return Number.isFinite(width)&&Number.isFinite(height)&&
    (Math.min(width,height)>=600||Math.min(width,height)>=400&&Math.max(width,height)>=1000);
}
