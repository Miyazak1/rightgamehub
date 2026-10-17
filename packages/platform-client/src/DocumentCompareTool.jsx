import React,{useMemo,useRef,useState} from 'react';
import {useI18n} from './I18n.jsx';
import {buildDiffReport,buildSideBySideRows,compareDocuments,compareInline,DOCUMENT_DIFF_MODES} from './document-diff.mjs';
import {COMPARABLE_ACCEPT,readComparableFile} from './document-reader.mjs';
import './DocumentCompareTool.css';

const emptyDocument=(label,text='')=>({label,text,fileName:'',meta:''});
const fileSize=size=>size>=1024*1024?`${(size/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(size/1024))} KB`;
const safeName=value=>String(value||'document-comparison').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,90)||'document-comparison';
const downloadText=(text,name)=>{const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

function routeDefaults(t){
  const outer=new URLSearchParams(String(globalThis.location?.search||'').replace(/^\?/u,'')),embedded=outer.get('gh_route'),query=embedded?.includes('?')?embedded.slice(embedded.indexOf('?')+1):String(globalThis.location?.search||'').replace(/^\?/u,''),params=new URLSearchParams(query);
  const mode=DOCUMENT_DIFF_MODES.includes(params.get('mode'))?params.get('mode'):'lines';
  return {mode,leftLabel:(params.get('leftLabel')||t('tools.documentCompare.before')).slice(0,80),rightLabel:(params.get('rightLabel')||t('tools.documentCompare.after')).slice(0,80)};
}

function DocumentInput({side,value,onChange,onFile,t,disabled,reading}){
  const inputRef=useRef(null);
  return <section className={`docdiff-source is-${side}`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();onFile(event.dataTransfer.files?.[0]);}}>
    <header><span>{side==='before'?'A':'B'}</span><input aria-label={t('tools.documentCompare.label')} maxLength="80" value={value.label} onChange={event=>onChange({...value,label:event.target.value})}/><button type="button" onClick={()=>onChange(emptyDocument(value.label))} disabled={!value.text||disabled}>{t('tools.documentCompare.clear')}</button></header>
    <textarea aria-label={side==='before'?t('tools.documentCompare.beforeText'):t('tools.documentCompare.afterText')} value={value.text} onChange={event=>onChange({...value,text:event.target.value,fileName:'',meta:''})} placeholder={side==='before'?t('tools.documentCompare.beforePlaceholder'):t('tools.documentCompare.afterPlaceholder')} spellCheck="false"/>
    <footer><input ref={inputRef} hidden type="file" accept={COMPARABLE_ACCEPT} onChange={event=>{const file=event.target.files?.[0];event.target.value='';onFile(file);}}/><button type="button" className="button button--secondary" onClick={()=>inputRef.current?.click()} disabled={disabled}>{reading?t('tools.documentCompare.reading'):t('tools.documentCompare.openFile')}</button><span>{value.fileName?`${value.fileName} · ${value.meta}`:t('tools.documentCompare.formats')}</span></footer>
  </section>;
}

function InlineLine({row,side,ignoreCase,ignoreWhitespace}){
  const parts=compareInline(row.before,row.after,{ignoreCase,ignoreWhitespace});
  return parts.map((part,index)=>{
    if(side==='before'&&part.added||side==='after'&&part.removed)return null;
    const changed=side==='before'?part.removed:part.added;
    return <span key={index} className={changed?side==='before'?'is-removed':'is-added':''}>{part.value}</span>;
  });
}

