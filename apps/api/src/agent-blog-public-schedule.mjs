import crypto from 'node:crypto';
import {publicImmediateAdmission} from './agent-blog-public-admission.mjs';
import { withTransaction } from './database.mjs';
import { nextAgentBlogPrivateDailyFire, scheduleFireRequestId } from './agent-blog-private-schedule.mjs';
import { runAgentBlogPublicRuntimePreflight } from './agent-blog-public-runtime-preflight.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKFLOW_KEY = 'blog.project.discovery-shadow';
const WORKFLOW_VERSION = 4;
const SPEC = Object.freeze({ kind: 'daily-local-time', localTime: '10:00' });

export class AgentBlogPublicScheduleError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AgentBlogPublicScheduleError';
    this.code = code;
    this.details = details;
    this.retryable = false;
  }
}

const fail = (code, details) => { throw new AgentBlogPublicScheduleError(code, details); };
const iso = value => value?.toISOString?.() ?? value ?? null;

export function loadAgentBlogPublicScheduleConfig(env = process.env) {
  const rawEnabled = env.AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED ?? 'false';
  if (!['true', 'false'].includes(rawEnabled)) fail('AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED_INVALID');
  const pollMilliseconds = Number(env.AGENT_BLOG_PUBLIC_SCHEDULE_POLL_MS ?? 30000);
  if (!Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 1000 || pollMilliseconds > 300000) {
    fail('AGENT_BLOG_PUBLIC_SCHEDULE_POLL_INVALID');
  }
  return Object.freeze({ schemaVersion: 'agent-blog-public-schedule-config-v1',
    enabled: rawEnabled === 'true', pollMilliseconds, timezone: 'Asia/Shanghai', localTime: '10:00' });
}

const fireView = row => row ? ({
  id: row.id, scheduleId: row.schedule_id, agentUserId: row.agent_user_id,
  logicalFireAt: iso(row.logical_fire_at), requestId: row.request_id, status: row.status,
  attemptId: row.attempt_id, leaseUntil: iso(row.lease_until), result: row.result_json ?? {},
  errorCode: row.error_code, errorMessage: row.error_message,
  startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
}) : null;

export class PostgresAgentBlogPublicScheduleRepository {
  constructor(pool, { clock = () => new Date() } = {}) {
    if (!pool) fail('AGENT_BLOG_PUBLIC_SCHEDULE_DATABASE_REQUIRED');
    this.pool = pool;
    this.clock = clock;
  }

