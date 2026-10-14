import React,{useEffect,useRef,useState} from 'react';
import {demoWorks} from './demo.mjs';
import {DiscoveryCampaignSpotlight} from './DiscoveryCampaigns.jsx';
import {useI18n} from './I18n.jsx';

const PAGE_SIZE=24;
// Deliberate launch picks. Test projects and play-count spikes never enter this list.
const picks=['gamehub-guess-baike','7359a350-cc0a-4a09-875d-cec9b5b8f93f'];
const playable=work=>work.id==='gamehub-guess-baike'||work.targets?.some(target=>target.targetKey==='web'&&target.currentReleaseId);
const action=work=>playable(work)?'/play/'+work.id:'/works/'+work.id;
const tags=work=>(work.tags??[]).filter(tag=>tag!=='github-import').slice(0,2);
const matches=(work,q,kind,access,runtime,source)=>(kind==='all'||work.kind===kind)&&(access==='all'||access==='open'&&work.openSource||access==='remix'&&work.remixable||access==='claimable'&&work.claimEligible)&&(runtime==='all'||runtime==='web'&&playable(work)||runtime==='windows'&&work.targets?.some(target=>target.targetKey==='windows-x64'&&target.currentReleaseId))&&(source==='all'||source==='community_catalog'&&work.attributionKind==='community_catalog'||source!=='community_catalog'&&work.ingestionMethod===source)&&(!q||[work.title,work.description,...(work.tags??[]),work.creatorDisplayName,work.agentLabel].join(' ').toLowerCase().includes(q.toLowerCase()));
const kindKey=kind=>({game:'discover.game',creative:'discover.creative',tool:'discover.tool',courseware:'discover.courseware'})[kind]||'discover.work';
const summary=(work,t)=>work.description&&work.description!=='鹏总'?work.description:t('discover.fromCreator',{creator:work.creatorDisplayName||t('common.communityAuthor'),kind:t(kindKey(work.kind))});
const ingestionLabel=(work,t)=>t(work.ingestionMethod==='platform'?'discover.platform':work.ingestionMethod==='github_import'?'discover.githubImport':'discover.zipUpload');
const sourceLabel=(work,t)=>work.attributionKind==='community_catalog'?t('discover.communityCollected',{source:ingestionLabel(work,t)}):work.ingestionMethod==='platform'?t('discover.platform'):t('discover.publisher',{source:ingestionLabel(work,t)});
const rightsLabel=(work,t)=>work.remixable?t('discover.openLicense',{license:work.licenseSpdx}):work.openSource?t('discover.openCode',{license:work.licenseSpdx}):work.licenseSpdx?t('discover.rightsPending',{license:work.licenseSpdx}):t('discover.noOpenLicense');

function GameCard({work,go,Art,recommended=false}) {
  const {t}=useI18n();
  return <article className={'discovery-game'+(recommended?' discovery-game--pick':'')} data-work-id={work.id}>
    <button className="discovery-game__cover" onClick={()=>go('/works/'+work.id)} aria-label={t('discover.view',{title:work.title})}><Art work={work}/></button>
    <div className="discovery-game__body"><div className="discovery-game__tags"><span>{tags(work).join(' · ')||t(kindKey(work.kind))}</span><span>{t(playable(work)?'discover.online':'discover.windows')}</span></div>
      <h3><button onClick={()=>go('/works/'+work.id)}>{work.title}</button></h3><p>{summary(work,t)}</p>
      <div className="discovery-game__provenance"><span>{sourceLabel(work,t)}</span><span>{rightsLabel(work,t)}</span>{work.claimEligible&&<span className="is-claimable">{t('discover.awaitingClaim')}</span>}</div>
      <footer><span>{work.estimatedMinutes?t('common.minutes',{count:work.estimatedMinutes}):work.creatorDisplayName||t('common.communityAuthor')}</span><button className="discovery-play" onClick={()=>go(action(work))} aria-label={t(playable(work)?'discover.startAria':'discover.windowsAria',{title:work.title})}><span aria-hidden="true">▶</span> {t(playable(work)?'discover.start':'discover.windowsVersion')}</button></footer>
    </div>
  </article>;
}

