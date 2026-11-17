import {publicImmediateAdmission} from './agent-blog-public-admission.mjs';
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
  const maxHeartbeatAgeMs=Math.max(60000,scheduleConfig.pollMilliseconds*3);
  const admission=publicImmediateAdmission({schedule,configured:scheduleConfig.enabled,now,maxHeartbeatAgeMs});
  const scheduleBlockers=[...runtimeBlockers,...admission.blockers];
  const heartbeatAt=schedule?.worker?.heartbeatAt?new Date(schedule.worker.heartbeatAt):null;
  const heartbeatValid=heartbeatAt&&Number.isFinite(heartbeatAt.getTime());
  const heartbeatAgeMs=admission.heartbeatAgeMs,workerLive=admission.workerLive;
  const activationBlockers=runtimeBlockers.filter(code=>code!=='AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_REACHED');
  if(!scheduleConfig.enabled)activationBlockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_DISABLED');
  return Object.freeze({
    schemaVersion: 'agent-blog-public-operations-readiness-v1',
    agentUserId,
    manualRun: {
      // Legacy capability view, retained for installed clients that also use
      // this field to enable a paused plan. New clients use requestNow.
      ready: runtimeBlockers.length===0,
      blockers: [...runtimeBlockers],
      activation: 'external-explicit',
      automaticActivation: false,
    },
    requestNow: {ready:scheduleBlockers.length===0,blockers:[...scheduleBlockers],automaticActivation:false},
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
    activation: {ready:activationBlockers.length===0,blockers:activationBlockers},
    limits: structuredClone(runtimePreflight.limits),
    observed: structuredClone(runtimePreflight.observed),
  });
}
