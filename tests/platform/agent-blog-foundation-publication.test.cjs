const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const uuid = () => crypto.randomUUID();
const sha = 'a'.repeat(64);

test('Foundation publication gateway authorizes one L3 publish action and is idempotent', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  const input = { agentUserId, runId: uuid(), stageId: uuid(), workerId: 'worker',
    leaseToken: uuid(), idempotencyKey: 'foundation-publication-test',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha };
  const calls = [];
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async value => (calls.push(['prepare', value]), {
        id: uuid(), existing: false, status: 'prepared',
      }),
      transitionAction: async value => (calls.push([value.to, value]), {}),
    },
    publicationRepository: { getByAction: async () => null, publish: async value => (
      calls.push(['publish', value]), { ...value, ownershipGeneration: 2,
        publicationState: 'published', existing: false }) },
    policyService: { decide: async value => (calls.push(['policy', value]), {
      decision: 'allow', reasonCodes: [], agentUserId,
    }) },
  });
  const result = await gateway.publish(input);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.publicationState, 'published');
  assert.deepEqual(calls.map(item => item[0]), ['policy', 'prepare', 'authorized', 'publish']);
  assert.deepEqual(calls[0][1].action, {
    actionKey: 'publish', actionKind: 'domain-write', capabilityKey: 'blog.article.publish',
    contractVersion: 1, riskLevel: 'L3',
  });
  assert.deepEqual(calls[0][1].resource, {
    type: 'blog.article', owner: agentUserId, id: input.articleId,
  });
  assert.equal(calls[1][1].request.schemaVersion, 'blog-foundation-publication-request-v1');
  assert.equal(calls[3][1].workerId, input.workerId);
  assert.equal(calls[3][1].leaseToken, input.leaseToken);
});

test('Foundation publication gateway leaves lease-lost action for stage recovery', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  const transitions = [];
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async () => ({ id: uuid(), existing: false, status: 'prepared' }),
      transitionAction: async value => (transitions.push(value), {}),
    },
    publicationRepository: {
      getByAction: async () => null,
      publish: async () => { throw Object.assign(new Error('lease lost'), {
        code: 'AGENT_RUNTIME_LEASE_LOST',
      }); },
    },
    policyService: { decide: async () => ({ decision: 'allow', reasonCodes: [], agentUserId }) },
  });
  await assert.rejects(gateway.publish({ agentUserId, runId: uuid(), stageId: uuid(),
    workerId: 'stale-worker', leaseToken: uuid(), idempotencyKey: 'foundation-lease-lost',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha }),
  error => error.code === 'AGENT_RUNTIME_LEASE_LOST');
  assert.deepEqual(transitions.map(item => item.to), ['authorized']);
});

test('Foundation publication gateway parks confirmation without changing the article', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  let published = false;
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async () => ({ id: uuid(), existing: false, status: 'prepared' }),
      waitForActionConfirmation: async () => ({}),
    },
    publicationRepository: { getByAction: async () => null, publish: async () => { published = true; } },
    policyService: { decide: async () => ({
      decision: 'require-confirmation', reasonCodes: [], agentUserId,
    }) },
  });
  const result = await gateway.publish({ agentUserId, runId: uuid(), stageId: uuid(),
    workerId: 'worker', leaseToken: uuid(), idempotencyKey: 'foundation-confirmation-test',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha });
  assert.equal(result.status, 'waiting-confirmation');
  assert.equal(published, false);
});

test('Foundation publication gateway recovers a committed receipt after the caller loses the response', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  const actionId = uuid();
  const input = { agentUserId, runId: uuid(), stageId: uuid(), workerId: 'worker',
    leaseToken: uuid(), idempotencyKey: 'foundation-publication-lost-response',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha };
  let receipt = null;
  const transitions = [];
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async () => ({ id: actionId, existing: false, status: 'prepared' }),
      transitionAction: async value => (transitions.push(value), {}),
    },
    publicationRepository: {
      getByAction: async () => receipt,
      publish: async () => {
        receipt = { actionId, articleId: input.articleId, revisionId: input.revisionId,
          contentSha256: input.contentSha256, publicationState: 'published',
          ownershipGeneration: 3 };
        throw Object.assign(new Error('connection lost after commit'), { code: 'ECONNRESET' });
      },
    },
    policyService: { decide: async () => ({ decision: 'allow', reasonCodes: [], agentUserId }) },
  });
  const result = await gateway.publish(input);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.replayed, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.ownershipGeneration, 3);
  assert.deepEqual(transitions.map(item => item.to), ['authorized']);
});

