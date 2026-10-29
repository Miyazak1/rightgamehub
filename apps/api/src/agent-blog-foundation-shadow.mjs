import { normalizeAgentBehaviorProfile } from './agent-behavior-profile.mjs';
import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';
import { BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW,
  BLOG_PROJECT_SINGLE_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { createAgentBlogFoundationGenerationHandlers } from './agent-blog-foundation-generation.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentBlogFoundationShadowError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogFoundationShadowError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogFoundationShadowError(code); };
const compact = (value, max) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);

function stringList(value, { maxItems, maxLength }) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail('AGENT_BLOG_SHADOW_INPUT_INVALID');
  const items = value.map(item => compact(item, maxLength)).filter(Boolean);
  if (items.length !== value.length || new Set(items).size !== items.length) fail('AGENT_BLOG_SHADOW_INPUT_INVALID');
  return items;
}

function editorialMemory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 'blog-editorial-memory-input-v1'
    || Object.keys(value).some(key => !['schemaVersion', 'capturedAt', 'activeCooldowns'].includes(key))
    || !Array.isArray(value.activeCooldowns) || value.activeCooldowns.length > 120) {
    fail('AGENT_BLOG_SHADOW_EDITORIAL_MEMORY_INVALID');
  }
  const capturedAt = new Date(value.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) fail('AGENT_BLOG_SHADOW_EDITORIAL_MEMORY_INVALID');
  const activeCooldowns = value.activeCooldowns.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['subjectKind', 'subjectKey', 'label', 'occurrenceCount', 'cooldownUntil'].includes(key))
      || !['comparison', 'topic', 'claim', 'scenario'].includes(item.subjectKind)
      || !Number.isSafeInteger(item.occurrenceCount) || item.occurrenceCount < 1) {
      fail('AGENT_BLOG_SHADOW_EDITORIAL_MEMORY_INVALID');
    }
    const subjectKey = compact(item.subjectKey, 512);
    const label = compact(item.label, 1000);
    const cooldownUntil = new Date(item.cooldownUntil);
    if (subjectKey.length < 3 || label.length < 2 || !Number.isFinite(cooldownUntil.getTime())
      || cooldownUntil.getTime() <= capturedAt.getTime()) fail('AGENT_BLOG_SHADOW_EDITORIAL_MEMORY_INVALID');
    return { subjectKind: item.subjectKind, subjectKey, label,
      occurrenceCount: item.occurrenceCount, cooldownUntil: cooldownUntil.toISOString() };
  });
  if (new Set(activeCooldowns.map(item => `${item.subjectKind}\0${item.subjectKey}`)).size !== activeCooldowns.length) {
    fail('AGENT_BLOG_SHADOW_EDITORIAL_MEMORY_INVALID');
  }
  return { schemaVersion: value.schemaVersion, capturedAt: capturedAt.toISOString(), activeCooldowns };
}

function normalizeInput(value, schemaVersion) {
  const keys = ['schemaVersion', 'topicScope', 'candidateRepositories', 'recentTitles',
    'previousRepositoryUrls', 'behaviorProfile', 'editorialMemory'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || !schemaVersion.includes(value.schemaVersion)
    || (value.schemaVersion.endsWith('-v1') && Object.hasOwn(value, 'editorialMemory'))
    || (value.schemaVersion.endsWith('-v2') && !Object.hasOwn(value, 'editorialMemory'))) {
    fail('AGENT_BLOG_SHADOW_INPUT_INVALID');
  }
  const topicScope = compact(value.topicScope, 2000);
  if (topicScope.length < 2) fail('AGENT_BLOG_SHADOW_INPUT_INVALID');
  if (!Array.isArray(value.candidateRepositories) || value.candidateRepositories.length < 1
    || value.candidateRepositories.length > 12) fail('AGENT_BLOG_SHADOW_CANDIDATES_INVALID');
  let candidateRepositories;
  try {
    candidateRepositories = value.candidateRepositories.map(item => normalizeGitHubRepositoryLocator(item).canonicalUrl);
  } catch { fail('AGENT_BLOG_SHADOW_CANDIDATES_INVALID'); }
  const candidateKeys = candidateRepositories.map(item => item.toLowerCase());
  if (new Set(candidateKeys).size !== candidateKeys.length) fail('AGENT_BLOG_SHADOW_CANDIDATES_INVALID');
  let behaviorProfile;
  try { behaviorProfile = normalizeAgentBehaviorProfile(value.behaviorProfile); }
  catch { fail('AGENT_BLOG_SHADOW_BEHAVIOR_INVALID'); }
  const memory = value.schemaVersion.endsWith('-v2')
    ? editorialMemory(value.editorialMemory) : { schemaVersion: 'blog-editorial-memory-input-v1',
      capturedAt: new Date(0).toISOString(), activeCooldowns: [] };
  return {
    schemaVersion: value.schemaVersion,
    topicScope,
    candidateRepositories,
    recentTitles: stringList(value.recentTitles, { maxItems: 30, maxLength: 120 }),
    previousRepositoryUrls: stringList(value.previousRepositoryUrls, { maxItems: 500, maxLength: 500 }),
    behaviorProfile,
    editorialMemory: memory,
  };
}

