import React,{useEffect,useRef,useState} from 'react';
import {demoWorks} from './demo.mjs';

const PAGE_SIZE=24;
// Deliberate launch picks. Test projects and play-count spikes never enter this list.
const picks=['gamehub-guess-baike','7359a350-cc0a-4a09-875d-cec9b5b8f93f'];
const labels={game:'游戏',creative:'互动',tool:'工具'};
const channels={game:'游戏',ai:'AI',computing:'计算机'};
const playable=work=>work.id==='gamehub-guess-baike'||work.targets?.some(target=>target.targetKey==='web'&&target.currentReleaseId);
const action=work=>playable(work)?'/play/'+work.id:'/works/'+work.id;
const tags=work=>(work.tags??[]).filter(tag=>tag!=='github-import').slice(0,2);
const matches=(work,q,kind)=>(kind==='all'||work.kind===kind)&&(!q||[work.title,work.description,...(work.tags??[]),work.creatorDisplayName,work.agentLabel].join(' ').toLowerCase().includes(q.toLowerCase()));
const summary=work=>work.description&&work.description!=='鹏总'?work.description:('来自 '+(work.creatorDisplayName||'社区作者')+' 的'+(labels[work.kind]||'作品')+'。');

function GameCard({work,go,Art,recommended=false}) {
  return <article className={'discovery-game'+(recommended?' discovery-game--pick':'')} data-work-id={work.id}>
    <button className="discovery-game__cover" onClick={()=>go('/works/'+work.id)} aria-label={'查看 '+work.title}><Art work={work}/></button>
    <div className="discovery-game__body"><div className="discovery-game__tags"><span>{tags(work).join(' · ')||labels[work.kind]||'作品'}</span><span>{playable(work)?'在线玩':'Windows'}</span></div>
      <h3><button onClick={()=>go('/works/'+work.id)}>{work.title}</button></h3><p>{summary(work)}</p>
      <footer><span>{work.estimatedMinutes?'约 '+work.estimatedMinutes+' 分钟':work.creatorDisplayName||'社区作品'}</span><button className="discovery-play" onClick={()=>go(action(work))} aria-label={(playable(work)?'开始玩 ':'查看 Windows 版 ')+work.title}><span aria-hidden="true">▶</span> {playable(work)?'开始玩':'Windows 版'}</button></footer>
    </div>
  </article>;
}

