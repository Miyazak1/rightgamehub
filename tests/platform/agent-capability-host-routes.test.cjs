const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const Fastify = requireApi('fastify');
const routesUrl = pathToFileURL(path.join(root,
  'apps/api/src/agent-capability-host-routes.mjs')).href;

const agentUserId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const artifactId = '33333333-3333-4333-8333-333333333333';
const profile = {
  schemaVersion: 'capability-host-profile-v1',
  host: 'cursor',
  hostVersion: '1.2.3',
  surface: 'sidebar',
  connection: 'control-plane',
  features: {
    submit: true,
    cancel: true,
    resume: true,
    artifacts: true,
    fileConsent: true,
    background: false,
  },
};

test('capability host routes authenticate, validate and map every operation', async () => {
  const { registerAgentCapabilityHostRoutes } = await import(routesUrl);
  const calls = [];
  const record = (name, value) => { calls.push({ name, value }); return value; };
  const service = {
    registerBinding: async (actor, input) => record('registerBinding', { actor, input, existing: false }),
    snapshot: async (actor, id, host) => record('snapshot', { actor, id, host, runs: [] }),
    submit: async (actor, id, host, input) => record('submit', { actor, id, host, input, state: 'queued' }),
    get: async (actor, id, run, host) => record('get', { actor, id, run, host, state: 'running' }),
    cancel: async (actor, id, run, host) => record('cancel', { actor, id, run, host, state: 'cancelled' }),
    artifacts: async (actor, id, run, host) => record('artifacts', [{ actor, id, run, host }]),
    openDirective: async (actor, id, artifact, host) => record('openDirective', {
      actor, id, artifact, host, locator: `mooyu-artifact://host-preview/${artifact}`,
    }),
    artifactContent: async (actor, id, artifact, host) => record('artifactContent', {
      actor, id, artifact, host, content: { ok: true },
    }),
  };
  let authCount = 0;
  const app = Fastify({ logger: false });
  registerAgentCapabilityHostRoutes(app, {
    service,
    requireAuth: async request => {
      authCount += 1;
      request.actor = { userId: '44444444-4444-4444-8444-444444444444' };
    },
  });

  const binding = await app.inject({
    method: 'POST',
    url: '/v1/admin/capability-execution/host-bindings',
    payload: {
      capabilityId: 'research.paper.layout',
      capabilityVersion: '1.0.0',
      workflowKey: 'paper.layout',
      workflowVersion: 1,
      features: { cancel: true, resume: true, artifacts: true, openMode: 'host-preview' },
    },
  });
  assert.equal(binding.statusCode, 201);
  assert.equal(binding.headers['cache-control'], 'private, no-store');

  const snapshot = await app.inject({ method: 'POST',
    url: `/v1/me/agents/${agentUserId}/capability-host`, payload: { profile } });
  assert.equal(snapshot.statusCode, 200);

  const input = {
    capabilityId: 'research.paper.layout',
    capabilityVersion: '1.0.0',
    contractKey: 'research.paper.layout@1',
    input: { documentId: 'local-document-1' },
    idempotencyKey: 'cursor-local-document-0001',
  };
  const submit = await app.inject({ method: 'POST',
    url: `/v1/me/agents/${agentUserId}/capability-host/runs`, payload: { profile, input } });
  assert.equal(submit.statusCode, 202);

  for (const [suffix, expected] of [
    [`runs/${runId}`, 'get'],
    [`runs/${runId}/cancel`, 'cancel'],
    [`runs/${runId}/artifacts`, 'artifacts'],
    [`artifacts/${artifactId}/open`, 'openDirective'],
    [`artifacts/${artifactId}/content`, 'artifactContent'],
  ]) {
    const response = await app.inject({ method: 'POST',
      url: `/v1/me/agents/${agentUserId}/capability-host/${suffix}`, payload: { profile } });
    assert.equal(response.statusCode, 200, expected);
    assert.equal(response.headers['cache-control'], 'private, no-store', expected);
  }

  assert.equal(authCount, 8);
  assert.deepEqual(calls.map(call => call.name), [
    'registerBinding', 'snapshot', 'submit', 'get', 'cancel', 'artifacts', 'openDirective',
    'artifactContent',
  ]);
  assert.equal(calls[2].value.id, agentUserId);
  assert.deepEqual(calls[2].value.input, input);

  const invalid = await app.inject({ method: 'POST',
    url: `/v1/me/agents/${agentUserId}/capability-host/runs`,
    payload: { profile: { ...profile, features: { ...profile.features, submit: 'yes' } }, input },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 8);
  await app.close();
});
