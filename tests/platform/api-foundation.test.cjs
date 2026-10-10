const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = file => pathToFileURL(path.join(root, 'apps/api/src', file));

test('configuration fails closed for missing database and weak OTP keys', async () => {
  const { loadConfig } = await import(moduleUrl('config.mjs'));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', OTP_HMAC_KEY: 'short' }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'short' }), /OTP_HMAC_KEY/);
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), API_PORT: '3091' });
  assert.equal(config.port, 3091);
  assert.equal(config.requestBodyLimit, 65536);
  assert.equal(config.validatorExecutionMode, 'local');
  assert.equal(config.storageWarnPercent, 70);
  assert.equal(config.storageBlockPercent, 85);
  assert.equal(config.rulesManifestPath, null);
  assert.deepEqual(config.rulesTrustedKeys, {});
  assert.deepEqual(config.corsOrigins, []);
  assert.equal(config.githubSourceImportEnabled, false);
  assert.equal(config.sourceBuildEnabled, false);
  assert.equal(config.sourceBuilderExecutionMode, 'local');
  assert.equal(config.ruleBuildEnabled, false);
  assert.equal(config.ruleBuilderExecutionMode, 'local');
  const production = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), REALTIME_PUBLIC_URL: 'wss://example.com/v1/realtime' });
  assert.equal(production.validatorExecutionMode, 'isolated');
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), VALIDATOR_EXECUTION_MODE: 'local' }), /must be isolated/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), VALIDATOR_EXECUTION_MODE: 'unsafe' }), /VALIDATOR_EXECUTION_MODE/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), STORAGE_WARN_PERCENT: '90', STORAGE_BLOCK_PERCENT: '85' }), /must be lower/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), OBJECT_STORAGE_PROVIDER: 'aliyun-oss' }), /OSS_REGION/);
  const oss = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32),
    OBJECT_STORAGE_PROVIDER: 'aliyun-oss', OSS_REGION: 'oss-ap-southeast-1',
    OSS_ENDPOINT: 'https://oss-ap-southeast-1-internal.aliyuncs.com',
    OSS_BUCKET: 'gamehub-prod-sg-mooyu', OSS_ECS_ROLE_NAME: 'GameHubEcsOssRole',
  });
  assert.equal(oss.objectStorageProvider, 'aliyun-oss');
  assert.equal(oss.ossBucket, 'gamehub-prod-sg-mooyu');
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), CORS_ORIGINS: 'http://127.0.0.1:3081/path' }), /without paths/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), GITHUB_CLIENT_SECRET: 'secret' }), /GITHUB_CLIENT_ID/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), REALTIME_PUBLIC_URL: 'wss://example.com/v1/realtime', RULES_ALLOW_UNSIGNED: 'true' }), /cannot be enabled/u);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), RULES_TRUSTED_KEYS_JSON: '{bad' }), /valid JSON/u);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), GITHUB_SOURCE_IMPORT_ENABLED: 'true' }), /GITHUB_APP_ID/);
  const privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const githubImport = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), GITHUB_SOURCE_IMPORT_ENABLED: 'true',
    GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_WEBHOOK_SECRET: 'w'.repeat(32),
    GITHUB_APP_SLUG: 'gamehub-source-import', GITHUB_APP_CALLBACK_URL: 'http://127.0.0.1:5173/#/creator/import',
  });
  assert.equal(githubImport.githubSourceImportEnabled, true);
  assert.equal(githubImport.githubAppId, '12345');
  const sourceBuild = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), GITHUB_SOURCE_IMPORT_ENABLED: 'true', SOURCE_BUILD_ENABLED: 'true',
    GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_WEBHOOK_SECRET: 'w'.repeat(32),
    GITHUB_APP_SLUG: 'gamehub-source-import', GITHUB_APP_CALLBACK_URL: 'http://127.0.0.1:5173/#/creator/import',
  });
  assert.equal(sourceBuild.sourceBuildEnabled, true);
  assert.equal(sourceBuild.sourceBuilderImageDigest, 'development-unpinned');
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), SOURCE_BUILD_ENABLED: 'true' }), /GITHUB_SOURCE_IMPORT_ENABLED/);
  const ruleBuild = loadConfig({ NODE_ENV: 'test',DATABASE_URL: 'postgres://db/test',OTP_HMAC_KEY: 'x'.repeat(32),RULE_BUILD_ENABLED: 'true' });
  assert.equal(ruleBuild.ruleBuildEnabled,true);
  assert.equal(ruleBuild.ruleBuilderImageDigest,'development-unpinned');
  assert.throws(() => loadConfig({ NODE_ENV: 'production',DATABASE_URL: 'postgres://db/test',OTP_HMAC_KEY: 'x'.repeat(32),REALTIME_PUBLIC_URL: 'wss://example.com/v1/realtime',RULE_BUILD_ENABLED: 'true' }), /RULE_BUILDER_IMAGE_DIGEST/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production',DATABASE_URL: 'postgres://db/test',OTP_HMAC_KEY: 'x'.repeat(32),REALTIME_PUBLIC_URL: 'wss://example.com/v1/realtime',RULE_BUILD_ENABLED: 'true',RULE_BUILDER_EXECUTION_MODE: 'local',RULE_BUILDER_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}` }), /must be isolated/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), REALTIME_PUBLIC_URL: 'wss://example.com/v1/realtime', GITHUB_SOURCE_IMPORT_ENABLED: 'true',
    GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_WEBHOOK_SECRET: 'w'.repeat(32),
    GITHUB_APP_SLUG: 'gamehub-source-import', GITHUB_APP_CALLBACK_URL: 'http://example.com/#/creator/import',
  }), /must use HTTPS/);
});

