import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const failure=code=>Object.assign(new Error(code),{code,retryable:true});

// Read immutable receipts before taking a new snapshot or applying admission to
// a replay. An existing committed request does not consume a second daily slot.
export class PostgresAgentBlogPublicRequestRepository {
  constructor(pool) { this.pool = pool; }

  async checkpoint(agentUserId, requestId) {
    return (await this.pool.query('SELECT * FROM agent_blog_public_requests WHERE agent_user_id=$1 AND request_id=$2',
      [agentUserId,requestId])).rows[0]??null;
  }
  async completeInteractionReceipt(agentUserId,requestId,result){
    await this.requireInteractionReceipt(agentUserId,requestId,result);
    const changed=await this.pool.query(`UPDATE agent_blog_public_requests SET status='completed',result_json=$3,
      lease_token=NULL,lease_until=NULL,error_code=NULL,safe_for_next=true,updated_at=now()
      WHERE agent_user_id=$1 AND request_id=$2 AND snapshot_json->>'executionSource'='agent-interaction-v1'
        AND (status='waiting' OR (status='running' AND lease_until<=now()))`,[agentUserId,requestId,JSON.stringify(result)]);
    return changed.rowCount===1;
  }
  async requireInteractionReceipt(agentUserId,requestId,result){
    const id=result.runId??result.discoveryRunId;
    const proof=(await this.pool.query(`SELECT run.id FROM agent_runs run JOIN agent_blog_public_requests request
      ON request.agent_user_id=run.agent_user_id AND request.request_id=$2
      WHERE run.agent_user_id=$1 AND run.id=$3 AND run.status='succeeded'
       AND request.snapshot_json->>'executionSource'='agent-interaction-v1'
       AND ((run.idempotency_key=$4 AND run.workflow_key IN ('blog.project.discovery-shadow','agent.github.inspect')
          AND run.output_type IN ('blog.candidate-set','blog.discovery-skipped','agent.github.repository'))
        OR (run.idempotency_key=$5 AND run.workflow_key IN ('blog.project.single','blog.project.single.draft-shadow')
          AND run.output_type IN ('blog.article','blog.private-draft','blog.publication-skipped')))
       AND ($6::uuid IS NULL OR run.output_id=$6::uuid)`,[agentUserId,requestId,id,`public-runtime:${requestId}:discovery`,`public-runtime:${requestId}:article`,result.articleId??null])).rows[0];
    if(!proof)throw failure('AGENT_PUBLIC_REQUEST_RECEIPT_REQUIRED');
  }
  async deferInteraction(agentUserId,requestId,{errorCode,needsReview=false}){
    await this.pool.query(`UPDATE agent_blog_public_requests SET status=$3,error_code=$4,safe_for_next=$5,
      next_attempt_at=now()+interval '60 seconds',updated_at=now()
      WHERE agent_user_id=$1 AND request_id=$2 AND status='waiting' AND snapshot_json->>'executionSource'='agent-interaction-v1'`,[agentUserId,requestId,needsReview?'needs-review':'waiting',errorCode,needsReview]);
  }
  async settleInteraction(agentUserId,requestId,token,{result,...options}){
    if(!result)return this.settle(agentUserId,requestId,token,options);
    await this.requireInteractionReceipt(agentUserId,requestId,result);
    const changed=await this.pool.query(`UPDATE agent_blog_public_requests SET status='completed',result_json=$4,
      lease_token=NULL,lease_until=NULL,error_code=NULL,safe_for_next=true,updated_at=now()
      WHERE agent_user_id=$1 AND request_id=$2 AND lease_token=$3 AND status='running'
       AND snapshot_json->>'executionSource'='agent-interaction-v1'`,[agentUserId,requestId,token,JSON.stringify(result)]);
    if(changed.rowCount!==1){
      const saved=await this.checkpoint(agentUserId,requestId);
      if(saved?.status!=='completed')throw failure('AGENT_PUBLIC_REQUEST_LEASE_LOST');
    }
    await this.event(agentUserId,requestId,'completed');
  }

