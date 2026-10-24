const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);

function contract() {
  return {
    toolKey: 'research.github.repository.read', contractVersion: 1, status: 'active',
    capabilityKey: 'research.github.read', riskLevel: 'L1', executionClass: 'remote', effectClass: 'read-only',
    inputSchema: { key: 'github.repository.read.input', version: 1 },
    outputSchema: { key: 'github.repository.read.output', version: 1 },
    networkPolicy: {}, filesystemPolicy: {}, timeoutSeconds: 30, outputLimitBytes: 131072,
  };
}

function invocation() {
  return {
    runId: 'run', stageId: 'stage', workerId: 'worker', leaseToken: 'lease',
    action: { actionKey: 'read-repository', actionKind: 'tool', capabilityKey: 'research.github.read', contractVersion: 1, riskLevel: 'L1' },
    idempotencyKey: 'github-read-fixture', resource: { type: 'github.repository', owner: 'public', id: 'owner/project' },
    tool: { toolKey: 'research.github.repository.read', contractVersion: 1 }, request: { repository: 'owner/project' },
  };
}

test('tool gateway enforces policy and persists validated output through the tool ledger', async () => {
  const { createAgentToolGateway } = await load('agent-tool-gateway.mjs');
  const calls = [];
  const gateway = createAgentToolGateway({
    runtimeRepository: {
      createAction: async () => (calls.push('prepare'), { id: 'action', existing: false }),
      transitionAction: async input => (calls.push(input.to), {}),
    },
    toolRepository: {
      resolveTool: async () => (calls.push('resolve'), contract()),
      reserveToolCall: async () => (calls.push('reserve'), { callId: 'call' }),
      markSending: async () => { calls.push('sending'); },
      acknowledge: async () => { calls.push('acknowledge'); },
      finish: async input => (calls.push('finish'), { artifactId: 'artifact', responseRef: { artifactId: 'artifact' }, output: input.output }),
    },
    policyService: { decide: async () => (calls.push('policy'), { decision: 'allow', agentUserId: 'agent' }) },
    adapters: { 'research.github.repository.read@1': async () => (calls.push('invoke'), {
      receiptId: 'github:owner/project@revision', output: { repository: 'owner/project' }, responseRef: {}, usage: { toolCalls: 1 },
    }) },
    inputSchemas: { 'github.repository.read.input@1': input => (calls.push('validate-input'), input) },
    outputSchemas: { 'github.repository.read.output@1': output => (calls.push('validate-output'), output) },
  });
  const result = await gateway.invoke(invocation());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.artifactId, 'artifact');
  assert.deepEqual(calls, ['resolve', 'validate-input', 'policy', 'prepare', 'authorized', 'reserve', 'sending',
    'invoke', 'acknowledge', 'validate-output', 'finish']);
});

test('read-only tool failure after dispatch is failed and retryable rather than uncertain', async () => {
  const { createAgentToolGateway, AgentToolGatewayError } = await load('agent-tool-gateway.mjs');
  let failure = null;
  const gateway = createAgentToolGateway({
    runtimeRepository: { createAction: async () => ({ id: 'action', existing: false }), transitionAction: async () => ({}) },
    toolRepository: {
      resolveTool: async () => contract(), reserveToolCall: async () => ({ callId: 'call' }), markSending: async () => {},
      failBeforeAcknowledgement: async (id, input) => { failure = { id, ...input }; return { status: 'failed' }; },
    },
    policyService: { decide: async () => ({ decision: 'allow', agentUserId: 'agent' }) },
    adapters: { 'research.github.repository.read@1': async () => {
      const error = new Error('upstream unavailable'); error.code = 'GITHUB_DOWN'; error.retryable = true; throw error;
    } },
    inputSchemas: { 'github.repository.read.input@1': input => input },
    outputSchemas: { 'github.repository.read.output@1': output => output },
  });
  await assert.rejects(gateway.invoke(invocation()), error => error instanceof AgentToolGatewayError
    && error.code === 'GITHUB_DOWN' && error.retryable === true && error.uncertain === false);
  assert.deepEqual(failure, { id: 'call', notDispatched: false, errorCode: 'GITHUB_DOWN', errorMessage: 'upstream unavailable' });
});

test('GitHub repository tool is fixed-origin, revision-pinned and bounded', async () => {
  const {
    createGitHubRepositoryReadAdapter, normalizeGitHubRepositoryLocator,
    validateGitHubRepositoryReadInput, validateGitHubRepositoryReadOutput,
  } = await load('agent-github-repository-tool.mjs');
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    if (url.endsWith('/repos/owner/project')) return new Response(JSON.stringify({
      name: 'project', full_name: 'owner/project', description: 'A useful project', homepage: 'https://example.com',
      default_branch: 'main', stargazers_count: 42, forks_count: 3, open_issues_count: 1, topics: ['agent'],
      license: { spdx_id: 'MIT' }, archived: false, pushed_at: '2026-10-24T00:00:00Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/commits/main')) return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 });
    if (url.includes('/readme?ref=main')) return new Response(JSON.stringify({
      encoding: 'base64', path: 'docs/README.md', content: Buffer.from('# Project\nUseful README excerpt.').toString('base64'),
    }), { status: 200 });
    return new Response('', { status: 404 });
  };
  const adapter = createGitHubRepositoryReadAdapter({ fetchImpl });
  const receipt = await adapter({ request: validateGitHubRepositoryReadInput({ repository: 'https://github.com/owner/project' }), timeoutSeconds: 5 });
  assert.equal(receipt.receiptId, `github:owner/project@${'a'.repeat(40)}`);
  assert.equal(receipt.output.sourceVersion.revision, 'a'.repeat(40));
  assert.equal(receipt.output.metadata.stars, 42);
  assert.equal(validateGitHubRepositoryReadOutput(receipt.output).readme.text.includes('Useful README'), true);
  assert.equal(requests.length, 3);
  assert(requests.every(url => url.startsWith('https://api.github.com/')));
  assert.equal(normalizeGitHubRepositoryLocator('OWNER/Project.git').key, 'owner/project');
  for (const invalid of ['http://github.com/owner/project', 'https://evil.example/owner/project',
    'https://github.com/owner/project/issues', 'owner/project/extra', '127.0.0.1/repo']) {
    assert.throws(() => normalizeGitHubRepositoryLocator(invalid));
  }
});