test('GitHub OAuth callback accepts the GitHub authorization issuer', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  let callbackQuery;
  const app = createApp({
    config: { requestBodyLimit: 65536 },
    database: { ping: async () => true },
    migrations: { status: async () => ({ ready: true }) },
    authService: {
      completeGitHubWeb: async query => {
        callbackQuery = query;
        return { status: 'complete' };
      },
    },
  });
  t.after(() => app.close());

  const issuer = 'https://github.com/login/oauth';
  const response = await app.inject({
    method: 'GET',
    url: `/v1/auth/github/web/callback?code=oauth-code&state=${'s'.repeat(32)}&iss=${encodeURIComponent(issuer)}`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(callbackQuery.iss, issuer);
  assert.match(response.body, /已连接 GameHub/);
  assert.match(response.body, /setTimeout\(closePage,700\)/);
  const nonce = response.headers['content-security-policy'].match(/script-src 'nonce-([^']+)'/u)?.[1];
  assert.ok(nonce);
  assert.match(response.body, new RegExp(`<script nonce="${nonce}">`));
});

test('public profile reads are anonymous while profile edits require the current account', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const { AuthError } = await import(moduleUrl('auth-service.mjs'));
  const actor = { userId: crypto.randomUUID(), scopes: ['profile:read'] }; const calls = [];
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async authorization => { if (!authorization) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required.'); assert.equal(authorization, 'Bearer token'); return actor; } },
    publicProfileService: {
      get: async (viewer, handle) => { calls.push(['get', viewer, handle]); return { handle }; },
      update: async (viewer, body) => { calls.push(['update', viewer, body]); return body; },
    },
  });
  t.after(() => app.close());
  const read = await app.inject({ method: 'GET', url: '/v1/profiles/pixel-maker' });
  assert.equal(read.statusCode, 200); assert.equal(read.headers['cache-control'], 'public, max-age=60'); assert.equal(calls[0][1], null);
  const denied = await app.inject({ method: 'PATCH', url: '/v1/me/public-profile', payload: { handle: 'pixel-maker', headline: '', about: '', visibility: 'public', libraryVisibility: 'private', links: [], featuredWorkIds: [] } });
  assert.equal(denied.statusCode, 401);
  const updated = await app.inject({ method: 'PATCH', url: '/v1/me/public-profile', headers: { authorization: 'Bearer token' }, payload: { handle: 'pixel-maker', headline: '', about: '', visibility: 'public', libraryVisibility: 'private', links: [], featuredWorkIds: [] } });
  assert.equal(updated.statusCode, 200); assert.equal(updated.headers['cache-control'], 'no-store'); assert.equal(calls[1][1], actor);
});