  async ensureDaily({ agentUserId, enabled, resume = false, preserveExisting = false }) {
    if (!UUID.test(agentUserId ?? '') || typeof enabled !== 'boolean' || typeof resume !== 'boolean'
      || typeof preserveExisting !== 'boolean') {
      fail('AGENT_BLOG_PUBLIC_SCHEDULE_INPUT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const account = (await client.query(`SELECT account.operator_user_id
        FROM agent_accounts account
        JOIN agent_blog_publication_owners owner ON owner.agent_user_id=account.user_id
        WHERE account.user_id=$1 AND owner.active_publisher='foundation'
        FOR UPDATE OF owner`, [agentUserId])).rows[0];
      if (!account) fail('AGENT_BLOG_PUBLIC_SCHEDULE_FOUNDATION_OWNER_REQUIRED');
      const running = (await client.query(`SELECT 1 FROM agent_schedule_fires fire
        JOIN agent_schedules schedule ON schedule.id=fire.schedule_id
        WHERE schedule.agent_user_id=$1 AND schedule.workflow_key=$2 AND fire.status='running'
        LIMIT 1`, [agentUserId, WORKFLOW_KEY])).rows[0];
      if (running && !preserveExisting) fail('AGENT_BLOG_PUBLIC_SCHEDULE_FIRE_ACTIVE');
      const nextFireAt = enabled ? nextAgentBlogPrivateDailyFire(this.clock()) : null;
      const config = { mode: 'foundation-public', publishEnabled: true };
      const row = (await client.query(`INSERT INTO agent_schedules(id,agent_user_id,workflow_key,workflow_version,
          timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,misfire_policy,config_json,updated_by_user_id)
        VALUES($1,$2,$3,$4,'Asia/Shanghai',$5,$6,$7,NULL,'fire-once',$8,$9)
        ON CONFLICT(agent_user_id,workflow_key) DO UPDATE SET
          workflow_version=EXCLUDED.workflow_version,timezone=EXCLUDED.timezone,
          schedule_spec_json=EXCLUDED.schedule_spec_json,
          enabled=CASE WHEN $11 THEN agent_schedules.enabled WHEN $10 THEN EXCLUDED.enabled
            WHEN agent_schedules.config_json->>'mode'='foundation-public'
            AND agent_schedules.config_json ? 'suspendedAt' THEN false ELSE EXCLUDED.enabled END,
          next_fire_at=CASE WHEN $11 THEN agent_schedules.next_fire_at
            WHEN $10 AND EXCLUDED.enabled THEN EXCLUDED.next_fire_at
            WHEN agent_schedules.config_json->>'mode'='foundation-public'
            AND agent_schedules.config_json ? 'suspendedAt' THEN NULL
            WHEN EXCLUDED.enabled THEN COALESCE(agent_schedules.next_fire_at,EXCLUDED.next_fire_at) ELSE NULL END,
          misfire_policy=EXCLUDED.misfire_policy,
          config_json=CASE WHEN $11 THEN agent_schedules.config_json||EXCLUDED.config_json
            WHEN $10 THEN
            (agent_schedules.config_json-'suspendedAt'-'suspendedByFireId'-'suspensionReason')
              ||EXCLUDED.config_json||jsonb_build_object('consecutiveFailures',0)
            WHEN agent_schedules.config_json->>'mode'='foundation-public'
            AND agent_schedules.config_json ? 'suspendedAt'
            THEN agent_schedules.config_json ELSE agent_schedules.config_json||EXCLUDED.config_json END,
          updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
        RETURNING *`, [crypto.randomUUID(), agentUserId, WORKFLOW_KEY, WORKFLOW_VERSION,
        JSON.stringify(SPEC), enabled, nextFireAt, JSON.stringify(config), account.operator_user_id,
        resume, preserveExisting])).rows[0];
      return { id: row.id, enabled: row.enabled, timezone: row.timezone,
        spec: row.schedule_spec_json, mode: row.config_json?.mode,
        suspendedAt: iso(row.config_json?.suspendedAt), nextFireAt: iso(row.next_fire_at),
        lastFireAt: iso(row.last_fire_at) };
    });
  }

  async requestImmediate(agentUserId, { maxHeartbeatAgeMs = 90000 } = {}) {
    if (!UUID.test(agentUserId ?? '') || !Number.isSafeInteger(maxHeartbeatAgeMs)
      || maxHeartbeatAgeMs < 30000 || maxHeartbeatAgeMs > 900000) {
      fail('AGENT_BLOG_PUBLIC_SCHEDULE_INPUT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`SELECT schedule.* FROM agent_schedules schedule
        JOIN agent_blog_publication_owners owner ON owner.agent_user_id=schedule.agent_user_id
        WHERE schedule.agent_user_id=$1 AND schedule.workflow_key=$2
          AND schedule.enabled=true AND schedule.config_json->>'mode'='foundation-public'
          AND owner.active_publisher='foundation' FOR UPDATE OF schedule`,
      [agentUserId, WORKFLOW_KEY])).rows[0];
      if (!row) fail('AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED');
      const admission=publicImmediateAdmission({schedule:{enabled:row.enabled,mode:row.config_json?.mode,
        worker:row.config_json?.worker},now:this.clock(),maxHeartbeatAgeMs});
      if(!admission.ready)fail(admission.blockers[0]);
      const running = (await client.query(`SELECT 1 FROM agent_schedule_fires
        WHERE schedule_id=$1 AND status='running' LIMIT 1`, [row.id])).rows[0];
      if (running) fail('AGENT_BLOG_PUBLIC_SCHEDULE_FIRE_ACTIVE');
      const requestedAt = this.clock();
      const updated = (await client.query(`UPDATE agent_schedules SET next_fire_at=$2,
          config_json=config_json||jsonb_build_object('manualRequestedAt',$2::timestamptz),updated_at=now()
        WHERE id=$1 RETURNING *`, [row.id, requestedAt])).rows[0];
      return { id: updated.id, enabled: updated.enabled, timezone: updated.timezone,
        spec: updated.schedule_spec_json, mode: updated.config_json?.mode,
        nextFireAt: iso(updated.next_fire_at), requestedAt: iso(requestedAt) };
    });
  }

  async claimDue({ leaseSeconds = 180, agentUserId = null, recoverOnly = false } = {}) {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 14400) {
      fail('AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const expired=(await client.query(`SELECT fire.* FROM agent_schedule_fires fire
        JOIN agent_schedules schedule ON schedule.id=fire.schedule_id
        JOIN agent_blog_publication_owners owner ON owner.agent_user_id=fire.agent_user_id
        WHERE fire.status='running' AND fire.lease_until<=now()
          AND schedule.workflow_key=$1 AND schedule.config_json->>'mode'='foundation-public'
          AND owner.active_publisher='foundation' AND ($2::uuid IS NULL OR fire.agent_user_id=$2)
        ORDER BY fire.logical_fire_at,fire.id FOR UPDATE OF fire SKIP LOCKED LIMIT 1`,
        [WORKFLOW_KEY,agentUserId])).rows[0];
      if(expired){
        const row=(await client.query(`UPDATE agent_schedule_fires SET attempt_id=$2,
          lease_until=now()+($3*interval '1 second'),updated_at=now() WHERE id=$1 RETURNING *`,
        [expired.id,crypto.randomUUID(),leaseSeconds])).rows[0];
        await client.query(`INSERT INTO agent_blog_public_recovery_events(id,agent_user_id,request_id,event_type,detail_json)
          VALUES($1,$2,$3,'fire-lease-reclaimed',$4)`,[crypto.randomUUID(),row.agent_user_id,row.request_id,JSON.stringify({fireId:row.id})]);
        return fireView(row);
      }
      if(recoverOnly)return null;
      const schedule = (await client.query(`SELECT schedule.* FROM agent_schedules schedule
        JOIN agent_blog_publication_owners owner ON owner.agent_user_id=schedule.agent_user_id
        WHERE schedule.enabled=true AND schedule.workflow_key=$1
          AND schedule.config_json->>'mode'='foundation-public'
          AND owner.active_publisher='foundation' AND schedule.next_fire_at<=now()
          AND ($2::uuid IS NULL OR schedule.agent_user_id=$2)
          AND NOT EXISTS(SELECT 1 FROM agent_schedule_fires fire WHERE fire.schedule_id=schedule.id AND fire.status='running')
        ORDER BY schedule.next_fire_at,schedule.id
        FOR UPDATE OF schedule SKIP LOCKED LIMIT 1`, [WORKFLOW_KEY,agentUserId])).rows[0];
      if (!schedule) return null;
      const logicalFireAt = new Date(schedule.next_fire_at), now = this.clock();
      const nextFireAt = nextAgentBlogPrivateDailyFire(now, schedule.timezone,
        schedule.schedule_spec_json?.localTime ?? SPEC.localTime);
      const requestId = scheduleFireRequestId(schedule.id, logicalFireAt);
      const attemptId = crypto.randomUUID(), fireId = crypto.randomUUID();
      const inserted = (await client.query(`INSERT INTO agent_schedule_fires(id,schedule_id,agent_user_id,
          logical_fire_at,request_id,status,attempt_id,lease_until,started_at)
        VALUES($1,$2,$3,$4,$5,'running',$6,now()+($7*interval '1 second'),now())
        ON CONFLICT(schedule_id,logical_fire_at) DO NOTHING RETURNING *`,
      [fireId, schedule.id, schedule.agent_user_id, logicalFireAt, requestId, attemptId, leaseSeconds])).rows[0];
      await client.query(`UPDATE agent_schedules SET last_fire_at=$2,next_fire_at=$3,updated_at=now()
        WHERE id=$1`, [schedule.id, logicalFireAt, nextFireAt]);
      return fireView(inserted);
    });
  }

  async renew(fireId,attemptId,{leaseSeconds=180}={}) {
    const row=await this.pool.query(`UPDATE agent_schedule_fires SET lease_until=now()+($3*interval '1 second'),updated_at=now()
      WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_until>now()`,[fireId,attemptId,leaseSeconds]);
    if(row.rowCount!==1)fail('AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_LOST');
  }

  async defer(fireId,attemptId,errorCode) {
    const row=(await this.pool.query(`UPDATE agent_schedule_fires SET lease_until=now()+interval '30 seconds',
      error_code=$3,updated_at=now() WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_until>now() RETURNING *`,
    [fireId,attemptId,String(errorCode).slice(0,120)])).rows[0];
    if(!row)fail('AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_LOST');
    return fireView(row);
  }

  async heartbeat({ agentUserId, instanceId, state = 'idle' }) {
    if (!UUID.test(agentUserId ?? '') || !UUID.test(instanceId ?? '')
      || !['starting', 'idle', 'busy', 'suspended', 'waiting', 'degraded', 'stopped'].includes(state)) {
      fail('AGENT_BLOG_PUBLIC_SCHEDULE_HEARTBEAT_INVALID');
    }
    const row = (await this.pool.query(`UPDATE agent_schedules SET
        config_json=jsonb_set(config_json,'{worker}',jsonb_build_object(
          'instanceId',$2::text,'state',$3::text,'heartbeatAt',clock_timestamp()),true),
        updated_at=clock_timestamp()
      WHERE agent_user_id=$1 AND workflow_key=$4
        AND config_json->>'mode'='foundation-public'
      RETURNING config_json->'worker' AS worker`,
    [agentUserId, instanceId, state, WORKFLOW_KEY])).rows[0];
    if (!row) fail('AGENT_BLOG_PUBLIC_SCHEDULE_MISSING');
    return row.worker;
  }

  async finish(fireId, attemptId, { status, result = {}, errorCode = null, errorMessage = null,
    suspendAfterFailures = 2, retryNextDaily = false }) {
    if (!UUID.test(fireId ?? '') || !UUID.test(attemptId ?? '')
      || !['succeeded', 'failed'].includes(status) || !result || typeof result !== 'object'
      || Array.isArray(result) || !Number.isSafeInteger(suspendAfterFailures)
      || suspendAfterFailures < 1 || suspendAfterFailures > 10) {
      fail('AGENT_BLOG_PUBLIC_SCHEDULE_RESULT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      let scheduleSuspended = false;
      const row = (await client.query(`UPDATE agent_schedule_fires SET status=$3,attempt_id=NULL,
          lease_until=NULL,result_json=$4,error_code=$5,error_message=$6,
          finished_at=now(),updated_at=now()
        WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_until>now() RETURNING *`,
      [fireId, attemptId, status, JSON.stringify(result), errorCode,
        errorMessage?.slice?.(0, 500) ?? null])).rows[0];
      if (!row) fail('AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_LOST');
      if (status === 'failed') {
        const schedule = (await client.query('SELECT config_json FROM agent_schedules WHERE id=$1 FOR UPDATE',
          [row.schedule_id])).rows[0];
        const failures = Math.max(0, Number(schedule?.config_json?.consecutiveFailures) || 0) + 1;
        if (failures >= suspendAfterFailures && !retryNextDaily) {
          scheduleSuspended = true;
          await client.query(`UPDATE agent_schedules SET enabled=false,next_fire_at=NULL,
            config_json=config_json||jsonb_build_object('consecutiveFailures',$2::int,
              'lastFailureAt',now(),'suspendedAt',now(),'suspendedByFireId',$3::text,
              'suspensionReason',COALESCE($4,'AGENT_BLOG_PUBLIC_SCHEDULE_RUN_FAILED')),updated_at=now()
            WHERE id=$1`, [row.schedule_id, failures, row.id, errorCode]);
        } else {
          await client.query(`UPDATE agent_schedules SET
            config_json=(config_json-'suspendedAt'-'suspendedByFireId'-'suspensionReason')
              ||jsonb_build_object('consecutiveFailures',$2::int,'lastFailureAt',now(),
                'lastFailureCode',COALESCE($3,'AGENT_BLOG_PUBLIC_SCHEDULE_RUN_FAILED')),
            updated_at=now() WHERE id=$1`, [row.schedule_id, failures, errorCode]);
        }
      } else {
        await client.query(`UPDATE agent_schedules SET
          config_json=(config_json-'suspendedAt'-'suspendedByFireId'-'suspensionReason'
            -'lastFailureAt'-'lastFailureCode')||jsonb_build_object('consecutiveFailures',0),
          updated_at=now() WHERE id=$1`, [row.schedule_id]);
      }
      return { ...fireView(row), scheduleSuspended };
    });
  }
}

const ACTIVATION_TRANSIENT_BLOCKERS = new Set(['AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_REACHED']);

export function createAgentBlogPublicScheduleController({
  repository, preflightRepository, runtimeConfig, runner,
} = {}) {
  if (!repository || !preflightRepository || !runtimeConfig
    || typeof repository.ensureDaily !== 'function' || typeof repository.claimDue !== 'function'
    || typeof repository.finish !== 'function' || (runner && typeof runner.run !== 'function')) {
    fail('AGENT_BLOG_PUBLIC_SCHEDULE_DEPENDENCY_REQUIRED');
  }
  return {
    async ensure({ agentUserId, enabled, resume = false, preserveExisting = false }) {
      if (agentUserId !== runtimeConfig.agentUserId) fail('AGENT_BLOG_PUBLIC_SCHEDULE_AGENT_MISMATCH');
      const preflight = await runAgentBlogPublicRuntimePreflight({
        repository: preflightRepository, config: runtimeConfig,
      });
      const blockers = preflight.blockers.filter(code => !ACTIVATION_TRANSIENT_BLOCKERS.has(code));
      if (enabled && blockers.length > 0) return { enabled: false, blocked: true, blockers, preflight };
      const schedule = await repository.ensureDaily({ agentUserId, enabled, resume, preserveExisting });
      return { enabled: schedule.enabled, blocked: false, blockers: [], preflight, schedule };
    },
    async requestNow({ agentUserId, maxHeartbeatAgeMs }) {
      if (agentUserId !== runtimeConfig.agentUserId) fail('AGENT_BLOG_PUBLIC_SCHEDULE_AGENT_MISMATCH');
      if (typeof repository.requestImmediate !== 'function') {
        fail('AGENT_BLOG_PUBLIC_SCHEDULE_REQUEST_PORT_REQUIRED');
      }
      const preflight = await runAgentBlogPublicRuntimePreflight({
        repository: preflightRepository, config: runtimeConfig,
      });
      if (!preflight.ready) return { queued: false, blocked: true, blockers: preflight.blockers, preflight };
      const schedule = await repository.requestImmediate(agentUserId, { maxHeartbeatAgeMs });
      return { queued: true, blocked: false, blockers: [], preflight, schedule };
    },
    async heartbeat(input) {
      if (typeof repository.heartbeat !== 'function') {
        fail('AGENT_BLOG_PUBLIC_SCHEDULE_HEARTBEAT_PORT_REQUIRED');
      }
      return repository.heartbeat(input);
    },
    async runOnce({signal}={}) {
      if (!runner) fail('AGENT_BLOG_PUBLIC_SCHEDULE_RUNNER_REQUIRED');
      let fire=await repository.claimDue({agentUserId:runtimeConfig.agentUserId,recoverOnly:true});
      if(!fire){
        const pending=await runner.pending?.();
        if(pending){
          try{return {status:'recovered',run:await runner.run({requestId:pending.request_id,
            triggerKind:pending.trigger_kind,triggerRef:pending.trigger_ref,signal})};}
          catch(error){return {status:'waiting',code:error.code??'AGENT_PUBLIC_REQUEST_INTERRUPTED'};}
        }
        const preflight=await runAgentBlogPublicRuntimePreflight({repository:preflightRepository,config:runtimeConfig});
        if(!preflight.ready)return {status:'waiting',blockers:preflight.blockers};
        fire=await repository.claimDue({agentUserId:runtimeConfig.agentUserId});
      }
      if (!fire) return { status: 'idle' };
      const controller=new AbortController();
      const relay=()=>controller.abort(signal.reason);
      if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
      let renewing=false;
      const timer=repository.renew?setInterval(async()=>{
        if(renewing)return;renewing=true;
        try{await repository.renew(fire.id,fire.attemptId);}catch(error){controller.abort(error);}finally{renewing=false;}
      },30000):null;
      timer?.unref?.();
      try {
        const run = await runner.run({ requestId: fire.requestId, triggerKind: 'schedule',
          triggerRef: `schedule:${fire.scheduleId}:${fire.logicalFireAt}`,signal:controller.signal });
        const published = run?.publication?.publicationState === 'published'
          && run?.publicationAttempted === true;
        const skipped = run?.publication?.publicationState === 'skipped'
          && run?.publicationAttempted === false && !run?.publication?.articleId;
        const result = { publicationRunId: run?.publication?.runId ?? null,
          articleId: run?.publication?.articleId ?? null,
          publicationState: run?.publication?.publicationState ?? null };
        const finished = await repository.finish(fire.id, fire.attemptId, published || skipped
          ? { status: 'succeeded', result, suspendAfterFailures: runtimeConfig.consecutiveFailureLimit,retryNextDaily:true }
          : { status: 'failed', result, errorCode: 'AGENT_BLOG_PUBLIC_SCHEDULE_PUBLICATION_INCOMPLETE',
            errorMessage: '公开计划没有得到已发布文章。',
            suspendAfterFailures: runtimeConfig.consecutiveFailureLimit });
        return { status: finished.status, fire: finished };
      } catch (error) {
        if(repository.defer&&!error.requestNeedsReview){
          const deferred=await repository.defer(fire.id,fire.attemptId,error.code??'AGENT_PUBLIC_REQUEST_INTERRUPTED');
          return {status:'waiting',fire:deferred};
        }
        const finished = await repository.finish(fire.id, fire.attemptId, { status: 'failed',
          errorCode: String(error?.code || 'AGENT_BLOG_PUBLIC_SCHEDULE_RUN_FAILED').slice(0, 120),
          errorMessage: String(error?.message || '公开计划运行失败。').slice(0, 500),
          suspendAfterFailures: runtimeConfig.consecutiveFailureLimit,retryNextDaily:true });
        return { status: 'failed', fire: finished };
      } finally {clearInterval(timer);signal?.removeEventListener('abort',relay);}
    },
  };
}
