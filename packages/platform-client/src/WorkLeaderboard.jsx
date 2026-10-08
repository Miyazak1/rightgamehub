import React,{useEffect,useRef,useState} from 'react';
import {leaderboardToday,workLeaderboardPath} from './work-leaderboards.mjs';

const scoreText = (entry,metrics) => metrics.map(metric=>`${metric.label} ${entry.scores[metric.key]} ${metric.unit}`).join(' · ');
export default function WorkLeaderboard(props){return <Boards key={props.workId+':'+(props.accountProfile?.id||'guest')} {...props}/>;}
function Boards(props){
  const [state,setState]=useState({status:'loading',boards:[]}),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
  useEffect(()=>{
    if(props.demo){setState({status:'ready',boards:[]});return;}
    const controller=new AbortController();setState({status:'loading',boards:[]});
    props.api.listWorkLeaderboards(props.workId,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setState({status:'ready',boards:data});}).catch(()=>{if(!controller.signal.aborted)setState({status:'error',boards:[]});});
    return()=>controller.abort();
  },[props.api,props.workId,props.demo,retry]);
  if(state.status==='error')return <section className="work-leaderboard panel"><p>暂时无法检查本游戏的排行榜。</p><button onClick={()=>setRetry(n=>n+1)}>重试排行榜</button></section>;
  if(!state.boards.length)return null;
  const definition=state.boards.find(board=>board.id===selected)||state.boards[0];
  return <Leaderboard key={[definition.id,props.date||'',props.puzzleId||''].join(':')} {...props} definition={definition} definitions={state.boards} select={setSelected}/>;
}

