const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const artifactId = crypto.randomUUID();
const agentUserId = crypto.randomUUID();
const content = {
  slug: 'foundation-private-draft', locale: 'zh-CN', title: '私有草稿输出边界',
  summary: '这是一份用于验证基座私有草稿输出边界的结构化文章摘要。',
  blocks: [{ type: 'paragraph', text: '只有经过策略授权并绑定已验证研究产物后，基座才能保存私有草稿。' }],
  citations: [],
};

test('blog foundation draft gateway authorizes one fixed private-draft action and never exposes publish', async () => {
  const { createAgentBlogFoundationDraftGateway } = await load('agent-blog-foundation-draft.mjs');
  const calls = [];
  const gateway = createAgentBlogFoundationDraftGateway({
    runtimeRepository: {
      createAction: async input => (calls.push(['prepare', input]), { id: 'action', existing: false, status: 'prepared' }),
      transitionAction: async input => (calls.push([input.to, input]), {}),
    },
    draftRepository: { getByAction: async () => null, persist: async input => (calls.push(['persist', input]), {
      articleId: 'article', revisionId: 'revision', publicationState: 'draft', existing: false,
    }) },
    policyService: { decide: async input => (calls.push(['policy', input]), { decision: 'allow', reasonCodes: [], agentUserId }) },
  });
  const result = await gateway.persist({ agentUserId, runId: 'run', stageId: 'stage', workerId: 'worker', leaseToken: 'lease',
    idempotencyKey: 'foundation-draft-test', content, sourceArtifactIds: [artifactId] });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.publicationState, 'draft');
  assert.deepEqual(calls.map(item => item[0]), ['policy', 'prepare', 'authorized', 'persist']);
  assert.deepEqual(calls[0][1].action, {
    actionKey: 'persist-draft', actionKind: 'domain-write', capabilityKey: 'blog.article.draft',
    contractVersion: 1, riskLevel: 'L2',
  });
  assert.equal(calls[0][1].resource.type, 'blog.private-draft');
  assert.equal(calls[0][1].resource.owner, agentUserId);
  assert.equal(JSON.stringify(calls).includes('blog.article.publish'), false);
  assert.equal(JSON.stringify(calls).includes('publicationState":"published'), false);
});

test('blog foundation draft gateway parks confirmation and does not write', async () => {
  const { createAgentBlogFoundationDraftGateway } = await load('agent-blog-foundation-draft.mjs');
  let persisted = false;
  const gateway = createAgentBlogFoundationDraftGateway({
    runtimeRepository: {
      createAction: async () => ({ id: 'action', existing: false, status: 'prepared' }),
      waitForActionConfirmation: async () => ({}),
    },
    draftRepository: { getByAction: async () => null, persist: async () => { persisted = true; } },
    policyService: { decide: async () => ({ decision: 'require-confirmation', reasonCodes: [], agentUserId }) },
  });
  const result = await gateway.persist({ agentUserId, runId: 'run', stageId: 'stage', workerId: 'worker', leaseToken: 'lease',
    idempotencyKey: 'foundation-draft-confirm', content, sourceArtifactIds: [artifactId] });
  assert.equal(result.status, 'waiting-confirmation');
  assert.equal(persisted, false);
});