test('creator work routes accept discovery metadata from the creation form', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  let received;
  const app = createApp({
    config: { requestBodyLimit: 65536 },
    database: { ping: async () => true },
    migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => ({ userId: crypto.randomUUID(), scopes: ['works:write'], profile: { canPublish: true } }) },
    workService: {
      create: async (_actor, body) => {
        received = body;
        return { work: { id: crypto.randomUUID(), ...body }, etag: '"work-test-1"' };
      },
    },
  });
  t.after(() => app.close());

  const payload = {
    title: '弹盒游戏', description: '弹盘游戏', instructions: '11', kind: 'game',
    estimatedMinutes: 3, tags: ['弹盘游戏'], agentLabel: null,
    repositoryUrl: null, licenseSpdx: null,
  };
  const response = await app.inject({
    method: 'POST', url: '/v1/creator/works',
    headers: { authorization: 'Bearer test-token-value-that-is-long-enough', 'idempotency-key': 'creator-form-test-key' },
    payload,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, payload);
});

test('creator analytics is authenticated and public work badges stay catalog-gated', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const { AuthError } = await import(moduleUrl('auth-service.mjs'));
  const workId = '00000000-0000-4000-8000-000000000777';
  const actor = { userId: 'creator-user', scopes: ['works:read'], profile: { canPublish: true } };
  const calls = [];
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async authorization => { if (!authorization) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required.'); return actor; } },
    analyticsService: { creatorOverview: async (viewer, query) => { calls.push(['analytics', viewer, query]); return { range: { days: 30 }, totals: {}, daily: [], works: [] }; }, overview: async () => ({}), record: async () => ({ accepted: 1 }) },
    catalogService: { get: async id => { calls.push(['catalog', id]); return { id, title: '公开游戏' }; } },
  });
  t.after(() => app.close());
  const denied = await app.inject({ method: 'GET', url: '/v1/creator/analytics?days=30' });
  assert.equal(denied.statusCode, 401);
  const analytics = await app.inject({ method: 'GET', url: '/v1/creator/analytics?days=30', headers: { authorization: 'Bearer token' } });
  assert.equal(analytics.statusCode, 200);
  assert.equal(calls[0][1], actor);
  assert.equal(calls[0][2].days, 30);
  const badge = await app.inject({ method: 'GET', url: `/v1/works/${workId}/badge.svg` });
  assert.equal(badge.statusCode, 200);
  assert.match(badge.headers['content-type'], /^image\/svg\+xml/u);
  assert.equal(badge.headers['x-content-type-options'], 'nosniff');
  assert.match(badge.body, /PLAY ON GAMEHUB/u);
  assert.deepEqual(calls[1], ['catalog', workId]);
});

test('GitHub source routes authenticate creators and preserve raw webhook bytes', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  let rawBody;
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => ({ userId: crypto.randomUUID(), scopes: ['works:write'], profile: { canPublish: true } }) },
    githubSourceService: {
      listConnections: async () => [{ id: crypto.randomUUID() }],
      handleWebhook: async (_headers, body) => { rawBody = body; return { accepted: true, replay: false }; },
    },
  });
  t.after(() => app.close());
  const list = await app.inject({ method: 'GET', url: '/v1/creator/source-connections', headers: { authorization: 'Bearer test-token-value-that-is-long-enough' } });
  assert.equal(list.statusCode, 200);
  const webhook = await app.inject({ method: 'POST', url: '/v1/webhooks/github', headers: { 'content-type': 'application/json' }, payload: '{"installation":{"id":42}}' });
  assert.equal(webhook.statusCode, 200);
  assert.ok(Buffer.isBuffer(rawBody));
  assert.equal(rawBody.toString(), '{"installation":{"id":42}}');
});

