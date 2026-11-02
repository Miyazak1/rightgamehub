import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedBusinessOrigins } from '../../packages/contracts/src/isolated-business-origins.mjs';
import { desktopBusinessTestConfig, desktopBusinessTestRequestAllowed } from '../../apps/api/src/desktop-business-test-policy.mjs';
import { desktopAuthCaddyfile } from '../../scripts/prepare-desktop-auth-caddy.mjs';
import { desktopBusinessCaddyfile } from '../../scripts/prepare-desktop-business-caddy.mjs';
import { desktopAccountLaunchOptions } from '../../apps/desktop/src/account-configuration.mjs';
import { validateDesktopLaunch } from '../../apps/desktop/src/runtime-policy.mjs';
import { playerRuntimeOptions } from '../../packages/platform-client/src/player-runtime-options.mjs';
import policy from '../../apps/desktop/electron/policy.cjs';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createApp } from '../../apps/api/src/app.mjs';
import { createAuthService } from '../../apps/api/src/auth-service.mjs';
import { loadConfig } from '../../apps/api/src/config.mjs';
import { desktopBusinessTestGuard } from '../../apps/api/src/desktop-business-test-policy.mjs';
import { createHash } from 'node:crypto';
const api = 'https://desktop-test.example.org', runtime = 'https://desktop-runtime-test.example.org';
const env = () => ({ DESKTOP_BUSINESS_TEST_INSTANCE: 'isolated-business', DESKTOP_BUSINESS_TEST_MODE: 'remote-https',
  DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN: api, DESKTOP_BUSINESS_TEST_RUNTIME_ORIGIN: runtime, DESKTOP_BUSINESS_TEST_RUNTIME_PORT: '443',
  DATABASE_URL: 'postgresql://desktop_business_test:' + 'a'.repeat(64) + '@business-postgres:5432/desktop_business_test',
  REDIS_URL: 'redis://business-redis:6379', OTP_HMAC_KEY: 'b'.repeat(64) });
