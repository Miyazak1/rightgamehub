import { withTransaction } from './database.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const AGENT_BLOG_PUBLICATION_CUTOVER_POLICY = Object.freeze({
  schemaVersion: 'agent-blog-publication-cutover-policy-v2',
  policyVersion: 2,
  requiredAcceptancePasses: 1,
  requiredScheduledPasses: 0,
  targetWorkflowKey: 'blog.project.single',
  targetWorkflowVersion: 1,
  acceptancePolicyVersion: 2,
});

export class AgentBlogPublicationOwnershipError extends Error {
  constructor(code, statusCode = 409, message = code, details = {}) {
    super(message);
    this.name = 'AgentBlogPublicationOwnershipError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = false;
    this.details = details;
  }
}

const fail = (code, statusCode, message) => {
  throw new AgentBlogPublicationOwnershipError(code, statusCode, message);
};

const integer = value => Number(value ?? 0);

function validatePolicy(policy) {
  if (!policy || policy.schemaVersion !== 'agent-blog-publication-cutover-policy-v2'
    || policy.policyVersion !== 2
    || !Number.isSafeInteger(policy.requiredAcceptancePasses) || policy.requiredAcceptancePasses < 1
    || !Number.isSafeInteger(policy.requiredScheduledPasses) || policy.requiredScheduledPasses < 0
    || policy.targetWorkflowKey !== 'blog.project.single'
    || !Number.isSafeInteger(policy.targetWorkflowVersion)
    || !Number.isSafeInteger(policy.acceptancePolicyVersion)) {
    fail('AGENT_BLOG_PUBLICATION_CUTOVER_POLICY_INVALID', 500, '发布链路切换策略无效。');
  }
  return structuredClone(policy);
}

export function evaluateAgentBlogPublicationCutover(snapshot,
  policy = AGENT_BLOG_PUBLICATION_CUTOVER_POLICY) {
  policy = validatePolicy(policy);
  if (!snapshot || snapshot.schemaVersion !== 'agent-blog-publication-cutover-snapshot-v1'
    || !UUID.test(snapshot.agentUserId ?? '') || !snapshot.owner || !snapshot.execution
    || !snapshot.foundation || !snapshot.acceptance || !snapshot.privateSchedule) {
    fail('AGENT_BLOG_PUBLICATION_CUTOVER_SNAPSHOT_INVALID', 500, '发布链路切换快照无效。');
  }
  const blockers = [];
  if (snapshot.owner.activePublisher !== 'legacy') blockers.push('PUBLICATION_OWNER_NOT_LEGACY');
  if (integer(snapshot.execution.legacyActiveRuns) > 0) blockers.push('LEGACY_RUN_ACTIVE');
  if (integer(snapshot.execution.foundationActiveRuns) > 0) blockers.push('FOUNDATION_RUN_ACTIVE');
  if (integer(snapshot.execution.foundationUncertainRuns) > 0) blockers.push('FOUNDATION_RUN_UNCERTAIN');
  if (snapshot.foundation.workflowStatus !== 'active') blockers.push('FOUNDATION_PUBLIC_WORKFLOW_NOT_ACTIVE');
  if (!snapshot.foundation.publishCapabilityActive) blockers.push('FOUNDATION_PUBLISH_CAPABILITY_MISSING');
  if (!snapshot.foundation.autoPublishPolicyEnabled) blockers.push('FOUNDATION_AUTO_PUBLISH_POLICY_DISABLED');
  if (integer(snapshot.acceptance.consecutivePasses) < policy.requiredAcceptancePasses) {
    blockers.push('PRIVATE_ACCEPTANCE_INCOMPLETE');
  }
  if (policy.requiredScheduledPasses > 0
    && integer(snapshot.privateSchedule.consecutivePasses) < policy.requiredScheduledPasses) {
    blockers.push('PRIVATE_SCHEDULE_EVIDENCE_INCOMPLETE');
  }
  return {
    schemaVersion: 'agent-blog-publication-cutover-preflight-v1',
    policyVersion: policy.policyVersion,
    ready: blockers.length === 0,
    blockers,
    owner: structuredClone(snapshot.owner),
    evidence: {
      legacyActiveRuns: integer(snapshot.execution.legacyActiveRuns),
      foundationActiveRuns: integer(snapshot.execution.foundationActiveRuns),
      foundationUncertainRuns: integer(snapshot.execution.foundationUncertainRuns),
      acceptanceConsecutivePasses: integer(snapshot.acceptance.consecutivePasses),
      requiredAcceptancePasses: policy.requiredAcceptancePasses,
      scheduledConsecutivePasses: integer(snapshot.privateSchedule.consecutivePasses),
      requiredScheduledPasses: policy.requiredScheduledPasses,
      targetWorkflow: {
        key: policy.targetWorkflowKey,
        version: policy.targetWorkflowVersion,
        status: snapshot.foundation.workflowStatus,
      },
    },
    automaticSwitch: false,
  };
}