test('GitHub App setup callback safely redirects into the creator import route', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const app = createApp({
    config: { requestBodyLimit: 65536, githubSourceImportEnabled: true, githubAppCallbackUrl: 'https://mooyu.fun/#/creator/import' },
    database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) }, authService: {}, githubSourceService: {},
  });
  t.after(() => app.close());
  const state = 's'.repeat(43);
  const response = await app.inject({ method: 'GET', url: `/v1/integrations/github/setup?installation_id=42&setup_action=install&state=${state}` });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, `https://mooyu.fun/?state=${state}&installation_id=42&setup_action=install#/creator/import`);
});

test('explicit development origin receives CORS preflight and creator reads stay authenticated', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const works = [{ id: crypto.randomUUID(), title: 'Real work' }];
  const app = createApp({
    config: { requestBodyLimit: 65536, corsOrigins: ['http://127.0.0.1:3081'] },
    database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async header => header === 'Bearer valid' ? { userId: crypto.randomUUID(), scopes: ['works:read'], profile: {} } : null },
    workService: { list: async () => works },
  });
  t.after(() => app.close());
  const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/creator/works', headers: { origin: 'http://127.0.0.1:3081', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://127.0.0.1:3081');
  const listed = await app.inject({ url: '/v1/creator/works', headers: { origin: 'http://127.0.0.1:3081', authorization: 'Bearer valid' } });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().data, works);
});

test('development accepts VS Code webview origins without opening production CORS', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const app = createApp({
    config: { nodeEnv: 'development', requestBodyLimit: 65536, corsOrigins: [] },
    database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => null }, workService: { list: async () => [] },
  });
  t.after(() => app.close());
  const trusted = await app.inject({ method: 'OPTIONS', url: '/v1/creator/works', headers: { origin: 'vscode-webview://8f91a2b3-c4d5', 'access-control-request-method': 'GET' } });
  assert.equal(trusted.statusCode, 204);
  assert.equal(trusted.headers['access-control-allow-origin'], 'vscode-webview://8f91a2b3-c4d5');
  const untrusted = await app.inject({ method: 'OPTIONS', url: '/v1/creator/works', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(untrusted.headers['access-control-allow-origin'], undefined);

  const production = createApp({
    config: { nodeEnv: 'production', requestBodyLimit: 65536, corsOrigins: [] },
    database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => null }, workService: { list: async () => [] },
  });
  t.after(() => production.close());
  const blocked = await production.inject({ method: 'OPTIONS', url: '/v1/creator/works', headers: { origin: 'vscode-webview://8f91a2b3-c4d5', 'access-control-request-method': 'GET' } });
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);
});

test('health is liveness-only and readiness fails closed when database or schema is unavailable', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const config = { requestBodyLimit: 65536 };
  const authService = { requestChallenge: async () => ({}), verifyChallenge: async () => ({}) };
  const app = createApp({ config, database: { ping: async () => true }, migrations: { status: async () => ({ ready: false, reason: 'schema_missing' }) }, authService });
  t.after(() => app.close());
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  const notReady = await app.inject({ url: '/ready' });
  assert.equal(notReady.statusCode, 503);
  assert.equal(notReady.json().data.migrations.reason, 'schema_missing');
});

test('ready returns success only when database and migrations are current', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const rules = { installed: true,manifestSha256: 'a'.repeat(64),adapterCount: 1 };
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true },
    migrations: { status: async () => ({ ready: true, applied: 10, expected: 10, reason: null }) },
    authService: { requestChallenge: async () => ({}), verifyChallenge: async () => ({}) },
    rulesStatus: rules,
    rulesRegistry: { describe: () => ({ installed: true,manifestSha256: 'a'.repeat(64),adapterCount: 2 }) },
  });
  t.after(() => app.close());
  const response = await app.inject({ url: '/ready' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, 'ready');
  assert.deepEqual(response.json().data.rules,rules);
  assert.deepEqual(response.json().data.rules, rules);
});

