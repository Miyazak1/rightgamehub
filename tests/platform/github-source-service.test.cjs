const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/github-source-service.mjs'));
const actor = { userId: crypto.randomUUID(), scopes: ['works:read','works:write'], profile: { canPublish: true, role: 'user' } };
const connection = { id: crypto.randomUUID(), installationId: '42', status: 'active' };
const repo = { id: crypto.randomUUID(), connectionId: connection.id, repositoryId: '7', owner: 'cat', name: 'desk-cat', defaultBranch: 'main', visibility: 'private', htmlUrl: 'https://github.com/cat/desk-cat', accessState: 'active' };

test('source preview is fixed to a commit, sanitizes README and records license evidence', async () => {
  const captured = {};
  const repository = {
    getConnection: async () => connection,
    getRepository: async () => repo,
    savePreview: async input => { Object.assign(captured, input); return { importId: input.id, repository: input.repository, commitSha: input.commitSha }; },
  };
  const githubClient = { previewRepository: async () => ({
    repo: { repositoryId: '7', description: 'A cat', topics: ['game'] }, commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40),
    readme: '<script>alert(1)</script> ![tracker](https://evil.invalid/pixel) [bad](javascript:alert(1))\nHello',
    license: { path: 'LICENSE', encoding: 'base64', content: Buffer.from('MIT License').toString('base64'), license: { spdx_id: 'MIT' } },
    rootNames: ['index.html','package.json','vite.config.js'],
  }) };
  const { createGitHubSourceService } = await import(moduleUrl);
  const service = createGitHubSourceService({ repository, githubClient, enabled: true, webhookSecret: 'w'.repeat(32) });
  await service.preview(actor, { connectionId: connection.id, repositoryId: '7' });
  assert.equal(captured.commitSha, 'a'.repeat(40));
  assert.equal(captured.license.status, 'recognized');
  assert.equal(captured.license.spdx, 'MIT');
  assert.equal(captured.staticSignals.indexHtml, true);
  assert.doesNotMatch(captured.readmeExcerpt, /<script>|!\[/u);
  assert.match(captured.readmeExcerpt, /Hello/u);
});

test('source draft creation requires creator permission and an idempotency key', async () => {
  let input;
  const repository = { createDraft: async value => { input = value; return { work: { id: value.workId } }; } };
  const { createGitHubSourceService, GitHubSourceError } = await import(moduleUrl);
  const service = createGitHubSourceService({ repository, githubClient: {}, enabled: true, webhookSecret: 'w'.repeat(32) });
  await assert.rejects(service.createDraft(actor, { importId: crypto.randomUUID(), title: 'Desk Cat' }, 'short'), error => error instanceof GitHubSourceError && error.code === 'IDEMPOTENCY_KEY_REQUIRED');
  await service.createDraft(actor, { importId: crypto.randomUUID(), title: 'Desk Cat', kind: 'game' }, 'github-import-key-1234');
  assert.equal(input.actor.userId, actor.userId);
  assert.equal(input.kind, 'game');
  assert.equal(input.attributionKind, 'publisher');
  assert.match(input.requestHash, /^[a-f0-9]{64}$/u);
});

test('only administrators can mark a GitHub import as a claimable catalog entry',async()=>{
  const {createGitHubSourceService,GitHubSourceError}=await import(moduleUrl);
  const received=[];
  const service=createGitHubSourceService({repository:{createDraft:async input=>(received.push(input),{work:{id:input.workId}})},githubClient:{},enabled:true,webhookSecret:'w'.repeat(32)});
  const request={importId:crypto.randomUUID(),title:'Catalog game',attributionKind:'community_catalog'};
  await assert.rejects(service.createDraft(actor,request,'github-catalog-user'),error=>error instanceof GitHubSourceError&&error.code==='ATTRIBUTION_INVALID');
  await service.createDraft({...actor,profile:{...actor.profile,role:'admin'}},request,'github-catalog-admin');
  assert.equal(received[0].attributionKind,'community_catalog');
});

