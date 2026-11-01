import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAccountSession, localAccountOrigin } from '../../apps/desktop/src/account-session.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createIsolatedAccountApi } from '../desktop/account-api-fixture.mjs';

async function setup(t) {
  const backend = await createIsolatedAccountApi(); t.after(() => backend.close());
  const vault = createMemoryCredentialVault();
  const make = () => createDesktopAccountSession({ apiOrigin: backend.origin, vault });
  const session = await make();
  const login = async () => { const c = await session.call('createChallenge', [{ email: 'desktop@example.test' }]); return session.call('verifyChallenge', [{ challengeId: c.data.challengeId, code: backend.code() }]); };
  return { backend, vault, session, make, login };
}
test('desktop account transport refuses remote origins and URL injection', () => {
  for (const value of ['https://mooyu.fun', 'http://example.test', 'http://127.0.0.1:123/api', 'http://u:p@localhost:123', 'http://localhost:123/?token=x']) assert.throws(() => localAccountOrigin(value));
  assert.equal(localAccountOrigin('http://127.0.0.1:123/'), 'http://127.0.0.1:123');
});
test('shared email API logs in without exposing bearer tokens and restores with the same vault', async t => {
  const { session, make, login, backend } = await setup(t);
  assert.equal((await session.call('bootstrapSession')).data.authenticated, false);
  const result = await login(); assert.ok(result.data.desktopSessionId); assert.equal(result.data.accessToken, undefined);
  assert.equal((await session.call('getProfile')).data.displayName, '桌面隔离测试用户');
  assert.equal((await session.call('listDevices')).data[0].clientKind, 'browser');
  const restored = await make(); assert.equal((await restored.call('bootstrapSession')).data.authenticated, true);
  assert.ok(backend.calls.some(c => c.path==='/v1/auth/session'));
});
test('expired access rotates refresh tokens and revoked sessions are cleared', async t => {
  const { session, backend, login, make } = await setup(t); await login(); backend.expireAccess();
  await Promise.all([session.call('getProfile'), session.call('getProfile')]); assert.equal(backend.refreshCount, 1);
  const restored = await make(); backend.expireAccess();
  assert.equal((await restored.call('bootstrapSession')).data.authenticated, true); assert.equal(backend.refreshCount, 2);
  backend.revoke(); const expired = await make();
  assert.equal((await expired.call('bootstrapSession')).data.authenticated, false); assert.equal(expired.state().authenticated, false);
});
test('wrong OTP is rejected; unsupported operations and arbitrary URLs never reach HTTP', async t => {
  const { session, backend } = await setup(t);
  const c = await session.call('createChallenge', [{ email: 'desktop@example.test' }]);
  await assert.rejects(session.call('verifyChallenge', [{ challengeId: c.data.challengeId, code: backend.code()==='000000' ? '111111' : '000000' }]), { status: 401 });
  const count = backend.calls.length;
  for (const name of ['fetch', 'https://example.test', 'publishBlogArticle', '__proto__']) await assert.rejects(session.call(name));
  assert.equal(backend.calls.length, count);
});
test('network failure preserves saved credentials; offline logout clears and stale login cannot resurrect', async t => {
  const { session, backend, login, make } = await setup(t); const result = await login(); backend.offline(true);
  await assert.rejects(session.call('bootstrapSession')); assert.equal(session.state().authenticated, true);
  await assert.rejects(session.call('logout')); assert.equal(session.state().authenticated, false);
  backend.offline(false); assert.equal((await make()).state().authenticated, false);
  await assert.rejects(session.call('accept', [result.data]), { code: 'DESKTOP_ACCOUNT_SESSION_CHANGED' });
});
test('origin-bound persistence and redirect rejection prevent moving credentials to another API', async t => {
  const { session, backend, vault, login } = await setup(t); await login();
  const other = await createIsolatedAccountApi(); t.after(() => other.close());
  const separate = await createDesktopAccountSession({ apiOrigin: other.origin, vault }); assert.equal(separate.state().authenticated, false);
  backend.redirectNext(); await assert.rejects(session.call('getProfile')); assert.equal(session.state().authenticated, true);
});
test('queued logout wins over concurrent session bootstrap and login marker acceptance', async t => {
  const { session, backend, login, make } = await setup(t); const result = await login(); backend.expireAccess();
  const boot = session.call('bootstrapSession'), logout = session.call('logout');
  await Promise.all([boot, logout]); assert.equal(session.state().authenticated, false);
  await assert.rejects(session.call('accept', [result.data])); assert.equal((await make()).state().authenticated, false);
});
test('unreadable encrypted records fail closed while leaving the login screen usable', async t => {
  const { backend } = await setup(t);
  const session = await createDesktopAccountSession({ apiOrigin: backend.origin, vault: { async load() { throw Error('unreadable vault'); }, async store() {}, async remove() {} } });
  assert.equal(session.state().authenticated, false); assert.equal(session.state().errorCode, 'DESKTOP_ACCOUNT_VAULT_UNAVAILABLE');
  assert.equal((await session.call('bootstrapSession')).data.authenticated, false);
});
