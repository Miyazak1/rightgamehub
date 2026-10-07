import React,{useEffect,useRef,useState} from 'react';
import {formatBytes} from './upload-display.mjs';

const size=n=>formatBytes(Number(n));
const ms=n=>n===null?'无样本或 >60 秒':'≤ '+n+' ms';
const channels={production:'正式',preview:'预览'};
const modes={inspect:'检查用量与正文摘要',repair:'修复用量计数',cleanup:'清理过期历史正文'};
const operations={read:'读取',write:'写入',delete:'删除',restore:'恢复',receipt:'回执查询'};

export default function SaveOperationsPage({api,go,admin=false}) {
  const [data,setData]=useState(null),[capacity,setCapacity]=useState(null),[audit,setAudit]=useState([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(false);
  const [reason,setReason]=useState(''),[limit,setLimit]=useState(''),[paused,setPaused]=useState(false),[cursor,setCursor]=useState(null),[maintenance,setMaintenance]=useState({});
  const pending=useRef(null),feedback=useRef(null);
  useEffect(()=>{if(error||notice)feedback.current?.focus();},[error,notice]);
  const load=async afterWorkId=>{
    const result=await api.getSaveHealth({admin,afterWorkId:afterWorkId??undefined});setData(result.data);setCursor(afterWorkId??null);
    if(admin){const [c,a]=await Promise.all([api.getSaveCapacity(),api.getSaveAdminAudit()]);setCapacity(c.data);setLimit(String(c.data.maxPayloadBytes));setPaused(c.data.writesPaused);setAudit(a.data.items);}
  };
  useEffect(()=>{setData(null);setError('');load().catch(e=>setError(e.message||'无法加载存档运营状态。'));},[api,admin]);
  const refresh=async after=>{setBusy(true);setError('');try{await load(after);}catch(e){setError(e.message||'刷新失败。');}finally{setBusy(false);}};
  const execute=async job=>{
    if(busy)return;
    pending.current=job;setBusy(true);setError('');setNotice('');setRetry(false);
    try{
      const response=await job.run();pending.current=null;
      if(job.workId){setMaintenance(current=>({...current,[job.workId]:{...response.data,mode:job.mode}}));const r=response.data;setNotice('本批检查 '+r.scopes+' 个账号/环境分区，发现 '+r.mismatchScopes+' 处计数差异，修复 '+r.repairedScopes+' 处；清理 '+r.purgedPayloads+' 份历史正文。摘要异常 '+r.invalidPayloads+' 份，缺少当前正文 '+r.missingCurrentPayloads+' 份。');}
      else setNotice(job.label+'已生效，操作原因和前后状态已记入审计。');
      await load(cursor);
    }catch(e){
      if(pending.current){if(e.status>=400&&e.status<500&&e.status!==408){pending.current=null;}else setRetry(true);}
      setError(e.message||'未收到操作结果。请用原操作重试。');
    }finally{setBusy(false);}
  };
  const auditInput=()=>({operationId:globalThis.crypto.randomUUID(),reason:reason.trim()});
  const pausePolicy=p=>{const input={...auditInput(),expectedVersion:p.version,writesPaused:!p.writesPaused};execute({label:input.writesPaused?'命名空间写入暂停':'命名空间写入恢复',run:()=>api.pauseSavePolicy(p.id,input)});};
  const updateCapacity=e=>{e.preventDefault();const input={...auditInput(),expectedVersion:capacity.version,writesPaused:paused,maxPayloadBytes:Number(limit)};execute({label:'容量策略',run:()=>api.setSaveCapacity(input)});};
  const maintain=(workId,mode,after)=>{const input={...auditInput(),mode,...(after?{after}:{})};execute({workId,mode,run:()=>api.maintainGameSaves(workId,input)});};
  const disabled=busy||retry,needsReason=disabled||!reason.trim();
  return <main className="page save-operations-page">
    <button className="button button--ghost" onClick={()=>go(admin?'/admin':'/creator')}>← 返回{admin?'平台运营':'创作中心'}</button>
    <div className="section-heading"><div><span className="kicker">SAVE HEALTH</span><h1>{admin?'存档运营':'存档健康'}</h1><p>{admin?'查看容量、暂停新写入，按批检查与维护历史正文。':'查看自己作品的接入策略、用量和同步质量。'}</p></div><button className="button button--secondary" disabled={disabled} onClick={()=>refresh(cursor)}>刷新</button></div>
    {error&&<p className="form-error" role="alert" ref={feedback} tabIndex={-1}>{error}</p>}{notice&&<p className="admin-notice" role="status" ref={error?undefined:feedback} tabIndex={-1}>{notice}</p>}
    {retry&&<div className="save-ops-callout"><p>结果尚未确认。重试将沿用原操作编号、参数与原因。</p><button className="button" disabled={busy} onClick={()=>execute(pending.current)}>重试原操作</button></div>}
    {admin&&<section className="panel save-ops-panel"><h2>操作原因</h2><label>每次变更与检查均会记入审计<textarea maxLength={1000} required disabled={disabled} value={reason} onChange={e=>setReason(e.target.value)} placeholder="填写工单、故障排查或维护原因"/></label></section>}
    {admin&&capacity&&<section className="panel save-ops-panel"><h2>容量与写入保护</h2><div className="save-ops-stats"><div><span>保留的正文</span><strong>{size(capacity.retainedBytes)}</strong></div><div><span>正文总量门限</span><strong>{size(capacity.maxPayloadBytes)}</strong></div><div><span>存档表及索引</span><strong>{size(capacity.saveTableBytes)}</strong></div><div><span>数据库总量</span><strong>{size(capacity.databaseBytes)}</strong></div></div>
      <p>正文门限只计算保留的存档内容。磁盘保护根据 PostgreSQL 数据卷采样及未覆盖的写入预留判断。暂停或超限后，读取、导出、删除和成功请求的重试仍可使用。</p>
      {capacity.storage&&<div className="save-ops-callout"><h3>数据库磁盘保护</h3><p>{!capacity.storage.required?'本地环境未强制保护':capacity.storage.allowed?'刷新时磁盘检查通过':'刷新时新写入已停止'} · {capacity.storage.code}</p><p>最近采样：{capacity.storage.observedAt?new Date(capacity.storage.observedAt).toLocaleString('zh-CN'):'尚无采样'} · 采样可用空间 {capacity.diskFreeBytes===null?'未知':size(capacity.diskFreeBytes)} · WAL {capacity.storage.walBytes===null?'未知':size(capacity.storage.walBytes)}</p></div>}
      <div className="save-ops-callout"><h3>周期维护</h3>{capacity.maintenance?<><p>{Date.now()-new Date(capacity.maintenance.lastTickAt)>120000?'心跳已过期':({ok:'最近一批完成',idle:'暂无到期分区',busy:'繁忙，等待下轮',error:'需要检查'})[capacity.maintenance.status]} · {capacity.maintenance.code}</p><p>最近心跳：{new Date(capacity.maintenance.lastTickAt).toLocaleString('zh-CN')} · 待排查分区 {capacity.maintenance.errorScopes} 个</p></>:<p>尚无维护心跳。</p>}<p>每 30 秒最多维护一个分区，成功后 6 小时再检查；异常分区保留证据并退避 15 分钟。</p></div>
      <form onSubmit={updateCapacity}><fieldset disabled={disabled}><label>正文总量门限（字节，上限 5 GiB）<input type="number" min={1} max={5368709120} step={1} required value={limit} onChange={e=>setLimit(e.target.value)}/></label><label className="save-ops-checkbox"><input type="checkbox" checked={paused} onChange={e=>setPaused(e.target.checked)}/>暂停所有新云存档写入</label><button className="button button--secondary" disabled={needsReason}>应用容量策略</button></fieldset></form>
      {capacity.telemetryDropped>0&&<p>当前进程有 {capacity.telemetryDropped} 次健康采样未成功保存，统计可能不完整。</p>}
    </section>}
    {!data&&!error&&<p role="status">正在加载…</p>}
    {data&&<><p className="save-ops-note">健康统计覆盖最近 24 个小时桶内通过游戏会话授权的请求，按环境区分；延迟为区间上界，采样可能延迟 30 秒。用量来自计数表，可通过对账核实。</p>{!data.items.length&&<section className="panel save-ops-panel"><h2>暂无存档策略</h2><p>作品完成存档接入审核后，会在这里显示状态。</p></section>}
      {data.items.map(work=><section className="panel save-ops-panel" key={work.workId}><h2>{work.title}</h2>
        {work.usage.map(u=><p key={u.channel}>{channels[u.channel]}环境 · {u.liveSlots} 个当前存档 · 当前正文 {size(u.liveBytes)} · 历史正文 {size(u.historyBytes)} · {u.lastReconciledAt?'最早一次分区对账：'+new Date(u.lastReconciledAt).toLocaleString('zh-CN'):'尚未完成所有分区对账'}</p>)}
        <div className="save-ops-table"><table><caption>命名空间策略</caption><thead><tr><th>命名空间</th><th>策略 / 写入状态</th><th>格式范围</th><th>单份上限</th><th>历史保留</th>{admin&&<th>操作</th>}</tr></thead><tbody>{work.policies.map(p=><tr key={p.id}><td><code>{p.namespace}</code></td><td>{({draft:'草稿',review:'审核中',active:'已启用',retired:'已退役'})[p.status]} / {p.writesPaused?'暂停':p.status==='active'?'允许':'未启用'}</td><td>{p.schemaMin}–{p.schemaMax}</td><td>{size(p.maxDocumentBytes)}</td><td>{p.historyVersions} 份 / {p.historyDays} 天</td>{admin&&<td><button className="button button--ghost" disabled={needsReason} onClick={()=>pausePolicy(p)}>{p.writesPaused?'恢复写入':'暂停写入'}</button></td>}</tr>)}</tbody></table></div>
        {work.traffic.length?<div className="save-ops-table"><table><caption>最近 24 小时同步请求</caption><thead><tr><th>环境 / 请求</th><th>成功 / 总数</th><th>P50</th><th>P95</th><th>P99</th><th>错误</th></tr></thead><tbody>{work.traffic.map(r=><tr key={r.channel+r.operation}><td>{channels[r.channel]} / {operations[r.operation]}</td><td>{r.successes} / {r.requests}</td><td>{ms(r.p50MsUpperBound)}</td><td>{ms(r.p95MsUpperBound)}</td><td>{ms(r.p99MsUpperBound)}</td><td>{r.errors.length?r.errors.map(e=>e.code+' × '+e.count).join('；'):'无'}</td></tr>)}</tbody></table></div>:<p>暂无已汇总的同步请求。</p>}
        {admin&&<div className="save-ops-maintenance"><p>每批最多处理 5 个账号/环境分区，抽检最多 50 份正文摘要。清理遵守现有保留策略；当前正文、版本记录和请求回执会保留。</p><div className="save-ops-actions">{Object.entries(modes).map(([mode,label])=><button key={mode} className="button button--secondary" disabled={needsReason} onClick={()=>maintain(work.workId,mode)}>{label}</button>)}{maintenance[work.workId]?.next&&<button className="button" disabled={needsReason} onClick={()=>maintain(work.workId,maintenance[work.workId].mode,maintenance[work.workId].next)}>继续下一批：{modes[maintenance[work.workId].mode]}</button>}</div></div>}
      </section>)}<div className="save-ops-actions">{cursor&&<button className="button button--secondary" disabled={disabled} onClick={()=>refresh(null)}>返回第一页</button>}{data.nextAfterWorkId&&<button className="button button--secondary" disabled={disabled} onClick={()=>refresh(data.nextAfterWorkId)}>下一页作品</button>}</div></>}
    {admin&&<section className="panel save-ops-panel"><h2>最近 50 次管理操作</h2>{audit.length?<ol className="save-ops-audit">{audit.map(event=><li key={event.id}><strong>{({policy_pause:'命名空间写入控制',capacity:'容量策略',...modes})[event.action]}</strong><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time><p>{event.reason}</p><details><summary>操作人、请求编号与结果</summary><p>操作人：{event.actorUserId}</p><p>请求：{event.requestId}</p><pre>{JSON.stringify({before:event.beforeState,result:event.result},null,2)}</pre></details></li>)}</ol>:<p>暂无管理操作。</p>}</section>}
  </main>;
}
