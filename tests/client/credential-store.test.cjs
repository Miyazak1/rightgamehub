const test = require('node:test');
const assert = require('node:assert/strict');

test('GCM credential store uses an isolated protocol and round-trips validated tokens', async () => {
  const calls = []; let password = null;
  const run = async (action, input = '') => {
    calls.push({ action, input });
    if (action === 'version') return '2.7.0';
    if (action === 'store') { password = /^password=(.+)$/m.exec(input)?.[1] ?? null; return ''; }
    if (action === 'get') return password ? `protocol=https\nhost=credentials.gamehub.local\nusername=gamehub-session\npassword=${password}\n` : '';
    if (action === 'erase') { password = null; return ''; }
    throw new Error('unexpected action');
  };
  const { createGcmCredentialStore } = await import('../../extensions/harness/src/credential-store.mjs');
  const store = await createGcmCredentialStore({ run, platform: 'win32' });
  const tokens = { accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43), accessExpiresAt: '2026-09-29T00:00:00.000Z' };
  assert.equal(store.available, true);
  assert.equal(store.persistence.kind, 'os-keychain');
  assert.equal(await store.get(), null);
  await store.set(tokens);
  assert.deepEqual(await store.get(), tokens);
  assert.ok(calls.every(call => call.action === 'version' || /protocol=https\nhost=credentials\.gamehub\.local\nusername=gamehub-session/.test(call.input)));
  await store.clear();
  assert.equal(await store.get(), null);
  await assert.rejects(store.set({ accessToken: 'short', refreshToken: 'short' }), error => error.code === 'CREDENTIAL_PAYLOAD_INVALID');
});

test('GCM credential store reports an honest memory fallback when unavailable', async () => {
  const { createGcmCredentialStore } = await import('../../extensions/harness/src/credential-store.mjs');
  const store = await createGcmCredentialStore({ run: async () => { throw new Error('missing'); } });
  assert.equal(store.available, false);
  assert.equal(store.persistence.kind, 'memory');
  await assert.rejects(store.get(), error => error.code === 'CREDENTIAL_STORE_UNAVAILABLE');
});
