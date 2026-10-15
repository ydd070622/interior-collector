// The prompt is rendered from engine state, so closing and reopening the window is safe.
export function renderCasePrompt(prompt,send) {
  let panel=document.getElementById('casePrompt');
  if(!panel){panel=document.createElement('section');panel.id='casePrompt';panel.className='case-prompt';panel.setAttribute('aria-label','案例重复提醒');document.getElementById('status').after(panel);}
  panel.hidden=!prompt;
  if(!prompt){panel.replaceChildren();delete panel.dataset.token;return;}
  if(panel.dataset.token===prompt.token)return;
  panel.dataset.token=prompt.token;panel.replaceChildren();
  const title=document.createElement('h3');title.textContent='这个案例可能下载过';
  title.title='本次案例：'+prompt.title;
  const select=document.createElement('select');select.setAttribute('aria-label','选择已下载案例');
  for(const match of prompt.matches){const option=document.createElement('option');option.value=match.id;option.textContent=match.title;select.append(option);}
  const detail=document.createElement('p'),folder=document.createElement('p'),examples=document.createElement('div');examples.className='case-examples';
  const buttons=document.createElement('div');buttons.className='case-actions';
  const error=document.createElement('p');error.setAttribute('role','alert');
  const merge=document.createElement('button');merge.textContent='合并到原案例';
  const separate=document.createElement('button');separate.textContent='单独保存';
  const skip=document.createElement('button');skip.textContent='跳过本案例';
  const chosen=()=>prompt.matches.find(m=>m.id===select.value);
  function update(){const m=chosen();title.textContent=m.sameSource?'这个案例下载过':'发现相似案例';detail.textContent=m.shared+' 张相似 · 合并可新增 '+(prompt.total-m.shared)+' 张';select.title='已有文件夹：'+(m.location||m.folder);folder.textContent='位置：'+(m.location||m.folder)+(m.date?' · '+new Date(m.date).toLocaleDateString('zh-CN'):'');folder.hidden=false;merge.disabled=!m.canMerge;examples.replaceChildren();
    for(const pair of m.examples){const row=document.createElement('div');for(const [label,url]of [['本次图片',pair.incoming],['已下载图片',pair.previous]]){if(!url)continue;const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=url;img.alt=label;caption.textContent=label;figure.append(img,caption);row.append(figure);}examples.append(row);}}
  select.onchange=update;
  for(const [button,action]of [[merge,'merge'],[separate,'separate'],[skip,'skip']]){button.type='button';button.onclick=async()=>{buttons.querySelectorAll('button').forEach(b=>b.disabled=true);try{await send({token:prompt.token,action,targetId:chosen().id});}catch(e){error.textContent=e.message;buttons.querySelectorAll('button').forEach(b=>b.disabled=false);update();}};}
  buttons.append(merge,separate,skip);panel.append(title,select,detail,folder,examples,buttons,error);update();
}
