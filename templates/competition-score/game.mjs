import {createGameHubClient} from '../../packages/web-game-sdk/src/index.mjs';
const sdk=createGameHubClient(),start=document.querySelector('#start'),target=document.querySelector('#target'),submit=document.querySelector('#submit'),status=document.querySelector('#status');
let run,clicks=0,started=0,metrics,requestId;
const requestKey=()=>{
  if(crypto.randomUUID)return crypto.randomUUID();
  // Opaque sandbox frames may lack randomUUID even though getRandomValues is available.
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
start.onclick=async()=>{
  start.disabled=true;status.textContent='正在准备挑战…';
  try{await sdk.connect();const boards=await sdk.competition.listBoards();requestId??=requestKey();run=await sdk.competition.start({boardId:boards.find(board=>board.key==='quick-click').id,requestId});requestId=null;clicks=0;metrics=null;started=performance.now();target.textContent='点击 0 / 10';target.disabled=false;submit.disabled=true;status.textContent='开始点击！';}
  catch(error){status.textContent=error.message;start.disabled=false;}
};
target.onclick=()=>{clicks++;target.textContent=`点击 ${clicks} / 10`;if(clicks===10){target.disabled=true;metrics={duration:Math.round(performance.now()-started),clicks};submit.disabled=false;}};
submit.onclick=async()=>{submit.disabled=true;status.textContent='正在提交…';try{await sdk.competition.finish(run.id,{metrics});status.textContent='已保存。退出游戏后可在详情页查看本游戏的榜单。';start.disabled=false;}catch(error){status.textContent=error.message+'，可点击提交重试。';submit.disabled=false;}};
start.disabled=false;
