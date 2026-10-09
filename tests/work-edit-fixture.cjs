const crypto = require('node:crypto'), path = require('node:path');
exports.createWorkEditFixture = async function(url) {
  const database = await require('./community-database.cjs').createCommunityTestDatabase(url), { pool } = database;
  try {
    const { applyMigrations } = await import('../apps/api/src/migrations.mjs');
    await applyMigrations(pool, path.resolve(__dirname, '../apps/api/migrations'));
    const { PostgresWorkRepository } = await import('../apps/api/src/work-repository.mjs');
    const { createWorkService } = await import('../apps/api/src/work-service.mjs');
    const { PostgresCatalogRepository } = await import('../apps/api/src/catalog-repository.mjs');
    const { createCatalogService } = await import('../apps/api/src/catalog-service.mjs');
    const { createApp } = await import('../apps/api/src/app.mjs');
    const { AuthError } = await import('../apps/api/src/auth-service.mjs');
    const actors = {};
    for (const name of ['owner', 'other']) {
      const userId = crypto.randomUUID(), profile = { id: userId, displayName: name, canPublish: true, role: 'user', avatar: { kind: 'preset', presetKey: 'cat' } };
      await pool.query('INSERT INTO users(id,display_name,can_publish) VALUES($1,$2,true)', [userId, name]);
      await pool.query('INSERT INTO creator_usage(user_id) VALUES($1)', [userId]);
      actors[name] = { userId, scopes: ['works:read', 'works:write', 'profile:read'], profile };
    }
    const service = createWorkService({ repository: new PostgresWorkRepository(pool) });
    const body = { title: '纸飞机', description: '原来的介绍', instructions: '方向键移动', kind: 'game', estimatedMinutes: 7, tags: ['竞速'], agentLabel: '我的 Agent', repositoryUrl: 'https://github.com/example/plane', licenseSpdx: 'MIT' };
    const { work } = await service.create(actors.owner, body, crypto.randomUUID());
    const { work: draft } = await service.create(actors.owner, { ...body, title: '未发布的草稿' }, crypto.randomUUID());
    const workId = work.id, uploadId = crypto.randomUUID(), releaseId = crypto.randomUUID();
    await pool.query("UPDATE works SET state='published',visibility='public',first_published_at=now() WHERE id=$1", [workId]);
    await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')", [workId]);
    await pool.query("INSERT INTO upload_jobs(id,owner_user_id,work_id,target_key,package_type,file_name,declared_bytes,declared_sha256,object_key,reserved_bytes,expires_at,release_label) VALUES($1,$2,$3,'web','web_zip','game.zip',1,$4,'work-edit-fixture',0,now()+interval '1 day','1.0')", [uploadId, actors.owner.userId, workId, '0'.repeat(64)]);
    await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,upload_job_id,artifact_sha256) VALUES($1,$2,'web','1.0','web_zip','ready','enabled',$3,$4)", [releaseId, workId, uploadId, '0'.repeat(64)]);
    await pool.query('UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1', [workId, releaseId]);
    await pool.query("INSERT INTO competition_boards(id,work_id,board_key,ruleset_version,definition,definition_hash) VALUES($1,$2,'score',1,'{}','test-definition')", [crypto.randomUUID(), workId]);
    await pool.query("INSERT INTO game_save_policies(id,work_id,namespace,status,approved_by,reason) VALUES($1,$2,'default','active',$3,'Preserve existing save policy')", [crypto.randomUUID(), workId, actors.owner.userId]);
    const catalog = createCatalogService({ repository: new PostgresCatalogRepository(pool), config: { runtimeDomain: 'runtime.example.test', runtimeScheme: 'https' } });
    const app = createApp({ config: { requestBodyLimit: 65536 }, workService: service, catalogService: catalog, authService: {
      authenticateBearer: async header => { const actor = Object.values(actors).find(item => header === 'Bearer ' + item.userId); if (!actor) throw new AuthError('AUTH_REQUIRED',401,'请先登录。'); return actor; },
      getProfile: async actor => actor.profile,
    } });
    return { pool, app, service, catalog, actors, workId, releaseId, draftId: draft.id, async protectedState() {
      const result = {};
      for (const table of ['work_targets','releases','upload_jobs','competition_boards','competition_release_boards','competition_runs','competition_entries','game_save_policies']) result[table] = (await pool.query('SELECT to_jsonb(t) AS row FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows;
      result.works = (await pool.query("SELECT to_jsonb(w)-ARRAY['title','description','instructions','estimated_minutes','tags','agent_label','repository_url','license_spdx','revision','updated_at'] AS row FROM works w ORDER BY id")).rows;
      return result;
    }, async close() { await app.close(); await database.close(); } };
  } catch (error) { await database.close(); throw error; }
};
