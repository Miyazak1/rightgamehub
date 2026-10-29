const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const uuid = () => crypto.randomUUID();

test('shadow assembly freezes candidates, collects governed evidence and persists only a private draft', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const { createAgentBlogFoundationShadowHandlers } = await load('agent-blog-foundation-shadow.mjs');
  const runId = uuid();
  const agentUserId = uuid();
  const input = {
    schemaVersion: 'blog-project-single-shadow-input-v1',
    topicScope: '发现有趣、有用且证据完整的开源工具',
    candidateRepositories: ['https://github.com/Owner/Project', 'other/tool'],
    recentTitles: ['最近文章'], previousRepositoryUrls: [],
    behaviorProfile: defaultAgentBehaviorProfile(),
  };
  const run = { id: runId, agentUserId, input, inputSha256: stableHash(input), configSnapshot: {} };
  const execution = { workerId: 'shadow-worker', leaseToken: uuid() };
  const toolCalls = [];
  const toolArtifacts = [uuid(), uuid()];
  const toolActions = [uuid(), uuid()];
  const toolGateway = { invoke: async request => {
    toolCalls.push(request);
    return { status: 'succeeded', actionId: toolActions[toolCalls.length - 1],
      artifactId: toolArtifacts[toolCalls.length - 1] };
  } };
  const archivedEvidence = [];
  const researchEvidenceRepository = { archiveGitHubRepositoryArtifact: async request => {
    archivedEvidence.push(request);
    return { id: uuid(), evidenceCount: 2 };
  } };
  const compositionArtifactId = uuid();
  const verificationArtifactId = uuid();
  const sources = [...toolArtifacts];
  const content = { slug: 'agent-foundation-fixture', locale: 'zh-CN', title: '私有草稿',
    summary: '这是一篇只验证端到端私有草稿边界的测试文章摘要。',
    blocks: [{ type: 'paragraph', text: '测试正文。' }], citations: [] };
  const artifactRepository = { read: async ({ artifactId, expectedArtifactKey }) => {
    if (artifactId === verificationArtifactId && expectedArtifactKey === 'blog.verification') return {
      id: artifactId, content: { schemaVersion: 'blog-article-verification-v1', approved: true,
        compositionArtifactId, contentSha256: 'composition-sha', sourceToolArtifactIds: sources },
    };
    if (artifactId === compositionArtifactId && expectedArtifactKey === 'blog.composition') return {
      id: artifactId, contentSha256: 'composition-sha', content: {
        schemaVersion: 'blog-article-composition-v1', content, sourceToolArtifactIds: sources,
      },
    };
    throw new Error('unexpected artifact');
  } };
  let draftRequest;
  const draftGateway = { persist: async request => {
    draftRequest = request;
    return { status: 'succeeded', publicationState: 'draft', articleId: uuid(), revisionId: uuid() };
  } };
  const handlers = createAgentBlogFoundationShadowHandlers({
    toolGateway, providerGateway: { invoke: async () => { throw new Error('not used'); } },
    artifactRepository, draftGateway, researchEvidenceRepository,
  });
  const freezeRoute = 'blog.project.single.draft-shadow:freeze-input';
  const collectRoute = 'blog.project.single.draft-shadow:collect-evidence';
  const persistRoute = 'blog.project.single.draft-shadow:persist-draft';
  const frozen = await handlers[freezeRoute]({ run, stage: { id: uuid() }, prerequisites: [] }, execution);
  const evidence = await handlers[collectRoute]({ run, stage: { id: uuid() }, prerequisites: [
    { stageKey: 'freeze-input', status: 'succeeded', outputRef: frozen.outputRef },
  ] }, execution);
  assert.deepEqual(evidence.outputRef.artifactIds, toolArtifacts);
  assert.equal(evidence.outputRef.researchEvidenceBindingIds.length, 2);
  assert.deepEqual(archivedEvidence.map(item => item.toolArtifactId), toolArtifacts);
  assert.deepEqual(archivedEvidence.map(item => item.actionId), toolActions);
  assert(archivedEvidence.every(item => item.runId === runId
    && item.workerId === execution.workerId && item.leaseToken === execution.leaseToken));
  assert.deepEqual(toolCalls.map(item => item.request.repository), [
    'https://github.com/Owner/Project', 'https://github.com/other/tool',
  ]);
  assert(toolCalls.every(item => item.action.capabilityKey === 'research.github.read'
    && item.tool.toolKey === 'research.github.repository.materials.read'));
  const persisted = await handlers[persistRoute]({ run, stage: { id: uuid() }, prerequisites: [
    { stageKey: 'verify', status: 'succeeded', outputRef: {
      artifactId: verificationArtifactId, artifactKey: 'blog.verification', approved: true, compositionArtifactId,
    } },
  ] }, execution);
  assert.equal(persisted.outputRef.publicationState, 'draft');
  assert.equal(persisted.runOutput.type, 'blog.private-draft');
  assert.deepEqual(draftRequest.content, content);
  assert.deepEqual(draftRequest.sourceArtifactIds, toolArtifacts);
  assert.equal(draftRequest.verificationArtifactId, verificationArtifactId);
  assert.equal(Object.hasOwn(handlers, 'blog.project.single.draft-shadow:publish'), false);
});

test('shadow canary is disabled by default and rejects mutable or duplicate candidate input', async () => {
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const { createAgentBlogFoundationShadowCanary, normalizeBlogFoundationShadowInput } = await load('agent-blog-foundation-shadow.mjs');
  const runtimeRepository = { registerWorkflow: async () => { throw new Error('must not register'); } };
  const canary = createAgentBlogFoundationShadowCanary({ runtimeRepository });
  await assert.rejects(canary.register(uuid()), error => error.code === 'AGENT_BLOG_SHADOW_CANARY_DISABLED');
  const base = { schemaVersion: 'blog-project-single-shadow-input-v1', topicScope: '开源工具',
    candidateRepositories: ['owner/project'], recentTitles: [], previousRepositoryUrls: [],
    behaviorProfile: defaultAgentBehaviorProfile() };
  assert.deepEqual(normalizeBlogFoundationShadowInput(base).candidateRepositories,
    ['https://github.com/owner/project']);
  assert.throws(() => normalizeBlogFoundationShadowInput({ ...base,
    candidateRepositories: ['owner/project', 'https://github.com/owner/project'] }),
  error => error.code === 'AGENT_BLOG_SHADOW_CANDIDATES_INVALID');
  assert.throws(() => normalizeBlogFoundationShadowInput({ ...base, unexpected: true }),
  error => error.code === 'AGENT_BLOG_SHADOW_INPUT_INVALID');
});
