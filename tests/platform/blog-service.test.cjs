const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/blog-service.mjs'));
const contractUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/blog-contract.mjs'));
const actor = { userId: crypto.randomUUID(), scopes: ['works:read', 'works:write'], profile: { role: 'admin', canPublish: true } };
const citationId = crypto.randomUUID();
const content = () => ({
  slug: 'platform-architecture',
  locale: 'zh-CN',
  title: '墨鱼工坊平台架构说明',
  summary: '说明平台如何隔离文章草稿、公开版本和自动研究导入，避免未经确认的内容直接发布。',
  blocks: [
    { type: 'heading', level: 2, text: '设计目标' },
    { type: 'paragraph', text: '公开页面始终读取已经发布的不可变修订，新的编辑只形成私有工作版本。' },
    { type: 'quote', text: '研究系统只负责形成草稿，不拥有发布权限。', citationIds: [citationId] },
  ],
  citations: [{ id: citationId, label: '设计依据', title: '平台发布边界', url: 'https://docs.example.com/platform-boundary', publisher: 'MOOYU.FUN', publishedAt: null, accessedAt: '2026-10-22T02:00:00.000Z' }],
});

test('blog content is structured, bounded, and rejects executable or private links', async () => {
  const { normalizeBlogContent, BlogArticleError } = await import(contractUrl);
  const normalized = normalizeBlogContent(content());
  assert.equal(normalized.title, '墨鱼工坊平台架构说明');
  assert.equal(normalized.blocks[2].citationIds[0], citationId);
  assert.throws(() => normalizeBlogContent({ ...content(), blocks: [{ type: 'html', html: '<script>alert(1)</script>' }] }), error => error instanceof BlogArticleError && error.code === 'BLOG_CONTENT_INVALID');
  const local = content();
  local.citations[0].url = 'https://127.0.0.1/private';
  assert.throws(() => normalizeBlogContent(local), error => error instanceof BlogArticleError && error.code === 'BLOG_CONTENT_INVALID');
});

test('draft creation requires creator authority and carries idempotent immutable revision data', async () => {
  const { createBlogService, BlogArticleError } = await import(moduleUrl);
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  let received;
  const service = createBlogService({ repository: { mutate: async command => (received = command, { id: command.articleId, version: 1, publicationState: 'draft' }) }, ids: () => ids.shift() });
  await assert.rejects(service.createDraft({ ...actor, scopes: ['works:read'] }, content(), 'blog-create-request-0001'), error => error instanceof BlogArticleError && error.code === 'BLOG_WRITE_FORBIDDEN');
  await assert.rejects(service.createDraft({ ...actor, profile: { role: 'creator', canPublish: true } }, content(), 'blog-create-request-0002'), error => error instanceof BlogArticleError && error.code === 'BLOG_WRITE_FORBIDDEN');
  const created = await service.createDraft(actor, content(), 'blog-create-request-0001');
  assert.equal(created.article.publicationState, 'draft');
  assert.equal(created.etag, `"article-${created.article.id}-1"`);
  assert.equal(received.operation, 'create_draft');
  assert.match(received.requestHash, /^[0-9a-f]{64}$/);
  assert.equal(received.expectedVersion, null);
});

test('editing and publication require a matching article ETag', async () => {
  const { createBlogService, BlogArticleError } = await import(moduleUrl);
  const articleId = crypto.randomUUID();
  const commands = [];
  const service = createBlogService({ repository: { mutate: async command => (commands.push(command), { id: articleId, version: Number(command.expectedVersion) + 1, publicationState: command.operation === 'withdraw' ? 'withdrawn' : 'published' }) } });
  await assert.rejects(service.publish(actor, articleId, 'blog-publish-request-0001', '"wrong"'), error => error instanceof BlogArticleError && error.code === 'PRECONDITION_REQUIRED');
  const published = await service.publish(actor, articleId, 'blog-publish-request-0001', `"article-${articleId}-4"`);
  assert.equal(commands[0].expectedVersion, '4');
  assert.equal(published.etag, `"article-${articleId}-5"`);
});

test('research exports can only enter as a private draft with frozen provenance', async () => {
  const { createBlogService, BlogArticleError } = await import(moduleUrl);
  const source = {
    contractVersion: 'change-radar-publication-draft-v1',
    topicId: crypto.randomUUID(),
    reportSnapshotId: crypto.randomUUID(),
    reportSha256: 'a'.repeat(64),
    claimIds: [crypto.randomUUID()],
    evidenceIds: [crypto.randomUUID()],
    generatedAt: '2026-10-22T03:00:00.000Z',
  };
  let received;
  const service = createBlogService({ repository: { importResearchDraft: async command => (received = command, { id: command.articleId, version: 1, publicationState: 'draft' }) } });
  const imported = await service.importResearchDraft(actor, { draft: content(), provenance: source }, 'blog-import-request-0001');
  assert.equal(imported.article.publicationState, 'draft');
  assert.equal(received.operation, 'import_research_draft');
  assert.deepEqual(received.provenance.claimIds, source.claimIds);
  const unsafe = createBlogService({ repository: { importResearchDraft: async command => ({ id: command.articleId, version: 1, publicationState: 'published' }) } });
  await assert.rejects(unsafe.importResearchDraft(actor, { draft: content(), provenance: source }, 'blog-import-request-0002'), error => error instanceof BlogArticleError && error.code === 'BLOG_IMPORT_UNSAFE_RESULT');
});

test('public listing is bounded and does not require an authenticated actor', async () => {
  const { createBlogService, BlogArticleError } = await import(moduleUrl);
  let received;
  const service = createBlogService({ repository: { listPublic: async query => (received = query, { items: [], nextCursor: null }) } });
  await service.listPublic({ limit: 500, locale: 'zh-CN' });
  assert.equal(received.limit, 50);
  assert.equal(received.locale, 'zh-CN');
  assert.throws(() => service.listPublic({ locale: 'fr' }), error => error instanceof BlogArticleError && error.code === 'BLOG_QUERY_INVALID');
});
