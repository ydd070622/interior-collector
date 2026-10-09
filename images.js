export async function fetchImage(url) {
  const response = await fetch(url, {credentials:'include', signal:AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error(`图片请求失败 HTTP ${response.status}`);
  const blob = await response.blob();
  if (/svg/i.test(blob.type)) throw new Error('已排除 SVG 图片');
  if (blob.size > 64 * 1024 * 1024) throw new Error('图片超过 64MB，已跳过');
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 40000000) { bitmap.close(); throw new Error('图片超过 4000 万像素，已跳过'); }
  return {blob,bitmap};
}
export async function convertImage(bitmap, format, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (format === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
  ctx.drawImage(bitmap,0,0);
  return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), format === 'jpg' ? 'image/jpeg' : 'image/png', quality));
}
export async function thumbnail(bitmap) {
  const scale = Math.min(1, 448 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.85));
}
