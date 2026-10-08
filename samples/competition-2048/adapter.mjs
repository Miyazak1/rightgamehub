import {createGameHubClient} from '../../packages/web-game-sdk/src/index.mjs';
import {createTileMerge} from '../../packages/competition-rules/tile-merge-v1.mjs';

// Keep the original free-play state separate. Ranked runs use a fresh seed.
const sdk=createGameHubClient(),panel=document.createElement('section');panel.className='gamehub-competition';
panel.innerHTML='<div class="competition-actions"><button data-start>开始排行挑战</button><button data-finish disabled>提交本局</button><button data-free hidden>返回自由模式</button></div><p role="status">自由模式与排行挑战分别进行；登录后可开始排行挑战。</p>';
document.querySelector('.above-game').after(panel);
const startButton=panel.querySelector('[data-start]'),finishButton=panel.querySelector('[data-finish]'),freeButton=panel.querySelector('[data-free]'),status=panel.querySelector('[role=status]');
let manager,challenge=null,busy=false,startRequest=null;
const originalMove=GameManager.prototype.move,originalRestart=GameManager.prototype.restart;
const message=text=>{status.textContent=text;};
const controls=()=>{startButton.disabled=busy||Boolean(challenge&&!challenge.finished);finishButton.disabled=busy||!challenge||!challenge.moves.length||challenge.finished;freeButton.hidden=!challenge;freeButton.disabled=busy;};
const synchronize=()=>{
  const state=challenge.game.snapshot();manager.grid=new Grid(4);
  state.cells.forEach((value,index)=>{if(value)manager.grid.insertTile(new Tile({x:index%4,y:Math.floor(index/4)},value));});
  manager.score=state.score;manager.over=state.over;manager.won=state['max-tile']>=2048;manager.keepPlaying=true;manager.actuate();controls();
};
const errorText=error=>['AUTH_REQUIRED','UNAUTHORIZED','BRIDGE_CAPABILITY_NOT_GRANTED'].includes(error.code)?'请先在 GameHub 登录，再开始排行挑战。':error.message||'暂时无法连接，请重试。';
async function start(){
  if(busy||challenge&&!challenge.finished)return;busy=true;controls();message('正在准备本局挑战…');
  try{
    const boards=await sdk.competition.listBoards(),board=boards.find(row=>row.key==='classic-score');if(!board)throw new Error('当前版本尚未开放排行榜。');
    startRequest??=crypto.randomUUID();const run=await sdk.competition.start({boardId:board.id,requestId:startRequest});startRequest=null;
    const storage=challenge?.storage??manager.storageManager;
    challenge={run,board,game:createTileMerge(run.seed),moves:'',storage,finished:false};
    manager.storageManager={getBestScore:()=>0,setBestScore(){},getGameState:()=>null,setGameState(){},clearGameState(){}};
    manager.actuator.continueGame();synchronize();message('排行挑战中 · 可随时提交；最多 8192 步、2 小时。');
  }catch(error){message(errorText(error));}finally{busy=false;controls();}
}
async function finish(){
  if(busy||!challenge||challenge.finished||!challenge.moves)return;busy=true;controls();message('正在验证并保存成绩…');
  // Freeze the evidence even if the response is lost; retry submits exactly the same run.
  challenge.submission??={evidence:{format:'tile-merge-v1',moves:challenge.moves}};
  try{
    const result=await sdk.competition.finish(challenge.run.id,challenge.submission);challenge.finished=true;
    message(result.status==='accepted'?(result.channel==='preview'?'预览成绩已验证，不计入公开榜。':`成绩已保存：${result.metrics.score} 分。退出游戏后可在详情页查看排名。`):'本局成绩已被作废。');
  }catch(error){message(errorText(error)+' 点击“提交本局”可重试。');}finally{busy=false;controls();}
}
GameManager.prototype.move=function(direction){
  if(this!==manager||!challenge)return originalMove.call(this,direction);
  if(busy||challenge.finished||challenge.submission||challenge.moves.length>=8192)return;
  const action=['U','R','D','L'][direction];if(action&&challenge.game.move(action)){challenge.moves+=action;synchronize();if(challenge.game.snapshot().over||challenge.moves.length===8192)void finish();}
};
GameManager.prototype.restart=function(){if(this===manager&&challenge){if(!busy)message('排行挑战请先提交本局，或返回自由模式后重新开始。');return;}return originalRestart.call(this);};
manager=new GameManager(4,KeyboardInputManager,HTMLActuator,LocalStorageManager);
startButton.addEventListener('click',start);finishButton.addEventListener('click',finish);
freeButton.addEventListener('click',()=>{if(busy||!challenge)return;const previous=challenge;if(!previous.finished)sdk.competition.abandon(previous.run.id).catch(()=>{});challenge=null;manager.storageManager=previous.storage;manager.actuator.continueGame();manager.setup();message('已返回自由模式，恢复进入挑战前的进度。');controls();});
window.addEventListener('pagehide',()=>sdk.close(),{once:true});
