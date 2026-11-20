import {randomUUID} from 'node:crypto';
import {withTransaction} from './database.mjs';
import {interactionFail,interactionHash,interactionId} from './agent-interaction-contracts.mjs';

export class PostgresAgentInteractionRepository{
 constructor(pool){this.pool=pool;}
 async readiness(agentId){
  const row=(await this.pool.query(`SELECT
   (SELECT count(*)::int FROM agent_workflow_definitions WHERE status='active' AND (workflow_key,workflow_version) IN (('agent.conversation.turn',1),('agent.github.inspect',1),('blog.project.single.draft-shadow',3))) AS workflows,
   EXISTS(SELECT 1 FROM agent_provider_secrets WHERE agent_user_id=$1 AND provider='deepseek') AS secret,
   EXISTS(SELECT 1 FROM agent_capability_grants WHERE agent_user_id=$1 AND capability_key='provider.text.generate' AND status='active' AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now())) AS provider_grant`,[agentId])).rows[0];
  return {ready:row.workflows===3&&row.secret&&row.provider_grant,code:row.workflows!==3?'AGENT_INTERACTION_BOOTSTRAP_REQUIRED':!row.secret?'AGENT_INTERACTION_PROVIDER_KEY_REQUIRED':!row.provider_grant?'AGENT_INTERACTION_PROVIDER_GRANT_REQUIRED':null};
 }
 async agent(agentId){
  const row=(await this.pool.query(`SELECT a.user_id AS id,a.operator_user_id,u.display_name,u.profile_handle,
    b.active_profile_id AS behavior_profile_id,p.version AS behavior_profile_version,p.profile,
    assignment.active_policy_profile_id AS policy_profile_id,policy.policy_json,settings.model
    FROM agent_accounts a JOIN users u ON u.id=a.user_id
    JOIN agent_behavior_profile_assignments b ON b.agent_user_id=a.user_id
    JOIN agent_behavior_profiles p ON p.id=b.active_profile_id AND p.agent_user_id=a.user_id
    JOIN agent_policy_profile_assignments assignment ON assignment.agent_user_id=a.user_id
    JOIN agent_policy_profiles policy ON policy.id=assignment.active_policy_profile_id AND policy.agent_user_id=a.user_id
    LEFT JOIN agent_blog_automation_settings settings ON settings.agent_user_id=a.user_id
    WHERE a.user_id=$1 AND a.status='active' AND u.status='active'`,[agentId])).rows[0];
  if(!row)interactionFail('AGENT_INTERACTION_AGENT_UNAVAILABLE',503);return row;
 }
 async principal(agent,origin){
  let owner=false;
  if(origin.channel==='web'){
   const user=(await this.pool.query("SELECT id,role FROM users WHERE id=$1 AND status='active' AND account_type='human'",[origin.platformUserId])).rows[0];
   if(!user)interactionFail('AGENT_INTERACTION_REQUESTER_DENIED',403);
   owner=user.id===agent.operator_user_id&&user.role==='admin';
  }
  const row=(await this.pool.query(`SELECT can_invoke,status FROM agent_channel_participants
    WHERE agent_user_id=$1 AND channel=$2 AND actor_ref=$3`,[agent.id,origin.channel,origin.actorRef])).rows[0];
  return {owner,canInvoke:owner||(row?.status==='active'&&row.can_invoke===true),actor:origin.channel==='web'?{userId:origin.platformUserId,profile:{role:owner?'admin':'user'}}:{userId:'qq:'+origin.actorRef,profile:{role:'external'}}};
 }
 async operator(actor,agentId){
  const row=(await this.pool.query(`SELECT a.user_id FROM agent_accounts a JOIN users u ON u.id=a.operator_user_id
    WHERE a.user_id=$1 AND a.operator_user_id=$2 AND a.status='active' AND u.status='active' AND u.role='admin' AND u.account_type='human'`,[agentId,actor?.userId])).rows[0];
  if(actor?.profile?.role!=='admin'||!row)interactionFail('AGENT_INTERACTION_OPERATOR_REQUIRED',403);
 }
 async participants(actor,agentId){await this.operator(actor,agentId);return (await this.pool.query(`SELECT channel,actor_ref,can_invoke,status,revision FROM agent_channel_participants WHERE agent_user_id=$1 ORDER BY channel,actor_ref`,[agentId])).rows;}
 async configureParticipant(actor,agentId,{channel,actorRef,canInvoke,expectedRevision}){
  await this.operator(actor,agentId);
  return withTransaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[agentId+':participant:'+channel+':'+actorRef]);
   const prior=(await c.query('SELECT revision FROM agent_channel_participants WHERE agent_user_id=$1 AND channel=$2 AND actor_ref=$3 FOR UPDATE',[agentId,channel,actorRef])).rows[0];
   if((prior?.revision??0)!==expectedRevision)interactionFail('AGENT_INTERACTION_SETTINGS_CONFLICT',409);
   return (await c.query(`INSERT INTO agent_channel_participants(agent_user_id,channel,actor_ref,can_invoke,updated_by_user_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(agent_user_id,channel,actor_ref) DO UPDATE SET
    can_invoke=EXCLUDED.can_invoke,status='active',revision=agent_channel_participants.revision+1,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
    RETURNING channel,actor_ref,can_invoke,status,revision`,[agentId,channel,actorRef,canInvoke,actor.userId])).rows[0];
  });
 }
 async accept({agentId,origin,input,kind='message',parentId=null}){
  const identity=[agentId,origin.channel,origin.actorRef,origin.conversationRef,origin.eventRef,kind],id=interactionId(identity),hash=interactionHash(input);
  return withTransaction(this.pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['agent-interaction:'+id]);
   const prior=(await c.query('SELECT * FROM agent_interactions WHERE id=$1',[id])).rows[0];
   if(prior){if(prior.input_sha256!==hash||prior.parent_id!==parentId)interactionFail('AGENT_INTERACTION_REQUEST_CONFLICT',409);return prior;}
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['agent-interaction-admission:'+agentId+':'+origin.channel+':'+origin.actorRef]);
   const limits=(await c.query(`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 minute')::int AS recent,
    count(*) FILTER(WHERE state IN ('queued','running','waiting'))::int AS pending
    FROM agent_interactions WHERE agent_user_id=$1 AND channel=$2 AND actor_ref=$3 AND kind=$4`,[agentId,origin.channel,origin.actorRef,kind])).rows[0];
   if(limits.recent>=10||limits.pending>=10)interactionFail('AGENT_INTERACTION_RATE_LIMITED',429);
   const row=(await c.query(`INSERT INTO agent_interactions(id,agent_user_id,parent_id,kind,channel,actor_ref,conversation_ref,event_ref,origin_json,input_json,input_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[id,agentId,parentId,kind,origin.channel,origin.actorRef,origin.conversationRef,origin.eventRef,JSON.stringify(origin),JSON.stringify(input),hash])).rows[0];
   await c.query("INSERT INTO agent_interaction_events(interaction_id,event_type) VALUES($1,'accepted')",[id]);return row;
  });
 }
 async get(id){return (await this.pool.query('SELECT * FROM agent_interactions WHERE id=$1',[id])).rows[0]??null;}
 async history(row){
  const rows=(await this.pool.query(`SELECT message.id,message.input_json,message.result_json,task.id AS task_id,task.result_json AS task_result FROM agent_interactions message
   LEFT JOIN LATERAL(SELECT id,result_json FROM agent_interactions child WHERE child.parent_id=message.id AND child.state='completed' ORDER BY child.created_at LIMIT 1) task ON true
   WHERE message.agent_user_id=$1 AND message.channel=$2 AND message.actor_ref=$3 AND message.conversation_ref=$4 AND message.kind='message' AND message.state='completed' AND message.created_at<$5
   ORDER BY message.created_at DESC,message.id DESC LIMIT 4`,[row.agent_user_id,row.channel,row.actor_ref,row.conversation_ref,row.created_at])).rows.reverse();
  return rows.flatMap(item=>[{role:'user',content:item.input_json.message},{role:'assistant',content:item.result_json.reply,requestId:item.id},...(item.task_result?[{role:'assistant',content:item.task_result.reply,requestId:item.task_id}]:[])]);
 }
 async claim(agentId,kind){return withTransaction(this.pool,async c=>{
  const kinds=kind==='message'?['message']:['github-search','github-article'];
  const row=(await c.query(`SELECT * FROM agent_interactions WHERE agent_user_id=$1 AND kind=ANY($2::text[])
   AND ((state IN ('queued','waiting') AND next_attempt_at<=now()) OR (state='running' AND lease_until<=now()))
   ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[agentId,kinds])).rows[0];if(!row)return null;
  const token=randomUUID();return (await c.query(`UPDATE agent_interactions SET state='running',lease_token=$2,
   lease_until=now()+interval '180 seconds',attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *`,[row.id,token])).rows[0];
 });}
 async heartbeat(row){const result=await this.pool.query(`UPDATE agent_interactions SET lease_until=now()+interval '180 seconds',updated_at=now() WHERE id=$1 AND state='running' AND lease_token=$2`,[row.id,row.lease_token]);if(result.rowCount!==1)interactionFail('AGENT_INTERACTION_LEASE_LOST',409);}
 async setRun(row,runId){const result=await this.pool.query(`UPDATE agent_interactions SET run_id=$3,updated_at=now() WHERE id=$1 AND state='running' AND lease_token=$2`,[row.id,row.lease_token,runId]);if(result.rowCount!==1)interactionFail('AGENT_INTERACTION_LEASE_LOST',409);}
 async checkpoint(row,result){
  if(Buffer.byteLength(JSON.stringify(result))>120000)interactionFail('AGENT_INTERACTION_RESULT_TOO_LARGE',422);
  const changed=await this.pool.query(`UPDATE agent_interactions SET checkpoint_json=$3,updated_at=now() WHERE id=$1 AND state='running' AND lease_token=$2 AND checkpoint_json IS NULL`,[row.id,row.lease_token,JSON.stringify(result)]);
  if(changed.rowCount!==1){const current=await this.get(row.id);if(current?.state!=='running'||current.lease_token!==row.lease_token||interactionHash(current.checkpoint_json)!==interactionHash(result))interactionFail('AGENT_INTERACTION_CHECKPOINT_CONFLICT',409);}
 }
 async settle(row,{result=null,errorCode=null,retry=false,needsReview=false,delaySeconds=30}){
  const code=/^[A-Z0-9_]{1,120}$/u.test(errorCode??'')?errorCode:null;
  const changed=await this.pool.query(`UPDATE agent_interactions SET state=$3,result_json=$4,error_code=$5,
   lease_token=NULL,lease_until=NULL,next_attempt_at=now()+($6*interval '1 second'),updated_at=now()
   WHERE id=$1 AND state='running' AND lease_token=$2`,[row.id,row.lease_token,result?'completed':needsReview?'needs-review':retry?'waiting':'failed',result?JSON.stringify(result):null,code,delaySeconds]);
  if(changed.rowCount!==1)interactionFail('AGENT_INTERACTION_LEASE_LOST',409);
  await this.pool.query('INSERT INTO agent_interaction_events(interaction_id,event_type,details) VALUES($1,$2,$3)',[row.id,result?'completed':retry?'deferred':'failed',JSON.stringify({code})]);
 }
 async attachTask(row,task){return this.accept({agentId:row.agent_user_id,origin:row.origin_json,input:task,kind:task.kind,parentId:row.id});}
 async ownTasks(row){return (await this.pool.query(`SELECT id,kind,state,error_code,created_at FROM agent_interactions WHERE agent_user_id=$1 AND channel=$2 AND actor_ref=$3 AND conversation_ref=$4 AND kind<>'message' ORDER BY created_at DESC LIMIT 10`,[row.agent_user_id,row.channel,row.actor_ref,row.conversation_ref])).rows;}
 async publicArticles(agentId){return (await this.pool.query(`SELECT article.id,article.slug,revision.title,revision.summary FROM blog_articles article
  JOIN blog_article_revisions revision ON revision.id=article.published_revision_id WHERE article.author_user_id=$1 AND article.publication_state='published' ORDER BY article.last_published_at DESC LIMIT 10`,[agentId])).rows;}
 async articleResult(agentId,articleId){return (await this.pool.query(`SELECT article.id,article.slug,article.publication_state,revision.title FROM blog_articles article
  JOIN blog_article_revisions revision ON revision.id=coalesce(article.published_revision_id,article.working_revision_id)
  WHERE article.id=$1 AND article.author_user_id=$2`,[articleId,agentId])).rows[0]??null;}
 async progress(row){if(!row.run_id)return null;const stages=(await this.pool.query('SELECT stage_key,status FROM agent_run_stages WHERE run_id=$1 ORDER BY ordinal',[row.run_id])).rows;return {completed:stages.filter(s=>['succeeded','skipped'].includes(s.status)).length,total:stages.length,phase:stages.find(s=>!['succeeded','skipped'].includes(s.status))?.stage_key??row.state};}
 async children(id){return (await this.pool.query('SELECT * FROM agent_interactions WHERE parent_id=$1 ORDER BY created_at,id',[id])).rows;}
}
