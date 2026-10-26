const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('draft shadow workflow runs end to end and has zero publication authority', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { defaultAgentBehaviorProfile } = await harness.load('agent-behavior-profile.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { createAgentRuntimeWorker } = await harness.load('agent-runtime-worker.mjs');
  const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
  const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
  const { createAgentToolGateway } = await harness.load('agent-tool-gateway.mjs');
  const { GITHUB_REPOSITORY_READ_TOOL, validateGitHubRepositoryReadInput,
    validateGitHubRepositoryReadOutput } = await harness.load('agent-github-repository-tool.mjs');
  const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
  const { createAgentProviderGateway } = await harness.load('agent-provider-gateway.mjs');
  const { createAgentSecretVault } = await harness.load('agent-secret-vault.mjs');
  const { BLOG_FOUNDATION_RESPONSE_SCHEMAS } = await harness.load('agent-blog-foundation-generation.mjs');
  const { PostgresAgentRuntimeStageArtifactRepository } = await harness.load('agent-runtime-stage-artifact-repository.mjs');
  const { PostgresAgentBlogFoundationDraftRepository } = await harness.load('agent-blog-foundation-draft-repository.mjs');
  const { createAgentBlogFoundationDraftGateway } = await harness.load('agent-blog-foundation-draft.mjs');
  const { createAgentBlogFoundationShadowHandlers,
    createAgentBlogFoundationShadowCanary } = await harness.load('agent-blog-foundation-shadow.mjs');

  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Shadow canary operator','admin')", [operatorId]);
  const accounts = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true });
  const account = await accounts.provision({ userId: operatorId }, {
    provisionKey: `shadow-canary-${crypto.randomUUID()}`, displayName: '小墨鱼',
    handle: `shadow-canary-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
    operatorLabel: 'Shadow canary', capabilities: ['blog:auto-publish'], metadata: {},
  });
  const runtime = new PostgresAgentRuntimeRepository(admin);
  const canary = createAgentBlogFoundationShadowCanary({ runtimeRepository: runtime, enabled: true });
  const workflow = await canary.register(operatorId);
  assert.equal(workflow.stages.some(stage => stage.key === 'publish'), false);

  const policyService = createAgentRuntimePolicyService({ pool: admin });
  const toolRepository = new PostgresAgentToolGatewayRepository(admin);
  await toolRepository.registerTool(GITHUB_REPOSITORY_READ_TOOL);
  const revision = 'a'.repeat(40);
  const repositoryOutput = {
    schemaVersion: 'github-repository-evidence-v1',
    repository: { key: 'owner/project', canonicalUrl: 'https://github.com/owner/project', owner: 'owner', name: 'project' },
    sourceVersion: { revision, canonicalUri: `https://github.com/owner/project/tree/${revision}`,
      fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'b'.repeat(64) },
    metadata: { name: 'project', fullName: 'owner/project',
      description: '一个可以快速体验、把复杂任务变成清晰步骤的开放工具。', homepage: null,
      defaultBranch: 'main', stars: 1200, forks: 100, openIssues: 12,
      topics: ['tool'], licenseSpdx: 'MIT', archived: false, pushedAt: '2026-10-25T00:00:00.000Z' },
    readme: { canonicalUri: `https://github.com/owner/project/blob/${revision}/README.md`, path: 'README.md',
      text: '这个项目提供可复现的安装步骤、清晰的输入输出和本地运行方式。使用者可以在几分钟内看到结果，并按文档逐步扩展。' },
  };
  const toolGateway = createAgentToolGateway({
    runtimeRepository: runtime, toolRepository, policyService,
    adapters: { 'research.github.repository.read@1': async () => ({
      receiptId: `github:owner/project@${revision}`, output: repositoryOutput,
      responseRef: { canonicalUri: repositoryOutput.sourceVersion.canonicalUri, revision }, usage: { toolCalls: 1 },
    }) },
    inputSchemas: { 'github.repository.read.input@1': validateGitHubRepositoryReadInput },
    outputSchemas: { 'github.repository.read.output@1': validateGitHubRepositoryReadOutput },
  });

  const governance = new PostgresAgentProviderGatewayRepository(admin, {
    agentMonthlyLimits: { providerCalls: 20, inputTokens: 200000, outputTokens: 50000, costMicrousd: 100000000 },
    platformMonthlyLimits: { providerCalls: 200, inputTokens: 2000000, outputTokens: 500000, costMicrousd: 1000000000 },
  });
  await governance.registerModel({ provider: 'deepseek', modelId: 'fixture-blog', catalogVersion: 1, status: 'active',
    taskClasses: ['structured-generation'], supportsJsonSchema: true, maxInputTokens: 60000, maxOutputTokens: 7000,
    inputPriceMicrousdPerMillion: 2000000, outputPriceMicrousdPerMillion: 4000000, config: { fixture: true } });
  const vault = createAgentSecretVault({ masterKey: 'cd'.repeat(32) });
  const encrypted = vault.encrypt(account.agentUserId, 'deepseek', 'fixture-shadow-secret-key');
  await admin.query(`INSERT INTO agent_provider_secrets(
    agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id
  ) VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`, [account.agentUserId, encrypted.ciphertext, encrypted.nonce,
    encrypted.authTag, encrypted.fingerprint, encrypted.lastFour, operatorId]);
  const longParagraph = '这个项目把原本分散的操作整理成可以观察和复现的步骤，读者能先完成最小体验，再根据自己的目标逐步增加能力。'.repeat(8);
  let providerInvocations = 0;
  const providerGateway = createAgentProviderGateway({
    runtimeRepository: runtime, governanceRepository: governance, policyService, secretVault: vault,
    adapters: { deepseek: async request => {
      providerInvocations += 1;
      const output = request.responseSchema.key === 'blog.subject.selection'
        ? { mode: 'single', selectedIndexes: [1], angle: '先验证最小路径，再理解它如何降低上手门槛',
          rationale: '仓库资料给出了明确安装步骤、可观察结果和本地运行方式，适合面向普通读者解释其实际价值。',
          interestSignals: ['可以快速体验'], comparisonAxes: [] }
        : { title: '先跑通最小路径，再理解这个开放工具',
          summary: '这篇文章依据仓库的固定版本资料，说明如何快速完成最小体验、适用边界以及继续探索的方法。',
          blocks: [
            { type: 'heading', level: 2, text: '它解决了什么问题' },
            { type: 'paragraph', text: longParagraph, citationIndexes: [1] },
            { type: 'heading', level: 2, text: '如何开始体验' },
            { type: 'paragraph', text: longParagraph, citationIndexes: [1] },
            { type: 'heading', level: 2, text: '适合谁来使用' },
            { type: 'paragraph', text: longParagraph, citationIndexes: [1] },
          ],
          followUpQuestions: ['第一次体验应该从哪一步开始？', '哪些使用场景最适合这个工具？', '继续扩展时应注意哪些边界？'] };
      return { providerRequestId: `fixture:${crypto.randomUUID()}`, output, responseRef: {},
        usage: { providerCalls: 1, inputTokens: 500, outputTokens: 1200, costMicrousd: 10 } };
    } },
    responseSchemas: BLOG_FOUNDATION_RESPONSE_SCHEMAS,
  });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(admin);
  const draftGateway = createAgentBlogFoundationDraftGateway({ runtimeRepository: runtime,
    draftRepository: new PostgresAgentBlogFoundationDraftRepository(admin), policyService });
  const handlers = createAgentBlogFoundationShadowHandlers({ toolGateway, providerGateway, artifactRepository, draftGateway });
  const input = { schemaVersion: 'blog-project-single-shadow-input-v1',
    topicScope: '发现有趣、有用且证据完整的开源工具', candidateRepositories: ['owner/project'],
    recentTitles: [], previousRepositoryUrls: [], behaviorProfile: defaultAgentBehaviorProfile() };
  const run = await canary.createRun({ agentUserId: account.agentUserId, idempotencyKey: `shadow:${crypto.randomUUID()}`,
    input, config: { model: { provider: 'deepseek', modelId: 'fixture-blog' } } });
  const worker = createAgentRuntimeWorker({ repository: runtime, handlers,
    workerId: `shadow-canary-${crypto.randomBytes(4).toString('hex')}`, leaseSeconds: 30, heartbeatSeconds: 5 });
  const results = [];
  for (let index = 0; index < workflow.stages.length; index += 1) results.push(await worker.runOnce());
  assert(results.every(result => result.status === 'completed'));
  assert.equal(providerInvocations, 2);
  const storedRun = (await admin.query('SELECT * FROM agent_runs WHERE id=$1', [run.id])).rows[0];
  assert.equal(storedRun.status, 'succeeded');
  assert.equal(storedRun.output_type, 'blog.private-draft');
  const draft = (await admin.query(`SELECT mapping.*,article.publication_state,article.published_revision_id,
      revision.revision_state,revision.title,
      (SELECT count(*)::int FROM blog_article_events event WHERE event.article_id=article.id AND event.action='published') AS publish_events
    FROM agent_blog_foundation_drafts mapping
    JOIN blog_articles article ON article.id=mapping.article_id
    JOIN blog_article_revisions revision ON revision.id=mapping.revision_id
    WHERE mapping.run_id=$1`, [run.id])).rows[0];
  assert.equal(draft.publication_state, 'draft');
  assert.equal(draft.published_revision_id, null);
  assert.equal(draft.revision_state, 'working');
  assert.equal(draft.publish_events, 0);
  assert.match(draft.title, /^[^A-Za-z]+$/u);
  assert.equal(draft.verification_artifact_id == null, false);
  assert.equal(draft.composition_artifact_id == null, false);
  assert.equal(Number((await admin.query(`SELECT count(*)::int AS n FROM agent_run_actions
    WHERE run_id=$1 AND capability_key='blog.article.publish'`, [run.id])).rows[0].n), 0);
  assert.equal(Number((await admin.query(`SELECT count(*)::int AS n FROM agent_run_stages
    WHERE run_id=$1 AND stage_key='publish'`, [run.id])).rows[0].n), 0);
  await worker.stop();
  await admin.end();
});