test('authenticated users can create no-store realtime connection tickets', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const actor = { userId: crypto.randomUUID(), grantId: crypto.randomUUID(), scopes: ['works:read'] };
  let issuedFor;
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async header => header === 'Bearer valid' ? actor : null },
    realtimeTicketService: {
      ready: async () => true,
      issue: async value => {
        issuedFor = value;
        return { ticket: 't'.repeat(43), websocketUrl: 'wss://mooyu.fun/v1/realtime', expiresAt: new Date().toISOString(), protocol: 'gamehub.realtime.v1' };
      },
    },
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/v1/realtime/tickets', headers: { authorization: 'Bearer valid' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(issuedFor, actor);
  assert.equal(response.json().data.protocol, 'gamehub.realtime.v1');
});

test('multiplayer room routes keep creation authenticated and idempotent', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const actor = { userId: crypto.randomUUID(), profile: { role: 'user' } };
  const modeId = crypto.randomUUID();
  let creation;
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => actor },
    multiplayerRoomService: {
      listRooms: async () => [],
      createInvite: async () => ({ code: 'ABCDE-23456',expiresAt: new Date().toISOString() }),
      createRoom: async (receivedActor, body, idempotencyKey) => {
        creation = { receivedActor, body, idempotencyKey };
        return { id: crypto.randomUUID(), ...body, ownerUserId: receivedActor.userId, status: 'open', settings: body.settings ?? {}, revision: '0', expiresAt: new Date().toISOString(), createdAt: new Date().toISOString(), members: [], joinCode: null };
      },
    },
  });
  t.after(() => app.close());
  const listed = await app.inject({ url: `/v1/multiplayer/rooms?modeId=${modeId}` });
  assert.equal(listed.statusCode, 200);
  const created = await app.inject({
    method: 'POST', url: '/v1/multiplayer/rooms', headers: { authorization: 'Bearer valid', 'idempotency-key': 'room-create-test-0001' },
    payload: { modeId, visibility: 'public', capacity: 2, settings: { turnSeconds: 60 } },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.equal(creation.receivedActor, actor);
  assert.equal(creation.idempotencyKey, 'room-create-test-0001');
  const invited = await app.inject({ method: 'POST',url: `/v1/multiplayer/rooms/${created.json().data.id}/invite`,headers: { authorization: 'Bearer valid' } });
  assert.equal(invited.statusCode,200); assert.equal(invited.json().data.code,'ABCDE-23456');
});

test('multiplayer match routes authenticate starts and expose participant recovery reads', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const actor = { userId: crypto.randomUUID(), profile: { role: 'user' } };
  const roomId = crypto.randomUUID();
  const matchId = crypto.randomUUID();
  const calls = [];
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => actor },
    multiplayerMatchService: {
      startRoom: async (...args) => { calls.push(['start', ...args]); return { id: matchId, status: 'active' }; },
      getMatch: async (...args) => { calls.push(['get', ...args]); return { id: matchId, status: 'active' }; },
      listEvents: async (...args) => { calls.push(['events', ...args]); return [{ seq: '1', type: 'match.started' }]; },
      getReplay: async (...args) => { calls.push(['replay', ...args]); return { match: { id: matchId },events: [] }; },
      adminOverview: async (...args) => { calls.push(['overview', ...args]); return { overdueMatches: 0 }; },
      adminList: async (...args) => { calls.push(['adminList', ...args]); return []; },
      adminAbort: async (...args) => { calls.push(['abort', ...args]); return { match: { id: matchId,status: 'aborted' },event: {} }; },
      adminAudit: async (...args) => { calls.push(['audit', ...args]); return []; },
    },
  });
  t.after(() => app.close());
  const started = await app.inject({ method: 'POST', url: `/v1/multiplayer/rooms/${roomId}/start`, headers: { authorization: 'Bearer valid', 'idempotency-key': 'match-start-route-0001' } });
  const match = await app.inject({ url: `/v1/multiplayer/matches/${matchId}`, headers: { authorization: 'Bearer valid' } });
  const events = await app.inject({ url: `/v1/multiplayer/matches/${matchId}/events?afterSeq=7&limit=25`, headers: { authorization: 'Bearer valid' } });
  const replay = await app.inject({ url: `/v1/multiplayer/matches/${matchId}/replay`, headers: { authorization: 'Bearer valid' } });
  const overview = await app.inject({ url: '/v1/admin/multiplayer/overview',headers: { authorization: 'Bearer valid' } });
  const listed = await app.inject({ url: '/v1/admin/multiplayer/matches?status=active&limit=25',headers: { authorization: 'Bearer valid' } });
  const aborted = await app.inject({ method: 'POST',url: `/v1/admin/multiplayer/matches/${matchId}/abort`,headers: { authorization: 'Bearer valid' },payload: { reason: 'stuck' } });
  const audit = await app.inject({ url: '/v1/admin/multiplayer/audit?limit=20',headers: { authorization: 'Bearer valid' } });
  assert.deepEqual([started,match,events,replay,overview,listed,aborted,audit].map(response => response.statusCode), [200,200,200,200,200,200,200,200]);
  assert.ok([started,match,events,replay,overview,listed,aborted,audit].every(response => response.headers['cache-control'] === 'no-store'));
  assert.equal(calls[0][1], actor);
  assert.equal(calls[0][2], roomId);
  assert.equal(calls[0][3], 'match-start-route-0001');
  assert.deepEqual({ ...calls[2][3] }, { afterSeq: 7, limit: 25 });
  assert.deepEqual({ ...calls.find(call => call[0] === 'adminList')[2] }, { status: 'active',limit: 25 });
    const abortCall = calls.find(call => call[0] === 'abort');
    assert.equal(abortCall[2], matchId);
    assert.deepEqual(abortCall[3], { reason: 'stuck' });
});

