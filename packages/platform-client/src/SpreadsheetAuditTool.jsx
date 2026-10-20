import React,{useMemo,useRef,useState} from 'react';
import {useI18n} from './I18n.jsx';
import {analyzeWorkbook,buildSpreadsheetAuditReport,compareWorkbooks} from './spreadsheet-audit.mjs';
import {readSpreadsheetFile,SPREADSHEET_ACCEPT} from './spreadsheet-reader.mjs';
import './SpreadsheetAuditTool.css';

const formatBytes=value=>value>=1024*1024?`${(value/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(value/1024))} KB`;
const safeName=value=>String(value||'excel-formula-audit').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,90)||'excel-formula-audit';
const downloadText=(text,name)=>{const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

function WorkbookDrop({kind,file,workbook,busy,onFile,t}){
  const inputRef=useRef(null),current=kind==='current';
  return <section className={`sheet-audit-drop is-${kind}`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();onFile(event.dataTransfer.files?.[0]);}}>
    <input ref={inputRef} hidden type="file" accept={SPREADSHEET_ACCEPT} onChange={event=>{const selected=event.target.files?.[0];event.target.value='';onFile(selected);}}/>
    <div className="sheet-audit-drop__mark" aria-hidden="true">{current?'ƒx':'↤'}</div>
    <div><span className="kicker">{current?'CURRENT WORKBOOK':'BASELINE · OPTIONAL'}</span><h2>{t(current?'tools.spreadsheetAudit.current':'tools.spreadsheetAudit.baseline')}</h2>{workbook?<p><strong>{file.name}</strong><small>{formatBytes(file.size)} · {workbook.sheets.length} {t('tools.spreadsheetAudit.sheets')} · {workbook.stats.formulas} {t('tools.spreadsheetAudit.formulas')}</small></p>:<p>{t(current?'tools.spreadsheetAudit.currentLead':'tools.spreadsheetAudit.baselineLead')}</p>}</div>
    <button type="button" className={current?'button button--primary':'button button--secondary'} disabled={busy} onClick={()=>inputRef.current?.click()}>{busy?t('tools.spreadsheetAudit.reading'):workbook?t('tools.spreadsheetAudit.replace'):t('tools.spreadsheetAudit.choose')}</button>
  </section>;
}

const CellButton=({item,active,onClick,children})=><button type="button" className={active?'is-active':''} onClick={onClick}><span>{item.sheet}!{item.address}</span>{children}</button>;

