import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKFLOW_KEY = 'blog.project.discovery-shadow';
const WORKFLOW_VERSION = 3;
const SPEC = Object.freeze({ kind: 'daily-local-time', localTime: '10:00' });

export class AgentBlogPrivateScheduleError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AgentBlogPrivateScheduleError';
    this.code = code;
    this.details = details;
    this.retryable = false;
  }
}

const fail = (code, details) => { throw new AgentBlogPrivateScheduleError(code, details); };
const iso = value => value?.toISOString?.() ?? value ?? null;

export function loadAgentBlogPrivateScheduleConfig(env = process.env) {
  const rawEnabled = env.AGENT_BLOG_PRIVATE_SCHEDULE_ENABLED ?? 'false';
  if (!['true', 'false'].includes(rawEnabled)) fail('AGENT_BLOG_SCHEDULE_ENABLED_INVALID');
  const pollMilliseconds = Number(env.AGENT_BLOG_PRIVATE_SCHEDULE_POLL_MS ?? 30000);
  if (!Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 1000 || pollMilliseconds > 300000) {
    fail('AGENT_BLOG_SCHEDULE_POLL_INVALID');
  }
  return Object.freeze({ schemaVersion: 'agent-blog-private-schedule-config-v1',
    enabled: rawEnabled === 'true', pollMilliseconds, timezone: 'Asia/Shanghai', localTime: '10:00' });
}

function parts(date, timeZone) {
  const values = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)) if (part.type !== 'literal') values[part.type] = Number(part.value);
  return values;
}

function localInstant({ year, month, day, hour, minute }, timeZone) {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = parts(new Date(timestamp), timeZone);
    const delta = Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(
      shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    if (delta === 0) break;
    timestamp += delta;
  }
  const result = new Date(timestamp), shown = parts(result, timeZone);
  if (shown.year !== year || shown.month !== month || shown.day !== day
    || shown.hour !== hour || shown.minute !== minute) fail('AGENT_BLOG_SCHEDULE_LOCAL_TIME_INVALID');
  return result;
}

export function nextAgentBlogPrivateDailyFire(now = new Date(), timeZone = 'Asia/Shanghai', localTime = '10:00') {
  now = new Date(now);
  if (Number.isNaN(now.getTime()) || typeof timeZone !== 'string'
    || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(localTime)) fail('AGENT_BLOG_SCHEDULE_INPUT_INVALID');
  try { new Intl.DateTimeFormat('en', { timeZone }).format(now); }
  catch { fail('AGENT_BLOG_SCHEDULE_TIMEZONE_INVALID'); }
  const [hour, minute] = localTime.split(':').map(Number), current = parts(now, timeZone);
  let calendar = { year: current.year, month: current.month, day: current.day, hour, minute };
  let candidate = localInstant(calendar, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day + 1));
    calendar = { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(), hour, minute };
    candidate = localInstant(calendar, timeZone);
  }
  return candidate;
}

