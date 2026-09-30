const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/github-app-client.mjs'));
const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
});

test('GitHub App client signs app JWTs and keeps installation tokens out of returned data', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/app/installations/42/access_tokens')) return response(201, { token: 'installation-secret-token', expires_at: '2099-01-01T00:00:00Z' });
    if (url.includes('/installation/repositories')) return response(200, { repositories: [{ id: 7, node_id: 'R_7', owner: { login: 'cat' }, name: 'desk-cat', full_name: 'cat/desk-cat', default_branch: 'main', private: true, visibility: 'private', html_url: 'https://github.com/cat/desk-cat' }] });
    throw new Error(`unexpected ${url}`);
  };
  const { createGitHubAppClient } = await import(moduleUrl);
  const client = createGitHubAppClient({ appId: '123', privateKey: pem, slug: 'gamehub-source', fetchImpl });
  const result = await client.listRepositories('42');
  assert.equal(result.repositories[0].visibility, 'private');
  assert.equal(result.complete, true);
  assert.equal(JSON.stringify(result).includes('installation-secret-token'), false);
  const jwt = calls[0].options.headers.Authorization.replace('Bearer ', '');
  assert.equal(jwt.split('.').length, 3);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer installation-secret-token');
  assert.equal(client.installUrl('safe-state'), 'https://github.com/apps/gamehub-source/installations/new?state=safe-state');
});

test('GitHub App client maps upstream rate limits to a retryable platform error', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { createGitHubAppClient, GitHubAppClientError } = await import(moduleUrl);
  const client = createGitHubAppClient({
    appId: '123', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), slug: 'gamehub-source',
    fetchImpl: async () => response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }),
  });
  await assert.rejects(client.getInstallation('42'), error => error instanceof GitHubAppClientError && error.code === 'GITHUB_RATE_LIMITED' && error.retryable);
});
