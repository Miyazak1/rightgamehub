import { AgentAccountError } from './agent-account-repository.mjs';
import { AgentBlogPublicScheduleError } from './agent-blog-public-schedule.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fail = (code, details = {}) => {
  const error = new AgentAccountError(code);
  error.details = details;
  throw error;
};
const scheduleBlockers = Object.freeze({
  AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED: ['AGENT_PUBLIC_SCHEDULE_NOT_ENABLED',
    '公开计划尚未启用或已暂停，请先恢复每天 10 点计划，再立即运行。', 409],
  AGENT_BLOG_PUBLIC_SCHEDULER_HEARTBEAT_STALE: ['AGENT_PUBLIC_SCHEDULER_UNAVAILABLE',
    '公开调度执行器心跳已过期，请检查服务并刷新状态后重试。', 503],
  AGENT_BLOG_PUBLIC_SCHEDULE_FIRE_ACTIVE: ['AGENT_PUBLIC_RUN_ACTIVE',
    '已有公开任务正在运行，请等待完成后刷新状态。', 409],
  AGENT_BLOG_PUBLIC_SCHEDULE_FOUNDATION_OWNER_REQUIRED: ['AGENT_PUBLIC_PUBLISHER_REQUIRED',
    '公开发布权尚未交给新基座，请先检查发布归属。', 409],
});
const scheduledOperation = async action => {
  try { return await action(); }
  catch (error) {
    const blocker = error instanceof AgentBlogPublicScheduleError && Object.hasOwn(scheduleBlockers,error.code) && scheduleBlockers[error.code];
    if (!blocker) throw error;
    const mapped = new AgentAccountError(blocker[0]);
    mapped.message = blocker[1];
    mapped.statusCode = blocker[2];
    throw mapped;
  }
};

export function createAgentBlogPublicOperationsService({ pool, authorizeOperator, controller,
  runtimeConfig, scheduleConfig } = {}) {
  if (!pool || typeof authorizeOperator !== 'function' || !controller || !runtimeConfig || !scheduleConfig) {
    fail('AGENT_OPERATOR_PORT_REQUIRED');
  }
  const scope = async (actor, agentUserId) => {
    if (!UUID.test(actor?.userId ?? '') || !UUID.test(agentUserId ?? '')
      || await authorizeOperator(structuredClone(actor)) !== true) fail('AGENT_OPERATOR_REQUIRED');
    const row = (await pool.query(`SELECT user_id FROM agent_accounts
      WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`,
    [agentUserId, actor.userId])).rows[0];
    if (!row) fail('AGENT_NOT_FOUND');
    if (!runtimeConfig.enabled || runtimeConfig.agentUserId !== agentUserId) {
      fail('AGENT_PUBLIC_RUNTIME_DISABLED');
    }
    return row.user_id;
  };
  const checked = result => {
    if (result?.blocked) fail('AGENT_PUBLIC_OPERATION_BLOCKED', { blockers: result.blockers ?? [] });
    return result;
  };
  return Object.freeze({
    async setSchedule(actor, agentUserId, { enabled }) {
      agentUserId = await scope(actor, agentUserId);
      if (typeof enabled !== 'boolean') fail('AGENT_INPUT');
      if (enabled && !scheduleConfig.enabled) fail('AGENT_PUBLIC_SCHEDULE_DISABLED');
      return checked(await scheduledOperation(() => controller.ensure({ agentUserId, enabled, resume: enabled })));
    },
    async runNow(actor, agentUserId) {
      agentUserId = await scope(actor, agentUserId);
      if (!scheduleConfig.enabled) fail('AGENT_PUBLIC_SCHEDULE_DISABLED');
      return checked(await scheduledOperation(() => controller.requestNow({ agentUserId,
        maxHeartbeatAgeMs: Math.max(60000, scheduleConfig.pollMilliseconds * 3) })));
    },
  });
}
