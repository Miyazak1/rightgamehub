const test = require('node:test');
const assert = require('node:assert/strict');

test('account bootstrap stays offline for an anonymous browser session', async () => {
  const { bootstrapAccountSession } = await import('../../packages/platform-client/src/account-bootstrap.mjs');
  let calls = 0;
  const result = await bootstrapAccountSession({
    api: { bootstrapSession: async () => { calls += 1; } },
    account: { getAccessToken: async () => null },
  });
  assert.deepEqual(result, { status: 'anonymous', profile: null });
  assert.equal(calls, 0);
});

test('account bootstrap rotates an expired access token without a rejected profile request', async () => {
  const { bootstrapAccountSession } = await import('../../packages/platform-client/src/account-bootstrap.mjs');
  const saved = [], profile = { id: 'user', displayName: '墨鱼玩家' };
  let lockEntries = 0;
  const result = await bootstrapAccountSession({
    api: { bootstrapSession: async refreshToken => {
      assert.equal(refreshToken, 'refresh-token');
      return { data: { authenticated: true, profile, tokens: { accessToken: 'fresh', refreshToken: 'rotated' } } };
    } },
    account: {
      getAccessToken: async () => 'expired', getRefreshToken: async () => 'refresh-token',
      setTokens: async tokens => saved.push(tokens), clearTokens: async () => assert.fail('valid refresh must not clear the session'),
      withRefreshLock: async callback => { lockEntries += 1; return callback(); },
    },
  });
  assert.deepEqual(result, { status: 'ready', profile });
  assert.deepEqual(saved, [{ accessToken: 'fresh', refreshToken: 'rotated' }]);
  assert.equal(lockEntries, 1);
});

test('account bootstrap recovers when only a refresh token survived', async () => {
  const { bootstrapAccountSession } = await import('../../packages/platform-client/src/account-bootstrap.mjs');
  const saved = [], profile = { id: 'user-2', displayName: '墨鱼玩家' };
  const result = await bootstrapAccountSession({
    api: { bootstrapSession: async refreshToken => {
      assert.equal(refreshToken, 'surviving-refresh-token');
      return { data: { authenticated: true, profile, tokens: { accessToken: 'fresh', refreshToken: 'rotated' } } };
    } },
    account: {
      getAccessToken: async () => null, getRefreshToken: async () => 'surviving-refresh-token',
      setTokens: async tokens => saved.push(tokens),
    },
  });
  assert.deepEqual(result, { status: 'ready', profile });
  assert.deepEqual(saved, [{ accessToken: 'fresh', refreshToken: 'rotated' }]);
});

test('account bootstrap clears credentials when the server resolves them as anonymous', async () => {
  const { bootstrapAccountSession } = await import('../../packages/platform-client/src/account-bootstrap.mjs');
  let cleared = 0;
  const result = await bootstrapAccountSession({
    api: { bootstrapSession: async () => ({ data: { authenticated: false, profile: null, tokens: null } }) },
    account: {
      getAccessToken: async () => 'stale', getRefreshToken: async () => 'stale-refresh',
      clearTokens: async () => { cleared += 1; },
    },
  });
  assert.deepEqual(result, { status: 'anonymous', profile: null });
  assert.equal(cleared, 1);
});
