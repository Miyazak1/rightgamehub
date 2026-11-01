import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';
import { applyMigrations, migrationStatus } from './migrations.mjs';
import { PostgresAuthRepository } from './auth-repository.mjs';
import { LocalAvatarStore } from './local-avatar-store.mjs';
import { createAuthService } from './auth-service.mjs';
import { createGitHubOAuthClient } from './github-oauth-client.mjs';
import { createConfiguredMailer } from './mailer.mjs';
import { createApp } from './app.mjs';
import { createDesktopAuthReadiness } from './desktop-auth-readiness.mjs';
import { desktopAuthTestConfig, desktopAuthTestGuard } from './desktop-auth-test-policy.mjs';

export function createDesktopAuthTestRuntime(env) {
  const settings = desktopAuthTestConfig(env);
  const config = loadConfig(settings.env);
  const database = createDatabase(config);
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const migrations = {
    apply: () => applyMigrations(database.pool, directory),
    status: () => migrationStatus(database.pool, directory),
  };
  const readiness = createDesktopAuthReadiness({ database, migrations, redisUrl: settings.env.REDIS_URL });
  const authService = createAuthService({
    repository: new PostgresAuthRepository(database.pool, new LocalAvatarStore(config.avatarRoot)),
    mailer: createConfiguredMailer(config), otpHmacKey: config.otpHmacKey,
    githubClient: createGitHubOAuthClient({ clientId: config.githubClientId,
      clientSecret: config.githubClientSecret, callbackUrl: config.githubCallbackUrl }),
  });
  // No business service or background worker is constructed. Request logging is disabled
  // because OAuth callback queries contain authorization codes and state.
  const app = createApp({ config, database, migrations, authService, requestGuard: desktopAuthTestGuard });
  app.get('/ready-desktop-auth', async (_request, reply) => {
    const health = await readiness.check();
    return reply.code(health.status === 'ready' ? 200 : 503).send({ data: {
      ...health, instance: 'isolated-auth-only',
      githubConfigured: settings.githubConfigured, emailConfigured: false,
      backgroundTasksEnabled: false,
    } });
  });
  app.addHook('preClose', async () => { readiness.close(); });
  app.addHook('onClose', async () => { await database.close(); });
  return { app, config, migrations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = createDesktopAuthTestRuntime(process.env);
  if (process.argv.includes('--migrate')) {
    try { console.log(JSON.stringify(await runtime.migrations.apply())); }
    finally { await runtime.app.close(); }
  } else {
    await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
    console.log('Isolated desktop account API listening; background tasks disabled.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
      await runtime.app.close(); process.exitCode = 0;
    });
  }
}
