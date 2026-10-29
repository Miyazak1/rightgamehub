const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('paper source archives one immutable page-evidence chain without publishing', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
  const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
  const { createAgentToolGateway } = await harness.load('agent-tool-gateway.mjs');
  const { ARXIV_PAPER_READ_TOOL, validateArxivPaperReadInput,
    validateArxivPaperReadOutput } = await harness.load('agent-arxiv-paper-tool.mjs');
  const { PostgresAgentResearchEvidenceRepository } = await harness.load('agent-research-evidence-repository.mjs');
  const { stableHash } = await harness.load('researcher-qa-protocol/stable-json.mjs');

  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Paper operator','admin')", [operatorId]);
  const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
    authorizeOperator: async () => true }).provision({ userId: operatorId }, {
    provisionKey: `paper-${crypto.randomUUID()}`, displayName: 'Paper Agent',
    handle: `paper-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手', operatorLabel: 'Paper test',
    capabilities: ['blog:auto-publish'], metadata: {},
  });
  const runtime = new PostgresAgentRuntimeRepository(admin);
  const workflow = {
    schemaVersion: 'agent-workflow-v1', workflowKey: `paper.test.${crypto.randomBytes(5).toString('hex')}`,
    workflowVersion: 1, inputSchema: 'paper-test-input-v1', outputSchema: 'paper-test-output-v1',
    requiredCapabilities: [{ key: 'research.paper.read', version: 2 }],
    defaultBudget: { providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
    stages: [{ key: 'read-paper', kind: 'tool', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30,
      capability: { key: 'research.paper.read', version: 2 }, idempotencyMode: 'key' }],
  };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: workflow });
  await runtime.activateWorkflow(workflow.workflowKey, 1);
  const run = await runtime.createRun({ agentUserId: account.agentUserId,
    workflowKey: workflow.workflowKey, workflowVersion: 1, triggerKind: 'manual',
    idempotencyKey: `paper-run:${crypto.randomUUID()}`, input: {}, config: {} });
  const stage = await runtime.claimNextStage('paper-worker', 60, [`${workflow.workflowKey}:read-paper`]);
  await runtime.startStage({ stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken });
  const tools = new PostgresAgentToolGatewayRepository(admin);
  await tools.registerTool(ARXIV_PAPER_READ_TOOL);
  const artifactVersionId = crypto.randomUUID();
  const contentSha256 = stableHash('fixture-pdf');
  const quoteText = 'The experiment reports a bounded and reproducible result.';
  const output = {
    schemaVersion: 'arxiv-paper-research-v2',
    identity: { artifactType: 'academic-paper', canonicalId: 'arxiv:2401.12345',
      identifiers: { doi: null, arxiv: '2401.12345' }, title: 'Bounded Paper Fixture',
      authors: ['Alice Example'], year: 2026, venue: null, identityConfidence: 'confirmed' },
    version: { artifactVersionId, identityCanonicalId: 'arxiv:2401.12345', versionKind: 'preprint',
      sourceUrl: 'https://arxiv.org/pdf/2401.12345v1.pdf', fetchedAt: '2026-10-27T00:00:00.000Z',
      contentSha256, accessLevel: 'fulltext-open', parentVersionId: null, versionRelation: 'initial' },
    layoutManifest: { artifactVersionId, pageCount: 1, parserVersion: 'fixture-parser-v2', pages: [{
      page: 1, width: 600, height: 800, readingOrder: ['p1-b1'], blocks: [{ id: 'p1-b1',
        kind: 'paragraph', bbox: [0, 0, 600, 800], text: quoteText, confidence: 1,
        extractionMethod: 'text-layer' }],
    }] },
    evidenceSpans: [{ artifactVersionId,
      locator: { kind: 'paper.layout', pages: [1], sectionPath: [], blockIds: ['p1-b1'], objectLabel: null },
      quoteText, quoteHash: stableHash(quoteText), extractionMethod: 'text-layer', confidence: 1 }],
    qualityAssessment: { schemaVersion: 'paper-parse-quality-v1',
      policyVersion: 'paper-text-layer-gate-v1', parserVersion: 'fixture-parser-v2',
      grade: 'trusted-text', permittedUses: ['analysis', 'citation', 'comparison'], reasonCodes: [],
      metrics: { pageCount: 1, textPageCount: 1, emptyPageCount: 0, scannedPageCount: 0,
        textChars: quoteText.length, evidencePageCount: 1, textCoverageBp: 10000,
        evidenceCoverageBp: 10000, lowDensityPageCount: 0, orderRiskPageCount: 0,
        multiColumnPageCount: 0, tableRiskPageCount: 0, formulaRiskPageCount: 0,
        imagePageCount: 0 } },
    metadata: { abstract: 'A bounded fixture abstract.', categories: ['cs.AI'],
      updatedAt: '2026-10-26T00:00:00.000Z', versionedArxivId: '2401.12345v1',
      extractionMethod: 'pdfjs-text-layer' },
    sourceVersion: { revision: '2401.12345v1', canonicalUri: 'https://arxiv.org/pdf/2401.12345v1.pdf',
      fetchedAt: '2026-10-27T00:00:00.000Z', contentSha256 },
  };
  const gateway = createAgentToolGateway({ runtimeRepository: runtime, toolRepository: tools,
    policyService: createAgentRuntimePolicyService({ pool: admin }),
    adapters: { 'research.paper.arxiv.read@2': async () => ({ receiptId: 'arxiv:2401.12345v1',
      output, responseRef: { canonicalUri: output.version.sourceUrl, revision: '2401.12345v1' },
      usage: { toolCalls: 1, networkRequests: 2 } }) },
    inputSchemas: { 'paper.arxiv.read.input@1': validateArxivPaperReadInput },
    outputSchemas: { 'paper.arxiv.read.output@2': validateArxivPaperReadOutput },
  });
  const invoked = await gateway.invoke({ runId: run.id, stageId: stage.id,
    workerId: stage.leasedBy, leaseToken: stage.leaseToken,
    action: { actionKey: 'read-arxiv', actionKind: 'tool', capabilityKey: 'research.paper.read',
      contractVersion: 2, riskLevel: 'L1' }, idempotencyKey: `paper:${run.id}`,
    resource: { type: 'paper.arxiv', owner: 'public', id: '2401.12345' },
    tool: { toolKey: ARXIV_PAPER_READ_TOOL.toolKey, contractVersion: 2 },
    request: { paper: '2401.12345v1' } });
  const evidenceRepository = new PostgresAgentResearchEvidenceRepository(admin);
  const archived = await evidenceRepository.archiveSourceArtifact({ runId: run.id, stageId: stage.id,
    actionId: invoked.actionId, toolArtifactId: invoked.artifactId,
    workerId: stage.leasedBy, leaseToken: stage.leaseToken });
  assert.equal(archived.artifactKind, 'paper');
  assert.equal(archived.evidenceCount, 2);
  assert.equal(archived.parseQuality.grade, 'trusted-text');
  assert.equal((await evidenceRepository.archiveSourceArtifact({ runId: run.id, stageId: stage.id,
    actionId: invoked.actionId, toolArtifactId: invoked.artifactId,
    workerId: stage.leasedBy, leaseToken: stage.leaseToken })).existing, true);
  const counts = (await admin.query(`SELECT
    (SELECT count(*)::int FROM agent_paper_identities WHERE agent_user_id=$1) AS identities,
    (SELECT count(*)::int FROM agent_paper_versions version JOIN agent_paper_identities identity
      ON identity.id=version.paper_identity_id WHERE identity.agent_user_id=$1) AS versions,
    (SELECT count(*)::int FROM agent_paper_layout_manifests
      WHERE paper_version_id=$3) AS layouts,
    (SELECT count(*)::int FROM agent_paper_parse_assessments
      WHERE paper_version_id=$3) AS assessments,
    (SELECT count(*)::int FROM agent_research_artifact_bindings WHERE run_id=$2 AND artifact_kind='paper') AS bindings,
    (SELECT count(*)::int FROM blog_articles WHERE author_user_id=$1) AS articles`,
  [account.agentUserId, run.id, archived.paperVersionId])).rows[0];
  assert.deepEqual(counts, { identities: 1, versions: 1, layouts: 1, assessments: 1,
    bindings: 1, articles: 0 });
  await assert.rejects(admin.query('UPDATE agent_paper_versions SET version_kind=$2 WHERE id=$1',
    [archived.paperVersionId, 'journal']), /immutable/u);
  await assert.rejects(admin.query(`UPDATE agent_paper_parse_assessments
    SET reliability_grade='limited-text' WHERE paper_version_id=$1`, [archived.paperVersionId]),
  /immutable/u);
  await runtime.completeStage({ stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken,
    outputRef: { artifactId: invoked.artifactId }, runOutput: { type: 'paper.evidence', id: archived.id } });
  await admin.end();
});
