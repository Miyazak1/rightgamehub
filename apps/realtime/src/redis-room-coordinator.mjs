import { createClient } from 'redis';

const registerScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return redis.call('ZCARD', KEYS[1])`;
const removeScript = `
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then redis.call('DEL', KEYS[1]) end
return count`;
const countScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then redis.call('DEL', KEYS[1]) end
return count`;

export function createRedisRoomCoordinator({ url, namespace = 'gamehub:realtime', channelKind = 'room', logger = console } = {}) {
  if (!url) throw new TypeError('Redis URL is required.');
  const command = createClient({ url });
  const subscriber = command.duplicate();
  for (const client of [command,subscriber]) client.on('error', error => logger?.error?.({ error }, 'Realtime room Redis error'));
  let commandConnection;
  let subscriberConnection;
  let subscribed = false;
  const listeners = new Set();
  const connectCommand = async () => {
    if (command.isReady) return command;
    commandConnection ??= command.connect().catch(error => { commandConnection = null; throw error; });
    await commandConnection;
    return command;
  };
  const connectSubscriber = async () => {
    if (!subscriber.isReady) {
      subscriberConnection ??= subscriber.connect().catch(error => { subscriberConnection = null; throw error; });
      await subscriberConnection;
    }
    if (!subscribed) {
      await subscriber.pSubscribe(`${namespace}:${channelKind}:*`, (message, channel) => {
        let event;
        try { event = JSON.parse(message); } catch { return; }
        const roomId = channel.slice(channel.lastIndexOf(':') + 1);
        for (const listener of listeners) listener(roomId, event);
      });
      subscribed = true;
    }
    return subscriber;
  };
  const presenceKey = (roomId,userId) => `${namespace}:presence:${channelKind}:${roomId}:${userId}`;
  return Object.freeze({
    async start(listener) { listeners.add(listener); await connectSubscriber(); return () => listeners.delete(listener); },
    async publish(roomId, event) { return (await connectCommand()).publish(`${namespace}:${channelKind}:${roomId}`, JSON.stringify(event)); },
    async registerPresence({ roomId, userId, connectionId, ttlMs, now = Date.now() }) {
      return Number(await (await connectCommand()).eval(registerScript, { keys: [presenceKey(roomId,userId)], arguments: [String(now),String(now + ttlMs),connectionId,String(ttlMs * 2)] }));
    },
    async removePresence({ roomId, userId, connectionId, now = Date.now() }) {
      return Number(await (await connectCommand()).eval(removeScript, { keys: [presenceKey(roomId,userId)], arguments: [String(now),connectionId] }));
    },
    async countPresence({ roomId, userId, now = Date.now() }) {
      return Number(await (await connectCommand()).eval(countScript, { keys: [presenceKey(roomId,userId)], arguments: [String(now)] }));
    },
    async ping() { return (await (await connectCommand()).ping()) === 'PONG'; },
    async close() {
      listeners.clear();
      if (subscriber.isOpen) await subscriber.quit();
      if (command.isOpen) await command.quit();
    },
  });
}
