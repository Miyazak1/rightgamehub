import { createRedisRealtimeTicketStore } from './redis-ticket-store.mjs';
import { loadRealtimeConfig } from './config.mjs';
import { createRealtimeServer } from './realtime-server.mjs';
import { createRealtimeDatabase } from './database.mjs';
import { PostgresRealtimeRoomRepository } from './room-repository.mjs';
import { createRedisRoomCoordinator } from './redis-room-coordinator.mjs';
import { createRoomSessionManager } from './room-session-manager.mjs';

const config = loadRealtimeConfig();
const ticketStore = createRedisRealtimeTicketStore({ url: config.redisUrl });
const database = createRealtimeDatabase(config);
const roomCoordinator = createRedisRoomCoordinator({ url: config.redisUrl });
const roomSessionManager = createRoomSessionManager({
  repository: new PostgresRealtimeRoomRepository(database.pool), coordinator: roomCoordinator,
  heartbeatIntervalMs: config.heartbeatIntervalMs, reconnectGraceMs: config.reconnectGraceMs,
});
const realtime = createRealtimeServer({ ticketStore, roomSessionManager, ...config });
await realtime.listen({ host: config.host, port: config.port });
process.stdout.write(`GameHub realtime listening on ${config.host}:${config.port}\n`);

const shutdown = async signal => {
  process.stderr.write(`GameHub realtime received ${signal}; shutting down.\n`);
  await realtime.close();
  await roomCoordinator.close();
  await ticketStore.close();
  await database.close();
  process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
