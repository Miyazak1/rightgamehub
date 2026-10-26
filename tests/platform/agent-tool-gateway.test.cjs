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
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/repos/owner/project')) return new Response(JSON.stringify({
      name: 'project', full_name: 'owner/project', description: 'A useful project', homepage: 'https://example.com',
      default_branch: 'main', stargazers_count: 42, forks_count: 3, open_issues_count: 1, topics: ['agent'],
      license: { spdx_id: 'MIT' }, archived: false, pushed_at: '2026-10-24T00:00:00Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({
      object: { type: 'commit', sha: 'a'.repeat(40) },
    }), { status: 200 });
    if (url.includes(`/readme?ref=${'a'.repeat(40)}`)) return new Response('# Project\nUseful README excerpt.', {
      status: 200, headers: { 'content-disposition': 'inline; filename="README.md"' },
    });
    return new Response('', { status: 404 });
  };
  const adapter = createGitHubRepositoryReadAdapter({ fetchImpl });
  const receipt = await adapter({ request: validateGitHubRepositoryReadInput({ repository: 'https://github.com/owner/project' }), timeoutSeconds: 5 });
  assert.equal(receipt.receiptId, `github:owner/project@${'a'.repeat(40)}`);
  assert.equal(receipt.output.sourceVersion.revision, 'a'.repeat(40));
  assert.equal(receipt.output.metadata.stars, 42);
  assert.equal(validateGitHubRepositoryReadOutput(receipt.output).readme.text.includes('Useful README'), true);
  assert.equal(receipt.output.readme.path, 'README.md');
  assert.equal(receipt.output.readme.truncated, false);
  assert.equal(requests.length, 3);
  assert(requests.every(item => item.url.startsWith('https://api.github.com/')));
  assert.equal(requests[2].options.headers.accept, 'application/vnd.github.raw+json');
  assert.equal(requests[2].options.headers.range, 'bytes=0-49151');
  const tampered = structuredClone(receipt.output);
  tampered.readme.canonicalUri = 'https://evil.example/README.md';
  assert.throws(() => validateGitHubRepositoryReadOutput(tampered));
  assert.equal(normalizeGitHubRepositoryLocator('OWNER/Project.git').key, 'owner/project');
  for (const invalid of ['http://github.com/owner/project', 'https://evil.example/owner/project',
    'https://github.com/owner/project/issues', 'owner/project/extra', '127.0.0.1/repo']) {
    assert.throws(() => normalizeGitHubRepositoryLocator(invalid));
  }
});

test('GitHub repository tool streams a bounded raw README prefix instead of rejecting a large README', async () => {
  const { createGitHubRepositoryReadAdapter } = await load('agent-github-repository-tool.mjs');
  const revision = 'b'.repeat(40);
  const fetchImpl = async url => {
    if (url.endsWith('/repos/owner/large')) return new Response(JSON.stringify({
      name: 'large', full_name: 'owner/large', default_branch: 'main', stargazers_count: 10,
      forks_count: 1, open_issues_count: 0, topics: [], license: { spdx_id: 'MIT' }, archived: false,
    }), { status: 200 });
    if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({
      object: { type: 'commit', sha: revision },
    }), { status: 200 });
    if (url.includes(`/readme?ref=${revision}`)) return new Response('甲'.repeat(200000), {
      status: 200, headers: { 'content-length': '600000', 'content-disposition': 'inline; filename=README.zh-CN.md' },
    });
    return new Response('', { status: 404 });
  };
  const receipt = await createGitHubRepositoryReadAdapter({ fetchImpl })({
    request: { repository: 'https://github.com/owner/large' }, timeoutSeconds: 5,
  });
  assert.equal(receipt.output.sourceVersion.revision, revision);
  assert.equal(receipt.output.readme.text.length, 12000);
  assert.equal(receipt.output.readme.truncated, true);
  assert.equal(receipt.output.readme.path, 'README.zh-CN.md');
  assert.equal(receipt.usage.networkRequests, 3);
});

test('GitHub repository tool keeps strict response limits for metadata and references', async () => {
  const { createGitHubRepositoryReadAdapter } = await load('agent-github-repository-tool.mjs');
  const adapter = createGitHubRepositoryReadAdapter({ fetchImpl: async () => new Response('{}', {
    status: 200, headers: { 'content-length': '300000' },
  }) });
  await assert.rejects(adapter({ request: { repository: 'owner/project' }, timeoutSeconds: 5 }),
    error => error.code === 'AGENT_GITHUB_RESPONSE_TOO_LARGE');
});

test('GitHub discovery tool accepts only plain bounded queries and returns non-evidentiary candidates', async () => {
  const {
    createGitHubRepositorySearchAdapter, validateGitHubRepositorySearchInput,
    validateGitHubRepositorySearchOutput,
  } = await load('agent-github-repository-search-tool.mjs');
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return new Response(JSON.stringify({ items: [
      { name: 'UsefulTool', owner: { login: 'OpenTeam' }, description: 'Useful and observable.',
        stargazers_count: 100, forks_count: 9, language: 'TypeScript', topics: ['agent', 'tool'],
        license: { spdx_id: 'MIT' }, archived: false, fork: false, pushed_at: '2026-10-25T00:00:00Z' },
      { name: 'Archived', owner: { login: 'OpenTeam' }, stargazers_count: 99, forks_count: 1,
        archived: true, fork: false, pushed_at: '2026-10-20T00:00:00Z' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const input = validateGitHubRepositorySearchInput({ query: 'agent tool', limit: 10,
    sort: 'stars', minStars: 20, pushedAfter: '2026-01-01' });
  const receipt = await createGitHubRepositorySearchAdapter({ fetchImpl })({ request: input, timeoutSeconds: 5 });
  assert.equal(requests.length, 1);
  assert(requests[0].startsWith('https://api.github.com/search/repositories?'));
  assert.match(new URL(requests[0]).searchParams.get('q'),
    /archived:false fork:false stars:>=20 pushed:>=2026-01-01/u);
  assert.equal(receipt.output.candidates.length, 1);
  assert.equal(receipt.output.candidates[0].key, 'openteam/usefultool');
  assert.equal(receipt.output.candidates[0].canonicalUrl, 'https://github.com/OpenTeam/UsefulTool');
  assert.equal(Object.hasOwn(receipt.output.candidates[0], 'readme'), false);
  assert.equal(validateGitHubRepositorySearchOutput(receipt.output).source.contentSha256.length, 64);
  for (const query of ['stars:>0', 'agent/tool', 'a', 'agent\nrepo']) {
    assert.throws(() => validateGitHubRepositorySearchInput({ query, limit: 10,
      sort: 'stars', minStars: 0, pushedAfter: null }));
  }
});