test('remote business explicitly pairs HTTPS test namespaces and rejects production, suffix tricks, ports and local mixing', () => {
  assert.equal(isolatedBusinessOrigins(api, runtime).domain, 'desktop-runtime-test.example.org');
  for (const pair of [[api, 'https://runtime.mooyu.fun'], ['https://mooyu.fun', runtime],
    [api, runtime + '.evil.invalid'], [api, 'https://desktop-runtime-test.other.org'],
    [api + ':444', runtime], [api, runtime + '/path'], [api, 'http://localhost:39192'],
    [api, runtime + '.'], [api + '.', runtime], [api + '?x', runtime], [api, 'https://user@desktop-runtime-test.example.org']])
    assert.throws(() => isolatedBusinessOrigins(...pair), { message: 'DESKTOP_TEST_ORIGINS_INVALID' });
});
test('remote policy keeps isolated DB/Redis and closed capabilities; optional GitHub requires exact callback and complete triple', () => {
  const settings = desktopBusinessTestConfig({ ...env(), DEEPSEEK_API_KEY: 'ignored', SMTP_PASSWORD: 'ignored' });
  assert.equal(settings.remote, true); assert.equal(settings.githubConfigured, false);
  assert.equal(settings.env.DEEPSEEK_API_KEY, undefined); assert.equal(settings.env.SMTP_PASSWORD, undefined);
  assert.equal(settings.env.RUNTIME_SCHEME, 'https'); assert.equal(settings.env.RUNTIME_PUBLIC_PORT, '443');
  const github = { GITHUB_CLIENT_ID: 'test-app', GITHUB_CLIENT_SECRET: 'fixture-only', GITHUB_CALLBACK_URL: api + '/v1/auth/github/web/callback' };
  const oauth = desktopBusinessTestConfig({ ...env(), ...github }); assert.equal(oauth.githubConfigured, true);
  for (const patch of [{ REDIS_URL: 'redis://redis:6379' }, { DATABASE_URL: 'postgresql://gamehub:secret@postgres:5432/gamehub' },
    { GITHUB_CLIENT_ID: 'incomplete' }, { ...github, GITHUB_CALLBACK_URL: 'https://mooyu.fun/v1/auth/github/web/callback' },
    { DESKTOP_BUSINESS_TEST_MODE: '' }, { DESKTOP_BUSINESS_TEST_RUNTIME_PORT: '3092' }])
    assert.throws(() => desktopBusinessTestConfig({ ...env(), ...patch }));
  for (const url of ['/v1/auth/email/challenges', '/v1/auth/email/verify', '/v1/creator/works', '/v1/admin/agents', '/v1/uploads'])
    assert.equal(desktopBusinessTestRequestAllowed('POST', url, oauth), false);
  assert.equal(desktopBusinessTestRequestAllowed('POST', '/v1/auth/github/web', oauth), true);
  assert.equal(desktopBusinessTestRequestAllowed('POST', '/v1/auth/github/web', settings), false);
  assert.equal(desktopBusinessTestRequestAllowed('GET', '/v1/auth/github/web/callback?code=test', oauth), true);
});
test('desktop uses trusted remote runtime and exact minted release origins, preserving renderer network isolation', () => {
  const options = desktopAccountLaunchOptions(['--test-account-api', api, '--test-runtime-origin', runtime], process.cwd());
  assert.equal(options.businessRuntime.domain, 'desktop-runtime-test.example.org');
  const id = 'd7b00000-0000-4000-8000-000000000003', origin = runtime.replace('://', '://r-' + id.replaceAll('-', '') + '.');
  const launch = { apiVersion: 1, workId: 'work', releaseId: id, entryUrl: origin + '/index.html', runtimeOrigin: origin };
  assert.equal(validateDesktopLaunch(launch, options.businessRuntime, 'work', id), origin);
  for (const patch of [{ runtimeOrigin: 'https://mooyu.fun' }, { entryUrl: 'http:' + launch.entryUrl.slice(6) },
    { entryUrl: runtime + '/index.html' }, { entryUrl: launch.entryUrl + '?redirect=1' }, { releaseId: 'd7b00000-0000-4000-8000-000000000005' }])
    assert.throws(() => validateDesktopLaunch({ ...launch, ...patch }, options.businessRuntime, 'work', id));
  for (const entryUrl of [origin + '/a/../index.html', origin + '/%2e%2e/index.html', origin + '/index.html#', origin + '/index.html?'])
    assert.throws(() => validateDesktopLaunch({ ...launch, entryUrl }, options.businessRuntime, 'work', id));
  assert.deepEqual(playerRuntimeOptions({ host: { apiBaseUrl: api, runtimeDomain: options.businessRuntime.domain }, pageHostname: 'client' }),
    { runtimeDomain: 'desktop-runtime-test.example.org', allowLocalhost: false });
  assert.equal(policy.allowedRequest({ url: origin + '/game.js', resourceType: 'script' }), false);
  assert.equal(policy.allowedRequest({ url: origin + '/game.js', resourceType: 'script' }, null, new Set([origin])), true);
  assert.equal(policy.allowedRequest({ url: api + '/v1/me', resourceType: 'xhr' }, null, new Set([origin])), false);
});
test('Caddy upgrade preserves current baseline and redaction, switches only test upstream and adds restricted runtime', () => {
  const original = '{\n  email test@example.org\n}\nmain.example.org { respond "existing" }\n';
  const auth = desktopAuthCaddyfile(original, 'desktop-test.example.org');
  const combined = desktopBusinessCaddyfile(auth, api, runtime);
  assert.match(combined, /main.example.org \{ respond "existing" \}/);
  assert.equal(combined.match(/log default/g).length, 1);
  assert.match(combined, /desktop-business-test-api:3090/); assert.match(combined, /desktop-business-test-api:3092/);
  assert.doesNotMatch(combined, /desktop-auth-test-api:3090/);
  assert.match(combined, /method GET HEAD/); assert.match(combined, /header_up -Cookie/);
  assert.match(combined, /request>uri regexp/);
  assert.throws(() => desktopBusinessCaddyfile(auth.replace('dial_timeout 3s', 'dial_timeout 30s'), api, runtime));
  assert.throws(() => desktopBusinessCaddyfile(auth.replace('request>headers>Cookie delete', 'request>headers>Cookie hash'), api, runtime));
  assert.throws(() => desktopBusinessCaddyfile(combined, api, runtime));
  assert.throws(() => desktopBusinessCaddyfile('import secret.conf', api, runtime));
});
test('remote session checks runtime configuration before business I/O and only mints origins for matching releases', async () => {
  const id = 'd7b00000-0000-4000-8000-000000000003', origin = runtime.replace('://', '://r-' + id.replaceAll('-', '') + '.');
  for (const mismatch of [false, true]) {
    const calls = [], minted = [];
    const session = await createDesktopAccountSession({ apiOrigin: api, environment: 'isolated-test',
      businessRuntime: { domain: 'desktop-runtime-test.example.org', scheme: 'https', port: 443 },
      vault: createMemoryCredentialVault(), onRuntimeOrigin: value => minted.push(value),
      fetchImpl: async url => { calls.push(new URL(url).pathname); return Response.json({ data: url.endsWith('/ready-desktop-auth') ? {
        status: 'ready', instance: 'isolated-business', backgroundTasksEnabled: false, publishingEnabled: false, modelCallsEnabled: false,
        database: true, redis: true, migrations: { ready: true },
        runtime: { domain: mismatch ? 'runtime.mooyu.fun' : 'desktop-runtime-test.example.org', scheme: 'https', port: 443 },
      } : { apiVersion: 1, workId: 'work', releaseId: id, entryUrl: origin + '/index.html', runtimeOrigin: origin } }); } });
    const result = session.call('business', [{ method: 'getLaunch', args: ['work'] }]);
    if (mismatch) { await assert.rejects(result, { code: 'DESKTOP_RUNTIME_DENIED' }); assert.equal(calls.length, 1); assert.deepEqual(minted, []); }
    else { await result; assert.deepEqual(minted, [origin]); }
  }
});

