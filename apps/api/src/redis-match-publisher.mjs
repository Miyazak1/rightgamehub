import { createClient } from 'redis';

export function createRedisMatchPublisher({ url, namespace = 'gamehub:realtime', channelKind = 'match', logger = console } = {}) {
  if (!url) throw new TypeError('Redis URL is required.');
  const client = createClient({ url });
  client.on('error', error => logger?.error?.({ error }, 'Multiplayer Redis publish error'));
  let connection;
  const connect = async () => {
    if (client.isReady) return client;
    connection ??= client.connect().catch(error => { connection = null; throw error; });
    await connection; return client;
  };
  return Object.freeze({
    async publish(targetId, signal) {
      try { await (await connect()).publish(`${namespace}:${channelKind}:${targetId}`, JSON.stringify(signal)); return true; }
      catch (error) { logger?.error?.({ error,targetId,channelKind }, 'Multiplayer Redis publish failed after commit'); return false; }
    },
    async close() { if (client.isOpen) await client.quit(); },
  });
}
