import { normalizeAgentBehaviorProfile } from './agent-behavior-profile.mjs';
import { BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW,
  BLOG_PROJECT_SINGLE_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { normalizeBlogFoundationPublicInput,
  normalizeBlogFoundationShadowInput } from './agent-blog-foundation-shadow.mjs';
import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';

export class AgentBlogCandidateHandoffError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogCandidateHandoffError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogCandidateHandoffError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizeCandidateSet(artifact) {
  const content = artifact?.content;
  if (!artifact || artifact.artifactKey !== 'blog.candidate-set'
    || artifact.schema?.key !== 'blog.candidate.discovery' || artifact.schema?.version !== 1
    || content?.schemaVersion !== 'blog-candidate-set-v1'
    || typeof content.topicScope !== 'string' || content.topicScope.trim().length < 2
    || !Array.isArray(content.candidates) || content.candidates.length < 1 || content.candidates.length > 12) {
    fail('AGENT_BLOG_HANDOFF_CANDIDATE_SET_INVALID');
  }
  let repositories;
  try {
    repositories = content.candidates.map(candidate => {
      if (!candidate || typeof candidate !== 'object' || typeof candidate.canonicalUrl !== 'string') {
        fail('AGENT_BLOG_HANDOFF_CANDIDATE_SET_INVALID');
      }
      return normalizeGitHubRepositoryLocator(candidate.canonicalUrl).canonicalUrl;
    });
  } catch (error) {
    if (error instanceof AgentBlogCandidateHandoffError) throw error;
    fail('AGENT_BLOG_HANDOFF_CANDIDATE_SET_INVALID');
  }
  if (new Set(repositories.map(item => item.toLowerCase())).size !== repositories.length) {
    fail('AGENT_BLOG_HANDOFF_CANDIDATE_SET_INVALID');
  }
  return { topicScope: content.topicScope, repositories };
}

function createCandidateHandoff({ runtimeRepository, artifactRepository, enabled = false }, {
  workflow, normalizeInput, inputSchemaVersion, handoffKind, disabledCode,
}) {
  if (!runtimeRepository || !artifactRepository) fail('AGENT_BLOG_HANDOFF_DEPENDENCY_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail(disabledCode); };
  return {
    async register(actorUserId) {
      requireEnabled();
      const registered = await runtimeRepository.registerWorkflow({ actorUserId, manifest: workflow, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(workflow.workflowKey, workflow.workflowVersion);
      return workflow;
    },

    async createDraftRun({
      agentUserId, discoveryRunId, discoveryArtifactId, idempotencyKey,
      recentTitles = [], previousRepositoryUrls = [], behaviorProfile, config = {},
      triggerKind = 'system', triggerRef = null,
    }) {
      requireEnabled();
      if (typeof discoveryRunId !== 'string' || !UUID.test(discoveryRunId)
        || typeof discoveryArtifactId !== 'string' || !UUID.test(discoveryArtifactId)) {
        fail('AGENT_BLOG_HANDOFF_SOURCE_INVALID');
      }
      const artifact = await artifactRepository.read({ runId: discoveryRunId,
        artifactId: discoveryArtifactId, expectedArtifactKey: 'blog.candidate-set' });
      const candidateSet = normalizeCandidateSet(artifact);
      let profile;
      try { profile = normalizeAgentBehaviorProfile(behaviorProfile); }
      catch { fail('AGENT_BLOG_HANDOFF_BEHAVIOR_INVALID'); }
      const input = normalizeInput({
        schemaVersion: inputSchemaVersion,
        topicScope: candidateSet.topicScope,
        candidateRepositories: candidateSet.repositories,
        recentTitles,
        previousRepositoryUrls,
        behaviorProfile: profile,
      });
      return runtimeRepository.createRun({
        agentUserId,
        workflowKey: workflow.workflowKey,
        workflowVersion: workflow.workflowVersion,
        triggerKind,
        triggerRef,
        idempotencyKey,
        input,
        config,
        budget: workflow.defaultBudget,
        handoff: {
          kind: handoffKind,
          sourceRunId: discoveryRunId,
          sourceArtifactId: artifact.id,
          sourceOutputType: 'blog.candidate-set',
          sourceArtifactKey: artifact.artifactKey,
          sourceContentSha256: artifact.contentSha256,
        },
      });
    },
  };
}

export function createAgentBlogCandidateDraftHandoffCanary(dependencies = {}) {
  return createCandidateHandoff(dependencies, {
    workflow: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW,
    normalizeInput: normalizeBlogFoundationShadowInput,
    inputSchemaVersion: 'blog-project-single-shadow-input-v1',
    handoffKind: 'blog.candidate-set-to-private-draft',
    disabledCode: 'AGENT_BLOG_HANDOFF_CANARY_DISABLED',
  });
}

export function createAgentBlogCandidatePublicHandoff(dependencies = {}) {
  return createCandidateHandoff(dependencies, {
    workflow: BLOG_PROJECT_SINGLE_WORKFLOW,
    normalizeInput: normalizeBlogFoundationPublicInput,
    inputSchemaVersion: 'blog-project-single-input-v1',
    handoffKind: 'blog.candidate-set-to-public-article',
    disabledCode: 'AGENT_BLOG_PUBLIC_HANDOFF_DISABLED',
  });
}
