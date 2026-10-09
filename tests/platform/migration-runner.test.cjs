const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeZip } = require('../../scripts/zip-fixture.cjs');

const root = path.resolve(__dirname, '../..');
const migrationUrl = pathToFileURL(path.join(root, 'apps/api/src/migrations.mjs'));
const migrationDir = path.join(root, 'apps/api/migrations');

test('migration runner loads ordered immutable checksums and strips file transaction wrappers', async () => {
  const { loadMigrations } = await import(migrationUrl);
  const migrations = await loadMigrations(migrationDir);
  assert.equal(migrations.length, 57);
  assert.equal(migrations[0].version, '0001');
  assert.equal(migrations[9].version, '0010');
  assert.equal(migrations[10].version, '0011');
  assert.equal(migrations[11].version, '0012');
  assert.equal(migrations[12].version, '0013');
  assert.equal(migrations[13].version, '0014');
  assert.equal(migrations[14].version, '0015');
  assert.equal(migrations[15].version, '0016');
  assert.equal(migrations[16].version, '0017');
  assert.equal(migrations[17].version, '0018');
  assert.equal(migrations[19].version, '0020');
  assert.equal(migrations[20].version, '0021');
  assert.equal(migrations[21].version, '0022');
  assert.equal(migrations[22].version, '0023');
  assert.equal(migrations[23].version, '0024');
  assert.equal(migrations[24].version, '0025');
  assert.equal(migrations[28].version, '0029');
  assert.equal(migrations[29].version, '0030');
  assert.equal(migrations[30].version, '0031');
  assert.equal(migrations[31].version, '0032');
  assert.equal(migrations[32].version, '0033');
  assert.equal(migrations[33].version, '0034');
  assert.equal(migrations[34].version, '0035');
  assert.equal(migrations[35].version, '0036');
  assert.equal(migrations[36].version, '0037');
  assert.equal(migrations[37].version, '0038');
  assert.equal(migrations[38].version, '0039');
  assert.equal(migrations[41].version, '0042');
  assert.equal(migrations[42].version, '0043');
  assert.equal(migrations[43].version, '0044');
  assert.equal(migrations[44].version, '0045');
  assert.equal(migrations[45].version, '0046');
  assert.equal(migrations[54].version, '0055');
  assert.equal(migrations[55].version, '0056');
  assert.equal(migrations[56].version, '0057');
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(migration.body, /^BEGIN;/i);
    assert.doesNotMatch(migration.body, /COMMIT;\s*$/i);
  }
});

