const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const Fastify = requireApi('fastify');
const routesUrl = pathToFileURL(path.join(root,
  'apps/api/src/agent-execution-node-access-routes.mjs')).href;

test('trusted node routes separate admin, pairing and node principals', async () => {
  const { registerAgentExecutionNodeAccessRoutes } = await import(routesUrl);
  const calls = [];
  const service = {
    snapshot: async actor => ({ actor, pairings: [] }),
    createPairing: async (actor, body) => ({ actor, ...body, pairingId: 'pairing', pairingCode: 'secret' }),
    claimPairing: async body => ({ body, accessToken: 'node-access', renewalToken: 'node-renewal' }),
    refreshSession: async body => ({ body, accessToken: 'rotated' }),
    authenticateNodeBearer: async header => {
      if (header !== 'Bearer node-token') { const error = new Error('AUTH'); error.statusCode = 401; throw error; }
      return { principalType: 'execution-node', nodeId: '11111111-1111-4111-8111-111111111111',
        ownerUserId: '22222222-2222-4222-8222-222222222222',
        grantId: '33333333-3333-4333-8333-333333333333',
        scopes: ['node:heartbeat', 'leases:claim'] };
    },
    nodeSnapshot: async actor => ({ actor }),
    heartbeat: async (actor, body) => { calls.push({ actor, body }); return { status: 'online' }; },
    reportPackageEvent: async (actor, body) => ({ actor, body, receiptId: 'receipt' }),
    claimStageLease: async (actor, body) => ({ actor, body, status: 'idle' }),
    renewStageLease: async (actor, leaseId, body) => ({ actor, leaseId, body }),
    completeStageLease: async (actor, leaseId, body) => ({ actor, leaseId, body }),
    failStageLease: async (actor, leaseId, body) => ({ actor, leaseId, body }),
    revokeNode: async (actor, nodeId, reason) => ({ actor, nodeId, reason, status: 'revoked' }),
  };
  const app = Fastify({ logger: false });
  registerAgentExecutionNodeAccessRoutes(app, { service,
    requireAuth: async request => { request.actor = { userId: '22222222-2222-4222-8222-222222222222' }; } });

  const pairing = await app.inject({ method: 'POST', url: '/v1/admin/capability-execution/pairings',
    payload: { deviceLabel: 'My PC', kind: 'desktop', platform: 'windows-x64',
      permissions: { files: 'user-selected', networkDomains: [], devices: [] } } });
  assert.equal(pairing.statusCode, 201);
  assert.equal(pairing.headers['cache-control'], 'no-store');
  const unauthenticated = await app.inject({ method: 'POST',
    url: '/v1/capability-execution/node/heartbeat', payload: { resources: {
      cpuCores: 4, memoryMiB: 8192, diskMiB: 10000, gpuMemoryMiB: 0 }, metadata: {} } });
  assert.equal(unauthenticated.statusCode, 401);
  const heartbeat = await app.inject({ method: 'POST',
    url: '/v1/capability-execution/node/heartbeat', headers: { authorization: 'Bearer node-token' },
    payload: { resources: { cpuCores: 4, memoryMiB: 8192, diskMiB: 10000, gpuMemoryMiB: 0 },
      metadata: { userPresent: true } } });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal(heartbeat.headers['cache-control'], 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor.principalType, 'execution-node');
  const claimLease = await app.inject({ method: 'POST',
    url: '/v1/capability-execution/node/stage-leases/claim',
    headers: { authorization: 'Bearer node-token' }, payload: { leaseSeconds: 120 } });
  assert.equal(claimLease.statusCode, 200);
  assert.equal(claimLease.json().data.status, 'idle');
  await app.close();
});
