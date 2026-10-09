import React, { useEffect, useState } from 'react';

const statusLabels = { draft:'草稿',open:'等待领取',claimed:'进行中',submitted:'等待验收',completed:'已完成',closed:'已关闭' };
const difficultyLabels = { starter:'适合第一次贡献',intermediate:'需要一些经验',advanced:'进阶任务' };
const eventLabels = { draft_created:'创建草稿',edited:'修改草稿',published:'任务已公开',claimed:'任务已领取',released:'领取已释放',submitted:'成果已提交',changes_requested:'需要修改',completed:'贡献已验收',closed:'任务已关闭',reopened:'任务重新开放',issue_drafted:'生成 Issue 草稿',issue_linked:'关联 Issue',renewed:'领取已续期',withdrawn:'提交已撤回',claim_expired:'领取已到期',release_linked:'关联上线版本',work_unavailable:'作品停止公开，任务关闭' };
const pageSize=20;
const demoTasks=[{id:'demo-task',workId:'demo-work',workTitle:'像素迷阵',title:'补充移动端触控提示',description:'为首次在手机打开游戏的玩家补充清晰的触控提示，并确认横竖屏都能正常阅读。',difficulty:'starter',skills:['HTML','CSS'],status:'open',version:1,workAvailable:true,repositoryUrl:'https://github.com/example/pixel-maze',author:{id:'demo-author',handle:'pixel-author',displayName:'像素作者'},claimant:null,events:[],releases:[]}];
function ActionButton({secondary=false,children,...props}) { return <button type={props.onClick?'button':'submit'} className={`button button--${secondary?'secondary':'primary'}`} {...props}><span>{children}</span></button>; }
function ExternalLink({href,children}) { return href?<a href={href} target="_blank" rel="noopener noreferrer">{children} ↗</a>:null; }
const date=value=>value?new Date(value).toLocaleString('zh-CN'):'';
function useRemote(read,deps) {
  const [state,setState]=useState({status:'loading',data:null,deps:[],revision:-1}),[revision,refresh]=useState(0);
  useEffect(()=>{
    let live=true;
    setState({status:'loading',data:null,deps,revision});
    Promise.resolve().then(read).then(data=>{if(live)setState({status:'ready',data,deps,revision});})
      .catch(error=>{if(live)setState({status:'error',data:null,error,deps,revision});});
    return()=>{live=false;};
  },[...deps,revision]);
  // Invalidate synchronously: a route/identity change must not render the previous response shape.
  const current=state.revision===revision&&deps.length===state.deps.length&&deps.every((value,index)=>Object.is(value,state.deps[index]));
  return [current?state:{status:'loading',data:null},()=>refresh(n=>n+1)];
}
function Pages({page,setPage,hasMore,busy=false}) { return <nav className="contribution-pagination" aria-label="任务分页"><ActionButton secondary disabled={!page||busy} onClick={()=>setPage(page-1)}>上一页</ActionButton><span>第 {page+1} 页</span><ActionButton secondary disabled={!hasMore||busy} onClick={()=>setPage(page+1)}>下一页</ActionButton></nav>; }
function TaskFields({item,onSave,onCancel,busy,label='保存修改'}) {
  const [title,setTitle]=useState(item.title||item.summary||''),[description,setDescription]=useState(item.description||`${item.details||''}${item.reproductionSteps?`\n\n复现/验证：\n${item.reproductionSteps}`:''}`),[difficulty,setDifficulty]=useState(item.difficulty||'starter'),[skills,setSkills]=useState((item.skills||[]).join(', '));
  return <form className="contribution-create" onSubmit={event=>{event.preventDefault();onSave({title,description,difficulty,skills:[...new Set(skills.split(/[，,]/).map(s=>s.trim()).filter(Boolean))]});}}><div className="form-grid"><label>任务标题<input required minLength="5" maxLength="160" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>难度<select aria-label="难度" value={difficulty} onChange={e=>setDifficulty(e.target.value)}>{Object.entries(difficultyLabels).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label></div><label>完成标准<textarea aria-label="完成标准" required minLength="20" maxLength="4000" value={description} onChange={e=>setDescription(e.target.value)}/></label><label>技能标签（最多 8 个）<input value={skills} onChange={e=>setSkills(e.target.value)} placeholder="HTML, CSS, JavaScript"/></label><div><ActionButton disabled={busy}>{busy?'保存中…':label}</ActionButton><ActionButton secondary disabled={busy} onClick={onCancel}>取消</ActionButton></div></form>;
}
function Notifications({api,demo,go,refreshToken=0}) {
  const [page,setPage]=useState(0),[error,setError]=useState('');
  const [state,reload]=useRemote(async()=>demo?{items:[],unread:0}:(await api.listContributionNotifications(pageSize+1,page*pageSize)).data,[api,demo,page,refreshToken]);
  const open=async item=>{try{if(!demo)await api.readContributionNotification(item.id);reload();go(`/community/projects/tasks/${item.taskId}`);}catch(e){setError(e.message||'通知暂时无法打开。');}};
  return <details className="contribution-notifications"><summary>任务通知{state.data?.unread?` · ${state.data.unread} 条未读`:''}</summary><button type="button" className="text-button" onClick={reload}>刷新通知</button>{error&&<p role="alert">{error}</p>}{state.status==='error'?<p>通知暂时无法读取，请重试。</p>:state.status==='loading'?<p>正在读取通知…</p>:!state.data.items.length?<p>暂无任务通知。领取、提交、退回和验收的变化会留在这里。</p>:<><ul>{state.data.items.slice(0,pageSize).map(item=><li key={item.id}><button type="button" onClick={()=>open(item)}><strong>{!item.read&&'● '}{eventLabels[item.action]||item.action}</strong> · {item.title}<small>{date(item.createdAt)}{item.details.reason&&` · ${item.details.reason}`}</small></button></li>)}</ul><Pages page={page} setPage={setPage} hasMore={state.data.items.length>pageSize}/></>}</details>;
}
function TaskCard({initial,api,demo,go,accountProfile,creator=false,onChanged=()=>{},detail=false}) {
  const [item,setItem]=useState(initial),[mode,setMode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[reason,setReason]=useState(''),[url,setUrl]=useState(''),[note,setNote]=useState(''),[releaseId,setReleaseId]=useState('');
  useEffect(()=>{setItem(initial);},[initial]);
  const owner=creator||item.author.id===accountProfile?.id,mine=item.claimant?.id===accountProfile?.id;
  const run=async(action,body={})=>{
    setBusy(true);setMessage('');
    try{
      if(demo){setMessage('演示任务不保存修改。');return;}
      if(['edit','publish','reopen','close','request_changes','complete','link_issue','link_release'].includes(action))await api.updateCreatorContributionTask(item.id,{action,expectedVersion:item.version,...body});
      else if(action==='submit')await api.submitContributionTask(item.id,{...body,expectedVersion:item.version});
      else await api[{claim:'claimContributionTask',release:'releaseContributionTask',renew:'renewContributionTask',withdraw:'withdrawContributionTask'}[action]](item.id);
      const next=(await api.getContributionTask(item.id)).data;setItem(next);setMode('');setMessage({claim:'已领取，7 天内提交或续期。',submit:'已提交，等待作者验收。',request_changes:'已退回，修改原因已通知贡献者。',complete:'已验收，原反馈已标记解决。',release:'已释放领取名额。',withdraw:'已撤回提交，可以修改后重提。',renew:'领取期限已延长至 7 天后。'}[action]||'任务已更新。');onChanged();
    }catch(e){if(e.status===401)return go('/account');setMessage(e.message||'任务暂时无法更新。');if(e.status===409){try{setItem((await api.getContributionTask(item.id)).data);}catch{}}}finally{setBusy(false);}
  };
  const prepare=async next=>{setMessage('');setReason('');setUrl(item.submissionUrl||'');setNote(item.submissionNote||'');setReleaseId(item.resolvedRelease?.id||'');
    if(['complete','link_release'].includes(next)&&!demo){setBusy(true);try{setItem((await api.getContributionTask(item.id)).data);}catch(e){setMessage(e.message);return;}finally{setBusy(false);}}
    setMode(next);
  };
  const draftIssue=async()=>{const popup=globalThis.open?.('','_blank');if(popup)popup.opener=null;setBusy(true);try{const draft=demo?{createUrl:`${item.repositoryUrl}/issues/new`}:(await api.createContributionIssueDraft(item.id)).data;if(!draft.createUrl){popup?.close();setMessage('请先给作品关联 GitHub 仓库。');}else{if(popup)popup.location.href=draft.createUrl;else globalThis.open?.(draft.createUrl,'_blank','noopener,noreferrer');setMessage('请在 GitHub 检查并提交，再回来关联 Issue 地址。');}}catch(e){popup?.close();setMessage(e.message);}finally{setBusy(false);}};
  return <article className={`contribution-card is-${item.status}`}><header><div><button type="button" onClick={()=>go(`/u/${item.author.handle}`)}>{item.author.displayName}</button><h2>{item.title}</h2><span>{item.workTitle}</span></div><strong>{statusLabels[item.status]}</strong></header><p>{item.description}</p><div className="contribution-tags"><em>{difficultyLabels[item.difficulty]}</em>{item.skills.map(skill=><span key={skill}>{skill}</span>)}</div><div className="contribution-links"><ExternalLink href={item.repositoryUrl}>查看仓库</ExternalLink><ExternalLink href={item.issueUrl}>查看 Issue</ExternalLink><ExternalLink href={item.submissionUrl}>查看成果</ExternalLink>{!detail&&<button className="text-button" type="button" onClick={()=>go(`/community/projects/tasks/${item.id}`)}>任务详情与记录 →</button>}</div>
    {item.workAvailable===false&&<p className="contribution-notice">作品或作者暂不可公开访问；可以查看自己的记录、撤回提交或释放领取。</p>}
    {item.claimant&&(owner||mine)&&<p>贡献者：{item.claimant.displayName}</p>}
    {item.claimExpiresAt&&(owner||mine)&&<p>领取到期：{date(item.claimExpiresAt)}。到期未提交将释放名额；仍在处理时可续期。</p>}
    {item.submissionNote&&(owner||mine)&&<section className="contribution-note"><strong>提交说明</strong><p>{item.submissionNote}</p></section>}
    {item.reviewReason&&(owner||mine)&&<section className="contribution-note"><strong>{item.status==='closed'?'关闭原因':'修改要求'}</strong><p>{item.reviewReason}</p></section>}
    {item.status==='completed'&&<p>{item.resolvedRelease?`已关联上线版本：${item.resolvedRelease.label}${item.resolvedRelease.available?'':'（当前已不可用）'}`:'贡献已验收，尚未关联上线版本。'}</p>}
    {message&&<p className="contribution-message" role="status">{message}</p>}
    <footer>
      {!owner&&item.status==='open'&&item.workAvailable!==false&&<ActionButton disabled={busy} onClick={()=>run('claim')}>领取任务</ActionButton>}
      {mine&&item.status==='claimed'&&<><ActionButton disabled={busy||item.workAvailable===false} onClick={()=>prepare('submit')}>提交成果</ActionButton><ActionButton secondary disabled={busy||item.workAvailable===false} onClick={()=>run('renew')}>续期 7 天</ActionButton></>}
      {mine&&item.status==='submitted'&&<><small>等待作者验收</small><ActionButton secondary disabled={busy} onClick={()=>run('withdraw')}>撤回并修改</ActionButton></>}
      {mine&&['claimed','submitted'].includes(item.status)&&<ActionButton secondary disabled={busy} onClick={()=>prepare('release')}>释放任务</ActionButton>}
      {owner&&['draft','closed'].includes(item.status)&&<ActionButton secondary disabled={busy} onClick={()=>prepare('edit')}>编辑任务</ActionButton>}
      {owner&&item.status==='draft'&&<ActionButton disabled={busy||item.workAvailable===false} onClick={()=>run('publish')}>公开任务</ActionButton>}
      {owner&&item.status==='closed'&&<ActionButton disabled={busy||item.workAvailable===false} onClick={()=>run('reopen')}>重新开放</ActionButton>}
      {owner&&['draft','open','claimed','submitted'].includes(item.status)&&<><ActionButton secondary disabled={busy} onClick={draftIssue}>生成 Issue 草稿</ActionButton><ActionButton secondary disabled={busy} onClick={()=>{setUrl(item.issueUrl||'');setMode('link_issue');}}>关联 Issue</ActionButton><ActionButton secondary disabled={busy} onClick={()=>prepare('close')}>关闭任务</ActionButton></>}
      {owner&&item.status==='submitted'&&<><ActionButton disabled={busy||item.workAvailable===false} onClick={()=>prepare('complete')}>验收成果</ActionButton><ActionButton secondary disabled={busy||item.workAvailable===false} onClick={()=>prepare('request_changes')}>退回修改</ActionButton></>}
      {owner&&item.status==='completed'&&<ActionButton secondary disabled={busy||item.workAvailable===false} onClick={()=>prepare('link_release')}>关联上线版本</ActionButton>}
    </footer>
    {mode==='edit'&&<TaskFields key={item.id} item={item} busy={busy} onCancel={()=>setMode('')} onSave={body=>run('edit',body)}/>}
    {['close','request_changes'].includes(mode)&&<form className="contribution-submit" onSubmit={e=>{e.preventDefault();run(mode,{reason});}}><label>{mode==='close'?'关闭原因':'修改要求'}<textarea aria-label={mode==='close'?'关闭原因':'修改要求'} required minLength="5" maxLength="2000" value={reason} onChange={e=>setReason(e.target.value)}/></label><div><ActionButton disabled={busy}>{mode==='close'?'确认关闭':'确认退回'}</ActionButton><ActionButton secondary disabled={busy} onClick={()=>setMode('')}>取消</ActionButton></div></form>}
    {mode==='submit'&&<form className="contribution-submit" onSubmit={e=>{e.preventDefault();run('submit',{url,note});}}><label>公开成果地址<input required type="url" maxLength="2048" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://github.com/owner/repo/pull/123"/></label><label>给作者的说明<textarea aria-label="给作者的说明" required minLength="5" maxLength="2000" value={note} onChange={e=>setNote(e.target.value)}/></label><div><ActionButton disabled={busy}>提交验收</ActionButton><ActionButton secondary disabled={busy} onClick={()=>setMode('')}>取消</ActionButton></div></form>}
    {mode==='release'&&<div className="contribution-submit"><p>释放后其他人可以领取，已提交的成果和说明仍保存在你的任务记录中。</p><ActionButton disabled={busy} onClick={()=>run('release')}>确认释放</ActionButton><ActionButton secondary onClick={()=>setMode('')}>取消</ActionButton></div>}
    {mode==='link_issue'&&<form className="contribution-submit" onSubmit={e=>{e.preventDefault();run('link_issue',{issueUrl:url});}}><label>GitHub Issue 地址<input required type="url" maxLength="2048" value={url} onChange={e=>setUrl(e.target.value)}/></label><div><ActionButton disabled={busy}>保存关联</ActionButton><ActionButton secondary onClick={()=>setMode('')}>取消</ActionButton></div></form>}
    {['complete','link_release'].includes(mode)&&<form className="contribution-submit" onSubmit={e=>{e.preventDefault();run(mode,{releaseId:releaseId||null});}}><label>已发布版本<select aria-label="已发布版本" required={mode==='link_release'} value={releaseId} onChange={e=>setReleaseId(e.target.value)}><option value="">{mode==='complete'?'已验收，稍后发布或关联版本':'请选择当前已发布版本'}</option>{(item.releases||[]).map(r=><option value={r.id} key={r.id}>{r.label} · {r.target}</option>)}</select></label><p>请确认该版本已包含此项修改。验收会记入贡献履历，并将原反馈标记为已解决。</p><div><ActionButton disabled={busy}>{mode==='complete'?'确认验收':'保存上线版本'}</ActionButton><ActionButton secondary onClick={()=>setMode('')}>取消</ActionButton></div></form>}
    {detail&&!!item.events?.length&&<details className="contribution-history" open><summary>处理记录（最近 100 条，仅向相关账号展示）</summary><ol>{item.events.map(event=><li key={event.id}><strong>{eventLabels[event.action]||event.action}</strong><time>{date(event.createdAt)}</time>{event.details.reason&&<p>{event.details.reason}</p>}{event.details.submissionNote&&<p>{event.details.submissionNote}</p>}<ExternalLink href={event.details.submissionUrl}>当次提交</ExternalLink></li>)}</ol></details>}
  </article>;
}
export function ContributionCenterPage({api,demo,go,accountProfile,taskId,embedded=false}) {
  const [filter,setFilter]=useState('all'),[mine,setMine]=useState(false),[page,setPage]=useState(0),[notificationRefresh,setNotificationRefresh]=useState(0);
  const [state,reload]=useRemote(async()=>demo?(taskId?demoTasks[0]:demoTasks.filter(t=>filter==='all'||t.status===filter)):taskId?(await api.getContributionTask(taskId)).data:(await api.listContributionTasks(filter,pageSize+1,{offset:page*pageSize,mine})).data,[api,demo,taskId,filter,mine,page,accountProfile?.id]);
  const change=()=>setNotificationRefresh(n=>n+1);
  const body=<><section className={`contribution-hero${embedded?' is-community':''}`}><div><span className="kicker">BUILD TOGETHER</span><h1>一起做，从一个小任务开始</h1><p>找到值得参与的作品，领取作者公开的任务，提交成果并留下可信贡献履历。</p></div><aside><strong>领取与协作</strong><p>最多同时领取 3 项任务。领取后 7 天内提交，或在到期前续期；提交验收期间不计领取期限。GitHub 修改和发布仍由你与作者完成。</p></aside></section>
    {accountProfile&&<Notifications api={api} demo={demo} go={go} refreshToken={notificationRefresh}/>}
    {taskId?<button className="back-link" onClick={()=>go(embedded?'/community/projects':'/contribute')}>← 返回一起做</button>:<><nav className="contribution-filters" aria-label="任务范围">{[[false,'开放任务'],[true,'我的任务']].map(([value,label])=><button key={label} type="button" className={mine===value?'is-active':''} onClick={()=>{if(value&&!accountProfile&&!demo)return go('/account');setMine(value);setFilter('all');setPage(0);}}>{label}</button>)}</nav><nav className="contribution-filters" aria-label="贡献任务筛选">{[['all','全部'],['open','可领取'],['claimed','进行中'],['submitted','待验收'],['completed','已完成'],...(mine?[['closed','已关闭']]:[])].map(([value,label])=><button key={value} type="button" className={filter===value?'is-active':''} onClick={()=>{setFilter(value);setPage(0);}}>{label}</button>)}<button type="button" onClick={()=>{reload();change();}}>刷新任务</button></nav>{mine&&<p className="contribution-scope-note">这里保留你领取过的任务，包括已释放、到期和关闭的记录。</p>}</>}
    {state.status==='loading'?<p className="contribution-state">正在读取任务…</p>:state.status==='error'?<div className="contribution-state is-error"><p>{state.error?.message||'任务暂时无法读取。'}</p><button onClick={reload}>重试</button></div>:taskId?<TaskCard key={`${taskId}:${accountProfile?.id}`} initial={state.data} api={api} demo={demo} go={go} accountProfile={accountProfile} detail onChanged={change}/>:<><section className="contribution-grid">{state.data.slice(0,pageSize).map(item=><TaskCard key={item.id} initial={item} api={api} demo={demo} go={go} accountProfile={accountProfile} onChanged={change}/>)}</section>{!state.data.length&&<p className="contribution-state">这个筛选下还没有任务。</p>}<Pages page={page} setPage={setPage} hasMore={state.data.length>pageSize}/></>}
  </>;
  return embedded?<section className="contribution-page community-projects-page">{body}</section>:<main className="page contribution-page">{body}</main>;
}
export function CreatorContributionTasks({api,demo,refreshToken=0,go=path=>{globalThis.location.hash=path;},onChanged}) {
  const [notificationRefresh,setNotificationRefresh]=useState(0);
  const [page,setPage]=useState(0),[state,reload]=useRemote(async()=>demo?[{...demoTasks[0],status:'draft'}]:(await api.listCreatorContributionTasks(pageSize+1,{offset:page*pageSize})).data,[api,demo,page,refreshToken]);
  return <section className="creator-contributions"><div className="creator-contributions__head"><div><span className="kicker">CONTRIBUTION TASKS</span><h2>共建任务</h2><p>先编辑私有草稿，再公开招募。验收时核对成果与提交说明。</p></div><button className="text-button" type="button" onClick={()=>{reload();setNotificationRefresh(n=>n+1);}}>刷新</button></div><Notifications api={api} demo={demo} go={go} refreshToken={notificationRefresh}/>{state.status==='loading'?<p className="creator-contributions__state">正在读取任务…</p>:state.status==='error'?<p className="creator-contributions__state is-error" role="alert">共建任务暂时无法读取。</p>:<><div className={`creator-contributions__list${state.data.length?'':' is-empty'}`}>{state.data.slice(0,pageSize).map(item=><TaskCard key={item.id} initial={item} api={api} demo={demo} go={go} creator onChanged={()=>{setNotificationRefresh(n=>n+1);onChanged?.();}}/>)}{!state.data.length&&<p className="creator-contributions__empty">还没有任务，可从已查看的玩家反馈创建。</p>}</div>{(page>0||state.data.length>pageSize)&&<Pages page={page} setPage={setPage} hasMore={state.data.length>pageSize}/>}</>}</section>;
}
export function CreateContributionTaskForm({item,api,demo,onCreated,onCancel}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async body=>{setBusy(true);setError('');try{if(!demo)await api.createContributionTaskFromFeedback(item.id,body);await onCreated();}catch(e){setError(e.message||'草稿暂时无法创建。');}finally{setBusy(false);}};
  return <><p>此操作只创建私有草稿；保存后可以继续编辑或关闭。</p>{error&&<p className="form-error" role="alert">{error}</p>}<TaskFields item={item} onSave={save} onCancel={onCancel} busy={busy} label="创建私有任务草稿"/></>;
}
