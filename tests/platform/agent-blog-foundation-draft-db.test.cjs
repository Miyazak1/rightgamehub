const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('Agent foundation persists one evidence-bound private draft and cannot publish it', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
  const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
  const { createAgentToolGateway } = await harness.load('agent-tool-gateway.mjs');
  const { PostgresAgentBlogFoundationDraftRepository } = await harness.load('agent-blog-foundation-draft-repository.mjs');
  const { createAgentBlogFoundationDraftGateway } = await harness.load('agent-blog-foundation-draft.mjs');
  const { createAgentRuntimeReadService } = await harness.load('agent-runtime-read-service.mjs');
  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Draft operator','admin')", [operatorId]);
  const accounts = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true });
  const account = await accounts.provision({ userId: operatorId }, {
    provisionKey: `draft-${crypto.randomUUID()}`, displayName: 'Draft Agent',
    handle: `draft-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手', operatorLabel: 'Draft test',
    capabilities: ['blog:auto-publish'], metadata: {},
  });
  const runtime = new PostgresAgentRuntimeRepository(admin);
  const workflow = {
    schemaVersion: 'agent-workflow-v1', workflowKey: `draft.test.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'draft-test-input-v1', outputSchema: 'blog-private-draft-output-v1',
    requiredCapabilities: [{ key: 'research.github.read', version: 1 }, { key: 'blog.article.draft', version: 1 }],
    defaultBudget: { providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
    stages: [
      { key: 'collect-evidence', kind: 'tool', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30,
        capability: { key: 'research.github.read', version: 1 }, idempotencyMode: 'key' },
      { key: 'persist-draft', kind: 'domain-write', dependsOn: ['collect-evidence'], maxAttempts: 1, timeoutSeconds: 30,
        capability: { key: 'blog.article.draft', version: 1 }, idempotencyMode: 'queryable' },
    ],
  };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: workflow });
  await runtime.activateWorkflow(workflow.workflowKey, 1);
  const run = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: workflow.workflowKey, workflowVersion: 1,
    triggerKind: 'manual', idempotencyKey: `draft-run:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const evidenceStage = await runtime.claimNextStage('draft-worker', 30, [`${workflow.workflowKey}:collect-evidence`]);
  await runtime.startStage({ stageId: evidenceStage.id, workerId: evidenceStage.leasedBy, leaseToken: evidenceStage.leaseToken });
  const toolRepository = new PostgresAgentToolGatewayRepository(admin);
  const fixtureTool = {
    toolKey: `research.github.fixture.${crypto.randomBytes(5).toString('hex')}`, contractVersion: 1, status: 'active',
    capabilityKey: 'research.github.read', riskLevel: 'L1', executionClass: 'in-process', effectClass: 'read-only',
    inputSchema: { key: 'github.repository.read.input', version: 1 },
    outputSchema: { key: 'github.repository.read.output', version: 1 },
    networkPolicy: {}, filesystemPolicy: {}, timeoutSeconds: 30, outputLimitBytes: 131072,
  };
  await toolRepository.registerTool(fixtureTool);
  const policyService = createAgentRuntimePolicyService({ pool: admin });
  const evidenceOutput = { schemaVersion: 'fixture-evidence-v1', repository: { key: 'owner/project' },
    sourceVersion: { revision: 'b'.repeat(40) }, metadata: { stars: 42 }, readme: { text: 'Evidence fixture' } };
  const toolGateway = createAgentToolGateway({
    runtimeRepository: runtime, toolRepository, policyService,
    adapters: { [`${fixtureTool.toolKey}@1`]: async () => ({
      receiptId: `github:owner/project@${'b'.repeat(40)}`, output: evidenceOutput,
      responseRef: { canonicalUri: 'https://github.com/owner/project', revision: 'b'.repeat(40) }, usage: { toolCalls: 1 },
    }) },
    inputSchemas: { 'github.repository.read.input@1': value => value },
    outputSchemas: { 'github.repository.read.output@1': value => value },
  });
  const evidence = await toolGateway.invoke({
    runId: run.id, stageId: evidenceStage.id, workerId: evidenceStage.leasedBy, leaseToken: evidenceStage.leaseToken,
    action: { actionKey: 'read-repository', actionKind: 'tool', capabilityKey: 'research.github.read', contractVersion: 1, riskLevel: 'L1' },
    idempotencyKey: `evidence:${run.id}`, resource: { type: 'github.repository', owner: 'public', id: 'owner/project' },
    tool: { toolKey: fixtureTool.toolKey, contractVersion: 1 }, request: { repository: 'owner/project' },
  });
  await runtime.completeStage({ stageId: evidenceStage.id, workerId: evidenceStage.leasedBy,
    leaseToken: evidenceStage.leaseToken, outputRef: { artifactId: evidence.artifactId } });
  const draftStage = await runtime.claimNextStage('draft-worker', 30, [`${workflow.workflowKey}:persist-draft`]);
  await runtime.startStage({ stageId: draftStage.id, workerId: draftStage.leasedBy, leaseToken: draftStage.leaseToken });
  const draftRepository = new PostgresAgentBlogFoundationDraftRepository(admin);
  const gateway = createAgentBlogFoundationDraftGateway({ runtimeRepository: runtime, draftRepository, policyService });
  const content = {
    slug: `foundation-${crypto.randomBytes(6).toString('hex')}`, locale: 'zh-CN', title: '基座生成的私有研究草稿',
    summary: '这篇结构化草稿只用于验证证据绑定、幂等保存和禁止自动发布的基座边界。',
    blocks: [{ type: 'paragraph', text: '文章内容来自同一运行中不可变且受大小限制的工具研究产物。' }], citations: [],
  };
  await assert.rejects(gateway.persist({ agentUserId: account.agentUserId, runId: run.id,
    stageId: draftStage.id, workerId: draftStage.leasedBy, leaseToken: draftStage.leaseToken,
    idempotencyKey: `unverified:${run.id}`, content, sourceArtifactIds: [crypto.randomUUID()] }),
  error => error.code === 'AGENT_BLOG_DRAFT_SOURCE_ARTIFACTS_UNVERIFIED');
  const input = { agentUserId: account.agentUserId, runId: run.id, stageId: draftStage.id, workerId: draftStage.leasedBy,
    leaseToken: draftStage.leaseToken, idempotencyKey: `persist:${run.id}`, content,
    sourceArtifactIds: [evidence.artifactId] };
  const draft = await gateway.persist(input);
  assert.equal(draft.status, 'succeeded');
  assert.equal(draft.publicationState, 'draft');
  const replay = await gateway.persist(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.articleId, draft.articleId);
  const stored = (await admin.query(`SELECT article.*,revision.revision_state,mapping.source_artifact_ids,
      (SELECT count(*)::int FROM blog_article_events event WHERE event.article_id=article.id AND event.action='published') AS publish_events
    FROM agent_blog_foundation_drafts mapping
    JOIN blog_articles article ON article.id=mapping.article_id
    JOIN blog_article_revisions revision ON revision.id=mapping.revision_id
    WHERE mapping.run_id=$1`, [run.id])).rows[0];
  assert.equal(stored.publication_state, 'draft');
  assert.equal(stored.published_revision_id, null);
  assert.equal(stored.first_published_at, null);
  assert.equal(stored.last_published_at, null);
  assert.equal(stored.revision_state, 'working');
  assert.equal(stored.publish_events, 0);
  assert.deepEqual(stored.source_artifact_ids, [evidence.artifactId]);
  await assert.rejects(admin.query('UPDATE agent_blog_foundation_drafts SET content_sha256=$2 WHERE run_id=$1',
    [run.id, 'c'.repeat(64)]), /immutable/u);
  await runtime.completeStage({ stageId: draftStage.id, workerId: draftStage.leasedBy, leaseToken: draftStage.leaseToken,
    outputRef: { articleId: draft.articleId, publicationState: 'draft' },
    runOutput: { type: 'blog.private-draft', id: draft.articleId } });
  const timeline = await createAgentRuntimeReadService({ pool: admin, authorizeOperator: async () => true })
    .timeline({ userId: operatorId }, account.agentUserId, run.id);
  assert.equal(timeline.foundationDrafts.length, 1);
  assert.equal(timeline.foundationDrafts[0].publicationState, 'draft');
  assert.equal(Object.hasOwn(timeline.foundationDrafts[0], 'content'), false);
  await admin.end();
});