test('multiplayer rule intake routes preserve the quarantine and human review boundary', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const actor = { userId: crypto.randomUUID(),scopes: ['upload'],profile: { role: 'admin',canPublish: true } };
  const workId = crypto.randomUUID(); const submissionId = crypto.randomUUID(); const buildId = crypto.randomUUID(); const calls = [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-rule-route-'));
  const builtPackage = path.join(directory,'adapter.cjs'); const builtBytes = Buffer.from('module.exports={};\n'); await fs.writeFile(builtPackage,builtBytes);
  const app = createApp({
    config: { requestBodyLimit: 65536 },database: { ping: async () => true },migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => actor },
    multiplayerRuleSubmissionService: {
      create: async (...args) => { calls.push(['create',...args]); return { id: submissionId,state: 'created' }; },
      grant: async (...args) => { calls.push(['grant',...args]); return { submissionId,token: 'x'.repeat(43) }; },
      receive: async (...args) => { let bytes=0; for await (const chunk of args[2]) bytes += chunk.length; calls.push(['receive',args[0],args[1],bytes]); return { id: submissionId,state: 'uploaded' }; },
      submit: async (...args) => { calls.push(['submit',...args]); return { id: submissionId,state: 'submitted' }; },
      listMine: async () => [],getMine: async () => ({ id: submissionId,state: 'submitted' }),adminList: async () => [{ id: submissionId,state: 'submitted' }],adminGet: async () => ({ id: submissionId,state: 'submitted' }),
      adminReview: async (...args) => { calls.push(['review',...args]); return { id: submissionId,state: 'in_review' }; },
      adminBuiltPackage: async (...args) => { calls.push(['builtPackage',...args]); return { content: await fs.readFile(builtPackage),fileName: 'duel-1.0.0.cjs',sha256: crypto.createHash('sha256').update(builtBytes).digest('hex'),bytes: String(builtBytes.length) }; },
    },
  });
  t.after(async () => { await app.close(); await fs.rm(directory,{ recursive: true,force: true }); });
  const payload = {
    modeKey: 'duel',modeName: '双人对战',rulesetVersion: '1.0.0',minPlayers: 2,maxPlayers: 2,modeConfig: { turnSeconds: 60 },fileName: 'source.zip',declaredBytes: '16',sha256: 'a'.repeat(64),
    creatorSubmission: { version: 1,workId,modeKey: 'duel',rulesetVersion: '1.0.0',authority: 'platform_authoritative',players: { min: 2,max: 2 } },
    doctorReport: { version: 1,ok: true,summary: { errors: 0,warnings: 1,info: 10 },findings: [] },
  };
  const created = await app.inject({ method: 'POST',url: `/v1/creator/works/${workId}/multiplayer-rule-submissions`,headers: { authorization: 'Bearer valid','idempotency-key': 'rules-create-route-0001' },payload });
  const granted = await app.inject({ method: 'POST',url: `/v1/creator/multiplayer-rule-submissions/${submissionId}/grant`,headers: { authorization: 'Bearer valid' } });
  const uploaded = await app.inject({ method: 'PUT',url: `/v1/creator/multiplayer-rule-submissions/${submissionId}/package`,headers: { authorization: `Upload ${'x'.repeat(43)}`,'content-type': 'application/zip' },payload: Buffer.from('PK\x03\x04route-test') });
  const submitted = await app.inject({ method: 'POST',url: `/v1/creator/multiplayer-rule-submissions/${submissionId}/submit`,headers: { authorization: 'Bearer valid','idempotency-key': 'rules-submit-route-0001' } });
  const queue = await app.inject({ url: '/v1/admin/multiplayer/rule-submissions?state=queue&limit=20',headers: { authorization: 'Bearer valid' } });
  const reviewed = await app.inject({ method: 'POST',url: `/v1/admin/multiplayer/rule-submissions/${submissionId}/review`,headers: { authorization: 'Bearer valid' },payload: { action: 'start' } });
  const downloaded = await app.inject({ url: `/v1/admin/multiplayer/rule-builds/${buildId}/package`,headers: { authorization: 'Bearer valid' } });
  assert.deepEqual([created,granted,uploaded,submitted,queue,reviewed,downloaded].map(response => response.statusCode),[200,200,200,200,200,200,200]);
  assert.ok([created,granted,uploaded,submitted,queue,reviewed].every(response => response.headers['cache-control'] === 'no-store'));
  assert.equal(calls.find(call => call[0] === 'create')[4],'rules-create-route-0001');
  assert.equal(calls.find(call => call[0] === 'receive')[3],Buffer.byteLength('PK\x03\x04route-test'));
  assert.equal(calls.find(call => call[0] === 'review')[3].action,'start');
  assert.equal(calls.find(call => call[0] === 'builtPackage')[2],buildId);
  assert.equal(downloaded.headers['content-type'],'application/javascript');
  assert.match(downloaded.headers.digest,/^sha-256=/u);
  assert.deepEqual(downloaded.rawPayload,builtBytes);
});

