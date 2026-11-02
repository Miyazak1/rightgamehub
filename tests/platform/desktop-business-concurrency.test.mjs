import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createDesktopBusinessApi } from '../../apps/desktop/renderer/business-api.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createBusinessApiFixture } from '../desktop/business-api-fixture.mjs';

const origin = 'http://127.0.0.1:32123';
const key = 'desktop-shell-account:' + createHash('sha256').update(origin).digest('hex');
const oldTokens = { accessToken: 'synthetic-old-access', refreshToken: 'synthetic-old-refresh' };
const freshTokens = { accessToken: 'synthetic-new-access', refreshToken: 'synthetic-new-refresh' };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
async function setup(fetchImpl, options = {}) {
  const vault = options.vault ?? createMemoryCredentialVault();
  await vault.store(key, JSON.stringify({ origin, tokens: oldTokens }));
  const session = await createDesktopAccountSession({ apiOrigin: origin, vault, fetchImpl, ...options });
  const api = createDesktopBusinessApi({ async call(method, args) {
    try { return { ok: true, value: await session.call(method, args) }; }
    catch (error) { return { ok: false, error: { code: error.code, status: error.status, message: error.message } }; }
  } }, origin);
  return { session, api, vault };
}
const data = value => Response.json({ data: value });

test('cancelled queued reads never reach HTTP and state is not blocked by a slow read', async () => {
  const started = gate(), release = gate(), calls = [];
  const { api, session } = await setup(async url => {
    const q = new URL(url).searchParams.get('q'); calls.push(q);
    if (q === 'first') { started.resolve(); await release.promise; }
    return data([]);
  }, { businessConcurrency: 1 });
  const first = api.listWorks({ q: 'first' }); await started.promise;
  const controller = new AbortController();
  const second = api.listWorks({ q: 'cancelled' }, { signal: controller.signal });
  const rejected = assert.rejects(second, { name: 'AbortError' }); controller.abort(); await rejected;
  assert.equal((await session.call('state')).authenticated, true);
  const third = api.listWorks({ q: 'latest' }); release.resolve(); await Promise.all([first, third]);
  assert.deepEqual(calls, ['first', 'latest']);
});

test('active read cancellation aborts its transport and frees the next request without waiting for a late response', async () => {
  const started = gate(), release = gate(); let signal;
  const { api } = await setup(async (url, options) => {
    if (new URL(url).searchParams.get('q') === 'old') { signal = options.signal; started.resolve(); await release.promise; }
    return data([]);
  }, { businessConcurrency: 1 });
  const controller = new AbortController();
  const old = api.listWorks({ q: 'old' }, { signal: controller.signal }); await started.promise;
  const rejected = assert.rejects(old, { name: 'AbortError' }); controller.abort(); await rejected; await tick();
  assert.equal(signal.aborted, true);
  assert.deepEqual((await api.listWorks({ q: 'new' })).data, []); release.resolve(); await tick();
});

test('queue deadline starts at enqueue time, not at the eventual HTTP start', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = gate(), release = gate(), calls = [];
  const { api } = await setup(async url => { calls.push(url); started.resolve(); await release.promise; return data([]); },
    { businessConcurrency: 1, businessTimeoutMs: 40 });
  const first = api.listWorks({ q: 'first' }); await started.promise;
  const second = api.listWorks({ q: 'queued' });
  const checks = [assert.rejects(first, { code: 'REQUEST_TIMEOUT' }), assert.rejects(second, { code: 'REQUEST_TIMEOUT' })];
  t.mock.timers.tick(40); await Promise.all(checks); assert.equal(calls.length, 1); release.resolve(); await tick();
});

test('logout clears state and encrypted record while business I/O remains blocked, and rejects queued work', async () => {
  const started = gate(), release = gate(); let readSignal, logoutStarted = false;
  const { session, api, vault } = await setup(async (url, options) => {
    if (url.endsWith('/v1/auth/device/logout')) { logoutStarted = true; return data({ loggedOut: true }); }
    readSignal = options.signal; started.resolve(); await release.promise; return data([]);
  }, { businessConcurrency: 1 });
  const first = api.listWorks(); await started.promise;
  const queued = api.listWorks({ q: 'queued' });
  const cancelled = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(queued, { name: 'AbortError' })]);
  const exit = session.call('logout'); assert.equal(session.state().authenticated, false);
  await exit; await cancelled;
  assert.equal(logoutStarted, true); assert.equal(readSignal.aborted, true); assert.equal(await vault.load(key), null);
  release.resolve(); await tick(); assert.equal(session.state().authenticated, false);
});

