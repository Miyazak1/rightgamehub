import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';
import { applyMigrations, migrationStatus } from './migrations.mjs';
import { PostgresAuthRepository } from './auth-repository.mjs';
import { createAuthService } from './auth-service.mjs';
import { createGitHubOAuthClient } from './github-oauth-client.mjs';
import { createApp } from './app.mjs';
import { PostgresWorkRepository } from './work-repository.mjs';
import { createWorkService } from './work-service.mjs';
import { PostgresUploadRepository } from './upload-repository.mjs';
import { createUploadService } from './upload-service.mjs';
import { LocalQuarantineStore } from './local-object-store.mjs';
import { LocalRuntimeStore } from './local-runtime-store.mjs';
import { LocalAvatarStore } from './local-avatar-store.mjs';
import { LocalCoverStore } from './local-cover-store.mjs';
import { PostgresValidationRepository } from './validation-repository.mjs';
import { createValidationWorker } from './validation-worker.mjs';
import { PostgresCatalogRepository } from './catalog-repository.mjs';
import { createCatalogService } from './catalog-service.mjs';
import { PostgresRuntimeEdgeRepository } from './runtime-edge-repository.mjs';
import { createRuntimeEdgeApp } from './runtime-edge-app.mjs';
import { PostgresEngagementRepository } from './engagement-repository.mjs';
import { createEngagementService } from './engagement-service.mjs';
import { createGuessBaikeService } from './guess-baike-service.mjs';
import { PostgresGuessBaikeRepository } from './guess-baike-repository.mjs';
import { createGuessBaikeAutomation } from './guess-baike-automation.mjs';
import { PostgresModerationRepository, createModerationService } from './moderation-service.mjs';
import { PostgresSocialRepository } from './social-repository.mjs';
import { createSocialService } from './social-service.mjs';
import { createConfiguredMailer } from './mailer.mjs';
import { PostgresAnalyticsRepository } from './analytics-repository.mjs';
import { createAnalyticsService } from './analytics-service.mjs';
import { createRealtimeTicketService } from './realtime-ticket-service.mjs';
import { createRedisRealtimeTicketStore } from './redis-realtime-ticket-store.mjs';
import { PostgresMultiplayerRoomRepository } from './multiplayer-room-repository.mjs';
import { createMultiplayerRoomService } from './multiplayer-room-service.mjs';
import { PostgresMultiplayerMatchRepository } from './multiplayer-match-repository.mjs';
import { createMultiplayerMatchService } from './multiplayer-match-service.mjs';
import { createRulesRegistry, loadRulesRegistry } from '@gamehub/rules-sdk';
import { createRedisMatchPublisher } from './redis-match-publisher.mjs';
import { createWebValidationRunner } from './web-validation-runner.mjs';
import { createStorageCapacityService } from './storage-capacity-service.mjs';
import { createGitHubAppClient } from './github-app-client.mjs';
import { PostgresGitHubSourceRepository, createGitHubSourceService } from './github-source-service.mjs';

