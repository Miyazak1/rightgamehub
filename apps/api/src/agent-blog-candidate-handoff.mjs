import { normalizeAgentBehaviorProfile } from './agent-behavior-profile.mjs';
import { BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { normalizeBlogFoundationShadowInput } from './agent-blog-foundation-shadow.mjs';
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

export function createAgentBlogCandidateDraftHandoffCanary({
  runtimeRepository, artifactRepository, enabled = false,
} = {}) {
  if (!runtimeRepository || !artifactRepository) fail('AGENT_BLOG_HANDOFF_DEPENDENCY_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('AGENT_BLOG_HANDOFF_CANARY_DISABLED'); };
  return {
    async register(actorUserId) {
      requireEnabled();
      const workflow = BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW;
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
      const input = normalizeBlogFoundationShadowInput({
        schemaVersion: 'blog-project-single-shadow-input-v1',
        topicScope: candidateSet.topicScope,
        candidateRepositories: candidateSet.repositories,
        recentTitles,
        previousRepositoryUrls,
        behaviorProfile: profile,
      });
      return runtimeRepository.createRun({
        agentUserId,
        workflowKey: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowKey,
        workflowVersion: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowVersion,
        triggerKind,
        triggerRef,
        idempotencyKey,
        input,
        config,
        budget: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.defaultBudget,
        handoff: {
          kind: 'blog.candidate-set-to-private-draft',
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
