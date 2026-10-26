const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u;

export class AgentBlogPrivateCanaryPreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogPrivateCanaryPreflightError';
    this.code = code;
  }
}

const fail = code => { throw new AgentBlogPrivateCanaryPreflightError(code); };
const integer = (value, min, max, code) => {
  value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
};
const bool = (value, key) => {
  if (value == null) return false;
  if (!['true', 'false'].includes(value)) fail(`${key}_INVALID`);
  return value === 'true';
};

export function loadAgentBlogPrivateCanaryConfig(env = process.env) {
  const enabled = bool(env.AGENT_BLOG_PRIVATE_CANARY_ENABLED, 'AGENT_BLOG_PRIVATE_CANARY_ENABLED');
  const publishEnabled = bool(env.AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED,
    'AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED');
  if (publishEnabled) fail('AGENT_BLOG_PRIVATE_CANARY_PUBLISH_FORBIDDEN');
  const agentUserId = env.AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID?.trim() || null;
  if (enabled && (!agentUserId || !UUID.test(agentUserId))) fail('AGENT_BLOG_PRIVATE_CANARY_AGENT_REQUIRED');
  const provider = env.AGENT_BLOG_PRIVATE_CANARY_PROVIDER?.trim() || 'deepseek';
  const modelId = env.AGENT_BLOG_PRIVATE_CANARY_MODEL_ID?.trim() || 'deepseek-flash';
  if (provider !== 'deepseek' || !MODEL.test(modelId)) fail('AGENT_BLOG_PRIVATE_CANARY_MODEL_INVALID');
  const dailyDiscoveryRunBaseLimit = integer(env.AGENT_BLOG_PRIVATE_CANARY_DAILY_RUN_LIMIT ?? 1,
    1, 4, 'AGENT_BLOG_PRIVATE_CANARY_DAILY_LIMIT_INVALID');
  const extraDailyRunAllowance = integer(env.AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_RUN_ALLOWANCE ?? 0,
    0, 2, 'AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_ALLOWANCE_INVALID');
  if (extraDailyRunAllowance > 0 && dailyDiscoveryRunBaseLimit !== 4) {
    fail('AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_ALLOWANCE_REQUIRES_MAX_BASE');
  }
  return Object.freeze({
    schemaVersion: 'agent-blog-private-canary-config-v1', enabled, publishEnabled: false,
    agentUserId, provider, modelId,
    dailyDiscoveryRunLimit: dailyDiscoveryRunBaseLimit + extraDailyRunAllowance,
    dailyDiscoveryRunBaseLimit, extraDailyRunAllowance,
    monthlyProviderCallLimit: integer(env.AGENT_BLOG_PRIVATE_CANARY_MONTHLY_PROVIDER_CALL_LIMIT ?? 12,
      1, 100, 'AGENT_BLOG_PRIVATE_CANARY_PROVIDER_LIMIT_INVALID'),
    monthlyCostMicrousdLimit: integer(env.AGENT_BLOG_PRIVATE_CANARY_MONTHLY_COST_MICROUSD_LIMIT ?? 1_000_000,
      1, 100_000_000, 'AGENT_BLOG_PRIVATE_CANARY_COST_LIMIT_INVALID'),
    consecutiveFailureLimit: integer(env.AGENT_BLOG_PRIVATE_CANARY_FAILURE_THRESHOLD ?? 2,
      1, 10, 'AGENT_BLOG_PRIVATE_CANARY_FAILURE_LIMIT_INVALID'),
  });
}