test('cancelling one private read does not cancel the single shared credential refresh for another read', async () => {
  const refreshing = gate(), release = gate(); let refreshCount = 0, refreshSignal;
  const { api, vault, session } = await setup(async (url, options) => {
    if (url.endsWith('/v1/auth/refresh')) { refreshCount++; refreshSignal = options.signal; refreshing.resolve(); await release.promise; return data(freshTokens); }
    if (options.headers.Authorization === 'Bearer ' + oldTokens.accessToken) return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
    return data([]);
  });
  const controller = new AbortController();
  const first = api.listLibrary({ signal: controller.signal }); const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = api.listLibrary(); await refreshing.promise; await tick();
  controller.abort(); await rejected; assert.equal(refreshSignal.aborted, false);
  release.resolve(); assert.deepEqual((await second).data, []);
  assert.equal(refreshCount, 1); assert.equal(session.state().authenticated, true);
  assert.equal(JSON.parse(await vault.load(key)).tokens.refreshToken, freshTokens.refreshToken);
});

test('logout wins over a late refresh even when a fake transport ignores abort', async () => {
  const refreshing = gate(), release = gate(); let refreshSignal;
  const { session, api, vault } = await setup(async (url, options) => {
    if (url.endsWith('/v1/auth/device/logout')) return data({ loggedOut: true });
    if (url.endsWith('/v1/auth/refresh')) { refreshSignal = options.signal; refreshing.resolve(); await release.promise; return data(freshTokens); }
    return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
  });
  const request = api.listLibrary(); const rejected = assert.rejects(request, { name: 'AbortError' }); await refreshing.promise;
  await session.call('logout'); await rejected; assert.equal(refreshSignal.aborted, true);
  release.resolve(); await tick(); assert.equal(session.state().authenticated, false); assert.equal(await vault.load(key), null);
  const restored = await createDesktopAccountSession({ apiOrigin: origin, vault }); assert.equal(restored.state().authenticated, false);
});

test('anonymous private reads do not interrupt remote revocation after local logout', async () => {
  const revoking = gate(), release = gate(); let revokeSignal;
  const { api, session } = await setup(async (url, options) => {
    if (url.endsWith('/v1/auth/device/logout')) { revokeSignal = options.signal; revoking.resolve(); await release.promise; return data({ loggedOut: true }); }
    return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
  });
  const exit = session.call('logout'); await revoking.promise;
  await assert.rejects(api.listLibrary(), { status: 401 }); assert.equal(revokeSignal.aborted, false);
  release.resolve(); await exit; assert.equal(session.state().authenticated, false);
});

test('logout fences an in-flight keychain write and a later login stores only its new credentials', async () => {
  const memory = createMemoryCredentialVault(), storing = gate(), release = gate(); let block = false;
  const vault = { ...memory, async store(k, value) { if (block) { block = false; storing.resolve(); await release.promise; } return memory.store(k, value); } };
  const loginTokens = { accessToken: 'synthetic-login-access', refreshToken: 'synthetic-login-refresh' };
  const { session, api } = await setup(async (url, options) => {
    if (url.endsWith('/v1/auth/device/logout')) return data({ loggedOut: true });
    if (url.endsWith('/v1/auth/refresh')) return data(freshTokens);
    if (url.endsWith('/v1/auth/email/verify')) return data(loginTokens);
    if (options.headers.Authorization === 'Bearer ' + oldTokens.accessToken) return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
    return data([]);
  }, { vault });
  block = true;
  const request = api.listLibrary(); const rejected = assert.rejects(request, { name: 'AbortError' }); await storing.promise;
  const exit = session.call('logout'); assert.equal(session.state().authenticated, false);
  const login = session.call('verifyChallenge', [{ challengeId: randomUUID(), code: '123456' }]);
  release.resolve(); await exit; await rejected; await login; await tick();
  assert.equal(session.state().authenticated, true);
  assert.deepEqual(JSON.parse(await memory.load(key)).tokens, loginTokens);
});

test('a late unauthorized response from an old session cannot clear a newer login', async () => {
  const reading = gate(), release = gate();
  const { session, api, vault } = await setup(async url => {
    if (url.includes('/v1/works/')) {
      const response = Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
      response.json = async () => { reading.resolve(); await release.promise; return { error: { code: 'AUTH_REQUIRED' } }; }; return response;
    }
    if (url.endsWith('/v1/auth/email/verify')) return data(freshTokens);
    return data({ loggedOut: true });
  });
  const old = api.getWork('old-work'); const rejected = assert.rejects(old, { name: 'AbortError' }); await reading.promise;
  await session.call('logout'); await rejected;
  await session.call('verifyChallenge', [{ challengeId: randomUUID(), code: '123456' }]);
  release.resolve(); await tick(); assert.equal(session.state().authenticated, true);
  assert.deepEqual(JSON.parse(await vault.load(key)).tokens, freshTokens);
});

