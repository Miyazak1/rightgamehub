import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { nextAgentBlogPrivateDailyFire, scheduleFireRequestId } from './agent-blog-private-schedule.mjs';
import { runAgentBlogPublicRuntimePreflight } from './agent-blog-public-runtime-preflight.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKFLOW_KEY = 'blog.project.discovery-shadow';
const WORKFLOW_VERSION = 3;
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

  async ensureDaily({ agentUserId, enabled }) {
    if (!UUID.test(agentUserId ?? '') || typeof enabled !== 'boolean') {
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
      if (running) fail('AGENT_BLOG_PUBLIC_SCHEDULE_FIRE_ACTIVE');
      const nextFireAt = enabled ? nextAgentBlogPrivateDailyFire(this.clock()) : null;
      const config = { mode: 'foundation-public', publishEnabled: true };
      const row = (await client.query(`INSERT INTO agent_schedules(id,agent_user_id,workflow_key,workflow_version,
          timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,misfire_policy,config_json,updated_by_user_id)
        VALUES($1,$2,$3,$4,'Asia/Shanghai',$5,$6,$7,NULL,'fire-once',$8,$9)
        ON CONFLICT(agent_user_id,workflow_key) DO UPDATE SET
          workflow_version=EXCLUDED.workflow_version,timezone=EXCLUDED.timezone,
          schedule_spec_json=EXCLUDED.schedule_spec_json,
          enabled=CASE WHEN agent_schedules.config_json->>'mode'='foundation-public'
            AND agent_schedules.config_json ? 'suspendedAt' THEN false ELSE EXCLUDED.enabled END,
          next_fire_at=CASE WHEN agent_schedules.config_json->>'mode'='foundation-public'
            AND agent_schedules.config_json ? 'suspendedAt' THEN NULL
            WHEN EXCLUDED.enabled THEN COALESCE(agent_schedules.next_fire_at,EXCLUDED.next_fire_at) ELSE NULL END,
          misfire_policy=EXCLUDED.misfire_policy,
          config_json=CASE WHEN agent_schedules.config_json->>'mode'='foundation-public'
            AND agent_schedules.config_json ? 'suspendedAt'
            THEN agent_schedules.config_json ELSE EXCLUDED.config_json END,
          updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
        RETURNING *`, [crypto.randomUUID(), agentUserId, WORKFLOW_KEY, WORKFLOW_VERSION,
        JSON.stringify(SPEC), enabled, nextFireAt, JSON.stringify(config), account.operator_user_id])).rows[0];
      return { id: row.id, enabled: row.enabled, timezone: row.timezone,
        spec: row.schedule_spec_json, mode: row.config_json?.mode,
        suspendedAt: iso(row.config_json?.suspendedAt), nextFireAt: iso(row.next_fire_at),
        lastFireAt: iso(row.last_fire_at) };
    });
  }

  async claimDue({ leaseSeconds = 7200 } = {}) {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 14400) {
      fail('AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_INVALID');
    }
    return withTransaction(this.pool, async client => {
      await client.query(`UPDATE agent_schedule_fires SET status='uncertain',attempt_id=NULL,lease_until=NULL,
        error_code='AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_EXPIRED',
        error_message='公开计划执行进程在完成前失去租约；为避免重复发布，未自动重发。',
        finished_at=now(),updated_at=now() WHERE status='running' AND lease_until<now()`);
      const schedule = (await client.query(`SELECT schedule.* FROM agent_schedules schedule
        JOIN agent_blog_publication_owners owner ON owner.agent_user_id=schedule.agent_user_id
        WHERE schedule.enabled=true AND schedule.workflow_key=$1
          AND schedule.config_json->>'mode'='foundation-public'
          AND owner.active_publisher='foundation' AND schedule.next_fire_at<=now()
        ORDER BY schedule.next_fire_at,schedule.id
        FOR UPDATE OF schedule SKIP LOCKED LIMIT 1`, [WORKFLOW_KEY])).rows[0];
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

  async finish(fireId, attemptId, { status, result = {}, errorCode = null, errorMessage = null }) {
    if (!UUID.test(fireId ?? '') || !UUID.test(attemptId ?? '')
      || !['succeeded', 'failed'].includes(status) || !result || typeof result !== 'object'
      || Array.isArray(result)) fail('AGENT_BLOG_PUBLIC_SCHEDULE_RESULT_INVALID');
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`UPDATE agent_schedule_fires SET status=$3,attempt_id=NULL,
          lease_until=NULL,result_json=$4,error_code=$5,error_message=$6,
          finished_at=now(),updated_at=now()
        WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_until>now() RETURNING *`,
      [fireId, attemptId, status, JSON.stringify(result), errorCode,
        errorMessage?.slice?.(0, 500) ?? null])).rows[0];
      if (!row) fail('AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_LOST');
      if (status === 'failed') await client.query(`UPDATE agent_schedules SET enabled=false,next_fire_at=NULL,
        config_json=config_json||jsonb_build_object('suspendedAt',now(),'suspendedByFireId',$2::text,
          'suspensionReason',COALESCE($3,'AGENT_BLOG_PUBLIC_SCHEDULE_RUN_FAILED')),updated_at=now()
        WHERE id=$1`, [row.schedule_id, row.id, errorCode]);
      return fireView(row);
    });
  }
}

