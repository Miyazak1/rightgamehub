const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const redisUrl = process.env.GAMEHUB_TEST_REDIS_URL;

test('Redis room coordinator broadcasts across instances and counts live connections', { skip: !redisUrl }, async t => {
  const { createRedisRoomCoordinator } = await import(pathToFileURL(path.join(root, 'apps/realtime/src/redis-room-coordinator.mjs')));
  const namespace = `gamehub:test-room:${crypto.randomUUID()}`;
  const first = createRedisRoomCoordinator({ url: redisUrl, namespace, logger: { error() {} } });
  const second = createRedisRoomCoordinator({ url: redisUrl, namespace, logger: { error() {} } });
  t.after(async () => { await Promise.all([first.close(),second.close()]); });
  const roomId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let receive;
  const received = new Promise(resolve => { receive = resolve; });
  await first.start((id, event) => receive({ id, event }));
  await second.publish(roomId, { type: 'room.member.changed', payload: { revision: '1' } });
  assert.deepEqual(await received, { id: roomId, event: { type: 'room.member.changed', payload: { revision: '1' } } });
  assert.equal(await first.registerPresence({ roomId,userId,connectionId: 'a',ttlMs: 5_000 }), 1);
  assert.equal(await second.registerPresence({ roomId,userId,connectionId: 'b',ttlMs: 5_000 }), 2);
  assert.equal(await first.removePresence({ roomId,userId,connectionId: 'a' }), 1);
  assert.equal(await second.removePresence({ roomId,userId,connectionId: 'b' }), 0);
  assert.equal(await first.countPresence({ roomId,userId }), 0);
});
