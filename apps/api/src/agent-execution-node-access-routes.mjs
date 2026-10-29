const uuid = { type: 'string', format: 'uuid' };
const resources = { type: 'object', additionalProperties: false,
  required: ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'], properties: {
    cpuCores: { type: 'integer', minimum: 0 }, memoryMiB: { type: 'integer', minimum: 0 },
    diskMiB: { type: 'integer', minimum: 0 }, gpuMemoryMiB: { type: 'integer', minimum: 0 },
  } };
const permissions = { type: 'object', additionalProperties: false,
  required: ['files', 'networkDomains', 'devices'], properties: {
    files: { enum: ['none', 'user-selected', 'workspace'] },
    networkDomains: { type: 'array', maxItems: 64, uniqueItems: true,
      items: { type: 'string', maxLength: 253 } },
    devices: { type: 'array', maxItems: 3, uniqueItems: true,
      items: { enum: ['camera', 'microphone', 'gpu'] } },
  } };
const pairing = { type: 'object', additionalProperties: false,
  required: ['deviceLabel', 'kind', 'platform', 'permissions'], properties: {
    deviceLabel: { type: 'string', minLength: 1, maxLength: 120 },
    kind: { enum: ['desktop', 'browser'] },
    platform: { enum: ['web', 'windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64',
      'linux-x64', 'linux-arm64'] }, permissions, ttlSeconds: { type: 'integer', minimum: 60, maximum: 600 },
  } };
const claim = { type: 'object', additionalProperties: false,
  required: ['pairingId', 'pairingCode', 'deviceKeySha256', 'runtimeVersion', 'resources', 'metadata'],
  properties: { pairingId: uuid, pairingCode: { type: 'string', minLength: 40, maxLength: 64,
    pattern: '^[A-Za-z0-9_-]+$' }, deviceKeySha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    runtimeVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$' },
    resources, metadata: { type: 'object', additionalProperties: true },
  } };
const heartbeat = { type: 'object', additionalProperties: false,
  required: ['resources', 'metadata'], properties: { resources,
    metadata: { type: 'object', additionalProperties: true } } };
const packageEvent = { type: 'object', additionalProperties: false,
  required: ['capabilityId', 'capabilityVersion', 'packageSha256', 'eventType', 'payload'], properties: {
    capabilityId: { type: 'string', pattern: '^[a-z0-9]+(?:[.:-][a-z0-9]+)*$', maxLength: 160 },
    capabilityVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$' },
    packageSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    eventType: { enum: ['download-started', 'download-completed', 'signature-verified',
      'install-ready', 'install-failed', 'removed'] },
    payload: { type: 'object', additionalProperties: true },
  } };
const leaseParams = { type: 'object', additionalProperties: false, required: ['executionLeaseId'],
  properties: { executionLeaseId: uuid } };
const leaseClaim = { type: 'object', additionalProperties: false, properties: {
  leaseSeconds: { type: 'integer', minimum: 15, maximum: 600 },
} };
const leaseRenewal = { type: 'object', additionalProperties: false,
  required: ['leaseToken', 'leaseSeconds'], properties: {
    leaseToken: uuid, leaseSeconds: { type: 'integer', minimum: 15, maximum: 600 },
  } };
const resultRef = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'artifactId', 'storage', 'sha256', 'sizeBytes', 'mediaType',
    'contract', 'metadata'], properties: {
    schemaVersion: { const: 'capability-output-ref-v1' }, artifactId: uuid,
    storage: { const: 'node-local' }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    sizeBytes: { type: 'integer', minimum: 0, maximum: 53687091200 },
    mediaType: { type: 'string', minLength: 3, maxLength: 160 },
    contract: { type: 'object', additionalProperties: false, required: ['key', 'version'],
      properties: { key: { type: 'string', pattern: '^[a-z][a-z0-9.-]{2,119}$' },
        version: { type: 'integer', minimum: 1 } } },
    metadata: { type: 'object', additionalProperties: true },
  } };
const leaseCompletion = { type: 'object', additionalProperties: false,
  required: ['leaseToken', 'submissionId', 'result'], properties: {
    leaseToken: uuid, submissionId: uuid, result: resultRef,
  } };
