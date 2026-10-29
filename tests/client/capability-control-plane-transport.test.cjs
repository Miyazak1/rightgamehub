const test = require('node:test');
const assert = require('node:assert/strict');

const agentUserId = 'c98abda1-d115-4e05-9c2e-43f68119386a';
const runId = 'bf9af255-0b8f-49bb-9884-6a3dbf076a9f';
const artifactId = '9a59180c-598e-4d63-9e6c-cfbdb315ab8d';
const now = '2026-10-29T02:00:00.000Z';
const content = { title: 'verified artifact', pages: 3 };
const sha256 = '649aecc00ef343f9ee9c7a6517a8f031a735b1c569ce197fcd2ca1b40fb887ea';
const profile = { schemaVersion: 'capability-host-profile-v1', host: 'cursor',
  hostVersion: '2.1.0', surface: 'sidebar', connection: 'control-plane',
  features: { submit: true, cancel: true, resume: true, artifacts: true,
    fileConsent: true, background: true } };
const run = (state = 'running', completed = 1) => ({ schemaVersion: 'capability-host-run-v1',
  runId, capabilityId: 'mooyu.research.paper.layout', capabilityVersion: '1.0.0',
  contractKey: 'research.paper.layout@1', state,
  progress: { phase: state, completed, total: 3, unit: 'pages' },
  artifactCount: state === 'succeeded' ? 1 : 0, resumable: state === 'running',
  createdAt: now, updatedAt: now, errorCode: null });

test('control-plane transport maps one host protocol onto authenticated API methods', async () => {
  const { createCapabilityControlPlaneTransport } = await import('../../packages/host-contract/src/index.mjs');
  const calls = [], opened = [];
  const apiClient = {
    async getCapabilityHostSnapshot(...args) { calls.push(['snapshot', ...args]); return { data: { profile, runs: [] } }; },
    async submitCapabilityHostRun(...args) { calls.push(['submit', ...args]); return { data: run('queued', 0) }; },
    async getCapabilityHostRun(...args) { calls.push(['get', ...args]); return { data: run() }; },
    async cancelCapabilityHostRun(...args) { calls.push(['cancel', ...args]); return { data: run('cancelled', 1) }; },
    async listCapabilityHostRunArtifacts(...args) { calls.push(['artifacts', ...args]); return { data: [] }; },
    async getCapabilityHostArtifactOpenDirective(...args) { calls.push(['open', ...args]); return { data: {
      schemaVersion: 'capability-artifact-open-v1', artifactId, runId, openMode: 'host-preview',
      name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256,
      locator: `mooyu-artifact://host-preview/${artifactId}`, expiresAt: new Date(Date.now()+240000).toISOString(),
    } }; },
    async getCapabilityHostArtifactContent(...args) { calls.push(['content', ...args]); return { data: {
      schemaVersion: 'capability-artifact-content-v1', artifactId, runId, name: 'verified.result',
      mediaType: 'application/json', sizeBytes: 39, sha256, content,
    } }; },
  };
  const transport = createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
    openArtifact: async directive => { opened.push(directive); return { opened: true }; } });
  assert.deepEqual(await transport.request('capability.host.snapshot', null), { profile, runs: [] });
  await transport.request('capability.runs.submit', { capabilityId: 'mooyu.research.paper.layout' });
  await transport.request('capability.runs.get', { runId });
  await transport.request('capability.runs.cancel', { runId });
  await transport.request('capability.runs.artifacts', { runId });
  assert.deepEqual(await transport.request('capability.artifacts.open', { artifactId }),
    { opened: true, cancelled: false });
  assert.deepEqual(calls.map(item => item[0]), ['snapshot', 'submit', 'get', 'cancel', 'artifacts', 'open', 'content']);
  assert.ok(calls.every(item => item[1] === agentUserId));
  assert.equal(opened[0].directive.openMode, 'host-preview');
  assert.deepEqual(opened[0].artifact.content, content);
  transport.dispose();
});

