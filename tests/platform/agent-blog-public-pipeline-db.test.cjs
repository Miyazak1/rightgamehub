const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

async function publicPipelineFixture(t, { selectionFailures = 1, agentCallLimit = 20,
  expectedFailure = null, expectedCalls = 5,candidateCount=1,materialCount=1,longEvidence=false,live=null,
  selectionIndexFailures=0,compositionTitleFailures=0 } = {}) {
  const { admin } = await harness.setup();
  t.after(() => admin.end());
  live?.onDatabase?.(admin);
  const modelId=live?.modelId??'fixture-blog';
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
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
  const { createAgentBlogFoundationPublicHandlers } = await harness.load('agent-blog-foundation-shadow.mjs');
  const { createAgentBlogAutonomousCandidateDiscoveryHandlers,
    createAgentBlogAutonomousDiscoveryCanary, BLOG_DISCOVERY_RESPONSE_SCHEMAS } =
    await harness.load('agent-blog-candidate-discovery.mjs');
  const { PostgresAgentResearchEvidenceRepository } =
    await harness.load('agent-research-evidence-repository.mjs');
  const { stableHash } = await harness.load('researcher-qa-protocol/stable-json.mjs');

  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Public pipeline fixture operator','admin')", [operatorId]);
  const accounts = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true });
  const account = await accounts.provision({ userId: operatorId }, {
    provisionKey: `public-pipeline-${crypto.randomUUID()}`, displayName: '小墨鱼',
    handle: `public-pipeline-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
    operatorLabel: 'Public pipeline fixture', capabilities: ['blog:auto-publish'], metadata: {},
  });
  const runtime = new PostgresAgentRuntimeRepository(admin);
  await admin.query(`UPDATE agent_blog_publication_owners SET active_publisher='foundation',
    generation=generation+1,reason='Isolated full public pipeline fixture',
    switched_at=GREATEST(clock_timestamp(),switched_at+interval '1 microsecond'),updated_at=clock_timestamp()
    WHERE agent_user_id=$1`, [account.agentUserId]);
  await admin.query(`INSERT INTO agent_blog_automation_settings(agent_user_id,model,topic_scope,updated_by_user_id)
    VALUES($1,$3,'发现有趣、有用且证据完整的开放工具',$2)`, [account.agentUserId,operatorId,modelId]);

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
  const repositoryFixture=(template,repository)=>{
    const key=repository.replace('https://github.com/',''),name=key.split('/')[1];
    const output=JSON.parse(JSON.stringify(template).replaceAll('owner/project',key).replaceAll('"name":"project"','"name":'+JSON.stringify(name)));
    if(longEvidence){
      const text='这个开放项目提供固定版本安装步骤、明确的输入输出、可观察结果和适用边界，读者能够根据官方资料完成一次可复现的最小体验。'.repeat(100);
      if(output.readme)output.readme.text=text;
      if(output.materials)output.materials=Array.from({length:materialCount},(_,index)=>({...output.materials[0],
        type:index?'documentation':'readme',path:index?`docs/guide${index}.md`:'README.md',
        canonicalUri:`https://github.com/${key}/blob/${revision}/${index?`docs/guide${index}.md`:'README.md'}`,text,contentSha256:stableHash(text)}));
    }
    output.sourceVersion.contentSha256=stableHash(output.materials?{metadata:output.metadata,materials:output.materials}:{metadata:output.metadata,readme:output.readme});
    return output;
  };
  const toolGateway = createAgentToolGateway({
    runtimeRepository: runtime, toolRepository, policyService,
    adapters: live?.toolAdapters??{
      'research.github.repository.search@1': async () => ({
        receiptId: 'github-search:shadow-fixture', output: {
          schemaVersion: 'github-repository-search-v1',
          query: { text: 'agent tool', sort: 'stars', minStars: 10, pushedAfter: '2026-01-01' },
          source: { canonicalUri: 'https://api.github.com/search/repositories?q=agent+tool',
            fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'c'.repeat(64) },
          candidates: Array.from({length:candidateCount},(_,index)=>({ key: 'owner/project'+(index||''), canonicalUrl: 'https://github.com/owner/project'+(index||''),
            owner: 'owner', name: 'project'+(index||''), description: 'A useful tool', stars: 1200, forks: 100,
            language: 'TypeScript', topics: ['agent'], licenseSpdx: 'MIT',
            pushedAt: '2026-10-25T00:00:00.000Z' })),
        }, responseRef: { canonicalUri: 'https://api.github.com/search/repositories?q=agent+tool',
          contentSha256: 'c'.repeat(64) }, usage: { toolCalls: 1, networkRequests: 1, candidates: 1 },
      }),
      'research.github.repository.read@1': async ({request}) => ({
        receiptId: `github:${request.repository}@${revision}`, output: repositoryFixture(repositoryOutput,request.repository),
        responseRef: { canonicalUri: repositoryOutput.sourceVersion.canonicalUri, revision }, usage: { toolCalls: 1 },
      }),
      'research.github.repository.materials.read@1': async ({request}) => ({
        receiptId: `github-materials:${request.repository}@${revision}`, output: repositoryFixture(materialsOutput,request.repository),
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
    agentMonthlyLimits: { providerCalls: agentCallLimit, inputTokens: 200000, outputTokens: 50000, costMicrousd: 100000000 },
    platformMonthlyLimits: { providerCalls: 200, inputTokens: 2000000, outputTokens: 500000, costMicrousd: 1000000000 },
  });
  await governance.registerModel({ provider: 'deepseek', modelId, catalogVersion: 1, status: 'active',
    taskClasses: ['structured-generation'], supportsJsonSchema: true, maxInputTokens: 60000, maxOutputTokens: 7000,
    inputPriceMicrousdPerMillion: 2000000, outputPriceMicrousdPerMillion: 4000000, config: { fixture: true } });
  const vault = createAgentSecretVault({ masterKey: live?crypto.randomBytes(32).toString('hex'):'cd'.repeat(32) });
  const encrypted = vault.encrypt(account.agentUserId, 'deepseek', live?.apiKey??'fixture-shadow-secret-key');
  await admin.query(`INSERT INTO agent_provider_secrets(
    agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id
  ) VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`, [account.agentUserId, encrypted.ciphertext, encrypted.nonce,
    encrypted.authTag, encrypted.fingerprint, encrypted.lastFour, operatorId]);
  const longParagraph = '这个项目把原本分散的操作整理成可以观察和复现的步骤，读者能先完成最小体验，再根据自己的目标逐步增加能力。'.repeat(8);
  let providerInvocations = 0, compositionCalls = 0, selectionCalls = 0;
  const providerGateway = createAgentProviderGateway({
    runtimeRepository: runtime, governanceRepository: governance, policyService, secretVault: vault,
    adapters: { deepseek: live?async request=>{
      providerInvocations++;
      if(request.responseSchema.key==='blog.subject.selection-attempt')selectionCalls++;
      if(request.responseSchema.key==='blog.article.composition')compositionCalls++;
      return live.providerAdapter(request);
    }:async request => {
      providerInvocations += 1;
      const output = request.responseSchema.key === 'blog.discovery.query-plan'
        ? { queries: ['agent tool'],
          rationale: '选题范围关注可以快速体验的开放工具，因此先用普通关键词寻找具有明确用途和可观察结果的项目。',
          interestSignals: ['可以快速体验'] }
        : ['blog.subject.selection','blog.subject.selection-attempt'].includes(request.responseSchema.key)
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
      if(request.responseSchema.key === 'blog.subject.selection-attempt') {
        selectionCalls++;
        if(selectionCalls<=selectionFailures){delete output.scores; delete output.decisionReasonCodes;}
        if(selectionCalls<=selectionIndexFailures)output.selectedIndexes=[candidateCount+1];
      }
      if(request.responseSchema.key === 'blog.article.composition' && ++compositionCalls === 1) {
        output.blocks.find(block => block.type === 'paragraph').citationIndexes = [1,3];
      }
      if(request.responseSchema.key === 'blog.article.composition'&&compositionCalls<=compositionTitleFailures){
        output.title='用几条样式规则画生成艺术：css-doodle 上手笔记';
      }
      return { providerRequestId: `fixture:${crypto.randomUUID()}`, output, responseRef: {},
        usage: { providerCalls: 1, inputTokens: 500, outputTokens: 1200, costMicrousd: 10 } };
    } },
    responseSchemas: { ...BLOG_DISCOVERY_RESPONSE_SCHEMAS, ...BLOG_FOUNDATION_RESPONSE_SCHEMAS },
  });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(admin);
  const draftGateway = createAgentBlogFoundationDraftGateway({ runtimeRepository: runtime,
    draftRepository: new PostgresAgentBlogFoundationDraftRepository(admin,
      { requireResearchEvidence: true }), policyService });
  const { createAgentBlogFoundationPublicationGateway } = await harness.load('agent-blog-foundation-publication.mjs');
  const { PostgresAgentBlogFoundationPublicationRepository } = await harness.load('agent-blog-foundation-publication-repository.mjs');
  const publicationGateway = createAgentBlogFoundationPublicationGateway({ runtimeRepository: runtime,
    publicationRepository: new PostgresAgentBlogFoundationPublicationRepository(admin), policyService });
  const handlers = createAgentBlogFoundationPublicHandlers({
    toolGateway, providerGateway, artifactRepository, draftGateway, publicationGateway,
    researchEvidenceRepository: new PostgresAgentResearchEvidenceRepository(admin),
  });
  const select = handlers['blog.project.single:select-subject'];
  handlers['blog.project.single:select-subject'] = async (...args) => {
    const result = await select(...args), count = providerInvocations;
    const replay = await select(...args);
    assert.deepEqual(replay, result);
    assert.equal(providerInvocations, count, 'selection replay must reuse both durable attempt outputs');
    return result;
  };

  const { createAgentBlogCandidatePublicHandoff } = await harness.load('agent-blog-candidate-handoff.mjs');
  const { createAgentBlogPublicRuntimeManualRunner } = await harness.load('agent-blog-public-runtime-manual-run.mjs');
  const { PostgresAgentBlogPublicRuntimePreflightRepository } = await harness.load('agent-blog-public-runtime-preflight.mjs');
  const { PostgresAgentBlogPrivateCanaryInputRepository } = await harness.load('agent-blog-private-canary-manual-run.mjs');
  const discoveryCanary = createAgentBlogAutonomousDiscoveryCanary({ runtimeRepository: runtime, enabled: true });
  await discoveryCanary.register(operatorId);
  const publicHandoff = createAgentBlogCandidatePublicHandoff({ runtimeRepository: runtime, artifactRepository, enabled: true });
  await publicHandoff.register(operatorId);
  const discoveryHandlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({ providerGateway, toolGateway, artifactRepository });
  const plan = discoveryHandlers['blog.project.discovery-shadow:plan-queries'];
  let planAttempts = 0;
  discoveryHandlers['blog.project.discovery-shadow:plan-queries'] = async (...args) => {
    if(++planAttempts === 1) throw Object.assign(Error('Recoverable fixture failure before provider dispatch'), { retryable: true });
    return plan(...args);
  };
  const config = { schemaVersion: 'agent-blog-public-runtime-config-v1', enabled: true,
    agentUserId: account.agentUserId, provider: 'deepseek', modelId, githubResearchAuthenticated: live?live.githubAuthenticated:true,
    dailyPublicationRunLimit: 1, monthlyProviderCallLimit: 120, monthlyCostMicrousdLimit: 10000000, consecutiveFailureLimit: 2 };
  const worker = (runId, routes) => createAgentRuntimeWorker({ repository: runtime, handlers: routes,
    targetRunId: runId, workerId: 'public-pipeline-' + runId, leaseSeconds: 30, heartbeatSeconds: 5 });
  const completeStage = runtime.completeStage.bind(runtime);
  let lostCommitAcknowledgements = 0;
  runtime.completeStage = async input => {
    const result = await completeStage(input);
    if (result.stage.stageKey === 'publish') {
      lostCommitAcknowledgements++;
      throw Error('Fixture acknowledgement lost after successful publish-stage commit');
    }
    return result;
  };
  const runner = createAgentBlogPublicRuntimeManualRunner({ config,
    preflightRepository: new PostgresAgentBlogPublicRuntimePreflightRepository(admin),
    inputRepository: new PostgresAgentBlogPrivateCanaryInputRepository(admin), discoveryCanary, publicHandoff,
    createDiscoveryWorker: runId => worker(runId, discoveryHandlers), createPublicationWorker: runId => worker(runId, handlers),
    readRun: async runId => { const row = (await admin.query(`SELECT id,status,output_type,output_id FROM agent_runs
      WHERE id=$1 AND agent_user_id=$2`, [runId,account.agentUserId])).rows[0];
      return row ? { id: row.id, status: row.status, outputType: row.output_type, outputId: row.output_id } : null; } });
  let result;
  try { result = await runner.run({ requestId: crypto.randomUUID() }); }
  catch (error) {
    if (!expectedFailure) throw error;
    assert.match(error.details?.stageErrorCode ?? error.code, expectedFailure);
    assert.equal(providerInvocations, expectedCalls);
    assert.equal(compositionCalls, 0);
    const state = (await admin.query(`SELECT
      (SELECT count(*)::int FROM blog_articles WHERE author_user_id=$1) AS articles,
      (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE agent_user_id=$1) AS publications,
      (SELECT count(*)::int FROM agent_runtime_stage_artifacts artifact JOIN agent_runs run ON run.id=artifact.run_id
        WHERE run.agent_user_id=$1 AND artifact.artifact_key='blog.selection') AS approved_selections,
      (SELECT sum(charged_provider_calls)::int FROM agent_budget_reservations WHERE agent_user_id=$1) AS charged`, [account.agentUserId])).rows[0];
    assert.deepEqual(state, { articles: 0, publications: 0, approved_selections: 0, charged: expectedCalls });
    const attempts = (await admin.query(`SELECT output.content_json FROM agent_provider_output_artifacts output
      JOIN agent_run_actions action ON action.id=output.action_id JOIN agent_runs run ON run.id=action.run_id
      WHERE run.agent_user_id=$1 AND output.schema_key='blog.subject.selection-attempt'`, [account.agentUserId])).rows;
    assert.equal(attempts.length, expectedCalls - 1);
    assert.ok(attempts.every(row => row.content_json.accepted === (selectionIndexFailures>0)));
    return;
  }
  assert.equal(expectedFailure, null, 'the invalid selection or denied repair must not publish');
  assert.equal(result.publication.publicationState, 'published');
  assert.equal(result.publicationAttempted, true);
  if(!live){
    assert.equal(providerInvocations, 5);
    assert.equal(selectionCalls, 2);
    assert.equal(compositionCalls, 2);
  }
  assert.equal(planAttempts, 2);
  assert.equal(lostCommitAcknowledgements, 1);
  const stored = (await admin.query(`SELECT article.publication_state,revision.revision_state,
    (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE run_id=$1) AS receipts,
    (SELECT count(*)::int FROM blog_article_events WHERE article_id=article.id AND action='published') AS events,
    (SELECT count(DISTINCT citation_id)::int FROM blog_revision_citation_evidence WHERE revision_id=revision.id) AS linked_citations
    FROM blog_articles article JOIN blog_article_revisions revision ON revision.id=article.published_revision_id
    WHERE article.id=$2`, [result.publication.runId, result.publication.articleId])).rows[0];
  assert.deepEqual({...stored,linked_citations:1}, { publication_state: 'published', revision_state: 'published', receipts: 1, events: 1, linked_citations: 1 });
  assert.ok(stored.linked_citations>=1);
  if(!live)assert.equal(stored.linked_citations,1);
  const runs = (await admin.query('SELECT workflow_key,status FROM agent_runs WHERE agent_user_id=$1 ORDER BY workflow_key', [account.agentUserId])).rows;
  assert.deepEqual(runs.map(run => run.status), ['succeeded','succeeded']);
  assert.ok(runs.every(run => !run.workflow_key.startsWith('paper.')));
  const charged = (await admin.query('SELECT sum(charged_provider_calls)::int AS n FROM agent_budget_reservations WHERE agent_user_id=$1', [account.agentUserId])).rows[0].n;
  assert.equal(charged, live?providerInvocations:5);
  const attempts = (await admin.query(`SELECT action.action_key,output.content_json FROM agent_run_actions action
    JOIN agent_provider_output_artifacts output ON output.action_id=action.id
    WHERE action.run_id=$1 AND output.schema_key='blog.subject.selection-attempt'
    ORDER BY action.action_key`, [result.publication.runId])).rows;
  assert.equal(attempts.length, live?selectionCalls:2);
  const malformed = attempts.find(row => row.action_key==='select-subject');
  const corrected = attempts.find(row => row.action_key==='select-subject-format-repair');
  if(!live){
    assert.equal(malformed.content_json.accepted, selectionIndexFailures>0);
    if(selectionIndexFailures===0)assert.deepEqual(malformed.content_json.validation.missingFields, ['scores','decisionReasonCodes']);
    assert.equal(corrected.content_json.accepted, true);
  }
  const publicUsage = (await admin.query(`SELECT sum(charged_provider_calls)::int AS calls,
    sum(charged_output_tokens)::int AS output_tokens FROM agent_budget_reservations WHERE run_id=$1`, [result.publication.runId])).rows[0];
  if(!live)assert.deepEqual(publicUsage, { calls: 4, output_tokens: 17600 });
  else {assert.ok(publicUsage.calls<=4);assert.ok(publicUsage.output_tokens<=18000);}
  const inputUsage=(await admin.query('SELECT sum(charged_input_tokens)::int AS tokens FROM agent_budget_reservations WHERE run_id=$1',[result.publication.runId])).rows[0].tokens;
  assert.ok(inputUsage<=90000);
  const inputs=(await admin.query(`SELECT octet_length(action.request_json::text) AS ledger_bytes,input.content_sha256,action.request_sha256
    FROM agent_run_actions action JOIN agent_provider_input_artifacts input ON input.action_id=action.id WHERE action.run_id=$1`,[result.publication.runId])).rows;
  assert.equal(inputs.length,live?selectionCalls+compositionCalls:4);assert.ok(inputs.every(row=>row.ledger_bytes<=65536&&row.content_sha256===row.request_sha256));
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM agent_run_events WHERE run_id=$1 AND event_type='stage.retry-scheduled'", [result.discovery.runId])).rows[0].n, 1);
  if(live){
    const callsBefore=providerInvocations;
    await assert.rejects(runner.run({requestId:crypto.randomUUID()}),error=>error.code==='AGENT_BLOG_PUBLIC_RUNTIME_PREFLIGHT_BLOCKED');
    assert.equal(providerInvocations,callsBefore);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_blog_foundation_publications WHERE agent_user_id=$1',[account.agentUserId])).rows[0].n,1);
    await live.onComplete?.({result,providerInvocations,selectionCalls,compositionCalls,charged,inputTokens:inputUsage,
      receipts:stored.receipts,publicationEvents:stored.events,linkedCitations:stored.linked_citations,
      replayNoNewProviderCalls:true,duplicateRunBlocked:true,lostCommitAcknowledgements});
  }
}

module.exports={publicPipelineFixture};
if(require.main===module)test('public selection schema handling preserves full pipeline governance', { skip: !harness.enabled }, async t => {
  await t.test('format and citation correction, replay and lost publication acknowledgement finish exactly once',
    sub => publicPipelineFixture(sub));
  await t.test('two malformed selection replies stop before approval, writing or publication',
    sub => publicPipelineFixture(sub, { selectionFailures: 2, expectedFailure: /AGENT_BLOG_SELECTION_SCHEMA_INVALID/u, expectedCalls: 3 }));
  await t.test('agent budget denial blocks selection repair without another model call or publication',
    sub => publicPipelineFixture(sub, { agentCallLimit: 2, expectedFailure: /BUDGET/u, expectedCalls: 2 }));
  await t.test('five repositories and six long Chinese materials pass both corrections and publish once',
    sub=>publicPipelineFixture(sub,{candidateCount:5,materialCount:6,longEvidence:true}));
  await t.test('out-of-range selection is repaired before publication using the same two-call allowance',
    sub=>publicPipelineFixture(sub,{selectionFailures:0,selectionIndexFailures:1}));
  await t.test('two out-of-range selections stop without a draft or publication',
    sub=>publicPipelineFixture(sub,{selectionFailures:0,selectionIndexFailures:2,expectedFailure:/AGENT_BLOG_SELECTION_INDEX_INVALID/u,expectedCalls:3}));
  await t.test('actual live title failure and citation correction share the original writing repair budget',
    sub=>publicPipelineFixture(sub,{compositionTitleFailures:1}));
});