export const normalizeBlogFoundationShadowInput = value => normalizeInput(
  value, ['blog-project-single-shadow-input-v1', 'blog-project-single-shadow-input-v2']);
export const normalizeBlogFoundationPublicInput = value => normalizeInput(
  value, ['blog-project-single-input-v1', 'blog-project-single-input-v2']);

function prerequisite(context, stageKey) {
  const stage = context.prerequisites.find(item => item.stageKey === stageKey && item.status === 'succeeded');
  if (!stage) fail('AGENT_BLOG_SHADOW_PREREQUISITE_INVALID');
  return stage.outputRef ?? {};
}

function artifactId(result) {
  const id = result?.artifactId ?? result?.responseRef?.artifactId;
  if (typeof id !== 'string') fail('AGENT_BLOG_SHADOW_TOOL_ARTIFACT_MISSING');
  return id;
}

function createFoundationHandlers({
  toolGateway, providerGateway, artifactRepository, draftGateway, publicationGateway = null,
  researchEvidenceRepository = null,
}, { workflow, normalizeInputValue }) {
  if (!toolGateway || !providerGateway || !artifactRepository || !draftGateway
    || (workflow === BLOG_PROJECT_SINGLE_WORKFLOW.workflowKey && !publicationGateway)) {
    fail('AGENT_BLOG_SHADOW_DEPENDENCY_REQUIRED');
  }
  const generated = createAgentBlogFoundationGenerationHandlers({ providerGateway, artifactRepository,
    workflowKey: workflow });
  const handlers = {
    [`${workflow}:freeze-input`]: async context => {
      const input = normalizeInputValue(context.run.input);
      if (stableHash(context.run.input) !== context.run.inputSha256) fail('AGENT_BLOG_SHADOW_INPUT_HASH_MISMATCH');
      return { outputRef: {
        schemaVersion: 'blog-frozen-input-ref-v1', inputSha256: context.run.inputSha256,
        candidateCount: input.candidateRepositories.length,
        candidatesSha256: stableHash(input.candidateRepositories),
      } };
    },

    [`${workflow}:collect-evidence`]: async (context, execution) => {
      const input = normalizeInputValue(context.run.input);
      const frozen = prerequisite(context, 'freeze-input');
      if (frozen.schemaVersion !== 'blog-frozen-input-ref-v1' || frozen.inputSha256 !== context.run.inputSha256
        || frozen.candidateCount !== input.candidateRepositories.length
        || frozen.candidatesSha256 !== stableHash(input.candidateRepositories)) {
        fail('AGENT_BLOG_SHADOW_FROZEN_INPUT_INVALID');
      }
      const artifactIds = [];
      const researchEvidenceBindingIds = [];
      for (const [index, repository] of input.candidateRepositories.entries()) {
        const ordinal = String(index + 1).padStart(2, '0');
        const result = await toolGateway.invoke({
          runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
          leaseToken: execution.leaseToken,
          action: { actionKey: `read-repository-${ordinal}`, actionKind: 'tool',
            capabilityKey: 'research.github.read', contractVersion: 1, riskLevel: 'L1' },
          idempotencyKey: `blog-evidence:${context.run.id}:${ordinal}`,
          resource: { type: 'github.repository', owner: 'public', id: repository },
          tool: { toolKey: 'research.github.repository.materials.read', contractVersion: 1 },
          request: { repository },
        });
        if (result.status !== 'succeeded') fail('AGENT_BLOG_SHADOW_TOOL_INCOMPLETE');
        const sourceArtifactId = artifactId(result);
        artifactIds.push(sourceArtifactId);
        if (researchEvidenceRepository) {
          const archived = await researchEvidenceRepository.archiveGitHubRepositoryArtifact({
            runId: context.run.id, stageId: context.stage.id, actionId: result.actionId,
            toolArtifactId: sourceArtifactId, workerId: execution.workerId,
            leaseToken: execution.leaseToken,
          });
          researchEvidenceBindingIds.push(archived.id);
        }
      }
      return { outputRef: { schemaVersion: 'blog-evidence-set-ref-v1', artifactIds,
        researchEvidenceBindingIds, candidateCount: input.candidateRepositories.length } };
    },

    ...generated,

    [`${workflow}:persist-draft`]: async (context, execution) => {
      const verifiedRef = prerequisite(context, 'verify');
      if (verifiedRef.artifactKey !== 'blog.verification' || verifiedRef.approved !== true
        || typeof verifiedRef.artifactId !== 'string' || typeof verifiedRef.compositionArtifactId !== 'string') {
        fail('AGENT_BLOG_SHADOW_VERIFICATION_INVALID');
      }
      const verification = await artifactRepository.read({ runId: context.run.id,
        artifactId: verifiedRef.artifactId, expectedArtifactKey: 'blog.verification' });
      const proof = verification.content;
      if (proof?.schemaVersion !== 'blog-article-verification-v1' || proof.approved !== true
        || proof.compositionArtifactId !== verifiedRef.compositionArtifactId) {
        fail('AGENT_BLOG_SHADOW_VERIFICATION_INVALID');
      }
      const composition = await artifactRepository.read({ runId: context.run.id,
        artifactId: proof.compositionArtifactId, expectedArtifactKey: 'blog.composition' });
      const packageContent = composition.content;
      if (packageContent?.schemaVersion !== 'blog-article-composition-v1'
        || proof.contentSha256 !== composition.contentSha256
        || !Array.isArray(packageContent.sourceToolArtifactIds)
        || stableHash(packageContent.sourceToolArtifactIds) !== stableHash(proof.sourceToolArtifactIds)) {
        fail('AGENT_BLOG_SHADOW_COMPOSITION_INVALID');
      }
      const draft = await draftGateway.persist({
        agentUserId: context.run.agentUserId, runId: context.run.id, stageId: context.stage.id,
        workerId: execution.workerId, leaseToken: execution.leaseToken,
        idempotencyKey: `blog-private-draft:${context.run.id}`, content: packageContent.content,
        sourceArtifactIds: packageContent.sourceToolArtifactIds, verificationArtifactId: verification.id,
      });
      if (draft.status !== 'succeeded' || draft.publicationState !== 'draft') {
        fail('AGENT_BLOG_SHADOW_DRAFT_INCOMPLETE');
      }
      const result = {
        outputRef: { articleId: draft.articleId, revisionId: draft.revisionId,
          publicationState: 'draft', verificationArtifactId: verification.id,
          compositionArtifactId: composition.id, sourceArtifactIds: packageContent.sourceToolArtifactIds,
          contentSha256: draft.contentSha256 },
      };
      if (!publicationGateway) {
        result.runOutput = { type: 'blog.private-draft', id: draft.articleId };
      }
      return result;
    },
  };
  if (publicationGateway) handlers[`${workflow}:publish`] = async (context, execution) => {
    const draft = prerequisite(context, 'persist-draft');
    if (draft.publicationState !== 'draft' || typeof draft.articleId !== 'string'
      || typeof draft.revisionId !== 'string' || !/^[a-f0-9]{64}$/u.test(draft.contentSha256 ?? '')) {
      fail('AGENT_BLOG_PUBLICATION_DRAFT_REF_INVALID');
    }
    const publication = await publicationGateway.publish({
      agentUserId: context.run.agentUserId, runId: context.run.id, stageId: context.stage.id,
      workerId: execution.workerId, leaseToken: execution.leaseToken,
      idempotencyKey: `blog-foundation-publish:${context.run.id}`,
      articleId: draft.articleId, revisionId: draft.revisionId,
      contentSha256: draft.contentSha256,
    });
    if (publication.status !== 'succeeded' || publication.publicationState !== 'published') {
      fail('AGENT_BLOG_PUBLICATION_INCOMPLETE');
    }
    return {
      outputRef: { articleId: publication.articleId, revisionId: publication.revisionId,
        publicationState: 'published', ownershipGeneration: publication.ownershipGeneration,
        contentSha256: publication.contentSha256 },
      runOutput: { type: 'blog.article', id: publication.articleId },
    };
  };
  return handlers;
}