const leaseFailure = { type: 'object', additionalProperties: false,
  required: ['leaseToken', 'errorCode', 'errorMessage', 'retryable', 'outcome'], properties: {
    leaseToken: uuid, errorCode: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{2,119}$' },
    errorMessage: { type: 'string', minLength: 1, maxLength: 500 },
    retryable: { type: 'boolean' }, outcome: { enum: ['safe-failure', 'uncertain'] },
  } };

export function registerAgentExecutionNodeAccessRoutes(app, { service, requireAuth }) {
  const envelope = data => ({ data });
  const noStore = reply => reply.header('Cache-Control', 'no-store');
  const requireNodeAuth = async request => {
    request.executionNode = await service.authenticateNodeBearer(request.headers.authorization);
  };

  app.get('/v1/admin/capability-execution/access', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply); return envelope(await service.snapshot(request.actor));
  });
  app.post('/v1/admin/capability-execution/pairings', { preHandler: requireAuth,
    schema: { body: pairing } }, async (request, reply) => {
    noStore(reply).status(201); return envelope(await service.createPairing(request.actor, request.body));
  });
  app.post('/v1/admin/capability-execution/nodes/:nodeId/revoke', { preHandler: requireAuth,
    schema: { params: { type: 'object', additionalProperties: false, required: ['nodeId'],
      properties: { nodeId: uuid } }, body: { type: 'object', additionalProperties: false,
      required: ['reason'], properties: { reason: { type: 'string', minLength: 10, maxLength: 500 } } } } },
  async (request, reply) => {
    noStore(reply); return envelope(await service.revokeNode(request.actor,
      request.params.nodeId, request.body.reason));
  });

  app.post('/v1/capability-execution/pair', { schema: { body: claim } }, async (request, reply) => {
    noStore(reply).status(201); return envelope(await service.claimPairing(request.body));
  });
  app.post('/v1/capability-execution/session/refresh', { schema: { body: { type: 'object',
    additionalProperties: false, required: ['renewalToken'], properties: {
      renewalToken: { type: 'string', minLength: 32, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
    } } } }, async (request, reply) => {
    noStore(reply); return envelope(await service.refreshSession(request.body));
  });
  app.get('/v1/capability-execution/node', { preHandler: requireNodeAuth }, async (request, reply) => {
    noStore(reply); return envelope(await service.nodeSnapshot(request.executionNode));
  });
  app.post('/v1/capability-execution/node/heartbeat', { preHandler: requireNodeAuth,
    schema: { body: heartbeat } }, async (request, reply) => {
    noStore(reply); return envelope(await service.heartbeat(request.executionNode, request.body));
  });
  app.post('/v1/capability-execution/node/package-events', { preHandler: requireNodeAuth,
    schema: { body: packageEvent } }, async (request, reply) => {
    noStore(reply).status(201);
    return envelope(await service.reportPackageEvent(request.executionNode, request.body));
  });
  app.post('/v1/capability-execution/node/stage-leases/claim', { preHandler: requireNodeAuth,
    schema: { body: leaseClaim } }, async (request, reply) => {
    noStore(reply); return envelope(await service.claimStageLease(request.executionNode, request.body));
  });
  app.post('/v1/capability-execution/node/stage-leases/:executionLeaseId/renew', {
    preHandler: requireNodeAuth, schema: { params: leaseParams, body: leaseRenewal },
  }, async (request, reply) => {
    noStore(reply); return envelope(await service.renewStageLease(request.executionNode,
      request.params.executionLeaseId, request.body));
  });
  app.post('/v1/capability-execution/node/stage-leases/:executionLeaseId/complete', {
    preHandler: requireNodeAuth, schema: { params: leaseParams, body: leaseCompletion },
  }, async (request, reply) => {
    noStore(reply); return envelope(await service.completeStageLease(request.executionNode,
      request.params.executionLeaseId, request.body));
  });
  app.post('/v1/capability-execution/node/stage-leases/:executionLeaseId/fail', {
    preHandler: requireNodeAuth, schema: { params: leaseParams, body: leaseFailure },
  }, async (request, reply) => {
    noStore(reply); return envelope(await service.failStageLease(request.executionNode,
      request.params.executionLeaseId, request.body));
  });
}
