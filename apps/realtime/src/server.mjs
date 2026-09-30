import { createRedisRealtimeTicketStore } from './redis-ticket-store.mjs';
import { loadRealtimeConfig } from './config.mjs';
import { createRealtimeServer } from './realtime-server.mjs';
import { createRealtimeDatabase } from './database.mjs';
import { PostgresRealtimeRoomRepository } from './room-repository.mjs';
import { createRedisRoomCoordinator } from './redis-room-coordinator.mjs';
import { createRoomSessionManager } from './room-session-manager.mjs';
import { PostgresRealtimeMatchRepository } from './match-repository.mjs';
import { createMatchSessionManager } from './match-session-manager.mjs';
import { loadRulesRegistry } from '@gamehub/rules-sdk';
import { createMatchTimeoutWorker } from './match-timeout-worker.mjs';

const config = loadRealtimeConfig();
const ticketStore = createRedisRealtimeTicketStore({ url: config.redisUrl });
const database = createRealtimeDatabase(config);
const roomCoordinator = createRedisRoomCoordinator({ url: config.redisUrl });
const matchCoordinator = createRedisRoomCoordinator({ url: config.redisUrl, channelKind: 'match' });
const roomSessionManager = createRoomSessionManager({
  repository: new PostgresRealtimeRoomRepository(database.pool), coordinator: roomCoordinator,
  heartbeatIntervalMs: config.heartbeatIntervalMs, reconnectGraceMs: config.reconnectGraceMs,
});
const rulesRegistry = loadRulesRegistry({ manifestPath: config.rulesManifestPath,trustedKeys: config.rulesTrustedKeys,allowUnsigned: config.rulesAllowUnsigned });
const matchRepository = new PostgresRealtimeMatchRepository(database.pool);
const matchSessionManager = createMatchSessionManager({ repository: matchRepository,coordinator: matchCoordinator,rulesRegistry });
const matchTimeoutWorker = createMatchTimeoutWorker({
  repository: matchRepository,coordinator: matchCoordinator,rulesRegistry,
  intervalMs: config.matchTimeoutSweepMs,batchSize: config.matchTimeoutBatchSize,
});
const realtime = createRealtimeServer({ ticketStore, roomSessionManager, matchSessionManager, matchTimeoutWorker, ...config });
await realtime.listen({ host: config.host, port: config.port });
process.stdout.write(`GameHub realtime listening on ${config.host}:${config.port}\n`);
process.stdout.write(`GameHub realtime loaded ${rulesRegistry.list().length} trusted rules adapter(s).\n`);

const shutdown = async signal => {
  process.stderr.write(`GameHub realtime received ${signal}; shutting down.\n`);
  await realtime.close();
  await roomCoordinator.close();
  await matchCoordinator.close();
  await ticketStore.close();
  await database.close();
  process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