export default function DiscoverPage({api,demo,go,hostIdentity,accountProfile,Art}) {
  const {t}=useI18n();
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[access,setAccess]=useState('all'),[runtime,setRuntime]=useState('all'),[source,setSource]=useState('all'),[retry,setRetry]=useState(0);
  const [catalog,setCatalog]=useState({status:'loading',items:[],offset:0,more:false}),[initial,setInitial]=useState([]);
  const [recent,setRecent]=useState([]),[moreBusy,setMoreBusy]=useState(false),[moreError,setMoreError]=useState('');
  const generation=useRef(0),request=useRef(null),loadingMore=useRef(false);
  const q=query.trim(),filtered=Boolean(q)||kind!=='all'||access!=='all'||runtime!=='all'||source!=='all';
  const catalogQuery=offset=>({limit:PAGE_SIZE,...(offset?{offset}:{}),q,kind:kind==='all'?undefined:kind,openSource:access==='open'||undefined,remixable:access==='remix'||undefined,claimable:access==='claimable'||undefined,runtime:runtime==='all'?undefined:runtime,source:source==='all'?undefined:source});
  useEffect(()=>{
    const controller=new AbortController(),current=++generation.current;
    request.current=controller;loadingMore.current=false;setMoreBusy(false);setMoreError('');
    setCatalog({status:'loading',items:[],offset:0,more:false});
    const timer=setTimeout(async()=>{
      try{
        const data=demo?demoWorks.filter(work=>matches(work,q,kind,access,runtime,source)).slice(0,PAGE_SIZE):(await api.listWorks(catalogQuery(0),{signal:controller.signal})).data;
        if(controller.signal.aborted||current!==generation.current)return;
        setCatalog({status:'ready',items:data,offset:data.length,more:data.length===PAGE_SIZE});
        if(!filtered)setInitial(data);
      }catch{if(!controller.signal.aborted&&current===generation.current)setCatalog({status:'error',items:[],offset:0,more:false});}
    },q?250:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[api,demo,q,kind,access,runtime,source,retry]);
  useEffect(()=>{
    const controller=new AbortController();
    if(accountProfile) {
      const data=demo?Promise.resolve({data:demoWorks.slice(0,2).map(work=>({work,lastPlayedAt:new Date().toISOString()}))}):api.listLibrary({limit:3,recent:true,signal:controller.signal});
      data.then(({data})=>{if(!controller.signal.aborted)setRecent(data.filter(item=>item.lastPlayedAt&&item.work).sort((a,b)=>String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))).slice(0,3));}).catch(()=>{});
    }
    return()=>controller.abort();
  },[api,demo,accountProfile?.id]);
  async function more(){
    if(loadingMore.current||!catalog.more)return;
    const current=generation.current,signal=request.current.signal;
    loadingMore.current=true;setMoreBusy(true);setMoreError('');
    try{
      const data=demo?demoWorks.filter(work=>matches(work,q,kind,access,runtime,source)).slice(catalog.offset,catalog.offset+PAGE_SIZE):(await api.listWorks(catalogQuery(catalog.offset),{signal})).data;
      if(signal.aborted||current!==generation.current)return;
      setCatalog(previous=>({...previous,items:[...new Map([...previous.items,...data].map(work=>[work.id,work])).values()],offset:previous.offset+data.length,more:data.length===PAGE_SIZE}));
    }catch{if(!signal.aborted&&current===generation.current)setMoreError(t('discover.moreFailed'));}
    finally{if(current===generation.current){loadingMore.current=false;setMoreBusy(false);}}
  }
  const recommended=picks.map(id=>initial.find(work=>work.id===id)).filter(Boolean);
  return <main className="page discovery-page">
    <header className="discovery-welcome"><div><span className="discovery-kicker">{hostIdentity.id==='browser'?t('discover.browserRest'):t('discover.hostRest',{host:hostIdentity.label})}</span><h1>{t('discover.title')}</h1><p>{t('discover.lead')}</p></div></header>
    <div className="discovery-search"><label htmlFor="discovery-search">{t('discover.searchLabel')}</label><div><span aria-hidden="true">⌕</span><input id="discovery-search" type="search" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('discover.searchPlaceholder')}/>{query&&<button onClick={()=>setQuery('')} aria-label={t('discover.clearSearch')}>×</button>}</div></div>
    {!filtered&&<DiscoveryCampaignSpotlight api={api} demo={demo} go={go} Art={Art}/>}
    {!filtered&&recent.length>0&&<section className="discovery-recent" aria-labelledby="recent-title"><div className="discovery-section-heading"><h2 id="recent-title">{t('discover.recent')}</h2><button onClick={()=>go('/library')}>{t('discover.library')}</button></div><div>{recent.map(({work})=><button key={work.id} onClick={()=>go(action(work))} aria-label={t('discover.openAgain',{title:work.title})}><Art work={work}/><span><strong>{work.title}</strong><small>{t(playable(work)?'discover.playAgain':'discover.launchHelp')}</small></span><span aria-hidden="true">↗</span></button>)}</div></section>}
    {!filtered&&recommended.length>0&&<section className="discovery-picks" aria-labelledby="picks-title"><div className="discovery-section-heading"><div><span className="discovery-kicker">{t('discover.startHere')}</span><h2 id="picks-title">{t('discover.recommended')}</h2></div></div><div className="discovery-picks__grid">{recommended.map(work=><GameCard key={work.id} work={work} go={go} Art={Art} recommended/>)}</div></section>}
    <section className="discovery-catalog" aria-labelledby="catalog-title" aria-busy={catalog.status==='loading'}><div className="discovery-section-heading"><div><span className="discovery-kicker">{t('discover.promise')}</span><h2 id="catalog-title">{t(q?'discover.results':'discover.allWorks')}</h2></div><span>{catalog.status==='ready'?t(catalog.more?'discover.countMore':'discover.count',{count:catalog.items.length}):''}</span></div>
      <div className="discovery-filterbar"><div className="discovery-filters" role="group" aria-label={t('discover.kindGroup')}>{[['all','discover.all'],['game','discover.game'],['creative','discover.creative'],['tool','discover.tool'],['courseware','discover.courseware']].map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{t(label)}</button>)}</div><div className="discovery-filters" role="group" aria-label={t('discover.rightsGroup')}>{[['all','discover.allRights'],['open','discover.openSource'],['remix','discover.remixable'],['claimable','discover.claimable']].map(([value,label])=><button key={value} aria-pressed={access===value} onClick={()=>setAccess(value)}>{t(label)}</button>)}</div><div className="discovery-filter-selects"><label>{t('discover.runtime')}<select value={runtime} onChange={event=>setRuntime(event.target.value)}><option value="all">{t('discover.all')}</option><option value="web">{t('discover.webPlayable')}</option><option value="windows">Windows</option></select></label><label>{t('discover.source')}<select value={source} onChange={event=>setSource(event.target.value)}><option value="all">{t('discover.all')}</option><option value="platform">{t('discover.platform')}</option><option value="github_import">{t('discover.githubImport')}</option><option value="zip_upload">{t('discover.zipUpload')}</option><option value="community_catalog">{t('discover.communityCatalog')}</option></select></label></div></div>
      {catalog.status==='loading'?<div className="discovery-state" role="status">{t('discover.finding')}</div>:catalog.status==='error'?<div className="discovery-state" role="alert"><h3>{t('discover.loadFailed')}</h3><p>{t('discover.checkConnection')}</p><button onClick={()=>setRetry(value=>value+1)}>{t('common.retry')}</button></div>:catalog.items.length?<div className="discovery-catalog__grid">{catalog.items.map(work=><GameCard key={work.id} work={work} go={go} Art={Art}/>)}</div>:<div className="discovery-state"><h3>{t(filtered?'discover.noMatch':'discover.onTheWay')}</h3><p>{t(filtered?'discover.tryFilters':'discover.comeBack')}</p>{filtered&&<button onClick={()=>{setQuery('');setKind('all');setAccess('all');setRuntime('all');setSource('all');}}>{t('discover.showAll')}</button>}</div>}
      {moreError&&<p role="alert">{moreError}</p>}{catalog.more&&<button className="discovery-load-more" disabled={moreBusy} onClick={more}>{t(moreBusy?'discover.loadingMore':moreError?'discover.retryMore':'discover.loadMore')}</button>}
    </section>
  </main>;
}
