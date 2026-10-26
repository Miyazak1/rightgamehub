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

test('public workflow handler publishes only the exact persisted draft output', async () => {
  const { createAgentBlogFoundationPublicHandlers, normalizeBlogFoundationPublicInput } = await load(
    'agent-blog-foundation-shadow.mjs');
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const input = { schemaVersion: 'blog-project-single-input-v1', topicScope: '开源工具',
    candidateRepositories: ['owner/project'], recentTitles: [], previousRepositoryUrls: [],
    behaviorProfile: defaultAgentBehaviorProfile() };
  assert.equal(normalizeBlogFoundationPublicInput(input).candidateRepositories[0],
    'https://github.com/owner/project');
  let request = null;
  const handlers = createAgentBlogFoundationPublicHandlers({
    toolGateway: {}, providerGateway: {}, artifactRepository: {}, draftGateway: {},
    publicationGateway: { publish: async value => {
      request = value;
      return { status: 'succeeded', articleId: value.articleId, revisionId: value.revisionId,
        contentSha256: value.contentSha256, ownershipGeneration: 2, publicationState: 'published' };
    } },
  });
  const runId = uuid();
  const agentUserId = uuid();
  const articleId = uuid();
  const revisionId = uuid();
  const result = await handlers['blog.project.single:publish']({
    run: { id: runId, agentUserId }, stage: { id: uuid() }, prerequisites: [{
      stageKey: 'persist-draft', status: 'succeeded', outputRef: {
        articleId, revisionId, publicationState: 'draft', contentSha256: sha,
      },
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
  assert.match(repository, /verification_artifact_id == null/u);
});