test('Foundation publication gateway settles a proven pre-commit failure without retrying', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  const transitions = [];
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async () => ({ id: uuid(), existing: false, status: 'prepared' }),
      transitionAction: async value => (transitions.push(value), {}),
    },
    publicationRepository: {
      publish: async () => { throw Object.assign(new Error('rolled back before commit'), {
        code: 'AGENT_BLOG_PUBLICATION_DRAFT_STATE_CHANGED',
      }); },
      getByAction: async () => null,
    },
    policyService: { decide: async () => ({ decision: 'allow', reasonCodes: [], agentUserId }) },
  });
  await assert.rejects(gateway.publish({ agentUserId, runId: uuid(), stageId: uuid(),
    workerId: 'worker', leaseToken: uuid(), idempotencyKey: 'foundation-publication-pre-commit',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha }),
  error => error.code === 'AGENT_BLOG_PUBLICATION_DRAFT_STATE_CHANGED');
  assert.deepEqual(transitions.map(item => item.to), ['authorized', 'failed']);
});

test('Foundation publication gateway reconciles a receipt committed during failure settlement', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  const input = { agentUserId, runId: uuid(), stageId: uuid(), workerId: 'worker',
    leaseToken: uuid(), idempotencyKey: 'foundation-publication-concurrent-settlement',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha };
  let reads = 0;
  const receipt = { articleId: input.articleId, revisionId: input.revisionId,
    contentSha256: input.contentSha256, publicationState: 'published', ownershipGeneration: 4 };
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async () => ({ id: uuid(), existing: false, status: 'prepared' }),
      transitionAction: async value => {
        if (value.to === 'failed') throw Object.assign(new Error('state already succeeded'), {
          code: 'AGENT_ACTION_STATE_CONFLICT',
        });
      },
    },
    publicationRepository: {
      publish: async () => { throw Object.assign(new Error('commit outcome delayed'), { code: 'ECONNRESET' }); },
      getByAction: async () => (++reads === 1 ? null : receipt),
    },
    policyService: { decide: async () => ({ decision: 'allow', reasonCodes: [], agentUserId }) },
  });
  const result = await gateway.publish(input);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.reconciled, true);
  assert.equal(result.ownershipGeneration, 4);
  assert.equal(reads, 2);
});

test('Foundation publication gateway fails closed when the committed outcome cannot be queried', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  const gateway = createAgentBlogFoundationPublicationGateway({
    runtimeRepository: {
      createAction: async () => ({ id: uuid(), existing: false, status: 'prepared' }),
      transitionAction: async () => ({}),
    },
    publicationRepository: {
      publish: async () => { throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }); },
      getByAction: async () => { throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' }); },
    },
    policyService: { decide: async () => ({ decision: 'allow', reasonCodes: [], agentUserId }) },
  });
  await assert.rejects(gateway.publish({ agentUserId, runId: uuid(), stageId: uuid(),
    workerId: 'worker', leaseToken: uuid(), idempotencyKey: 'foundation-publication-unknown',
    articleId: uuid(), revisionId: uuid(), contentSha256: sha }), error => (
    error.code === 'AGENT_BLOG_PUBLICATION_OUTCOME_UNCERTAIN'
      && error.uncertain === true && error.retryable === false));
});

test('Foundation publication gateway rejects a mismatched replay receipt', async () => {
  const { createAgentBlogFoundationPublicationGateway } = await load(
    'agent-blog-foundation-publication.mjs');
  const agentUserId = uuid();
  await assert.rejects(createAgentBlogFoundationPublicationGateway({
    runtimeRepository: { createAction: async () => ({ id: uuid(), existing: true, status: 'succeeded' }) },
    publicationRepository: { getByAction: async () => ({ articleId: uuid(), revisionId: uuid(),
      contentSha256: sha, publicationState: 'published' }) },
    policyService: { decide: async () => ({ decision: 'allow', reasonCodes: [], agentUserId }) },
  }).publish({ agentUserId, runId: uuid(), stageId: uuid(), workerId: 'worker', leaseToken: uuid(),
    idempotencyKey: 'foundation-publication-conflict', articleId: uuid(), revisionId: uuid(),
    contentSha256: sha }), error => error.code === 'AGENT_BLOG_PUBLICATION_IDEMPOTENCY_CONFLICT');
});

