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
