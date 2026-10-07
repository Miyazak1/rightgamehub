import React,{useEffect,useRef,useState} from 'react';
const resource=row=>({namespace:row.namespace,slot:row.slot});
const labels={idle:'尚无进度',cloud:'已同步到云端',local_only:'仅存本机',local_pending:'本机已保存，等待同步',syncing:'正在同步',error_retryable:'本机已保存，联网后重试',conflict:'需要比较冲突',blocked:'同步受阻'};
const reasons={'local-conflict':'另一窗口的进度','cloud-conflict':'云端冲突时保留','before-resolution':'比较前的进度','before-restore':'恢复前的进度'};
const friendly=error=>({SAVE_LOCAL_CONFLICT:'当前进度已变化，请刷新并重新预览恢复。',SAVE_COMPARE_REQUIRED:'请先处理游戏中的云端冲突，或重新预览恢复。',SAVE_RECOVERY_QUOTA_EXCEEDED:'恢复副本空间已满。请先导出并移除不再需要的副本，再恢复。',SAVE_CONTENT_INVALID:'备份内容不完整，或不属于此游戏、存档区域和运行版本。',BRIDGE_CLOSED:'游戏已关闭，请重新进入后管理存档。',AUTH_REQUIRED:'请登录后再导入匿名进度。'}[error.code]??error.message);
export default function SaveManager({controller,onRestored}) {
  const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[anonymous,setAnonymous]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [exported,setExported]=useState(null),[text,setText]=useState(''),[target,setTarget]=useState({namespace:'default',slot:'autosave'}),[plan,setPlan]=useState(null),[confirmed,setConfirmed]=useState(false);
  const dialog=useRef(null),trigger=useRef(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;setOpen(false);setRows([]);setAnonymous(null);setExported(null);setText('');setPlan(null);setMessage('');return()=>{mounted.current=false;};},[controller]);
  useEffect(()=>{if(open)dialog.current?.focus();},[open]);
  if(!controller)return null;
  const run=async action=>{setBusy(true);setMessage('');try{await action();}catch(error){if(mounted.current)setMessage(friendly(error));}finally{if(mounted.current)setBusy(false);}};
  const refresh=async()=>setRows(await controller.list());
  const show=()=>{setOpen(true);run(refresh);};
  const close=()=>{if(busy)return;setOpen(false);trigger.current?.focus();};
  const exportRow=(row,copy)=>run(async()=>{const value=await controller.exportSave(resource(row),copy?.id);setExported({text:value,row:resource(row),copy});setConfirmed(false);});
  const useExport=()=>{setText(exported.text);setTarget({...exported.row,slot:exported.row.slot.startsWith('recovery-anon-')?'autosave':exported.row.slot});setPlan(null);setMessage('请核对目标存档，再预览恢复。');};
  const download=()=>{const url=URL.createObjectURL(new Blob([exported.text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='gamehub-'+exported.row.slot+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setMessage('若此宿主没有弹出下载，请复制下方完整备份文本保存。');};
  const readFile=event=>{const file=event.target.files?.[0];if(!file)return;run(async()=>{if(file.size>1500000)throw new Error('备份文件过大。');setText(await file.text());setPlan(null);});event.target.value='';};
  const trapKeys=event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const nodes=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];const first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};
  return <><button ref={trigger} className="save-manager-trigger" onClick={show}>存档管理</button>{open&&<div className="modal-backdrop save-manager-backdrop"><section ref={dialog} tabIndex={-1} className="save-manager" role="dialog" aria-modal="true" aria-label="本机存档管理" onKeyDown={trapKeys}>
    <header><div><h2>本机存档管理</h2><p>当前游戏 · 当前账号与设备。游戏仍在运行；恢复前会再次检查进度。</p></div><button disabled={busy} onClick={close} aria-label="关闭存档管理">×</button></header>
    <div className="save-manager-actions"><button disabled={busy} onClick={()=>run(refresh)}>刷新存档</button><button disabled={busy} onClick={()=>run(async()=>setAnonymous(await controller.listAnonymous()))}>查看匿名存档</button></div>
    {message&&<p className="save-manager-message" role="status">{message}</p>}
    {!rows.length&&<p>此设备还没有当前账号的存档。进入游戏并保存后，可在这里导出备份。</p>}
    {rows.map(row=><article key={row.namespace+'/'+row.slot}><h3>{row.namespace} / {row.slot}</h3><p>{labels[row.state]??row.state} · {row.bytes} 字节{!controller.localOnly&&row.revision&&' · 云端修订 '+row.revision}</p>
      <div className="save-manager-actions"><button disabled={busy||row.empty} onClick={()=>exportRow(row)}>导出 / 使用此存档</button>{!controller.localOnly&&<button disabled={busy} onClick={()=>run(async()=>{await controller.sync(resource(row));await refresh();})}>重试同步</button>}</div>
      {row.recoveries.map(copy=><div className="save-manager-copy" key={copy.id}><span>{reasons[copy.reason]??'恢复副本'} · {new Date(copy.createdAt).toLocaleString()} · {copy.bytes} 字节</span><button disabled={busy} onClick={()=>exportRow(row,copy)}>导出 / 恢复副本</button></div>)}
    </article>)}
    {anonymous&&<article><h3>本机匿名存档</h3><p>登录后可导入。已有账号进度会保留，另存的匿名恢复槽可通过“导出 / 使用此存档”恢复到目标存档。</p>{!anonymous.length&&<p>没有此游戏的匿名存档。</p>}{anonymous.map(row=><div className="save-manager-copy" key={row.namespace+'/'+row.slot}><span>{row.namespace} / {row.slot} · {row.bytes} 字节</span><button disabled={busy} onClick={()=>run(async()=>{const result=await controller.importAnonymous(resource(row));await refresh();setMessage('已导入到 '+result.slot+'。原匿名存档保留在本机。');})}>确认导入</button></div>)}</article>}
    {exported&&<article><h3>导出备份{exported.copy?' · 恢复副本':''}</h3><p>保存完整文本，或下载 JSON 文件。备份仅包含游戏进度，不包含登录凭据。</p><div className="save-manager-actions"><button onClick={download}>下载备份</button><button disabled={busy} onClick={useExport}>用这份备份恢复</button></div><textarea aria-label="导出的完整备份" readOnly value={exported.text} onFocus={event=>event.target.select()}/>
      {exported.copy&&<><label className="save-manager-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已将完整备份保存到别处，确认移除此本机恢复副本</label><button disabled={busy||!confirmed} onClick={()=>run(async()=>{await controller.removeRecovery(exported.row,exported.copy);setExported(null);setConfirmed(false);await refresh();setMessage('已移除所选恢复副本。');})}>确认移除该副本</button></>}
    </article>}
    <article><h3>从备份恢复</h3><p>恢复会先保留目标的当前进度，然后重新加载游戏。恢复结果保存在此设备，可导出备份。</p><label>选择备份文件<input type="file" accept=".json,application/json" disabled={busy} onChange={readFile}/></label><label>或粘贴完整备份<textarea aria-label="待恢复的备份" value={text} maxLength={1500000} disabled={busy} onChange={event=>{setText(event.target.value);setPlan(null);}}/></label>
      <div className="save-manager-target"><label>存档区域<input value={target.namespace} maxLength={64} disabled={busy} onChange={event=>{setTarget({...target,namespace:event.target.value});setPlan(null);}}/></label><label>目标存档<input value={target.slot} maxLength={64} disabled={busy} onChange={event=>{setTarget({...target,slot:event.target.value});setPlan(null);}}/></label></div>
      <button disabled={busy||!text.trim()} onClick={()=>run(async()=>setPlan(await controller.prepareRestore(text,target)))}>预览恢复</button>
      {plan&&<div className="save-manager-preview"><p>目标：{plan.namespace} / {plan.slot} · 备份 {plan.bytes} 字节。{plan.replacesCurrent?'当前 '+plan.currentBytes+' 字节进度将保留为恢复副本。':'目标当前为空。'}</p><button disabled={busy} onClick={()=>run(async()=>{await controller.restore(plan.token);setOpen(false);onRestored?.();})}>确认恢复并重新加载游戏</button></div>}
    </article></section></div>}</>;
}