test('business allowlist restores account controls in both modes while rejecting uploads and unrelated mutations', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  for (const settings of [{}, { remote: true, githubConfigured: true }]) {
    for (const [method, url] of [['PATCH', '/v1/me'], ['PATCH', '/v1/me/avatar'], ['DELETE', '/v1/me/devices/' + id]])
      assert.equal(desktopBusinessTestRequestAllowed(method, url, settings), true, method + url);
    for (const [method, url] of [['PUT', '/v1/me/avatar'], ['POST', '/v1/me/avatar'], ['DELETE', '/v1/me/avatar'],
      ['PATCH', '/v1/me/devices/' + id], ['DELETE', '/v1/me/devices'], ['DELETE', '/v1/me/devices/' + id + '/extra'],
      ['PATCH', '/v1/me/permissions'], ['PATCH', '/v1/users/' + id], ['POST', '/v1/uploads'],
      ['POST', '/v1/me/blog/articles/' + id + '/publish'], ['POST', '/v1/admin/agents'], ['POST', '/v1/research/topics']])
      assert.equal(desktopBusinessTestRequestAllowed(method, url, settings), false, method + url);
  }
});

async function accountControlApp(t) {
  const settings = desktopBusinessTestConfig(env());
  const profiles = new Map([['owner', { id: 'owner', displayName: 'Owner', avatar: { kind: 'preset', presetKey: 'cat' } }],
    ['other', { id: 'other', displayName: 'Other', avatar: { kind: 'preset', presetKey: 'fox' } }]]);
  const tokens = ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)];
  const ids = ['12345678-1234-4234-8234-123456789abc', '12345678-1234-4234-8234-123456789abd', '12345678-1234-4234-8234-123456789abe'];
  const grants = tokens.map((token, i) => ({ hash: createHash('sha256').update(token).digest('hex'), grantId: ids[i], userId: i === 2 ? 'other' : 'owner', active: true }));
  const repository = {
    async authenticateAccessToken({ tokenHash }) { const g = grants.find(g => g.hash === tokenHash.toString('hex') && g.active); return g ? { userId: g.userId, grantId: g.grantId } : null; },
    async getAccountProfile(userId) { return structuredClone(profiles.get(userId)); },
    async updateAccountProfile({ userId, displayName }) { profiles.get(userId).displayName = displayName; return this.getAccountProfile(userId); },
    async setPresetAvatar({ userId, presetKey }) { profiles.get(userId).avatar = { kind: 'preset', presetKey }; return this.getAccountProfile(userId); },
    async revokeDeviceGrant({ userId, grantId }) { const g = grants.find(g => g.userId === userId && g.grantId === grantId && g.active); if (!g) return 0; g.active = false; return 1; },
  };
  const authService = createAuthService({ repository, otpHmacKey: settings.env.OTP_HMAC_KEY });
  const app = createApp({ config: loadConfig(settings.env), authService,
    requestGuard: (request, reply) => desktopBusinessTestGuard(request, reply, settings) });
  t.after(() => app.close());
  const call = (method, url, payload, token) => app.inject({ method, url, ...(payload === undefined ? {} : { payload }),
    ...(token ? { headers: { authorization: 'Bearer ' + token } } : {}) });
  return { app, profiles, tokens, ids, call };
}

