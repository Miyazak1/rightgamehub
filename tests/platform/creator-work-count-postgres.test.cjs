const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const databaseUrl = process.env.GAMEHUB_COMMUNITY_DATABASE_URL;

test('creators can create and import beyond five works without losing usage or publication guards', { skip: !databaseUrl, timeout: 120000 }, async t => {
  const { createCommunityTestDatabase } = require('../community-database.cjs');
  const { applyMigrations } = await import('../../apps/api/src/migrations.mjs');
  const { PostgresWorkRepository } = await import('../../apps/api/src/work-repository.mjs');
  const { createWorkService } = await import('../../apps/api/src/work-service.mjs');
  const { PostgresGitHubSourceRepository, createGitHubSourceService } = await import('../../apps/api/src/github-source-service.mjs');
  const { PostgresUploadRepository } = await import('../../apps/api/src/upload-repository.mjs');
  const database = await createCommunityTestDatabase(databaseUrl);
  t.after(() => database.close());
  const { pool } = database;
  await applyMigrations(pool, path.resolve(__dirname, '../../apps/api/migrations'));
  const works = createWorkService({ repository: new PostgresWorkRepository(pool) });
  const github = createGitHubSourceService({ repository: new PostgresGitHubSourceRepository(pool), githubClient: {}, enabled: true });
  const uploads = new PostgresUploadRepository(pool);
  let installation = 0;

  for (const mode of ['ordinary', 'github']) await t.test(mode, async () => {
    const actor = { userId: crypto.randomUUID(), profile: { canPublish: true }, scopes: ['works:read', 'works:write'] };
    await pool.query("INSERT INTO users(id,display_name,can_publish) VALUES($1,'数量限制回归测试',true)", [actor.userId]);
    await pool.query('INSERT INTO creator_usage(user_id) VALUES($1)', [actor.userId]);
    for (let i = 0; i < 5; i++) await works.create(actor, { title: `Existing ${i}`, description: '', kind: 'game' }, crypto.randomUUID());
    const usage = async () => (await pool.query('SELECT work_count FROM creator_usage WHERE user_id=$1', [actor.userId])).rows[0].work_count;
    assert.equal(await usage(), 5);

    const connectionId = crypto.randomUUID(), repositoryId = crypto.randomUUID();
    await pool.query("INSERT INTO github_source_connections(id,user_id,installation_id,account_id,account_login,account_type,repository_selection) VALUES($1,$2,$3,1,'creator','User','selected')", [connectionId, actor.userId, ++installation]);
    await pool.query("INSERT INTO github_source_repositories(id,connection_id,repository_id,node_id,owner_login,name,default_branch,visibility,html_url) VALUES($1,$2,1,'repo-node','creator','game','main','public','https://github.com/creator/game')", [repositoryId, connectionId]);
    const body = async title => {
      if (mode === 'ordinary') return { title, description: '', kind: 'game' };
      const importId = crypto.randomUUID();
      await pool.query("INSERT INTO github_source_imports(id,user_id,connection_id,source_repository_id,commit_sha,tree_sha,status,repository_snapshot,license_status,license_spdx) VALUES($1,$2,$3,$4,$5,$6,'previewed','{}','recognized','MIT')", [importId, actor.userId, connectionId, repositoryId, crypto.randomBytes(20).toString('hex'), 'b'.repeat(40)]);
      return { importId, title, description: '', kind: 'game' };
    };
    const create = (who, value, key) => mode === 'ordinary' ? works.create(who, value, key) : github.createDraft(who, value, key);
    const requests = [
      { body: await body('Sixth work'), key: crypto.randomUUID() },
      { body: await body('Seventh work'), key: crypto.randomUUID() },
    ];
    const results = await Promise.all(requests.map(request => create(actor, request.body, request.key)));
    assert.equal(new Set(results.map(result => result.work.id)).size, 2);
    assert.equal(await usage(), 7, 'concurrent creation increments statistics once per work');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM works WHERE owner_user_id=$1', [actor.userId])).rows[0].count, 7);
    for (const result of results) {
      assert.equal(result.work.state, 'draft');
      assert.equal(result.work.visibility, 'private');
    }
    const replay = await create(actor, requests[0].body, requests[0].key);
    assert.equal(replay.work.id, results[0].work.id);
    await assert.rejects(create(actor, { ...requests[0].body, title: 'Conflicting request' }, requests[0].key), { code: 'IDEMPOTENCY_CONFLICT' });
    if (mode === 'github') {
      const restored = await create(actor, requests[0].body, crypto.randomUUID());
      assert.equal(restored.work.id, results[0].work.id);
      assert.equal(restored.source.commitSha, results[0].source.commitSha);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM github_source_audit_events WHERE actor_user_id=$1 AND action='draft.created'", [actor.userId])).rows[0].count, 2);
    }
    assert.equal(await usage(), 7, 'replays and conflicts must not change statistics');

    const blockedBody = await body('Must not be created');
    for (const denied of [{ ...actor, profile: { canPublish: false } }, { ...actor, scopes: ['works:read'] }]) {
      await assert.rejects(create(denied, blockedBody, crypto.randomUUID()), { code: 'PUBLISH_NOT_ENABLED' });
    }
    await pool.query('UPDATE users SET can_publish=false WHERE id=$1', [actor.userId]);
    await assert.rejects(create(actor, blockedBody, crypto.randomUUID()), { code: 'PUBLISH_NOT_ENABLED' });
    await pool.query("UPDATE users SET can_publish=true,status='suspended' WHERE id=$1", [actor.userId]);
    await assert.rejects(create(actor, blockedBody, crypto.randomUUID()), { code: 'PUBLISH_NOT_ENABLED' });
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [actor.userId]);
    if (mode === 'github') {
      await pool.query("UPDATE github_source_connections SET status='revoked' WHERE id=$1", [connectionId]);
      await assert.rejects(create(actor, blockedBody, crypto.randomUUID()), { code: 'GITHUB_SOURCE_ACCESS_LOST' });
    }
    assert.equal(await usage(), 7, 'permission and access failures leave usage unchanged');

    const upload = () => uploads.createIdempotent({
      actor, workId: results[0].work.id, uploadId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), requestHash: 'hash', declaredBytes: 10, objectKey: 'test-upload',
      body: { targetKey: 'web', packageType: 'web_zip', fileName: 'game.zip', releaseLabel: '1.0', sha256: 'a'.repeat(64), autoPublish: false },
    });
    await pool.query('UPDATE creator_usage SET stored_bytes=$2 WHERE user_id=$1', [actor.userId, 5 * 1024 ** 3]);
    await assert.rejects(upload(), { code: 'QUOTA_EXCEEDED' });
    await pool.query('UPDATE creator_usage SET stored_bytes=0,active_uploads=1 WHERE user_id=$1', [actor.userId]);
    await assert.rejects(upload(), { code: 'UPLOAD_BUSY' });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM upload_jobs WHERE owner_user_id=$1', [actor.userId])).rows[0].count, 0);
  });
});
