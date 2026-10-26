const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u;

export class AgentBlogPublicRuntimePreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogPublicRuntimePreflightError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogPublicRuntimePreflightError(code); };
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

export function loadAgentBlogPublicRuntimeConfig(env = process.env) {
  const enabled = bool(env.AGENT_BLOG_PUBLIC_RUNTIME_ENABLED, 'AGENT_BLOG_PUBLIC_RUNTIME_ENABLED');
  const agentUserId = env.AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID?.trim() || null;
  if (enabled && (!agentUserId || !UUID.test(agentUserId))) fail('AGENT_BLOG_PUBLIC_RUNTIME_AGENT_REQUIRED');
  const provider = env.AGENT_BLOG_PUBLIC_RUNTIME_PROVIDER?.trim() || 'deepseek';
  const modelId = env.AGENT_BLOG_PUBLIC_RUNTIME_MODEL_ID?.trim() || 'deepseek-flash';
  if (provider !== 'deepseek' || !MODEL.test(modelId)) fail('AGENT_BLOG_PUBLIC_RUNTIME_MODEL_INVALID');
  return Object.freeze({
    schemaVersion: 'agent-blog-public-runtime-config-v1', enabled, agentUserId, provider, modelId,
    dailyPublicationRunLimit: integer(env.AGENT_BLOG_PUBLIC_RUNTIME_DAILY_RUN_LIMIT ?? 1,
      1, 4, 'AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_INVALID'),
    monthlyProviderCallLimit: integer(env.AGENT_BLOG_PUBLIC_RUNTIME_MONTHLY_PROVIDER_CALL_LIMIT ?? 120,
      1, 1000, 'AGENT_BLOG_PUBLIC_RUNTIME_PROVIDER_LIMIT_INVALID'),
    monthlyCostMicrousdLimit: integer(env.AGENT_BLOG_PUBLIC_RUNTIME_MONTHLY_COST_MICROUSD_LIMIT ?? 10_000_000,
      1, 1_000_000_000, 'AGENT_BLOG_PUBLIC_RUNTIME_COST_LIMIT_INVALID'),
    consecutiveFailureLimit: integer(env.AGENT_BLOG_PUBLIC_RUNTIME_FAILURE_THRESHOLD ?? 2,
      1, 10, 'AGENT_BLOG_PUBLIC_RUNTIME_FAILURE_LIMIT_INVALID'),
  });
}

export function evaluateAgentBlogPublicRuntimeSnapshot(config, snapshot) {
  if (!config || config.schemaVersion !== 'agent-blog-public-runtime-config-v1'
    || !snapshot || typeof snapshot !== 'object') fail('AGENT_BLOG_PUBLIC_RUNTIME_SNAPSHOT_INVALID');
  const blockers = [];
  if (!config.enabled) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_DISABLED');
  if (snapshot.activePublisher !== 'foundation') blockers.push('AGENT_BLOG_PUBLICATION_OWNER_NOT_FOUNDATION');
  if (snapshot.legacyAutomationEnabled) blockers.push('AGENT_BLOG_LEGACY_AUTOMATION_STILL_ENABLED');
  if (!snapshot.identityReady) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_IDENTITY_NOT_READY');
  if (snapshot.capabilityCount !== 5) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_CAPABILITIES_NOT_READY');
  if (snapshot.toolCount !== 2) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_TOOLS_NOT_READY');
  if (snapshot.workflowCount !== 2) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_WORKFLOWS_NOT_READY');
  if (!snapshot.secretReady) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_SECRET_NOT_READY');
  if (!snapshot.modelReady) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_MODEL_NOT_READY');
  if (!snapshot.circuitReady) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_PROVIDER_CIRCUIT_OPEN');
  if (snapshot.activeRuns > 0) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_RUN_ACTIVE');
  if (snapshot.uncertainRuns > 0) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_UNCERTAIN');
  if (snapshot.awaitingHandoff > 0) blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_AWAITING_HANDOFF');
  if (snapshot.publicationRunsToday >= config.dailyPublicationRunLimit) {
    blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_REACHED');
  }
  if (snapshot.providerCallsMonth >= config.monthlyProviderCallLimit) {
    blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_PROVIDER_LIMIT_REACHED');
  }
  if (snapshot.costMicrousdMonth >= config.monthlyCostMicrousdLimit) {
    blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_COST_LIMIT_REACHED');
  }
  if (snapshot.consecutiveFailures >= config.consecutiveFailureLimit) {
    blockers.push('AGENT_BLOG_PUBLIC_RUNTIME_FAILURE_CIRCUIT_OPEN');
  }
  return Object.freeze({
    schemaVersion: 'agent-blog-public-runtime-preflight-v1', ready: blockers.length === 0,
    blockers, limits: {
      dailyPublicationRuns: config.dailyPublicationRunLimit,
      monthlyProviderCalls: config.monthlyProviderCallLimit,
      monthlyCostMicrousd: config.monthlyCostMicrousdLimit,
      consecutiveFailures: config.consecutiveFailureLimit,
    },
    observed: structuredClone(snapshot),
  });
}

