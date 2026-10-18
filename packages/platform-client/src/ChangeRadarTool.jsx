import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {useI18n} from './I18n.jsx';

const intervalOptions=[15,60,360,720,1440,10080];
const pendingStorageKey='mooyu.change-radar.pending';

function routePrefill(){
  const outer=new URLSearchParams(String(globalThis.location?.search||'').replace(/^\?/u,''));
  const embedded=outer.get('gh_route');
  const query=embedded?.includes('?')?embedded.slice(embedded.indexOf('?')+1):String(globalThis.location?.search||'').replace(/^\?/u,'');
  const params=new URLSearchParams(query),interval=Number(params.get('interval')||360);
  const incoming={url:params.get('url')||'',title:params.get('title')||'',condition:params.get('condition')||'',intervalMinutes:intervalOptions.includes(interval)?interval:360};
  if(incoming.url)return incoming;
  try{const saved=JSON.parse(globalThis.sessionStorage?.getItem(pendingStorageKey)||'null');return saved?.url?{...incoming,...saved}:incoming;}catch{return incoming;}
}

function suggestedTitle(value){
  try{return new URL(value).hostname.replace(/^www\./u,'');}catch{return '';}
}

function formatTime(value,locale){
  if(!value)return '—';
  try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return value;}
}

export default function ChangeRadarTool({api,accountProfile,go}){
  const {t,locale}=useI18n(),prefill=useMemo(routePrefill,[]);
  const [form,setForm]=useState(prefill),[watches,setWatches]=useState([]),[selectedId,setSelectedId]=useState(''),[snapshots,setSnapshots]=useState([]);
  const [loading,setLoading]=useState(Boolean(accountProfile)),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const selected=watches.find(item=>item.id===selectedId)||null;

  const load=useCallback(async(preferredId='')=>{
    if(!accountProfile)return;
    setLoading(true);setError('');
    try{
      const {data}=await api.listChangeWatches(),items=Array.isArray(data)?data:[];
      setWatches(items);setSelectedId(current=>{const candidate=preferredId||current;return candidate&&items.some(item=>item.id===candidate)?candidate:items[0]?.id||'';});
    }catch(caught){setError(caught.message||t('tools.changeRadar.loadFailed'));}
    finally{setLoading(false);}
  },[accountProfile,api,t]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    let live=true;
    if(!selectedId){setSnapshots([]);return()=>{live=false;};}
    api.listChangeWatchSnapshots(selectedId).then(({data})=>{if(live)setSnapshots(Array.isArray(data)?data:[]);}).catch(()=>{if(live)setSnapshots([]);});
    return()=>{live=false;};
  },[api,selectedId]);

  const updateForm=(key,value)=>setForm(current=>({...current,[key]:value}));
  const create=async event=>{
    event.preventDefault();setBusy('create');setError('');setNotice('');
    const title=form.title.trim()||suggestedTitle(form.url);
    try{
      const {data:watch}=await api.createChangeWatch({...form,title});
      try{globalThis.sessionStorage?.removeItem(pendingStorageKey);}catch{}
      setNotice(t('tools.changeRadar.created'));setForm({url:'',title:'',condition:'',intervalMinutes:360});
      try{await api.checkChangeWatch(watch.id);}catch(caught){setNotice(`${t('tools.changeRadar.created')} ${caught.message||t('tools.changeRadar.firstCheckFailed')}`);}
      await load(watch.id);
    }catch(caught){setError(caught.message||t('tools.changeRadar.createFailed'));}
    finally{setBusy('');}
  };
  const check=async()=>{
    if(!selected)return;setBusy(`check:${selected.id}`);setError('');setNotice('');
    try{const {data}=await api.checkChangeWatch(selected.id);setNotice(data.changed?t('tools.changeRadar.changeFound'):data.initial?t('tools.changeRadar.baselineSaved'):t('tools.changeRadar.noChange'));await load(selected.id);}
    catch(caught){await load(selected.id);setError(caught.message||t('tools.changeRadar.checkFailed'));}
    finally{setBusy('');}
  };
  const toggle=async()=>{
    if(!selected)return;setBusy(`toggle:${selected.id}`);setError('');
    try{await api.updateChangeWatch(selected.id,{status:selected.status==='paused'?'active':'paused'});await load(selected.id);}
    catch(caught){setError(caught.message||t('tools.changeRadar.updateFailed'));}finally{setBusy('');}
  };
  const remove=async()=>{
    if(!selected||!globalThis.confirm?.(t('tools.changeRadar.removeConfirm')))return;
    setBusy(`remove:${selected.id}`);setError('');
    try{await api.deleteChangeWatch(selected.id);setSnapshots([]);await load();}
    catch(caught){setError(caught.message||t('tools.changeRadar.removeFailed'));}finally{setBusy('');}
  };

  if(!accountProfile)return <section className="change-radar change-radar--signin"><div className="change-radar__signin-mark" aria-hidden="true">⌁</div><span className="kicker">MOOYU.FUN · CHANGE RADAR</span><h2>{t('tools.changeRadar.signInTitle')}</h2><p>{t('tools.changeRadar.signInLead')}</p><button className="button button--primary" type="button" onClick={()=>{try{if(form.url)globalThis.sessionStorage?.setItem(pendingStorageKey,JSON.stringify(form));}catch{}go('/account');}}><span>{t('tools.changeRadar.signIn')}</span></button></section>;

  return <section className="change-radar">
    <aside className="change-radar__rail">
      <form className="change-radar__composer" onSubmit={create}>
        <div><span className="kicker">NEW WATCH</span><h2>{t('tools.changeRadar.newWatch')}</h2><p>{t('tools.changeRadar.newWatchLead')}</p></div>
        <label>{t('tools.changeRadar.url')}<input type="url" required maxLength="2048" value={form.url} onChange={event=>updateForm('url',event.target.value)} placeholder="https://example.com/page"/></label>
        <label>{t('tools.changeRadar.watchTitle')}<input maxLength="120" value={form.title} onChange={event=>updateForm('title',event.target.value)} placeholder={suggestedTitle(form.url)||t('tools.changeRadar.titlePlaceholder')}/></label>
        <label>{t('tools.changeRadar.condition')}<textarea maxLength="500" value={form.condition} onChange={event=>updateForm('condition',event.target.value)} placeholder={t('tools.changeRadar.conditionPlaceholder')}/><small>{t('tools.changeRadar.conditionNote')}</small></label>
        <label>{t('tools.changeRadar.interval')}<select value={form.intervalMinutes} onChange={event=>updateForm('intervalMinutes',Number(event.target.value))}>{intervalOptions.map(value=><option key={value} value={value}>{t(`tools.changeRadar.interval.${value}`)}</option>)}</select></label>
        <button className="button button--primary" disabled={busy==='create'} type="submit"><span>{busy==='create'?t('tools.changeRadar.creating'):t('tools.changeRadar.start')}</span></button>
      </form>
      <div className="change-radar__list-head"><strong>{t('tools.changeRadar.saved')}</strong><span>{watches.length}/20</span></div>
      <div className="change-radar__list">{loading?<p className="change-radar__empty">{t('common.loading')}</p>:watches.length?watches.map(item=><button type="button" className={item.id===selectedId?'is-active':''} onClick={()=>setSelectedId(item.id)} key={item.id}><span className={`change-radar__dot is-${item.status}`} aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.url}</small></span></button>):<p className="change-radar__empty">{t('tools.changeRadar.empty')}</p>}</div>
    </aside>
    <div className="change-radar__main">
      {(error||notice)&&<div className={`change-radar__message ${error?'is-error':'is-ok'}`} role={error?'alert':'status'}>{error||notice}</div>}
      {!selected?<div className="change-radar__blank"><span aria-hidden="true">⌁</span><h2>{t('tools.changeRadar.blankTitle')}</h2><p>{t('tools.changeRadar.blankLead')}</p></div>:<>
        <header className="change-radar__watch-head"><div><span className={`change-radar__status is-${selected.status}`}>{t(`tools.changeRadar.status.${selected.status}`)}</span><h2>{selected.title}</h2><a href={selected.url} target="_blank" rel="noreferrer">{selected.url} ↗</a></div><div className="change-radar__actions"><button type="button" disabled={busy.startsWith('check:')} onClick={check}>{busy.startsWith('check:')?t('tools.changeRadar.checking'):t('tools.changeRadar.checkNow')}</button><button type="button" disabled={busy.startsWith('toggle:')} onClick={toggle}>{selected.status==='paused'?t('tools.changeRadar.resume'):t('tools.changeRadar.pause')}</button><button className="is-danger" type="button" disabled={busy.startsWith('remove:')} onClick={remove}>{t('tools.changeRadar.remove')}</button></div></header>
        {selected.condition&&<div className="change-radar__condition"><span>{t('tools.changeRadar.condition')}</span><p>{selected.condition}</p></div>}
        <dl className="change-radar__facts"><div><dt>{t('tools.changeRadar.lastCheck')}</dt><dd>{formatTime(selected.lastCheckedAt,locale)}</dd></div><div><dt>{t('tools.changeRadar.lastChange')}</dt><dd>{formatTime(selected.lastChangedAt,locale)}</dd></div><div><dt>{t('tools.changeRadar.nextCheck')}</dt><dd>{selected.status==='paused'?'—':formatTime(selected.nextCheckAt,locale)}</dd></div></dl>
        {selected.lastError&&<div className="change-radar__message is-error"><strong>{selected.lastError.code}</strong><br/>{selected.lastError.message}</div>}
        <section className="change-radar__history"><div><span className="kicker">CHANGE HISTORY</span><h3>{t('tools.changeRadar.history')}</h3></div>{snapshots.length?<ol>{snapshots.map(snapshot=><li key={snapshot.id}><div><span className={`change-radar__snapshot-kind is-${snapshot.changeKind}`}>{t(`tools.changeRadar.snapshot.${snapshot.changeKind}`)}</span><time>{formatTime(snapshot.fetchedAt,locale)}</time></div><p>{snapshot.excerpt}</p><small>HTTP {snapshot.statusCode} · {snapshot.contentType}</small></li>)}</ol>:<div className="change-radar__empty-history"><span>○</span><p>{t('tools.changeRadar.noHistory')}</p></div>}</section>
      </>}
    </div>
  </section>;
}
