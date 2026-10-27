import { AgentAccountError } from './agent-account-repository.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fail = (code, details = {}) => {
  const error = new AgentAccountError(code);
  error.details = details;
  throw error;
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
      return checked(await controller.ensure({ agentUserId, enabled, resume: enabled }));
    },
    async runNow(actor, agentUserId) {
      agentUserId = await scope(actor, agentUserId);
      if (!scheduleConfig.enabled) fail('AGENT_PUBLIC_SCHEDULE_DISABLED');
      return checked(await controller.requestNow({ agentUserId,
        maxHeartbeatAgeMs: Math.max(60000, scheduleConfig.pollMilliseconds * 3) }));
    },
  });
}