export function evaluateAgentBlogPrivateCanarySnapshot(config, snapshot) {
  if (!config || config.schemaVersion !== 'agent-blog-private-canary-config-v1'
    || config.publishEnabled !== false || !snapshot || typeof snapshot !== 'object') {
    fail('AGENT_BLOG_PRIVATE_CANARY_SNAPSHOT_INVALID');
  }
  const blockers = [];
  if (!config.enabled) blockers.push('AGENT_BLOG_PRIVATE_CANARY_DISABLED');
  if (!snapshot.identityReady) blockers.push('AGENT_BLOG_PRIVATE_CANARY_IDENTITY_NOT_READY');
  if (snapshot.capabilityCount !== 4) blockers.push('AGENT_BLOG_PRIVATE_CANARY_CAPABILITIES_NOT_READY');
  if (snapshot.toolCount !== 2) blockers.push('AGENT_BLOG_PRIVATE_CANARY_TOOLS_NOT_READY');
  if (snapshot.workflowCount !== 2) blockers.push('AGENT_BLOG_PRIVATE_CANARY_WORKFLOWS_NOT_READY');
  if (!snapshot.secretReady) blockers.push('AGENT_BLOG_PRIVATE_CANARY_SECRET_NOT_READY');
  if (!snapshot.modelReady) blockers.push('AGENT_BLOG_PRIVATE_CANARY_MODEL_NOT_READY');
  if (!snapshot.circuitReady) blockers.push('AGENT_BLOG_PRIVATE_CANARY_PROVIDER_CIRCUIT_OPEN');
  if (snapshot.activeRuns > 0) blockers.push('AGENT_BLOG_PRIVATE_CANARY_RUN_ACTIVE');
  if (snapshot.uncertainRuns > 0) blockers.push('AGENT_BLOG_PRIVATE_CANARY_UNCERTAIN');
  if (snapshot.awaitingHandoff > 0) blockers.push('AGENT_BLOG_PRIVATE_CANARY_AWAITING_HANDOFF');
  if (snapshot.discoveryRunsToday >= config.dailyDiscoveryRunLimit) {
    blockers.push('AGENT_BLOG_PRIVATE_CANARY_DAILY_LIMIT_REACHED');
  }
  if (snapshot.providerCallsMonth >= config.monthlyProviderCallLimit) {
    blockers.push('AGENT_BLOG_PRIVATE_CANARY_PROVIDER_LIMIT_REACHED');
  }
  if (snapshot.costMicrousdMonth >= config.monthlyCostMicrousdLimit) {
    blockers.push('AGENT_BLOG_PRIVATE_CANARY_COST_LIMIT_REACHED');
  }
  if (snapshot.consecutiveFailures >= config.consecutiveFailureLimit) {
    blockers.push('AGENT_BLOG_PRIVATE_CANARY_FAILURE_CIRCUIT_OPEN');
  }
  return {
    schemaVersion: 'agent-blog-private-canary-preflight-v1',
    ready: blockers.length === 0,
    blockers,
    limits: {
      dailyDiscoveryRuns: config.dailyDiscoveryRunLimit,
      dailyDiscoveryRunsBase: config.dailyDiscoveryRunBaseLimit ?? config.dailyDiscoveryRunLimit,
      temporaryExtraDailyRuns: config.extraDailyRunAllowance ?? 0,
      monthlyProviderCalls: config.monthlyProviderCallLimit,
      monthlyCostMicrousd: config.monthlyCostMicrousdLimit,
      consecutiveFailures: config.consecutiveFailureLimit,
    },
    observed: structuredClone(snapshot),
  };
}