export default function DiscoverPage({api,demo,go,hostIdentity,accountProfile,Art}) {
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[retry,setRetry]=useState(0);
  const [catalog,setCatalog]=useState({status:'loading',items:[],offset:0,more:false}),[initial,setInitial]=useState([]);
  const [recent,setRecent]=useState([]),[shares,setShares]=useState([]),[moreBusy,setMoreBusy]=useState(false),[moreError,setMoreError]=useState('');
  const generation=useRef(0),request=useRef(null),loadingMore=useRef(false);
  const q=query.trim(),filtered=Boolean(q)||kind!=='all';
  useEffect(()=>{
    const controller=new AbortController(),current=++generation.current;
    request.current=controller;loadingMore.current=false;setMoreBusy(false);setMoreError('');
    setCatalog({status:'loading',items:[],offset:0,more:false});
    const timer=setTimeout(async()=>{
      try{
        const data=demo?demoWorks.filter(work=>matches(work,q,kind)).slice(0,PAGE_SIZE):(await api.listWorks({limit:PAGE_SIZE,q,kind:kind==='all'?undefined:kind},{signal:controller.signal})).data;
        if(controller.signal.aborted||current!==generation.current)return;
        setCatalog({status:'ready',items:data,offset:data.length,more:data.length===PAGE_SIZE});
        if(!q&&kind==='all')setInitial(data);
      }catch{if(!controller.signal.aborted&&current===generation.current)setCatalog({status:'error',items:[],offset:0,more:false});}
    },q?250:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[api,demo,q,kind,retry]);
  useEffect(()=>{
    const controller=new AbortController();
    if(accountProfile) {
      const data=demo?Promise.resolve({data:demoWorks.slice(0,2).map(work=>({work,lastPlayedAt:new Date().toISOString()}))}):api.listLibrary({limit:3,recent:true,signal:controller.signal});
      data.then(({data})=>{if(!controller.signal.aborted)setRecent(data.filter(item=>item.lastPlayedAt&&item.work).sort((a,b)=>String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))).slice(0,3));}).catch(()=>{});
    }
    if(!demo&&api.communityList)api.communityList({},{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setShares((data.items??[]).slice(0,3));}).catch(()=>{});
    return()=>controller.abort();
  },[api,demo,accountProfile?.id]);
  async function more(){
    if(loadingMore.current||!catalog.more)return;
    const current=generation.current,signal=request.current.signal;
    loadingMore.current=true;setMoreBusy(true);setMoreError('');
    try{
      const data=demo?demoWorks.filter(work=>matches(work,q,kind)).slice(catalog.offset,catalog.offset+PAGE_SIZE):(await api.listWorks({limit:PAGE_SIZE,offset:catalog.offset,q,kind:kind==='all'?undefined:kind},{signal})).data;
      if(signal.aborted||current!==generation.current)return;
      setCatalog(previous=>({...previous,items:[...new Map([...previous.items,...data].map(work=>[work.id,work])).values()],offset:previous.offset+data.length,more:data.length===PAGE_SIZE}));
    }catch{if(!signal.aborted&&current===generation.current)setMoreError('更多作品暂时没能加载，请再试一次。');}
    finally{if(current===generation.current){loadingMore.current=false;setMoreBusy(false);}}
  }
  const recommended=picks.map(id=>initial.find(work=>work.id===id)).filter(Boolean);
  return <main className="page discovery-page">
    <header className="discovery-welcome"><div><span className="discovery-kicker">{hostIdentity.id==='browser'?'给自己一点休息时间':hostIdentity.label+' 里的休息站'}</span><h1>休息一下？</h1><p>玩一会儿，换个脑子。下一次灵感，也许就在这里。</p></div><span className="discovery-welcome__pixel" aria-hidden="true">✦</span></header>
    <div className="discovery-search"><label htmlFor="discovery-search">找个想玩的</label><div><span aria-hidden="true">⌕</span><input id="discovery-search" type="search" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索游戏、玩法或作者"/>{query&&<button onClick={()=>setQuery('')} aria-label="清除搜索">×</button>}</div></div>
    {!filtered&&recent.length>0&&<section className="discovery-recent" aria-labelledby="recent-title"><div className="discovery-section-heading"><h2 id="recent-title">最近玩过</h2><button onClick={()=>go('/library')}>游戏库 ↗</button></div><div>{recent.map(({work})=><button key={work.id} onClick={()=>go(action(work))} aria-label={'再次打开 '+work.title}><Art work={work}/><span><strong>{work.title}</strong><small>{playable(work)?'再玩一会儿':'查看启动方式'}</small></span><span aria-hidden="true">↗</span></button>)}</div></section>}
    {!filtered&&recommended.length>0&&<section className="discovery-picks" aria-labelledby="picks-title"><div className="discovery-section-heading"><div><span className="discovery-kicker">从这里开始</span><h2 id="picks-title">推荐游玩</h2></div></div><div className="discovery-picks__grid">{recommended.map(work=><GameCard key={work.id} work={work} go={go} Art={Art} recommended/>)}</div></section>}
    <section className="discovery-catalog" aria-labelledby="catalog-title" aria-busy={catalog.status==='loading'}><div className="discovery-section-heading"><h2 id="catalog-title">{q?'搜索结果':'全部作品'}</h2><span>{catalog.status==='ready'?(catalog.more?'已显示 '+catalog.items.length+' 个':catalog.items.length+' 个作品'):''}</span></div>
      <div className="discovery-filters" role="group" aria-label="作品类型">{[['all','全部'],['game','游戏'],['creative','互动'],['tool','工具']].map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div>
      {catalog.status==='loading'?<div className="discovery-state" role="status">正在寻找好玩的作品…</div>:catalog.status==='error'?<div className="discovery-state" role="alert"><h3>作品暂时没能加载</h3><p>检查连接后再试一次。</p><button onClick={()=>setRetry(value=>value+1)}>重新加载</button></div>:catalog.items.length?<div className="discovery-catalog__grid">{catalog.items.map(work=><GameCard key={work.id} work={work} go={go} Art={Art}/>)}</div>:<div className="discovery-state"><h3>{filtered?'没有找到匹配作品':'新的作品正在路上'}</h3><p>{filtered?'试试其他关键词，或看看全部作品。':'稍后再来看看大家的新创意。'}</p>{filtered&&<button onClick={()=>{setQuery('');setKind('all');}}>查看全部作品</button>}</div>}
      {moreError&&<p role="alert">{moreError}</p>}{catalog.more&&<button className="discovery-load-more" disabled={moreBusy} onClick={more}>{moreBusy?'正在加载…':moreError?'重试加载':'加载更多作品'}</button>}
    </section>
    {!filtered&&shares.length>0&&<section className="discovery-shares" aria-labelledby="shares-title"><div className="discovery-section-heading"><div><span className="discovery-kicker">游戏 · AI · 计算机</span><h2 id="shares-title">最新分享</h2></div><button onClick={()=>go('/community')}>全部分享 ↗</button></div><div>{shares.map(post=><article key={post.id}><span>{channels[post.channel]||'发现'}</span><h3><button onClick={()=>go('/community/posts/'+post.id)}>{post.title}</button></h3><p>{post.blocks.find(block=>block.type==='paragraph')?.text||'打开看看这条新发现。'}</p><footer><span>{post.author.displayName}</span><time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</time></footer></article>)}</div></section>}
  </main>;
}
