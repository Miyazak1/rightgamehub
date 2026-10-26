import crypto from 'node:crypto';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { mapLegacyAgentBlogRun } from './agent-blog-shadow-contract.mjs';

export const BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: 'blog.project.single.shadow-replay',
  workflowVersion: 1,
  inputSchema: 'blog-legacy-terminal-snapshot-v1',
  outputSchema: 'blog-shadow-replay-report-v1',
  requiredCapabilities: [],
  defaultBudget: { providerCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
  stages: [
    { key: 'verify-legacy-run', kind: 'deterministic', dependsOn: [], maxAttempts: 2, timeoutSeconds: 60 },
  ],
});

// Candidate discovery is an independent read-only workflow. Its search output
// is never accepted as article evidence: a later draft Run must read each
// selected repository through the revision-pinned repository tool.
export const BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: 'blog.project.discovery-shadow',
  workflowVersion: 1,
  inputSchema: 'blog-project-discovery-input-v1',
  outputSchema: 'blog-candidate-set-output-v1',
  requiredCapabilities: [{ key: 'research.github.discover', version: 1 }],
  defaultBudget: { providerCalls: 0, toolCalls: 5, inputTokens: 0, outputTokens: 0, wallClockSeconds: 600 },
  stages: [
    { key: 'freeze-brief', kind: 'deterministic', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30 },
    { key: 'search-candidates', kind: 'tool', dependsOn: ['freeze-brief'], maxAttempts: 3, timeoutSeconds: 300,
      capability: { key: 'research.github.discover', version: 1 }, idempotencyMode: 'key' },
    { key: 'finalize-candidates', kind: 'deterministic', dependsOn: ['search-candidates'], maxAttempts: 1, timeoutSeconds: 60 },
  ],
});

export const BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: 'blog.project.discovery-shadow',
  workflowVersion: 3,
  inputSchema: 'blog-project-discovery-input-v2',
  outputSchema: 'blog-candidate-set-output-v1',
  requiredCapabilities: [
    { key: 'provider.text.generate', version: 1 },
    { key: 'research.github.discover', version: 1 },
  ],
  defaultBudget: { providerCalls: 1, toolCalls: 5, inputTokens: 12000, outputTokens: 1200, wallClockSeconds: 900 },
  stages: [
    { key: 'freeze-brief', kind: 'deterministic', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30 },
    { key: 'plan-queries', kind: 'provider', dependsOn: ['freeze-brief'], maxAttempts: 2, timeoutSeconds: 180,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'search-candidates', kind: 'tool', dependsOn: ['plan-queries'], maxAttempts: 3, timeoutSeconds: 300,
      capability: { key: 'research.github.discover', version: 1 }, idempotencyMode: 'key' },
    { key: 'finalize-candidates', kind: 'deterministic', dependsOn: ['search-candidates'], maxAttempts: 1, timeoutSeconds: 60 },
  ],
});

// This is the target contract, not a production registration.  F1-4B only
// registers the zero-cost replay workflow above.  Canary registration waits
// until every adapter and publish-ownership gate has passed its own review.
export const BLOG_PROJECT_SINGLE_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: 'blog.project.single',
  workflowVersion: 1,
  inputSchema: 'blog-project-single-input-v1',
  outputSchema: 'blog-article-output-v1',
  requiredCapabilities: [
    { key: 'research.github.read', version: 1 },
    { key: 'provider.text.generate', version: 1 },
    { key: 'blog.article.draft', version: 1 },
    { key: 'blog.article.publish', version: 1 },
  ],
  defaultBudget: { providerCalls: 4, toolCalls: 12, inputTokens: 90000, outputTokens: 18000, wallClockSeconds: 1800 },
  stages: [
    { key: 'freeze-input', kind: 'deterministic', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30 },
    { key: 'collect-evidence', kind: 'tool', dependsOn: ['freeze-input'], maxAttempts: 3, timeoutSeconds: 600,
      capability: { key: 'research.github.read', version: 1 }, idempotencyMode: 'key' },
    { key: 'select-subject', kind: 'provider', dependsOn: ['collect-evidence'], maxAttempts: 2, timeoutSeconds: 300,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'compose', kind: 'provider', dependsOn: ['select-subject'], maxAttempts: 2, timeoutSeconds: 600,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'verify', kind: 'deterministic', dependsOn: ['compose'], maxAttempts: 1, timeoutSeconds: 120 },
    { key: 'persist-draft', kind: 'domain-write', dependsOn: ['verify'], maxAttempts: 1, timeoutSeconds: 60,
      capability: { key: 'blog.article.draft', version: 1 }, idempotencyMode: 'queryable' },
    { key: 'publish', kind: 'domain-write', dependsOn: ['persist-draft'], maxAttempts: 1, timeoutSeconds: 60,
      capability: { key: 'blog.article.publish', version: 1 }, idempotencyMode: 'queryable' },
  ],
});