const ACTIVATION_TRANSIENT_BLOCKERS = new Set(['AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_REACHED']);

export function createAgentBlogPublicScheduleController({
  repository, preflightRepository, runtimeConfig, runner,
} = {}) {
  if (!repository || !preflightRepository || !runtimeConfig || !runner
    || typeof repository.ensureDaily !== 'function' || typeof repository.claimDue !== 'function'
    || typeof repository.finish !== 'function' || typeof runner.run !== 'function') {
    fail('AGENT_BLOG_PUBLIC_SCHEDULE_DEPENDENCY_REQUIRED');
  }
  return {
    async ensure({ agentUserId, enabled }) {
      if (agentUserId !== runtimeConfig.agentUserId) fail('AGENT_BLOG_PUBLIC_SCHEDULE_AGENT_MISMATCH');
      const preflight = await runAgentBlogPublicRuntimePreflight({
        repository: preflightRepository, config: runtimeConfig,
      });
      const blockers = preflight.blockers.filter(code => !ACTIVATION_TRANSIENT_BLOCKERS.has(code));
      if (enabled && blockers.length > 0) return { enabled: false, blocked: true, blockers, preflight };
      const schedule = await repository.ensureDaily({ agentUserId, enabled });
      return { enabled: schedule.enabled, blocked: false, blockers: [], preflight, schedule };
    },
    async runOnce() {
      const fire = await repository.claimDue();
      if (!fire) return { status: 'idle' };
      try {
        const run = await runner.run({ requestId: fire.requestId, triggerKind: 'schedule',
          triggerRef: `schedule:${fire.scheduleId}:${fire.logicalFireAt}` });
        const published = run?.publication?.publicationState === 'published'
          && run?.publicationAttempted === true;
        const result = { publicationRunId: run?.publication?.runId ?? null,
          articleId: run?.publication?.articleId ?? null,
          publicationState: run?.publication?.publicationState ?? null };
        const finished = await repository.finish(fire.id, fire.attemptId, published
          ? { status: 'succeeded', result }
          : { status: 'failed', result, errorCode: 'AGENT_BLOG_PUBLIC_SCHEDULE_PUBLICATION_INCOMPLETE',
            errorMessage: '公开计划没有得到已发布文章，计划已自动停用。' });
        return { status: finished.status, fire: finished };
      } catch (error) {
        const finished = await repository.finish(fire.id, fire.attemptId, { status: 'failed',
          errorCode: String(error?.code || 'AGENT_BLOG_PUBLIC_SCHEDULE_RUN_FAILED').slice(0, 120),
          errorMessage: String(error?.message || '公开计划运行失败。').slice(0, 500) });
        return { status: 'failed', fire: finished };
      }
    },
  };
}
