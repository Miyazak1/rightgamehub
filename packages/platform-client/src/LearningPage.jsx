import React,{useEffect,useMemo,useState} from 'react';
import {demoWorks} from './demo.mjs';
import {useI18n} from './I18n.jsx';
import {builtInLearningItems,learningCategories,learningSubjects} from './learning-catalog.mjs';

const playable=work=>work.targets?.some(target=>target.targetKey==='web'&&target.currentReleaseId);
const action=work=>playable(work)?`/play/${work.id}`:`/works/${work.id}`;
const localized=(value,locale,fallback='')=>value&&typeof value==='object'?(value[locale]??value['zh-CN']??value.en??Object.values(value)[0]??fallback):(value??fallback);
const subjectId=value=>({math:'mathematics',mathematics:'mathematics',physics:'physics',chemistry:'chemistry'})[String(value??'').toLowerCase()]??String(value??'').toLowerCase();

function normalizeWork(work){
  const metadata=work.courseware??{};
  const subjects=metadata.subjects??[];
  return {
    id:work.id,
    work,
    catalogCategory:metadata.catalogCategory??'simulations',
    title:metadata.title??work.title,
    description:metadata.description??work.description,
    subject:subjectId(subjects[0]),
    subjectLabel:subjects[0]??null,
    topic:subjects.slice(1).join(' · '),
    stage:(metadata.audience?.stages??[]).join(' · '),
    estimatedMinutes:work.estimatedMinutes??10,
    verified:metadata?.format==='mooyu.courseware'&&metadata?.summary?.errors===0,
    modes:metadata.modes??[],
  };
}

function CoursewareCover({item,Art}){
  if(item.work)return <Art work={item.work}/>;
  return <div className={`learning-card__illustration learning-card__illustration--${item.coverTone}`} aria-hidden="true">
    <span>{item.symbol}</span><i/><i/><i/>
  </div>;
}

function LearningCard({item,go,Art,locale}){
  const {t}=useI18n();
  const title=localized(item.title,locale,item.work?.title);
  const description=localized(item.description,locale,item.work?.description);
  const open=()=>item.runtimeUrl?globalThis.location.assign(item.runtimeUrl):go(action(item.work));
  const subject=localized(item.subjectLabel,locale,item.subject||t('learning.interactive'));
  return <article className="learning-card">
    <button className="learning-card__cover" onClick={open} aria-label={t('learning.view',{title})}><CoursewareCover item={item} Art={Art}/><span className="learning-card__open" aria-hidden="true">↗</span></button>
    <div className="learning-card__body">
      <div className="learning-card__meta"><span>{subject}</span>{item.verified&&<span className="learning-card__verified">● {t('learning.verified')}</span>}</div>
      <h3><button onClick={open}>{title}</button></h3>
      <p>{description}</p>
      <div className="learning-card__context"><span>{localized(item.topic,locale)}</span><span>{localized(item.stage,locale)}</span></div>
      <footer><span>{t('learning.minutes',{count:item.estimatedMinutes})}</span><button onClick={open}>{t('learning.start')} <span aria-hidden="true">→</span></button></footer>
    </div>
  </article>;
}

export default function LearningPage({api,demo,go,Art}){
  const {t,locale}=useI18n();
  const [state,setState]=useState({status:'loading',items:[]});
  const [category,setCategory]=useState('simulations');
  const [subject,setSubject]=useState('all');
  const [query,setQuery]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState({status:'loading',items:[]});
    const request=demo?Promise.resolve({data:demoWorks.filter(work=>work.kind==='courseware')}):api.listWorks({kind:'courseware',limit:50},{signal:controller.signal});
    request.then(({data})=>{if(!controller.signal.aborted)setState({status:'ready',items:data.map(normalizeWork)});}).catch(()=>{if(!controller.signal.aborted)setState({status:'error',items:[]});});
    return()=>controller.abort();
  },[api,demo,retry]);
  const allItems=useMemo(()=>[...builtInLearningItems,...state.items.filter(item=>!builtInLearningItems.some(builtIn=>builtIn.id===item.id))],[state.items]);
  const currentCategory=learningCategories.find(item=>item.id===category)??learningCategories[0];
  const items=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return allItems.filter(item=>item.catalogCategory===category)
      .filter(item=>subject==='all'||item.subject===subject)
      .filter(item=>!needle||[
        localized(item.title,locale),localized(item.description,locale),localized(item.subjectLabel,locale),localized(item.topic,locale),localized(item.stage,locale),...(item.work?.tags??[]),
      ].join(' ').toLowerCase().includes(needle));
  },[allItems,category,locale,query,subject]);
  const selectCategory=id=>{setCategory(id);setSubject('all');setQuery('');};
  return <main className="page learning-page">
    <header className="learning-hero"><div><span className="learning-kicker">MOOYU.FUN LEARNING</span><h1>{t('learning.title')}</h1><p>{t('learning.lead')}</p></div><div className="learning-hero__mark" aria-hidden="true"><span>∿</span><i/><i/><i/></div></header>
    <section className="learning-categories" aria-labelledby="learning-categories-title">
      <div className="learning-section-heading"><div><span className="learning-kicker">LEARNING AREAS</span><h2 id="learning-categories-title">{t('learning.categories')}</h2></div><p>{t('learning.categoriesLead')}</p></div>
      <div className="learning-category-grid">
        {learningCategories.map(item=>{
          const count=allItems.filter(entry=>entry.catalogCategory===item.id).length;
          return <button key={item.id} type="button" className={category===item.id?'is-active':''} aria-pressed={category===item.id} onClick={()=>selectCategory(item.id)}>
            <span className="learning-category__icon" aria-hidden="true">{item.icon}</span><span className="learning-category__copy"><strong>{localized(item.title,locale)}</strong><small>{localized(item.description,locale)}</small></span><span className="learning-category__count">{count?t('learning.itemCount',{count}):t('learning.preparing')}</span>
          </button>;
        })}
      </div>
    </section>
    <section className="learning-catalog" aria-labelledby="learning-catalog-title">
      <div className="learning-catalog__head"><div><span className="learning-kicker">{category==='simulations'?'SIMULATION LIBRARY':'LEARNING LIBRARY'}</span><h2 id="learning-catalog-title">{localized(currentCategory.title,locale)}</h2><p>{localized(currentCategory.description,locale)}</p></div><label><span className="sr-only">{t('learning.searchLabel')}</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('learning.searchPlaceholder')}/></label></div>
      {category==='simulations'&&<div className="learning-subjects" role="group" aria-label={t('learning.subjectsAria')}>{learningSubjects.map(item=><button key={item.id} type="button" aria-pressed={subject===item.id} onClick={()=>setSubject(item.id)}>{localized(item.label,locale)}</button>)}</div>}
      {state.status==='error'&&category==='simulations'&&<div className="learning-catalog__notice" role="status"><span>{t('learning.communityFailed')}</span><button onClick={()=>setRetry(value=>value+1)}>{t('common.retry')}</button></div>}
      {items.length?<div className="learning-grid">{items.map(item=><LearningCard key={item.id} item={item} go={go} Art={Art} locale={locale}/>)}</div>:<div className="learning-state"><span aria-hidden="true">{currentCategory.icon}</span><h3>{t(query?'learning.noMatch':'learning.categoryEmpty')}</h3><p>{t(query?'learning.noMatchLead':'learning.categoryEmptyLead')}</p>{query&&<button onClick={()=>setQuery('')}>{t('learning.clear')}</button>}</div>}
    </section>
  </main>;
}
