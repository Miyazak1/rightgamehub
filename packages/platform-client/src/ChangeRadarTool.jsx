import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {useI18n} from './I18n.jsx';
import {isEmbeddedAgentTool,subscribeChangeRadarStatus,syncChangeRadarContext} from './agent-tool-bridge.mjs';

const intervalOptions=[15,60,360,720,1440,10080];
const ruleTypes=['any','keyword_appears','keyword_disappears','number_changes'];
const pendingStorageKey='mooyu.change-radar.pending';
const emptyForm={url:'',title:'',condition:'',ruleType:'any',ruleValue:'',ignoreNoise:true,intervalMinutes:360};

function routePrefill(){
  const outer=new URLSearchParams(String(globalThis.location?.search||'').replace(/^\?/u,''));
  const embedded=outer.get('gh_route');
  const query=embedded?.includes('?')?embedded.slice(embedded.indexOf('?')+1):String(globalThis.location?.search||'').replace(/^\?/u,'');
  const params=new URLSearchParams(query),interval=Number(params.get('interval')||360),ruleType=params.get('ruleType')||'any';
  const incoming={...emptyForm,url:params.get('url')||'',title:params.get('title')||'',condition:params.get('condition')||'',ruleType:ruleTypes.includes(ruleType)?ruleType:'any',ruleValue:params.get('ruleValue')||'',intervalMinutes:intervalOptions.includes(interval)?interval:360};
  if(incoming.url)return incoming;
  try{const saved=JSON.parse(globalThis.sessionStorage?.getItem(pendingStorageKey)||'null');return saved?.url?{...incoming,...saved}:incoming;}catch{return incoming;}
}

function suggestedTitle(value){try{return new URL(value).hostname.replace(/^www\./u,'');}catch{return '';}}
function formatTime(value,locale){if(!value)return '—';try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return value;}}

function DiffView({snapshot,t}){
  const diff=snapshot.diff||{},changes=Array.isArray(diff.changes)?diff.changes:[];
  if(snapshot.changeKind==='initial')return <p className="change-radar__excerpt">{snapshot.excerpt}</p>;
  return <>
    <div className="change-radar__diff-stats"><span className="is-added">+{diff.added||0}</span><span className="is-removed">−{diff.removed||0}</span><span>{t('tools.changeRadar.modified')} {diff.modified||0}</span>{diff.omitted>0&&<span>+{diff.omitted} {t('tools.changeRadar.omitted')}</span>}</div>
    {changes.length?<div className="change-radar__diff">{changes.map((change,index)=>change.type==='modified'?<div className="change-radar__diff-row is-modified" key={`${index}:${change.before}`}><del>{change.before}</del><ins>{change.after}</ins></div>:<div className={`change-radar__diff-row is-${change.type}`} key={`${index}:${change.text}`}><span>{change.type==='added'?'+':'−'}</span><p>{change.text}</p></div>)}</div>:<p className="change-radar__excerpt">{snapshot.excerpt}</p>}
  </>;
}

function EventCard({snapshot,locale,t,onRead,busy}){
  return <article className={`change-radar__event is-${snapshot.importance||'routine'} ${snapshot.isRead?'is-read':'is-unread'}`}>
    <header><div><span className={`change-radar__snapshot-kind is-${snapshot.changeKind}`}>{snapshot.importance==='important'?t('tools.changeRadar.important'):t(`tools.changeRadar.snapshot.${snapshot.changeKind}`)}</span>{snapshot.watchTitle&&<strong>{snapshot.watchTitle}</strong>}</div><time>{formatTime(snapshot.fetchedAt,locale)}</time></header>
    {snapshot.ruleReason&&<p className="change-radar__rule-result">{snapshot.ruleMatched?'●':'○'} {snapshot.ruleReason}</p>}
    <DiffView snapshot={snapshot} t={t}/>
    <footer><small>HTTP {snapshot.statusCode} · {snapshot.contentType}</small>{snapshot.changeKind==='changed'&&!snapshot.isRead&&<button type="button" disabled={busy===`read:${snapshot.id}`} onClick={()=>onRead(snapshot.id)}>{t('tools.changeRadar.markRead')}</button>}</footer>
  </article>;
}

