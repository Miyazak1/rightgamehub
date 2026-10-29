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
  const { GITHUB_REPOSITORY_MATERIALS_TOOL, validateGitHubRepositoryMaterialsInput,
    validateGitHubRepositoryMaterialsOutput } = await harness.load('agent-github-repository-materials-tool.mjs');
  const { GITHUB_REPOSITORY_SEARCH_TOOL, validateGitHubRepositorySearchInput,
    validateGitHubRepositorySearchOutput } = await harness.load('agent-github-repository-search-tool.mjs');
  const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
  const { createAgentProviderGateway } = await harness.load('agent-provider-gateway.mjs');
  const { createAgentSecretVault } = await harness.load('agent-secret-vault.mjs');
  const { BLOG_FOUNDATION_RESPONSE_SCHEMAS } = await harness.load('agent-blog-foundation-generation.mjs');
  const { PostgresAgentRuntimeStageArtifactRepository } = await harness.load('agent-runtime-stage-artifact-repository.mjs');
  const { PostgresAgentBlogFoundationDraftRepository } = await harness.load('agent-blog-foundation-draft-repository.mjs');
  const { createAgentBlogFoundationDraftGateway } = await harness.load('agent-blog-foundation-draft.mjs');
  const { createAgentBlogFoundationShadowHandlers,
    createAgentBlogFoundationShadowCanary } = await harness.load('agent-blog-foundation-shadow.mjs');
  const { createAgentBlogAutonomousCandidateDiscoveryHandlers,
    createAgentBlogAutonomousDiscoveryCanary, BLOG_DISCOVERY_RESPONSE_SCHEMAS } =
    await harness.load('agent-blog-candidate-discovery.mjs');
  const { createAgentBlogCandidateDraftHandoffCanary } =
    await harness.load('agent-blog-candidate-handoff.mjs');
  const { PostgresAgentBlogCanaryAcceptanceRepository,
    createAgentBlogCanaryAcceptanceService } = await harness.load('agent-blog-canary-acceptance.mjs');
  const { createAgentRuntimeReadService } = await harness.load('agent-runtime-read-service.mjs');
  const { PostgresAgentResearchEvidenceRepository } =
    await harness.load('agent-research-evidence-repository.mjs');
  const { recordAgentEditorialMemory, PostgresAgentEditorialMemoryRepository } =
    await harness.load('agent-editorial-memory-repository.mjs');
  const { stableHash } = await harness.load('researcher-qa-protocol/stable-json.mjs');

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
  await toolRepository.registerTool(GITHUB_REPOSITORY_MATERIALS_TOOL);
  await toolRepository.registerTool(GITHUB_REPOSITORY_SEARCH_TOOL);
  const revision = 'a'.repeat(40);
  const repositoryOutput = {
    schemaVersion: 'github-repository-evidence-v1',
    repository: { key: 'owner/project', canonicalUrl: 'https://github.com/owner/project', owner: 'owner', name: 'project' },
    sourceVersion: { revision, canonicalUri: `https://github.com/owner/project/tree/${revision}`,
      fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: '' },
    metadata: { name: 'project', fullName: 'owner/project',
      description: '一个可以快速体验、把复杂任务变成清晰步骤的开放工具。', homepage: null,
      defaultBranch: 'main', stars: 1200, forks: 100, openIssues: 12,
      topics: ['tool'], licenseSpdx: 'MIT', archived: false, pushedAt: '2026-10-25T00:00:00.000Z' },
    readme: { canonicalUri: `https://github.com/owner/project/blob/${revision}/README.md`, path: 'README.md',
      text: '这个项目提供可复现的安装步骤、清晰的输入输出和本地运行方式。使用者可以在几分钟内看到结果，并按文档逐步扩展。'.repeat(4) },
  };
  repositoryOutput.sourceVersion.contentSha256 = stableHash({
    metadata: repositoryOutput.metadata, readme: repositoryOutput.readme,
  });
  const materialsOutput = {
    schemaVersion: 'github-repository-materials-v1',
    repository: repositoryOutput.repository,
    sourceVersion: { ...repositoryOutput.sourceVersion, contentSha256: '' },
    metadata: repositoryOutput.metadata,
    materials: [{ type: 'readme', path: repositoryOutput.readme.path,
      canonicalUri: repositoryOutput.readme.canonicalUri, sourceRevision: revision, publishedAt: null,
      text: repositoryOutput.readme.text, truncated: false,
      contentSha256: stableHash(repositoryOutput.readme.text) }],
  };
  materialsOutput.sourceVersion.contentSha256 = stableHash({
    metadata: materialsOutput.metadata, materials: materialsOutput.materials,
  });
  const toolGateway = createAgentToolGateway({
    runtimeRepository: runtime, toolRepository, policyService,
    adapters: {
      'research.github.repository.search@1': async () => ({
        receiptId: 'github-search:shadow-fixture', output: {
          schemaVersion: 'github-repository-search-v1',
          query: { text: 'agent tool', sort: 'stars', minStars: 10, pushedAfter: '2026-01-01' },
          source: { canonicalUri: 'https://api.github.com/search/repositories?q=agent+tool',
            fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'c'.repeat(64) },
          candidates: [{ key: 'owner/project', canonicalUrl: 'https://github.com/owner/project',
            owner: 'owner', name: 'project', description: 'A useful tool', stars: 1200, forks: 100,
            language: 'TypeScript', topics: ['agent'], licenseSpdx: 'MIT',
            pushedAt: '2026-10-25T00:00:00.000Z' }],
        }, responseRef: { canonicalUri: 'https://api.github.com/search/repositories?q=agent+tool',
          contentSha256: 'c'.repeat(64) }, usage: { toolCalls: 1, networkRequests: 1, candidates: 1 },
      }),
      'research.github.repository.read@1': async () => ({
        receiptId: `github:owner/project@${revision}`, output: repositoryOutput,
        responseRef: { canonicalUri: repositoryOutput.sourceVersion.canonicalUri, revision }, usage: { toolCalls: 1 },
      }),
      'research.github.repository.materials.read@1': async () => ({
        receiptId: `github-materials:owner/project@${revision}`, output: materialsOutput,
        responseRef: { canonicalUri: materialsOutput.sourceVersion.canonicalUri, revision }, usage: { toolCalls: 1 },
      }),
    },
    inputSchemas: { 'github.repository.search.input@1': validateGitHubRepositorySearchInput,
      'github.repository.read.input@1': validateGitHubRepositoryReadInput,
      'github.repository.materials.read.input@1': validateGitHubRepositoryMaterialsInput },
    outputSchemas: { 'github.repository.search.output@1': validateGitHubRepositorySearchOutput,
      'github.repository.read.output@1': validateGitHubRepositoryReadOutput,
      'github.repository.materials.read.output@1': validateGitHubRepositoryMaterialsOutput },
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
      const output = request.responseSchema.key === 'blog.discovery.query-plan'
        ? { queries: ['agent tool'],
          rationale: '选题范围关注可以快速体验的开放工具，因此先用普通关键词寻找具有明确用途和可观察结果的项目。',
          interestSignals: ['可以快速体验'] }
        : request.responseSchema.key === 'blog.subject.selection'
        ? { mode: 'single', selectedIndexes: [1], angle: '先验证最小路径，再理解它如何降低上手门槛',
          rationale: '仓库资料给出了明确安装步骤、可观察结果和本地运行方式，适合面向普通读者解释其实际价值。',
          interestSignals: ['可以快速体验'], comparisonAxes: [],
          scores: { readerValue: 85, handsOnPotential: 90, novelty: 65,
            explainability: 88, evidenceStrength: 92 },
          decisionReasonCodes: ['EVIDENCE_STRONG', 'HANDS_ON_TESTABLE'] }
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
    responseSchemas: { ...BLOG_DISCOVERY_RESPONSE_SCHEMAS, ...BLOG_FOUNDATION_RESPONSE_SCHEMAS },
  });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(admin);
  const draftGateway = createAgentBlogFoundationDraftGateway({ runtimeRepository: runtime,
    draftRepository: new PostgresAgentBlogFoundationDraftRepository(admin,
      { requireResearchEvidence: true }), policyService });
  const handlers = createAgentBlogFoundationShadowHandlers({
    toolGateway, providerGateway, artifactRepository, draftGateway,
    researchEvidenceRepository: new PostgresAgentResearchEvidenceRepository(admin),
  });
  const discoveryCanary = createAgentBlogAutonomousDiscoveryCanary({ runtimeRepository: runtime, enabled: true });
  const discoveryWorkflow = await discoveryCanary.register(operatorId);
  const discoveryRun = await discoveryCanary.createRun({ agentUserId: account.agentUserId,
    idempotencyKey: `shadow-discovery:${crypto.randomUUID()}`,
    config: { model: { provider: 'deepseek', modelId: 'fixture-blog' } }, input: {
      schemaVersion: 'blog-project-discovery-input-v2', topicScope: '发现有趣、有用且证据完整的开源工具',
      searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: '2026-01-01',
        maxCandidates: 8, maxQueries: 3 }, previousRepositoryUrls: [],
      behaviorProfile: defaultAgentBehaviorProfile(),
    } });
  const discoveryHandlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({
    providerGateway, toolGateway, artifactRepository,
  });
  const discoveryWorker = createAgentRuntimeWorker({ repository: runtime, handlers: discoveryHandlers,
    workerId: `shadow-discovery-${crypto.randomBytes(4).toString('hex')}`, leaseSeconds: 30, heartbeatSeconds: 5 });
  for (let index = 0; index < discoveryWorkflow.stages.length; index += 1) {
    const result = await discoveryWorker.runOnce();
    assert.equal(result.status, 'completed', JSON.stringify(result));
  }
  const discoveryStored = (await admin.query('SELECT * FROM agent_runs WHERE id=$1', [discoveryRun.id])).rows[0];
  assert.equal(discoveryStored.status, 'succeeded');
  const handoffCanary = createAgentBlogCandidateDraftHandoffCanary({
    runtimeRepository: runtime, artifactRepository, enabled: true,
  });
  const run = await handoffCanary.createDraftRun({ agentUserId: account.agentUserId,
    discoveryRunId: discoveryRun.id, discoveryArtifactId: discoveryStored.output_id,
    idempotencyKey: `shadow-draft:${crypto.randomUUID()}`, behaviorProfile: defaultAgentBehaviorProfile(),
    editorialMemory: { schemaVersion: 'blog-editorial-memory-input-v1',
      capturedAt: '2026-10-27T00:00:00.000Z', activeCooldowns: [] },
    config: { model: { provider: 'deepseek', modelId: 'fixture-blog' } },
  });
  const worker = createAgentRuntimeWorker({ repository: runtime, handlers,
    workerId: `shadow-canary-${crypto.randomBytes(4).toString('hex')}`, leaseSeconds: 30, heartbeatSeconds: 5 });
  const results = [];
  for (let index = 0; index < workflow.stages.length; index += 1) results.push(await worker.runOnce());
  assert(results.every(result => result.status === 'completed'), JSON.stringify(results));
  assert.equal(providerInvocations, 3);
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
  const evidenceLedger = (await admin.query(`SELECT binding.id,binding.content_sha256,
      source.canonical_url,version.content_hash,
      count(evidence_link.evidence_id)::int AS evidence_count
    FROM agent_research_artifact_bindings binding
    JOIN tool_research_sources source ON source.id=binding.research_source_id
    JOIN tool_research_source_versions version ON version.id=binding.research_source_version_id
    JOIN agent_research_evidence_bindings evidence_link ON evidence_link.artifact_binding_id=binding.id
    WHERE binding.run_id=$1
    GROUP BY binding.id,source.canonical_url,version.content_hash`, [run.id])).rows[0];
  assert.equal(evidenceLedger.canonical_url, 'https://github.com/owner/project');
  assert.equal(evidenceLedger.content_hash, materialsOutput.sourceVersion.contentSha256);
  assert.equal(evidenceLedger.content_sha256.length, 64);
  assert(evidenceLedger.evidence_count >= 2);
  const citationEvidence = (await admin.query(`SELECT count(*)::int AS evidence_count,
      count(DISTINCT citation_id)::int AS citation_count,
      count(DISTINCT tool_artifact_id)::int AS artifact_count
    FROM blog_revision_citation_evidence WHERE revision_id=$1`, [draft.revision_id])).rows[0];
  assert.equal(citationEvidence.citation_count, 1);
  assert.equal(citationEvidence.artifact_count, 1);
  assert.equal(citationEvidence.evidence_count, evidenceLedger.evidence_count);
  const memoryClient = await admin.connect();
  let memoryReceipt;
  try {
    await memoryClient.query('BEGIN');
    memoryReceipt = await recordAgentEditorialMemory(memoryClient, {
      agentUserId: account.agentUserId, runId: run.id, articleId: draft.article_id,
      revisionId: draft.revision_id, compositionArtifactId: draft.composition_artifact_id,
      publishedAt: '2026-10-27T02:00:00.000Z',
    });
    await memoryClient.query('COMMIT');
  } catch (error) {
    await memoryClient.query('ROLLBACK');
    throw error;
  } finally {
    memoryClient.release();
  }
  assert(memoryReceipt.eventCount >= 4);
  const memoryRows = (await admin.query(`SELECT event_type,research_source_version_id,
      previous_event_id,research_reason FROM agent_editorial_memory_events
    WHERE revision_id=$1 ORDER BY event_type,id`, [draft.revision_id])).rows;
  const projectVersion = memoryRows.find(item => item.event_type === 'project-version-observed');
  assert.equal(projectVersion.research_source_version_id == null, false);
  assert.equal(projectVersion.previous_event_id, null);
  assert.equal(projectVersion.research_reason, 'single-publication-initial-research');
  const claimRelations = (await admin.query(`SELECT relation_kind,evidence_id,related_claim_event_id
    FROM agent_editorial_claim_relations WHERE agent_user_id=$1 ORDER BY relation_kind,evidence_id`,
  [account.agentUserId])).rows;
  assert.equal(claimRelations.length, citationEvidence.evidence_count);
  assert(claimRelations.every(item => item.relation_kind === 'supports' && item.evidence_id
    && item.related_claim_event_id === null));
  const memorySnapshot = await new PostgresAgentEditorialMemoryRepository(admin, {
    clock: () => new Date('2026-10-27T02:01:00.000Z'),
  }).snapshot(account.agentUserId);
  assert.deepEqual(memorySnapshot.previousRepositoryUrls, ['https://github.com/owner/project']);
  assert.equal((await recordAgentEditorialMemory(admin, {
    agentUserId: account.agentUserId, runId: run.id, articleId: draft.article_id,
    revisionId: draft.revision_id, compositionArtifactId: draft.composition_artifact_id,
    publishedAt: '2026-10-27T02:00:00.000Z',
  })).eventCount, 0);
  await assert.rejects(admin.query(`UPDATE agent_editorial_claim_relations
    SET explanation='mutated relation' WHERE agent_user_id=$1`, [account.agentUserId]));
  const acceptance = createAgentBlogCanaryAcceptanceService({
    repository: new PostgresAgentBlogCanaryAcceptanceRepository(admin),
  });
  const report = await acceptance.attest(account.agentUserId, run.id);
  assert.equal(report.verdict, 'passed');
  assert.deepEqual(report.reasonCodes, []);
  assert.equal(report.recommendation, 'retain-private-and-collect-more-samples');
  assert.equal((await acceptance.attest(account.agentUserId, run.id)).existing, true);
  assert.equal((await acceptance.readiness(account.agentUserId)).automaticScheduleChange, false);
  const runtimeRead = createAgentRuntimeReadService({ pool: admin, authorizeOperator: async () => true });
  const summaries = await runtimeRead.listRuns({ userId: operatorId }, account.agentUserId, 20);
  const draftSummary = summaries.find(item => item.id === run.id);
  const discoverySummary = summaries.find(item => item.id === discoveryRun.id);
  assert.equal(draftSummary.sourceRunId, discoveryRun.id);
  assert.equal(draftSummary.foundationDraft.articleId, draft.article_id);
  assert.equal(draftSummary.foundationDraft.title, draft.title);
  assert.equal(draftSummary.foundationDraft.publicationState, 'draft');
  assert.equal(draftSummary.acceptance.verdict, 'passed');
  assert.deepEqual(draftSummary.acceptance.reasonCodes, []);
  assert.equal(discoverySummary.targetRunId, run.id);
  await discoveryWorker.stop();
  await worker.stop();
  await admin.end();
});