export function createAgentBlogFoundationShadowHandlers(dependencies = {}) {
  return createFoundationHandlers(dependencies, {
    workflow: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowKey,
    normalizeInputValue: normalizeBlogFoundationShadowInput,
  });
}

export function createAgentBlogFoundationPublicHandlers(dependencies = {}) {
  return createFoundationHandlers(dependencies, {
    workflow: BLOG_PROJECT_SINGLE_WORKFLOW.workflowKey,
    normalizeInputValue: normalizeBlogFoundationPublicInput,
  });
}

export function createAgentBlogFoundationShadowCanary({ runtimeRepository, enabled = false } = {}) {
  if (!runtimeRepository) fail('AGENT_BLOG_SHADOW_RUNTIME_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('AGENT_BLOG_SHADOW_CANARY_DISABLED'); };
  return {
    async register(actorUserId) {
      requireEnabled();
      const registered = await runtimeRepository.registerWorkflow({ actorUserId,
        manifest: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(
        BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowKey,
        BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowVersion,
      );
      return BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW;
    },
    async createRun({ agentUserId, triggerKind = 'manual', triggerRef = null, idempotencyKey, input, config = {} }) {
      requireEnabled();
      const normalized = normalizeBlogFoundationShadowInput(input);
      return runtimeRepository.createRun({
        agentUserId, workflowKey: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowKey,
        workflowVersion: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.workflowVersion,
        triggerKind, triggerRef, idempotencyKey, input: normalized, config,
        budget: BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.defaultBudget,
      });
    },
  };
}