export const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export function createRuntime({ env = process.env, mailer, loadTrustedRules = true } = {}) {
  const config = loadConfig(env);
  const database = createDatabase(config);
  const migrations = {
    apply: () => applyMigrations(database.pool, migrationDirectory),
    status: () => migrationStatus(database.pool, migrationDirectory),
  };
  const avatarStore = new LocalAvatarStore(config.avatarRoot);
  const coverStore = new LocalCoverStore(config.coverRoot);
  const repository = new PostgresAuthRepository(database.pool, avatarStore);
  const safeMailer = mailer ?? createConfiguredMailer(config);
  const authService = createAuthService({
    repository,
    mailer: safeMailer,
    otpHmacKey: config.otpHmacKey,
    loginEmailAllowlist: config.loginEmailAllowlist,
    githubClient: createGitHubOAuthClient({ clientId: config.githubClientId, clientSecret: config.githubClientSecret, callbackUrl: config.githubCallbackUrl }),
  });
  const workService = createWorkService({ repository: new PostgresWorkRepository(database.pool, coverStore) });
  const githubSourceService = createGitHubSourceService({
    repository: new PostgresGitHubSourceRepository(database.pool),
    githubClient: createGitHubAppClient({ appId: config.githubAppId, privateKey: config.githubAppPrivateKey, slug: config.githubAppSlug }),
    enabled: config.githubSourceImportEnabled,
    webhookSecret: config.githubAppWebhookSecret,
  });
  const quarantineStore = new LocalQuarantineStore(config.quarantineRoot);
  const storageLogger = {
    info: event => process.stdout.write(`${JSON.stringify({ service: 'storage-capacity', ...event })}\n`),
    warn: event => process.stderr.write(`${JSON.stringify({ service: 'storage-capacity', ...event })}\n`),
  };
  const storageCapacityService = createStorageCapacityService({
    roots: {
      quarantine: config.quarantineRoot,
      validator: config.validatorRoot,
      runtime: config.runtimeRoot,
      avatars: config.avatarRoot,
      covers: config.coverRoot,
    },
    warnPercent: config.storageWarnPercent,
    blockPercent: config.storageBlockPercent,
    monitorIntervalMs: config.storageMonitorIntervalSeconds * 1000,
    logger: storageLogger,
  });
  const uploadService = createUploadService({
    repository: new PostgresUploadRepository(database.pool),
    objectStore: quarantineStore,
    storageCapacityService,
  });
  const validationWorker = createValidationWorker({
    repository: new PostgresValidationRepository(database.pool), quarantineStore,
    runtimeStore: new LocalRuntimeStore(config.runtimeRoot), validatorRoot: config.validatorRoot,
    validationRunner: createWebValidationRunner({
      mode: config.validatorExecutionMode,
      validatorRoot: config.validatorRoot,
      quarantineRoot: config.quarantineRoot,
    }),
  });
  const runtimeStore = new LocalRuntimeStore(config.runtimeRoot);
  const catalogService = createCatalogService({ repository: new PostgresCatalogRepository(database.pool), config, artifactStore: quarantineStore });
  const engagementService = createEngagementService({ repository: new PostgresEngagementRepository(database.pool), catalogService });
  const guessBaikeRepository = new PostgresGuessBaikeRepository(database.pool);
  const guessBaikeService = createGuessBaikeService({ repository: guessBaikeRepository });
  const guessBaikeAutomation = createGuessBaikeAutomation({
    repository: guessBaikeRepository, enabled: config.guessBaikeAutomationEnabled,
    intervalMinutes: config.guessBaikeAutomationIntervalMinutes, batchSize: config.guessBaikeAutomationBatchSize,
    scheduleDays: config.guessBaikeScheduleDays, userAgent: config.guessBaikeWikipediaUserAgent,
  });
  const moderationService = createModerationService({ repository: new PostgresModerationRepository(database.pool) });
  const socialService = createSocialService({ repository: new PostgresSocialRepository(database.pool) });
  const analyticsService = createAnalyticsService({ repository: new PostgresAnalyticsRepository(database.pool) });
  const realtimeTicketStore = createRedisRealtimeTicketStore({ url: config.redisUrl });
  const realtimeTicketService = createRealtimeTicketService({ store: realtimeTicketStore, websocketUrl: config.realtimePublicUrl, ttlSeconds: config.realtimeTicketTtlSeconds });
  const rulesRegistry = loadTrustedRules ? loadRulesRegistry({ manifestPath: config.rulesManifestPath,trustedKeys: config.rulesTrustedKeys,allowUnsigned: config.rulesAllowUnsigned }) : createRulesRegistry();
  const multiplayerRoomService = createMultiplayerRoomService({ repository: new PostgresMultiplayerRoomRepository(database.pool), roomCodeHmacKey: config.roomCodeHmacKey,rulesRegistry });
  const multiplayerMatchPublisher = createRedisMatchPublisher({ url: config.redisUrl });
  const multiplayerRoomPublisher = createRedisMatchPublisher({ url: config.redisUrl,channelKind: 'room' });
  const multiplayerMatchService = createMultiplayerMatchService({ repository: new PostgresMultiplayerMatchRepository(database.pool), rulesRegistry, publisher: multiplayerMatchPublisher,roomPublisher: multiplayerRoomPublisher });
  const app = createApp({ config, database, migrations, authService, workService, githubSourceService, uploadService, catalogService, engagementService, guessBaikeService, guessBaikeAutomation, moderationService, socialService, analyticsService, storageCapacityService, realtimeTicketService, multiplayerRoomService, multiplayerMatchService, logger: config.nodeEnv !== 'test' });
  const runtimeEdgeApp = createRuntimeEdgeApp({ repository: new PostgresRuntimeEdgeRepository(database.pool), objectStore: runtimeStore, runtimeDomain: config.runtimeDomain, logger: config.nodeEnv !== 'test' });
  app.addHook('onClose', async () => { guessBaikeAutomation.stop(); storageCapacityService.stop(); await multiplayerMatchPublisher.close(); await multiplayerRoomPublisher.close(); await realtimeTicketStore.close(); await database.close(); });
  return { config, database, migrations, avatarStore, coverStore, authService, workService, githubSourceService, uploadService, validationWorker, catalogService, engagementService, guessBaikeService, guessBaikeAutomation, moderationService, socialService, analyticsService, storageCapacityService, realtimeTicketService, rulesRegistry, multiplayerRoomService, multiplayerMatchService, runtimeEdgeApp, app };
}
