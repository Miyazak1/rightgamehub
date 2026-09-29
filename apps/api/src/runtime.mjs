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

export const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export function createRuntime({ env = process.env, mailer } = {}) {
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
  const quarantineStore = new LocalQuarantineStore(config.quarantineRoot);
  const uploadService = createUploadService({
    repository: new PostgresUploadRepository(database.pool),
    objectStore: quarantineStore,
  });
  const validationWorker = createValidationWorker({
    repository: new PostgresValidationRepository(database.pool), quarantineStore,
    runtimeStore: new LocalRuntimeStore(config.runtimeRoot), validatorRoot: config.validatorRoot,
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
  const app = createApp({ config, database, migrations, authService, workService, uploadService, catalogService, engagementService, guessBaikeService, guessBaikeAutomation, moderationService, socialService, logger: config.nodeEnv !== 'test' });
  const runtimeEdgeApp = createRuntimeEdgeApp({ repository: new PostgresRuntimeEdgeRepository(database.pool), objectStore: runtimeStore, runtimeDomain: config.runtimeDomain, logger: config.nodeEnv !== 'test' });
  app.addHook('onClose', async () => { guessBaikeAutomation.stop(); await database.close(); });
  return { config, database, migrations, avatarStore, coverStore, authService, workService, uploadService, validationWorker, catalogService, engagementService, guessBaikeService, guessBaikeAutomation, moderationService, socialService, runtimeEdgeApp, app };
}
