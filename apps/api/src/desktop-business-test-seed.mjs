import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { withTransaction } from './database.mjs';
import { mimeFor } from './web-package-policy.mjs';
import { normalizeBlogContent, blogRequestHash } from './blog-contract.mjs';

export const DESKTOP_BUSINESS_FIXTURE = Object.freeze({
  authorId: 'd7b00000-0000-4000-8000-000000000001',
  gameId: 'd7b00000-0000-4000-8000-000000000002', gameReleaseId: 'd7b00000-0000-4000-8000-000000000003',
  courseId: 'd7b00000-0000-4000-8000-000000000004', courseReleaseId: 'd7b00000-0000-4000-8000-000000000005',
  articleId: 'd7b00000-0000-4000-8000-000000000006', revisionId: 'd7b00000-0000-4000-8000-000000000007',
  articleSlug: 'desktop-business-fixture', authorHandle: 'desktop-fixture-author',
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export async function seedDesktopBusiness({ database, config, runtimeStore, coverStore }) {
  const url = new URL(config.databaseUrl);
  if (url.hostname !== 'business-postgres' || url.username !== 'desktop_business_test' || url.pathname !== '/desktop_business_test') throw Error('SEED_DATABASE_REJECTED');
  const identity = (await database.pool.query('SELECT current_database() AS db,current_user AS username')).rows[0];
  if (identity.db !== 'desktop_business_test' || identity.username !== 'desktop_business_test') throw Error('SEED_DATABASE_REJECTED');
  await database.pool.query('CREATE TABLE IF NOT EXISTS desktop_business_fixture_state (version integer PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())');
  if ((await database.pool.query('SELECT version FROM desktop_business_fixture_state')).rows.length) return { seeded: true, existing: true, fixture: DESKTOP_BUSINESS_FIXTURE };
  const sourceDirectory = fileURLToPath(new URL('../fixtures/desktop-business/', import.meta.url));
  const assets = {};
  for (const name of ['index.html', 'game.js', 'course.html', 'course.js', 'style.css']) {
    const body = await fs.readFile(new URL(name, new URL('../fixtures/desktop-business/', import.meta.url)));
    assets[name] = { size: body.length, sha256: hash(body), mime: mimeFor(name) };
  }
  const totalBytes = Object.values(assets).reduce((sum, asset) => sum + asset.size, 0);
  const body = await sharp({ create: { width: 960, height: 540, channels: 3, background: '#583580' } }).webp().toBuffer();
  const f = DESKTOP_BUSINESS_FIXTURE;
  const definitions = [
    { id: f.gameId, release: f.gameReleaseId, upload: 'd7b00000-0000-4000-8000-000000000008', title: '隔离测试计数游戏', kind: 'game', entry: 'index.html' },
    { id: f.courseId, release: f.courseReleaseId, upload: 'd7b00000-0000-4000-8000-000000000009', title: '隔离测试弹簧课件', kind: 'courseware', entry: 'course.html' },
  ];
  const prepared = [];
  for (const item of definitions) {
    const report = { policyVersion: 1, entry: item.entry, approvedCapabilities: [], totalBytes, fileCount: Object.keys(assets).length, assets };
    const stored = await runtimeStore.publishAttempt({ releaseId: item.release, attemptId: crypto.randomUUID(), sourceDirectory, report });
    const coverKey = await coverStore.put({ workId: item.id, body, sha256: hash(body) });
    prepared.push({ ...item, stored, coverKey });
  }
  const content = normalizeBlogContent({ slug: f.articleSlug, locale: 'zh-CN', title: '隔离测试日志：从目录到游戏运行',
    summary: '这是一篇平台自有的固定测试文章，用于验证桌面客户端从独立数据库读取日志和正文，不包含模型生成内容。',
    blocks: [{ type: 'heading', level: 2, text: '验证完整业务链路' },
      { type: 'paragraph', text: '本测试实例使用独立 PostgreSQL、Redis 和本地资源目录。发现页、日志、学习页和游戏库均复用现有 API，游戏由 Runtime Edge 提供。', citationIds: [] },
      { type: 'paragraph', text: '测试内容是离线初始化的自有夹具，HTTP 发布、模型调用和后台任务保持关闭。', citationIds: [] }], citations: [] });
  await withTransaction(database.pool, async client => {
    await client.query("INSERT INTO users(id,display_name,profile_handle,social_visibility,can_publish) VALUES($1,'桌面隔离测试作者',$2,'public',false)", [f.authorId, f.authorHandle]);
    for (const item of prepared) {
      await client.query(`INSERT INTO works(id,owner_user_id,title,description,instructions,kind,state,visibility,revision,first_published_at,
        cover_object_key,cover_sha256,cover_media_type,cover_byte_length,cover_width,cover_height)
        VALUES($1,$2,$3,'平台自有的独立业务测试内容，不是线上作品。','操作页面控件，确认数值变化。',$4,'published','public',1,now(),$5,$6,'image/webp',$7,960,540)`,
        [item.id, f.authorId, item.title, item.kind, item.coverKey, Buffer.from(hash(body), 'hex'), body.length]);
      await client.query("INSERT INTO work_targets(work_id,target_key,state,revision) VALUES($1,'web','published',1)", [item.id]);
      await client.query(`INSERT INTO upload_jobs(id,owner_user_id,work_id,target_key,package_type,file_name,state,declared_bytes,declared_sha256,actual_bytes,actual_sha256,object_key,reserved_bytes,expires_at,release_label,release_id)
        VALUES($1,$2,$3,'web','web_zip','owned-test-fixture.zip','succeeded',$4,$5,$4,$5,$6,0,now()+interval '1 day','Owned test fixture',$7)`,
        [item.upload, f.authorId, item.id, totalBytes, hash(JSON.stringify(assets)), 'desktop-test/' + item.upload, item.release]);
      const manifest = item.kind === 'courseware' ? { courseware: { subjects: ['physics'], catalogCategory: 'simulations' } } : {};
      await client.query(`INSERT INTO releases(id,work_id,target_key,label,package_type,entry_path,validation_state,serving_state,
        manifest,approved_capabilities,asset_prefix,asset_manifest_sha256,asset_count,expanded_bytes,upload_job_id)
        VALUES($1,$2,'web','Owned test fixture','web_zip',$3,'ready','enabled',$4::jsonb,'[]'::jsonb,$5,$6,$7,$8,$9)`,
        [item.release, item.id, item.entry, JSON.stringify(manifest), item.stored.prefix, item.stored.manifestSha256, Object.keys(assets).length, totalBytes, item.upload]);
      await client.query("UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1 AND target_key='web'", [item.id, item.release]);
    }
    await client.query(`INSERT INTO blog_articles(id,author_user_id,slug,locale,publication_state,working_revision_id,published_revision_id,first_published_at,last_published_at)
      VALUES($1,$2,$3,'zh-CN','published',$4,$4,now(),now())`, [f.articleId, f.authorId, f.articleSlug, f.revisionId]);
    await client.query(`INSERT INTO blog_article_revisions(id,article_id,author_user_id,title,summary,blocks,citations,content_hash,revision_state)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,'[]'::jsonb,$7,'published')`,
      [f.revisionId, f.articleId, f.authorId, content.title, content.summary, JSON.stringify(content.blocks), blogRequestHash(content)]);
    await client.query('INSERT INTO desktop_business_fixture_state(version) VALUES(1)');
  });
  return { seeded: true, existing: false, fixture: f };
}
