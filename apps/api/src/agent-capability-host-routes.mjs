const uuid = { type: 'string', format: 'uuid' };
const profile = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'host', 'hostVersion', 'surface', 'connection', 'features'],
  properties: {
    schemaVersion: { const: 'capability-host-profile-v1' },
    host: { enum: ['codex', 'mcp-app', 'harness', 'cursor', 'vscode', 'desktop-app'] },
    hostVersion: { type: 'string', minLength: 1, maxLength: 80 },
    surface: { enum: ['mcp-app', 'sidebar', 'desktop-window'] },
    connection: { enum: ['control-plane', 'local-pipe'] },
    features: { type: 'object', additionalProperties: false,
      required: ['submit', 'cancel', 'resume', 'artifacts', 'fileConsent', 'background'],
      properties: Object.fromEntries(['submit', 'cancel', 'resume', 'artifacts', 'fileConsent', 'background']
        .map(key => [key, { type: 'boolean' }])) },
  } };
const params = { type: 'object', additionalProperties: false, required: ['agentUserId'],
  properties: { agentUserId: uuid } };
const runParams = { type: 'object', additionalProperties: false, required: ['agentUserId', 'runId'],
  properties: { agentUserId: uuid, runId: uuid } };
const artifactParams = { type: 'object', additionalProperties: false,
  required: ['agentUserId', 'artifactId'], properties: { agentUserId: uuid, artifactId: uuid } };
const profileBody = { type: 'object', additionalProperties: false, required: ['profile'],
  properties: { profile } };
const submission = { type: 'object', additionalProperties: false,
  required: ['capabilityId', 'capabilityVersion', 'contractKey', 'input', 'idempotencyKey'],
  properties: {
    capabilityId: { type: 'string', pattern: '^[a-z0-9]+(?:[.:-][a-z0-9]+)*$', maxLength: 160 },
    capabilityVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$', maxLength: 64 },
    contractKey: { type: 'string', minLength: 1, maxLength: 160 },
    input: { type: 'object', additionalProperties: true },
    idempotencyKey: { type: 'string', minLength: 16, maxLength: 160 },
  } };
const binding = { type: 'object', additionalProperties: false,
  required: ['capabilityId', 'capabilityVersion', 'workflowKey', 'workflowVersion', 'features'],
  properties: {
    capabilityId: submission.properties.capabilityId,
    capabilityVersion: submission.properties.capabilityVersion,
    workflowKey: { type: 'string', pattern: '^[a-z][a-z0-9.-]{2,119}$' },
    workflowVersion: { type: 'integer', minimum: 1 },
    features: { type: 'object', additionalProperties: false,
      required: ['cancel', 'resume', 'artifacts', 'openMode'], properties: {
        cancel: { type: 'boolean' }, resume: { type: 'boolean' }, artifacts: { type: 'boolean' },
        openMode: { enum: ['host-preview', 'external-app', 'download'] },
      } },
  } };

export function registerAgentCapabilityHostRoutes(app, { service, requireAuth }) {
  const envelope = data => ({ data });
  const noStore = reply => reply.header('Cache-Control', 'private, no-store');
  app.post('/v1/admin/capability-execution/host-bindings', { preHandler: requireAuth,
    schema: { body: binding } }, async (request, reply) => {
    const value = await service.registerBinding(request.actor, request.body);
    noStore(reply).status(value.existing ? 200 : 201); return envelope(value);
  });
  app.post('/v1/me/agents/:agentUserId/capability-host', { preHandler: requireAuth,
    schema: { params, body: profileBody } }, async (request, reply) => {
    noStore(reply); return envelope(await service.snapshot(request.actor,
      request.params.agentUserId, request.body.profile));
  });
  app.post('/v1/me/agents/:agentUserId/capability-host/runs', { preHandler: requireAuth,
    schema: { params, body: { type: 'object', additionalProperties: false,
      required: ['profile', 'input'], properties: { profile, input: submission } } } },
  async (request, reply) => {
    const value = await service.submit(request.actor, request.params.agentUserId,
      request.body.profile, request.body.input);
    noStore(reply).status(202); return envelope(value);
  });
  app.post('/v1/me/agents/:agentUserId/capability-host/runs/:runId', { preHandler: requireAuth,
    schema: { params: runParams, body: profileBody } }, async (request, reply) => {
    noStore(reply); return envelope(await service.get(request.actor, request.params.agentUserId,
      request.params.runId, request.body.profile));
  });
  app.post('/v1/me/agents/:agentUserId/capability-host/runs/:runId/cancel', { preHandler: requireAuth,
    schema: { params: runParams, body: profileBody } }, async (request, reply) => {
    noStore(reply); return envelope(await service.cancel(request.actor, request.params.agentUserId,
      request.params.runId, request.body.profile));
  });
  app.post('/v1/me/agents/:agentUserId/capability-host/runs/:runId/artifacts', {
    preHandler: requireAuth, schema: { params: runParams, body: profileBody } }, async (request, reply) => {
    noStore(reply); return envelope(await service.artifacts(request.actor, request.params.agentUserId,
      request.params.runId, request.body.profile));
  });
  app.post('/v1/me/agents/:agentUserId/capability-host/artifacts/:artifactId/open', {
    preHandler: requireAuth, schema: { params: artifactParams, body: profileBody } }, async (request, reply) => {
    noStore(reply); return envelope(await service.openDirective(request.actor,
      request.params.agentUserId, request.params.artifactId, request.body.profile));
  });
  app.post('/v1/me/agents/:agentUserId/capability-host/artifacts/:artifactId/content', {
    preHandler: requireAuth, schema: { params: artifactParams, body: profileBody } }, async (request, reply) => {
    noStore(reply); return envelope(await service.artifactContent(request.actor,
      request.params.agentUserId, request.params.artifactId, request.body.profile));
  });
}