function Leaderboard({workId,api,go,accountProfile,Avatar,date:requestedDate,puzzleId,focusBoard=false,definition,definitions,select}) {
  const today=leaderboardToday(),[date,setDate]=useState(requestedDate||today),daily=definition.period==='daily',subject=definition.challengeScoped?'这道题':'当前榜单';
  const [expanded,setExpanded]=useState(false),[retry,setRetry]=useState(0),[state,setState]=useState({status:'loading',board:null});
  const [moreBusy,setMoreBusy]=useState(false),[moreError,setMoreError]=useState('');
  const section=useRef(null),request=useRef(null),loadingMore=useRef(false),didFocus=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();request.current=controller;loadingMore.current=false;
    setState({status:'loading',board:null});setMoreBusy(false);setMoreError('');
    (async()=>{
      try{
        const board=(await api.readCompetitionLeaderboard(workId,definition.id,{...(daily?{date}:{}),...(definition.challengeScoped&&puzzleId?{puzzleId}:{}),limit:expanded?50:10},{signal:controller.signal})).data;
        if(!controller.signal.aborted)setState({status:'ready',board:{...board,nextOffset:(board.offset||0)+board.entries.length}});
      }catch(error){if(!controller.signal.aborted)setState({status:'error',board:null,message:error.status===400?'日期无效，请选择今天或之前的日期。':'排行榜暂时没能加载，仍然可以正常游玩。'});}
    })();
    return()=>controller.abort();
  },[api,workId,date,puzzleId,expanded,retry,definition.id]);
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
      const next=(await api.readCompetitionLeaderboard(workId,definition.id,{...(daily?{date}:{}),...(state.board.puzzleId?{puzzleId:state.board.puzzleId}:{}),limit:50,offset:state.board.nextOffset},{signal:controller.signal})).data;
      if(!controller.signal.aborted)setState(current=>({...current,board:{...next,nextOffset:next.offset+next.entries.length,entries:[...new Map([...current.board.entries,...next.entries].map(entry=>[entry.player.id,entry])).values()]}}));
    }catch{if(!controller.signal.aborted)setMoreError('后续名次暂时没能加载，请重试。');}
    finally{if(!controller.signal.aborted){loadingMore.current=false;setMoreBusy(false);}}
  }
  const board=state.board,canPlay=!daily||date===today;
  const chooseDate=value=>{if(value){if(definition.challengeScoped)go(workLeaderboardPath(workId,value));else{setDate(value);setExpanded(false);}}};
  const rules=definition.ranking.map((clause,index)=>`${index?'再比':'先比'}${definition.metrics.find(metric=>metric.key===clause.metric)?.label}（${clause.direction==='asc'?'越少越靠前':'越多越靠前'}）`).join('，');
  return <section className="work-leaderboard panel" aria-labelledby="work-board-title" ref={section} tabIndex={-1} style={{'--board-metric-count':definition.metrics.length,'--board-score-width':`${Math.max(100,definition.metrics.length*80-8)}px`}}>
    <header className="work-leaderboard__heading"><div><span className="kicker">LEADERBOARD</span><h2 id="work-board-title">{definition.title} <small>{definition.verification==='replay_verified'?'规则回放已验证':'休闲榜'}</small></h2><p>{definition.challengeScoped?'同一天、同一道题，看看大家的解题表现。':daily?'每天一张榜，记录你的最佳表现。':'同一模式、同一规则版本，比较最佳成绩。'}</p></div>{daily&&<label>榜单日期 <input type="date" value={date} max={today} onChange={event=>chooseDate(event.target.value)} aria-label="榜单日期"/><small>北京时间</small></label>}</header>
    {definitions.length>1&&<label className="work-leaderboard__selector">选择榜单 <select aria-label="选择榜单" value={definition.id} onChange={event=>select(event.target.value)}>{definitions.map(item=><option key={item.id} value={item.id}>{item.title} · 规则 {item.rulesetVersion}</option>)}</select></label>}
    <div className="work-leaderboard__toolbar"><span>{daily?(date===today?'今日':date):'总榜'}{board?' · '+board.total+' 人上榜':''}</span><div>{daily&&date!==today&&<button onClick={()=>chooseDate(today)}>回到今天</button>}<button onClick={()=>setRetry(value=>value+1)} disabled={state.status==='loading'}>刷新榜单</button></div></div>
    <details className="work-leaderboard__rules"><summary>排名规则与成绩说明</summary><p>{rules}；完全相同时，先提交者在前。规则版本 {definition.rulesetVersion}。</p><p>{definition.verification==='replay_verified'?'平台按操作记录复算成绩；这不代表真人操作认证。':'成绩由游戏客户端记录，供休闲交流，不作为防作弊认证。'}仅公开成绩参与排名；隐私与屏蔽设置生效，名次按当前可见的公开成绩计算。</p></details>
    {state.status==='loading'?<div className="work-leaderboard__state" role="status">正在加载排行榜…</div>:state.status==='error'?<div className="work-leaderboard__state" role="alert"><p>{state.message}</p><button onClick={()=>setRetry(value=>value+1)}>重试排行榜</button></div>:<>
      <div className="work-leaderboard__mine">
        <div><span>我的成绩</span>{!accountProfile?<><strong>登录后记录你的成绩</strong><small>公开榜单无需登录即可查看。</small></>:board.myEntry?<><strong>{board.myEntry.rank?'第 '+board.myEntry.rank+' 名':'成绩已保存 · 未公开'}</strong><small>{scoreText(board.myEntry,board.metrics)}</small></>:<><strong>{subject}还没有已保存的成绩</strong><small>{canPlay?'完成并成功保存本局成绩后，可在这里查看。':'可以选择其他日期，或参加今天的挑战。'}</small></>}</div>
        {!accountProfile?<button onClick={()=>go('/account')}>登录</button>:!board.myEntry&&canPlay?<button onClick={()=>go('/play/'+workId)}>开始游玩</button>:null}
      </div>
      {board.entries.length?<><div className="work-leaderboard__columns" aria-hidden="true"><span>名次 / 玩家</span><div className="work-leaderboard__scores work-leaderboard__column-labels">{board.metrics.map(metric=><span key={metric.key}>{metric.label}{metric.unit?`（${metric.unit}）`:null}</span>)}</div></div><ol className="work-leaderboard__list">{board.entries.map(entry=><li key={entry.player.id} className={entry.player.isMe?'is-me':''}><b className="work-leaderboard__rank">{entry.rank}</b><Avatar avatar={entry.player.avatar} api={api} alt=""/><div className="work-leaderboard__player"><strong>{entry.player.displayName}</strong>{entry.player.isMe&&<small>我</small>}</div><div className="work-leaderboard__scores" aria-label={scoreText(entry,board.metrics)}>{board.metrics.map(metric=><span key={metric.key}><b>{entry.scores[metric.key]}</b><small>{metric.label}{metric.unit?`（${metric.unit}）`:null}</small></span>)}</div></li>)}</ol></>:<div className="work-leaderboard__state"><strong>{subject}还没有公开成绩</strong><p>{canPlay?'来完成挑战，留下你的成绩吧。':'试试其他日期的排行榜。'}</p></div>}
      {moreError&&<p role="alert">{moreError}</p>}
      {board.hasMore&&<button className="work-leaderboard__expand" disabled={moreBusy} onClick={()=>expanded?loadMore():setExpanded(true)}>{moreBusy?'正在加载…':moreError?'重试加载':expanded?'加载更多名次':'展开完整榜单'}</button>}
      {expanded&&<button className="work-leaderboard__collapse" onClick={()=>setExpanded(false)}>收起为前 10 名</button>}
    </>}
    <footer className="work-leaderboard__footer"><span>每位玩家保留{daily?'当日':''}最佳成绩</span>{definition.playerCenter&&<button onClick={()=>go(definition.playerCenter)}>玩家互动与设置 ↗</button>}</footer>
  </section>;
}