test('auth routes reject unknown fields and keep sensitive responses out of caches', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: {
      requestChallenge: async () => ({ challengeId: crypto.randomUUID(), expiresAt: new Date().toISOString(), resendAfter: new Date().toISOString() }),
      verifyChallenge: async () => ({ accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43) }),
    },
  });
  t.after(() => app.close());
  const invalid = await app.inject({ method: 'POST', url: '/v1/auth/email/challenges', payload: { email: 'a@example.com', clientKind: 'harness', extra: true } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'SCHEMA_INVALID');
  assert.match(invalid.json().error.requestId, /^[0-9a-f-]{36}$/);
  const valid = await app.inject({ method: 'POST', url: '/v1/auth/email/challenges', payload: { email: 'a@example.com', clientKind: 'harness' } });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.headers['cache-control'], 'no-store');
});


test('release content route overrides the small JSON body limit for binary packages', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  let received = 0;
  const app = createApp({
    config: { requestBodyLimit: 1024 },
    database: { ping: async () => true },
    migrations: { status: async () => ({ ready: true }) },
    authService: {},
    uploadService: {
      receive: async (_uploadId, _authorization, stream) => {
        for await (const chunk of stream) received += chunk.length;
        return { id: _uploadId, state: 'uploaded' };
      },
    },
  });
  t.after(() => app.close());
  const uploadId = crypto.randomUUID();
  const payload = Buffer.alloc(2 * 1024 * 1024, 1);
  const response = await app.inject({
    method: 'PUT',
    url: `/v1/creator/uploads/${uploadId}/content`,
    headers: { authorization: `Upload ${'a'.repeat(43)}`, 'content-type': 'application/octet-stream' },
    payload,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(received, payload.length);
});
