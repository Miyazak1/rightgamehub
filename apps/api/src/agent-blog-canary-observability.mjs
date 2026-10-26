export class AgentBlogCanaryObservabilityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogCanaryObservabilityError';
    this.code = code;
  }
}

const fail = code => { throw new AgentBlogCanaryObservabilityError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const number = value => Number(value ?? 0);

export function createAgentBlogCanaryObservabilityService({ pool, authorizeOperator } = {}) {
  if (!pool || typeof authorizeOperator !== 'function') fail('AGENT_BLOG_CANARY_OBSERVABILITY_PORT_REQUIRED');
  const scope = async (actor, agentUserId) => {
    if (typeof agentUserId !== 'string' || !UUID.test(agentUserId)
      || typeof actor?.userId !== 'string' || !UUID.test(actor.userId)) fail('AGENT_BLOG_CANARY_INPUT_INVALID');
    if (await authorizeOperator(structuredClone(actor)) !== true) fail('AGENT_BLOG_CANARY_OPERATOR_REQUIRED');
    const row = (await pool.query(`SELECT user_id FROM agent_accounts
      WHERE user_id=$1 AND operator_user_id=$2`, [agentUserId, actor?.userId])).rows[0];
    if (!row) fail('AGENT_BLOG_CANARY_NOT_FOUND');
    return row.user_id;
  };
  return {
    async summary(actor, agentUserId, { windowHours = 168 } = {}) {
      agentUserId = await scope(actor, agentUserId);
      if (!Number.isSafeInteger(windowHours) || windowHours < 1 || windowHours > 24 * 90) {
        fail('AGENT_BLOG_CANARY_INPUT_INVALID');
      }
      const row = (await pool.query(`WITH discovery AS (
          SELECT * FROM agent_runs WHERE agent_user_id=$1
            AND workflow_key='blog.project.discovery-shadow'
            AND created_at>=now()-($2*interval '1 hour')
        ), handoffs AS (
          SELECT handoff.* FROM agent_run_handoffs handoff JOIN discovery source ON source.id=handoff.source_run_id
          WHERE handoff.handoff_kind='blog.candidate-set-to-private-draft'
        ), drafts AS (
          SELECT run.* FROM agent_runs run JOIN handoffs handoff ON handoff.target_run_id=run.id
        ), graph_runs AS (
          SELECT id FROM discovery UNION SELECT id FROM drafts
        ), provider_usage AS (
          SELECT count(*)::int AS calls,
            COALESCE(sum((call.usage_json->>'inputTokens')::bigint),0)::bigint AS input_tokens,
            COALESCE(sum((call.usage_json->>'outputTokens')::bigint),0)::bigint AS output_tokens,
            COALESCE(sum((call.usage_json->>'costMicrousd')::bigint),0)::bigint AS cost_microusd
          FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id IN (SELECT id FROM graph_runs) AND call.status='succeeded'
        ), tool_usage AS (
          SELECT count(*)::int AS calls FROM agent_tool_calls call
          JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id IN (SELECT id FROM graph_runs) AND call.status='succeeded'
        ) SELECT
          (SELECT count(*)::int FROM discovery) AS discovery_total,
          (SELECT count(*)::int FROM discovery WHERE status='succeeded') AS discovery_succeeded,
          (SELECT count(*)::int FROM discovery WHERE status IN ('failed','rejected','uncertain')) AS discovery_failed,
          (SELECT count(*)::int FROM discovery WHERE status IN ('queued','running','waiting')) AS discovery_active,
          (SELECT count(*)::int FROM discovery source WHERE source.status='succeeded'
            AND NOT EXISTS(SELECT 1 FROM handoffs handoff WHERE handoff.source_run_id=source.id)) AS discovery_unhanded,
          (SELECT count(*)::int FROM handoffs) AS handoff_total,
          (SELECT count(*)::int FROM drafts) AS draft_total,
          (SELECT count(*)::int FROM drafts WHERE status='succeeded' AND output_type='blog.private-draft') AS draft_succeeded,
          (SELECT count(*)::int FROM drafts WHERE status IN ('failed','rejected','uncertain')) AS draft_failed,
          (SELECT count(*)::int FROM drafts WHERE status IN ('queued','running','waiting')) AS draft_active,
          (SELECT calls FROM provider_usage) AS provider_calls,
          (SELECT input_tokens FROM provider_usage) AS input_tokens,
          (SELECT output_tokens FROM provider_usage) AS output_tokens,
          (SELECT cost_microusd FROM provider_usage) AS cost_microusd,
          (SELECT calls FROM tool_usage) AS tool_calls`, [agentUserId, windowHours])).rows[0];
      return {
        schemaVersion: 'agent-blog-private-canary-summary-v1',
        windowHours,
        discovery: { total: number(row.discovery_total), succeeded: number(row.discovery_succeeded),
          failed: number(row.discovery_failed), active: number(row.discovery_active),
          awaitingHandoff: number(row.discovery_unhanded) },
        handoffs: { total: number(row.handoff_total) },
        drafts: { total: number(row.draft_total), succeeded: number(row.draft_succeeded),
          failed: number(row.draft_failed), active: number(row.draft_active) },
        usage: { providerCalls: number(row.provider_calls), toolCalls: number(row.tool_calls),
          inputTokens: number(row.input_tokens), outputTokens: number(row.output_tokens),
          costMicrousd: number(row.cost_microusd) },
      };
    },
  };
}