test('long-task polling survives a transient disconnect and emits only actual progress changes', async () => {
  const { createCapabilityControlPlaneTransport } = await import('../../packages/host-contract/src/index.mjs');
  let call = 0;
  const queue = [];
  const apiClient = {
    async getCapabilityHostSnapshot() {
      call += 1;
      if (call === 1) throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
      return { data: { profile, runs: [run(call >= 20 ? 'succeeded' : 'running', call >= 20 ? 3 : 1)] } };
    },
    submitCapabilityHostRun() {}, getCapabilityHostRun() {}, cancelCapabilityHostRun() {},
    listCapabilityHostRunArtifacts() {}, getCapabilityHostArtifactOpenDirective() {},
    getCapabilityHostArtifactContent() {},
  };
  const transport = createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
    openArtifact: async () => ({ opened: true }), pollIntervalMs: 250,
    setTimer: callback => { queue.push(callback); return callback; },
    clearTimer: callback => { const index = queue.indexOf(callback); if (index >= 0) queue.splice(index, 1); },
  });
  const events = [];
  const unsubscribe = transport.subscribe(event => events.push(event));
  for (let index = 0; index < 20; index += 1) { const callback = queue.shift(); await callback(); await Promise.resolve(); }
  assert.deepEqual(events.map(event => event.run.state), ['running', 'succeeded']);
  assert.deepEqual(events.map(event => event.sequence), [1, 2]);
  unsubscribe(); transport.dispose();
});

test('offline artifact fetch never reaches the host and a later explicit retry uses fresh data', async () => {
  const { createCapabilityControlPlaneTransport } = await import('../../packages/host-contract/src/index.mjs');
  let contentCalls = 0; let opened = 0;
  const apiClient = {
    getCapabilityHostSnapshot() {}, submitCapabilityHostRun() {}, getCapabilityHostRun() {},
    cancelCapabilityHostRun() {}, listCapabilityHostRunArtifacts() {},
    async getCapabilityHostArtifactOpenDirective() { return { data: {
      schemaVersion: 'capability-artifact-open-v1', artifactId, runId, name: 'verified.result',
      mediaType: 'application/json', sizeBytes: 39, sha256, openMode: 'host-preview',
      locator: `mooyu-artifact://host-preview/${artifactId}`,
      expiresAt: new Date(Date.now()+240000).toISOString(),
    } }; },
    async getCapabilityHostArtifactContent() {
      contentCalls += 1;
      if (contentCalls === 1) throw Object.assign(new Error('offline'),
        { code: 'NETWORK_ERROR', retryable: true });
      return { data: { schemaVersion: 'capability-artifact-content-v1', artifactId, runId,
        name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256, content } };
    },
  };
  const transport = createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
    openArtifact: async () => { opened += 1; return { opened: true, cancelled: false }; } });
  await assert.rejects(transport.request('capability.artifacts.open', { artifactId }),
    { code: 'NETWORK_ERROR' });
  assert.equal(opened, 0);
  assert.deepEqual(await transport.request('capability.artifacts.open', { artifactId }),
    { opened: true, cancelled: false });
  assert.equal(opened, 1);
  assert.equal(contentCalls, 2);
  transport.dispose();
});

test('a cancelled native save dialog is returned as a successful no-op', async () => {
  const { createCapabilityControlPlaneTransport } = await import('../../packages/host-contract/src/index.mjs');
  const apiClient = {
    getCapabilityHostSnapshot() {}, submitCapabilityHostRun() {}, getCapabilityHostRun() {},
    cancelCapabilityHostRun() {}, listCapabilityHostRunArtifacts() {},
    async getCapabilityHostArtifactOpenDirective() { return { data: {
      schemaVersion: 'capability-artifact-open-v1', artifactId, runId, name: 'verified.result',
      mediaType: 'application/json', sizeBytes: 39, sha256, openMode: 'download',
      locator: `mooyu-artifact://download/${artifactId}`,
      expiresAt: new Date(Date.now()+240000).toISOString(),
    } }; },
    async getCapabilityHostArtifactContent() { return { data: {
      schemaVersion: 'capability-artifact-content-v1', artifactId, runId, name: 'verified.result',
      mediaType: 'application/json', sizeBytes: 39, sha256, content,
    } }; },
  };
  const transport = createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
    openArtifact: async () => ({ opened: false, cancelled: true }) });
  assert.deepEqual(await transport.request('capability.artifacts.open', { artifactId }),
    { opened: false, cancelled: true });
  transport.dispose();
});

