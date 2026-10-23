import crypto from 'node:crypto';
import { renderBlogArticleHtml } from './blog-seo.mjs';

const citationSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'label', 'title', 'url', 'publisher', 'publishedAt', 'accessedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    label: { type: 'string', minLength: 1, maxLength: 180 },
    title: { type: 'string', minLength: 1, maxLength: 300 },
    url: { type: 'string', minLength: 8, maxLength: 2048 },
    publisher: { type: 'string', minLength: 1, maxLength: 160 },
    publishedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    accessedAt: { type: 'string', format: 'date-time' },
  },
};
const blockSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['type', 'text'], properties: { type: { const: 'paragraph' }, text: { type: 'string', minLength: 1, maxLength: 8000 } } },
    { type: 'object', additionalProperties: false, required: ['type', 'level', 'text'], properties: { type: { const: 'heading' }, level: { type: 'integer', enum: [2, 3] }, text: { type: 'string', minLength: 1, maxLength: 180 } } },
    { type: 'object', additionalProperties: false, required: ['type', 'text', 'citationIds'], properties: { type: { const: 'quote' }, text: { type: 'string', minLength: 1, maxLength: 3000 }, citationIds: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', format: 'uuid' } } } },
    { type: 'object', additionalProperties: false, required: ['type', 'ordered', 'items'], properties: { type: { const: 'list' }, ordered: { type: 'boolean' }, items: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 1000 } } } },
    { type: 'object', additionalProperties: false, required: ['type', 'language', 'text'], properties: { type: { const: 'code' }, language: { type: 'string', pattern: '^[a-zA-Z0-9+#._-]{1,32}$' }, text: { type: 'string', minLength: 1, maxLength: 24000 } } },
  ],
};
const contentSchema = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'locale', 'title', 'summary', 'blocks', 'citations'],
  properties: {
    slug: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$' },
    locale: { type: 'string', enum: ['zh-CN', 'en'] },
    title: { type: 'string', minLength: 2, maxLength: 120 },
    summary: { type: 'string', minLength: 20, maxLength: 360 },
    blocks: { type: 'array', minItems: 1, maxItems: 96, items: blockSchema },
    citations: { type: 'array', maxItems: 80, items: citationSchema },
  },
};
const articleParams = { type: 'object', additionalProperties: false, required: ['articleId'], properties: { articleId: { type: 'string', format: 'uuid' } } };
const slugParams = { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$' } } };
const cursorProperty = { type: 'string', maxLength: 800 };
const publicListQuery = { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: cursorProperty, locale: { type: 'string', enum: ['zh-CN', 'en'] }, q: { type: 'string', maxLength: 100 } } };
const manageListQuery = { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: cursorProperty } };

export function registerBlogRoutes(app, { service, requireAuth, siteOrigin = 'https://mooyu.fun' }) {
  const envelope = data => ({ data });

  app.get('/v1/blog/articles', { schema: { querystring: publicListQuery } }, async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return envelope(await service.listPublic(request.query));
  });
  app.get('/v1/blog/articles/:slug', { schema: { params: slugParams } }, async (request, reply) => {
    const article = await service.getPublic(request.params.slug);
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    reply.header('ETag', `"blog-${article.contentHash}"`);
    return envelope(article);
  });
  app.get('/blog/:slug', { schema: { params: slugParams } }, async (request, reply) => {
    const article = await service.getPublic(request.params.slug);
    const etag = `"blog-${article.contentHash}"`;
    if (request.headers['if-none-match'] === etag) return reply.status(304).header('ETag', etag).send();
    const nonce = crypto.randomBytes(18).toString('base64url');
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    reply.header('ETag', etag);
    reply.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type('text/html; charset=utf-8').send(renderBlogArticleHtml({ article, siteOrigin, nonce }));
  });
  app.get('/v1/me/blog/articles', { preHandler: requireAuth, schema: { querystring: manageListQuery } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await service.listMine(request.actor, request.query));
  });
  app.get('/v1/me/blog/articles/:articleId', { preHandler: requireAuth, schema: { params: articleParams } }, async (request, reply) => {
    const result = await service.getMine(request.actor, request.params.articleId);
    reply.header('Cache-Control', 'no-store').header('ETag', result.etag);
    return envelope(result.article);
  });
  app.post('/v1/me/blog/articles', { preHandler: requireAuth, schema: { body: contentSchema } }, async (request, reply) => {
    const result = await service.createDraft(request.actor, request.body, request.headers['idempotency-key']);
    reply.status(201).header('Cache-Control', 'no-store').header('ETag', result.etag);
    return envelope(result.article);
  });
  app.put('/v1/me/blog/articles/:articleId/draft', { preHandler: requireAuth, schema: { params: articleParams, body: contentSchema } }, async (request, reply) => {
    const result = await service.reviseDraft(request.actor, request.params.articleId, request.body, request.headers['idempotency-key'], request.headers['if-match']);
    reply.header('Cache-Control', 'no-store').header('ETag', result.etag);
    return envelope(result.article);
  });
  for (const action of ['publish', 'withdraw']) app.post(`/v1/me/blog/articles/:articleId/${action}`, {
    preHandler: requireAuth, schema: { params: articleParams },
  }, async (request, reply) => {
    const result = await service[action](request.actor, request.params.articleId, request.headers['idempotency-key'], request.headers['if-match']);
    reply.header('Cache-Control', 'no-store').header('ETag', result.etag);
    return envelope(result.article);
  });
  app.post('/v1/me/blog/research-drafts', {
    preHandler: requireAuth,
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['draft', 'provenance'], properties: {
        draft: contentSchema,
        provenance: {
          type: 'object', additionalProperties: false,
          required: ['contractVersion', 'topicId', 'reportSnapshotId', 'reportSha256', 'claimIds', 'evidenceIds', 'generatedAt'],
          properties: {
            contractVersion: { const: 'change-radar-publication-draft-v1' },
            topicId: { type: 'string', format: 'uuid' }, reportSnapshotId: { type: 'string', format: 'uuid' },
            reportSha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
            claimIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
            evidenceIds: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
            generatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    } },
  }, async (request, reply) => {
    const result = await service.importResearchDraft(request.actor, request.body, request.headers['idempotency-key']);
    reply.status(201).header('Cache-Control', 'no-store').header('ETag', result.etag);
    return envelope(result.article);
  });
}