export default function DocumentCompareTool(){
  const {t}=useI18n(),defaults=useMemo(()=>routeDefaults(t),[t]);
  const [before,setBefore]=useState(()=>emptyDocument(defaults.leftLabel)),[after,setAfter]=useState(()=>emptyDocument(defaults.rightLabel));
  const [mode,setMode]=useState(defaults.mode),[ignoreWhitespace,setIgnoreWhitespace]=useState(false),[ignoreCase,setIgnoreCase]=useState(false),[view,setView]=useState('split'),[changesOnly,setChangesOnly]=useState(false);
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[snapshot,setSnapshot]=useState(null),[changeIndex,setChangeIndex]=useState(0);
  const result=snapshot?.result||null,rows=useMemo(()=>snapshot?buildSideBySideRows(snapshot.before.text,snapshot.after.text,snapshot.options):[],[snapshot]),visibleRows=changesOnly?rows.filter(row=>row.status!=='same'):rows;
  const changeRows=rows.filter(row=>row.status!=='same'),navigationCount=view==='split'?changeRows.length:result?.stats.changes||0,resultRef=useRef(null);
  const updateBefore=value=>{setBefore(value);setSnapshot(null);setNotice('');};
  const updateAfter=value=>{setAfter(value);setSnapshot(null);setNotice('');};
  const readFile=async(side,file)=>{if(!file)return;setBusy(side);setNotice('');try{const parsed=await readComparableFile(file,{onProgress:({page,total})=>setNotice(t('tools.documentCompare.readingPage',{page,total}))}),value={label:file.name,text:parsed.text,fileName:file.name,meta:[fileSize(parsed.size),parsed.pages?`${parsed.pages} ${t('tools.documentCompare.pages')}`:'',parsed.warnings?`${parsed.warnings} ${t('tools.documentCompare.warnings')}`:''].filter(Boolean).join(' · ')};side==='before'?updateBefore(value):updateAfter(value);setNotice(t('tools.documentCompare.fileReady',{name:file.name}));}catch(error){setNotice(t(`tools.documentCompare.error.${error?.code||'unknown'}`));}finally{setBusy('');}};
  const compare=()=>{if(!before.text&&!after.text){setNotice(t('tools.documentCompare.needContent'));return;}const options={mode,ignoreWhitespace,ignoreCase},next={before:{...before},after:{...after},options,result:compareDocuments(before.text,after.text,options)};setSnapshot(next);setChangeIndex(0);setNotice(next.result.stats.changes?t('tools.documentCompare.complete',{count:next.result.stats.changes}):t('tools.documentCompare.identical'));};
  const swap=()=>{const left=before;setBefore(after);setAfter(left);setSnapshot(null);setNotice('');};
  const goChange=direction=>{if(!navigationCount)return;const next=(changeIndex+direction+navigationCount)%navigationCount;setChangeIndex(next);requestAnimationFrame(()=>resultRef.current?.querySelector(`[data-change="${next}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));};
  const report=()=>buildDiffReport({beforeLabel:snapshot.before.label,afterLabel:snapshot.after.label,before:snapshot.before.text,after:snapshot.after.text,options:snapshot.options});
  const copySummary=async()=>{if(!snapshot)return;try{await navigator.clipboard.writeText(report());setNotice(t('tools.documentCompare.copied'));}catch{setNotice(t('tools.documentCompare.copyFailed'));}};
  const exportReport=()=>{if(!snapshot)return;downloadText(report(),`${safeName(`${snapshot.before.label}-${snapshot.after.label}`)}-diff.md`);setNotice(t('tools.documentCompare.exported'));};
  let unifiedChange=-1;

  return <section className="docdiff-tool" aria-label={t('tools.documentCompare.workspace')}>
    <div className="docdiff-trust"><span aria-hidden="true">●</span><div><strong>{t('tools.documentCompare.localOnly')}</strong><p>{t('tools.documentCompare.localLead')}</p></div></div>
    <div className="docdiff-sources">
      <DocumentInput side="before" value={before} onChange={updateBefore} onFile={file=>readFile('before',file)} t={t} disabled={Boolean(busy)} reading={busy==='before'}/>
      <button className="docdiff-swap" type="button" onClick={swap} aria-label={t('tools.documentCompare.swap')} title={t('tools.documentCompare.swap')}>⇄</button>
      <DocumentInput side="after" value={after} onChange={updateAfter} onFile={file=>readFile('after',file)} t={t} disabled={Boolean(busy)} reading={busy==='after'}/>
    </div>
    <div className="docdiff-controls">
      <label><span>{t('tools.documentCompare.granularity')}</span><select value={mode} onChange={event=>{setMode(event.target.value);setSnapshot(null);}}><option value="lines">{t('tools.documentCompare.lines')}</option><option value="words">{t('tools.documentCompare.words')}</option><option value="characters">{t('tools.documentCompare.characters')}</option></select></label>
      <label className="docdiff-toggle"><input type="checkbox" checked={ignoreWhitespace} onChange={event=>{setIgnoreWhitespace(event.target.checked);setSnapshot(null);}}/>{t('tools.documentCompare.ignoreWhitespace')}</label>
      <label className="docdiff-toggle"><input type="checkbox" checked={ignoreCase} onChange={event=>{setIgnoreCase(event.target.checked);setSnapshot(null);}}/>{t('tools.documentCompare.ignoreCase')}</label>
      <button className="button button--primary" type="button" onClick={compare} disabled={Boolean(busy)}>{t('tools.documentCompare.compare')}</button>
    </div>
    {result?<section className="docdiff-result" ref={resultRef}>
      <header className="docdiff-result__header"><div><span className="kicker">DIFF REPORT</span><h2>{snapshot.before.label} <em>↔</em> {snapshot.after.label}</h2></div><div className="docdiff-result__actions"><button onClick={()=>goChange(-1)} disabled={!navigationCount}>↑</button><span>{navigationCount?t('tools.documentCompare.changePosition',{current:Math.min(changeIndex+1,navigationCount),total:navigationCount}):t('tools.documentCompare.noChanges')}</span><button onClick={()=>goChange(1)} disabled={!navigationCount}>↓</button><button onClick={copySummary}>{t('tools.documentCompare.copyReport')}</button><button onClick={exportReport}>{t('tools.documentCompare.exportReport')}</button></div></header>
      <div className="docdiff-stats"><article><strong>{result.stats.similarity}%</strong><span>{t('tools.documentCompare.similarity')}</span></article><article className="is-added"><strong>+{result.stats.added}</strong><span>{t('tools.documentCompare.added')}</span></article><article className="is-removed"><strong>−{result.stats.removed}</strong><span>{t('tools.documentCompare.removed')}</span></article><article><strong>{result.stats.changes}</strong><span>{t('tools.documentCompare.changeBlocks')}</span></article></div>
      <div className="docdiff-viewbar"><div><button aria-pressed={view==='split'} onClick={()=>setView('split')}>{t('tools.documentCompare.split')}</button><button aria-pressed={view==='unified'} onClick={()=>setView('unified')}>{t('tools.documentCompare.unified')}</button></div><label><input type="checkbox" checked={changesOnly} onChange={event=>setChangesOnly(event.target.checked)}/>{t('tools.documentCompare.changesOnly')}</label></div>
      {view==='split'?<div className="docdiff-split"><div className="docdiff-split__labels"><strong>{snapshot.before.label}</strong><strong>{snapshot.after.label}</strong></div>{visibleRows.map(row=>{const change=row.status!=='same'?changeRows.indexOf(row):-1;return <div className={`docdiff-row is-${row.status}`} key={row.id} data-change={change>=0?change:undefined}><div><span>{row.beforeNumber??''}</span><code>{row.status==='changed'?<InlineLine row={row} side="before" ignoreCase={snapshot.options.ignoreCase} ignoreWhitespace={snapshot.options.ignoreWhitespace}/>:row.before||' '}</code></div><div><span>{row.afterNumber??''}</span><code>{row.status==='changed'?<InlineLine row={row} side="after" ignoreCase={snapshot.options.ignoreCase} ignoreWhitespace={snapshot.options.ignoreWhitespace}/>:row.after||' '}</code></div></div>})}</div>:<div className={`docdiff-unified${changesOnly?' is-changes-only':''}`}>{result.parts.map(part=>{const change=part.added||part.removed?++unifiedChange:-1;if(changesOnly&&!part.added&&!part.removed)return null;return <span key={part.id} data-change={change>=0?change:undefined} className={part.added?'is-added':part.removed?'is-removed':''}>{part.value}</span>;})}</div>}
    </section>:<div className="docdiff-empty"><span aria-hidden="true">⇄</span><strong>{t('tools.documentCompare.readyTitle')}</strong><p>{t('tools.documentCompare.readyLead')}</p></div>}
    {notice?<div className="docdiff-notice" role="status">{notice}</div>:null}
  </section>;
}