test('control-plane transport rejects untrusted open directives before invoking the host', async () => {
  const { createCapabilityControlPlaneTransport } = await import('../../packages/host-contract/src/index.mjs');
  let opened = false;
  const apiClient = {
    getCapabilityHostSnapshot() {}, submitCapabilityHostRun() {}, getCapabilityHostRun() {},
    cancelCapabilityHostRun() {}, listCapabilityHostRunArtifacts() {},
    async getCapabilityHostArtifactOpenDirective() { return { data: { schemaVersion: 'capability-artifact-open-v1',
      artifactId, runId, openMode: 'external-app', locator: 'file:///C:/secret.txt', expiresAt: 'not-a-date' } }; },
    getCapabilityHostArtifactContent() {},
  };
  const transport = createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
    openArtifact: async () => { opened = true; return { opened: true }; } });
  await assert.rejects(transport.request('capability.artifacts.open', { artifactId }),
    { code: 'CAPABILITY_HOST_OPEN_DIRECTIVE_INVALID' });
  assert.equal(opened, false);
});

test('control-plane transport rejects altered artifact content before invoking the host', async () => {
  const { createCapabilityControlPlaneTransport } = await import('../../packages/host-contract/src/index.mjs');
  let opened = false;
  const apiClient = {
    getCapabilityHostSnapshot() {}, submitCapabilityHostRun() {}, getCapabilityHostRun() {},
    cancelCapabilityHostRun() {}, listCapabilityHostRunArtifacts() {},
    async getCapabilityHostArtifactOpenDirective() { return { data: {
      schemaVersion: 'capability-artifact-open-v1', artifactId, runId, name: 'verified.result',
      mediaType: 'application/json', sizeBytes: 39, sha256, openMode: 'host-preview',
      locator: `mooyu-artifact://host-preview/${artifactId}`,
      expiresAt: new Date(Date.now()+240000).toISOString(),
    } }; },
    async getCapabilityHostArtifactContent() { return { data: {
      schemaVersion: 'capability-artifact-content-v1', artifactId, runId, name: 'verified.result',
      mediaType: 'application/json', sizeBytes: 39, sha256, content: { ...content, pages: 4 },
    } }; },
  };
  const transport = createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
    openArtifact: async () => { opened = true; return { opened: true }; } });
  await assert.rejects(transport.request('capability.artifacts.open', { artifactId }),
    { code: 'CAPABILITY_HOST_ARTIFACT_INTEGRITY' });
  assert.equal(opened, false);
});

test('platform API client sends capability host traffic through the authenticated agent scope', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const api = createApiClient({ baseUrl: 'https://mooyu.test', getAccessToken: () => 'session-token',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    } });
  await api.getCapabilityHostSnapshot(agentUserId, profile);
  await api.submitCapabilityHostRun(agentUserId, profile, { capabilityId: 'mooyu.research.paper.layout' });
  await api.cancelCapabilityHostRun(agentUserId, runId, profile);
  assert.deepEqual(requests.map(item => new URL(item.url).pathname), [
    `/v1/me/agents/${agentUserId}/capability-host`,
    `/v1/me/agents/${agentUserId}/capability-host/runs`,
    `/v1/me/agents/${agentUserId}/capability-host/runs/${runId}/cancel`,
  ]);
  for (const request of requests) {
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer session-token');
    assert.ok(request.init.headers['Idempotency-Key']);
    assert.deepEqual(JSON.parse(request.init.body).profile, profile);
  }
});

test('platform API client registers explicit host bindings through authenticated admin scope', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let observed;
  const api = createApiClient({ baseUrl: 'https://mooyu.test', getAccessToken: () => 'admin-token',
    fetchImpl: async (url, init) => {
      observed = { url: String(url), init };
      return new Response(JSON.stringify({ data: { existing: false } }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    } });
  const binding = { capabilityId: 'research.paper.layout', capabilityVersion: '1.0.0',
    workflowKey: 'paper.layout', workflowVersion: 1,
    features: { cancel: true, resume: true, artifacts: true, openMode: 'host-preview' } };
  await api.registerAdminCapabilityHostBinding(binding);
  assert.equal(new URL(observed.url).pathname, '/v1/admin/capability-execution/host-bindings');
  assert.equal(observed.init.method, 'POST');
  assert.equal(observed.init.headers.Authorization, 'Bearer admin-token');
  assert.ok(observed.init.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(observed.init.body), binding);
});
