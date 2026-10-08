import React,{useEffect,useRef,useState} from 'react';
import {leaderboardToday,workLeaderboardPath,workLeaderboards} from './work-leaderboards.mjs';

const scoreText = (entry,metrics) => metrics.map(metric=>`${metric.label} ${entry.scores[metric.key]} ${metric.unit}`).join(' · ');
const demoBoard = (workId,date) => ({
  workId,date,title:'每日挑战榜',verification:'client_reported',puzzleId:null,total:0,entries:[],myEntry:null,hasMore:false,
  metrics:[{key:'hints',label:'提示',unit:'次'},{key:'guessedCount',label:'猜字',unit:'个'},{key:'elapsedSeconds',label:'用时',unit:'秒'}],
});

export default function WorkLeaderboard(props) {
  if(!workLeaderboards[props.workId])return null;
  return <Leaderboard key={[props.workId,props.accountProfile?.id||'guest',props.date||'',props.puzzleId||''].join(':')} {...props}/>;
}

function Leaderboard({workId,api,demo,go,accountProfile,Avatar,date:requestedDate,puzzleId,focusBoard=false}) {
  const date=requestedDate||leaderboardToday(),today=leaderboardToday(),definition=workLeaderboards[workId];
  const [expanded,setExpanded]=useState(false),[retry,setRetry]=useState(0),[state,setState]=useState({status:'loading',board:null});
  const [moreBusy,setMoreBusy]=useState(false),[moreError,setMoreError]=useState('');
  const section=useRef(null),request=useRef(null),loadingMore=useRef(false),didFocus=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();request.current=controller;loadingMore.current=false;
    setState({status:'loading',board:null});setMoreBusy(false);setMoreError('');
    (async()=>{
      try{
        const board=demo?demoBoard(workId,date):(await api.getWorkLeaderboard(workId,{date,puzzleId,limit:expanded?50:10},{signal:controller.signal})).data;
        if(!controller.signal.aborted)setState({status:'ready',board:{...board,nextOffset:(board.offset||0)+board.entries.length}});
      }catch(error){if(!controller.signal.aborted)setState({status:'error',board:null,message:error.status===400?'日期无效，请选择今天或之前的日期。':'排行榜暂时没能加载，仍然可以正常游玩。'});}
    })();
    return()=>controller.abort();
  },[api,demo,workId,date,puzzleId,expanded,retry]);
  useEffect(()=>{
    if(!focusBoard){didFocus.current=false;return;}
    if(state.status==='loading'||didFocus.current)return;
    // Wait for the initial content height so scrolling is not clamped by the loading placeholder.
    const frame=requestAnimationFrame(()=>{section.current?.scrollIntoView({block:'start',behavior:'instant'});section.current?.focus({preventScroll:true});didFocus.current=true;});
    return()=>cancelAnimationFrame(frame);
  },[focusBoard,state.status]);
  async function loadMore(){
    if(loadingMore.current||!state.board?.hasMore)return;
    const controller=request.current;loadingMore.current=true;setMoreBusy(true);setMoreError('');
    try{
      const next=(await api.getWorkLeaderboard(workId,{date,puzzleId:state.board.puzzleId,limit:50,offset:state.board.nextOffset},{signal:controller.signal})).data;
      if(!controller.signal.aborted)setState(current=>({...current,board:{...next,nextOffset:next.offset+next.entries.length,entries:[...new Map([...current.board.entries,...next.entries].map(entry=>[entry.player.id,entry])).values()]}}));
    }catch{if(!controller.signal.aborted)setMoreError('后续名次暂时没能加载，请重试。');}
    finally{if(!controller.signal.aborted){loadingMore.current=false;setMoreBusy(false);}}
  }
  const board=state.board;
  const chooseDate=value=>{if(value)go(workLeaderboardPath(workId,value));};
  return <section className="work-leaderboard panel" aria-labelledby="work-board-title" ref={section} tabIndex={-1}>
    <header className="work-leaderboard__heading"><div><span className="kicker">LEADERBOARD</span><h2 id="work-board-title">{definition.title} <small>休闲榜</small></h2><p>同一天、同一道题，看看大家的解题表现。</p></div><label>榜单日期 <input type="date" value={date} max={today} onChange={event=>chooseDate(event.target.value)} aria-label="榜单日期"/><small>北京时间</small></label></header>
    <div className="work-leaderboard__toolbar"><span>{date===today?'今日':date}{board?' · '+board.total+' 人上榜':''}</span><div>{date!==today&&<button onClick={()=>chooseDate(today)}>回到今天</button>}<button onClick={()=>setRetry(value=>value+1)} disabled={state.status==='loading'}>刷新榜单</button></div></div>
    <details className="work-leaderboard__rules"><summary>排名规则与成绩说明</summary><p>先比提示次数，再比猜字数量，最后比用时，均为越少越靠前；完全相同时先完成者在前。</p><p>现有成绩由游戏客户端记录，供休闲交流，不作为防作弊认证。仅公开成绩参与排名；隐私与屏蔽设置生效，名次按当前可见的公开成绩计算。</p></details>
    {state.status==='loading'?<div className="work-leaderboard__state" role="status">正在加载排行榜…</div>:state.status==='error'?<div className="work-leaderboard__state" role="alert"><p>{state.message}</p><button onClick={()=>setRetry(value=>value+1)}>重试排行榜</button></div>:<>
      <div className="work-leaderboard__mine">
        <div><span>我的成绩</span>{!accountProfile?<><strong>登录后记录你的成绩</strong><small>公开榜单无需登录即可查看。</small></>:board.myEntry?<><strong>{board.myEntry.rank?'第 '+board.myEntry.rank+' 名':'成绩已保存 · 未公开'}</strong><small>{scoreText(board.myEntry,board.metrics)}</small></>:<><strong>这道题还没有已保存的成绩</strong><small>{date===today?'完成并成功保存本局成绩后，可在这里查看。':'可以选择其他日期，或参加今天的挑战。'}</small></>}</div>
        {!accountProfile?<button onClick={()=>go('/account')}>登录</button>:!board.myEntry&&date===today?<button onClick={()=>go('/play/'+workId)}>开始游玩</button>:null}
      </div>
      {board.entries.length?<><div className="work-leaderboard__columns" aria-hidden="true"><span>名次 / 玩家</span><div className="work-leaderboard__scores work-leaderboard__column-labels">{board.metrics.map(metric=><span key={metric.key}>{metric.label}</span>)}</div></div><ol className="work-leaderboard__list">{board.entries.map(entry=><li key={entry.player.id} className={entry.player.isMe?'is-me':''}><b className="work-leaderboard__rank">{entry.rank}</b><Avatar avatar={entry.player.avatar} api={api} alt=""/><div className="work-leaderboard__player"><strong>{entry.player.displayName}</strong>{entry.player.isMe&&<small>我</small>}</div><div className="work-leaderboard__scores" aria-label={scoreText(entry,board.metrics)}>{board.metrics.map(metric=><span key={metric.key}><b>{entry.scores[metric.key]}</b><small>{metric.label}</small></span>)}</div></li>)}</ol></>:<div className="work-leaderboard__state"><strong>这道题还没有公开成绩</strong><p>{date===today?'来完成今天的挑战，留下你的成绩吧。':'试试其他日期的排行榜。'}</p></div>}
      {moreError&&<p role="alert">{moreError}</p>}
      {board.hasMore&&<button className="work-leaderboard__expand" disabled={moreBusy} onClick={()=>expanded?loadMore():setExpanded(true)}>{moreBusy?'正在加载…':moreError?'重试加载':expanded?'加载更多名次':'展开完整榜单'}</button>}
      {expanded&&<button className="work-leaderboard__collapse" onClick={()=>setExpanded(false)}>收起为前 10 名</button>}
    </>}
    <footer className="work-leaderboard__footer"><span>每位玩家保留当日最佳成绩</span><button onClick={()=>go(definition.playerCenter)}>玩家互动与设置 ↗</button></footer>
  </section>;
}