test('real PostgreSQL migration and schema checks run when GAMEHUB_TEST_DATABASE_URL is provided', { skip: !process.env.GAMEHUB_TEST_DATABASE_URL }, async () => {
  const { applyMigrations, migrationStatus } = await import(migrationUrl);
  const { createDatabase } = await import(pathToFileURL(path.join(root, 'apps/api/src/database.mjs')));
  const { PostgresAuthRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/auth-repository.mjs')));
  const { createAuthService, AuthError } = await import(pathToFileURL(path.join(root, 'apps/api/src/auth-service.mjs')));
  const { createApp } = await import(pathToFileURL(path.join(root, 'apps/api/src/app.mjs')));
  const { PostgresWorkRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/work-repository.mjs')));
  const { createWorkService } = await import(pathToFileURL(path.join(root, 'apps/api/src/work-service.mjs')));
  const { PostgresUploadRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/upload-repository.mjs')));
  const { createUploadService } = await import(pathToFileURL(path.join(root, 'apps/api/src/upload-service.mjs')));
  const { LocalQuarantineStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/local-object-store.mjs')));
  const { LocalRuntimeStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/local-runtime-store.mjs')));
  const { LocalCoverStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/local-cover-store.mjs')));
  const { PostgresValidationRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/validation-repository.mjs')));
  const { createValidationWorker } = await import(pathToFileURL(path.join(root, 'apps/api/src/validation-worker.mjs')));
  const { PostgresCatalogRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/catalog-repository.mjs')));
  const { createCatalogService } = await import(pathToFileURL(path.join(root, 'apps/api/src/catalog-service.mjs')));
  const { PostgresModerationRepository, createModerationService } = await import(pathToFileURL(path.join(root, 'apps/api/src/moderation-service.mjs')));
  const { PostgresCreatorFeedbackRepository, createCreatorFeedbackService } = await import(pathToFileURL(path.join(root, 'apps/api/src/creator-feedback-service.mjs')));
  const { PostgresRuntimeEdgeRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/runtime-edge-repository.mjs')));
  const { createRuntimeEdgeApp } = await import(pathToFileURL(path.join(root, 'apps/api/src/runtime-edge-app.mjs')));
  const { PostgresSourceBuildRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/source-build-repository.mjs')));
  const { createSourceBuildService } = await import(pathToFileURL(path.join(root, 'apps/api/src/source-build-service.mjs')));
  const database = createDatabase({ databaseUrl: process.env.GAMEHUB_TEST_DATABASE_URL, databaseSsl: false });
  const pool = database.pool;
  try {
    const first = await applyMigrations(pool, migrationDir);
    assert.equal(first.total, 55);
    const second = await applyMigrations(pool, migrationDir);
    assert.deepEqual(second.applied, []);
    assert.equal((await migrationStatus(pool, migrationDir)).ready, true);

    let code;
    const authService = createAuthService({
      repository: new PostgresAuthRepository(pool),
      mailer: { sendVerificationCode: async message => { code = message.code; } },
      otpHmacKey: 'integration-only-key-with-32-bytes-minimum',
    });
    const email = `integration-${Date.now()}@example.test`;
    const challenge = await authService.requestChallenge({ email, clientKind: 'harness' });
    const auth = await authService.verifyChallenge({ challengeId: challenge.challengeId, code, deviceLabel: 'Integration test' });
    assert.equal(auth.profile.canPublish, false);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM access_tokens WHERE grant_id=$1', [auth.grantId])).rows[0].count, 1);
    const signedInActor = await authService.authenticateBearer(`Bearer ${auth.accessToken}`);
    const signedInDevices = await authService.listDevices(signedInActor);
    assert.equal(signedInDevices[0].current, true);
    assert.match(signedInDevices[0].lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);
    await assert.rejects(
      authService.verifyChallenge({ challengeId: challenge.challengeId, code, deviceLabel: 'Replay' }),
      error => error instanceof AuthError && error.code === 'CHALLENGE_INVALID',
    );

    const refreshed = await authService.refresh({ refreshToken: auth.refreshToken });
    assert.notEqual(refreshed.refreshToken, auth.refreshToken);
    await assert.rejects(authService.refresh({ refreshToken: auth.refreshToken }), error => error instanceof AuthError && error.code === 'REFRESH_REUSED');
    assert.equal(await authService.authenticateBearer(`Bearer ${refreshed.accessToken}`).catch(() => null), null);

    await pool.query("UPDATE users SET can_publish=true,role='admin' WHERE id=$1", [auth.profile.id]);
    await pool.query("UPDATE email_challenges SET resend_after=now()-interval '1 second' WHERE email_normalized=$1", [email]);
    const authorChallenge = await authService.requestChallenge({ email, clientKind: 'harness' });
    const authorAuth = await authService.verifyChallenge({ challengeId: authorChallenge.challengeId, code, deviceLabel: 'Author device' });
    const coverStore = new LocalCoverStore(path.join(root, '.runtime', 'platform', 'integration-covers'));
    const workService = createWorkService({ repository: new PostgresWorkRepository(pool, coverStore) });
    const quarantineStore = new LocalQuarantineStore(path.join(root, '.runtime', 'platform', 'integration-quarantine'));
    const uploadService = createUploadService({
      repository: new PostgresUploadRepository(pool),
      objectStore: quarantineStore,
    });
    const validationRepository = new PostgresValidationRepository(pool);
    const runtimeRoot = path.join(root, '.runtime', 'platform', 'integration-runtime');
    const validationWorker = createValidationWorker({
      repository: validationRepository, quarantineStore, runtimeStore: new LocalRuntimeStore(runtimeRoot),
      validatorRoot: path.join(root, '.runtime', 'platform', 'integration-validator'),
    });
    const publicConfig = { requestBodyLimit: 65536, runtimeDomain: 'gamehub.test', runtimeScheme: 'https', runtimePublicPort: null };
    const catalogService = createCatalogService({ repository: new PostgresCatalogRepository(pool), config: publicConfig });
    const moderationService = createModerationService({ repository: new PostgresModerationRepository(pool) });
    const creatorFeedbackService = createCreatorFeedbackService({ repository: new PostgresCreatorFeedbackRepository(pool) });
    const sourceBuildRepository = new PostgresSourceBuildRepository(pool);
    const sourceBuildService = createSourceBuildService({ repository: sourceBuildRepository,enabled: true,builderImageDigest: `sha256:${'a'.repeat(64)}` });
    const runtimeEdgeApp = createRuntimeEdgeApp({ repository: new PostgresRuntimeEdgeRepository(pool), objectStore: new LocalRuntimeStore(runtimeRoot), runtimeDomain: publicConfig.runtimeDomain });

    const app = createApp({
      config: publicConfig,
      database: { ping: async () => (await pool.query('SELECT 1 AS ok')).rows[0].ok === 1 },
      migrations: { status: () => migrationStatus(pool, migrationDir) }, authService, workService, sourceBuildService, uploadService, catalogService, moderationService, creatorFeedbackService,
    });
    try {
      const ready = await app.inject({ url: '/ready' });
      assert.equal(ready.statusCode, 200);
      assert.equal(ready.json().data.status, 'ready');
      const me = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(me.statusCode, 200);
      assert.equal(me.json().data.canPublish, true);

      const idempotencyKey = `create-work-${Date.now()}`;
      const createRequest = { method: 'POST', url: '/v1/creator/works', headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': idempotencyKey }, payload: { title: 'Integration Game', description: 'Database-backed work', kind: 'game', repositoryUrl: 'https://github.com/integration-owner/integration-repo' } };
      const [created, replay] = await Promise.all([app.inject(createRequest), app.inject(createRequest)]);
      assert.equal(created.statusCode, 200);
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.json().data.id, created.json().data.id);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM works WHERE owner_user_id=$1', [authorAuth.profile.id])).rows[0].count, 1);
      const conflict = await app.inject({ ...createRequest, payload: { title: 'Different', description: 'Different', kind: 'game' } });
      assert.equal(conflict.statusCode, 409);

      const workId = created.json().data.id;
      const connectionId = crypto.randomUUID(); const repositoryId = crypto.randomUUID(); const importId = crypto.randomUUID(); const sourceId = crypto.randomUUID();
      await pool.query("INSERT INTO github_source_connections(id,user_id,installation_id,account_id,account_login,account_type,repository_selection) VALUES($1,$2,70001,70002,'integration-owner','User','selected')",[connectionId,authorAuth.profile.id]);
      await pool.query("INSERT INTO github_source_repositories(id,connection_id,repository_id,node_id,owner_login,name,default_branch,visibility,html_url) VALUES($1,$2,70003,'R_integration','integration-owner','integration-repo','main','private','https://github.com/integration-owner/integration-repo')",[repositoryId,connectionId]);
      await pool.query("INSERT INTO github_source_imports(id,user_id,connection_id,source_repository_id,commit_sha,tree_sha,status,repository_snapshot,license_status,license_spdx,static_signals,work_id) VALUES($1,$2,$3,$4,$5,$6,'succeeded','{}','recognized','MIT','{}',$7)",[importId,authorAuth.profile.id,connectionId,repositoryId,'b'.repeat(40),'c'.repeat(40),workId]);
      await pool.query("INSERT INTO work_sources(id,work_id,source_import_id,repository_id,repository_node_id,repository_visibility,owner_login,repository_name,repository_url,default_branch,commit_sha,tree_sha,provenance) VALUES($1,$2,$3,70003,'R_integration','private','integration-owner','integration-repo','https://github.com/integration-owner/integration-repo','main',$4,$5,'{}')",[sourceId,workId,importId,'b'.repeat(40),'c'.repeat(40)]);
      const sourceBuildResponse = await app.inject({ method:'POST',url:`/v1/creator/works/${workId}/builds`,headers:{ authorization:`Bearer ${authorAuth.accessToken}`,'idempotency-key':`source-build-${Date.now()}` },payload:{ templateKey:'static-v1',releaseLabel:'source-1' } });
      assert.equal(sourceBuildResponse.statusCode,202,sourceBuildResponse.body);
      const sourceBuild = sourceBuildResponse.json().data;
      assert.equal(sourceBuild.commitSha,'b'.repeat(40));
      const sourceClaim = await sourceBuildRepository.claimNext({ leaseToken:crypto.randomUUID(),targetBuildId:sourceBuild.id });
      assert.equal(sourceClaim.owner,'integration-owner');
      assert.equal(sourceClaim.name,'integration-repo');
      assert.equal(await sourceBuildRepository.fail({ claim:sourceClaim,errorCode:'INTEGRATION_STOP' }),true);
      assert.equal((await sourceBuildRepository.get({ userId:authorAuth.profile.id },workId,sourceBuild.id)).state,'failed');
      const etag = created.headers.etag;
      const updateRequest = { method: 'PATCH', url: `/v1/creator/works/${workId}`, headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': `update-work-${Date.now()}`, 'if-match': etag }, payload: { title: 'Updated Game' } };
      const updated = await app.inject(updateRequest);
      assert.equal(updated.statusCode, 200);
      assert.notEqual(updated.headers.etag, etag);
      assert.equal((await app.inject(updateRequest)).json().data.revision, '1');
      const stale = await app.inject({ ...updateRequest, headers: { ...updateRequest.headers, 'idempotency-key': `stale-work-${Date.now()}` } });
      assert.equal(stale.statusCode, 412);

      const archive = makeZip([
        { name: 'index.html', data: '<!doctype html><script src="assets/game.js"></script><h1>Integration Game</h1>' },
        { name: 'assets/game.js', data: 'globalThis.gamehubIntegration=true' },
        { name: 'platform.json', data: JSON.stringify({ version: 1, capabilities: ['fullscreen','fileExport','shareLinks'] }) },
      ]);
      const uploadPayload = {
        fileName: 'integration-game.zip', declaredBytes: String(archive.length),
        sha256: crypto.createHash('sha256').update(archive).digest('hex'),
        releaseLabel: 'integration-1', autoPublish: true, targetKey: 'web', packageType: 'web_zip',
      };
      const makeUpload = suffix => app.inject({
        method: 'POST', url: `/v1/creator/works/${workId}/uploads`,
        headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': `create-upload-${Date.now()}-${suffix}` },
        payload: uploadPayload,
      });
      const uploadRace = await Promise.all([makeUpload('a'), makeUpload('b')]);
      assert.deepEqual(uploadRace.map(response => response.statusCode).sort(), [200, 409]);
      assert.equal(uploadRace.find(response => response.statusCode === 409).json().error.code, 'UPLOAD_BUSY');
      const upload = uploadRace.find(response => response.statusCode === 200).json().data;
      assert.equal(upload.state, 'created');
      assert.equal((await pool.query('SELECT release_label FROM upload_jobs WHERE id=$1', [upload.id])).rows[0].release_label, 'integration-1');
      assert.equal((await pool.query('SELECT publish_generation::int AS generation FROM work_targets WHERE work_id=$1 AND target_key=$2', [workId, 'web'])).rows[0].generation, 1);

      const grantResponse = await app.inject({ method: 'POST', url: `/v1/creator/uploads/${upload.id}/grant`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(grantResponse.statusCode, 200);
      assert.equal(grantResponse.headers['cache-control'], 'no-store');
      const grant = grantResponse.json().data;
      const received = await app.inject({
        method: 'PUT', url: `/v1/creator/uploads/${upload.id}/content`,
        headers: { authorization: `Upload ${grant.token}`, 'content-type': 'application/zip' }, payload: archive,
      });
      assert.equal(received.statusCode, 200, received.body);
      assert.equal(received.json().data.state, 'uploaded');
      assert.equal(received.json().data.actualBytes, String(archive.length));
      const replayedGrant = await app.inject({
        method: 'PUT', url: `/v1/creator/uploads/${upload.id}/content`,
        headers: { authorization: `Upload ${grant.token}`, 'content-type': 'application/zip' }, payload: archive,
      });
      assert.equal(replayedGrant.statusCode, 401);

      const completeRequest = suffix => app.inject({
        method: 'POST', url: `/v1/creator/uploads/${upload.id}/complete`,
        headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': `complete-upload-${Date.now()}-${suffix}` },
      });
      assert.equal((await app.inject({ method: 'POST', url: `/v1/creator/uploads/${upload.id}/complete`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } })).statusCode, 400);
      const completed = await Promise.all([completeRequest('a'), completeRequest('b')]);
      assert.deepEqual(completed.map(response => response.statusCode), [200, 200]);
      assert.ok(completed.every(response => response.json().data.state === 'queued'));
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM jobs WHERE kind='validate' AND target_id=$1", [upload.id])).rows[0].count, 1);
      const uploadStatus = await app.inject({ url: `/v1/creator/uploads/${upload.id}`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(uploadStatus.statusCode, 200);
      assert.equal(uploadStatus.json().data.state, 'queued');

      const rejectedUpload = async ({ declared, body, suffix }) => {
        const createdFailure = await app.inject({
          method: 'POST', url: `/v1/creator/works/${workId}/uploads`,
          headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': `create-rejected-${Date.now()}-${suffix}` },
          payload: { ...uploadPayload, autoPublish: false, declaredBytes: String(declared.length), sha256: crypto.createHash('sha256').update(declared).digest('hex') },
        });
        assert.equal(createdFailure.statusCode, 200, createdFailure.body);
        const rejectedId = createdFailure.json().data.id;
        const rejectedGrantResponse = await app.inject({ method: 'POST', url: `/v1/creator/uploads/${rejectedId}/grant`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
        assert.equal(rejectedGrantResponse.statusCode, 200);
        const rejectedGrant = rejectedGrantResponse.json().data;
        const response = await app.inject({
          method: 'PUT', url: `/v1/creator/uploads/${rejectedId}/content`,
          headers: { authorization: `Upload ${rejectedGrant.token}`, 'content-type': 'application/zip' }, payload: body,
        });
        assert.equal((await app.inject({ url: `/v1/creator/uploads/${rejectedId}`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } })).json().data.state, 'failed');
        return response;
      };
      const wrongHash = await rejectedUpload({ declared: Buffer.from('same-size'), body: Buffer.from('wrong-hsh'), suffix: 'hash' });
      assert.equal(wrongHash.statusCode, 422);
      assert.equal(wrongHash.json().error.code, 'UPLOAD_HASH_MISMATCH');

      const newestCreate = await app.inject({
        method: 'POST', url: `/v1/creator/works/${workId}/uploads`,
        headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': `create-newest-${Date.now()}` },
        payload: { ...uploadPayload, releaseLabel: 'integration-2' },
      });
      assert.equal(newestCreate.statusCode, 200, newestCreate.body);
      const newest = newestCreate.json().data;
      const newestGrantResponse = await app.inject({ method: 'POST', url: `/v1/creator/uploads/${newest.id}/grant`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      const newestGrant = newestGrantResponse.json().data;
      assert.equal((await app.inject({
        method: 'PUT', url: `/v1/creator/uploads/${newest.id}/content`,
        headers: { authorization: `Upload ${newestGrant.token}`, 'content-type': 'application/zip' }, payload: archive,
      })).statusCode, 200);
      assert.equal((await app.inject({
        method: 'POST', url: `/v1/creator/uploads/${newest.id}/complete`,
        headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': `complete-newest-${Date.now()}` },
      })).statusCode, 200);
      assert.equal((await pool.query('SELECT publish_generation::int AS generation FROM work_targets WHERE work_id=$1 AND target_key=$2', [workId, 'web'])).rows[0].generation, 2);

      const abandonedToken = crypto.randomUUID();
      const abandoned = await validationRepository.claimNext({ leaseToken: abandonedToken, releaseId: crypto.randomUUID(), targetUploadId: upload.id });
      assert.equal(abandoned.attempt, 1);
      await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [abandoned.jobId]);
      const reclaimed = await Promise.all([
        validationWorker.runOnce({ targetUploadId: upload.id }),
        validationWorker.runOnce({ targetUploadId: upload.id }),
      ]);
      const staleResult = reclaimed.find(Boolean);
      assert.equal(reclaimed.filter(Boolean).length, 1);
      assert.equal(staleResult.outcome, 'skipped_newer_intent');
      assert.equal((await pool.query('SELECT attempt FROM jobs WHERE id=$1', [abandoned.jobId])).rows[0].attempt, 2);
      assert.equal(await validationRepository.fail({ jobId: abandoned.jobId, leaseToken: abandonedToken, uploadId: upload.id, errorCode: 'STALE_WORKER' }), false);
      const staleRelease = (await pool.query('SELECT id,serving_state,asset_prefix FROM releases WHERE upload_job_id=$1', [upload.id])).rows[0];
      assert.equal(staleRelease.serving_state, 'disabled');
      assert.equal((await pool.query('SELECT current_release_id FROM work_targets WHERE work_id=$1 AND target_key=$2', [workId, 'web'])).rows[0].current_release_id, null);

      const published = await validationWorker.runOnce({ targetUploadId: newest.id });
      assert.equal(published.outcome, 'published');
      const target = (await pool.query('SELECT current_release_id,state,revision FROM work_targets WHERE work_id=$1 AND target_key=$2', [workId, 'web'])).rows[0];
      assert.equal(target.current_release_id, published.releaseId);
      assert.equal(target.state, 'published');
      const publicWork = (await pool.query('SELECT state,visibility FROM works WHERE id=$1', [workId])).rows[0];
      assert.deepEqual(publicWork, { state: 'published', visibility: 'public' });
      const publishedRelease = (await pool.query('SELECT serving_state,validation_state,asset_prefix,asset_manifest_sha256,expanded_bytes FROM releases WHERE id=$1', [published.releaseId])).rows[0];
      assert.equal(publishedRelease.serving_state, 'enabled');
      assert.equal(publishedRelease.validation_state, 'ready');
      assert.match(publishedRelease.asset_manifest_sha256, /^[a-f0-9]{64}$/);
      assert.equal(JSON.parse(await fs.readFile(path.join(runtimeRoot, ...publishedRelease.asset_prefix.split('/'), 'complete.json'), 'utf8')).completed, true);
      assert.equal((await app.inject({ url: `/v1/creator/uploads/${upload.id}`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } })).json().data.publicationOutcome, 'skipped_newer_intent');
      assert.equal((await app.inject({ url: `/v1/creator/uploads/${newest.id}`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } })).json().data.publicationOutcome, 'published');

      const coverPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOosLnzHwAFUAKQJastWQAAAABJRU5ErkJggg==', 'base64');
      const coverUpload = await app.inject({ method: 'PUT', url: `/v1/creator/works/${workId}/cover`, headers: { authorization: `Bearer ${authorAuth.accessToken}`, 'content-type': 'image/png' }, payload: coverPng });
      assert.equal(coverUpload.statusCode, 200, coverUpload.body);
      assert.match(coverUpload.json().data.coverUrl, new RegExp(`^/v1/works/${workId}/cover`));
      const publicCover = await app.inject({ url: coverUpload.json().data.coverUrl });
      assert.equal(publicCover.statusCode, 200);
      assert.match(publicCover.headers['content-type'], /^image\/webp/);
      assert.equal(publicCover.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');

      const catalog = await app.inject({ url: '/v1/works?limit=50&kind=game' });
      assert.equal(catalog.statusCode, 200);
      assert.equal(catalog.headers['cache-control'], 'public, max-age=30');
      assert.ok(catalog.json().data.some(item => item.id === workId && item.targets[0].currentReleaseId === published.releaseId && item.coverUrl));
      const detail = await app.inject({ url: `/v1/works/${workId}` });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().data.state, 'published');

      const reporterEmail = `reporter-${Date.now()}@example.test`;
      const reporterChallenge = await authService.requestChallenge({ email: reporterEmail, clientKind: 'browser' });
      const reporterAuth = await authService.verifyChallenge({ challengeId: reporterChallenge.challengeId, code, deviceLabel: 'Reporter device' });
      const feedback = await app.inject({
        method: 'POST', url: `/v1/works/${workId}/feedback`, headers: { authorization: `Bearer ${reporterAuth.accessToken}` },
        payload: { category: 'bug', summary: 'Restart leaves the player frozen', details: 'After restarting level two, movement controls stop responding.', reproductionSteps: 'Start level two, pause, then choose restart.', environment: 'Chrome on Windows' },
      });
      assert.equal(feedback.statusCode, 201, feedback.body);
      const feedbackId = feedback.json().data.id;
      const inbox = await app.inject({ url: '/v1/creator/feedback?status=new', headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(inbox.statusCode, 200, inbox.body);
      assert.ok(inbox.json().data.some(item => item.id === feedbackId && !('reporterUserId' in item)));
      const issueDraft = await app.inject({ method: 'POST', url: `/v1/creator/feedback/${feedbackId}/issue-draft`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(issueDraft.statusCode, 200, issueDraft.body);
      assert.match(issueDraft.json().data.createUrl, /^https:\/\/github\.com\/integration-owner\/integration-repo\/issues\/new\?/);
      const linkedFeedback = await app.inject({ method: 'PATCH', url: `/v1/creator/feedback/${feedbackId}`, headers: { authorization: `Bearer ${authorAuth.accessToken}` }, payload: { action: 'link_issue', issueUrl: 'https://github.com/integration-owner/integration-repo/issues/7' } });
      assert.equal(linkedFeedback.statusCode, 200, linkedFeedback.body);
      assert.equal(linkedFeedback.json().data.status, 'issue_linked');
      await assert.rejects(pool.query('UPDATE creator_feedback_events SET details=$1 WHERE feedback_id=$2', [{ tampered: true }, feedbackId]), /append-only/);
      const report = await app.inject({
        method: 'POST', url: `/v1/works/${workId}/reports`,
        headers: { authorization: `Bearer ${reporterAuth.accessToken}` }, payload: { category: 'unsafe', details: 'Unexpected external navigation.' },
      });
      assert.equal(report.statusCode, 200, report.body);
      assert.equal(report.json().data.status, 'open');
      const reportId = report.json().data.id;
      const queue = await app.inject({ url: '/v1/admin/reports?status=open', headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(queue.statusCode, 200, queue.body);
      assert.ok(queue.json().data.some(item => item.id === reportId));
      const decision = await app.inject({
        method: 'POST', url: `/v1/admin/reports/${reportId}/decision`,
        headers: { authorization: `Bearer ${authorAuth.accessToken}` }, payload: { action: 'dismiss', note: 'Reviewed in integration test; not reproducible.' },
      });
      assert.equal(decision.statusCode, 200, decision.body);
      assert.equal(decision.json().data.status, 'dismissed');
      const audit = await app.inject({ url: '/v1/admin/audit', headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.ok(audit.json().data.some(item => item.reportId === reportId && item.action === 'dismiss'));
      await assert.rejects(pool.query('UPDATE moderation_audit_events SET reason=$1 WHERE report_id=$2', ['tampered', reportId]), /append-only/);

      const launch = await app.inject({ url: `/v1/works/${workId}/launch` });
      assert.equal(launch.statusCode, 200);
      assert.equal(launch.headers['cache-control'], 'no-store');
      const launchData = launch.json().data;
      const releaseHost = `r-${published.releaseId.replaceAll('-', '')}.gamehub.test`;
      assert.equal(launchData.runtimeOrigin, `https://${releaseHost}`);
      assert.equal(launchData.entryUrl, `https://${releaseHost}/index.html`);
      assert.equal(launchData.capabilities.fullscreen, true);
      assert.equal(launchData.capabilities.fileExport, true);
      assert.equal(launchData.capabilities.shareLinks, true);
      assert.equal((await app.inject({ url: `/v1/works/${workId}/launch?releaseId=${staleRelease.id}` })).statusCode, 404);

      const runtimeIndex = await runtimeEdgeApp.inject({ url: '/', headers: { host: releaseHost } });
      assert.equal(runtimeIndex.statusCode, 200, runtimeIndex.body);
      assert.match(runtimeIndex.body, /Integration Game/);
      assert.match(runtimeIndex.headers['content-type'], /^text\/html/);
      assert.match(runtimeIndex.headers['content-security-policy'], /worker-src 'none'/);
      assert.doesNotMatch(runtimeIndex.headers['content-security-policy'], /allow-same-origin/);
      assert.doesNotMatch(runtimeIndex.headers['content-security-policy'], /allow-pointer-lock/);
      assert.match(runtimeIndex.headers['permissions-policy'], /camera=\(\)/);
      assert.match(runtimeIndex.headers['permissions-policy'], /fullscreen=\(self\)/);
      assert.equal(runtimeIndex.headers['cache-control'], 'no-store');
      assert.equal(runtimeIndex.headers['x-content-type-options'], 'nosniff');
      const runtimeScript = await runtimeEdgeApp.inject({ url: '/assets/game.js?cache=bust', headers: { host: releaseHost } });
      assert.equal(runtimeScript.statusCode, 200);
      assert.match(runtimeScript.headers['content-type'], /^text\/javascript/);
      assert.equal(runtimeScript.body, 'globalThis.gamehubIntegration=true');
      assert.equal((await runtimeEdgeApp.inject({ url: '/assets/game.js', headers: { host: releaseHost, 'if-none-match': runtimeScript.headers.etag } })).statusCode, 304);
      const runtimeHead = await runtimeEdgeApp.inject({ method: 'HEAD', url: '/assets/game.js', headers: { host: releaseHost } });
      assert.equal(runtimeHead.statusCode, 200);
      assert.equal(runtimeHead.body, '');
      assert.equal(runtimeHead.headers['content-length'], String(Buffer.byteLength(runtimeScript.body)));
      const runtimeRange = await runtimeEdgeApp.inject({ url: '/assets/game.js', headers: { host: releaseHost, range: 'bytes=0-5' } });
      assert.equal(runtimeRange.statusCode, 206);
      assert.equal(runtimeRange.body, 'global');
      assert.equal(runtimeRange.headers['content-range'], `bytes 0-5/${Buffer.byteLength(runtimeScript.body)}`);
      assert.equal((await runtimeEdgeApp.inject({ url: '/assets/game.js', headers: { host: releaseHost, range: 'bytes=999-1000' } })).statusCode, 416);
      assert.equal((await runtimeEdgeApp.inject({ url: '/assets%2fgame.js', headers: { host: releaseHost } })).statusCode, 400);
      assert.equal((await runtimeEdgeApp.inject({ url: '/', headers: { host: 'evil.gamehub.test' } })).statusCode, 421);
      assert.equal((await runtimeEdgeApp.inject({ method: 'POST', url: '/', headers: { host: releaseHost } })).statusCode, 405);
      const runtimeScriptPath = path.join(runtimeRoot, ...publishedRelease.asset_prefix.split('/'), 'assets', 'assets', 'game.js');
      await fs.appendFile(runtimeScriptPath, 'tampered');
      assert.equal((await runtimeEdgeApp.inject({ url: '/assets/game.js', headers: { host: releaseHost } })).statusCode, 503);
      await fs.writeFile(runtimeScriptPath, runtimeScript.body);

      const history = await app.inject({ url: `/v1/creator/works/${workId}/releases`, headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(history.statusCode, 200);
      assert.equal(history.json().data.length, 2);
      assert.equal(history.json().data[0].id, published.releaseId);
      const withdrawKey = `withdraw-work-${Date.now()}`;
      const withdrawHeaders = { authorization: `Bearer ${authorAuth.accessToken}`, 'idempotency-key': withdrawKey, 'if-match': `"work-${workId}-${detail.json().data.revision}"` };
      const withdrawn = await app.inject({ method: 'POST', url: `/v1/creator/works/${workId}/withdraw`, headers: withdrawHeaders });
      assert.equal(withdrawn.statusCode, 200, withdrawn.body);
      assert.equal(withdrawn.json().data.state, 'withdrawn');
      assert.equal(withdrawn.json().data.visibility, 'private');
      assert.equal((await app.inject({ method: 'POST', url: `/v1/creator/works/${workId}/withdraw`, headers: withdrawHeaders })).statusCode, 200);
      const withdrawnTarget = (await pool.query("SELECT state,current_release_id,publish_generation::int AS generation FROM work_targets WHERE work_id=$1 AND target_key='web'", [workId])).rows[0];
      assert.equal(withdrawnTarget.state, 'withdrawn');
      assert.equal(withdrawnTarget.current_release_id, null);
      assert.equal(withdrawnTarget.generation, 3);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM releases WHERE work_id=$1 AND serving_state='enabled'", [workId])).rows[0].count, 0);
      assert.equal((await runtimeEdgeApp.inject({ url: '/', headers: { host: releaseHost } })).statusCode, 404);
      assert.equal((await runtimeEdgeApp.inject({ url: '/assets/game.js', headers: { host: releaseHost, 'if-none-match': runtimeScript.headers.etag } })).statusCode, 404);
      assert.equal((await app.inject({ url: `/v1/works/${workId}` })).statusCode, 404);

      const usage = (await pool.query('SELECT stored_bytes,reserved_bytes,active_uploads FROM creator_usage WHERE user_id=$1', [authorAuth.profile.id])).rows[0];
      const accounted = (await pool.query(`SELECT COALESCE(sum(u.actual_bytes+r.expanded_bytes),0) AS bytes FROM upload_jobs u JOIN releases r ON r.upload_job_id=u.id WHERE u.owner_user_id=$1`, [authorAuth.profile.id])).rows[0];
      assert.equal(Number(usage.stored_bytes), Number(accounted.bytes));
      assert.equal(Number(usage.reserved_bytes), 0);
      assert.equal(usage.active_uploads, 0);

      const logout = await app.inject({ method: 'POST', url: '/v1/auth/device/logout', headers: { authorization: `Bearer ${authorAuth.accessToken}` } });
      assert.equal(logout.statusCode, 200);
      assert.equal((await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${authorAuth.accessToken}` } })).statusCode, 401);
    } finally { await Promise.all([app.close(), runtimeEdgeApp.close()]); }
  } finally { await database.close(); }
});
