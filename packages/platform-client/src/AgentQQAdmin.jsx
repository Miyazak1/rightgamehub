import React,{useEffect,useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {buildQQSettings,qqForm,qqAdminErrorLabel} from './qq-admin-settings.mjs';
const numericFields=[['dailyCalls','群每日模型调用',1,200],['userDailyCalls','每人每日模型调用',1,100],['dailyTokens','每日预留 Token',1024,2000000],['userMinuteMessages','每人每分钟消息',1,10],['groupMinuteMessages','群每分钟消息',1,30]];
const phaseLabels={waiting_qrcode:'等待扫码',generating_qrcode:'正在生成二维码',qrcode_scanned:'已扫码，请在手机确认',initializing:'正在登录',ready:'已登录',offline:'未连接',failed:'登录未完成'};
export default function AgentQQAdmin({api,agentId}){
 const [snapshot,setSnapshot]=useState(null),[form,setForm]=useState(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[qr,setQR]=useState(null);
 const alive=useRef(true),loading=useRef(false),dirtyRef=useRef(false),revision=useRef(null),latest=useRef(null),pending=useRef(null),controller=useRef(new AbortController()),epoch=useRef(0);
 const load=async(reset=false)=>{
  if(loading.current)return;loading.current=true;const generation=epoch.current;
  try{const result=(await api.getAdminAgentQQ(agentId,{signal:controller.current.signal})).data;if(!alive.current||generation!==epoch.current)return;latest.current=result;setSnapshot(result);
   if(reset||!dirtyRef.current){setForm(qqForm(result.settings));revision.current=result.revision;dirtyRef.current=false;setDirty(false);}
   if(result.runtime.loggedIn)setQR(null);if(!dirtyRef.current)setError('');
  }catch(e){if(alive.current&&generation===epoch.current&&e.name!=='AbortError'){setError(qqAdminErrorLabel(e));if([401,403,404].includes(e.status)){setQR(null);setSnapshot(null);setForm(null);latest.current=null;}}}finally{if(generation===epoch.current)loading.current=false;}
 };
 useEffect(()=>{alive.current=true;epoch.current++;loading.current=false;controller.current=new AbortController();load();const timer=setInterval(()=>load(),5000);return()=>{alive.current=false;clearInterval(timer);controller.current.abort();};},[agentId,api]);
 useEffect(()=>{if(!qr)return;const timer=setTimeout(()=>setQR(null),Math.max(0,new Date(qr.expiresAt).getTime()-Date.now()));return()=>clearTimeout(timer);},[qr]);
 const change=(key,value)=>{setForm(current=>({...current,[key]:value}));dirtyRef.current=true;setDirty(true);pending.current=null;setNotice('');};
 const operation=async(kind,fn)=>{if(busy)return;setBusy(kind);setError('');setNotice('');try{await fn();}catch(e){if(alive.current)setError(e.code?qqAdminErrorLabel(e):e.message);}finally{if(alive.current)setBusy('');}};
 const save=()=>operation('save',async()=>{
  const settings=buildQQSettings(form),identity=JSON.stringify({expectedRevision:revision.current,settings});
  if(pending.current?.identity!==identity)pending.current={identity,body:{requestId:crypto.randomUUID(),expectedRevision:revision.current,settings}};
  await api.updateAdminAgentQQ(agentId,pending.current.body,{signal:controller.current.signal});if(!alive.current)return;
  pending.current=null;dirtyRef.current=false;setDirty(false);await load(true);setNotice('QQ 设置已保存；历史记录和已用预算继续保留。');
 });
 const showQR=refresh=>operation('qr',async()=>{
  setQR(null);
  if(refresh){await api.refreshAdminAgentQQCode(agentId,{requestId:crypto.randomUUID(),expectedLoginRevision:latest.current.loginRevision},{signal:controller.current.signal});}
  const value=(await api.getAdminAgentQQCode(agentId,{signal:controller.current.signal})).data;
  if(alive.current&&!latest.current?.runtime.loggedIn)setQR(value);
  await load();
 });
 const runtime=snapshot?.runtime,online=runtime?.loggedIn&&runtime?.coreReady&&runtime?.accountMatches&&runtime?.groupReady&&runtime?.connected;
 return <section className="agent-control-card agent-qq-admin" aria-label="QQ 接入管理">
  <header className="agent-control-card__title"><div><span className="kicker">QQ CHANNEL</span><h3>QQ 接入</h3><p>管理专用 QQ 的登录、群内 @文字问答和调用预算。</p></div><span className={online?'agent-state is-ready':'agent-state'}>{online?'已连接':phaseLabels[runtime?.phase]??'读取中…'}</span></header>
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="admin-notice" role="status">{notice}</p>}
  {snapshot&&form?<>
   <div className="qq-admin-status"><span>回复：{snapshot.settings.enabled?'启用':'暂停'}</span><span>今日调用：{snapshot.status.budget.calls}/{snapshot.settings.dailyCalls}</span><span>预留 Token：{snapshot.status.budget.tokens}/{snapshot.settings.dailyTokens}</span><span>待核对发送：{snapshot.status.review.length}</span></div>
   {runtime.loggedIn&&!runtime.accountMatches&&<p role="alert" className="form-error">登录的 QQ 与专用账号不一致，回复已阻止。请联系运营者核对账号。</p>}
   {runtime.accountMatches&&!runtime.groupReady&&<p role="status">请确认专用 QQ 已加入设置的群。</p>}
   <div className="qq-admin-login">
    {!runtime.loggedIn&&<><button type="button" className="button button--secondary" disabled={!!busy||!runtime.available} onClick={()=>showQR(false)}>显示登录二维码</button><button type="button" className="button button--secondary" disabled={!!busy||!runtime.available} onClick={()=>showQR(true)}>刷新二维码</button></>}
    {runtime.loggedIn&&<p>登录状态已保存在服务器，关闭此页面不会退出 QQ。</p>}
    {qr&&<div className="qq-admin-qr"><QRCodeSVG value={qr.qrText} size={200} level="M" marginSize={4}/><p>用专用账号的手机 QQ 扫码，并在手机确认。二维码过期后可刷新。</p><button type="button" onClick={()=>setQR(null)}>隐藏二维码</button></div>}
   </div>
   <fieldset disabled={!!busy} className="qq-admin-fields"><legend>白名单与预算</legend>
    <label className="qq-admin-enabled"><input type="checkbox" checked={form.enabled} onChange={e=>change('enabled',e.target.checked)}/>启用群内 @文字回复</label>
    <label>唯一允许的群号<input inputMode="numeric" value={form.groupId} onChange={e=>change('groupId',e.target.value)}/><small>换群后不混用旧群上下文，也不会重置今日预算。</small></label>
    <label>允许提问的 QQ 号<textarea rows={4} value={form.users} onChange={e=>change('users',e.target.value)}/><small>每行一个，最多 20 个。群主或管理员头衔不会绕过白名单。</small></label>
    {numericFields.map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}
   </fieldset>
   <footer><button type="button" className="button button--primary" disabled={!!busy||!dirty} onClick={save}>{busy==='save'?'正在保存…':'保存 QQ 设置'}</button><button type="button" className="button button--secondary" disabled={!!busy} onClick={()=>{pending.current=null;load(true);}}>{dirty?'放弃修改并重新载入':'刷新状态'}</button></footer>
   <p className="qq-admin-note">暂停会保留登录、历史和排队任务；恢复后重新检查权限与预算。图片、语音和私聊不参与问答。论文保持关闭。</p>
   {snapshot.audit.length>0&&<details><summary>最近管理操作</summary><ul>{snapshot.audit.map((item,index)=><li key={item.requestId+':'+item.type+':'+index}>{new Date(item.at).toLocaleString()} · {item.type==='admin-configured'?'更新 QQ 设置':item.type==='admin-qr-viewed'?'查看登录二维码':item.type==='admin-qr-refreshed'?'已刷新二维码':'请求刷新二维码'} · 操作人 {item.actorId?.slice(0,8)} · 版本 {item.revision??'—'}</li>)}</ul></details>}
  </>:!error&&<p role="status">正在读取 QQ 状态…</p>}
 </section>;
}
