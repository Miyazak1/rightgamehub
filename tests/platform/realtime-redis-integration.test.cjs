const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const source = relative => pathToFileURL(path.join(root, relative));
const redisUrl = process.env.GAMEHUB_TEST_REDIS_URL;

test('API-issued Redis ticket opens exactly one realtime session', { skip: !redisUrl }, async t => {
  const [{ createRedisRealtimeTicketStore: createIssuerStore }, { createRealtimeTicketService }, { createRedisRealtimeTicketStore: createConsumerStore }, { createRealtimeServer }, { WebSocket }] = await Promise.all([
    import(source('apps/api/src/redis-realtime-ticket-store.mjs')),
    import(source('apps/api/src/realtime-ticket-service.mjs')),
    import(source('apps/realtime/src/redis-ticket-store.mjs')),
    import(source('apps/realtime/src/realtime-server.mjs')),
    import(source('apps/realtime/node_modules/ws/wrapper.mjs')),
  ]);
  const namespace = `gamehub:test:${crypto.randomUUID()}`;
  const issuerStore = createIssuerStore({ url: redisUrl, namespace, logger: { error() {} } });
  const consumerStore = createConsumerStore({ url: redisUrl, namespace, logger: { error() {} } });
  const realtime = createRealtimeServer({ ticketStore: consumerStore, logger: { error() {}, warn() {} } });
  t.after(async () => { await realtime.close(); await issuerStore.close(); await consumerStore.close(); });
  const address = await realtime.listen({ host: '127.0.0.1', port: 0 });
  const tickets = createRealtimeTicketService({ store: issuerStore, websocketUrl: `ws://127.0.0.1:${address.port}/v1/realtime` });
  const issued = await tickets.issue({ userId: crypto.randomUUID(), scopes: [] });

  const first = new WebSocket(`${issued.websocketUrl}?ticket=${encodeURIComponent(issued.ticket)}`);
  t.after(() => first.close());
  const ready = await new Promise((resolve, reject) => { first.once('message', value => resolve(JSON.parse(value.toString()))); first.once('error', reject); });
  assert.equal(ready.type, 'session.ready');

  const secondStatus = await new Promise(resolve => {
    const second = new WebSocket(`${issued.websocketUrl}?ticket=${encodeURIComponent(issued.ticket)}`);
    second.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    second.once('open', () => { second.close(); resolve(101); });
    second.once('error', () => {});
  });
  assert.equal(secondStatus, 401);
});
