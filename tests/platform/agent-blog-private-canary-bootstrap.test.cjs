const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

function config(overrides = {}) {
  return {
    schemaVersion: 'agent-blog-private-canary-config-v1', enabled: true, publishEnabled: false,
    agentUserId: crypto.randomUUID(), provider: 'deepseek', modelId: 'deepseek-flash',
    ...overrides,
  };
}

test('private canary bootstrap registers only the two private workflows and approved model catalog', async () => {
  const { createAgentBlogPrivateCanaryBootstrap } = await load('agent-blog-private-canary-bootstrap.mjs');
  const input = config();
  const operatorUserId = crypto.randomUUID();
  const registered = [];
  const activated = [];
  const tools = [];
  let model;
  const receipt = await createAgentBlogPrivateCanaryBootstrap({
    config: input,
    identityRepository: { load: async () => ({ agentUserId: input.agentUserId, operatorUserId }) },
    runtimeRepository: {
      registerWorkflow: async value => {
        registered.push(value);
        return { status: 'draft', manifestSha256: `sha-${registered.length}` };
      },
      activateWorkflow: async (key, version) => {
        activated.push([key, version]);
        return { status: 'active' };
      },
    },
    toolRepository: { registerTool: async value => {
      tools.push(value);
      return { ...value, existing: false };
    } },
    providerRepository: { registerModel: async value => {
      model = value;
      return { provider: value.provider, modelId: value.modelId, catalogVersion: value.catalogVersion, existing: false };
    } },
  }).run();
  assert.deepEqual(registered.map(item => [item.manifest.workflowKey, item.manifest.workflowVersion]), [
    ['blog.project.discovery-shadow', 3], ['blog.project.single.draft-shadow', 1],
  ]);
  assert.deepEqual(activated, [
    ['blog.project.discovery-shadow', 3], ['blog.project.single.draft-shadow', 1],
  ]);
  assert.deepEqual(tools.map(item => [item.toolKey, item.contractVersion]), [
    ['research.github.repository.search', 1], ['research.github.repository.read', 1],
  ]);
  assert.equal(model.provider, 'deepseek');
  assert.equal(model.modelId, 'deepseek-flash');
  assert.deepEqual(model.taskClasses, ['structured-generation']);
  assert.equal(model.supportsJsonSchema, true);
  assert.ok(model.maxInputTokens >= 60_000);
  assert.ok(model.maxOutputTokens >= 7_000);
  assert.equal(receipt.runCreated, false);
  assert.equal(receipt.providerInvoked, false);
  assert.equal(receipt.publicationAttempted, false);
});

test('private canary bootstrap is idempotent for active workflows and an existing catalog row', async () => {
  const { createAgentBlogPrivateCanaryBootstrap } = await load('agent-blog-private-canary-bootstrap.mjs');
  const input = config();
  const operatorUserId = crypto.randomUUID();
  let activations = 0;
  const receipt = await createAgentBlogPrivateCanaryBootstrap({
    config: input,
    identityRepository: { load: async () => ({ agentUserId: input.agentUserId, operatorUserId }) },
    runtimeRepository: {
      registerWorkflow: async ({ manifest }) => ({ status: 'active', manifestSha256: manifest.workflowKey }),
      activateWorkflow: async () => { activations += 1; },
    },
    toolRepository: { registerTool: async value => ({ ...value, existing: true }) },
    providerRepository: { registerModel: async value => ({
      provider: value.provider, modelId: value.modelId, catalogVersion: value.catalogVersion, existing: true,
    }) },
  }).run();
  assert.equal(activations, 0);
  assert.equal(receipt.workflows.every(item => item.status === 'active'), true);
  assert.equal(receipt.model.existing, true);
});

test('private canary bootstrap rejects unapproved models before catalog mutation', async () => {
  const { createAgentBlogPrivateCanaryBootstrap } = await load('agent-blog-private-canary-bootstrap.mjs');
  const input = config({ modelId: 'unknown-model' });
  let registeredModel = false;
  await assert.rejects(createAgentBlogPrivateCanaryBootstrap({
    config: input,
    identityRepository: { load: async () => ({ agentUserId: input.agentUserId, operatorUserId: crypto.randomUUID() }) },
    runtimeRepository: {
      registerWorkflow: async ({ manifest }) => ({ status: 'active', manifestSha256: manifest.workflowKey }),
      activateWorkflow: async () => ({ status: 'active' }),
    },
    toolRepository: { registerTool: async value => ({ ...value, existing: false }) },
    providerRepository: { registerModel: async () => { registeredModel = true; } },
  }).run(), error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_MODEL_CATALOG_UNSUPPORTED');
  assert.equal(registeredModel, false);
});
