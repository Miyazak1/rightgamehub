import React,{useEffect,useMemo,useRef,useState}from'react';
import{createCapabilityControlPlaneTransport,createCapabilityExecutionHostClient,createCapabilityTaskSurface}from'@gamehub/host-contract';
import{createCapabilityTaskHostProfile}from'./capability-task-panel.mjs';

const stateLabel={
  'awaiting-consent':'等待授权',queued:'等待执行',installing:'正在准备',running:'运行中',
  succeeded:'已完成',failed:'运行失败',cancelled:'已取消',
};
const format=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'—';

export default function CapabilityTaskPanel({api,agentUserId,hostIdentity,hostAdapter}){
  const artifactOpener=hostAdapter?.capabilityArtifacts?.open;
  const profile=useMemo(()=>createCapabilityTaskHostProfile(hostIdentity,{artifactOpener:typeof artifactOpener==='function'}),[hostIdentity?.id,hostIdentity?.version,artifactOpener]);
  const surfaceRef=useRef(null);
  const[state,setState]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');

  useEffect(()=>{
    if(!profile||!agentUserId)return undefined;
    let active=true;
    const transport=createCapabilityControlPlaneTransport({
      apiClient:api,agentUserId,profile,
      openArtifact:directive=>artifactOpener
        ?artifactOpener.call(hostAdapter.capabilityArtifacts,directive)
        :Promise.reject(Object.assign(new Error('当前宿主尚未接入安全产物打开器。'),{code:'CAPABILITY_ARTIFACT_OPENER_UNAVAILABLE'})),
    });
    const client=createCapabilityExecutionHostClient({profile,transport});
    const surface=createCapabilityTaskSurface({client});
    surfaceRef.current=surface;
    const unsubscribe=surface.subscribe(value=>{if(active)setState(value);});
    surface.start().catch(caught=>{if(active)setError(caught.message||'无法读取宿主任务。');});
    return()=>{active=false;unsubscribe();surface.dispose();transport.dispose();if(surfaceRef.current===surface)surfaceRef.current=null;};
  },[api,agentUserId,profile,artifactOpener,hostAdapter]);

  if(!profile)return null;
  const refresh=async()=>{setBusy('refresh');setError('');try{await surfaceRef.current?.refresh();}catch(caught){setError(caught.message||'刷新失败。');}finally{setBusy('');}};
  const cancel=async task=>{if(!globalThis.confirm?.('取消只会停止这次任务，不会删除已经生成的记录。确定继续？'))return;setBusy(task.runId);setError('');try{await surfaceRef.current?.cancel(task.runId);}catch(caught){setError(caught.message||'当前阶段暂时不能安全取消。');}finally{setBusy('');}};
  const openArtifacts=async task=>{setBusy(`artifact-${task.runId}`);setError('');try{const items=await surfaceRef.current?.artifacts(task.runId);if(!items?.length)return;await surfaceRef.current?.openArtifact(items[0].artifactId);}catch(caught){setError(caught.message||'产物暂时无法打开。');}finally{setBusy('');}};
  const tasks=state?.tasks??[];
  return <section className="agent-control-card capability-task-panel"><div className="agent-control-card__title"><div><span className="kicker">HOST TASKS</span><h3>当前宿主任务</h3><p>Codex、Harness、Cursor 与 VS Code 共用同一任务状态；关闭侧栏不会取消后台运行。</p></div><div className="capability-task-panel__summary"><span className={state?.activeCount?'agent-state is-running':'agent-state is-ready'}>{state?.activeCount?`${state.activeCount} 项运行中`:'任务已同步'}</span><small>{hostIdentity.label} · {profile.surface}</small></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="capability-task-panel__toolbar"><span>{state?.status==='loading'?'正在同步…':`最近同步 ${format(state?.updatedAt)}`}</span><button type="button" className="button button--secondary" disabled={busy==='refresh'} onClick={refresh}>{busy==='refresh'?'刷新中…':'刷新'}</button></div>{tasks.length?<ol>{tasks.map(task=><li key={task.runId} className={`is-${task.state}`}><span className="capability-task-panel__dot"/><div><div className="capability-task-panel__name"><strong>{task.capabilityId}</strong><span>{stateLabel[task.state]||task.state}</span></div><p>{task.progress.phase} · {task.progress.completed}/{task.progress.total??'—'} {task.progress.unit}</p><small>运行 {task.runId.slice(0,8)} · 更新于 {format(task.updatedAt)}{task.artifactCount?` · ${task.artifactCount} 个产物`:''}</small>{task.artifactCount>0&&!profile.features.artifacts&&<small>当前宿主尚未接入安全产物打开器，任务记录仍完整保留。</small>}</div><div className="capability-task-panel__actions">{task.actions.canListArtifacts&&<button type="button" className="button button--secondary" disabled={!!busy} onClick={()=>openArtifacts(task)}>打开产物</button>}{task.actions.canCancel&&<button type="button" className="button button--secondary" disabled={!!busy} onClick={()=>cancel(task)}>{busy===task.runId?'取消中…':'取消任务'}</button>}</div></li>)}</ol>:<p className="agent-empty">当前账号还没有从宿主发起的能力任务。</p>}</section>;
}
