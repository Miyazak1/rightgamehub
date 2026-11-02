import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopBusinessTestConfig, desktopBusinessTestRequestAllowed } from '../../apps/api/src/desktop-business-test-policy.mjs';
import { localBusinessRuntime, validateDesktopLaunch } from '../../apps/desktop/src/runtime-policy.mjs';
import { desktopAccountLaunchOptions } from '../../apps/desktop/src/account-configuration.mjs';
import { businessArguments } from '../../apps/desktop/src/business-contract.mjs';
import policy from '../../apps/desktop/electron/policy.cjs';
import { loadConfig } from '../../apps/api/src/config.mjs';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';

const valid = () => ({ DESKTOP_BUSINESS_TEST_INSTANCE: 'isolated-business',
  DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN: 'http://127.0.0.1:39190', DESKTOP_BUSINESS_TEST_RUNTIME_PORT: '39192',
  DATABASE_URL: 'postgresql://desktop_business_test:' + 'a'.repeat(64) + '@business-postgres:5432/desktop_business_test',
  REDIS_URL: 'redis://business-redis:6379', OTP_HMAC_KEY: 'b'.repeat(64) });
test('business instance only accepts the dedicated database, Redis and loopback origin, with fresh environment', () => {
  const settings = desktopBusinessTestConfig({ ...valid(), DEEPSEEK_API_KEY: 'must-not-leak', GITHUB_CLIENT_SECRET: 'must-not-leak', AWS_SECRET_ACCESS_KEY: 'must-not-leak' });
  assert.equal(settings.env.DEEPSEEK_API_KEY, undefined); assert.equal(settings.env.GITHUB_CLIENT_SECRET, undefined);
  assert.equal(settings.env.AWS_SECRET_ACCESS_KEY, undefined); assert.equal(settings.env.MAIL_PROVIDER, 'disabled');
  assert.equal(loadConfig(settings.env).runtimeDomain, 'localhost');
  for (const patch of [{ DESKTOP_BUSINESS_TEST_INSTANCE: 'production' }, { DATABASE_URL: 'postgresql://gamehub:secret@postgres:5432/gamehub' },
    { REDIS_URL: 'redis://redis:6379' }, { DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN: 'https://mooyu.fun' },
    { DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN: 'http://127.0.0.1:39190/path' }, { DESKTOP_BUSINESS_TEST_RUNTIME_PORT: '39190' }])
    assert.throws(() => desktopBusinessTestConfig({ ...valid(), ...patch }));
});
test('HTTP boundary permits business reads, library and synthetic email login, but no publishing/providers/workers/admin/uploads', () => {
  const id = 'd7b00000-0000-4000-8000-000000000002';
  for (const [method, url] of [['GET', '/v1/works?q=test'], ['GET', '/v1/works/' + id + '/launch'], ['GET', '/v1/blog/articles/desktop-business-fixture'], ['PUT', '/v1/me/library/' + id], ['POST', '/v1/me/recent/' + id], ['POST', '/v1/auth/email/challenges']])
    assert.equal(desktopBusinessTestRequestAllowed(method, url), true, method + url);
  for (const [method, url] of [['POST', '/v1/me/blog/articles/' + id + '/publish'], ['POST', '/v1/creator/works'],
    ['POST', '/v1/auth/github/web'], ['POST', '/v1/admin/agents'], ['POST', '/v1/analytics/events'],
    ['GET', '/v1/admin/agents'], ['POST', '/v1/research/topics'], ['POST', '/v1/uploads'], ['OPTIONS', '/v1/works'], ['DELETE', '/v1/me']])
    assert.equal(desktopBusinessTestRequestAllowed(method, url), false, method + url);
});
test('runtime origins require explicit loopback configuration and a matching release descriptor', () => {
  const api = 'http://127.0.0.1:39190', rules = localBusinessRuntime({ domain: 'localhost', scheme: 'http', port: 39192 }, api);
  const release = 'd7b00000-0000-4000-8000-000000000003', origin = 'http://r-' + release.replaceAll('-', '') + '.localhost:39192';
  const descriptor = { apiVersion: 1, workId: 'test-work', releaseId: release, runtimeOrigin: origin, entryUrl: origin + '/index.html' };
  assert.equal(validateDesktopLaunch(descriptor, rules, 'test-work', release), origin);
  for (const patch of [{ runtimeOrigin: 'https://mooyu.fun' }, { entryUrl: 'https://mooyu.fun/index.html' },
    { entryUrl: origin + '/index.html?url=https://mooyu.fun' }, { releaseId: 'other' }, { workId: 'other' }])
    assert.throws(() => validateDesktopLaunch({ ...descriptor, ...patch }, rules, 'test-work', release));
  assert.throws(() => validateDesktopLaunch(descriptor, null, 'test-work'));
  for (const source of ['https://mooyu.fun', 'https://desktop-test.mooyu.fun']) assert.throws(() => localBusinessRuntime(rules, source));
});
test('launch options do not widen HTTPS account sessions to a loopback runtime', () => {
  const options = desktopAccountLaunchOptions(['--account-api', 'http://127.0.0.1:39190', '--test-runtime-origin', 'http://localhost:39192'], process.cwd());
  assert.equal(options.businessRuntime.port, 39192);
  assert.throws(() => desktopAccountLaunchOptions(['--test-account-api', 'https://desktop-test.mooyu.fun', '--test-runtime-origin', 'http://localhost:39192'], process.cwd()));
  assert.throws(() => desktopAccountLaunchOptions(['--account-api', 'http://127.0.0.1:39190', '--test-runtime-origin', 'http://mooyu.fun:39192'], process.cwd()));
  assert.deepEqual(businessArguments('getLaunch', ['work']), ['work', undefined]);
});
test('renderer resource policy allows only minted release origins and never the production API', () => {
  const origin = 'http://r-d7b00000000040008000000000000003.localhost:39192';
  const origins = new Set([origin]);
  assert.equal(policy.allowedRequest({ url: origin + '/game.js', resourceType: 'script' }, null, origins), true);
  assert.equal(policy.allowedRequest({ url: origin + '/game.js', resourceType: 'script' }), false);
  for (const url of ['https://mooyu.fun/v1/works', 'http://localhost:39192/index.html', 'http://r-other.localhost:39192/game.js', 'http://u:p@r-d7b00000000040008000000000000003.localhost:39192/game.js'])
    assert.equal(policy.allowedRequest({ url, resourceType: 'script' }, null, origins), false);
});
test('HTTPS business readiness requires publishing and model gates disabled before any business request', async () => {
  for (const extra of [{ publishingEnabled: false, modelCallsEnabled: false }, { publishingEnabled: true, modelCallsEnabled: false }, { publishingEnabled: false, modelCallsEnabled: true }]) {
    const calls = [];
    const session = await createDesktopAccountSession({ apiOrigin: 'https://desktop-business.example.test', environment: 'isolated-test',
      vault: createMemoryCredentialVault(), fetchImpl: async url => {
        calls.push(new URL(url).pathname);
        return Response.json({ data: url.endsWith('/ready-desktop-auth') ? { status: 'ready', instance: 'isolated-business',
          database: true, redis: true, migrations: { ready: true }, backgroundTasksEnabled: false, ...extra } : [] });
      } });
    const request = session.call('business', [{ method: 'listWorks', args: [{}] }]);
    if (extra.publishingEnabled || extra.modelCallsEnabled) {
      await assert.rejects(request, { code: 'DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED' }); assert.equal(calls.length, 1);
    } else { assert.deepEqual((await request).data, []); assert.equal(calls.length, 2); }
  }
});
