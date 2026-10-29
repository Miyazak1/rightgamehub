import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TERMINAL = new Set(['succeeded', 'rejected', 'failed', 'cancelled', 'uncertain']);

export const AGENT_BLOG_CANARY_ACCEPTANCE_POLICY = Object.freeze({
  schemaVersion: 'agent-blog-canary-acceptance-policy-v1', policyVersion: 2,
  requiredConsecutivePasses: 3, expectedDiscoveryStages: 4, expectedDraftStages: 6,
  expectedProviderCalls: 3, minToolCalls: 2, maxToolCalls: 13,
  maxStageRetries: 0, maxWallClockSeconds: 3600, maxCostMicrousd: 1_000_000,
});

export class AgentBlogCanaryAcceptanceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogCanaryAcceptanceError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogCanaryAcceptanceError(code); };
const integer = value => Number(value ?? 0);

function validatePolicy(policy) {
  if (!policy || policy.schemaVersion !== 'agent-blog-canary-acceptance-policy-v1'
    || policy.policyVersion !== 2 || !Number.isSafeInteger(policy.requiredConsecutivePasses)
    || policy.requiredConsecutivePasses < 1 || policy.requiredConsecutivePasses > 20) {
    fail('AGENT_BLOG_CANARY_ACCEPTANCE_POLICY_INVALID');
  }
  return structuredClone(policy);
}

export function evaluateAgentBlogCanaryAcceptance(snapshot,
  policy = AGENT_BLOG_CANARY_ACCEPTANCE_POLICY) {
  policy = validatePolicy(policy);
  if (!snapshot || snapshot.schemaVersion !== 'agent-blog-canary-evidence-v1'
    || typeof snapshot.agentUserId !== 'string' || !UUID.test(snapshot.agentUserId)
    || !snapshot.discovery || !snapshot.draft || !snapshot.handoff || !snapshot.execution
    || !snapshot.publication || !snapshot.lineage || !snapshot.usage) {
    fail('AGENT_BLOG_CANARY_ACCEPTANCE_EVIDENCE_INVALID');
  }
  if (!TERMINAL.has(snapshot.discovery.status) || !TERMINAL.has(snapshot.draft.status)) {
    fail('AGENT_BLOG_CANARY_ACCEPTANCE_NOT_TERMINAL');
  }
  const reasons = [];
  if (snapshot.discovery.workflowKey !== 'blog.project.discovery-shadow'
    || snapshot.discovery.workflowVersion !== 3
    || snapshot.draft.workflowKey !== 'blog.project.single.draft-shadow'
    || snapshot.draft.workflowVersion !== 2
    || snapshot.handoff.sourceRunId !== snapshot.discovery.id
    || snapshot.handoff.targetRunId !== snapshot.draft.id
    || snapshot.discovery.triggerRef !== snapshot.draft.triggerRef) reasons.push('RUN_GRAPH_INVALID');
  if (snapshot.discovery.status !== 'succeeded' || snapshot.discovery.outputType !== 'blog.candidate-set'
    || snapshot.discovery.outputId !== snapshot.handoff.sourceArtifactId) reasons.push('DISCOVERY_NOT_SUCCEEDED');
  if (snapshot.draft.status !== 'succeeded' || snapshot.draft.outputType !== 'blog.private-draft'
    || snapshot.draft.outputId !== snapshot.publication.articleId) reasons.push('DRAFT_NOT_SUCCEEDED');
  if (snapshot.execution.discoveryStages !== policy.expectedDiscoveryStages
    || snapshot.execution.draftStages !== policy.expectedDraftStages) reasons.push('STAGE_COUNT_INVALID');
  if (snapshot.execution.nonSucceededStages !== 0) reasons.push('STAGE_NOT_SUCCEEDED');
  if (snapshot.execution.stageRetries > policy.maxStageRetries) reasons.push('STAGE_RETRY_OBSERVED');
  if (snapshot.execution.nonSucceededActions !== 0
    || snapshot.usage.failedOrUncertainProviderCalls !== 0
    || snapshot.usage.failedOrUncertainToolCalls !== 0) reasons.push('ACTION_NOT_SUCCEEDED');
  if (snapshot.execution.publishStages !== 0 || snapshot.execution.publishActions !== 0
    || snapshot.publication.publishEvents !== 0) reasons.push('PUBLISH_AUTHORITY_OBSERVED');
  if (snapshot.publication.state !== 'draft' || snapshot.publication.revisionState !== 'working'
    || snapshot.publication.publishedRevisionId !== null) reasons.push('DRAFT_NOT_PRIVATE');
  if (!snapshot.lineage.candidateHashMatches || !snapshot.lineage.inputHashMatches
    || !snapshot.lineage.compositionArtifactId || !snapshot.lineage.verificationArtifactId
    || snapshot.lineage.sourceArtifactCount < 1) reasons.push('DRAFT_LINEAGE_INCOMPLETE');
  if (snapshot.usage.providerCalls !== policy.expectedProviderCalls) reasons.push('PROVIDER_CALL_COUNT_INVALID');
  if (snapshot.usage.toolCalls < policy.minToolCalls || snapshot.usage.toolCalls > policy.maxToolCalls) {
    reasons.push('TOOL_CALL_COUNT_INVALID');
  }
  if (snapshot.usage.costMicrousd > policy.maxCostMicrousd) reasons.push('BUDGET_EXCEEDED');
  if (snapshot.execution.wallClockSeconds > policy.maxWallClockSeconds) reasons.push('WALL_CLOCK_EXCEEDED');
  const reasonCodes = [...new Set(reasons)];
  const metrics = {
    wallClockSeconds: snapshot.execution.wallClockSeconds,
    stageRetries: snapshot.execution.stageRetries,
    providerCalls: snapshot.usage.providerCalls, toolCalls: snapshot.usage.toolCalls,
    inputTokens: snapshot.usage.inputTokens, outputTokens: snapshot.usage.outputTokens,
    costMicrousd: snapshot.usage.costMicrousd,
  };
  const evidenceSha256 = stableHash(snapshot);
  const result = { schemaVersion: 'agent-blog-canary-acceptance-v1', policyVersion: policy.policyVersion,
    verdict: reasonCodes.length ? 'failed' : 'passed', reasonCodes, metrics, evidenceSha256 };
  return { ...result, reportSha256: stableHash({ ...result, policy, evidence: snapshot }) };
}