test('new login does not join an old session refresh whose response body is still pending', async () => {
  const reading = gate(), release = gate(); let refreshes = 0;
  const finalTokens = { accessToken: 'synthetic-final-access', refreshToken: 'synthetic-final-refresh' };
  const { api, session, vault } = await setup(async (url, options) => {
    if (url.endsWith('/v1/auth/device/logout')) return data({ loggedOut: true });
    if (url.endsWith('/v1/auth/email/verify')) return data(freshTokens);
    if (url.endsWith('/v1/auth/refresh')) {
      refreshes++;
      if (refreshes === 1) { const response = data(oldTokens); response.json = async () => { reading.resolve(); await release.promise; return { data: oldTokens }; }; return response; }
      return data(finalTokens);
    }
    if (options.headers.Authorization !== 'Bearer ' + finalTokens.accessToken) return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
    return data([]);
  });
  const old = api.listLibrary(); const rejected = assert.rejects(old, { name: 'AbortError' }); await reading.promise;
  await session.call('logout'); await rejected;
  await session.call('verifyChallenge', [{ challengeId: randomUUID(), code: '123456' }]);
  assert.deepEqual((await api.listLibrary()).data, []); assert.equal(refreshes, 2);
  release.resolve(); await tick(); assert.equal(session.state().authenticated, true);
  assert.deepEqual(JSON.parse(await vault.load(key)).tokens, finalTokens);
});

test('a pending anonymous unauthorized response is retired when login starts', async () => {
  const reading = gate(), release = gate();
  const { session, api, vault } = await setup(async url => {
    if (url.endsWith('/v1/auth/email/verify')) return data(freshTokens);
    const response = Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
    response.json = async () => { reading.resolve(); await release.promise; return { error: { code: 'AUTH_REQUIRED' } }; }; return response;
  });
  await session.call('clear');
  const old = api.getWork('anonymous-work'); const rejected = assert.rejects(old, { name: 'AbortError' }); await reading.promise;
  await session.call('verifyChallenge', [{ challengeId: randomUUID(), code: '123456' }]); await rejected;
  release.resolve(); await tick(); assert.equal(session.state().authenticated, true);
  assert.deepEqual(JSON.parse(await vault.load(key)).tokens, freshTokens);
});

test('account bootstrap and parallel private business reads share refresh ordering', async t => {
  const backend = await createBusinessApiFixture(); t.after(() => backend.close());
  const session = await createDesktopAccountSession({ apiOrigin: backend.origin, vault: createMemoryCredentialVault() });
  const challenge = await session.call('createChallenge', [{ email: 'desktop@example.test' }]);
  await session.call('verifyChallenge', [{ challengeId: challenge.data.challengeId, code: backend.code() }]);
  backend.expireAccess();
  const [bootstrap, ...reads] = await Promise.all([session.call('bootstrapSession'),
    ...Array.from({ length: 4 }, () => session.call('business', [{ method: 'listLibrary', args: [{}] }]))]);
  assert.equal(bootstrap.data.authenticated, true); assert.ok(reads.every(read => Array.isArray(read.data)));
  assert.equal(backend.refreshCount, 1); assert.equal(session.state().authenticated, true);
});

test('pending work is bounded and duplicate IDs or cancelled queued items cannot issue extra HTTP', async () => {
  const started = gate(), release = gate(); let calls = 0;
  const { session } = await setup(async () => { calls++; started.resolve(); await release.promise; return data([]); }, { businessConcurrency: 1 });
  const ids = Array.from({ length: 32 }, () => randomUUID());
  const requests = ids.map(requestId => session.call('business', [{ method: 'listWorks', args: [{}], requestId }]));
  const outcomes = Promise.allSettled(requests); await started.promise;
  await assert.rejects(session.call('business', [{ method: 'listWorks', args: [{}], requestId: ids[0] }]), { code: 'DESKTOP_BUSINESS_REQUEST_INVALID' });
  await assert.rejects(session.call('business', [{ method: 'listWorks', args: [{}], requestId: randomUUID() }]), { code: 'DESKTOP_BUSINESS_BUSY' });
  await session.call('clear'); assert.equal((await outcomes).every(r => r.status === 'rejected'), true);
  assert.equal(calls, 1); release.resolve(); await tick();
});
