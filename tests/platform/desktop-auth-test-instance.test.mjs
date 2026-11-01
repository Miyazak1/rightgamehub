import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { desktopAuthTestConfig, desktopAuthTestGuard, desktopAuthTestRequestAllowed } from '../../apps/api/src/desktop-auth-test-policy.mjs';
import { createApp } from '../../apps/api/src/app.mjs';
import { loadConfig } from '../../apps/api/src/config.mjs';

const base = () => ({ DESKTOP_AUTH_TEST_INSTANCE: 'isolated-auth-only',
  DATABASE_URL: `postgresql://desktop_auth_test:${'a'.repeat(64)}@auth-postgres:5432/desktop_auth_test`,
  REDIS_URL: 'redis://auth-redis:6379', OTP_HMAC_KEY: 'b'.repeat(64),
  DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: 'https://desktop-test.example.org' });

test('test instance rejects unrelated databases, Redis, public origin and partial OAuth configuration', () => {
  for (const patch of [
    { DESKTOP_AUTH_TEST_INSTANCE: '' }, { DATABASE_URL: 'postgresql://gamehub:password@postgres:5432/gamehub' },
    { DATABASE_URL: base().DATABASE_URL + '?host=production' },
    { DATABASE_URL: base().DATABASE_URL.replace('auth-postgres', '127.0.0.1') },
    { REDIS_URL: 'redis://redis:6379' }, { OTP_HMAC_KEY: 'weak' },
    { DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: 'https://mooyu.fun' },
    { DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: 'https://mooyu.fun.' },
    { DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: 'https://www.mooyu.fun' },
    { DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: 'http://example.org' },
    { DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: 'https://example.org/?key=x' },
    { GITHUB_CLIENT_ID: 'incomplete' },
    { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_CALLBACK_URL: 'https://mooyu.fun/v1/auth/github/web/callback' },
  ]) assert.throws(() => desktopAuthTestConfig({ ...base(), ...patch }), /CONFIGURATION_REJECTED/);
});

test('builds a clean environment and reports unconfigured GitHub honestly', () => {
  const settings = desktopAuthTestConfig({ ...base(), DEEPSEEK_API_KEY: 'do-not-inherit',
    RESEND_API_KEY: 'do-not-inherit', CLOUD_SAVE_ENABLED: 'true', GUESS_BAIKE_AUTOMATION_ENABLED: 'true' });
  assert.equal(settings.githubConfigured, false);
  assert.equal(settings.env.DEEPSEEK_API_KEY, undefined);
  assert.equal(settings.env.RESEND_API_KEY, undefined);
  assert.equal(settings.env.MAIL_PROVIDER, 'disabled');
  assert.equal(settings.env.CLOUD_SAVE_ENABLED, 'false');
  assert.equal(settings.env.GUESS_BAIKE_AUTOMATION_ENABLED, 'false');
  const config = loadConfig(settings.env);
  assert.equal(config.githubClientId, null);
  const enabled = desktopAuthTestConfig({ ...base(), GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret',
    GITHUB_CALLBACK_URL: `${base().DESKTOP_AUTH_TEST_PUBLIC_ORIGIN}/v1/auth/github/web/callback` });
  assert.equal(enabled.githubConfigured, true);
});

test('real shared app denies business routes before parsing, retains session and OAuth routes', async t => {
  const app = createApp({ config: loadConfig(desktopAuthTestConfig(base()).env),
    requestGuard: desktopAuthTestGuard,
    authService: {} });
  t.after(() => app.close());
  for (const url of ['/v1/agent-runs', '/v1/blog/articles', '/ready', '/v1/me/game-saves', '/v1/auth/github/device']) {
    const response = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{bad' });
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.json().error.code, 'DESKTOP_AUTH_TEST_ROUTE_DISABLED');
  }
  const session = await app.inject({ method: 'POST', url: '/v1/auth/session', payload: {} });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().data.authenticated, false);
  assert.equal(desktopAuthTestRequestAllowed('POST', '/v1/auth/github/web'), true);
  assert.equal(desktopAuthTestRequestAllowed('GET', '/v1/auth/github/web/callback?state=example'), true);
  assert.equal(desktopAuthTestRequestAllowed('PUT', '/v1/me/avatar'), false);
  assert.equal(desktopAuthTestRequestAllowed('POST', '/v1/auth/github/web/../device'), false);
});

test('dedicated entry never constructs the full business runtime or starts workers', async () => {
  const source = await readFile(new URL('../../apps/api/src/desktop-auth-test-server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]\.\/runtime\.mjs|\.start\(/);
  assert.match(source, /new PostgresAuthRepository/);
  assert.match(source, /createGitHubOAuthClient/);
  assert.match(source, /requestGuard: desktopAuthTestGuard/);
});

test('configuration preparation never prints secrets or overwrites an existing instance', async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parent = path.join(root, '.runtime', 'desktop-auth-test');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'prepare-check-'));
  assert.ok(directory.startsWith(parent + path.sep));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'instance.env');
  const args = ['scripts/prepare-desktop-auth-test.mjs', output, 'https://desktop-test.example.org'];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const content = await readFile(output, 'utf8');
  for (const match of content.matchAll(/=(\w{64})/g)) assert.equal(result.stdout.includes(match[1]), false);
  const again = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.equal(await readFile(output, 'utf8'), content);
  const outside = spawnSync(process.execPath, ['scripts/prepare-desktop-auth-test.mjs', 'deploy/unsafe.env'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(outside.status, 0);
});
