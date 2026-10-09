import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const difficulties = new Set(['starter', 'intermediate', 'advanced']);
const creatorActions = new Set(['edit', 'publish', 'close', 'reopen', 'complete', 'request_changes', 'link_issue', 'link_release']);
export class ContributionTaskError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'ContributionTaskError'; this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500; }
}
const fail = (code, status, message) => { throw new ContributionTaskError(code, status, message); };
const publicUrl = value => {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.internal') || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return url.toString();
  } catch { return null; }
};
const githubRepository = value => {
  const normalized = publicUrl(value || ''); if (!normalized) return null;
  const url = new URL(normalized), parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (url.hostname !== 'github.com' || url.search || url.hash || parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const name = parts[1].replace(/\.git$/i, '');
  return name ? { owner: parts[0], name, url: `https://github.com/${parts[0]}/${name}` } : null;
};
const issueUrlMatches = (value, repositoryUrl) => {
  const repository = githubRepository(repositoryUrl), normalized = publicUrl(value || '');
  if (!repository || !normalized) return false;
  const url = new URL(normalized), parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  return url.hostname === 'github.com' && !url.search && !url.hash && parts.length === 4 && parts[0].toLowerCase() === repository.owner.toLowerCase()
    && parts[1].toLowerCase() === repository.name.toLowerCase() && parts[2] === 'issues' && /^[1-9][0-9]*$/.test(parts[3]);
};
const iso = value => value ? new Date(value).toISOString() : null;
const taskView = row => ({
  id: row.id, workId: row.work_id, workTitle: row.work_title, feedbackId: row.feedback_id,
  title: row.title, description: row.description, difficulty: row.difficulty, skills: row.skills ?? [], status: row.status, version: Number(row.version),
  repositoryUrl: row.repository_url, issueUrl: row.issue_url, submissionUrl: row.submission_url, submissionNote: row.submission_note,
  reviewReason: row.review_reason, claimExpiresAt: iso(row.claim_expires_at), workAvailable: available(row),
  resolvedRelease: row.resolved_release_id ? { id: row.resolved_release_id, label: row.release_label, available: row.release_available === true } : null,
  author: { id: row.author_user_id, handle: row.author_handle, displayName: row.author_display_name },
  claimant: row.claimant_user_id ? { id: row.claimant_user_id, handle: row.claimant_handle, displayName: row.claimant_display_name } : null,
  publishedAt: iso(row.published_at), claimedAt: iso(row.claimed_at), submittedAt: iso(row.submitted_at), completedAt: iso(row.completed_at),
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
const taskSelect = `SELECT t.*,w.title AS work_title,w.state AS work_state,w.visibility AS work_visibility,w.repository_url AS current_repository_url,
 a.status AS author_status,a.profile_handle AS author_handle,a.display_name AS author_display_name,
 c.profile_handle AS claimant_handle,c.display_name AS claimant_display_name,r.label AS release_label,
 (r.serving_state='enabled' AND r.validation_state='ready' AND w.state='published' AND w.visibility='public') AS release_available
 FROM contribution_tasks t JOIN works w ON w.id=t.work_id JOIN users a ON a.id=t.author_user_id
 LEFT JOIN users c ON c.id=t.claimant_user_id LEFT JOIN releases r ON r.id=t.resolved_release_id`;
const available = row => row.work_state === 'published' && row.work_visibility === 'public' && row.author_status === 'active';
const requireAvailable = row => { if (!available(row)) fail('WORK_NOT_PUBLIC',409,'作品或作者已停止公开服务，任务暂不能开放或提交。'); };
const publicView = (row, viewerId) => {
  const task = taskView(row), owner = row.author_user_id === viewerId, mine = row.claimant_user_id === viewerId;
  return { ...task, feedbackId: owner ? task.feedbackId : null, claimant: owner || mine || task.status === 'completed' ? task.claimant : null,
    submissionUrl: owner || mine || task.status === 'completed' ? task.submissionUrl : null,
    submissionNote: owner || mine ? task.submissionNote : '', reviewReason: owner || mine ? task.reviewReason : '' };
};
const appendEvent = (client, input, row, action, details = {}) => client.query(
  'SELECT record_contribution_event($1,$2,$3,$4,$5,$6)',
  [input.eventId || crypto.randomUUID(), row.id, input.actor.userId, action, details, [row.author_user_id, row.claimant_user_id]],
);
const readTask = async (client, id) => (await client.query(`${taskSelect} WHERE t.id=$1`, [id])).rows[0];
const lockTask = async (client, id) => {
  // Match work withdrawal's lock order; do not lock t and w in planner-dependent order.
  await client.query('SELECT w.id FROM works w WHERE w.id=(SELECT work_id FROM contribution_tasks WHERE id=$1) FOR UPDATE', [id]);
  const row = (await client.query(`${taskSelect} WHERE t.id=$1 FOR UPDATE OF t`, [id])).rows[0];
  if (!row) fail('CONTRIBUTION_TASK_NOT_FOUND',404,'贡献任务不存在。');
  return row;
};
const checkVersion = (row, expected) => {
  if (expected !== undefined && Number(row.version) !== expected) fail('CONTRIBUTION_TASK_STALE',409,'任务已经变化，请刷新后检查最新内容再操作。');
};
const snapshot = row => ({ submissionUrl: row.submission_url, submissionNote: row.submission_note });
const resetClaim = `claimant_user_id=NULL,claimed_at=NULL,claim_expires_at=NULL,submission_url=NULL,submission_note='',submitted_at=NULL`;

const actorTransaction = (pool,input,operation) => withTransaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['contribution-mutation:'+input.actor.userId]);
  const recent=Number((await client.query("SELECT count(*)::int AS count FROM contribution_task_events WHERE actor_user_id=$1 AND created_at>now()-interval '1 hour' AND COALESCE(details->>'automatic','false')<>'true'",[input.actor.userId])).rows[0].count);
  if(recent>=120)fail('CONTRIBUTION_RATE_LIMIT',429,'任务操作较频繁，请稍后再试。');
  return operation(client);
});
export class PostgresContributionTaskRepository {
  constructor(pool) { this.pool = pool; this.maintenanceAt = 0; }
  async expire(id) {
    return withTransaction(this.pool, async client => {
      const row = await lockTask(client,id);
      if (row.status !== 'claimed' || !row.claim_expires_at || new Date(row.claim_expires_at).getTime() > Date.now()) return;
      await appendEvent(client,{actor:{userId:row.author_user_id}},row,'claim_expired',{...snapshot(row),automatic:true,reason:'领取期限已到，名额已释放；需要时可以重新领取。'});
      await client.query(`UPDATE contribution_tasks SET status=$2,${resetClaim},review_reason='',closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1`,[id,available(row)?'open':'closed']);
    });
  }
  async maintain() {
    if (this.maintenance) return this.maintenance;
    if (Date.now()-this.maintenanceAt < 30000) return;
    this.maintenance = (async () => {
      const rows=(await this.pool.query("SELECT id FROM contribution_tasks WHERE status='claimed' AND claim_expires_at<=now() ORDER BY claim_expires_at,id LIMIT 100")).rows;
      for(const row of rows) await this.expire(row.id);
      this.maintenanceAt=Date.now();
    })();
    try { await this.maintenance; } finally { this.maintenance=null; }
  }
  async createFromFeedback(input) {
    return actorTransaction(this.pool, input, async client => {
      await client.query('SELECT w.id FROM works w WHERE w.id=(SELECT work_id FROM creator_feedback WHERE id=$1) FOR UPDATE',[input.feedbackId]);
      const source=(await client.query(`SELECT f.*,w.owner_user_id,w.repository_url,w.state,w.visibility FROM creator_feedback f JOIN works w ON w.id=f.work_id WHERE f.id=$1 AND w.owner_user_id=$2 FOR UPDATE OF f`,[input.feedbackId,input.actor.userId])).rows[0];
      if(!source) fail('FEEDBACK_NOT_FOUND',404,'反馈不存在，或不属于你的作品。');
      if(!['reviewed','issue_drafted','issue_linked'].includes(source.status)) fail('FEEDBACK_NOT_CONFIRMED',409,'请先将反馈标记为已查看，再创建贡献任务。');
      if(source.state!=='published'||source.visibility!=='public') fail('WORK_NOT_PUBLIC',409,'只有公开发布的作品可以创建贡献任务。');
      try {
        await client.query(`INSERT INTO contribution_tasks(id,work_id,feedback_id,author_user_id,title,description,difficulty,skills,repository_url,issue_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.taskId,source.work_id,input.feedbackId,input.actor.userId,input.title,input.description,input.difficulty,input.skills,source.repository_url,source.issue_url]);
      } catch(error) { if(error.code==='23505') fail('CONTRIBUTION_TASK_EXISTS',409,'这条反馈已有任务，请在共建任务中编辑原草稿。'); throw error; }
      const row=await readTask(client,input.taskId);
      await appendEvent(client,input,row,'draft_created',{feedbackId:input.feedbackId});
      return taskView(row);
    });
  }
  async listForCreator(actor,limit,offset=0) {
    await this.maintain();
    return (await this.pool.query(`${taskSelect} WHERE t.author_user_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`,[actor.userId,limit,offset])).rows.map(taskView);
  }
  async listPublic(status,limit,viewerId=null,offset=0,mine=false) {
    await this.maintain();
    const allowed=status==='all'?(mine?['open','claimed','submitted','completed','closed']:['open','claimed','submitted','completed']):[status];
    const rows=(await this.pool.query(`${taskSelect} WHERE t.status=ANY($1::text[]) AND
      (CASE WHEN $4 THEN EXISTS(SELECT 1 FROM contribution_task_participants p WHERE p.task_id=t.id AND p.user_id=$3)
      ELSE w.state='published' AND w.visibility='public' AND a.status='active' END)
      ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $5`,[allowed,limit,viewerId,mine,offset])).rows;
    return rows.map(row=>publicView(row,viewerId));
  }
  async get(actor,id) {
    await this.expire(id);
    const row=await readTask(this.pool,id), userId=actor?.userId;
    const owner=row.author_user_id===userId, mine=row.claimant_user_id===userId;
    const participated=userId && (await this.pool.query('SELECT 1 FROM contribution_task_participants WHERE task_id=$1 AND user_id=$2',[id,userId])).rowCount>0;
    if(!owner&&!mine&&!participated&&(!available(row)||!['open','claimed','submitted','completed'].includes(row.status))) fail('CONTRIBUTION_TASK_NOT_FOUND',404,'贡献任务不存在或不可访问。');
    const result=publicView(row,userId);
    result.events = userId ? (await this.pool.query(`SELECT e.id,e.action,e.details,e.created_at FROM contribution_task_events e WHERE e.task_id=$1 AND
      ($3 OR e.actor_user_id=$2 OR EXISTS(SELECT 1 FROM contribution_notifications n WHERE n.event_id=e.id AND n.user_id=$2)) ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,[id,userId,owner])).rows.map(e=>({id:e.id,action:e.action,details:e.details,createdAt:iso(e.created_at)})) : [];
    result.releases=owner ? (await this.pool.query(`SELECT r.id,r.label,r.target_key FROM releases r JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key AND t.current_release_id=r.id WHERE r.work_id=$1 AND r.validation_state='ready' AND r.serving_state='enabled' AND t.state='published' ORDER BY r.created_at DESC LIMIT 20`,[row.work_id])).rows.map(r=>({id:r.id,label:r.label,target:r.target_key})) : [];
    return result;
  }
  async creatorAction(input) {
    await this.expire(input.taskId);
    return actorTransaction(this.pool,input,async client=>{
      const row=await lockTask(client,input.taskId);
      if(row.author_user_id!==input.actor.userId) fail('CONTRIBUTION_TASK_NOT_FOUND',404,'贡献任务不存在，或不属于你的作品。');
      checkVersion(row,input.expectedVersion);
      const transitions={edit:['draft','closed'],publish:['draft'],close:['draft','open','claimed','submitted'],reopen:['closed'],complete:['submitted'],request_changes:['submitted'],link_issue:['draft','open','claimed','submitted'],link_release:['completed']};
      if(!transitions[input.action].includes(row.status)) fail('CONTRIBUTION_TASK_STATE_CONFLICT',409,'任务当前状态不允许执行这个操作。');
      if(['publish','reopen','complete','request_changes','link_release'].includes(input.action)) requireAvailable(row);
      if(['publish','reopen'].includes(input.action)&&!githubRepository(row.current_repository_url)) fail('REPOSITORY_REQUIRED',409,'公开任务需要作品关联有效的 GitHub 仓库。');
      if(input.action==='link_issue'&&!issueUrlMatches(input.issueUrl,row.repository_url)) fail('ISSUE_URL_INVALID',400,'Issue 地址必须属于该作品关联的 GitHub 仓库。');
      if(input.releaseId){
        const release=await client.query(`SELECT r.id FROM releases r JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key AND t.current_release_id=r.id WHERE r.id=$1 AND r.work_id=$2 AND r.validation_state='ready' AND r.serving_state='enabled' AND t.state='published'`,[input.releaseId,row.work_id]);
        if(!release.rowCount) fail('RELEASE_INVALID',409,'请选择此作品当前已发布且可用的版本。');
      }
      const updates={
        edit:()=>client.query('UPDATE contribution_tasks SET title=$2,description=$3,difficulty=$4,skills=$5 WHERE id=$1',[row.id,input.title,input.description,input.difficulty,input.skills]),
        publish:()=>client.query("UPDATE contribution_tasks SET status='open',published_at=COALESCE(published_at,now()),repository_url=$2 WHERE id=$1",[row.id,row.current_repository_url]),
        reopen:()=>client.query(`UPDATE contribution_tasks SET status='open',${resetClaim},closed_at=NULL,review_reason='',published_at=COALESCE(published_at,now()),repository_url=$2 WHERE id=$1`,[row.id,row.current_repository_url]),
        close:()=>client.query(`UPDATE contribution_tasks SET status='closed',${resetClaim},closed_at=now(),review_reason=$2 WHERE id=$1`,[row.id,input.reason]),
        request_changes:()=>client.query("UPDATE contribution_tasks SET status='claimed',submitted_at=NULL,claim_expires_at=now()+interval '7 days',review_reason=$2 WHERE id=$1",[row.id,input.reason]),
        complete:()=>client.query("UPDATE contribution_tasks SET status='completed',completed_at=now(),claim_expires_at=NULL,review_reason='',resolved_release_id=$2 WHERE id=$1",[row.id,input.releaseId]),
        link_issue:()=>client.query('UPDATE contribution_tasks SET issue_url=$2 WHERE id=$1',[row.id,input.issueUrl]),
        link_release:()=>client.query('UPDATE contribution_tasks SET resolved_release_id=$2 WHERE id=$1',[row.id,input.releaseId]),
      };
      await updates[input.action]();
      await client.query('UPDATE contribution_tasks SET version=version+1,updated_at=now() WHERE id=$1',[row.id]);
      const actions={edit:'edited',publish:'published',reopen:'reopened',close:'closed',request_changes:'changes_requested',complete:'completed',link_issue:'issue_linked',link_release:'release_linked'};
      await appendEvent(client,input,row,actions[input.action],{...(input.reason?{reason:input.reason}:{}),...(input.issueUrl?{issueUrl:input.issueUrl}:{}),...(input.releaseId?{releaseId:input.releaseId}:{}),...(['close','complete','request_changes'].includes(input.action)?snapshot(row):{})});
      if(input.action==='complete'&&row.feedback_id){
        await client.query("UPDATE creator_feedback SET status='resolved',updated_at=now() WHERE id=$1",[row.feedback_id]);
        await client.query("INSERT INTO creator_feedback_events(id,feedback_id,actor_user_id,action,details) VALUES($1,$2,$3,'resolved',$4)",[crypto.randomUUID(),row.feedback_id,input.actor.userId,{taskId:row.id,releaseId:input.releaseId}]);
      }
      return taskView(await readTask(client,row.id));
    });
  }
  async claim(input) {
    await this.expire(input.taskId);
    return actorTransaction(this.pool,input,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`contribution-claim:${input.actor.userId}`]);
      const row=await lockTask(client,input.taskId); requireAvailable(row);
      if(row.status!=='open') fail('CONTRIBUTION_TASK_UNAVAILABLE',409,'这个任务已经不能认领。');
      if(row.author_user_id===input.actor.userId) fail('OWN_TASK_CLAIM',409,'作者不能认领自己的贡献任务。');
      const active=Number((await client.query("SELECT count(*)::int AS count FROM contribution_tasks WHERE claimant_user_id=$1 AND (status='submitted' OR (status='claimed' AND claim_expires_at>now()))",[input.actor.userId])).rows[0].count);
      if(active>=3) fail('CONTRIBUTION_CLAIM_LIMIT',429,'你最多同时认领 3 个贡献任务。');
      await client.query("UPDATE contribution_tasks SET status='claimed',claimant_user_id=$2,claimed_at=now(),claim_expires_at=now()+interval '7 days',review_reason='',version=version+1,updated_at=now() WHERE id=$1",[row.id,input.actor.userId]);
      await client.query('INSERT INTO contribution_task_participants(task_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.id,input.actor.userId]);
      const next=await readTask(client,row.id); await appendEvent(client,input,next,'claimed'); return taskView(next);
    });
  }
  async contributorAction(input) {
    await this.expire(input.taskId);
    return actorTransaction(this.pool,input,async client=>{
      const row=await lockTask(client,input.taskId);
      if(row.claimant_user_id!==input.actor.userId) fail('CONTRIBUTION_TASK_NOT_CLAIMED',403,'只有当前认领者可以执行这个操作。');
      checkVersion(row,input.expectedVersion);
      const allowed={release:['claimed','submitted'],submit:['claimed'],withdraw:['submitted'],renew:['claimed']};
      if(!allowed[input.action].includes(row.status)) fail('CONTRIBUTION_TASK_STATE_CONFLICT',409,'任务当前状态不允许执行这个操作。');
      if(['submit','renew'].includes(input.action)) { requireAvailable(row); if(row.claim_expires_at && new Date(row.claim_expires_at).getTime()<=Date.now()) fail('CONTRIBUTION_CLAIM_EXPIRED',409,'领取已到期，请刷新后重新领取。'); }
      if(input.action==='release') await client.query(`UPDATE contribution_tasks SET status=$2,${resetClaim},review_reason='',closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END WHERE id=$1`,[row.id,available(row)?'open':'closed']);
      if(input.action==='submit') await client.query("UPDATE contribution_tasks SET status='submitted',submission_url=$2,submission_note=$3,submitted_at=now(),claim_expires_at=NULL,review_reason='' WHERE id=$1",[row.id,input.submissionUrl,input.submissionNote]);
      if(input.action==='withdraw') await client.query("UPDATE contribution_tasks SET status='claimed',submitted_at=NULL,claim_expires_at=now()+interval '7 days' WHERE id=$1",[row.id]);
      if(input.action==='renew') await client.query("UPDATE contribution_tasks SET claim_expires_at=now()+interval '7 days' WHERE id=$1",[row.id]);
      await client.query('UPDATE contribution_tasks SET version=version+1,updated_at=now() WHERE id=$1',[row.id]);
      await appendEvent(client,input,row,{release:'released',submit:'submitted',withdraw:'withdrawn',renew:'renewed'}[input.action],input.action==='submit'?{submissionUrl:input.submissionUrl,submissionNote:input.submissionNote}:snapshot(row));
      return taskView(await readTask(client,row.id));
    });
  }
  async notifications(actor,limit,offset) {
    await this.maintain();
    const rows=(await this.pool.query(`SELECT e.id,e.task_id,t.title,e.action,e.details,n.read_at,n.created_at FROM contribution_notifications n JOIN contribution_task_events e ON e.id=n.event_id JOIN contribution_tasks t ON t.id=e.task_id WHERE n.user_id=$1 AND (e.actor_user_id<>$1 OR e.details->>'automatic'='true') ORDER BY n.created_at DESC,n.event_id DESC LIMIT $2 OFFSET $3`,[actor.userId,limit,offset])).rows;
    const unread=Number((await this.pool.query('SELECT count(*)::int AS count FROM contribution_notifications WHERE user_id=$1 AND read_at IS NULL',[actor.userId])).rows[0].count);
    return {items:rows.map(e=>({id:e.id,taskId:e.task_id,title:e.title,action:e.action,details:e.details,read:!!e.read_at,createdAt:iso(e.created_at)})),unread};
  }
  async readNotification(actor,id) { return {updated:(await this.pool.query('UPDATE contribution_notifications SET read_at=COALESCE(read_at,now()) WHERE event_id=$1 AND user_id=$2',[id,actor.userId])).rowCount}; }
  async recordIssueDraft(input) {
    return actorTransaction(this.pool,input,async client=>{
      const row=await lockTask(client,input.taskId);
      if(row.author_user_id!==input.actor.userId) fail('CONTRIBUTION_TASK_NOT_FOUND',404,'贡献任务不存在，或不属于你的作品。');
      if(['closed','completed'].includes(row.status)) fail('CONTRIBUTION_TASK_STATE_CONFLICT',409,'已结束任务不能生成 Issue 草稿。');
      await appendEvent(client,input,row,'issue_drafted'); return taskView(row);
    });
  }
}