// Shadow generation stops at a private draft.  It deliberately omits both the
// publication capability and a publish stage, so deployment configuration
// cannot accidentally turn a shadow run into a public article.
export const BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: 'blog.project.single.draft-shadow',
  workflowVersion: 1,
  inputSchema: 'blog-project-single-input-v1',
  outputSchema: 'blog-private-draft-output-v1',
  requiredCapabilities: [
    { key: 'research.github.read', version: 1 },
    { key: 'provider.text.generate', version: 1 },
    { key: 'blog.article.draft', version: 1 },
  ],
  defaultBudget: { providerCalls: 4, toolCalls: 12, inputTokens: 90000, outputTokens: 18000, wallClockSeconds: 1800 },
  stages: [
    { key: 'freeze-input', kind: 'deterministic', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30 },
    { key: 'collect-evidence', kind: 'tool', dependsOn: ['freeze-input'], maxAttempts: 3, timeoutSeconds: 600,
      capability: { key: 'research.github.read', version: 1 }, idempotencyMode: 'key' },
    { key: 'select-subject', kind: 'provider', dependsOn: ['collect-evidence'], maxAttempts: 2, timeoutSeconds: 300,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'compose', kind: 'provider', dependsOn: ['select-subject'], maxAttempts: 2, timeoutSeconds: 600,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'verify', kind: 'deterministic', dependsOn: ['compose'], maxAttempts: 1, timeoutSeconds: 120 },
    { key: 'persist-draft', kind: 'domain-write', dependsOn: ['verify'], maxAttempts: 1, timeoutSeconds: 60,
      capability: { key: 'blog.article.draft', version: 1 }, idempotencyMode: 'queryable' },
  ],
});

export async function ensureBlogShadowReplayWorkflow(runtimeRepository, actorUserId) {
  const registered = await runtimeRepository.registerWorkflow({
    actorUserId, manifest: BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW, status: 'draft',
  });
  if (registered.status === 'draft') await runtimeRepository.activateWorkflow(
    BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowKey,
    BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowVersion,
  );
  return BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW;
}

export class PostgresAgentBlogShadowReplayArtifactRepository {
  constructor(pool) { this.pool = pool; }

  async save({ runId, agentUserId, legacyRunId, sourceSha256, verdict, report }) {
    const id = crypto.randomUUID();
    const row = (await this.pool.query(`INSERT INTO agent_blog_shadow_replay_artifacts(
        id,run_id,agent_user_id,legacy_run_id,source_sha256,verdict,report_json
      ) SELECT $1,$2,$3,$4,$5,$6,$7 FROM agent_runs run
      WHERE run.id=$2 AND run.agent_user_id=$3 AND run.workflow_key=$8 AND run.status='running'
      ON CONFLICT(legacy_run_id) DO NOTHING RETURNING *`, [id, runId, agentUserId, legacyRunId,
      sourceSha256, verdict, JSON.stringify(report), BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowKey])).rows[0];
    if (row) return { id: row.id, existing: false };
    const existing = (await this.pool.query(`SELECT * FROM agent_blog_shadow_replay_artifacts
      WHERE legacy_run_id=$1`, [legacyRunId])).rows[0];
    if (!existing) throw Object.assign(new Error('AGENT_BLOG_SHADOW_REPLAY_CONTEXT_INVALID'), { code: 'AGENT_BLOG_SHADOW_REPLAY_CONTEXT_INVALID', retryable: false });
    if (existing.run_id !== runId || existing.agent_user_id !== agentUserId || existing.source_sha256 !== sourceSha256
      || existing.verdict !== verdict || stableHash(existing.report_json) !== stableHash(report)) {
      throw Object.assign(new Error('AGENT_BLOG_SHADOW_REPLAY_CONFLICT'), { code: 'AGENT_BLOG_SHADOW_REPLAY_CONFLICT', retryable: false });
    }
    return { id: existing.id, existing: true };
  }
}

export function createBlogShadowReplayHandlers({ artifactRepository }) {
  if (!artifactRepository) throw new Error('AGENT_BLOG_SHADOW_ARTIFACT_REPOSITORY_REQUIRED');
  const route = `${BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowKey}:verify-legacy-run`;
  return {
    [route]: async context => {
      const input = context?.run?.input;
      const snapshot = input?.legacySnapshot;
      if (!snapshot || input?.schemaVersion !== 'blog-shadow-replay-input-v1'
        || input?.projectionMode !== 'shadow' || stableHash(snapshot) !== input?.sourceSha256
        || snapshot?.providerUsage?.selectionDecision?.mode !== 'single'
        || !['published', 'rejected', 'failed'].includes(snapshot?.status)) {
        throw Object.assign(new Error('AGENT_BLOG_SHADOW_REPLAY_INPUT_INVALID'), { code: 'AGENT_BLOG_SHADOW_REPLAY_INPUT_INVALID', retryable: false });
      }
      const mapping = mapLegacyAgentBlogRun(snapshot);
      const report = {
        schemaVersion: 'blog-shadow-replay-report-v1',
        legacyRunId: snapshot.legacyRunId,
        sourceSha256: input.sourceSha256,
        sourceStatus: snapshot.status,
        mappedRunStatus: mapping.mappedRunStatus,
        mappedStageStatus: mapping.mappedStageStatus,
        parityStatus: mapping.parityStatus,
        mismatchCodes: mapping.mismatchCodes,
        selectionMode: 'single',
        repositories: snapshot.providerUsage.selectionDecision.repositories ?? [],
        providerOwner: 'legacy',
        publishOwner: 'legacy',
        providerInvocation: false,
        publicationAttempt: false,
        articleId: snapshot.article?.id ?? null,
      };
      const artifact = await artifactRepository.save({
        runId: context.run.id, agentUserId: context.run.agentUserId,
        legacyRunId: snapshot.legacyRunId, sourceSha256: input.sourceSha256,
        verdict: mapping.parityStatus, report,
      });
      return {
        outputRef: { artifactType: 'blog.shadow-report', artifactId: artifact.id, parityStatus: mapping.parityStatus },
        runOutput: { type: 'blog.shadow-report', id: artifact.id },
      };
    },
  };
}
