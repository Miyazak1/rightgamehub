const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentBlogPublicOperationsReadinessError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogPublicOperationsReadinessError';
    this.code = code;
  }
}

const fail = code => { throw new AgentBlogPublicOperationsReadinessError(code); };
const iso = value => value?.toISOString?.() ?? value ?? null;

export function evaluateAgentBlogPublicOperationsReadiness({
  agentUserId, runtimeConfig, scheduleConfig, runtimePreflight, schedule, now = new Date(),
} = {}) {
  if (!UUID.test(agentUserId ?? '')
    || runtimeConfig?.schemaVersion !== 'agent-blog-public-runtime-config-v1'
    || scheduleConfig?.schemaVersion !== 'agent-blog-public-schedule-config-v1'
    || runtimePreflight?.schemaVersion !== 'agent-blog-public-runtime-preflight-v1') {
    fail('AGENT_BLOG_PUBLIC_OPERATIONS_INPUT_INVALID');
  }
  const runtimeBlockers = [...runtimePreflight.blockers];
  if (runtimeConfig.agentUserId && runtimeConfig.agentUserId !== agentUserId) {
    runtimeBlockers.push('AGENT_BLOG_PUBLIC_RUNTIME_AGENT_MISMATCH');
  }
  const manualRunReady = runtimeBlockers.length === 0;
  const scheduleBlockers = [...runtimeBlockers];
  if (!scheduleConfig.enabled) scheduleBlockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_DISABLED');
  if (!schedule) scheduleBlockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_MISSING');
  if (schedule && schedule.mode !== 'foundation-public') {
    scheduleBlockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_MODE_INVALID');
  }
  if (schedule && !schedule.enabled) scheduleBlockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED');
  const heartbeatAt = schedule?.worker?.heartbeatAt ? new Date(schedule.worker.heartbeatAt) : null;
  const maxHeartbeatAgeMs = Math.max(60_000, scheduleConfig.pollMilliseconds * 3);
  const heartbeatValid = heartbeatAt && Number.isFinite(heartbeatAt.getTime());
  const heartbeatAgeMs = heartbeatValid
    ? Math.max(0, now.getTime() - heartbeatAt.getTime()) : null;
  const workerLive = schedule?.worker?.state !== 'stopped'
    && heartbeatAgeMs != null && heartbeatAgeMs <= maxHeartbeatAgeMs;
  if (schedule?.enabled && schedule?.mode === 'foundation-public' && !workerLive) {
    scheduleBlockers.push('AGENT_BLOG_PUBLIC_SCHEDULER_HEARTBEAT_STALE');
  }
  return Object.freeze({
    schemaVersion: 'agent-blog-public-operations-readiness-v1',
    agentUserId,
    manualRun: {
      ready: manualRunReady,
      blockers: runtimeBlockers,
      activation: 'external-explicit',
      automaticActivation: false,
    },
    scheduler: {
      ready: scheduleBlockers.length === 0,
      blockers: scheduleBlockers,
      configured: scheduleConfig.enabled,
      workerLive,
      workerState: schedule?.worker?.state ?? null,
      workerInstanceId: schedule?.worker?.instanceId ?? null,
      heartbeatAt: heartbeatValid ? iso(heartbeatAt) : null,
      heartbeatAgeMs,
      maxHeartbeatAgeMs,
      timezone: scheduleConfig.timezone,
      localTime: scheduleConfig.localTime,
      automaticActivation: false,
    },
    limits: structuredClone(runtimePreflight.limits),
    observed: structuredClone(runtimePreflight.observed),
  });
}
