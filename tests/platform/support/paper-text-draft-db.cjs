const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./researcher-qa-db.cjs');
const provider = require('./paper-text-draft.cjs');

module.exports = async function runTextDraft({ admin, account, operatorId, runtime, policyService,
  governance, vault, canary, recordedProvider = null,
  previewDirectory = path.resolve(__dirname, '../../../.runtime/paper-layout-audit') }) {
  const load = harness.load, id = () => crypto.randomUUID(), json = JSON.stringify;
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/paper-text-draft-eval-v1.json'), 'utf8'));
  if (recordedProvider) {
    assert.equal(recordedProvider.sourceSha256, f.sourceSha256);
    assert.equal(recordedProvider.recordedReceipts.length, 2);
    assert.ok(recordedProvider.recordedReceipts.every(r => r.responseRef.httpStatus === 200
      && r.providerRequestId && r.usage.inputTokens > 0 && r.usage.outputTokens > 0));
  }
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { PostgresAgentPaperSemanticRepository, createAgentPaperSemanticGateway } = await load('agent-paper-semantic-repository.mjs');
  const { createAgentPaperSemanticHandlers } = await load('agent-paper-semantic-runtime.mjs');
  const { createAgentProviderGateway } = await load('agent-provider-gateway.mjs');
  const { PostgresAgentRuntimeStageArtifactRepository } = await load('agent-runtime-stage-artifact-repository.mjs');
  const { createAgentRuntimeWorker } = await load('agent-runtime-worker.mjs');
  const { PAPER_SEMANTIC_RESPONSE_SCHEMAS } = await load('agent-paper-semantic-contracts.mjs');
  const { PAPER_ARTICLE_RESPONSE_SCHEMAS } = await load('agent-paper-article-generation.mjs');
  const { PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW: articleWorkflow, createAgentPaperArticleDraftHandlers } = await load('agent-paper-article-workflow.mjs');
  const { createAgentToolGateway } = await load('agent-tool-gateway.mjs');
  const { PostgresAgentToolGatewayRepository } = await load('agent-tool-gateway-repository.mjs');
  const { PAPER_ANALYSIS_READ_TOOL, createPaperAnalysisReadAdapter, validatePaperAnalysisReadInput,
    validatePaperAnalysisReadOutput } = await load('agent-paper-analysis-tool.mjs');
  const { PostgresAgentResearchEvidenceRepository } = await load('agent-research-evidence-repository.mjs');
  const { createAgentBlogFoundationDraftGateway } = await load('agent-blog-foundation-draft.mjs');
  const { PostgresAgentBlogFoundationDraftRepository } = await load('agent-blog-foundation-draft-repository.mjs');
  const sourceId = id(), versionId = id(), identityId = id(), paperVersionId = id();
  await admin.query(`INSERT INTO tool_research_sources(id,user_id,canonical_url,source_type,publisher,authority_tier,status)
    VALUES($1,$2,$3,'pdf','arXiv','official-primary','tracked')`, [sourceId, account.agentUserId, f.sourceUrl]);
  await admin.query(`INSERT INTO tool_research_source_versions(id,source_id,fetched_at,content_hash,normalized_hash,locator,content_type,fetch_receipt)
    VALUES($1,$2,now(),$3,$3,$4,'application/pdf','{}')`, [versionId, sourceId, f.sourceSha256, json({ canonicalUri: f.sourceUrl })]);
  await admin.query(`INSERT INTO agent_paper_identities(id,agent_user_id,canonical_id,arxiv_id,title,authors,publication_year,identity_confidence)
    VALUES($1,$2,'arxiv:1706.03762','1706.03762','Attention Is All You Need',$3,2017,'confirmed')`,
  [identityId, account.agentUserId, json(['Ashish Vaswani'])]);
  await admin.query(`INSERT INTO agent_paper_versions(id,paper_identity_id,research_source_version_id,external_artifact_version_id,
    version_kind,source_url,access_level,version_relation,content_sha256)
    VALUES($1,$2,$3,$4,'preprint',$5,'fulltext-open','initial',$6)`,
  [paperVersionId, identityId, versionId, f.layoutManifest.artifactVersionId, f.sourceUrl, f.sourceSha256]);
  await admin.query(`INSERT INTO agent_paper_layout_manifests(paper_version_id,parser_version,page_count,manifest_json,content_sha256)
    VALUES($1,$2,$3,$4,$5)`, [paperVersionId, f.layoutManifest.parserVersion,
    f.layoutManifest.pageCount, json(f.layoutManifest), f.paper.layout_sha256]);
  await admin.query(`INSERT INTO agent_paper_parse_assessments(paper_version_id,schema_version,policy_version,parser_version,
    reliability_grade,permitted_uses,reason_codes,metrics_json,assessment_sha256)
    VALUES($1,1,'paper-text-layer-gate-v1',$5,'limited-text',ARRAY['analysis']::text[],$2,$3,$4)`,
  [paperVersionId, f.paper.reason_codes, json(f.paper.metrics_json), f.paper.assessment_sha256, f.layoutManifest.parserVersion]);
  for (const e of f.evidence) await admin.query(`INSERT INTO tool_research_evidence(id,source_version_id,locator,quote_text,quote_hash,evidence_kind,allowed_uses)
    VALUES($1,$2,$3,$4,$5,'direct-quote',ARRAY['analysis']::text[])`,
  [id(), versionId, json(e.locator), e.quoteText, e.quoteHash]);
  const repository = new PostgresAgentPaperSemanticRepository(admin);
  const source = await repository.loadTrustedPaper({ agentUserId: account.agentUserId, paperVersionId });
  assert.deepEqual(source.evidence.map(e => e.locator.blockIds[0]), f.expectedBlockIds);
  await governance.registerModel({ provider: 'deepseek', modelId: 'fixture-text-draft', catalogVersion: 1,
    status: 'active', taskClasses: ['paper-semantic-analysis', 'structured-generation'], supportsJsonSchema: true,
    maxInputTokens: 60000, maxOutputTokens: 8000, inputPriceMicrousdPerMillion: 1, outputPriceMicrousdPerMillion: 1, config: { fixture: true } });
  let calls = 0;
  const gateway = createAgentProviderGateway({ runtimeRepository: runtime, governanceRepository: governance,
    policyService, secretVault: vault, responseSchemas: { ...PAPER_SEMANTIC_RESPONSE_SCHEMAS, ...PAPER_ARTICLE_RESPONSE_SCHEMAS },
    adapters: { deepseek: async request => {
      calls += 1;
      const payload = JSON.parse(request.request.messages[1].content);
      const scope = payload.readingScope ?? payload.verifiedPaper?.readingScope;
      assert.equal(scope.manualReviewRequired, true);
      assert.equal(scope.publicPublicationEnabled, false);
      // First test the deterministic shadow fixture, then replay actual recorded
      // model outputs through the private queue and draft database boundaries.
      const replay = recordedProvider && calls > 1;
      return { providerRequestId: `offline-text-draft:${id()}`,
        output: replay ? structuredClone(request.responseSchema.key === 'paper.semantic.extraction'
          ? recordedProvider.extraction : recordedProvider.composition)
          : request.responseSchema.key === 'paper.semantic.extraction' ? provider.extraction(payload) : provider.composition(),
        responseRef: { offlineFixture: !replay, recordedLiveReplay: !!replay },
        usage: { providerCalls: 1, inputTokens: 500, outputTokens: 500, costMicrousd: 1 } };
    } } });
  const artifacts = new PostgresAgentRuntimeStageArtifactRepository(admin);
  const semanticHandlers = createAgentPaperSemanticHandlers({ repository, providerGateway: gateway,
    artifactRepository: artifacts, semanticGateway: createAgentPaperSemanticGateway({ runtimeRepository: runtime, policyService, repository }) });
  const model = { provider: 'deepseek', modelId: 'fixture-text-draft' };
  const run = await canary.createRun({ agentUserId: account.agentUserId, idempotencyKey: `text-only:${id()}`,
    input: { schemaVersion: 'paper-semantic-run-input-v1', paperVersionId, purpose: 'private-research' }, config: { model } });
  async function execute(runId, handlers, count) {
    const worker = createAgentRuntimeWorker({ repository: runtime, handlers, targetRunId: runId,
      workerId: `text-only-${id()}`, leaseSeconds: 30, heartbeatSeconds: 5 });
    for (let i = 0; i < count; i += 1) {
      const result = await worker.runOnce(); assert.equal(result.status, 'completed', json(result));
    }
    assert.equal((await admin.query('SELECT status FROM agent_runs WHERE id=$1', [runId])).rows[0].status, 'succeeded');
  }
  await execute(run.id, semanticHandlers, 5);
  // Also exercise the actual queued research workflow, not just semantic-shadow.
  const { createAgentPaperResearchExecutionService, createAgentPaperResearchExecutionHandlers,
    PAPER_RESEARCH_EXECUTION_WORKFLOW } = await load('agent-paper-research-execution.mjs');
  const discoveryId = id(), candidateId = id(), queueId = id();
  await admin.query(`INSERT INTO agent_paper_discovery_runs(id,agent_user_id,operator_user_id,request_id,
    query_kind,query_json,query_sha256,status,provider_requests,candidate_count)
    VALUES($1,$2,$3,$4,'arxiv','{}',$5,'completed',0,1)`,
  [discoveryId, account.agentUserId, operatorId, id(), stableHash('offline-discovery')]);
  await admin.query(`INSERT INTO agent_paper_discovery_candidates(id,run_id,agent_user_id,ordinal,source_kind,
    external_key,arxiv_id,title,normalized_title,title_fingerprint,authors,author_fingerprint,
    publication_year,metadata_json,provenance_json,candidate_sha256)
    VALUES($1,$2,$3,1,'arxiv','1706.03762','1706.03762','Attention Is All You Need',
    'attention is all you need',$4,$5,$6,2017,'{}','{}',$7)`,
  [candidateId, discoveryId, account.agentUserId, stableHash('attention'), json(['Ashish Vaswani']), stableHash('authors'), stableHash('candidate')]);
  await admin.query(`INSERT INTO agent_paper_research_queue_items(id,agent_user_id,source_candidate_id,
    paper_identity_id,queue_key,state,reason) VALUES($1,$2,$3,$4,$5,'queued','offline text draft regression')`,
  [queueId, account.agentUserId, candidateId, identityId, stableHash(queueId)]);
  const service = createAgentPaperResearchExecutionService({ pool: admin, runtimeRepository: runtime,
    authorizeOperator: async () => true, provider: model.provider, modelId: model.modelId });
  const research = await service.start({ userId: operatorId }, account.agentUserId, queueId, { requestId: id() });
  const researchHandlers = createAgentPaperResearchExecutionHandlers({ pool: admin, semanticHandlers,
    evidenceRepository: {}, toolGateway: { invoke() { throw Error('EXISTING_PDF_MUST_NOT_REFETCH'); } } });
  await execute(research.runtimeRunId, researchHandlers, PAPER_RESEARCH_EXECUTION_WORKFLOW.stages.length);
  const completed = (await service.list({ userId: operatorId }, account.agentUserId)).find(item => item.id === research.id);
  assert.equal(completed.status, 'succeeded');
  const result = (await admin.query('SELECT result_json FROM agent_paper_research_executions WHERE id=$1', [research.id])).rows[0].result_json;
  assert.equal(result.readingMode, 'text-only-draft');
  assert.equal(result.manualReviewRequired, true);
  const analysis = (await admin.query('SELECT * FROM agent_paper_semantic_analyses WHERE run_id=$1', [research.runtimeRunId])).rows[0];
  assert.equal(analysis.section_manifest.readingScope.mode, 'text-only-draft');
  assert.equal(analysis.limitations.at(-1).key, 'text-only-reading-scope');
  const pack = await repository.loadArticleEvidence({ agentUserId: account.agentUserId, analysisId: analysis.id });
  assert.equal(pack.schemaVersion, 'paper-article-evidence-v2');
  assert.equal(pack.evidence.every(e => e.allowedUses.join(',') === 'analysis'), true);
  const { PostgresAgentPaperFollowUpRepository } = await load('agent-paper-follow-up-repository.mjs');
  await assert.rejects(new PostgresAgentPaperFollowUpRepository(admin).loadContext({
    agentUserId: account.agentUserId, analysisId: analysis.id, question: '核验实验结果？', runId: id(),
  }), { code: 'AGENT_PAPER_FOLLOW_UP_TEXT_DRAFT_ONLY' });
  const toolRepository = new PostgresAgentToolGatewayRepository(admin);
  await toolRepository.registerTool(PAPER_ANALYSIS_READ_TOOL);
  const toolGateway = createAgentToolGateway({ runtimeRepository: runtime, toolRepository, policyService,
    adapters: { 'research.paper.analysis.read@1': createPaperAnalysisReadAdapter({ repository, agentUserId: account.agentUserId }) },
    inputSchemas: { 'paper.analysis.read.input@1': validatePaperAnalysisReadInput },
    outputSchemas: { 'paper.analysis.read.output@1': validatePaperAnalysisReadOutput } });
  const registered = await runtime.registerWorkflow({ actorUserId: operatorId, manifest: articleWorkflow, status: 'draft' });
  if (registered.status === 'draft') await runtime.activateWorkflow(articleWorkflow.workflowKey, articleWorkflow.workflowVersion);
  const articleRun = await runtime.createRun({ agentUserId: account.agentUserId, workflowKey: articleWorkflow.workflowKey,
    workflowVersion: articleWorkflow.workflowVersion, triggerKind: 'manual', idempotencyKey: `text-only-article:${id()}`,
    input: { schemaVersion: 'paper-article-draft-input-v1', analysisId: analysis.id }, config: { model }, budget: articleWorkflow.defaultBudget });
  const articleHandlers = createAgentPaperArticleDraftHandlers({ toolGateway, providerGateway: gateway, artifactRepository: artifacts,
    researchEvidenceRepository: new PostgresAgentResearchEvidenceRepository(admin),
    draftGateway: createAgentBlogFoundationDraftGateway({ runtimeRepository: runtime, policyService,
      draftRepository: new PostgresAgentBlogFoundationDraftRepository(admin, { requireResearchEvidence: true }) }) });
  await execute(articleRun.id, articleHandlers, articleWorkflow.stages.length);
  const draft = (await admin.query(`SELECT a.publication_state,r.blocks,r.citations FROM agent_blog_foundation_drafts d
    JOIN blog_articles a ON a.id=d.article_id JOIN blog_article_revisions r ON r.id=d.revision_id WHERE d.run_id=$1`, [articleRun.id])).rows[0];
  assert.equal(draft.publication_state, 'draft');
  assert.match(draft.blocks[0].text, /待审草稿/u);
  assert.equal(draft.citations.length, 1);
  assert.equal(calls, 3);
  assert.equal((await admin.query('SELECT reliability_grade FROM agent_paper_parse_assessments WHERE paper_version_id=$1',
    [paperVersionId])).rows[0].reliability_grade, 'limited-text');
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM tool_research_evidence
    WHERE source_version_id=$1 AND allowed_uses @> ARRAY['citation']::text[]`, [versionId])).rows[0].n, 0);
  // Replay adds no live calls; the original API receipts stay in the fixture.
  const out = path.join(previewDirectory, 'text-only-draft-preview.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json({ offlineProviderFixture: !recordedProvider, recordedLiveReplay: !!recordedProvider,
    liveProviderCalls: 0, sourceSha256: f.sourceSha256, publicationState: 'draft',
    sourceUrl: f.sourceUrl, ...draft }, null, 2));
};
