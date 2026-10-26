const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

test('candidate handoff is disabled by default and creates a draft Run from the immutable candidate artifact', async () => {
  const { createAgentBlogCandidateDraftHandoffCanary } = await load('agent-blog-candidate-handoff.mjs');
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const sourceRunId = crypto.randomUUID();
  const sourceArtifactId = crypto.randomUUID();
  const calls = [];
  const artifactRepository = { read: async request => {
    assert.deepEqual(request, { runId: sourceRunId, artifactId: sourceArtifactId,
      expectedArtifactKey: 'blog.candidate-set' });
    return { id: sourceArtifactId, runId: sourceRunId, artifactKey: 'blog.candidate-set',
      schema: { key: 'blog.candidate.discovery', version: 1 }, contentSha256: 'a'.repeat(64),
      content: { schemaVersion: 'blog-candidate-set-v1', topicScope: '寻找有用的开源工具',
        candidates: [{ canonicalUrl: 'https://github.com/owner/project' }] } };
  } };
  const runtimeRepository = {
    registerWorkflow: async () => ({ status: 'active' }),
    activateWorkflow: async () => assert.fail('active workflow must not be activated again'),
    createRun: async request => { calls.push(request); return { id: crypto.randomUUID(), status: 'queued' }; },
  };
  const disabled = createAgentBlogCandidateDraftHandoffCanary({ runtimeRepository, artifactRepository });
  await assert.rejects(disabled.createDraftRun({}), error => error.code === 'AGENT_BLOG_HANDOFF_CANARY_DISABLED');

  const canary = createAgentBlogCandidateDraftHandoffCanary({ runtimeRepository, artifactRepository, enabled: true });
  const result = await canary.createDraftRun({
    agentUserId: crypto.randomUUID(), discoveryRunId: sourceRunId, discoveryArtifactId: sourceArtifactId,
    idempotencyKey: `handoff:${crypto.randomUUID()}`, behaviorProfile: defaultAgentBehaviorProfile(),
  });
  assert.equal(result.status, 'queued');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input.candidateRepositories, ['https://github.com/owner/project']);
  assert.deepEqual(calls[0].handoff, {
    kind: 'blog.candidate-set-to-private-draft', sourceRunId, sourceArtifactId,
    sourceOutputType: 'blog.candidate-set', sourceArtifactKey: 'blog.candidate-set',
    sourceContentSha256: 'a'.repeat(64),
  });
  assert.equal(calls[0].workflowKey, 'blog.project.single.draft-shadow');
  assert.equal(Object.hasOwn(calls[0], 'publish'), false);
});

test('public candidate handoff targets only the public workflow and keeps immutable lineage', async () => {
  const { createAgentBlogCandidatePublicHandoff } = await load('agent-blog-candidate-handoff.mjs');
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const sourceRunId = crypto.randomUUID(), sourceArtifactId = crypto.randomUUID();
  const calls = [];
  const handoff = createAgentBlogCandidatePublicHandoff({
    enabled: true,
    artifactRepository: { read: async () => ({
      id: sourceArtifactId, artifactKey: 'blog.candidate-set',
      schema: { key: 'blog.candidate.discovery', version: 1 }, contentSha256: 'b'.repeat(64),
      content: { schemaVersion: 'blog-candidate-set-v1', topicScope: '寻找有用的开源工具',
        candidates: [{ canonicalUrl: 'https://github.com/owner/public-project' }] },
    }) },
    runtimeRepository: {
      registerWorkflow: async () => ({ status: 'active' }),
      activateWorkflow: async () => assert.fail('active workflow must not be activated again'),
      createRun: async input => { calls.push(input); return { id: crypto.randomUUID(), status: 'queued' }; },
    },
  });
  await handoff.createDraftRun({
    agentUserId: crypto.randomUUID(), discoveryRunId: sourceRunId,
    discoveryArtifactId: sourceArtifactId, idempotencyKey: `public:${crypto.randomUUID()}`,
    behaviorProfile: defaultAgentBehaviorProfile(),
  });
  assert.equal(calls[0].workflowKey, 'blog.project.single');
  assert.equal(calls[0].input.schemaVersion, 'blog-project-single-input-v1');
  assert.deepEqual(calls[0].handoff, {
    kind: 'blog.candidate-set-to-public-article', sourceRunId, sourceArtifactId,
    sourceOutputType: 'blog.candidate-set', sourceArtifactKey: 'blog.candidate-set',
    sourceContentSha256: 'b'.repeat(64),
  });
});
