const test = require('node:test');
const assert = require('node:assert/strict');

function browserTabs() {
  const channels = new Set(), updates = [];
  let lock = Promise.resolve();
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) {
      if (data.type === 'update') updates.push(structuredClone(data));
      for (const peer of channels) if (peer !== this && peer.name === this.name) {
        const copy = structuredClone(data);
        setImmediate(() => { if (channels.has(peer)) peer.onmessage?.({ data: copy }); });
      }
    }
    close() { channels.delete(this); }
  }
  return {
    updates,
    replay(data) { for (const channel of channels) channel.onmessage?.({ data: structuredClone(data) }); },
    window() {
      const values = new Map();
      return {
        BroadcastChannel: Channel,
        navigator: { locks: { request: (_name, options, callback) => {
          const result = lock.then(() => { if (options.signal?.aborted) throw options.signal.reason; return callback(); });
          lock = result.catch(() => {});
          return result;
        } } },
        sessionStorage: {
          getItem: key => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, String(value)),
          removeItem: key => values.delete(key),
        },
        get localStorage() { throw Error('Credentials must never use localStorage'); },
      };
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const tokens = { accessToken: 'access', refreshToken: 'refresh' };
async function account(t, window) {
  const { createBrowserHostAdapter } = await import('../../packages/host-contract/src/index.mjs');
  const host = createBrowserHostAdapter({ window });
  t.after(() => host.dispose());
  return host.account;
}

test('a separately opened tab inherits login before its first authenticated API request', async t => {
  const tabs = browserTabs(), firstWindow = tabs.window(), secondWindow = tabs.window();
  const first = await account(t, firstWindow);
  await first.setTokens(tokens);
  assert.equal(secondWindow.sessionStorage.getItem('gamehub.browser.credentials.v1'), null);
  const second = await account(t, secondWindow);
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const client = createApiClient({
    getAccessToken: () => second.getAccessToken(),
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer access');
      return Response.json({ data: { id: 'user' } });
    },
  });
  assert.equal((await client.getProfile()).data.id, 'user');
  assert.deepEqual(await second.getTokens(), tokens);
});

test('login, token rotation and logout propagate to already open tabs', async t => {
  const tabs = browserTabs();
  const first = await account(t, tabs.window()), second = await account(t, tabs.window());
  await Promise.all([first.getTokens(), second.getTokens()]);
  let changes = 0;
  const off = second.onTokensChanged(() => changes++);
  await first.setTokens(tokens); await tick();
  assert.deepEqual(await second.getTokens(), tokens);
  await first.setTokens({ accessToken: 'rotated', refreshToken: 'rotated-refresh' }); await tick();
  assert.equal(await second.getRefreshToken(), 'rotated-refresh');
  await first.clearTokens(); await tick();
  assert.equal(await second.getTokens(), null);
  assert.equal(changes, 3);
  off();
  assert.equal(await (await account(t, tabs.window())).getTokens(), null);
});

test('a delayed snapshot cannot restore login after logout', async t => {
  const tabs = browserTabs(), first = await account(t, tabs.window());
  await first.setTokens(tokens);
  const old = tabs.updates.at(-1);
  await first.clearTokens();
  tabs.replay(old);
  assert.equal(await first.getTokens(), null);
});

test('legacy tab credentials are shared and refresh redirects retain the latest state', async t => {
  const tabs = browserTabs(), window = tabs.window();
  window.sessionStorage.setItem('gamehub.browser.credentials.v1', JSON.stringify(tokens));
  const first = await account(t, window);
  assert.deepEqual(await first.getTokens(), tokens);
  const secondWindow = tabs.window(), second = await account(t, secondWindow);
  assert.deepEqual(await second.getTokens(), tokens);
  second.dispose();
  const restored = await account(t, secondWindow);
  assert.deepEqual(await restored.getTokens(), tokens);
});

test('closing all tabs leaves a newly opened tab anonymous', async t => {
  const tabs = browserTabs(), first = await account(t, tabs.window());
  await first.setTokens(tokens); first.dispose();
  const second = await account(t, tabs.window());
  assert.equal(await second.getTokens(), null);
});

test('blocked storage and unavailable channel retain a usable in-memory session', async t => {
  const window = {
    get sessionStorage() { throw Error('blocked'); },
    get BroadcastChannel() { throw Error('blocked'); },
  };
  const first = await account(t, window);
  await first.setTokens(tokens);
  assert.deepEqual(await first.getTokens(), tokens);
  await first.clearTokens();
  assert.equal(await first.getTokens(), null);
});

test('two tabs with concurrent 401s rotate a single-use refresh token only once', async t => {
  const tabs = browserTabs(), first = await account(t, tabs.window());
  await first.setTokens(tokens);
  const second = await account(t, tabs.window());
  await second.getTokens();
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let refreshCalls = 0;
  const client = host => createApiClient({
    getAccessToken: () => host.getAccessToken(),
    getRefreshToken: () => host.getRefreshToken(),
    setTokens: value => host.setTokens(value),
    withRefreshLock: (callback, signal) => host.withRefreshLock(callback, signal),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls++;
        assert.equal(JSON.parse(init.body).refreshToken, 'refresh');
        return Response.json({ data: { accessToken: 'fresh', refreshToken: 'rotated' } });
      }
      return init.headers.Authorization === 'Bearer fresh'
        ? Response.json({ data: { id: 'user' } })
        : Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
    },
  });
  const results = await Promise.all([client(first).getProfile(), client(second).getProfile()]);
  assert.equal(refreshCalls, 1);
  assert.equal(results[0].data.id, 'user');
  assert.equal(results[1].data.id, 'user');
});

test('an in-flight refresh cannot log a tab back in after logout', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let saved = tokens, releaseRefresh, started;
  const refreshing = new Promise(resolve => { started = resolve; });
  const client = createApiClient({
    getAccessToken: () => saved?.accessToken,
    getRefreshToken: () => saved?.refreshToken,
    setTokens: value => { saved = value; },
    fetchImpl: async url => {
      if (url.endsWith('/v1/auth/refresh')) {
        started();
        await new Promise(resolve => { releaseRefresh = resolve; });
        return Response.json({ data: { accessToken: 'fresh', refreshToken: 'rotated' } });
      }
      return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
    },
  });
  const response = client.getProfile();
  await refreshing; saved = null; releaseRefresh();
  await assert.rejects(response, error => error.status === 401);
  assert.equal(saved, null);
});

