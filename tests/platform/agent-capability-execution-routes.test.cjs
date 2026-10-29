const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const Fastify = requireApi('fastify');
const routesUrl = pathToFileURL(path.join(root,
  'apps/api/src/agent-capability-execution-routes.mjs')).href;

test('capability execution control routes are authenticated and no-store', async () => {
  const { registerAgentCapabilityExecutionRoutes } = await import(routesUrl);
  const calls = [];
  const service = {
    snapshot: async actor => ({ actor }),
    registerManifest: async (actor, body) => ({ actor, body, existing: false }),
    activateManifest: async (actor, capabilityId, capabilityVersion) => ({ actor, capabilityId, capabilityVersion }),
    registerNode: async (actor, body) => ({ actor, ...body, id: body.id ?? '11111111-1111-4111-8111-111111111111' }),
    heartbeatNode: async (actor, nodeId, body) => ({ actor, nodeId, body }),
    reportPackageEvent: async (actor, nodeId, body) => ({ actor, nodeId, body, receiptId: 'receipt' }),
    selectPlacement: async (actor, body) => { calls.push({ actor, body }); return { status: 'ready', existing: false }; },
  };
  const app = Fastify({ logger: false });
  registerAgentCapabilityExecutionRoutes(app, { service,
    requireAuth: async request => { request.actor = { userId: '22222222-2222-4222-8222-222222222222' }; } });
  const snapshot = await app.inject({ method: 'GET', url: '/v1/admin/capability-execution' });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.headers['cache-control'], 'no-store');
  const node = await app.inject({ method: 'POST', url: '/v1/admin/capability-execution/nodes', payload: {
    kind: 'desktop', platform: 'windows-x64', deviceKeySha256: 'a'.repeat(64),
    runtimeVersion: '1.0.0', resources: { cpuCores: 4, memoryMiB: 8192, diskMiB: 20000, gpuMemoryMiB: 0 },
    permissions: { files: 'user-selected', networkDomains: [], devices: [] }, metadata: { userPresent: true },
  } });
  assert.equal(node.statusCode, 201);
  const placement = await app.inject({ method: 'POST', url: '/v1/admin/capability-execution/placements', payload: {
    stageId: '33333333-3333-4333-8333-333333333333', capabilityId: 'research.paper.layout',
    capabilityVersion: '1.0.0', cloudConsent: false, userPresent: true,
  } });
  assert.equal(placement.statusCode, 201);
  assert.equal(calls.length, 1);
  const invalid = await app.inject({ method: 'POST', url: '/v1/admin/capability-execution/nodes', payload: {
    kind: 'desktop', platform: 'windows-x64', deviceKeySha256: 'a'.repeat(64), runtimeVersion: '1.0.0',
    resources: { cpuCores: 4, memoryMiB: 8192, diskMiB: 20000, gpuMemoryMiB: 0 },
    permissions: { files: 'user-selected', networkDomains: [], devices: [] },
  } });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});
