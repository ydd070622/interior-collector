import {env,pipeline,RawImage,CLIPVisionModelWithProjection} from './vendor/transformers.min.js';
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = new URL('./models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
const positive = [
  'a photograph of a designed living room interior',
  'a photograph of a bedroom interior design',
  'a photograph of a kitchen or bathroom interior design',
  'a photograph of a dining room or office interior design',
  'an architectural rendering of an interior room',
  'an interior design floor plan or room layout drawing',
  'a photograph of furniture and home decor in a room'
];
const negative = [
  'a website logo, icon or vector graphic', 'a portrait of a person',
  'a landscape or outdoor scenery photograph', 'an exterior of a building',
  'a product advertisement on a white background', 'a photograph of food',
  'a screenshot of text or a website interface', 'a photograph of fashion clothing',
  'a photograph of an animal or vehicle'
];
const labels=[...positive,...negative];
let initialized,textEmbeddings,vision,processor,scale;
const cache=new Map();
function normalize(data){const norm=Math.sqrt(data.reduce((s,x)=>s+x*x,0))||1;return Array.from(data,x=>x/norm);}
function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function prediction(embedding){
  const vector=normalize(embedding);
  const logits=textEmbeddings.map(text=>dot(text,vector)*scale);
  const p=Math.max(...logits.slice(0,positive.length)),n=Math.max(...logits.slice(positive.length));
  const confidence=1/(1+Math.exp(n-p));
  return {keep:confidence>=0.60,confidence,label:labels[logits.indexOf(Math.max(...logits))]};
}
async function evaluate(blob){
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
  if(cache.has(hash))return {...cache.get(hash),cached:true};
  const url=URL.createObjectURL(blob);
  try {
    const image=await RawImage.read(url);
    if(!initialized){
      self.postMessage({type:'progress',progress:{status:'stage',text:'初始化分类文字缓存（仅首次）…'}});
      const combined=await pipeline('zero-shot-image-classification','Xenova/clip-vit-base-patch32',{device:'wasm',dtype:'q8',progress_callback:progress=>self.postMessage({type:'progress',progress})});
      try {
        const text=combined.tokenizer(labels.map(x=>'This is a photo of '+x),{padding:true,truncation:true});
        processor=combined.processor;
        const output=await combined.model({...text,...await processor(image)});
        const dimension=output.text_embeds.dims[1];
        textEmbeddings=labels.map((_,i)=>normalize(output.text_embeds.data.slice(i*dimension,(i+1)*dimension)));
        const imageVector=normalize(output.image_embeds.data);
        // Preserve the learned scale from the original model, rather than guessing a constant.
        const cosines=textEmbeddings.map(t=>dot(t,imageVector));
        scale=cosines.reduce((s,c,i)=>s+c*output.logits_per_image.data[i],0)/cosines.reduce((s,c)=>s+c*c,0);
        if(!Number.isFinite(scale)||scale<=0)throw new Error('模型分类尺度无法校验');
        const first=prediction(output.image_embeds.data);
        cache.set(hash,first);initialized=true;
        return first;
      } finally {await combined.dispose();}
    }
    self.postMessage({type:'progress',progress:{status:'stage',text:'本地视觉推理 · 复用分类缓存…'}});
    vision ||= CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32',{device:'wasm',dtype:'q8'}).catch(e=>{vision=null;throw e;});
    const model=await vision;
    const output=await model(await processor(image));
    const result=prediction(output.image_embeds.data);
    if(cache.size>=2000)cache.delete(cache.keys().next().value);
    cache.set(hash,result);return result;
  } finally {URL.revokeObjectURL(url);}
}
self.onmessage=async({data})=>{
  const started=performance.now();
  try{const result=await evaluate(data.blob);self.postMessage({type:'result',id:data.id,...result,elapsedMs:Math.round(performance.now()-started)});}
  catch(e){self.postMessage({type:'error',id:data.id,error:e.message});}
};
self.postMessage({type:'ready'});
