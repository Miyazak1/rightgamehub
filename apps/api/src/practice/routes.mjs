import { practiceParams as params, practiceCatalogQuery, practiceStartSchema as config, practiceUpdateSchema } from '../../../../packages/contracts/src/practice-schema.mjs';
export function registerPracticeRoutes(app, { service, requireAuth }) {
  const run = fn => async (request, reply) => { reply.header('Cache-Control', 'no-store'); return { data: await fn(request) }; };
  app.get('/v1/learning/practice/catalog', { schema: { querystring: practiceCatalogQuery } }, run(r => service.catalog(r.query)));
  app.get('/v1/me/practice', { preHandler: requireAuth }, run(r => service.history(r.actor)));
  app.get('/v1/me/learning/insights', { preHandler: requireAuth }, run(r => service.insights(r.actor,r.query)));
  app.post('/v1/me/practice', { preHandler: requireAuth, schema: { body: config } }, run(r => service.start(r.actor, r.body, r.headers['idempotency-key'])));
  app.get('/v1/me/practice/:id', { preHandler: requireAuth, schema: { params } }, run(r => service.get(r.actor, r.params.id)));
  app.patch('/v1/me/practice/:id', { preHandler: requireAuth, schema: { params,
    body: practiceUpdateSchema } }, run(r => service.update(r.actor, r.params.id, r.body)));
  app.post('/v1/me/practice/:id/continue', { preHandler: requireAuth, schema: { params } }, run(r => service.continue(r.actor, r.params.id, r.headers['idempotency-key'])));
  app.post('/v1/me/practice/:id/retry', { preHandler: requireAuth, schema: { params } }, run(r => service.retry(r.actor, r.params.id)));
}