export function scheduleFireRequestId(scheduleId, logicalFireAt) {
  if (!UUID.test(scheduleId ?? '')) fail('AGENT_BLOG_SCHEDULE_ID_INVALID');
  const logical = new Date(logicalFireAt);
  if (Number.isNaN(logical.getTime())) fail('AGENT_BLOG_SCHEDULE_INPUT_INVALID');
  const bytes = Buffer.from(crypto.createHash('sha256')
    .update(`${scheduleId}\n${logical.toISOString()}`).digest('hex').slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const fireView = row => row ? ({
  id: row.id, scheduleId: row.schedule_id, agentUserId: row.agent_user_id,
  logicalFireAt: iso(row.logical_fire_at), requestId: row.request_id, status: row.status,
  attemptId: row.attempt_id, leaseUntil: iso(row.lease_until), result: row.result_json ?? {},
  errorCode: row.error_code, errorMessage: row.error_message,
  startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
}) : null;

export class PostgresAgentBlogPrivateScheduleRepository {
  constructor(pool, { clock = () => new Date() } = {}) {
    if (!pool) fail('AGENT_BLOG_SCHEDULE_DATABASE_REQUIRED');
    this.pool = pool;
    this.clock = clock;
  }

  async ensureDaily({ agentUserId, enabled }) {
    if (!UUID.test(agentUserId ?? '') || typeof enabled !== 'boolean') fail('AGENT_BLOG_SCHEDULE_INPUT_INVALID');
    const account = (await this.pool.query('SELECT operator_user_id FROM agent_accounts WHERE user_id=$1', [agentUserId])).rows[0];
    if (!account) fail('AGENT_BLOG_SCHEDULE_AGENT_NOT_FOUND');
    const nextFireAt = enabled ? nextAgentBlogPrivateDailyFire(this.clock()) : null;
    const row = (await this.pool.query(`INSERT INTO agent_schedules(id,agent_user_id,workflow_key,workflow_version,
        timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,misfire_policy,config_json,updated_by_user_id)
      VALUES($1,$2,$3,$4,'Asia/Shanghai',$5,$6,$7,NULL,'fire-once',$8,$9)
      ON CONFLICT(agent_user_id,workflow_key) DO UPDATE SET
        workflow_version=EXCLUDED.workflow_version,timezone=EXCLUDED.timezone,
        schedule_spec_json=EXCLUDED.schedule_spec_json,
        enabled=CASE WHEN agent_schedules.config_json ? 'suspendedAt' THEN false ELSE EXCLUDED.enabled END,
        next_fire_at=CASE WHEN agent_schedules.config_json ? 'suspendedAt' THEN NULL
          WHEN EXCLUDED.enabled THEN COALESCE(agent_schedules.next_fire_at,EXCLUDED.next_fire_at) ELSE NULL END,
        misfire_policy=EXCLUDED.misfire_policy,
        config_json=CASE WHEN agent_schedules.config_json ? 'suspendedAt'
          THEN agent_schedules.config_json ELSE EXCLUDED.config_json END,
        updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
      RETURNING *`, [crypto.randomUUID(), agentUserId, WORKFLOW_KEY, WORKFLOW_VERSION,
      JSON.stringify(SPEC), enabled, nextFireAt, JSON.stringify({ mode: 'private-shadow', publishEnabled: false }),
      account.operator_user_id])).rows[0];
    return { id: row.id, enabled: row.enabled, timezone: row.timezone, spec: row.schedule_spec_json,
      nextFireAt: iso(row.next_fire_at), lastFireAt: iso(row.last_fire_at) };
  }

  async claimDue({ leaseSeconds = 7200 } = {}) {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 14400) {
      fail('AGENT_BLOG_SCHEDULE_LEASE_INVALID');
    }
    return withTransaction(this.pool, async client => {
      await client.query(`UPDATE agent_schedule_fires SET status='uncertain',attempt_id=NULL,lease_until=NULL,
        error_code='AGENT_BLOG_SCHEDULE_LEASE_EXPIRED',error_message='计划执行进程在完成前失去租约；为避免重复外部调用，未自动重发。',
        finished_at=now(),updated_at=now() WHERE status='running' AND lease_until<now()`);
      const schedule = (await client.query(`SELECT * FROM agent_schedules WHERE enabled=true
        AND workflow_key=$1 AND next_fire_at<=now() ORDER BY next_fire_at,id
        FOR UPDATE SKIP LOCKED LIMIT 1`, [WORKFLOW_KEY])).rows[0];
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
      || !['succeeded','failed'].includes(status) || !result || typeof result !== 'object' || Array.isArray(result)) {
      fail('AGENT_BLOG_SCHEDULE_RESULT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`UPDATE agent_schedule_fires SET status=$3,attempt_id=NULL,lease_until=NULL,
          result_json=$4,error_code=$5,error_message=$6,finished_at=now(),updated_at=now()
        WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_until>now() RETURNING *`,
      [fireId, attemptId, status, JSON.stringify(result), errorCode, errorMessage?.slice?.(0,500) ?? null])).rows[0];
      if (!row) fail('AGENT_BLOG_SCHEDULE_LEASE_LOST');
      if (status === 'failed') await client.query(`UPDATE agent_schedules SET enabled=false,next_fire_at=NULL,
        config_json=config_json||jsonb_build_object('suspendedAt',now(),'suspendedByFireId',$2::text,
          'suspensionReason',COALESCE($3,'AGENT_BLOG_SCHEDULE_RUN_FAILED')),updated_at=now()
        WHERE id=$1`, [row.schedule_id, row.id, errorCode]);
      return fireView(row);
    });
  }
}

export function createAgentBlogPrivateScheduleController({ repository, acceptanceService, supervisor } = {}) {
  if (!repository || !acceptanceService || !supervisor
    || typeof repository.ensureDaily !== 'function' || typeof repository.claimDue !== 'function'
    || typeof repository.finish !== 'function' || typeof acceptanceService.readiness !== 'function'
    || typeof supervisor.run !== 'function') fail('AGENT_BLOG_SCHEDULE_DEPENDENCY_REQUIRED');
  return {
    async ensure({ agentUserId, enabled }) {
      const readiness = await acceptanceService.readiness(agentUserId);
      if (readiness.automaticScheduleChange !== false) fail('AGENT_BLOG_SCHEDULE_AUTHORITY_INVALID');
      if (enabled && !readiness.readyForShadowScheduleReview) {
        const schedule = await repository.ensureDaily({ agentUserId, enabled: false });
        return { enabled: false, blocked: true, reason: 'AGENT_BLOG_SCHEDULE_ACCEPTANCE_REQUIRED',
          readiness, schedule };
      }
      const schedule = await repository.ensureDaily({ agentUserId, enabled });
      return { enabled: schedule.enabled, blocked: false, readiness, schedule };
    },
    async runOnce() {
      const fire = await repository.claimDue();
      if (!fire) return { status: 'idle' };
      try {
        const supervised = await supervisor.run({ requestId: fire.requestId,
          triggerKind: 'schedule', triggerRef: `schedule:${fire.scheduleId}:${fire.logicalFireAt}` });
        const passed = supervised?.acceptance?.verdict === 'passed'
          && supervised?.publicationAttempted === false && supervised?.scheduleDecision === 'unchanged';
        const result = { draftRunId: supervised?.canary?.draft?.runId ?? null,
          articleId: supervised?.canary?.draft?.articleId ?? null,
          acceptanceVerdict: supervised?.acceptance?.verdict ?? null,
          publicationAttempted: supervised?.publicationAttempted ?? null };
        const finished = await repository.finish(fire.id, fire.attemptId, passed
          ? { status: 'succeeded', result }
          : { status: 'failed', result, errorCode: 'AGENT_BLOG_SCHEDULE_ACCEPTANCE_FAILED',
            errorMessage: '计划运行未通过私有影子验收，调度已自动停用。' });
        return { status: finished.status, fire: finished };
      } catch (error) {
        const finished = await repository.finish(fire.id, fire.attemptId, { status: 'failed',
          errorCode: String(error?.code || 'AGENT_BLOG_SCHEDULE_RUN_FAILED').slice(0,120),
          errorMessage: String(error?.message || '计划运行失败。').slice(0,500) });
        return { status: 'failed', fire: finished };
      }
    },
  };
}