export class PostgresAgentBlogPrivateCanaryPreflightRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_BLOG_PRIVATE_CANARY_DATABASE_REQUIRED');
    this.pool = pool;
  }

  async snapshot(config) {
    if (!config?.agentUserId || !UUID.test(config.agentUserId)) fail('AGENT_BLOG_PRIVATE_CANARY_AGENT_REQUIRED');
    const requiredCapabilities = ['blog.article.draft', 'provider.text.generate',
      'research.github.discover', 'research.github.read'];
    const row = (await this.pool.query(`SELECT
        EXISTS(SELECT 1 FROM agent_accounts account JOIN users user_account ON user_account.id=account.user_id
          JOIN agent_behavior_profile_assignments behavior ON behavior.agent_user_id=account.user_id
          JOIN agent_policy_profile_assignments policy ON policy.agent_user_id=account.user_id
          WHERE account.user_id=$1 AND account.status='active' AND user_account.status='active') AS identity_ready,
        (SELECT count(DISTINCT capability_key)::int FROM agent_capability_grants
          WHERE agent_user_id=$1 AND status='active' AND valid_from<=now()
            AND (valid_until IS NULL OR valid_until>now()) AND capability_key=ANY($2::text[])) AS capability_count,
        (SELECT count(*)::int FROM agent_tool_contracts WHERE status='active'
          AND (tool_key,contract_version) IN (
            ('research.github.repository.search',1),('research.github.repository.read',1))) AS tool_count,
        (SELECT count(*)::int FROM agent_workflow_definitions WHERE status='active'
          AND (workflow_key,workflow_version) IN (
            ('blog.project.discovery-shadow',3),('blog.project.single.draft-shadow',1))) AS workflow_count,
        EXISTS(SELECT 1 FROM agent_provider_secrets WHERE agent_user_id=$1 AND provider=$3) AS secret_ready,
        EXISTS(SELECT 1 FROM agent_provider_models WHERE provider=$3 AND model_id=$4 AND status='active'
          AND supports_json_schema=true AND 'structured-generation'=ANY(task_classes)) AS model_ready,
        NOT EXISTS(SELECT 1 FROM agent_provider_circuits WHERE provider=$3 AND model_id=$4 AND state<>'closed') AS circuit_ready,
        (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1
          AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single.draft-shadow')
          AND status IN ('queued','running','waiting')) AS active_runs,
        (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1
          AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single.draft-shadow')
          AND status='uncertain' AND created_at>=now()-interval '30 days') AS uncertain_runs,
        (SELECT count(*)::int FROM agent_runs source WHERE source.agent_user_id=$1
          AND source.workflow_key='blog.project.discovery-shadow' AND source.status='succeeded'
          AND NOT EXISTS(SELECT 1 FROM agent_run_handoffs handoff WHERE handoff.source_run_id=source.id)) AS awaiting_handoff,
        (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1
          AND workflow_key='blog.project.discovery-shadow'
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS discovery_runs_today,
        (SELECT COALESCE(sum(charged_provider_calls),0)::bigint FROM agent_budget_reservations
          WHERE agent_user_id=$1 AND period_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
            AND status IN ('settled','uncertain')) AS provider_calls_month,
        (SELECT COALESCE(sum(charged_cost_microusd),0)::bigint FROM agent_budget_reservations
          WHERE agent_user_id=$1 AND period_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
            AND status IN ('settled','uncertain')) AS cost_microusd_month`,
    [config.agentUserId, requiredCapabilities, config.provider, config.modelId])).rows[0];
    const recent = (await this.pool.query(`SELECT status FROM agent_runs WHERE agent_user_id=$1
      AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single.draft-shadow')
      AND status IN ('succeeded','failed','rejected','uncertain','cancelled')
      ORDER BY finished_at DESC,id DESC LIMIT $2`, [config.agentUserId, config.consecutiveFailureLimit])).rows;
    let consecutiveFailures = 0;
    for (const item of recent) {
      if (item.status === 'succeeded') break;
      if (['failed', 'rejected', 'uncertain'].includes(item.status)) consecutiveFailures += 1;
    }
    return {
      identityReady: row.identity_ready, capabilityCount: Number(row.capability_count),
      toolCount: Number(row.tool_count),
      workflowCount: Number(row.workflow_count), secretReady: row.secret_ready,
      modelReady: row.model_ready, circuitReady: row.circuit_ready,
      activeRuns: Number(row.active_runs), uncertainRuns: Number(row.uncertain_runs),
      awaitingHandoff: Number(row.awaiting_handoff), discoveryRunsToday: Number(row.discovery_runs_today),
      providerCallsMonth: Number(row.provider_calls_month), costMicrousdMonth: Number(row.cost_microusd_month),
      consecutiveFailures,
    };
  }
}

export async function runAgentBlogPrivateCanaryPreflight({ repository, config }) {
  if (!repository || typeof repository.snapshot !== 'function') fail('AGENT_BLOG_PRIVATE_CANARY_REPOSITORY_REQUIRED');
  return evaluateAgentBlogPrivateCanarySnapshot(config, await repository.snapshot(config));
}
