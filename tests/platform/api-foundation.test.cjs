const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  assert.deepEqual(config.corsOrigins, []);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), CORS_ORIGINS: 'http://127.0.0.1:3081/path' }), /without paths/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32), GITHUB_CLIENT_SECRET: 'secret' }), /GITHUB_CLIENT_ID/);
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
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true },
    migrations: { status: async () => ({ ready: true, applied: 10, expected: 10, reason: null }) },
    authService: { requestChallenge: async () => ({}), verifyChallenge: async () => ({}) },
  });
  t.after(() => app.close());
  const response = await app.inject({ url: '/ready' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, 'ready');
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