  async reconcileCompleted(agentUserId,requestId,result) {
    if(!await this.findCompleted({agentUserId,requestId}))throw failure('AGENT_PUBLIC_REQUEST_RECEIPT_REQUIRED');
    const inserted=await this.pool.query(`INSERT INTO agent_blog_public_requests(agent_user_id,request_id,
      trigger_kind,trigger_ref,snapshot_json,status,result_json)
      SELECT agent_user_id,$2,trigger_kind,trigger_ref,$3,'completed',$4 FROM agent_runs
      WHERE agent_user_id=$1 AND id=$5 AND trigger_kind IN ('manual','schedule') ON CONFLICT DO NOTHING`,
    [agentUserId,requestId,JSON.stringify({schemaVersion:'agent-blog-public-receipt-reconciliation-v1',
      discoveryRunId:result.discovery.runId,publicationRunId:result.publication.runId}),JSON.stringify(result),
    result.publication.runId??result.discovery.runId]);
    // Do not steal a live owner's checkpoint. Its response may still be in flight.
    const updated=await this.pool.query(`UPDATE agent_blog_public_requests SET status='completed',lease_token=NULL,
      lease_until=NULL,result_json=$3,error_code=NULL,updated_at=now()
      WHERE agent_user_id=$1 AND request_id=$2 AND (status='waiting' OR (status='running' AND lease_until<=now()))`,
    [agentUserId,requestId,JSON.stringify(result)]);
    if(updated.rowCount||inserted.rowCount)await this.event(agentUserId,requestId,'receipt-reconciled',{runId:result.publication.runId});
  }

