import React,{useEffect,useMemo,useState} from 'react';
import {demoWorks} from './demo.mjs';
import {useI18n} from './I18n.jsx';

const playable=work=>work.targets?.some(target=>target.targetKey==='web'&&target.currentReleaseId);
const action=work=>playable(work)?`/play/${work.id}`:`/works/${work.id}`;
const localized=(value,locale,fallback='')=>value&&typeof value==='object'?(value[locale]??value['zh-CN']??value.en??Object.values(value)[0]??fallback):fallback;

function LearningCard({work,go,Art,locale}){
  const {t}=useI18n();
  const metadata=work.courseware;
  const subjects=metadata?.subjects??[];
  const stages=metadata?.audience?.stages??[];
  const verified=metadata?.format==='mooyu.courseware'&&metadata?.summary?.errors===0;
  return <article className="learning-card">
    <button className="learning-card__cover" onClick={()=>go(`/works/${work.id}`)} aria-label={t('learning.view',{title:work.title})}><Art work={work}/></button>
    <div className="learning-card__body">
      <div className="learning-card__meta"><span>{subjects[0]||t('learning.interactive')}</span>{verified&&<span className="learning-card__verified">✓ {t('learning.verified')}</span>}</div>
      <h2><button onClick={()=>go(`/works/${work.id}`)}>{localized(metadata?.title,locale,work.title)||work.title}</button></h2>
      <p>{work.description}</p>
      {(subjects.length>1||stages.length>0)&&<div className="learning-card__chips">{subjects.slice(1,3).map(item=><span key={item}>{item}</span>)}{stages.slice(0,2).map(item=><span key={item}>{item}</span>)}</div>}
      <footer><span>{t('learning.minutes',{count:work.estimatedMinutes??3})}</span><button onClick={()=>go(action(work))}>{t(playable(work)?'learning.start':'learning.details')} <span aria-hidden="true">→</span></button></footer>
    </div>
  </article>;
}

export default function LearningPage({api,demo,go,Art}){
  const {t,locale}=useI18n();
  const [state,setState]=useState({status:'loading',items:[]});
  const [query,setQuery]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState({status:'loading',items:[]});
    const request=demo?Promise.resolve({data:demoWorks.filter(work=>work.kind==='courseware')}):api.listWorks({kind:'courseware',limit:50},{signal:controller.signal});
    request.then(({data})=>{if(!controller.signal.aborted)setState({status:'ready',items:data});}).catch(()=>{if(!controller.signal.aborted)setState({status:'error',items:[]});});
    return()=>controller.abort();
  },[api,demo,retry]);
  const items=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return state.items;
    return state.items.filter(work=>[work.title,work.description,...(work.tags??[]),...(work.courseware?.subjects??[]),...Object.values(work.courseware?.title??{})].join(' ').toLowerCase().includes(needle));
  },[query,state.items]);
  return <main className="page learning-page">
    <header className="learning-hero"><div><span className="learning-kicker">INTERACTIVE LEARNING</span><h1>{t('learning.title')}</h1><p>{t('learning.lead')}</p></div><div className="learning-hero__mark" aria-hidden="true"><span>∿</span><i/><i/><i/></div></header>
    <section className="learning-trust" aria-label={t('learning.trustAria')}>
      <div><strong>01</strong><span>{t('learning.trustInteractive')}</span></div>
      <div><strong>02</strong><span>{t('learning.trustVerified')}</span></div>
      <div><strong>03</strong><span>{t('learning.trustOpen')}</span></div>
    </section>
    <section className="learning-catalog" aria-labelledby="learning-catalog-title">
      <div className="learning-catalog__head"><div><span className="learning-kicker">LEARNING LIBRARY</span><h2 id="learning-catalog-title">{t('learning.catalog')}</h2></div><label><span className="sr-only">{t('learning.searchLabel')}</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('learning.searchPlaceholder')}/></label></div>
      {state.status==='loading'?<div className="learning-state" role="status">{t('learning.loading')}</div>:state.status==='error'?<div className="learning-state" role="alert"><h3>{t('learning.failed')}</h3><p>{t('learning.failedLead')}</p><button onClick={()=>setRetry(value=>value+1)}>{t('common.retry')}</button></div>:items.length?<div className="learning-grid">{items.map(work=><LearningCard key={work.id} work={work} go={go} Art={Art} locale={locale}/>)}</div>:<div className="learning-state"><h3>{t(query?'learning.noMatch':'learning.empty')}</h3><p>{t(query?'learning.noMatchLead':'learning.emptyLead')}</p>{query&&<button onClick={()=>setQuery('')}>{t('learning.clear')}</button>}</div>}
    </section>
  </main>;
}