test('public workflow handler publishes only the exact persisted draft output', async () => {
  const { createAgentBlogFoundationPublicHandlers, normalizeBlogFoundationPublicInput } = await load(
    'agent-blog-foundation-shadow.mjs');
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const input = { schemaVersion: 'blog-project-single-input-v1', topicScope: '开源工具',
    candidateRepositories: ['owner/project'], recentTitles: [], previousRepositoryUrls: [],
    behaviorProfile: defaultAgentBehaviorProfile() };
  assert.equal(normalizeBlogFoundationPublicInput(input).candidateRepositories[0],
    'https://github.com/owner/project');
  const verificationArtifactId = uuid();
  const compositionArtifactId = uuid();
  const articleId = uuid();
  const revisionId = uuid();
  let request = null;
  const handlers = createAgentBlogFoundationPublicHandlers({
    toolGateway: {}, providerGateway: {}, artifactRepository: { read: async inputValue => {
      if (inputValue.artifactId === verificationArtifactId) return {
        id: verificationArtifactId,
        content: { schemaVersion: 'blog-article-verification-v1', approved: true,
          compositionArtifactId, contentSha256: sha, sourceToolArtifactIds: [] },
      };
      if (inputValue.artifactId === compositionArtifactId) return {
        id: compositionArtifactId, contentSha256: sha,
        content: { schemaVersion: 'blog-article-composition-v1', sourceToolArtifactIds: [],
          content: { slug: 'public-handler-test', locale: 'zh-CN', title: '公开流程测试',
            summary: '验证草稿阶段不会提前结束公开工作流。', blocks: [], citations: [] } },
      };
      throw new Error('unexpected artifact');
    } },
    draftGateway: { persist: async () => ({ status: 'succeeded', publicationState: 'draft',
      articleId, revisionId, contentSha256: sha }) },
    publicationGateway: { publish: async value => {
      request = value;
      return { status: 'succeeded', articleId: value.articleId, revisionId: value.revisionId,
        contentSha256: value.contentSha256, ownershipGeneration: 2, publicationState: 'published' };
    } },
  });
  const runId = uuid();
  const agentUserId = uuid();
  const draft = await handlers['blog.project.single:persist-draft']({
    run: { id: runId, agentUserId }, stage: { id: uuid() }, prerequisites: [{
      stageKey: 'verify', status: 'succeeded', outputRef: {
        artifactId: verificationArtifactId, artifactKey: 'blog.verification', approved: true,
        compositionArtifactId,
      },
    }],
  }, { workerId: 'public-worker', leaseToken: uuid() });
  assert.equal(draft.outputRef.publicationState, 'draft');
  assert.equal(Object.hasOwn(draft, 'runOutput'), false);
  const result = await handlers['blog.project.single:publish']({
    run: { id: runId, agentUserId }, stage: { id: uuid() }, prerequisites: [{
      stageKey: 'persist-draft', status: 'succeeded', outputRef: draft.outputRef,
    }],
  }, { workerId: 'public-worker', leaseToken: uuid() });
  assert.equal(result.runOutput.type, 'blog.article');
  assert.equal(result.outputRef.publicationState, 'published');
  assert.equal(request.runId, runId);
  assert.equal(request.articleId, articleId);
  assert.equal(request.idempotencyKey, `blog-foundation-publish:${runId}`);
});

test('publication receipt is immutable and repository rechecks Foundation ownership in transaction', () => {
  const migration = fs.readFileSync(path.join(root,
    'apps/api/migrations/0138_agent_blog_foundation_publications.sql'), 'utf8');
  const repository = fs.readFileSync(path.join(root,
    'apps/api/src/agent-blog-foundation-publication-repository.mjs'), 'utf8');
  assert.match(migration, /action_id uuid NOT NULL UNIQUE/u);
  assert.match(migration, /article_id uuid NOT NULL UNIQUE/u);
  assert.match(migration, /publication receipts are immutable/u);
  const guard = repository.indexOf("assertPublisher(\n        client, action.agent_user_id, 'foundation')");
  const articleUpdate = repository.indexOf('UPDATE blog_articles SET', guard);
  assert.ok(guard > -1);
  assert.ok(articleUpdate > guard);
  assert.match(repository, /workflow_key !== 'blog\.project\.single'/u);
  assert.match(repository, /stage_lease_token !== leaseToken/u);
  assert.match(repository, /stage_lease_valid !== true/u);
  assert.match(repository, /verification_artifact_id == null/u);
  const publishUpdate = repository.indexOf('UPDATE blog_articles SET', guard);
  const memoryWrite = repository.indexOf('this.editorialMemoryRecorder(client', publishUpdate);
  const transactionReturn = repository.indexOf("boundary: 'before-commit'", memoryWrite);
  assert.ok(memoryWrite > publishUpdate);
  assert.ok(transactionReturn > memoryWrite);
  assert.match(repository, /boundary: 'before-commit'/u);
  assert.match(repository, /boundary: 'after-commit'/u);
});
