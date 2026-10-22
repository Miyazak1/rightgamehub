const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const routesUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/blog-routes.mjs'));
const Fastify = require('../../apps/api/node_modules/fastify');
const actor = { userId: crypto.randomUUID(), scopes: ['works:write'], profile: { role: 'admin', canPublish: true } };
const articleId = crypto.randomUUID();

test('blog routes keep public reads cacheable and mutations authenticated with concurrency headers', async t => {
  const { registerBlogRoutes } = await import(routesUrl);
  const calls = [];
  const article = { id: articleId, slug: 'platform-architecture', version: '2', contentHash: 'a'.repeat(64) };
  const service = {
    listPublic: async query => (calls.push(['listPublic', query]), { items: [], nextCursor: null }),
    getPublic: async slug => (calls.push(['getPublic', slug]), article),
    listMine: async (viewer, query) => (calls.push(['listMine', viewer, query]), { items: [], nextCursor: null }),
    getMine: async (viewer, id) => (calls.push(['getMine', viewer, id]), { article, etag: `"article-${id}-2"` }),
    createDraft: async (viewer, body, key) => (calls.push(['create', viewer, body, key]), { article, etag: `"article-${articleId}-1"` }),
    reviseDraft: async (viewer, id, body, key, etag) => (calls.push(['revise', viewer, id, body, key, etag]), { article, etag: `"article-${id}-2"` }),
    publish: async (viewer, id, key, etag) => (calls.push(['publish', viewer, id, key, etag]), { article, etag: `"article-${id}-3"` }),
    withdraw: async (viewer, id, key, etag) => (calls.push(['withdraw', viewer, id, key, etag]), { article, etag: `"article-${id}-4"` }),
    importResearchDraft: async (viewer, body, key) => (calls.push(['import', viewer, body, key]), { article, etag: `"article-${articleId}-1"` }),
  };
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  registerBlogRoutes(app, { service, requireAuth: async request => {
    if (!request.headers.authorization) return request.server.httpErrors?.unauthorized?.() ?? Promise.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }));
    request.actor = actor;
  } });
  t.after(() => app.close());

  const publicList = await app.inject({ url: '/v1/blog/articles?locale=zh-CN' });
  assert.equal(publicList.statusCode, 200);
  assert.match(publicList.headers['cache-control'], /^public/u);
  const publicArticle = await app.inject({ url: '/v1/blog/articles/platform-architecture' });
  assert.equal(publicArticle.headers.etag, `"blog-${'a'.repeat(64)}"`);
  const denied = await app.inject({ url: '/v1/me/blog/articles' });
  assert.equal(denied.statusCode, 401);
  const published = await app.inject({ method: 'POST', url: `/v1/me/blog/articles/${articleId}/publish`, headers: { authorization: 'Bearer valid', 'idempotency-key': 'blog-publish-test-0001', 'if-match': `"article-${articleId}-2"` } });
  assert.equal(published.statusCode, 200);
  assert.equal(published.headers.etag, `"article-${articleId}-3"`);
  assert.deepEqual(calls.at(-1).slice(0, 2), ['publish', actor]);
  assert.equal(calls.at(-1)[4], `"article-${articleId}-2"`);
});

test('published blog route renders escaped standalone HTML with structured metadata', async t => {
  const { registerBlogRoutes } = await import(routesUrl);
  const article = {
    id: crypto.randomUUID(), slug: 'safe-article', locale: 'zh-CN', title: '安全的文章', summary: '这是一段足够完整的公开文章摘要，用于验证服务端渲染。',
    blocks: [{ type: 'paragraph', text: '<script>alert(1)</script>' }], citations: [], contentHash: 'b'.repeat(64),
    revisionId: crypto.randomUUID(), author: { id: crypto.randomUUID(), displayName: '墨鱼工坊', handle: null },
    publishedAt: '2026-10-22T00:00:00.000Z', firstPublishedAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z',
  };
  const app = Fastify();
  registerBlogRoutes(app, { service: { getPublic: async () => article }, requireAuth: async () => {}, siteOrigin: 'https://mooyu.fun' });
  t.after(() => app.close());
  const response = await app.inject({ url: '/blog/safe-article' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.etag, `"blog-${article.contentHash}"`);
  assert.match(response.headers['content-security-policy'], /script-src 'nonce-/u);
  assert.match(response.body, /application\/ld\+json/u);
  assert.match(response.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(response.body, /<script>alert\(1\)<\/script>/u);
  const cached = await app.inject({ url: '/blog/safe-article', headers: { 'if-none-match': response.headers.etag } });
  assert.equal(cached.statusCode, 304);
});

test('blog API client sends article ETags and idempotency keys for explicit publication', async () => {
  const { createApiClient } = await import(pathToFileURL(path.resolve(__dirname, '../../packages/platform-api-client/src/index.mjs')));
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'admin-token', fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { id: articleId, version: '4' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.publishBlogArticle(articleId, '3');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['If-Match'], `"article-${articleId}-3"`);
  assert.match(requests[0].init.headers['Idempotency-Key'], /\S/u);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer admin-token');
});
