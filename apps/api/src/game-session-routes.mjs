import { schemas } from '@gamehub/contracts';

export function registerGameSessionRoutes(app, { service, requireAuth }) {
  const sessionHeaders = { type: 'object', required: ['x-gamehub-session'], properties: {
    'x-gamehub-session': { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  } };
  app.post('/v1/game-sessions', { preHandler: requireAuth, schema: { body: schemas.CreateGameSessionRequest } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return reply.code(201).send({ data: await service.create(request.actor, request.body) });
  });
  app.get('/v1/game-sessions/current', { preHandler: requireAuth, schema: { headers: sessionHeaders } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const context = await service.resolve(request.actor, request.headers['x-gamehub-session']);
    return { data: { active: true, expiresAt: context.expiresAt, capabilities: context.capabilities } };
  });
  app.delete('/v1/game-sessions/current', { preHandler: requireAuth, schema: { headers: sessionHeaders } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { data: await service.revoke(request.actor, request.headers['x-gamehub-session']) };
  });
}
