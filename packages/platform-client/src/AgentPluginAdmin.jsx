import React,{useEffect,useRef,useState} from 'react';

const states={assembled:'已装配',running:'运行中',stopped:'已停止','not-configured':'尚未配置',unavailable:'暂时不可用','upgrade-required':'需要升级状态接口',unknown:'状态未确认'};
const grantLabels={'research.github.read':'读取 GitHub','research.github.discover':'查找项目','provider.text.generate':'模型生成','blog.article.draft':'保存草稿','blog.article.publish':'发布文章'};
const reasonLabels={QQ_ADMIN_NOT_CONFIGURED:'尚未连接 QQ 管理服务',QQ_AGENT_NOT_BOUND:'当前小墨鱼未绑定 QQ 渠道',QQ_CONTROL_UNAVAILABLE:'QQ 管理服务暂时不可用',QQ_PLUGIN_STATUS_UPGRADE_REQUIRED:'当前 worker 未提供插件状态，请随服务升级后查看',AGENT_INTERACTION_PROVIDER_KEY_REQUIRED:'尚未配置模型 Key',AGENT_INTERACTION_PROVIDER_GRANT_REQUIRED:'尚未授予模型调用能力',AGENT_INTERACTION_BOOTSTRAP_REQUIRED:'工作流尚未准备好'};
Object.assign(reasonLabels,{AGENT_INTERACTION_RATE_LIMITED:'请求较多，等待已有任务完成',AGENT_PLUGIN_DISABLED:'插件已停用，任务记录保留',AGENT_PLUGIN_VERSION_UNAVAILABLE:'任务所需插件版本尚未安装',AGENT_TASK_FAILED:'任务未完成，请查看运行记录',QQ_GATEWAY_UNAVAILABLE:'QQ 登录网关暂时不可用',QQ_DATABASE_OR_WORKER_UNAVAILABLE:'QQ 执行器暂时不可用'});
const describe=code=>reasonLabels[code]??`需要核对运行记录（${code}）`;
export default function AgentPluginAdmin({api,agentId}){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),controller=useRef(null),loading=useRef(false);
 async function load(epoch=generation.current){
  if(loading.current)return;loading.current=true;setBusy(true);
  try{const {data}=await api.getAdminAgentPlugins(agentId,{signal:controller.current.signal});if(epoch!==generation.current)return;setSnapshot(data);setError('');}
  catch(e){if(epoch===generation.current&&e.name!=='AbortError'){setSnapshot(null);setError([401,403,404].includes(e.status)?'无权查看此小墨鱼的插件，请确认管理权限。':'插件状态读取失败，请稍后刷新。');}}
  finally{if(epoch===generation.current){loading.current=false;setBusy(false);}}
 }
 useEffect(()=>{const epoch=++generation.current;controller.current=new AbortController();loading.current=false;setSnapshot(null);setError('');load(epoch);const timer=setInterval(()=>load(epoch),15000);return()=>{generation.current++;controller.current.abort();clearInterval(timer);};},[api,agentId]);
 const jump=section=>document.getElementById(`agent-${section}-${agentId}`)?.scrollIntoView({behavior:'smooth',block:'start'});
 return <section className="agent-control-card agent-plugin-admin" aria-label="插件管理">
  <header className="agent-control-card__title"><div><span className="kicker">PLUGINS</span><h3>插件管理</h3><p>统一查看小墨鱼的能力和沟通渠道。</p></div><button type="button" className="button button--secondary" disabled={busy} onClick={()=>load()}>{busy?'读取中…':'刷新插件状态'}</button></header>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!snapshot&&!error&&<p role="status">正在读取插件状态…</p>}
  {snapshot&&<><div className="agent-plugin-grid">{snapshot.plugins.map(plugin=><article className="agent-plugin-card" key={plugin.id} aria-label={plugin.name}>
   <header><h4>{plugin.name}</h4><span className="agent-state">{states[plugin.state]??'状态未确认'}</span></header>
   <p className="agent-plugin-id">{plugin.id} · {plugin.version?`v${plugin.version}`:'版本未确认'}</p>
   <dl><div><dt>插件启用</dt><dd>{plugin.enabled===true?'已启用':plugin.enabled===false?'已停用':'尚未确认'}</dd></div>
    {plugin.kind==='capability'?<><div><dt>交互入口</dt><dd>{plugin.enabled===false?'插件已停用':plugin.admission?.state==='ready'?'配置检查通过':plugin.admission?.state==='blocked'?'配置未就绪':'尚未确认'}</dd></div><div><dt>独立执行器</dt><dd>本页未探测，执行结果见运行记录</dd></div></>:<><div><dt>群内回复</dt><dd>{plugin.responseEnabled===true?'已启用':plugin.responseEnabled===false?'已暂停':'尚未确认'}</dd></div><div><dt>QQ 连接</dt><dd>{!plugin.connection?'尚未确认':plugin.connection.loggedIn&&plugin.connection.connected&&plugin.connection.accountMatches?'已登录并连接':plugin.connection.loggedIn?'已登录，连接待恢复':'需要恢复登录'}</dd></div></>}
   </dl>
   {(plugin.reasonCode||plugin.admission?.reasonCode)&&<p role="status">{describe(plugin.reasonCode??plugin.admission.reasonCode)}</p>}
   {plugin.grants&&<details><summary>已有能力授权</summary><ul>{plugin.grants.map((grant,index)=><li key={`${grant.key}:${grant.version}:${index}`}>{grantLabels[grant.key]??grant.key} · v{grant.version} · {grant.effective?'有效':'未生效'}</li>)}</ul><p>仍受原策略、范围和预算约束；插件启用不会新增授权。</p></details>}
   {(plugin.recentFaults?.length>0||plugin.lastFault)&&<details><summary>最近故障记录</summary><ul>{[...(plugin.recentFaults??[]),...(plugin.lastFault?[plugin.lastFault]:[])].map((fault,index)=><li key={fault.id??index}>{describe(fault.code)} · {new Date(fault.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</li>)}</ul><p>历史故障记录不代表当前仍有故障。</p></details>}
   <button type="button" className="button button--secondary" onClick={()=>jump(plugin.kind==='channel'?'qq':'permissions')}>{plugin.kind==='channel'?'管理 QQ 接入':'管理调用者权限'}</button>
  </article>)}</div><p className="qq-admin-note">全局插件启停由服务配置管理，变更后需重启对应服务。群回复暂停、白名单和调用者权限沿用下方管理入口及原操作记录。论文保持关闭。</p><small>检查时间：{new Date(snapshot.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></>}
 </section>;
}