export class PostgresAgentBlogPublicRuntimePreflightRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_BLOG_PUBLIC_RUNTIME_DATABASE_REQUIRED');
    this.pool = pool;
  }

  async snapshot(config) {
    if (!UUID.test(config?.agentUserId ?? '')) fail('AGENT_BLOG_PUBLIC_RUNTIME_AGENT_REQUIRED');
    const requiredCapabilities = ['blog.article.draft', 'blog.article.publish',
      'provider.text.generate', 'research.github.discover', 'research.github.read'];
    const row = (await this.pool.query(`SELECT
        owner.active_publisher,
        COALESCE(settings.enabled,false) AS legacy_automation_enabled,
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
            ('blog.project.discovery-shadow',3),('blog.project.single',1))) AS workflow_count,
        EXISTS(SELECT 1 FROM agent_provider_secrets WHERE agent_user_id=$1 AND provider=$3) AS secret_ready,
        EXISTS(SELECT 1 FROM agent_provider_models WHERE provider=$3 AND model_id=$4 AND status='active'
          AND supports_json_schema=true AND 'structured-generation'=ANY(task_classes)) AS model_ready,
        NOT EXISTS(SELECT 1 FROM agent_provider_circuits WHERE provider=$3 AND model_id=$4 AND state<>'closed') AS circuit_ready,
        (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1
          AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single')
          AND status IN ('queued','running','waiting')) AS active_runs,
        (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1
          AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single')
          AND status='uncertain' AND created_at>=now()-interval '30 days') AS uncertain_runs,
        (SELECT count(*)::int FROM agent_runs source WHERE source.agent_user_id=$1
          AND source.workflow_key='blog.project.discovery-shadow' AND source.status='succeeded'
          AND NOT EXISTS(SELECT 1 FROM agent_run_handoffs handoff WHERE handoff.source_run_id=source.id)) AS awaiting_handoff,
        (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1
          AND workflow_key='blog.project.single'
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS publication_runs_today,
        (SELECT COALESCE(sum(charged_provider_calls),0)::bigint FROM agent_budget_reservations
          WHERE agent_user_id=$1 AND period_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
            AND status IN ('settled','uncertain')) AS provider_calls_month,
        (SELECT COALESCE(sum(charged_cost_microusd),0)::bigint FROM agent_budget_reservations
          WHERE agent_user_id=$1 AND period_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
            AND status IN ('settled','uncertain')) AS cost_microusd_month
      FROM agent_blog_publication_owners owner
      LEFT JOIN agent_blog_automation_settings settings ON settings.agent_user_id=owner.agent_user_id
      WHERE owner.agent_user_id=$1`,
    [config.agentUserId, requiredCapabilities, config.provider, config.modelId])).rows[0];
    if (!row) fail('AGENT_BLOG_PUBLIC_RUNTIME_OWNER_MISSING');
    const recent = (await this.pool.query(`SELECT status FROM agent_runs WHERE agent_user_id=$1
      AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single')
      AND status IN ('succeeded','failed','rejected','uncertain','cancelled')
      ORDER BY finished_at DESC,id DESC LIMIT $2`, [config.agentUserId, config.consecutiveFailureLimit])).rows;
    let consecutiveFailures = 0;
    for (const item of recent) {
      if (item.status === 'succeeded') break;
      if (['failed', 'rejected', 'uncertain'].includes(item.status)) consecutiveFailures += 1;
    }
    return {
      activePublisher: row.active_publisher, legacyAutomationEnabled: row.legacy_automation_enabled,
      identityReady: row.identity_ready, capabilityCount: Number(row.capability_count),
      toolCount: Number(row.tool_count), workflowCount: Number(row.workflow_count),
      secretReady: row.secret_ready, modelReady: row.model_ready, circuitReady: row.circuit_ready,
      activeRuns: Number(row.active_runs), uncertainRuns: Number(row.uncertain_runs),
      awaitingHandoff: Number(row.awaiting_handoff), publicationRunsToday: Number(row.publication_runs_today),
      providerCallsMonth: Number(row.provider_calls_month), costMicrousdMonth: Number(row.cost_microusd_month),
      consecutiveFailures,
    };
  }
}

export async function runAgentBlogPublicRuntimePreflight({ repository, config }) {
  if (!repository || typeof repository.snapshot !== 'function') {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_REPOSITORY_REQUIRED');
  }
  return evaluateAgentBlogPublicRuntimeSnapshot(config, await repository.snapshot(config));
}
