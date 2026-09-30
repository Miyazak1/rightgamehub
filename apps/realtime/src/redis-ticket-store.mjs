import { createClient } from 'redis';

export function createRedisRealtimeTicketStore({ url, namespace = 'gamehub:realtime-ticket', logger = console } = {}) {
  if (!url) throw new TypeError('Redis URL is required.');
  const client = createClient({ url });
  client.on('error', error => logger?.error?.({ error }, 'Realtime ticket Redis error'));
  let connection;
  const connect = async () => {
    if (client.isReady) return client;
    connection ??= client.connect().catch(error => { connection = null; throw error; });
    await connection;
    return client;
  };
  const key = hash => `${namespace}:${hash}`;
  return Object.freeze({
    async consume(hash) {
      const redis = await connect();
      const value = await redis.sendCommand(['GETDEL', key(hash)]);
      return value ? JSON.parse(value) : null;
    },
    async ping() { return (await (await connect()).ping()) === 'PONG'; },
    async close() { if (client.isOpen) await client.quit(); },
  });
}