export default function ChangeRadarTool({api,accountProfile,go}){
  const {t,locale}=useI18n(),prefill=useMemo(routePrefill,[]),agentSurface=isEmbeddedAgentTool();
  const [form,setForm]=useState(prefill),[watches,setWatches]=useState([]),[selectedId,setSelectedId]=useState(''),[snapshots,setSnapshots]=useState([]),[events,setEvents]=useState([]),[view,setView]=useState('watch');
  const [loading,setLoading]=useState(Boolean(accountProfile)),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[agentStatus,setAgentStatus]=useState(agentSurface?'syncing':'browser');
  const selected=watches.find(item=>item.id===selectedId)||null,unreadCount=events.filter(item=>!item.isRead).length;

  const load=useCallback(async(preferredId='')=>{
    if(!accountProfile)return;
    setLoading(true);setError('');
    try{
      const [{data:watchData},{data:eventData}]=await Promise.all([api.listChangeWatches(),api.listChangeEvents({limit:50})]);
      const items=Array.isArray(watchData)?watchData:[];
      setWatches(items);setEvents(Array.isArray(eventData)?eventData:[]);setSelectedId(current=>{const candidate=preferredId||current;return candidate&&items.some(item=>item.id===candidate)?candidate:items[0]?.id||'';});
    }catch(caught){setError(caught.message||t('tools.changeRadar.loadFailed'));}
    finally{setLoading(false);}
  },[accountProfile,api,t]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{let live=true;if(!selectedId){setSnapshots([]);return()=>{live=false;};}api.listChangeWatchSnapshots(selectedId).then(({data})=>{if(live)setSnapshots(Array.isArray(data)?data:[]);}).catch(()=>{if(live)setSnapshots([]);});return()=>{live=false;};},[api,selectedId]);
  useEffect(()=>agentSurface?subscribeChangeRadarStatus(message=>setAgentStatus(message.status)):undefined,[agentSurface]);
  useEffect(()=>{
    if(!agentSurface||!accountProfile)return undefined;
    const timer=setTimeout(()=>{const context={kind:'change-radar-context',version:2,unreadCount,selectedWatch:selected?{id:selected.id,title:selected.title,url:selected.url,condition:selected.condition,ruleType:selected.ruleType,ruleValue:selected.ruleValue}:null,events:events.slice(0,8).map(item=>({id:item.id,watchTitle:item.watchTitle,url:item.watchUrl,fetchedAt:item.fetchedAt,importance:item.importance,ruleMatched:item.ruleMatched,ruleReason:item.ruleReason,diff:{...(item.diff||{}),changes:Array.isArray(item.diff?.changes)?item.diff.changes.slice(0,6):[]}}))};if(!syncChangeRadarContext(context))setAgentStatus('failed');},500);
    return()=>clearTimeout(timer);
  },[agentSurface,accountProfile,events,selected,unreadCount]);

  const updateForm=(key,value)=>setForm(current=>({...current,[key]:value}));
  const create=async event=>{event.preventDefault();setBusy('create');setError('');setNotice('');const title=form.title.trim()||suggestedTitle(form.url);try{const {data:watch}=await api.createChangeWatch({...form,title});try{globalThis.sessionStorage?.removeItem(pendingStorageKey);}catch{}setNotice(t('tools.changeRadar.created'));setForm(emptyForm);try{await api.checkChangeWatch(watch.id);}catch(caught){setNotice(`${t('tools.changeRadar.created')} ${caught.message||t('tools.changeRadar.firstCheckFailed')}`);}await load(watch.id);setView('watch');}catch(caught){setError(caught.message||t('tools.changeRadar.createFailed'));}finally{setBusy('');}};
  const check=async()=>{if(!selected)return;setBusy(`check:${selected.id}`);setError('');setNotice('');try{const {data}=await api.checkChangeWatch(selected.id);setNotice(data.changed?t('tools.changeRadar.changeFound'):data.initial?t('tools.changeRadar.baselineSaved'):t('tools.changeRadar.noChange'));await load(selected.id);const {data:snapshotData}=await api.listChangeWatchSnapshots(selected.id);setSnapshots(Array.isArray(snapshotData)?snapshotData:[]);}catch(caught){await load(selected.id);setError(caught.message||t('tools.changeRadar.checkFailed'));}finally{setBusy('');}};
  const toggle=async()=>{if(!selected)return;setBusy(`toggle:${selected.id}`);setError('');try{await api.updateChangeWatch(selected.id,{status:selected.status==='paused'?'active':'paused'});await load(selected.id);}catch(caught){setError(caught.message||t('tools.changeRadar.updateFailed'));}finally{setBusy('');}};
  const remove=async()=>{if(!selected||!globalThis.confirm?.(t('tools.changeRadar.removeConfirm')))return;setBusy(`remove:${selected.id}`);setError('');try{await api.deleteChangeWatch(selected.id);setSnapshots([]);await load();}catch(caught){setError(caught.message||t('tools.changeRadar.removeFailed'));}finally{setBusy('');}};
  const markRead=async id=>{setBusy(`read:${id}`);try{await api.markChangeEventRead(id);setEvents(current=>current.map(item=>item.id===id?{...item,isRead:true}:item));setSnapshots(current=>current.map(item=>item.id===id?{...item,isRead:true}:item));setWatches(current=>current.map(item=>item.id===events.find(event=>event.id===id)?.watchId?{...item,unreadCount:Math.max(0,item.unreadCount-1)}:item));}catch(caught){setError(caught.message||t('tools.changeRadar.updateFailed'));}finally{setBusy('');}};

  if(!accountProfile)return <section className="change-radar change-radar--signin"><div className="change-radar__signin-mark" aria-hidden="true">⌁</div><span className="kicker">MOOYU.FUN · CHANGE RADAR</span><h2>{t('tools.changeRadar.signInTitle')}</h2><p>{t('tools.changeRadar.signInLead')}</p><button className="button button--primary" type="button" onClick={()=>{try{if(form.url)globalThis.sessionStorage?.setItem(pendingStorageKey,JSON.stringify(form));}catch{}go('/account');}}><span>{t('tools.changeRadar.signIn')}</span></button></section>;

  return <section className="change-radar">
    <aside className="change-radar__rail">
      <details className="change-radar__guide"><summary>{t('tools.changeRadar.guideTitle')}</summary><ol><li>{t('tools.changeRadar.guide1')}</li><li>{t('tools.changeRadar.guide2')}</li><li>{t('tools.changeRadar.guide3')}</li></ol><p>{t('tools.changeRadar.guidePrivacy')}</p></details>
      <form className="change-radar__composer" onSubmit={create}>
        <div><span className="kicker">NEW WATCH</span><h2>{t('tools.changeRadar.newWatch')}</h2><p>{t('tools.changeRadar.newWatchLead')}</p></div>
        <label>{t('tools.changeRadar.url')}<input type="url" required maxLength="2048" value={form.url} onChange={event=>updateForm('url',event.target.value)} placeholder="https://example.com/page"/></label>
        <label>{t('tools.changeRadar.watchTitle')}<input maxLength="120" value={form.title} onChange={event=>updateForm('title',event.target.value)} placeholder={suggestedTitle(form.url)||t('tools.changeRadar.titlePlaceholder')}/></label>
        <label>{t('tools.changeRadar.rule')}<select value={form.ruleType} onChange={event=>updateForm('ruleType',event.target.value)}>{ruleTypes.map(value=><option key={value} value={value}>{t(`tools.changeRadar.rule.${value}`)}</option>)}</select></label>
        {['keyword_appears','keyword_disappears'].includes(form.ruleType)&&<label>{t('tools.changeRadar.keyword')}<input required maxLength="200" value={form.ruleValue} onChange={event=>updateForm('ruleValue',event.target.value)} placeholder={t('tools.changeRadar.keywordPlaceholder')}/></label>}
        <label>{t('tools.changeRadar.condition')}<textarea maxLength="500" value={form.condition} onChange={event=>updateForm('condition',event.target.value)} placeholder={t('tools.changeRadar.conditionPlaceholder')}/><small>{t('tools.changeRadar.conditionNoteV2')}</small></label>
        <label className="change-radar__checkbox"><input type="checkbox" checked={form.ignoreNoise} onChange={event=>updateForm('ignoreNoise',event.target.checked)}/><span>{t('tools.changeRadar.ignoreNoise')}</span></label>
        <label>{t('tools.changeRadar.interval')}<select value={form.intervalMinutes} onChange={event=>updateForm('intervalMinutes',Number(event.target.value))}>{intervalOptions.map(value=><option key={value} value={value}>{t(`tools.changeRadar.interval.${value}`)}</option>)}</select></label>
        <button className="button button--primary" disabled={busy==='create'} type="submit"><span>{busy==='create'?t('tools.changeRadar.creating'):t('tools.changeRadar.start')}</span></button>
      </form>
      <div className="change-radar__inbox"><button type="button" className={view==='inbox'?'is-active':''} onClick={()=>setView('inbox')}><span>{t('tools.changeRadar.inbox')}</span><strong>{unreadCount}</strong></button></div>
      <div className="change-radar__list-head"><strong>{t('tools.changeRadar.saved')}</strong><span>{watches.length}/20</span></div>
      <div className="change-radar__list">{loading?<p className="change-radar__empty">{t('common.loading')}</p>:watches.length?watches.map(item=><button type="button" className={view==='watch'&&item.id===selectedId?'is-active':''} onClick={()=>{setSelectedId(item.id);setView('watch');}} key={item.id}><span className={`change-radar__dot is-${item.status}`} aria-hidden="true"/><span><strong>{item.title}{item.unreadCount>0&&<em>{item.unreadCount}</em>}</strong><small>{item.url}</small></span></button>):<p className="change-radar__empty">{t('tools.changeRadar.empty')}</p>}</div>
    </aside>
    <div className="change-radar__main">
      <div className="change-radar__agent-state">{agentSurface?<span className={`is-${agentStatus}`}>{agentStatus==='synced'?t('tools.changeRadar.agentSynced'):t('tools.changeRadar.agentSyncing')}</span>:<span>{t('tools.changeRadar.agentHint')}</span>}</div>
      {(error||notice)&&<div className={`change-radar__message ${error?'is-error':'is-ok'}`} role={error?'alert':'status'}>{error||notice}</div>}
      {view==='inbox'?<section className="change-radar__history"><div><span className="kicker">CHANGE INBOX</span><h2>{t('tools.changeRadar.inbox')}</h2><p>{t('tools.changeRadar.inboxLead')}</p></div>{events.length?<div className="change-radar__event-list">{events.map(snapshot=><EventCard key={snapshot.id} snapshot={snapshot} locale={locale} t={t} onRead={markRead} busy={busy}/>)}</div>:<div className="change-radar__empty-history"><span>○</span><p>{t('tools.changeRadar.noEvents')}</p></div>}</section>:!selected?<div className="change-radar__blank"><span aria-hidden="true">⌁</span><h2>{t('tools.changeRadar.blankTitle')}</h2><p>{t('tools.changeRadar.blankLead')}</p></div>:<>
        <header className="change-radar__watch-head"><div><span className={`change-radar__status is-${selected.status}`}>{t(`tools.changeRadar.status.${selected.status}`)}</span><h2>{selected.title}</h2><a href={selected.url} target="_blank" rel="noreferrer">{selected.url} ↗</a></div><div className="change-radar__actions"><button type="button" disabled={busy.startsWith('check:')} onClick={check}>{busy.startsWith('check:')?t('tools.changeRadar.checking'):t('tools.changeRadar.checkNow')}</button><button type="button" disabled={busy.startsWith('toggle:')} onClick={toggle}>{selected.status==='paused'?t('tools.changeRadar.resume'):t('tools.changeRadar.pause')}</button><button className="is-danger" type="button" disabled={busy.startsWith('remove:')} onClick={remove}>{t('tools.changeRadar.remove')}</button></div></header>
        <div className="change-radar__condition"><span>{t('tools.changeRadar.activeRule')}</span><p>{t(`tools.changeRadar.rule.${selected.ruleType||'any'}`)}{selected.ruleValue?` · ${selected.ruleValue}`:''}</p>{selected.condition&&<small>{selected.condition}</small>}</div>
        <dl className="change-radar__facts"><div><dt>{t('tools.changeRadar.lastCheck')}</dt><dd>{formatTime(selected.lastCheckedAt,locale)}</dd></div><div><dt>{t('tools.changeRadar.lastChange')}</dt><dd>{formatTime(selected.lastChangedAt,locale)}</dd></div><div><dt>{t('tools.changeRadar.nextCheck')}</dt><dd>{selected.status==='paused'?'—':formatTime(selected.nextCheckAt,locale)}</dd></div></dl>
        {selected.lastError&&<div className="change-radar__message is-error"><strong>{selected.lastError.code}</strong><br/>{selected.lastError.message}</div>}
        <section className="change-radar__history"><div><span className="kicker">CHANGE HISTORY</span><h3>{t('tools.changeRadar.history')}</h3></div>{snapshots.length?<div className="change-radar__event-list">{snapshots.map(snapshot=><EventCard key={snapshot.id} snapshot={snapshot} locale={locale} t={t} onRead={markRead} busy={busy}/>)}</div>:<div className="change-radar__empty-history"><span>○</span><p>{t('tools.changeRadar.noHistory')}</p></div>}</section>
      </>}
    </div>
  </section>;
}
