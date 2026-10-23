const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const databaseUrl = process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
const root = path.resolve(__dirname, '../..');
const actor = { userId: crypto.randomUUID(), scopes: ['works:read', 'works:write'], profile: { role: 'admin', canPublish: true } };
const content = title => ({
  slug: 'platform-architecture', locale: 'zh-CN', title,
  summary: '这是一段满足长度要求的官方平台文章摘要，用于验证草稿和公开修订彼此隔离。',
  blocks: [{ type: 'paragraph', text: '公开页面只能读取明确发布的不可变修订，编辑中的工作版本保持私有。' }],
  citations: [],
});

test('blog PostgreSQL lifecycle keeps the published revision isolated from edits', { skip: !databaseUrl, timeout: 120000 }, async t => {
  const { createCommunityTestDatabase } = require('../community-database.cjs');
  const [{ applyMigrations }, { PostgresBlogRepository }, { createBlogService, BlogArticleError }] = await Promise.all([
    import('../../apps/api/src/migrations.mjs'),
    import('../../apps/api/src/blog-repository.mjs'),
    import('../../apps/api/src/blog-service.mjs'),
  ]);
  const database = await createCommunityTestDatabase(databaseUrl);
  t.after(() => database.close());
  assert.equal((await applyMigrations(database.pool, path.join(root, 'apps/api/migrations'))).total, 120);
  await database.pool.query("INSERT INTO users(id,display_name,role,can_publish) VALUES($1,'平台编辑','admin',true)", [actor.userId]);
  const service = createBlogService({ repository: new PostgresBlogRepository(database.pool) });

  const created = await service.createDraft(actor, content('平台架构第一版'), 'blog-create-postgres-0001');
  assert.equal(created.article.publicationState, 'draft');
  await assert.rejects(service.getPublic('platform-architecture'), error => error instanceof BlogArticleError && error.code === 'BLOG_ARTICLE_NOT_FOUND');

  const published = await service.publish(actor, created.article.id, 'blog-publish-postgres-0001', created.etag);
  assert.equal(published.article.publicationState, 'published');
  assert.equal((await service.getPublic('platform-architecture')).title, '平台架构第一版');

  const revised = await service.reviseDraft(actor, created.article.id, content('平台架构第二版'), 'blog-revise-postgres-0001', published.etag);
  assert.equal(revised.article.title, '平台架构第二版');
  assert.equal((await service.getPublic('platform-architecture')).title, '平台架构第一版');

  const republished = await service.publish(actor, created.article.id, 'blog-publish-postgres-0002', revised.etag);
  assert.equal((await service.getPublic('platform-architecture')).title, '平台架构第二版');
  await assert.rejects(database.pool.query('UPDATE blog_article_revisions SET title=$2 WHERE id=$1', [republished.article.revisionId, '试图覆盖历史']), /immutable/u);

  const withdrawn = await service.withdraw(actor, created.article.id, 'blog-withdraw-postgres-0001', republished.etag);
  assert.equal(withdrawn.article.publicationState, 'withdrawn');
  await assert.rejects(service.getPublic('platform-architecture'), error => error instanceof BlogArticleError && error.code === 'BLOG_ARTICLE_NOT_FOUND');
});
