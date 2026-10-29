import { normalizeAgentBehaviorProfile } from './agent-behavior-profile.mjs';
import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';
import { runAgentBlogPrivateCanaryPreflight } from './agent-blog-private-canary-preflight.mjs';
import { PostgresAgentEditorialMemoryRepository } from './agent-editorial-memory-repository.mjs';
import { AGENT_GITHUB_RESEARCH_LIMITS } from './agent-github-research-runtime.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentBlogPrivateCanaryManualRunError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AgentBlogPrivateCanaryManualRunError';
    this.code = code;
    this.details = details;
    this.retryable = false;
  }
}

const fail = (code, details) => { throw new AgentBlogPrivateCanaryManualRunError(code, details); };

function repositoryUrls(rows) {
  const values = [];
  for (const row of rows) {
    for (const raw of [row.repository_url, row.source_url]) {
      if (typeof raw !== 'string') continue;
      try { values.push(normalizeGitHubRepositoryLocator(raw).canonicalUrl); } catch {}
    }
  }
  return [...new Map(values.map(value => [value.toLowerCase(), value])).values()];
}

export class PostgresAgentBlogPrivateCanaryInputRepository {
  constructor(pool, { editorialMemoryRepository } = {}) {
    if (!pool) fail('AGENT_BLOG_PRIVATE_CANARY_DATABASE_REQUIRED');
    this.pool = pool;
    this.editorialMemoryRepository = editorialMemoryRepository
      ?? new PostgresAgentEditorialMemoryRepository(pool);
  }

  async snapshot(agentUserId) {
    if (typeof agentUserId !== 'string' || !UUID.test(agentUserId)) {
      fail('AGENT_BLOG_PRIVATE_CANARY_AGENT_REQUIRED');
    }
    const base = (await this.pool.query(`SELECT settings.topic_scope,settings.model,
        profile.id AS behavior_profile_id,profile.version AS behavior_profile_version,profile.profile
      FROM agent_blog_automation_settings settings
      JOIN agent_behavior_profile_assignments assignment ON assignment.agent_user_id=settings.agent_user_id
      JOIN agent_behavior_profiles profile ON profile.agent_user_id=assignment.agent_user_id
        AND profile.id=assignment.active_profile_id
      WHERE settings.agent_user_id=$1`, [agentUserId])).rows[0];
    if (!base) fail('AGENT_BLOG_PRIVATE_CANARY_INPUT_NOT_CONFIGURED');
    let behaviorProfile;
    try { behaviorProfile = normalizeAgentBehaviorProfile(base.profile); }
    catch { fail('AGENT_BLOG_PRIVATE_CANARY_BEHAVIOR_INVALID'); }
    const [titleRows, citationRows, editorialMemory] = await Promise.all([
      this.pool.query(`SELECT revision.title FROM blog_articles article
        JOIN blog_article_revisions revision ON revision.id=article.published_revision_id
        WHERE article.author_user_id=$1 AND article.publication_state='published'
        ORDER BY article.last_published_at DESC LIMIT 30`, [agentUserId]),
      this.pool.query(`SELECT citation->>'repositoryUrl' AS repository_url,citation->>'url' AS source_url
        FROM blog_articles article JOIN blog_article_revisions revision ON revision.id=article.published_revision_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(revision.citations,'[]'::jsonb)) citation
        WHERE article.author_user_id=$1 AND article.publication_state IN ('published','withdrawn')`, [agentUserId]),
      this.editorialMemoryRepository.snapshot(agentUserId),
    ]);
    const previousRepositoryUrls = repositoryUrls([
      ...citationRows.rows,
      ...editorialMemory.previousRepositoryUrls.map(repository_url => ({ repository_url })),
    ]);
    return Object.freeze({
      schemaVersion: 'agent-blog-private-canary-input-snapshot-v2',
      agentUserId,
      topicScope: String(base.topic_scope).trim(),
      configuredModelId: String(base.model).trim(),
      behaviorProfileId: base.behavior_profile_id,
      behaviorProfileVersion: Number(base.behavior_profile_version),
      behaviorProfile,
      recentTitles: titleRows.rows.map(row => String(row.title).trim()).filter(Boolean),
      previousRepositoryUrls,
      editorialMemory: editorialMemory.selectionMemory,
    });
  }
}