export default function SpreadsheetAuditTool(){
  const {t}=useI18n();
  const [currentFile,setCurrentFile]=useState(null),[current,setCurrent]=useState(null),[analysis,setAnalysis]=useState(null);
  const [baselineFile,setBaselineFile]=useState(null),[baseline,setBaseline]=useState(null);
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[tab,setTab]=useState('issues'),[sheet,setSheet]=useState('all'),[query,setQuery]=useState(''),[selected,setSelected]=useState(null);
  const comparison=useMemo(()=>baseline&&current?compareWorkbooks(baseline,current):null,[baseline,current]);
  const relation=useMemo(()=>selected&&analysis?analysis.relations(selected.sheet,selected.address):null,[analysis,selected]);
  const load=async(kind,file)=>{if(!file)return;setBusy(kind);setNotice('');try{const workbook=await readSpreadsheetFile(file,{onProgress:({sheet:position,total,name})=>setNotice(t('tools.spreadsheetAudit.readingSheet',{position,total,name}))});if(kind==='current'){setCurrentFile(file);setCurrent(workbook);const next=analyzeWorkbook(workbook);setAnalysis(next);setSelected(next.formulas[0]||null);setSheet('all');setTab(next.issues.length?'issues':'formulas');}else{setBaselineFile(file);setBaseline(workbook);setTab('changes');}setNotice(t('tools.spreadsheetAudit.ready',{name:file.name}));}catch(error){setNotice(t(`tools.spreadsheetAudit.error.${error?.code||'unknown'}`));}finally{setBusy('');}};
  const sheets=current?.sheets.map(item=>item.name)||[];
  const matches=item=>(sheet==='all'||item.sheet===sheet)&&(!query||`${item.sheet} ${item.address} ${item.formula||''} ${item.before||''} ${item.after||''} ${item.code||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const issueRows=analysis?.issues.filter(matches)||[],formulaRows=analysis?.formulas.filter(matches)||[],changeRows=comparison?.changes.filter(matches)||[];
  const report=()=>buildSpreadsheetAuditReport({analysis,comparison,currentName:currentFile?.name,baselineName:baselineFile?.name});
  const copyReport=async(agent=false)=>{if(!analysis)return;const content=agent?`${t('tools.spreadsheetAudit.agentPrompt')}\n\n${report()}`:report();try{await navigator.clipboard.writeText(content);setNotice(t(agent?'tools.spreadsheetAudit.agentCopied':'tools.spreadsheetAudit.copied'));}catch{setNotice(t('tools.spreadsheetAudit.copyFailed'));}};
  const exportReport=()=>{if(!analysis)return;downloadText(report(),`${safeName(currentFile?.name)}-formula-audit.md`);setNotice(t('tools.spreadsheetAudit.exported'));};

  return <section className="sheet-audit" aria-label={t('tools.spreadsheetAudit.workspace')}>
    <div className="sheet-audit-trust"><span aria-hidden="true">●</span><div><strong>{t('tools.spreadsheetAudit.localOnly')}</strong><p>{t('tools.spreadsheetAudit.localLead')}</p></div></div>
    <div className="sheet-audit-files">
      <WorkbookDrop kind="current" file={currentFile} workbook={current} busy={Boolean(busy)} onFile={file=>load('current',file)} t={t}/>
      <WorkbookDrop kind="baseline" file={baselineFile} workbook={baseline} busy={Boolean(busy)} onFile={file=>load('baseline',file)} t={t}/>
    </div>
    {analysis?<>
      {current.hasMacros?<div className="sheet-audit-warning">{t('tools.spreadsheetAudit.macros')}</div>:null}
      <div className="sheet-audit-stats"><article><strong>{analysis.stats.sheets}</strong><span>{t('tools.spreadsheetAudit.sheets')}</span></article><article><strong>{analysis.stats.formulas}</strong><span>{t('tools.spreadsheetAudit.formulas')}</span></article><article><strong>{analysis.stats.references}</strong><span>{t('tools.spreadsheetAudit.references')}</span></article><article className={analysis.stats.issues?'has-issues':''}><strong>{analysis.stats.issues}</strong><span>{t('tools.spreadsheetAudit.review')}</span></article></div>
      <div className="sheet-audit-toolbar"><div role="tablist"><button aria-selected={tab==='issues'} onClick={()=>setTab('issues')}>{t('tools.spreadsheetAudit.issues')} <span>{analysis.issues.length}</span></button><button aria-selected={tab==='formulas'} onClick={()=>setTab('formulas')}>{t('tools.spreadsheetAudit.formulaList')} <span>{analysis.formulas.length}</span></button><button aria-selected={tab==='changes'} disabled={!comparison} onClick={()=>setTab('changes')}>{t('tools.spreadsheetAudit.changes')} <span>{comparison?.changes.length||0}</span></button></div><div><select aria-label={t('tools.spreadsheetAudit.filterSheet')} value={sheet} onChange={event=>setSheet(event.target.value)}><option value="all">{t('tools.spreadsheetAudit.allSheets')}</option>{sheets.map(name=><option value={name} key={name}>{name}</option>)}</select><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('tools.spreadsheetAudit.search')}/></div></div>
      <div className="sheet-audit-workspace">
        <section className="sheet-audit-list">
          {tab==='issues'?(issueRows.length?issueRows.map(item=><CellButton item={item} key={item.id} active={selected?.sheet===item.sheet&&selected?.address===item.address} onClick={()=>setSelected(analysis.formulaByKey.get(`${item.sheet}!${item.address}`)||item)}><strong className={`is-${item.severity}`}>{t(`tools.spreadsheetAudit.issue.${item.code}`)}</strong><code>{item.formula||t('tools.spreadsheetAudit.fixedValue',{value:current.sheets.find(value=>value.name===item.sheet)?.cells.find(cell=>cell.address===item.address)?.value||'—'})}</code>{item.neighbors?<small>{t('tools.spreadsheetAudit.between',{before:item.neighbors[0],after:item.neighbors[1]})}</small>:null}</CellButton>):<div className="sheet-audit-empty"><span>✓</span><strong>{t('tools.spreadsheetAudit.noIssues')}</strong><p>{t('tools.spreadsheetAudit.noIssuesLead')}</p></div>):null}
          {tab==='formulas'?(formulaRows.length?formulaRows.slice(0,1000).map(item=><CellButton item={item} key={item.key} active={selected?.key===item.key} onClick={()=>setSelected(item)}><code>{item.formula}</code><small>{item.references.length} {t('tools.spreadsheetAudit.references')}</small></CellButton>):<div className="sheet-audit-empty"><strong>{t('tools.spreadsheetAudit.noResults')}</strong></div>):null}
          {tab==='changes'?(changeRows.length?changeRows.map(item=><CellButton item={item} key={item.key} active={false} onClick={()=>setSelected(analysis.formulaByKey.get(item.key)||item)}><strong className={`is-${item.type}`}>{t(`tools.spreadsheetAudit.change.${item.type}`)}</strong><code>{item.before||'—'}<em>→</em>{item.after||'—'}</code></CellButton>):<div className="sheet-audit-empty"><span>≡</span><strong>{t('tools.spreadsheetAudit.noChanges')}</strong><p>{comparison?t('tools.spreadsheetAudit.noChangesLead'):t('tools.spreadsheetAudit.addBaseline')}</p></div>):null}
        </section>
        <aside className="sheet-audit-detail">
          {selected?<><header><span className="kicker">FORMULA TRACE</span><h3>{selected.sheet}!{selected.address}</h3></header><div className="sheet-audit-formula"><span>{t('tools.spreadsheetAudit.formula')}</span><code>{selected.formula||'—'}</code></div><div className="sheet-audit-relations"><section><h4>{t('tools.spreadsheetAudit.precedents')}</h4>{relation?.precedents.length?<ul>{relation.precedents.slice(0,100).map(item=><li key={item.key}><button onClick={()=>item.cell?.formula&&setSelected(analysis.formulaByKey.get(item.key))}>{item.key}</button><span>{item.cell?.formula||item.cell?.value||t('tools.spreadsheetAudit.notLoaded')}</span></li>)}</ul>:<p>{t('tools.spreadsheetAudit.none')}</p>}</section><section><h4>{t('tools.spreadsheetAudit.dependents')}</h4>{relation?.dependents.length?<ul>{relation.dependents.slice(0,100).map(item=><li key={item.key}><button onClick={()=>setSelected(item.cell)}>{item.key}</button><span>{item.cell?.formula}</span></li>)}</ul>:<p>{t('tools.spreadsheetAudit.none')}</p>}</section></div><small className="sheet-audit-caution">{t('tools.spreadsheetAudit.caution')}</small></>:<div className="sheet-audit-detail__empty"><span>ƒx</span><p>{t('tools.spreadsheetAudit.selectCell')}</p></div>}
        </aside>
      </div>
      <footer className="sheet-audit-actions"><p>{t('tools.spreadsheetAudit.reportLead')}</p><div><button className="button button--secondary" onClick={()=>copyReport(false)}>{t('tools.spreadsheetAudit.copy')}</button><button className="button button--secondary" onClick={exportReport}>{t('tools.spreadsheetAudit.export')}</button><button className="button button--primary" onClick={()=>copyReport(true)}>{t('tools.spreadsheetAudit.copyAgent')}</button></div></footer>
    </>:<div className="sheet-audit-start"><span aria-hidden="true">ƒx</span><strong>{t('tools.spreadsheetAudit.startTitle')}</strong><p>{t('tools.spreadsheetAudit.startLead')}</p></div>}
    {notice?<div className="sheet-audit-notice" role="status">{notice}</div>:null}
  </section>;
}
