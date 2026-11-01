import { createClient } from 'redis';

export const DESKTOP_AUTH_READINESS_TIMEOUT_MS = 2000;

// Dedicated to the isolated account instance. No reconnect loop/offline queue,
// no persistent Redis socket, and at most one set of outstanding probes.
export function createDesktopAuthReadiness({ database, migrations, redisUrl,
  timeoutMs = DESKTOP_AUTH_READINESS_TIMEOUT_MS, clientFactory = createClient }) {
  let active = null, closed = false;
  const unavailable = () => ({ status: 'not-ready', database: false, redis: false });
  const disconnect = client => {
    if (!client?.isOpen) return;
    try { Promise.resolve(client.disconnect()).catch(() => {}); } catch {}
  };
  return {
    check() {
      if (closed) return Promise.resolve(unavailable());
      if (active) return active.response;
      const probe = { client: null, cancel: null, response: null };
      active = probe;
      let timer;
      const deadline = new Promise(resolve => {
        probe.cancel = () => { clearTimeout(timer); disconnect(probe.client); resolve(unavailable()); };
        timer = setTimeout(probe.cancel, timeoutMs);
      });
      const work = Promise.resolve().then(async () => {
        if (closed) return unavailable();
        probe.client = clientFactory({ url: redisUrl, disableOfflineQueue: true,
          socket: { connectTimeout: timeoutMs, reconnectStrategy: false } });
        probe.client.on('error', () => {});
        const results = await Promise.allSettled([
          Promise.resolve().then(() => database.ping()),
          Promise.resolve().then(() => migrations.status()),
          Promise.resolve().then(async () => {
            if (closed) return false;
            await probe.client.connect();
            return !closed && await probe.client.ping() === 'PONG';
          }),
        ]);
        const value = i => results[i].status === 'fulfilled' ? results[i].value : null;
        const db = value(0) === true, migration = value(1), redis = value(2) === true;
        return { status: db && migration?.ready && redis ? 'ready' : 'not-ready',
          database: db, migrations: migration ?? { ready: false }, redis };
      }).catch(unavailable).finally(() => {
        clearTimeout(timer); disconnect(probe.client);
        // Retain the active probe until underlying database work settles even
        // when the HTTP deadline has elapsed, preventing probe accumulation.
        if (active === probe) active = null;
      });
      probe.response = Promise.race([work, deadline]);
      return probe.response;
    },
    close() { closed = true; active?.cancel(); },
  };
}