function ownerView(row) {
  return {
    activePublisher: row.active_publisher,
    generation: integer(row.generation),
    reason: row.reason,
    switchedAt: row.switched_at?.toISOString?.() ?? row.switched_at,
  };
}

export class PostgresAgentBlogPublicationOwnershipRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_BLOG_PUBLICATION_DATABASE_REQUIRED', 500, '发布权数据库不可用。');
    this.pool = pool;
  }

  async assertPublisher(client, agentUserId, expectedPublisher) {
    if (!UUID.test(agentUserId ?? '') || !['legacy', 'foundation'].includes(expectedPublisher)) {
      fail('AGENT_BLOG_PUBLICATION_OWNER_INPUT_INVALID', 400, '发布权校验参数无效。');
    }
    const row = (await client.query(`SELECT active_publisher,generation,reason,switched_at
      FROM agent_blog_publication_owners WHERE agent_user_id=$1 FOR UPDATE`, [agentUserId])).rows[0];
    if (!row) fail('AGENT_BLOG_PUBLICATION_OWNER_MISSING', 503, '机器人发布权尚未初始化。');
    if (row.active_publisher !== expectedPublisher) {
      fail('AGENT_BLOG_PUBLICATION_OWNER_MISMATCH', 409, '当前发布链路已切换，本次发布已安全终止。');
    }
    return ownerView(row);
  }

  async snapshot(agentUserId, policy = AGENT_BLOG_PUBLICATION_CUTOVER_POLICY) {
    policy = validatePolicy(policy);
    if (!UUID.test(agentUserId ?? '')) {
      fail('AGENT_BLOG_PUBLICATION_OWNER_INPUT_INVALID', 400, '机器人发布权校验参数无效。');
    }
    return this.#snapshot(this.pool, agentUserId, policy);
  }

  async #snapshot(executor, agentUserId, policy) {
    const [ownerResult, executionResult, workflowResult, capabilityResult, policyResult,
      acceptanceResult, scheduleResult] = await Promise.all([
      executor.query(`SELECT active_publisher,generation,reason,switched_at
        FROM agent_blog_publication_owners WHERE agent_user_id=$1`, [agentUserId]),
      executor.query(`SELECT
          (SELECT count(*)::int FROM agent_blog_runs
            WHERE agent_user_id=$1 AND status IN ('queued','generating','checking')) AS legacy_active_runs,
          count(*) FILTER (WHERE status IN ('queued','running','waiting'))::int AS foundation_active_runs,
          count(*) FILTER (WHERE status='uncertain')::int AS foundation_uncertain_runs
        FROM agent_runs WHERE agent_user_id=$1`, [agentUserId]),
      executor.query(`SELECT status FROM agent_workflow_definitions
        WHERE workflow_key=$1 AND workflow_version=$2`,
      [policy.targetWorkflowKey, policy.targetWorkflowVersion]),
      executor.query(`SELECT 1 FROM agent_capability_grants
        WHERE agent_user_id=$1 AND capability_key='blog.article.publish' AND contract_version=1
          AND status='active' AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now()) LIMIT 1`,
      [agentUserId]),
      executor.query(`SELECT profile.policy_json->>'autoPublish' AS auto_publish
        FROM agent_policy_profile_assignments assignment
        JOIN agent_policy_profiles profile ON profile.agent_user_id=assignment.agent_user_id
          AND profile.id=assignment.active_policy_profile_id
        WHERE assignment.agent_user_id=$1`, [agentUserId]),
      executor.query(`SELECT verdict FROM agent_blog_canary_acceptance_reports
        WHERE agent_user_id=$1 AND policy_version=$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
      [agentUserId, policy.acceptancePolicyVersion, policy.requiredAcceptancePasses]),
      executor.query(`SELECT fire.status FROM agent_schedule_fires fire
        JOIN agent_schedules schedule ON schedule.id=fire.schedule_id AND schedule.agent_user_id=fire.agent_user_id
        WHERE fire.agent_user_id=$1 AND schedule.workflow_key='blog.project.discovery-shadow'
          AND schedule.config_json->>'mode'='private-shadow'
        ORDER BY fire.logical_fire_at DESC,fire.id DESC LIMIT $2`,
      [agentUserId, policy.requiredScheduledPasses]),
    ]);
    const owner = ownerResult.rows[0];
    if (!owner) fail('AGENT_BLOG_PUBLICATION_OWNER_MISSING', 503, '机器人发布权尚未初始化。');
    const consecutive = rows => {
      let count = 0;
      for (const row of rows) {
        const outcome = row.verdict ?? row.status;
        if (!['passed', 'succeeded'].includes(outcome)) break;
        count += 1;
      }
      return count;
    };
    return {
      schemaVersion: 'agent-blog-publication-cutover-snapshot-v1', agentUserId,
      owner: ownerView(owner),
      execution: {
        legacyActiveRuns: integer(executionResult.rows[0]?.legacy_active_runs),
        foundationActiveRuns: integer(executionResult.rows[0]?.foundation_active_runs),
        foundationUncertainRuns: integer(executionResult.rows[0]?.foundation_uncertain_runs),
      },
      foundation: {
        workflowStatus: workflowResult.rows[0]?.status ?? null,
        publishCapabilityActive: capabilityResult.rows.length > 0,
        autoPublishPolicyEnabled: policyResult.rows[0]?.auto_publish === 'true',
      },
      acceptance: { consecutivePasses: consecutive(acceptanceResult.rows) },
      privateSchedule: { consecutivePasses: consecutive(scheduleResult.rows) },
    };
  }

  async cutover({ agentUserId, actorUserId, expectedGeneration, reason }, policy) {
    policy = validatePolicy(policy);
    if (!UUID.test(agentUserId ?? '') || !UUID.test(actorUserId ?? '')
      || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1
      || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500) {
      fail('AGENT_BLOG_PUBLICATION_CUTOVER_INPUT_INVALID', 400, '发布链路切换参数无效。');
    }
    return withTransaction(this.pool, async client => {
      const managed = (await client.query(`SELECT account.user_id FROM agent_accounts account
        JOIN users operator ON operator.id=account.operator_user_id
        WHERE account.user_id=$1 AND account.operator_user_id=$2
          AND operator.account_type='human' AND operator.status='active' AND operator.role='admin'
        FOR SHARE OF account,operator`, [agentUserId, actorUserId])).rows[0];
      if (!managed) fail('AGENT_NOT_FOUND', 404, '机器人不存在或不由当前管理员运营。');
      await client.query(`SELECT agent_user_id FROM agent_blog_automation_settings
        WHERE agent_user_id=$1 FOR UPDATE`, [agentUserId]);
      const owner = await this.assertPublisher(client, agentUserId, 'legacy');
      if (owner.generation !== expectedGeneration) {
        fail('AGENT_BLOG_PUBLICATION_GENERATION_MISMATCH', 409, '发布权版本已经变化，请重新预检。');
      }
      const preflight = evaluateAgentBlogPublicationCutover(
        await this.#snapshot(client, agentUserId, policy), policy);
      if (!preflight.ready) {
        throw new AgentBlogPublicationOwnershipError('AGENT_BLOG_PUBLICATION_CUTOVER_BLOCKED',
          409, '发布链路尚未满足切换条件。', { blockers: preflight.blockers });
      }
      await client.query(`UPDATE agent_blog_automation_settings SET enabled=false,next_run_at=NULL,
        updated_by_user_id=$2,updated_at=clock_timestamp() WHERE agent_user_id=$1`,
      [agentUserId, actorUserId]);
      await client.query(`UPDATE agent_schedules SET enabled=false,next_fire_at=NULL,
        config_json=config_json||jsonb_build_object('disabledAt',clock_timestamp(),
          'disabledReason','publication-cutover'),updated_by_user_id=$2,updated_at=clock_timestamp()
        WHERE agent_user_id=$1 AND workflow_key='blog.project.discovery-shadow'
          AND config_json->>'mode'='private-shadow'`, [agentUserId, actorUserId]);
      const row = (await client.query(`UPDATE agent_blog_publication_owners SET
          active_publisher='foundation',generation=generation+1,reason=$3,
          updated_by_user_id=$2,
          switched_at=GREATEST(clock_timestamp(),switched_at+interval '1 microsecond'),
          updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
        WHERE agent_user_id=$1 AND active_publisher='legacy' AND generation=$4 RETURNING *`,
      [agentUserId, actorUserId, reason.trim(), expectedGeneration])).rows[0];
      if (!row) fail('AGENT_BLOG_PUBLICATION_CUTOVER_CONFLICT', 409, '发布链路切换发生并发冲突。');
      return {
        schemaVersion: 'agent-blog-publication-cutover-receipt-v1',
        agentUserId, previousPublisher: 'legacy', owner: ownerView(row),
        legacyScheduleDisabled: true, privateFoundationScheduleDisabled: true, automaticSwitch: false,
      };
    });
  }

  async rollback({ agentUserId, actorUserId, expectedGeneration, reason }) {
    if (!UUID.test(agentUserId ?? '') || !UUID.test(actorUserId ?? '')
      || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 2
      || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500) {
      fail('AGENT_BLOG_PUBLICATION_ROLLBACK_INPUT_INVALID', 400, '发布链路回退参数无效。');
    }
    return withTransaction(this.pool, async client => {
      const managed = (await client.query(`SELECT account.user_id FROM agent_accounts account
        JOIN users operator ON operator.id=account.operator_user_id
        WHERE account.user_id=$1 AND account.operator_user_id=$2
          AND operator.account_type='human' AND operator.status='active' AND operator.role='admin'
        FOR SHARE OF account,operator`, [agentUserId, actorUserId])).rows[0];
      if (!managed) fail('AGENT_NOT_FOUND', 404, '机器人不存在或不由当前管理员运营。');
      await client.query(`SELECT agent_user_id FROM agent_blog_automation_settings
        WHERE agent_user_id=$1 FOR UPDATE`, [agentUserId]);
      const owner = await this.assertPublisher(client, agentUserId, 'foundation');
      if (owner.generation !== expectedGeneration) {
        fail('AGENT_BLOG_PUBLICATION_GENERATION_MISMATCH', 409, '发布权版本已经变化，请重新读取状态。');
      }
      const execution = (await client.query(`SELECT
          (SELECT count(*)::int FROM agent_blog_runs WHERE agent_user_id=$1
            AND status IN ('queued','generating','checking')) AS legacy_active_runs,
          count(*) FILTER (WHERE status IN ('queued','running','waiting'))::int AS foundation_active_runs,
          count(*) FILTER (WHERE status='uncertain')::int AS foundation_uncertain_runs
        FROM agent_runs WHERE agent_user_id=$1`, [agentUserId])).rows[0];
      const blockers = [];
      if (integer(execution?.legacy_active_runs) > 0) blockers.push('LEGACY_RUN_ACTIVE');
      if (integer(execution?.foundation_active_runs) > 0) blockers.push('FOUNDATION_RUN_ACTIVE');
      if (integer(execution?.foundation_uncertain_runs) > 0) blockers.push('FOUNDATION_RUN_UNCERTAIN');
      if (blockers.length) {
        throw new AgentBlogPublicationOwnershipError('AGENT_BLOG_PUBLICATION_ROLLBACK_BLOCKED',
          409, '仍有运行中或不确定的发布任务，不能回退。', { blockers });
      }
      await client.query(`UPDATE agent_blog_automation_settings SET enabled=false,next_run_at=NULL,
        updated_by_user_id=$2,updated_at=clock_timestamp() WHERE agent_user_id=$1`,
      [agentUserId, actorUserId]);
      await client.query(`UPDATE agent_schedules SET enabled=false,next_fire_at=NULL,
        config_json=config_json||jsonb_build_object('disabledAt',clock_timestamp(),
          'disabledReason','publication-rollback'),updated_by_user_id=$2,updated_at=clock_timestamp()
        WHERE agent_user_id=$1 AND workflow_key='blog.project.discovery-shadow'
          AND config_json->>'mode'='foundation-public'`, [agentUserId, actorUserId]);
      const row = (await client.query(`UPDATE agent_blog_publication_owners SET
          active_publisher='legacy',generation=generation+1,reason=$3,
          updated_by_user_id=$2,
          switched_at=GREATEST(clock_timestamp(),switched_at+interval '1 microsecond'),
          updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
        WHERE agent_user_id=$1 AND active_publisher='foundation' AND generation=$4 RETURNING *`,
      [agentUserId, actorUserId, reason.trim(), expectedGeneration])).rows[0];
      if (!row) fail('AGENT_BLOG_PUBLICATION_ROLLBACK_CONFLICT', 409, '发布链路回退发生并发冲突。');
      return {
        schemaVersion: 'agent-blog-publication-rollback-receipt-v1',
        agentUserId, previousPublisher: 'foundation', owner: ownerView(row),
        legacyScheduleEnabled: false, publicScheduleDisabled: true, automaticResume: false,
      };
    });
  }
}

export function createAgentBlogPublicationCutoverService({ repository, authorizeOperator,
  policy = AGENT_BLOG_PUBLICATION_CUTOVER_POLICY } = {}) {
  if (!repository) fail('AGENT_BLOG_PUBLICATION_REPOSITORY_REQUIRED', 500, '发布权仓库不可用。');
  policy = validatePolicy(policy);
  return {
    async preflight(actor, agentUserId) {
      if (!actor?.userId || !await authorizeOperator?.(actor)) {
        fail('AGENT_OPERATOR_REQUIRED', 403, '需要管理员权限。');
      }
      const snapshot = await repository.snapshot(agentUserId, policy);
      return evaluateAgentBlogPublicationCutover(snapshot, policy);
    },
    async cutover(actor, agentUserId, input) {
      if (!actor?.userId || !await authorizeOperator?.(actor)) {
        fail('AGENT_OPERATOR_REQUIRED', 403, '需要管理员权限。');
      }
      return repository.cutover({ agentUserId, actorUserId: actor.userId,
        expectedGeneration: input?.expectedGeneration, reason: input?.reason }, policy);
    },
    async rollback(actor, agentUserId, input) {
      if (!actor?.userId || !await authorizeOperator?.(actor)) {
        fail('AGENT_OPERATOR_REQUIRED', 403, '需要管理员权限。');
      }
      return repository.rollback({ agentUserId, actorUserId: actor.userId,
        expectedGeneration: input?.expectedGeneration, reason: input?.reason });
    },
  };
}