function rowView(row) {
  return row ? {
    id: row.id, agentUserId: row.agent_user_id, discoveryRunId: row.discovery_run_id,
    handoffId: row.handoff_id, draftRunId: row.draft_run_id,
    policyVersion: row.policy_version, verdict: row.verdict, reasonCodes: row.reason_codes,
    metrics: row.metrics_json, evidenceSha256: row.evidence_sha256,
    reportSha256: row.report_sha256, createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  } : null;
}

export class PostgresAgentBlogCanaryAcceptanceRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_BLOG_CANARY_ACCEPTANCE_DATABASE_REQUIRED');
    this.pool = pool;
  }

  async snapshot(agentUserId, draftRunId) {
    if (!UUID.test(agentUserId ?? '') || !UUID.test(draftRunId ?? '')) {
      fail('AGENT_BLOG_CANARY_ACCEPTANCE_INPUT_INVALID');
    }
    const graph = (await this.pool.query(`SELECT draft.id AS draft_run_id,draft.agent_user_id,
        draft.workflow_key AS draft_workflow_key,draft.workflow_version AS draft_workflow_version,
        draft.trigger_ref AS draft_trigger_ref,draft.status AS draft_status,
        draft.output_type AS draft_output_type,draft.output_id AS draft_output_id,
        draft.started_at AS draft_started_at,draft.finished_at AS draft_finished_at,draft.input_sha256,
        source.id AS discovery_run_id,source.workflow_key AS discovery_workflow_key,
        source.workflow_version AS discovery_workflow_version,source.trigger_ref AS discovery_trigger_ref,
        source.status AS discovery_status,source.output_type AS discovery_output_type,
        source.output_id AS discovery_output_id,source.started_at AS discovery_started_at,
        source.finished_at AS discovery_finished_at,handoff.id AS handoff_id,
        handoff.source_artifact_id,handoff.source_content_sha256,handoff.target_input_sha256,
        artifact.content_sha256 AS candidate_content_sha256,
        mapping.article_id,mapping.source_artifact_ids,mapping.verification_artifact_id,
        mapping.composition_artifact_id,article.publication_state,article.published_revision_id,
        revision.revision_state,
        (SELECT count(*)::int FROM blog_article_events event
          WHERE event.article_id=mapping.article_id AND event.action='published') AS publish_events
      FROM agent_runs draft
      JOIN agent_run_handoffs handoff ON handoff.target_run_id=draft.id
      JOIN agent_runs source ON source.id=handoff.source_run_id AND source.agent_user_id=draft.agent_user_id
      JOIN agent_runtime_stage_artifacts artifact ON artifact.run_id=source.id AND artifact.id=handoff.source_artifact_id
      LEFT JOIN agent_blog_foundation_drafts mapping ON mapping.run_id=draft.id
      LEFT JOIN blog_articles article ON article.id=mapping.article_id
      LEFT JOIN blog_article_revisions revision ON revision.id=mapping.revision_id
      WHERE draft.id=$2 AND draft.agent_user_id=$1
        AND handoff.handoff_kind='blog.candidate-set-to-private-draft'`, [agentUserId, draftRunId])).rows[0];
    if (!graph) fail('AGENT_BLOG_CANARY_ACCEPTANCE_GRAPH_NOT_FOUND');
    const runIds = [graph.discovery_run_id, graph.draft_run_id];
    const counts = (await this.pool.query(`SELECT
        count(*) FILTER (WHERE stage.run_id=$1)::int AS discovery_stages,
        count(*) FILTER (WHERE stage.run_id=$2)::int AS draft_stages,
        count(*) FILTER (WHERE stage.status<>'succeeded')::int AS non_succeeded_stages,
        COALESCE(sum(GREATEST(stage.attempt-1,0)),0)::int AS stage_retries,
        count(*) FILTER (WHERE stage.stage_key='publish')::int AS publish_stages,
        (SELECT count(*)::int FROM agent_run_actions action WHERE action.run_id=ANY($3::uuid[])
          AND action.status<>'succeeded') AS non_succeeded_actions,
        (SELECT count(*)::int FROM agent_run_actions action WHERE action.run_id=ANY($3::uuid[])
          AND action.capability_key='blog.article.publish') AS publish_actions,
        (SELECT count(*)::int FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=ANY($3::uuid[]) AND call.status='succeeded') AS provider_calls,
        (SELECT count(*)::int FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=ANY($3::uuid[]) AND call.status IN ('failed','uncertain')) AS bad_provider_calls,
        (SELECT count(*)::int FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=ANY($3::uuid[]) AND call.status='succeeded') AS tool_calls,
        (SELECT count(*)::int FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=ANY($3::uuid[]) AND call.status IN ('failed','uncertain')) AS bad_tool_calls,
        (SELECT COALESCE(sum(charged_input_tokens),0)::bigint FROM agent_budget_reservations
          WHERE run_id=ANY($3::uuid[]) AND status IN ('settled','uncertain')) AS input_tokens,
        (SELECT COALESCE(sum(charged_output_tokens),0)::bigint FROM agent_budget_reservations
          WHERE run_id=ANY($3::uuid[]) AND status IN ('settled','uncertain')) AS output_tokens,
        (SELECT COALESCE(sum(charged_cost_microusd),0)::bigint FROM agent_budget_reservations
          WHERE run_id=ANY($3::uuid[]) AND status IN ('settled','uncertain')) AS cost_microusd
      FROM agent_run_stages stage WHERE stage.run_id=ANY($3::uuid[])`,
    [graph.discovery_run_id, graph.draft_run_id, runIds])).rows[0];
    const start = graph.discovery_started_at ? new Date(graph.discovery_started_at).getTime() : 0;
    const finish = graph.draft_finished_at ? new Date(graph.draft_finished_at).getTime() : 0;
    return {
      schemaVersion: 'agent-blog-canary-evidence-v1', agentUserId,
      discovery: { id: graph.discovery_run_id, workflowKey: graph.discovery_workflow_key,
        workflowVersion: graph.discovery_workflow_version, triggerRef: graph.discovery_trigger_ref,
        status: graph.discovery_status, outputType: graph.discovery_output_type, outputId: graph.discovery_output_id },
      handoff: { id: graph.handoff_id, sourceRunId: graph.discovery_run_id,
        sourceArtifactId: graph.source_artifact_id, targetRunId: graph.draft_run_id },
      draft: { id: graph.draft_run_id, workflowKey: graph.draft_workflow_key,
        workflowVersion: graph.draft_workflow_version, triggerRef: graph.draft_trigger_ref,
        status: graph.draft_status, outputType: graph.draft_output_type, outputId: graph.draft_output_id },
      execution: { discoveryStages: integer(counts.discovery_stages), draftStages: integer(counts.draft_stages),
        nonSucceededStages: integer(counts.non_succeeded_stages), stageRetries: integer(counts.stage_retries),
        nonSucceededActions: integer(counts.non_succeeded_actions), publishStages: integer(counts.publish_stages),
        publishActions: integer(counts.publish_actions),
        wallClockSeconds: start && finish && finish >= start ? Math.ceil((finish - start) / 1000) : 0 },
      publication: { articleId: graph.article_id ?? null, state: graph.publication_state ?? null,
        revisionState: graph.revision_state ?? null, publishedRevisionId: graph.published_revision_id ?? null,
        publishEvents: integer(graph.publish_events) },
      lineage: { candidateHashMatches: graph.source_content_sha256 === graph.candidate_content_sha256,
        inputHashMatches: graph.target_input_sha256 === graph.input_sha256,
        sourceArtifactCount: Array.isArray(graph.source_artifact_ids) ? graph.source_artifact_ids.length : 0,
        verificationArtifactId: graph.verification_artifact_id ?? null,
        compositionArtifactId: graph.composition_artifact_id ?? null },
      usage: { providerCalls: integer(counts.provider_calls), toolCalls: integer(counts.tool_calls),
        failedOrUncertainProviderCalls: integer(counts.bad_provider_calls),
        failedOrUncertainToolCalls: integer(counts.bad_tool_calls), inputTokens: integer(counts.input_tokens),
        outputTokens: integer(counts.output_tokens), costMicrousd: integer(counts.cost_microusd) },
    };
  }

  async persist({ snapshot, policy, evaluation }) {
    const id = crypto.randomUUID();
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`INSERT INTO agent_blog_canary_acceptance_reports(
          id,agent_user_id,discovery_run_id,handoff_id,draft_run_id,policy_version,verdict,
          reason_codes,policy_json,metrics_json,evidence_json,evidence_sha256,report_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(draft_run_id,policy_version) DO NOTHING RETURNING *`, [id, snapshot.agentUserId,
        snapshot.discovery.id, snapshot.handoff.id, snapshot.draft.id, policy.policyVersion,
        evaluation.verdict, evaluation.reasonCodes, JSON.stringify(policy), JSON.stringify(evaluation.metrics),
        JSON.stringify(snapshot), evaluation.evidenceSha256, evaluation.reportSha256])).rows[0];
      if (row) return { ...rowView(row), existing: false };
      const existing = (await client.query(`SELECT * FROM agent_blog_canary_acceptance_reports
        WHERE draft_run_id=$1 AND policy_version=$2`, [snapshot.draft.id, policy.policyVersion])).rows[0];
      if (!existing || existing.report_sha256 !== evaluation.reportSha256) {
        fail('AGENT_BLOG_CANARY_ACCEPTANCE_CONFLICT');
      }
      return { ...rowView(existing), existing: true };
    });
  }

  async recent(agentUserId, policyVersion, limit) {
    if (!UUID.test(agentUserId ?? '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      fail('AGENT_BLOG_CANARY_ACCEPTANCE_INPUT_INVALID');
    }
    const rows = (await this.pool.query(`SELECT * FROM agent_blog_canary_acceptance_reports
      WHERE agent_user_id=$1 AND policy_version=$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
    [agentUserId, policyVersion, limit])).rows;
    return rows.map(rowView);
  }
}

export function createAgentBlogCanaryAcceptanceService({ repository,
  policy = AGENT_BLOG_CANARY_ACCEPTANCE_POLICY } = {}) {
  if (!repository) fail('AGENT_BLOG_CANARY_ACCEPTANCE_REPOSITORY_REQUIRED');
  policy = validatePolicy(policy);
  return {
    async attest(agentUserId, draftRunId) {
      const snapshot = await repository.snapshot(agentUserId, draftRunId);
      const evaluation = evaluateAgentBlogCanaryAcceptance(snapshot, policy);
      const report = await repository.persist({ snapshot, policy, evaluation });
      return { ...report, recommendation: evaluation.verdict === 'passed'
        ? 'retain-private-and-collect-more-samples' : 'stop-and-investigate' };
    },
    async readiness(agentUserId) {
      const reports = await repository.recent(agentUserId, policy.policyVersion,
        policy.requiredConsecutivePasses);
      let consecutivePasses = 0;
      for (const report of reports) {
        if (report.verdict !== 'passed') break;
        consecutivePasses += 1;
      }
      return {
        schemaVersion: 'agent-blog-canary-readiness-v1', policyVersion: policy.policyVersion,
        requiredConsecutivePasses: policy.requiredConsecutivePasses, consecutivePasses,
        readyForShadowScheduleReview: consecutivePasses >= policy.requiredConsecutivePasses,
        automaticScheduleChange: false,
      };
    },
  };
}
