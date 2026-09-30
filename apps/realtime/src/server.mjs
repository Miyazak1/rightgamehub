import { createRedisRealtimeTicketStore } from './redis-ticket-store.mjs';
import { loadRealtimeConfig } from './config.mjs';
import { createRealtimeServer } from './realtime-server.mjs';

const config = loadRealtimeConfig();
const ticketStore = createRedisRealtimeTicketStore({ url: config.redisUrl });
const realtime = createRealtimeServer({ ticketStore, ...config });
await realtime.listen({ host: config.host, port: config.port });
process.stdout.write(`GameHub realtime listening on ${config.host}:${config.port}\n`);

const shutdown = async signal => {
  process.stderr.write(`GameHub realtime received ${signal}; shutting down.\n`);
  await realtime.close();
  await ticketStore.close();
  process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