  async prepare({agentUserId,requestId,triggerKind,triggerRef,snapshot}) {
    await this.pool.query(`INSERT INTO agent_blog_public_requests(agent_user_id,request_id,trigger_kind,trigger_ref,snapshot_json)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[agentUserId,requestId,triggerKind,triggerRef,JSON.stringify(snapshot)]);
    return this.checkpoint(agentUserId,requestId);
  }

  async event(agentUserId,requestId,eventType,detail={}) {
    await this.pool.query(`INSERT INTO agent_blog_public_recovery_events(id,agent_user_id,request_id,event_type,detail_json)
      VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),agentUserId,requestId,eventType,JSON.stringify(detail)]);
  }

  async claim(agentUserId,requestId,{leaseSeconds=180}={}) {
    if(!Number.isInteger(leaseSeconds)||leaseSeconds<15||leaseSeconds>600)throw failure('AGENT_PUBLIC_REQUEST_LEASE_INVALID');
    return withTransaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['public-request:'+agentUserId]);
      await client.query(`UPDATE agent_blog_public_requests SET status='waiting',lease_token=NULL,lease_until=NULL,
        updated_at=now() WHERE agent_user_id=$1 AND status='running' AND lease_until<=now()`,[agentUserId]);
      const active=(await client.query(`SELECT request_id FROM agent_blog_public_requests
        WHERE agent_user_id=$1 AND status='running'`,[agentUserId])).rows[0];
      if(active)throw failure('AGENT_PUBLIC_REQUEST_BUSY');
      const first=(await client.query(`SELECT request_id FROM agent_blog_public_requests
        WHERE agent_user_id=$1 AND status='waiting' AND next_attempt_at<=now()
        ORDER BY created_at,request_id LIMIT 1`,[agentUserId])).rows[0];
      if(first&&first.request_id!==requestId)throw failure('AGENT_PUBLIC_REQUEST_WAITING');
      const token=crypto.randomUUID();
      const row=(await client.query(`UPDATE agent_blog_public_requests SET status='running',lease_token=$3,
        lease_until=now()+($4*interval '1 second'),attempt_count=attempt_count+1,updated_at=now()
        WHERE agent_user_id=$1 AND request_id=$2 AND status='waiting' AND next_attempt_at<=now() RETURNING *`,
      [agentUserId,requestId,token,leaseSeconds])).rows[0];
      if(!row)throw failure('AGENT_PUBLIC_REQUEST_WAITING');
      await client.query(`INSERT INTO agent_blog_public_recovery_events(id,agent_user_id,request_id,event_type,detail_json)
        VALUES($1,$2,$3,'lease-acquired',$4)`,[crypto.randomUUID(),agentUserId,requestId,JSON.stringify({attempt:row.attempt_count})]);
      return row;
    });
  }

  async heartbeat(agentUserId,requestId,token,leaseSeconds) {
    const result=await this.pool.query(`UPDATE agent_blog_public_requests SET lease_until=now()+($4*interval '1 second'),updated_at=now()
      WHERE agent_user_id=$1 AND request_id=$2 AND lease_token=$3 AND status='running' AND lease_until>now()`,
    [agentUserId,requestId,token,leaseSeconds]);
    if(result.rowCount!==1)throw failure('AGENT_PUBLIC_REQUEST_LEASE_LOST');
  }

  async settle(agentUserId,requestId,token,{result=null,errorCode=null,needsReview=false,delaySeconds=10,safeForNext=false}={}) {
    if(result&&!await this.findCompleted({agentUserId,requestId}))throw failure('AGENT_PUBLIC_REQUEST_RECEIPT_REQUIRED');
    const updated=await this.pool.query(`UPDATE agent_blog_public_requests SET status=$4,lease_token=NULL,lease_until=NULL,
      result_json=$5,error_code=$6,next_attempt_at=now()+($7*interval '1 second'),safe_for_next=$8,updated_at=now()
      WHERE agent_user_id=$1 AND request_id=$2 AND lease_token=$3 AND status='running'`,
    [agentUserId,requestId,token,result?'completed':needsReview?'needs-review':'waiting',result?JSON.stringify(result):null,errorCode,delaySeconds,safeForNext]);
    if(updated.rowCount===1)await this.event(agentUserId,requestId,result?'completed':needsReview?'needs-review':'waiting',{errorCode});
  }

  async pending(agentUserId) {
    const checkpoint=(await this.pool.query(`SELECT * FROM agent_blog_public_requests WHERE agent_user_id=$1
      AND coalesce(snapshot_json->>'executionSource','public-runtime')<>'agent-interaction-v1'
      AND (status='waiting' OR (status='running' AND lease_until<=now())) AND next_attempt_at<=now()
      ORDER BY created_at,request_id LIMIT 1`,[agentUserId])).rows[0]??null;
    if(checkpoint)return checkpoint;
    const legacy=(await this.pool.query(`SELECT substring(run.idempotency_key FROM 16 FOR 36) AS request_id,
      run.trigger_kind,run.trigger_ref FROM agent_runs run WHERE run.agent_user_id=$1
        AND run.workflow_key IN ('blog.project.discovery-shadow','blog.project.single')
        AND run.idempotency_key ~ '^public-runtime:[a-f0-9-]{36}:(discovery|article)$'
        AND (run.status IN ('queued','running','waiting','uncertain') OR (run.workflow_key='blog.project.discovery-shadow'
          AND run.status='succeeded' AND run.output_type='blog.candidate-set'
          AND NOT EXISTS(SELECT 1 FROM agent_run_handoffs handoff WHERE handoff.source_run_id=run.id)))
        AND NOT EXISTS(SELECT 1 FROM agent_blog_public_requests request WHERE request.agent_user_id=$1
          AND request.request_id::text=substring(run.idempotency_key FROM 16 FOR 36))
      ORDER BY run.created_at,run.id LIMIT 1`,[agentUserId])).rows[0];
    return legacy??null;
  }

  async runs(agentUserId,requestId) {
    const rows=(await this.pool.query(`SELECT id,workflow_key,status,output_type,output_id,input_json,config_snapshot,
      behavior_profile_id,trigger_kind,trigger_ref FROM agent_runs
      WHERE agent_user_id=$1 AND ((workflow_key='blog.project.discovery-shadow' AND idempotency_key=$2)
        OR (workflow_key IN ('blog.project.single','blog.project.single.draft-shadow') AND idempotency_key=$3))`,
    [agentUserId,`public-runtime:${requestId}:discovery`,`public-runtime:${requestId}:article`])).rows;
    return Object.fromEntries(rows.map(row=>[row.workflow_key==='blog.project.discovery-shadow'?'discovery':'publication',
      {...row,outputType:row.output_type,outputId:row.output_id}]));
  }

  async reviewIsFenced(agentUserId,requestId) {
    return withTransaction(this.pool,async client=>{
      const runs=await this.runs(agentUserId,requestId);
      const ids=Object.values(runs).map(run=>run.id);
      if(!ids.length)return false;
      const locked=(await client.query(`SELECT id,status FROM agent_runs WHERE agent_user_id=$1 AND id=ANY($2::uuid[])
        ORDER BY id FOR UPDATE`,[agentUserId,ids])).rows;
      await client.query(`SELECT id FROM agent_run_stages WHERE run_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[ids]);
      return locked.some(run=>['failed','uncertain','cancelled','rejected'].includes(run.status))
        &&locked.every(run=>['failed','uncertain','cancelled','rejected','succeeded'].includes(run.status));
    });
  }

  async findCompleted({ agentUserId, requestId }) {
    if (!UUID.test(agentUserId ?? '') || !UUID.test(requestId ?? '')) {
      throw new Error('AGENT_BLOG_PUBLIC_RUNTIME_REQUEST_ID_INVALID');
    }
    const empty=(await this.pool.query(`SELECT run.id,run.output_id,profile.version FROM agent_runs run
      JOIN agent_behavior_profiles profile ON profile.id=run.behavior_profile_id AND profile.agent_user_id=run.agent_user_id
      JOIN agent_runtime_stage_artifacts artifact ON artifact.id=run.output_id AND artifact.run_id=run.id
      JOIN agent_run_stages stage ON stage.id=artifact.stage_id AND stage.run_id=run.id
      WHERE run.agent_user_id=$1 AND run.idempotency_key=$2 AND run.workflow_key='blog.project.discovery-shadow'
        AND run.workflow_version>=4 AND run.status='succeeded' AND run.output_type='blog.discovery-skipped'
        AND stage.stage_key='finalize-candidates' AND stage.status='succeeded'
        AND artifact.artifact_key='blog.discovery-skip' AND artifact.content_json->>'schemaVersion'='blog-discovery-skip-v1'
        AND artifact.content_json->>'reason'='NO_CANDIDATES'`,[agentUserId,`public-runtime:${requestId}:discovery`])).rows[0];
    if(empty)return {schemaVersion:'agent-blog-public-runtime-result-v1',requestId,agentUserId,preflight:'passed',
      behaviorProfileVersion:Number(empty.version),discovery:{runId:empty.id,artifactId:empty.output_id},
      publication:{runId:null,articleId:null,publicationState:'skipped'},publicationAttempted:false};
    const row = (await this.pool.query(`SELECT publication.id,
        CASE WHEN receipt.article_id IS NOT NULL THEN 'blog.article' ELSE publication.output_type END AS output_type,
        COALESCE(receipt.article_id,publication.output_id) AS output_id,
        profile.version AS behavior_profile_version,discovery.id AS discovery_run_id,
        discovery.output_id AS discovery_artifact_id
      FROM agent_runs publication
      JOIN agent_run_handoffs handoff ON handoff.target_run_id=publication.id
        AND handoff.agent_user_id=publication.agent_user_id
        AND handoff.handoff_kind='blog.candidate-set-to-public-article'
      JOIN agent_runs discovery ON discovery.id=handoff.source_run_id
        AND discovery.agent_user_id=publication.agent_user_id
        AND discovery.workflow_key='blog.project.discovery-shadow' AND discovery.status='succeeded'
        AND discovery.output_type='blog.candidate-set' AND discovery.output_id=handoff.source_artifact_id
      JOIN agent_behavior_profiles profile ON profile.id=publication.behavior_profile_id
        AND profile.agent_user_id=publication.agent_user_id
      LEFT JOIN agent_blog_foundation_publications receipt ON receipt.run_id=publication.id
        AND receipt.agent_user_id=publication.agent_user_id
      WHERE publication.agent_user_id=$1 AND publication.workflow_key='blog.project.single'
        AND publication.idempotency_key=$2 AND discovery.idempotency_key=$3
        AND (
          (receipt.article_id IS NOT NULL)
          OR (publication.status='succeeded' AND publication.output_type='blog.publication-skipped' AND EXISTS (
            SELECT 1 FROM agent_runtime_stage_artifacts artifact
            JOIN agent_run_stages stage ON stage.id=artifact.stage_id AND stage.run_id=publication.id
              AND stage.stage_key='select-subject' AND stage.status='succeeded'
            WHERE artifact.id=publication.output_id AND artifact.run_id=publication.id
              AND artifact.artifact_key='blog.selection-skip'
              AND artifact.content_json->>'schemaVersion'='blog-selection-skip-v1'
              AND artifact.content_json->>'reason' IN ('NO_ELIGIBLE_SUBJECT','EDITORIAL_COOLDOWN_EXHAUSTED')))
        )`, [agentUserId, `public-runtime:${requestId}:article`, `public-runtime:${requestId}:discovery`])).rows[0];
    if (!row) return null;
    const published = row.output_type === 'blog.article';
    return Object.freeze({ schemaVersion:'agent-blog-public-runtime-result-v1', requestId, agentUserId,
      preflight:'passed', behaviorProfileVersion:Number(row.behavior_profile_version),
      discovery:{runId:row.discovery_run_id,artifactId:row.discovery_artifact_id},
      publication:{runId:row.id,articleId:published?row.output_id:null,publicationState:published?'published':'skipped'},
      publicationAttempted:published });
  }
}
