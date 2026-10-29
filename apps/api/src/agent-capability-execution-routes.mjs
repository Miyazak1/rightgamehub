const uuid = { type: 'string', format: 'uuid' };
const capabilityIdentity = { type: 'object', additionalProperties: false,
  required: ['capabilityId', 'capabilityVersion'], properties: {
    capabilityId: { type: 'string', pattern: '^[a-z0-9]+(?:[.:-][a-z0-9]+)*$', maxLength: 160 },
    capabilityVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$', maxLength: 64 },
  } };
const nodeParams = { type: 'object', additionalProperties: false, required: ['nodeId'],
  properties: { nodeId: uuid } };
const resourceSchema = { type: 'object', additionalProperties: false,
  required: ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'], properties: {
    cpuCores: { type: 'integer', minimum: 0 }, memoryMiB: { type: 'integer', minimum: 0 },
    diskMiB: { type: 'integer', minimum: 0 }, gpuMemoryMiB: { type: 'integer', minimum: 0 },
  } };
const nodeSchema = { type: 'object', additionalProperties: false,
  required: ['kind', 'platform', 'deviceKeySha256', 'runtimeVersion', 'resources', 'permissions', 'metadata'],
  properties: { id: uuid, kind: { enum: ['browser', 'desktop', 'cloud'] },
    platform: { enum: ['web', 'windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64',
      'linux-x64', 'linux-arm64', 'server-linux-x64', 'server-linux-arm64'] },
    deviceKeySha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    runtimeVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$' },
    resources: resourceSchema, permissions: { type: 'object', additionalProperties: false,
      required: ['files', 'networkDomains', 'devices'], properties: {
        files: { enum: ['none', 'user-selected', 'workspace'] },
        networkDomains: { type: 'array', maxItems: 64, uniqueItems: true, items: { type: 'string', maxLength: 253 } },
        devices: { type: 'array', maxItems: 3, uniqueItems: true, items: { enum: ['camera', 'microphone', 'gpu'] } },
      } }, metadata: { type: 'object', additionalProperties: true },
  } };
const heartbeatSchema = { type: 'object', additionalProperties: false,
  required: ['resources', 'metadata'], properties: { resources: resourceSchema,
    metadata: { type: 'object', additionalProperties: true } } };
const packageEventSchema = { type: 'object', additionalProperties: false,
  required: ['capabilityId', 'capabilityVersion', 'packageSha256', 'eventType', 'payload'], properties: {
    ...capabilityIdentity.properties, packageSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    eventType: { enum: ['download-started', 'download-completed', 'signature-verified',
      'install-ready', 'install-failed', 'removed'] }, payload: { type: 'object', additionalProperties: true },
  } };
const placementSchema = { type: 'object', additionalProperties: false,
  required: ['stageId', 'capabilityId', 'capabilityVersion', 'cloudConsent', 'userPresent'], properties: {
    stageId: uuid, ...capabilityIdentity.properties, cloudConsent: { type: 'boolean' },
    userPresent: { type: 'boolean' },
  } };

export function registerAgentCapabilityExecutionRoutes(app, { service, requireAuth }) {
  const envelope = data => ({ data });
  const noStore = reply => reply.header('Cache-Control', 'no-store');
  app.get('/v1/admin/capability-execution', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply); return envelope(await service.snapshot(request.actor));
  });
  app.post('/v1/admin/capability-execution/manifests', { preHandler: requireAuth,
    schema: { body: { type: 'object', additionalProperties: true } } }, async (request, reply) => {
    const result = await service.registerManifest(request.actor, request.body);
    noStore(reply).status(result.existing ? 200 : 201); return envelope(result);
  });
  app.post('/v1/admin/capability-execution/manifests/:capabilityId/:capabilityVersion/activate',
    { preHandler: requireAuth, schema: { params: capabilityIdentity } }, async (request, reply) => {
      noStore(reply); return envelope(await service.activateManifest(request.actor,
        request.params.capabilityId, request.params.capabilityVersion));
    });
  app.post('/v1/admin/capability-execution/nodes', { preHandler: requireAuth,
    schema: { body: nodeSchema } }, async (request, reply) => {
    const result = await service.registerNode(request.actor, request.body);
    noStore(reply).status(201); return envelope(result);
  });
  app.post('/v1/admin/capability-execution/nodes/:nodeId/heartbeat', { preHandler: requireAuth,
    schema: { params: nodeParams, body: heartbeatSchema } }, async (request, reply) => {
    noStore(reply); return envelope(await service.heartbeatNode(request.actor, request.params.nodeId, request.body));
  });
  app.post('/v1/admin/capability-execution/nodes/:nodeId/package-events', { preHandler: requireAuth,
    schema: { params: nodeParams, body: packageEventSchema } }, async (request, reply) => {
    const result = await service.reportPackageEvent(request.actor, request.params.nodeId, request.body);
    noStore(reply).status(201); return envelope(result);
  });
  app.post('/v1/admin/capability-execution/placements', { preHandler: requireAuth,
    schema: { body: placementSchema } }, async (request, reply) => {
    const result = await service.selectPlacement(request.actor, request.body);
    noStore(reply).status(result.existing ? 200 : 201); return envelope(result);
  });
}
