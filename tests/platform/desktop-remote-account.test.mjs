import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { accountOrigin, desktopAccountLaunchOptions, isolatedAccountProfile, bindIsolatedAccountProfile, prepareDesktopAccountProfile } from '../../apps/desktop/src/account-configuration.mjs';
import { createDesktopAccountSession, validateGitHubAuthorizeUrl } from '../../apps/desktop/src/account-session.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createHttpsAccountFixture, fetchWithTestCA, testCertificate } from '../desktop/https-account-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
async function setup(t) {
  const fixture = await createHttpsAccountFixture(); t.after(() => fixture.close());
  const vault = createMemoryCredentialVault();
  const make = (extra = {}) => createDesktopAccountSession({ apiOrigin: fixture.origin, environment: 'isolated-test', vault, fetchImpl: fetchWithTestCA, ...extra });
  const session = await make();
  const login = async () => {
    const c = await session.call('createChallenge', [{ email: 'https@example.test' }]);
    return session.call('verifyChallenge', [{ challengeId: c.data.challengeId, code: fixture.backend.code() }]);
  };
  return { fixture, vault, make, session, login };
}

test('HTTPS requires explicit test mode; production, plaintext, credentials, query and paths are refused offline', () => {
  assert.equal(accountOrigin('https://desktop-test.mooyu.fun', 'isolated-test'), 'https://desktop-test.mooyu.fun');
  for (const value of ['https://mooyu.fun', 'https://www.mooyu.fun.', 'http://desktop-test.mooyu.fun',
    'https://u:p@example.test', 'https://example.test/api', 'https://example.test/?key=secret', 'https://example.test/#x']) {
    assert.throws(() => accountOrigin(value, 'isolated-test'));
  }
  assert.throws(() => accountOrigin('https://desktop-test.mooyu.fun'));
  assert.throws(() => accountOrigin(null, 'production'));
  assert.throws(() => desktopAccountLaunchOptions(['--account-api', 'https://desktop-test.mooyu.fun'], root));
  for (const args of [ ['--test-account-api'], ['--test-account-api', 'https://a.test', '--account-api', 'http://127.0.0.1:3'],
    ['--test-account-api', 'https://a.test', '--test-account-api', 'https://b.test'] ]) assert.throws(() => desktopAccountLaunchOptions(args, root));
});

test('launch profiles are stable per origin, distinct per server, and cannot be retargeted or downgraded', async t => {
  const parent = path.join(root, '.runtime', 'desktop-remote-tests'); await mkdir(parent, { recursive: true });
  const base = await mkdtemp(path.join(parent, 'profile-')); assert.ok(base.startsWith(parent + path.sep));
  t.after(() => rm(base, { recursive: true, force: true }));
  const a = desktopAccountLaunchOptions(['--test-account-api', 'https://a.test', '--profile-root', base], root);
  const b = desktopAccountLaunchOptions(['--test-account-api', 'https://b.test', '--profile-root', base], root);
  assert.notEqual(a.profileRoot, b.profileRoot); assert.notEqual(a.profileRoot, base);
  assert.equal(a.profileRoot, isolatedAccountProfile(base, 'https://a.test/'));
  await bindIsolatedAccountProfile(a.profileRoot, a.accountApiOrigin);
  await bindIsolatedAccountProfile(a.profileRoot, a.accountApiOrigin);
  await assert.rejects(bindIsolatedAccountProfile(a.profileRoot, b.accountApiOrigin), { code: 'DESKTOP_PROFILE_SERVER_MISMATCH' });
  await assert.rejects(prepareDesktopAccountProfile(a.profileRoot, 'http://127.0.0.1:3', 'local-test'), { code: 'DESKTOP_PROFILE_SERVER_MISMATCH' });
  const populated = path.join(base, 'old-profile'); await mkdir(populated); await writeFile(path.join(populated, 'Cookies'), 'old');
  await assert.rejects(bindIsolatedAccountProfile(populated, a.accountApiOrigin), { code: 'DESKTOP_PROFILE_NOT_ISOLATED' });
  const config = JSON.parse(await readFile(path.join(a.profileRoot, 'account-server.json'), 'utf8'));
  assert.equal(config.origin, 'https://a.test');
});

test('real loopback HTTPS supports shared login, refresh, restore and logout without returning bearer tokens', async t => {
  const { fixture, session, make, login } = await setup(t);
  assert.equal((await session.call('bootstrapSession')).data.authenticated, false);
  const result = await login(); assert.ok(result.data.desktopSessionId); assert.equal(result.data.accessToken, undefined);
  assert.deepEqual(fixture.requests[0], { method: 'GET', path: '/ready-desktop-auth', authenticated: false });
  fixture.backend.expireAccess();
  const restored = await make(); assert.equal((await restored.call('bootstrapSession')).data.authenticated, true);
  assert.equal(fixture.backend.refreshCount, 1);
  await restored.call('logout'); assert.equal((await make()).state().authenticated, false);
});

