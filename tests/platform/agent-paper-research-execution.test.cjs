const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const load = relative => import(pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src', relative)).href);

test('R1.8 paper research is bounded, private and has no publication capability', async () => {
  const { PAPER_RESEARCH_EXECUTION_WORKFLOW, normalizePaperResearchExecutionInput } =
    await load('agent-paper-research-execution.mjs');
  assert.equal(PAPER_RESEARCH_EXECUTION_WORKFLOW.workflowKey, 'paper.private.research');
  assert.deepEqual(PAPER_RESEARCH_EXECUTION_WORKFLOW.stages.map(stage => stage.key), [
    'resolve-source', 'acquire-source', 'verify-eligibility', 'reconstruct-sections',
    'extract-semantics', 'verify-semantics', 'persist-analysis', 'finalize-queue',
  ]);
  assert.equal(PAPER_RESEARCH_EXECUTION_WORKFLOW.defaultBudget.providerCalls, 1);
  assert.equal(PAPER_RESEARCH_EXECUTION_WORKFLOW.defaultBudget.toolCalls, 1);
  assert.equal(PAPER_RESEARCH_EXECUTION_WORKFLOW.requiredCapabilities
    .some(capability => capability.key === 'blog.article.publish'), false);
  const input = { schemaVersion: 'paper-private-research-input-v1',
    executionId: crypto.randomUUID(), queueItemId: crypto.randomUUID(),
    externalProcessingConsent: false };
  assert.deepEqual(normalizePaperResearchExecutionInput(input), input);
  assert.throws(() => normalizePaperResearchExecutionInput({ ...input,
    externalProcessingConsent: true, publish: true }), error => error.code === 'PAPER_RESEARCH_INPUT_INVALID');
});

test('R1.8 routes, worker and compose stay private and recoverable', () => {
  const root = path.resolve(__dirname, '../..');
  const routes = fs.readFileSync(path.join(root, 'apps/api/src/agent-account-routes.mjs'), 'utf8');
  const execution = fs.readFileSync(path.join(root, 'apps/api/src/agent-paper-research-execution.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'apps/api/src/agent-paper-research-worker-cli.mjs'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'deploy/compose.prod.yml'), 'utf8');
  assert.match(routes, /paper-research-queue\/:queueItemId\/executions/);
  assert.match(routes, /paper-research-executions\/:executionId\/retry/);
  assert.match(routes, /paper-research-executions\/:executionId\/cancel/);
  assert.match(execution, /PAPER_RESEARCH_USER_PDF_EXTERNAL_PROCESSING_FORBIDDEN/);
  assert.match(execution, /publicationAttempted:\s*false/);
  assert.doesNotMatch(execution, /blog_articles|publishArticle|blog\.article\.publish/);
  assert.match(worker, /AGENT_PAPER_RESEARCH_ARXIV_CONTACT_REQUIRED/);
  assert.match(worker, /registerTool\(ARXIV_PAPER_READ_TOOL\)/);
  assert.match(worker, /AGENT_PAPER_RESEARCH_ARXIV_TOOL_NOT_ACTIVE/);
  assert.match(compose, /agent-paper-research-worker:/);
  assert.match(compose, /restart:\s*unless-stopped/);
});

test('R1.8 migration makes execution and audit rows immutable and scoped', () => {
  const sql = fs.readFileSync(path.resolve(__dirname,
    '../../apps/api/migrations/0151_agent_paper_research_executions.sql'), 'utf8');
  assert.match(sql, /agent_paper_research_executions/);
  assert.match(sql, /agent_paper_research_execution_events/);
  assert.match(sql, /CREATE UNIQUE INDEX agent_paper_research_executions_active_queue/);
  assert.match(sql, /agent_paper_research_execution_events_immutable/);
  assert.match(sql, /paper\.private\.research/);
});
