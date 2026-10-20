import React,{useEffect,useRef,useState} from 'react';
import {leaderboardToday,workLeaderboardPath} from './work-leaderboards.mjs';
import {useI18n} from './I18n.jsx';

const scoreText = (entry,metrics) => metrics.map(metric=>`${metric.label} ${entry.scores[metric.key]} ${metric.unit}`).join(' · ');
export default function WorkLeaderboard(props){return <Boards key={props.workId+':'+(props.accountProfile?.id||'guest')} {...props}/>;}
function Boards(props){
  const {t}=useI18n();
  const [state,setState]=useState({status:'loading',boards:[]}),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
  useEffect(()=>{
    if(props.demo){setState({status:'ready',boards:[]});return;}
    const controller=new AbortController();setState({status:'loading',boards:[]});
    props.api.listWorkLeaderboards(props.workId,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setState({status:'ready',boards:data});}).catch(()=>{if(!controller.signal.aborted)setState({status:'error',boards:[]});});
    return()=>controller.abort();
  },[props.api,props.workId,props.demo,retry]);
  if(state.status==='error')return <section className="work-leaderboard panel"><p>{t('leaderboard.unavailable')}</p><button onClick={()=>setRetry(n=>n+1)}>{t('leaderboard.retry')}</button></section>;
  if(!state.boards.length)return null;
  const definition=state.boards.find(board=>board.id===selected)||state.boards[0];
  return <Leaderboard key={[definition.id,props.date||'',props.puzzleId||''].join(':')} {...props} definition={definition} definitions={state.boards} select={setSelected}/>;
}

