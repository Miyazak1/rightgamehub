const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/agent-paper-semantic-runtime-bootstrap.mjs'));

test('paper semantic runtime config is independently disabled by default', async () => {
  const { loadAgentPaperSemanticRuntimeConfig } = await import(moduleUrl.href);
  const config = loadAgentPaperSemanticRuntimeConfig({});
  assert.deepEqual(config, { schemaVersion: 'agent-paper-semantic-runtime-config-v1',
    enabled: false, agentUserId: null, provider: 'deepseek', modelId: 'deepseek-flash' });
});

test('paper semantic runtime uses an explicit private agent identity', async () => {
  const { loadAgentPaperSemanticRuntimeConfig, DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG } =
    await import(moduleUrl.href);
  const agentUserId = crypto.randomUUID();
  const config = loadAgentPaperSemanticRuntimeConfig({ AGENT_PAPER_SEMANTIC_ENABLED: 'true',
    AGENT_PAPER_SEMANTIC_AGENT_USER_ID: agentUserId });
  assert.equal(config.agentUserId, agentUserId);
  assert.deepEqual(DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG.taskClasses,
    ['structured-generation', 'paper-semantic-analysis']);
  assert.equal(DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG.catalogVersion, 3);
});

test('paper semantic runtime fails closed for missing identity and unsupported model', async () => {
  const { loadAgentPaperSemanticRuntimeConfig } = await import(moduleUrl.href);
  assert.throws(() => loadAgentPaperSemanticRuntimeConfig({ AGENT_PAPER_SEMANTIC_ENABLED: 'true' }),
    error => error?.code === 'AGENT_PAPER_SEMANTIC_AGENT_REQUIRED');
  assert.throws(() => loadAgentPaperSemanticRuntimeConfig({ AGENT_PAPER_SEMANTIC_ENABLED: 'true',
    AGENT_PAPER_SEMANTIC_AGENT_USER_ID: crypto.randomUUID(),
    AGENT_PAPER_SEMANTIC_MODEL_ID: 'unreviewed-model' }),
  error => error?.code === 'AGENT_PAPER_SEMANTIC_MODEL_CATALOG_UNSUPPORTED');
});
