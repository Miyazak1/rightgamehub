const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-semantic-eval-v1.json'), 'utf8'));

test('paper semantic workflow is private, bounded and reconstructs auditable page windows', async () => {
  const { PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW, reconstructPaperSections,
    normalizePaperSemanticRunInput } = await load('agent-paper-semantic-workflow.mjs');
  assert.equal(PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.workflowKey, 'paper.single.semantic-shadow');
  assert.deepEqual(PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.stages.map(stage => stage.key), [
    'verify-eligibility', 'reconstruct-sections', 'extract-semantics', 'verify-semantics', 'persist-analysis',
  ]);
  assert.equal(PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.requiredCapabilities
    .some(item => item.key === 'blog.article.publish'), false);
  assert.equal(PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.defaultBudget.providerCalls, 1);
  const manifest = reconstructPaperSections(fixture.evidence);
  assert.equal(manifest.method, 'deterministic-page-window');
  assert.deepEqual(manifest.sections.map(item => item.pageRange), [[1, 1], [2, 2], [3, 3]]);
  assert.equal(normalizePaperSemanticRunInput({ schemaVersion: 'paper-semantic-run-input-v1',
    paperVersionId: fixture.evidence[0].id, purpose: 'private-research' }).purpose, 'private-research');
});

test('paper semantic handlers reject non-public external processing before provider invocation', async () => {
  const { createAgentPaperSemanticHandlers } = await load('agent-paper-semantic-runtime.mjs');
  let invoked = false;
  const handlers = createAgentPaperSemanticHandlers({
    repository: { loadTrustedPaper: async () => ({ externalProcessingClass: 'private-user-upload' }) },
    providerGateway: { invoke: async () => { invoked = true; } },
    artifactRepository: {}, semanticGateway: {},
  });
  const route = handlers['paper.single.semantic-shadow:verify-eligibility'];
  const input = { schemaVersion: 'paper-semantic-run-input-v1',
    paperVersionId: fixture.evidence[0].id, purpose: 'private-research' };
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  await assert.rejects(route({ run: { input, inputSha256: stableHash(input), agentUserId: fixture.evidence[1].id } }),
    error => error.code === 'AGENT_PAPER_SEMANTIC_EXTERNAL_PROCESSING_FORBIDDEN');
  assert.equal(invoked, false);
});
