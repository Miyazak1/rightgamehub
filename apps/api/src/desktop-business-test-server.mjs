import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';
import { applyMigrations, migrationStatus } from './migrations.mjs';
import { createApp } from './app.mjs';
import { PostgresAuthRepository } from './auth-repository.mjs';
import { createAuthService } from './auth-service.mjs';
import { createGitHubOAuthClient } from './github-oauth-client.mjs';
import { LocalAvatarStore } from './local-avatar-store.mjs';
import { LocalCoverStore } from './local-cover-store.mjs';
import { LocalRuntimeStore } from './local-runtime-store.mjs';
import { PostgresWorkRepository } from './work-repository.mjs';
import { createWorkService } from './work-service.mjs';
import { PostgresCatalogRepository } from './catalog-repository.mjs';
import { createCatalogService } from './catalog-service.mjs';
import { createCompetitionService } from './competition-service.mjs';
import { PostgresSocialRepository } from './social-repository.mjs';
import { readWorkLeaderboard } from './work-leaderboard.mjs';
import { PostgresEngagementRepository } from './engagement-repository.mjs';
import { createEngagementService } from './engagement-service.mjs';
import { PostgresPublicProfileRepository } from './public-profile-repository.mjs';
import { createPublicProfileService } from './public-profile-service.mjs';
import { PostgresBlogRepository } from './blog-repository.mjs';
import { createBlogService } from './blog-service.mjs';
import { PostgresDiscoveryCampaignRepository, createDiscoveryCampaignService } from './discovery-campaign-service.mjs';
import { PostgresDevelopmentLogRepository, createDevelopmentLogService } from './development-log-service.mjs';
import { PostgresProjectClaimRepository, createProjectClaimService } from './project-claim-service.mjs';
import { PostgresRuntimeEdgeRepository } from './runtime-edge-repository.mjs';
import { createRuntimeEdgeApp } from './runtime-edge-app.mjs';
import { createDesktopAuthReadiness } from './desktop-auth-readiness.mjs';
import { desktopBusinessTestConfig, desktopBusinessTestGuard } from './desktop-business-test-policy.mjs';
import {createDesktopPaperStudyService} from './desktop-paper-study.mjs';

export function createDesktopBusinessTestRuntime(env) {
  const settings = desktopBusinessTestConfig(env), config = loadConfig(settings.env);
  const database = createDatabase(config);
  const paperStudy=settings.paperStudyEnabled?createDesktopPaperStudyService({pool:database.pool,redisUrl:settings.env.REDIS_URL}):null;
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const migrations = { apply: () => applyMigrations(database.pool, directory), status: () => migrationStatus(database.pool, directory) };
  const readiness = createDesktopAuthReadiness({ database, migrations, redisUrl: settings.env.REDIS_URL });
  const authService = createAuthService({ repository: new PostgresAuthRepository(database.pool, new LocalAvatarStore(config.avatarRoot)),
    otpHmacKey: config.otpHmacKey, loginEmailAllowlist: config.loginEmailAllowlist,
    githubClient: settings.githubConfigured ? createGitHubOAuthClient({ clientId: config.githubClientId,
      clientSecret: config.githubClientSecret, callbackUrl: config.githubCallbackUrl }) : undefined,
    mailer: { async sendVerificationCode({ email, code }) {
      if (email !== 'desktop-reader@example.test') throw Error('TEST_EMAIL_NOT_ALLOWED');
      if (settings.remote) throw Error('REMOTE_TEST_EMAIL_DISABLED');
      const file = '/data/desktop-business/test-mail.json';
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ email, code }), { mode: 0o600 });
    } } });
  const coverStore = new LocalCoverStore(config.coverRoot), runtimeStore = new LocalRuntimeStore(config.runtimeRoot);
  const catalogService = createCatalogService({ repository: new PostgresCatalogRepository(database.pool), config });
  const socialRepository = new PostgresSocialRepository(database.pool);
  const competition = createCompetitionService({ pool: database.pool,
    socialService: { workLeaderboard: (actor, input) => readWorkLeaderboard(socialRepository, actor, input, new Date()) } });
  // Reuse public read semantics, without game-session authority or score writes.
  const competitionService = { boards: competition.boards, leaderboard: competition.leaderboard };
  const app = createApp({ config, database, migrations, authService,
    paperStudyService:paperStudy?.service,
    requestGuard: (request, reply) => desktopBusinessTestGuard(request, reply, settings),
    catalogService, competitionService, workService: createWorkService({ repository: new PostgresWorkRepository(database.pool, coverStore) }),
    engagementService: createEngagementService({ repository: new PostgresEngagementRepository(database.pool), catalogService }),
    publicProfileService: createPublicProfileService({ repository: new PostgresPublicProfileRepository(database.pool) }),
    blogService: createBlogService({ repository: new PostgresBlogRepository(database.pool) }),
    discoveryCampaignService: createDiscoveryCampaignService({ repository: new PostgresDiscoveryCampaignRepository(database.pool), catalogService, siteOrigin: settings.publicOrigin }),
    developmentLogService: createDevelopmentLogService({ repository: new PostgresDevelopmentLogRepository(database.pool) }),
    projectClaimService: createProjectClaimService({ repository: new PostgresProjectClaimRepository(database.pool) }),
  });
  const runtimeEdgeApp = createRuntimeEdgeApp({ repository: new PostgresRuntimeEdgeRepository(database.pool), objectStore: runtimeStore,
    runtimeDomain: config.runtimeDomain, logger: false });
  const ready = async (_request, reply) => {
    const health = await readiness.check();
    const paperReady=paperStudy?await paperStudy.service.ready():true;
    return reply.code(health.status === 'ready'&&paperReady ? 200 : 503).send({ data: { ...health,
      status:health.status==='ready'&&paperReady?'ready':'not-ready',
      paperStudy:{enabled:!!paperStudy,ready:paperReady,modelCallsEnabled:false,publishingEnabled:false},
      instance: 'isolated-business', githubConfigured: settings.githubConfigured, emailConfigured: !settings.remote,
      emailDelivery: settings.remote ? 'disabled' : 'local-capture',
      backgroundTasksEnabled: false, publishingEnabled: false, modelCallsEnabled: false,
      runtime: settings.runtime } });
  };
  app.get('/ready-desktop-business', ready);
  app.get('/ready-desktop-auth', ready);
  app.addHook('preClose', async () => readiness.close());
  app.addHook('onClose', async () => { await runtimeEdgeApp.close();await paperStudy?.close(); await database.close(); });
  return { app, runtimeEdgeApp, database, migrations, config, coverStore, runtimeStore };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = createDesktopBusinessTestRuntime(process.env);
  if (process.argv.includes('--migrate') || process.argv.includes('--seed')) {
    try {
      if (process.argv.includes('--migrate')) console.log(JSON.stringify(await runtime.migrations.apply()));
      else { const { seedDesktopBusiness } = await import('./desktop-business-test-seed.mjs'); console.log(JSON.stringify(await seedDesktopBusiness(runtime))); }
    } finally { await runtime.app.close(); }
  } else {
    await runtime.runtimeEdgeApp.listen({ host: '0.0.0.0', port: 3092 });
    await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
    console.log('Isolated desktop business API listening; publishing, model calls and autonomous business workers disabled.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await runtime.app.close(); process.exitCode = 0; });
  }
}