test('shared HTTP routes require real bearer authentication and retain nickname/avatar validation', async t => {
  const { call, tokens, ids, profiles } = await accountControlApp(t);
  for (const token of [undefined, 'z'.repeat(43)]) for (const [method, url, body] of [
    ['PATCH', '/v1/me', { displayName: 'Changed' }], ['PATCH', '/v1/me/avatar', { presetKey: 'wizard' }],
    ['DELETE', '/v1/me/devices/' + ids[1]],
  ]) assert.equal((await call(method, url, body, token)).statusCode, 401);
  assert.equal(profiles.get('owner').displayName, 'Owner');
  for (const displayName of ['', '   ', 'x'.repeat(41)])
    assert.equal((await call('PATCH', '/v1/me', { displayName }, tokens[0])).statusCode, 400);
  assert.equal((await call('PATCH', '/v1/me/avatar', { presetKey: 'unknown' }, tokens[0])).statusCode, 400);
  const changed = await call('PATCH', '/v1/me', { displayName: '  Updated   Name  ' }, tokens[0]);
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().data.displayName, 'Updated Name');
  const avatar = await call('PATCH', '/v1/me/avatar', { presetKey: 'wizard' }, tokens[0]);
  assert.equal(avatar.statusCode, 200); assert.equal(avatar.json().data.avatar.presetKey, 'wizard');
  assert.equal((await call('GET', '/v1/me', undefined, tokens[1])).json().data.displayName, 'Updated Name');
  assert.equal(profiles.get('other').displayName, 'Other'); assert.equal(profiles.get('other').avatar.presetKey, 'fox');
  for (const url of ['/v1/me/avatar', '/v1/uploads', '/v1/research/topics', '/v1/admin/agents']) {
    const blocked = await call(url === '/v1/me/avatar' ? 'PUT' : 'POST', url, '{bad', tokens[0]);
    assert.equal(blocked.statusCode, 404); assert.equal(blocked.json().error.code, 'DESKTOP_BUSINESS_TEST_ROUTE_DISABLED');
  }
});

test('single-device revocation is scoped to the authenticated owner and invalidates only the target session', async t => {
  const { call, tokens, ids } = await accountControlApp(t);
  const foreign = await call('DELETE', '/v1/me/devices/' + ids[2], undefined, tokens[0]);
  assert.equal(foreign.statusCode, 404); assert.equal(foreign.json().error.code, 'DEVICE_NOT_FOUND');
  assert.equal((await call('GET', '/v1/me', undefined, tokens[2])).statusCode, 200);
  assert.equal((await call('DELETE', '/v1/me/devices/' + '-'.repeat(36), undefined, tokens[0])).statusCode, 400);
  const revoked = await call('DELETE', '/v1/me/devices/' + ids[1], undefined, tokens[0]);
  assert.equal(revoked.statusCode, 200); assert.equal(revoked.json().data.revokedCount, 1);
  assert.equal((await call('GET', '/v1/me', undefined, tokens[1])).statusCode, 401);
  assert.equal((await call('GET', '/v1/me', undefined, tokens[0])).statusCode, 200);
  assert.equal((await call('GET', '/v1/me', undefined, tokens[2])).statusCode, 200);
});