function Leaderboard({workId,api,go,accountProfile,Avatar,date:requestedDate,puzzleId,focusBoard=false,definition,definitions,select}) {
  const {t}=useI18n();
  const today=leaderboardToday(),[date,setDate]=useState(requestedDate||today),daily=definition.period==='daily',subject=t(definition.challengeScoped?'leaderboard.subject.challenge':'leaderboard.subject.board');
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
      }catch(error){if(!controller.signal.aborted)setState({status:'error',board:null,message:t(error.status===400?'leaderboard.invalidDate':'leaderboard.loadFailed')});}
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
    }catch{if(!controller.signal.aborted)setMoreError(t('leaderboard.moreFailed'));}
    finally{if(!controller.signal.aborted){loadingMore.current=false;setMoreBusy(false);}}
  }
  const board=state.board,canPlay=!daily||date===today;
  const playerCenter=definition.playerCenter==='/games/guess-baike/players'?null:definition.playerCenter;
  const chooseDate=value=>{if(value){if(definition.challengeScoped)go(workLeaderboardPath(workId,value));else{setDate(value);setExpanded(false);}}};
  const rules=definition.ranking.map((clause,index)=>t('leaderboard.ruleClause',{order:t(index?'leaderboard.thenCompare':'leaderboard.firstCompare'),metric:definition.metrics.find(metric=>metric.key===clause.metric)?.label,direction:t(clause.direction==='asc'?'leaderboard.lowerBetter':'leaderboard.higherBetter')})).join(t('leaderboard.ruleSeparator'));
  return <section className="work-leaderboard panel" aria-labelledby="work-board-title" ref={section} tabIndex={-1} style={{'--board-metric-count':definition.metrics.length,'--board-score-width':`${Math.max(100,definition.metrics.length*80-8)}px`}}>
    <header className="work-leaderboard__heading"><div><span className="kicker">LEADERBOARD</span><h2 id="work-board-title">{definition.title} <small>{t(definition.verification==='replay_verified'?'leaderboard.replayVerified':'leaderboard.casual')}</small></h2><p>{t(definition.challengeScoped?'leaderboard.challengeLead':daily?'leaderboard.dailyLead':'leaderboard.allTimeLead')}</p></div>{daily&&<label>{t('leaderboard.date')} <input type="date" value={date} max={today} onChange={event=>chooseDate(event.target.value)} aria-label={t('leaderboard.date')}/><small>{t('leaderboard.timezone')}</small></label>}</header>
    {definitions.length>1&&<label className="work-leaderboard__selector">{t('leaderboard.select')} <select aria-label={t('leaderboard.select')} value={definition.id} onChange={event=>select(event.target.value)}>{definitions.map(item=><option key={item.id} value={item.id}>{t('leaderboard.option',{title:item.title,version:item.rulesetVersion})}</option>)}</select></label>}
    <div className="work-leaderboard__toolbar"><span>{daily?(date===today?t('leaderboard.today'):date):t('leaderboard.allTime')}{board?t('leaderboard.rankedCount',{count:board.total}):''}</span><div>{daily&&date!==today&&<button onClick={()=>chooseDate(today)}>{t('leaderboard.backToday')}</button>}<button onClick={()=>setRetry(value=>value+1)} disabled={state.status==='loading'}>{t('leaderboard.refresh')}</button></div></div>
    <details className="work-leaderboard__rules"><summary>{t('leaderboard.rulesTitle')}</summary><p>{t('leaderboard.rulesSummary',{rules,version:definition.rulesetVersion})}</p><p>{t(definition.verification==='replay_verified'?'leaderboard.replayNote':'leaderboard.casualNote')}{t('leaderboard.privacyNote')}</p></details>
    {state.status==='loading'?<div className="work-leaderboard__state" role="status">{t('leaderboard.loading')}</div>:state.status==='error'?<div className="work-leaderboard__state" role="alert"><p>{state.message}</p><button onClick={()=>setRetry(value=>value+1)}>{t('leaderboard.retry')}</button></div>:<>
      <div className="work-leaderboard__mine">
        <div><span>{t('leaderboard.myScore')}</span>{!accountProfile?<><strong>{t('leaderboard.signInToSave')}</strong><small>{t('leaderboard.publicWithoutLogin')}</small></>:board.myEntry?<><strong>{board.myEntry.rank?t('leaderboard.rank',{rank:board.myEntry.rank}):t('leaderboard.savedPrivate')}</strong><small>{scoreText(board.myEntry,board.metrics)}</small></>:<><strong>{t('leaderboard.noSavedScore',{subject})}</strong><small>{t(canPlay?'leaderboard.finishToSave':'leaderboard.chooseOtherDate')}</small></>}</div>
        {!accountProfile?<button onClick={()=>go('/account')}>{t('leaderboard.signIn')}</button>:!board.myEntry&&canPlay?<button onClick={()=>go('/play/'+workId)}>{t('leaderboard.play')}</button>:null}
      </div>
      {board.entries.length?<><div className="work-leaderboard__columns" aria-hidden="true"><span>{t('leaderboard.rankPlayer')}</span><div className="work-leaderboard__scores work-leaderboard__column-labels">{board.metrics.map(metric=><span key={metric.key}>{metric.label}{metric.unit?` (${metric.unit})`:null}</span>)}</div></div><ol className="work-leaderboard__list">{board.entries.map(entry=><li key={entry.player.id} className={entry.player.isMe?'is-me':''}><b className="work-leaderboard__rank">{entry.rank}</b><Avatar avatar={entry.player.avatar} api={api} alt=""/><div className="work-leaderboard__player"><strong>{entry.player.displayName}</strong>{entry.player.isMe&&<small>{t('leaderboard.me')}</small>}</div><div className="work-leaderboard__scores" aria-label={scoreText(entry,board.metrics)}>{board.metrics.map(metric=><span key={metric.key}><b>{entry.scores[metric.key]}</b><small>{metric.label}{metric.unit?` (${metric.unit})`:null}</small></span>)}</div></li>)}</ol></>:<div className="work-leaderboard__state"><strong>{t('leaderboard.noPublicScore',{subject})}</strong><p>{t(canPlay?'leaderboard.beFirst':'leaderboard.tryOtherDate')}</p></div>}
      {moreError&&<p role="alert">{moreError}</p>}
      {board.hasMore&&<button className="work-leaderboard__expand" disabled={moreBusy} onClick={()=>expanded?loadMore():setExpanded(true)}>{t(moreBusy?'leaderboard.loading':moreError?'leaderboard.retryMore':expanded?'leaderboard.loadMore':'leaderboard.expand')}</button>}
      {expanded&&<button className="work-leaderboard__collapse" onClick={()=>setExpanded(false)}>{t('leaderboard.collapse')}</button>}
    </>}
    <footer className="work-leaderboard__footer"><span>{t(daily?'leaderboard.bestDaily':'leaderboard.bestAllTime')}</span>{playerCenter&&<button onClick={()=>go(playerCenter)}>{t('leaderboard.playerCenter')} ↗</button>}</footer>
  </section>;
}