export function createContributionTaskService({repository,ids=()=>crypto.randomUUID()}) {
  const requireUser=actor=>{if(!actor?.userId) fail('UNAUTHORIZED',401,'请先登录。');};
  const requireCreator=actor=>{requireUser(actor);if(!actor.profile?.canPublish||!actor.scopes?.includes('works:read')) fail('CREATOR_REQUIRED',403,'需要创作者权限。');};
  const clean=(value,max)=>String(value??'').trim().slice(0,max+1);
  const taskId=id=>{if(!uuidPattern.test(id)) fail('CONTRIBUTION_TASK_NOT_FOUND',404,'贡献任务不存在。');};
  const page=query=>({limit:Math.min(100,Math.max(1,Math.floor(Number(query.limit)||50))),offset:Math.max(0,Math.floor(Number(query.offset)||0))});
  const fields=body=>{
    const title=clean(body.title,160),description=clean(body.description,4000),skills=Array.isArray(body.skills)?[...new Set(body.skills.map(v=>clean(v,30)).filter(Boolean))]:[];
    if(title.length<5||title.length>160||description.length<20||description.length>4000||!difficulties.has(body.difficulty)||skills.length>8||skills.some(v=>v.length>30)) fail('CONTRIBUTION_TASK_INVALID',400,'请填写有效的任务标题、完成标准、难度和技能标签。');
    return {title,description,skills,difficulty:body.difficulty};
  };
  const contributor=(actor,id,action,extra={})=>{requireUser(actor);taskId(id);return repository.contributorAction({actor,taskId:id,action,...extra,eventId:ids()});};
  return Object.freeze({
    createFromFeedback(actor,id,body={}){requireCreator(actor);taskId(id);return repository.createFromFeedback({actor,feedbackId:id,...fields(body),taskId:ids(),eventId:ids()});},
    listForCreator(actor,query={}){requireCreator(actor);const p=page(query);return repository.listForCreator(actor,p.limit,p.offset);},
    listPublic(actor,query={}){const status=query.status||'all',mine=query.mine===true||query.mine==='true';if(mine)requireUser(actor);if(!['all','open','claimed','submitted','completed',...(mine?['closed']:[])].includes(status))fail('STATUS_INVALID',400,'无效的任务状态。');const p=page(query);return repository.listPublic(status,p.limit,actor?.userId??null,p.offset,mine);},
    get(actor,id){taskId(id);return repository.get(actor,id);},
    creatorAction(actor,id,body={}){
      requireCreator(actor);taskId(id);
      if(!creatorActions.has(body.action))fail('ACTION_INVALID',400,'无效的任务操作。');
      if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)fail('TASK_VERSION_REQUIRED',409,'请刷新页面后检查最新任务再操作。');
      const reason=clean(body.reason,2000),issueUrl=body.action==='link_issue'?clean(body.issueUrl,2048):null;
      if(['request_changes','close'].includes(body.action)&&(reason.length<5||reason.length>2000))fail('REASON_REQUIRED',400,'请填写至少 5 个字的处理原因。');
      if(body.action==='link_issue'&&!issueUrl)fail('ISSUE_URL_REQUIRED',400,'请填写 GitHub Issue 地址。');
      const releaseId=['complete','link_release'].includes(body.action)?body.releaseId||null:null;
      if((releaseId&&!uuidPattern.test(releaseId))||(body.action==='link_release'&&!releaseId))fail('RELEASE_INVALID',400,'请选择已发布版本。');
      return repository.creatorAction({actor,taskId:id,action:body.action,expectedVersion:body.expectedVersion,reason,issueUrl,releaseId,...(body.action==='edit'?fields(body):{}),eventId:ids()});
    },
    claim(actor,id){requireUser(actor);taskId(id);return repository.claim({actor,taskId:id,eventId:ids()});},
    release:(actor,id)=>contributor(actor,id,'release'),
    withdraw:(actor,id)=>contributor(actor,id,'withdraw'),
    renew:(actor,id)=>contributor(actor,id,'renew'),
    submit(actor,id,body={}){requireUser(actor);taskId(id);const submissionUrl=publicUrl(clean(body.url,2048)),submissionNote=clean(body.note,2000);if(!submissionUrl||submissionNote.length<5||submissionNote.length>2000)fail('SUBMISSION_INVALID',400,'请填写公开 HTTPS 成果地址和至少 5 个字的说明。');return contributor(actor,id,'submit',{submissionUrl,submissionNote,expectedVersion:body.expectedVersion});},
    notifications(actor,query={}){requireUser(actor);const p=page(query);return repository.notifications(actor,p.limit,p.offset);},
    readNotification(actor,id){requireUser(actor);taskId(id);return repository.readNotification(actor,id);},
    async issueDraft(actor,id){
      requireCreator(actor);taskId(id);const task=await repository.recordIssueDraft({actor,taskId:id,eventId:ids()}),info=githubRepository(task.repositoryUrl);
      const body=['## 新手贡献任务','',task.description,'',`- 难度：${task.difficulty}`,`- 技能：${task.skills.length?task.skills.join('、'):'不限'}`,`- GameHub 作品：${task.workTitle}`,'','---','由作品作者从 GameHub 贡献任务中确认后生成；请在 GitHub 提交前再次检查内容。'].join('\n'),title=`[Good first issue] ${task.title}`;
      return {taskId:task.id,title,body,repositoryUrl:info?.url??null,createUrl:info?`${info.url}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('good first issue')}`:null};
    },
  });
}
