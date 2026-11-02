import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createDesktopBusinessApi } from '../../apps/desktop/renderer/business-api.mjs';
import { businessArguments, desktopMediaUrl } from '../../apps/desktop/src/business-contract.mjs';
import { apiLoadError } from '../../packages/platform-client/src/api-load-error.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createBusinessApiFixture } from '../desktop/business-api-fixture.mjs';

async function setup(t) {
  const backend = await createBusinessApiFixture(); t.after(() => backend.close());
  const session = await createDesktopAccountSession({ apiOrigin: backend.origin, vault: createMemoryCredentialVault() });
  const bridge = { async call(method, args) {
    try { return { ok: true, value: await session.call(method, args) }; }
    catch (e) { return { ok: false, error: { code: e.code, status: e.status, message: e.message } }; }
  } };
  const api = createDesktopBusinessApi(bridge, backend.origin);
  const login = async () => {
    const c = await session.call('createChallenge', [{ email: 'business@example.test' }]);
    await session.call('verifyChallenge', [{ challengeId: c.data.challengeId, code: backend.code() }]);
  };
  return { backend, session, api, login };
}

test('product API methods return server catalog, filters, journal, courseware and public profile without fixture fallback', async t => {
  const { api, backend } = await setup(t);
  const works = await api.listWorks({ q: '隔离', kind: 'game', limit: 24, offset: 24 });
  assert.equal(works.data[0].id, 'local-server-game');
  assert.ok(works.data.every(w => w.id !== 'desktop-fixture-game'));
  assert.match(works.data[0].coverUrl, /^mooyu-app:\/\/client\/__desktop-media/);
  assert.deepEqual(backend.businessCalls[0].query, { limit: '24', kind: 'game', q: '隔离', offset: '24' });
  assert.equal((await api.listWorks({ kind: 'courseware', limit: 50 })).data[0].kind, 'courseware');
  assert.equal((await api.listBlogArticles()).data.items[0].slug, 'local-article');
  assert.equal((await api.getBlogArticle('local-article')).data.blocks[1].text, '这段正文来自独立的本地 API。');
  assert.equal((await api.getPublicUserProfile('local-author')).data.displayName, '本地测试作者');
  backend.empty(true);
  assert.deepEqual((await api.listWorks()).data, []);
  assert.deepEqual((await api.listBlogArticles()).data.items, []);
});

test('renderer reads a selected leaderboard through the origin-bound product client', async () => {
  const origin = 'http://127.0.0.1:39190', calls = [];
  const session = await createDesktopAccountSession({ apiOrigin: origin, vault: createMemoryCredentialVault(),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json({ data: { entries: [], total: 0 } }); } });
  const api = createDesktopBusinessApi({ async call(method, args) { return { ok: true, value: await session.call(method, args) }; } }, origin);
  assert.equal((await api.readCompetitionLeaderboard('gamehub-guess-baike', 'daily', { date: '2026-11-01', limit: 10, offset: 0 })).data.total, 0);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, origin); assert.equal(url.pathname, '/v1/works/gamehub-guess-baike/leaderboards/daily');
  assert.equal(url.searchParams.get('date'), '2026-11-01'); assert.equal(calls[0].options.redirect, 'error');
  assert.throws(() => businessArguments('readCompetitionLeaderboard', ['work', '../me', {}]));
  assert.throws(() => businessArguments('readCompetitionLeaderboard', ['work', 'daily', { headers: {} }]));
});

test('library uses the managed account, survives refresh, and refuses private reads after logout', async t => {
  const { api, backend, session, login } = await setup(t);
  await assert.rejects(api.listLibrary(), { status: 401 });
  await login();
  await api.saveToLibrary('local-server-game');
  backend.expireAccess();
  const library = await api.listLibrary({ limit: 3, recent: true });
  assert.equal(library.data[0].workId, 'local-server-game');
  assert.equal(backend.refreshCount, 1);
  assert.equal((await api.getLibraryState('local-server-game')).data.saved, true);
  await api.removeFromLibrary('local-server-game');
  assert.deepEqual((await api.listLibrary()).data, []);
  await session.call('logout');
  await assert.rejects(api.listLibrary(), { status: 401 });
});

test('account-only API stays explicit; no empty-success or local sample substitutes', async t => {
  const { api, backend } = await setup(t); backend.accountOnly(true);
  for (const call of [() => api.listWorks(), () => api.listBlogArticles(), () => api.getPublicUserProfile('local-author')]) {
    await assert.rejects(call(), e => {
      assert.equal(e.code, 'DESKTOP_BUSINESS_ACCOUNT_ONLY');
      assert.equal(e.status, 503);
      assert.match(apiLoadError(e, '检查网络'), /仅开放账号接口/);
      assert.notEqual(apiLoadError(e, '检查网络'), '检查网络'); return true;
    });
  }
});

test('renderer cannot turn business bridge into publishing, arbitrary headers or arbitrary HTTP', async t => {
  const { session, api, backend } = await setup(t);
  for (const method of ['publishBlogArticle', '__proto__', 'fetch', 'getProfile'])
    await assert.rejects(session.call('business', [{ method, args: [] }]));
  for (const query of [{ headers: { Authorization: 'injected' } }, { limit: -1 }, { q: 'x'.repeat(301) }])
    assert.throws(() => businessArguments('listWorks', [query]));
  await assert.rejects(api.publishBlogArticle('article'), { code: 'DESKTOP_BUSINESS_OPERATION_UNAVAILABLE' });
  assert.equal(backend.businessCalls.length, 0);
});

test('images proxy only fixed same-origin raster endpoints; rejects redirects, HTML and traversal', async t => {
  const { session, api, backend } = await setup(t);
  const response = await session.media('/v1/works/local-server-game/cover?v=1');
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.ok((await response.arrayBuffer()).byteLength > 0);
  assert.match(api.avatarUrl({ url: '/v1/avatars/31e033b2-13d6-4b81-b214-21b3f25dca60?v=1' }), /__desktop-media/);
  for (const url of ['https://mooyu.fun/v1/works/x/cover', '//mooyu.fun/v1/works/x/cover', '/v1/me', '/v1/works/x/cover?token=bad', '/v1/works/../me/cover']) {
    assert.equal(desktopMediaUrl(url, backend.origin), null);
    await assert.rejects(session.media(url), { code: 'DESKTOP_MEDIA_DENIED' });
  }
  backend.failMedia(true);
  await assert.rejects(session.media('/v1/works/local-server-game/cover'), { code: 'DESKTOP_MEDIA_UNAVAILABLE' });
  backend.redirectNext();
  await assert.rejects(session.media('/v1/works/local-server-game/cover'));
});

test('page cancellation strips AbortSignal from IPC and stops awaiting old responses', async () => {
  const submitted = [];
  const api = createDesktopBusinessApi({ call(method, args) { submitted.push({ method, args }); return new Promise(() => {}); } }, 'http://127.0.0.1:1234');
  const controller = new AbortController();
  const result = api.listLibrary({ limit: 3, signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  const id = submitted[0].args[0].requestId;
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(submitted, [
    { method: 'business', args: [{ method: 'listLibrary', args: [{ limit: 3 }], requestId: id }] },
    { method: 'cancelBusiness', args: [id] },
  ]);
});