async function executeRun({ worker, expectedStageCount, outputType, runId }) {
  let terminal = null;
  try {
    for (let index = 0; index < expectedStageCount; index += 1) {
      const result = await worker.runOnce();
      if (result?.status !== 'completed') {
        fail('AGENT_BLOG_PRIVATE_CANARY_STAGE_INCOMPLETE', { runId, stageNumber: index + 1,
          workerStatus: result?.status ?? 'unknown', stageKey: result?.stage?.stageKey ?? null,
          stageErrorCode: result?.stage?.errorCode ?? result?.error?.code ?? null });
      }
      if (result.run) terminal = result.run;
    }
  } finally {
    await worker.stop();
  }
  if (!terminal || terminal.id !== runId || terminal.status !== 'succeeded'
    || terminal.outputType !== outputType || typeof terminal.outputId !== 'string' || !UUID.test(terminal.outputId)) {
    fail('AGENT_BLOG_PRIVATE_CANARY_OUTPUT_INVALID', { runId, expectedOutputType: outputType });
  }
  return terminal;
}

export function createAgentBlogPrivateCanaryManualRunner({
  config, preflightRepository, inputRepository, discoveryCanary, handoffCanary,
  createDiscoveryWorker, createDraftWorker,
} = {}) {
  if (!config || !preflightRepository || !inputRepository || !discoveryCanary || !handoffCanary
    || typeof createDiscoveryWorker !== 'function' || typeof createDraftWorker !== 'function') {
    fail('AGENT_BLOG_PRIVATE_CANARY_DEPENDENCY_REQUIRED');
  }
  return {
    async run({ requestId, triggerKind = 'manual', triggerRef = requestId }) {
      if (typeof requestId !== 'string' || !UUID.test(requestId)) {
        fail('AGENT_BLOG_PRIVATE_CANARY_REQUEST_ID_INVALID');
      }
      if (!['manual','schedule'].includes(triggerKind) || typeof triggerRef !== 'string'
        || triggerRef.length < 1 || triggerRef.length > 240) {
        fail('AGENT_BLOG_PRIVATE_CANARY_TRIGGER_INVALID');
      }
      const preflight = await runAgentBlogPrivateCanaryPreflight({ repository: preflightRepository, config });
      if (!preflight.ready) fail('AGENT_BLOG_PRIVATE_CANARY_PREFLIGHT_BLOCKED', { blockers: preflight.blockers });
      const frozen = await inputRepository.snapshot(config.agentUserId);
      if (frozen?.schemaVersion !== 'agent-blog-private-canary-input-snapshot-v2'
        || frozen.agentUserId !== config.agentUserId) {
        fail('AGENT_BLOG_PRIVATE_CANARY_INPUT_INVALID');
      }
      if (frozen.configuredModelId !== config.modelId) {
        fail('AGENT_BLOG_PRIVATE_CANARY_MODEL_DRIFT', {
          configuredModelId: frozen.configuredModelId, requestedModelId: config.modelId,
        });
      }
      const modelConfig = { model: { provider: config.provider, modelId: config.modelId },
        behaviorProfileId: frozen.behaviorProfileId, behaviorProfileVersion: frozen.behaviorProfileVersion };
      const discovery = await discoveryCanary.createRun({
        agentUserId: config.agentUserId, triggerKind, triggerRef,
        idempotencyKey: `private-canary:${requestId}:discovery`, config: modelConfig,
        input: {
          schemaVersion: 'blog-project-discovery-input-v2', topicScope: frozen.topicScope,
          searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: null,
            maxCandidates: AGENT_GITHUB_RESEARCH_LIMITS.maxCandidates,
            maxQueries: AGENT_GITHUB_RESEARCH_LIMITS.maxSearchRequests },
          previousRepositoryUrls: frozen.previousRepositoryUrls,
          behaviorProfile: frozen.behaviorProfile,
        },
      });
      const discoveryOutput = await executeRun({ worker: createDiscoveryWorker(discovery.id, requestId),
        expectedStageCount: 4, outputType: 'blog.candidate-set', runId: discovery.id });
      const draft = await handoffCanary.createDraftRun({
        agentUserId: config.agentUserId, discoveryRunId: discovery.id,
        discoveryArtifactId: discoveryOutput.outputId,
        idempotencyKey: `private-canary:${requestId}:draft`, triggerKind, triggerRef,
        recentTitles: frozen.recentTitles, previousRepositoryUrls: frozen.previousRepositoryUrls,
        editorialMemory: frozen.editorialMemory,
        behaviorProfile: frozen.behaviorProfile, config: modelConfig,
      });
      const draftOutput = await executeRun({ worker: createDraftWorker(draft.id, requestId),
        expectedStageCount: 6, outputType: 'blog.private-draft', runId: draft.id });
      return Object.freeze({
        schemaVersion: 'agent-blog-private-canary-result-v1', requestId,
        agentUserId: config.agentUserId, preflight: 'passed',
        behaviorProfileVersion: frozen.behaviorProfileVersion,
        discovery: { runId: discovery.id, artifactId: discoveryOutput.outputId },
        draft: { runId: draft.id, articleId: draftOutput.outputId, publicationState: 'draft' },
        publicationAttempted: false,
      });
    },
  };
}