test('wrong instance, unready database or HTTP failure sends neither saved bearer nor refresh token', async t => {
  const { fixture, make, login } = await setup(t); await login();
  for (const flag of ['wrongInstance', 'notReady', 'unhealthy']) {
    fixture[flag](true); const before = fixture.requests.length;
    const session = await make();
    await assert.rejects(session.call('bootstrapSession'), { code: 'DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED' });
    assert.deepEqual(fixture.requests.slice(before), [{ method: 'GET', path: '/ready-desktop-auth', authenticated: false }]);
    assert.equal(session.state().authenticated, true); fixture[flag](false);
  }
});

test('standard TLS rejects untrusted certificate and TLS bypass is refused', async t => {
  const { fixture, vault } = await setup(t);
  const session = await createDesktopAccountSession({ apiOrigin: fixture.origin, environment: 'isolated-test', vault });
  await assert.rejects(session.call('createChallenge', [{ email: 'tls@example.test' }]));
  await assert.rejects(new Promise((resolve, reject) => {
    const request = https.get(fixture.origin, { ca: testCertificate, servername: 'wrong.test', rejectUnauthorized: true }, resolve);
    request.on('error', reject);
  }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  assert.equal(fixture.requests.length, 0);
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    await assert.rejects(createDesktopAccountSession({ apiOrigin: fixture.origin, environment: 'isolated-test', vault }), { code: 'DESKTOP_ACCOUNT_TLS_REQUIRED' });
  } finally { if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous; }
});

test('HTTPS offline restoration preserves credentials while offline logout removes them', async t => {
  const { fixture, make, login } = await setup(t); await login(); fixture.offline();
  const restored = await make();
  await assert.rejects(restored.call('bootstrapSession'));
  assert.equal(restored.state().authenticated, true);
  await assert.rejects(restored.call('logout'));
  assert.equal(restored.state().authenticated, false);
  assert.equal((await make()).state().authenticated, false);
});

test('HTTPS server revocation clears the encrypted session instead of restoring stale credentials', async t => {
  const { fixture, session, make, login } = await setup(t); await login(); fixture.backend.revoke();
  await assert.rejects(session.call('getProfile'), { status: 401 });
  assert.equal(session.state().authenticated, false);
  assert.equal((await make()).state().authenticated, false);
});

test('redirects never leave the selected server and another HTTPS origin cannot inherit saved credentials', async t => {
  const { fixture, session, vault, login } = await setup(t); await login(); fixture.redirectNext();
  await assert.rejects(session.call('getProfile'), { code: 'DESKTOP_ACCOUNT_REDIRECT_DENIED' });
  const other = await createHttpsAccountFixture(); t.after(() => other.close());
  const second = await createDesktopAccountSession({ apiOrigin: other.origin, environment: 'isolated-test', vault, fetchImpl: fetchWithTestCA });
  assert.equal(second.state().authenticated, false); assert.equal(other.requests.length, 0);
});

test('remote OAuth opens only GitHub with this server callback and retains cancellation/accept handshake', async t => {
  const { fixture, make } = await setup(t); const opened = [];
  const session = await make({ openExternal: async url => opened.push(url) });
  const a = (await session.call('startGitHubWeb')).data;
  assert.equal(new URL(a.authorizeUrl).searchParams.get('redirect_uri'), fixture.origin + '/v1/auth/github/web/callback');
  const wrong = new URL(a.authorizeUrl); wrong.searchParams.set('redirect_uri', 'https://mooyu.fun/v1/auth/github/web/callback');
  assert.throws(() => validateGitHubAuthorizeUrl(wrong.href, a.challengeId, fixture.origin));
  const mock = new URL(a.authorizeUrl); mock.host = new URL(fixture.origin).host; mock.pathname = '/__github/authorize';
  assert.throws(() => validateGitHubAuthorizeUrl(mock.href, a.challengeId, fixture.origin));
  await session.call('openGitHub', [a.authorizeUrl]); assert.equal(opened.length, 1);
  await fixture.backend.decide(a.authorizeUrl);
  const polled = await session.call('pollGitHubWeb', [a.challengeId]);
  assert.equal(polled.data.tokens.accessToken, undefined); assert.equal(session.state().authenticated, false);
  await session.call('accept', [polled.data.tokens]); assert.equal(session.state().authenticated, true);
  await session.call('logout');
  const cancelled = (await session.call('startGitHubWeb')).data; await session.call('cancelGitHub');
  await fixture.backend.decide(cancelled.authorizeUrl);
  await assert.rejects(session.call('pollGitHubWeb', [cancelled.challengeId]), { code: 'DESKTOP_GITHUB_CANCELLED' });
});
