import {createCoursewareEmbedHostV2} from '/sdk/index-v2.mjs';

const frame=document.querySelector('[data-courseware-frame]');
const status=document.querySelector('[data-status]');
const events=document.querySelector('[data-events]');
const eventCount=document.querySelector('[data-event-count]');
const localeButtons=[...document.querySelectorAll('[data-locale]')];
const stateTransfer=document.createElement('textarea');
stateTransfer.className='state-transfer';
stateTransfer.dataset.stateTransfer='';
stateTransfer.setAttribute('aria-label','课件状态快照 JSON');
stateTransfer.placeholder='导出的 Embed v2 状态会显示在这里，也可粘贴另一个宿主导出的状态。';
document.querySelector('.diagnostic-popover')?.insertBefore(stateTransfer,events);

const updateCount=()=>{if(eventCount)eventCount.textContent=String(events.children.length);};
const log=(name,payload)=>{
  const item=document.createElement('li');
  const label=document.createElement('strong');
  const value=document.createElement('span');
  label.textContent=name;
  value.textContent=JSON.stringify(payload);
  item.append(label,value);
  events.prepend(item);
  while(events.children.length>30)events.lastElementChild.remove();
  updateCount();
};

let lastState=null;
const host=createCoursewareEmbedHostV2({frame,expectedOrigin:new URL(frame.src).origin});
host.on('connection.ready',()=>{
  status.dataset.state='connected';
  status.querySelector('span').textContent='安全连接已建立';
});
host.on('*',event=>log(event.name,event.payload));
host.on('connection.closed',payload=>{
  status.dataset.state='closed';
  status.querySelector('span').textContent=`连接关闭 · ${payload.reason}`;
});

frame.addEventListener('load',()=>host.connect(),{once:true});
host.connect();

for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{
  const name=button.dataset.command;
  const payload=button.dataset.value?JSON.parse(button.dataset.value):{};
  if(button.dataset.locale){
    for(const candidate of localeButtons)candidate.setAttribute('aria-pressed',String(candidate===button));
  }
  host.command(name,payload).then(result=>{
    if(result){if(name==='host.exportState'){lastState=result;stateTransfer.value=JSON.stringify(result);}log(`${name}.response`,result);}
  }).catch(error=>log(`${name}.error`,{code:error.code}));
});

for(const button of document.querySelectorAll('[data-state-action]'))button.addEventListener('click',()=>{
  if(button.dataset.stateAction==='export')host.command('host.exportState',{}).then(result=>{lastState=result;stateTransfer.value=JSON.stringify(result);log('host.exportState.response',result);}).catch(error=>log('host.exportState.error',{code:error.code}));
  else{let candidate=lastState;try{if(stateTransfer.value.trim())candidate=JSON.parse(stateTransfer.value);}catch{log('host.restoreState.error',{code:'STATE_JSON_INVALID'});return;}if(candidate)host.command('host.restoreState',candidate).then(()=>{lastState=candidate;log('host.restoreState.applied',{experienceMode:candidate.experienceMode});}).catch(error=>log('host.restoreState.error',{code:error.code}));else log('host.restoreState.error',{code:'NO_STATE_EXPORTED'});}
});

document.querySelector('[data-clear-events]')?.addEventListener('click',()=>{
  events.replaceChildren();
  updateCount();
});

addEventListener('pagehide',()=>host.close('page_hidden'),{once:true});