test('an already imported commit restores its existing draft without incrementing usage', async () => {
  const workId = crypto.randomUUID();
  const importId = crypto.randomUUID();
  const now = new Date();
  let usageChecked = false;
  const work = {
    id: workId, owner_user_id: actor.userId, title: 'Desk Cat', description: '', instructions: '', kind: 'game', state: 'draft', visibility: 'private',
    revision: 1, first_published_at: null, estimated_minutes: 3, tags: ['github-import'], agent_label: null, repository_url: null, license_spdx: null,
  };
  const source = {
    work_id: workId, provider: 'github', repository_id: '7', repository_node_id: 'node-7', repository_visibility: 'private', owner_login: 'cat',
    repository_name: 'desk-cat', repository_url: 'https://github.com/cat/desk-cat', default_branch: 'main', commit_sha: 'a'.repeat(40), tree_sha: 'b'.repeat(40),
    source_status: 'active', provenance: {}, created_at: now, updated_at: now,
  };
  const client = { release() {}, async query(sql) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock') || sql.includes('INSERT INTO idempotency_keys')) return { rows: [] };
    if (sql.includes("operation='github_source.draft'")) return { rows: [] };
    if (sql.includes('SELECT status,can_publish FROM users')) return { rows: [{ status: 'active', can_publish: true }] };
    if (sql.includes('FROM github_source_imports i JOIN')) return { rows: [{ id: importId, work_id: workId, connection_status: 'active', access_state: 'active' }] };
    if (sql.includes('SELECT * FROM works')) return { rows: [work] };
    if (sql.includes('SELECT * FROM work_sources')) return { rows: [source] };
    if (sql.includes('creator_usage')) { usageChecked = true; return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const { PostgresGitHubSourceRepository } = await import(moduleUrl);
  const repository = new PostgresGitHubSourceRepository({ connect: async () => client });
  const result = await repository.createDraft({ actor, importId, title: 'Ignored', description: '', kind: 'game', workId: crypto.randomUUID(), idempotencyKey: 'restore-existing-draft', requestHash: 'hash' });
  assert.equal(result.work.id, workId);
  assert.equal(result.source.workId, workId);
  assert.equal(usageChecked, false);
});

test('installation completion accepts only a recent read-only GitHub App installation', async () => {
  let consumed = false;
  const repository = { consumeInstallState: async () => { consumed = true; return connection; } };
  const { createGitHubSourceService, GitHubSourceError } = await import(moduleUrl);
  const base = { installationId: '42', accountId: '7', accountLogin: 'cat', accountType: 'User', repositorySelection: 'selected', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), suspendedAt: null };
  const bad = createGitHubSourceService({ repository, githubClient: { getInstallation: async () => ({ ...base, permissions: { metadata: 'read', contents: 'write' } }) }, enabled: true, webhookSecret: 'w'.repeat(32) });
  await assert.rejects(bad.completeInstall(actor, { installationId: '42', state: 's'.repeat(43) }), error => error instanceof GitHubSourceError && error.code === 'GITHUB_APP_PERMISSIONS_INVALID');
  const good = createGitHubSourceService({ repository, githubClient: { getInstallation: async () => ({ ...base, permissions: { metadata: 'read', contents: 'read' } }) }, enabled: true, webhookSecret: 'w'.repeat(32) });
  await good.completeInstall(actor, { installationId: '42', state: 's'.repeat(43) });
  assert.equal(consumed, true);
});

test('webhook signatures are verified and delivery replays are idempotent', async () => {
  const secret = 'webhook-secret-that-is-at-least-32-bytes';
  let begins = 0; let applied = 0;
  const repository = {
    beginWebhook: async () => { begins += 1; return begins === 1; },
    applyInstallationEvent: async () => { applied += 1; },
    finishWebhook: async () => {},
  };
  const { createGitHubSourceService, GitHubSourceError } = await import(moduleUrl);
  const service = createGitHubSourceService({ repository, githubClient: {}, enabled: true, webhookSecret: secret });
  const body = Buffer.from(JSON.stringify({ action: 'suspend', installation: { id: 42 } }));
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const headers = { 'x-hub-signature-256': signature, 'x-github-delivery': 'delivery_1', 'x-github-event': 'installation' };
  assert.deepEqual(await service.handleWebhook(headers, body), { accepted: true, replay: false });
  assert.deepEqual(await service.handleWebhook(headers, body), { accepted: true, replay: true });
  assert.equal(applied, 1);
  await assert.rejects(service.handleWebhook({ ...headers, 'x-hub-signature-256': 'sha256=bad' }, body), error => error instanceof GitHubSourceError && error.code === 'GITHUB_WEBHOOK_SIGNATURE_INVALID');
});

test('disabled source import fails closed before calling GitHub', async () => {
  const { createGitHubSourceService, GitHubSourceError } = await import(moduleUrl);
  const service = createGitHubSourceService({ repository: {}, githubClient: null, enabled: false, webhookSecret: null });
  await assert.rejects(service.listConnections(actor), error => error instanceof GitHubSourceError && error.code === 'GITHUB_SOURCE_IMPORT_DISABLED');
});

test('an imported work with unresolved license is forced to draft-only upload', async () => {
  const { PostgresUploadRepository } = await import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src/upload-repository.mjs')));
  let uploadParameters; let publishGenerationUpdated = false;
  const client = { release() {}, async query(sql, parameters = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes("operation='upload.create'")) return { rows: [] };
    if (sql.includes('SELECT w.id,w.state')) return { rows: [{ id: 'work', state: 'draft', source_import_id: 'import', license_status: 'unknown' }] };
    if (sql.includes("UPDATE upload_jobs SET state='expired'")) return { rows: [] };
    if (sql.includes('SELECT * FROM creator_usage')) return { rows: [{ active_uploads: 0, stored_bytes: 0, reserved_bytes: 0 }] };
    if (sql.includes('SELECT publish_generation')) return { rows: [{ publish_generation: 0 }] };
    if (sql.includes('UPDATE work_targets SET publish_generation')) { publishGenerationUpdated = true; return { rows: [] }; }
    if (sql.includes('INSERT INTO upload_jobs')) {
      uploadParameters = parameters;
      return { rows: [{ id: parameters[0], work_id: parameters[2], target_key: parameters[3], package_type: parameters[4], state: 'created', publication_outcome: 'pending', declared_bytes: parameters[7], actual_bytes: null, created_at: new Date(), expires_at: new Date(Date.now() + 1000), error_code: null }] };
    }
    return { rows: [] };
  } };
  const repository = new PostgresUploadRepository({ connect: async () => client });
  await repository.createIdempotent({
    actor: { userId: 'user' }, idempotencyKey: 'github-license-gate', requestHash: 'hash', uploadId: 'upload', workId: 'work', declaredBytes: 10, objectKey: 'object',
    body: { targetKey: 'web', packageType: 'web_zip', fileName: 'game.zip', releaseLabel: '1.0.0', sha256: 'a'.repeat(64), autoPublish: true },
  });
  assert.equal(uploadParameters[10], false);
  assert.equal(uploadParameters[11], null);
  assert.equal(publishGenerationUpdated, false);
});
