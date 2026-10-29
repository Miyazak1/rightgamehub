const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const response = (status, data) => new Response(JSON.stringify(data), { status,
  headers: { 'content-type': 'application/json' } });
const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

test('node client persists pairing and rotates a rejected session before retrying', async () => {
  const api = await import(executorUrl), vault = api.createMemoryCredentialVault(), calls = [];
  const queue = [response(200, { data: { accessToken: 'access-v1', renewalToken: 'renew-v1' } }),
    response(401, { error: { code: 'EXECUTION_NODE_ACCESS_EXPIRED' } }),
    response(200, { data: { accessToken: 'access-v2', renewalToken: 'renew-v2' } }),
    response(200, { data: { nodeId: 'node-1' } })];
  const client = api.createExecutionNodeApiClient({ baseUrl: 'https://mooyu.fun/',
    credentialVault: vault, fetchImpl: async (url, init) => {
      calls.push({ url, init }); return queue.shift();
    } });
  await client.pair({ pairingCode: 'PAIR-CODE', node: {} });
  assert.deepEqual(await client.snapshot(), { nodeId: 'node-1' });
  assert.match(calls[1].init.headers.authorization, /access-v1/u);
  assert.equal(JSON.parse(calls[2].init.body).renewalToken, 'renew-v1');
  assert.match(calls[3].init.headers.authorization, /access-v2/u);
  assert.equal(await vault.load('execution-node-session-v1-refresh-intent-v1'), null);
  assert.deepEqual(JSON.parse(await vault.load('execution-node-session-v1')),
    { accessToken: 'access-v2', renewalToken: 'renew-v2' });
});

test('uncertain token rotation fails closed and requires explicit re-pairing', async () => {
  const api = await import(executorUrl), vault = api.createMemoryCredentialVault();
  let calls = 0;
  const client = api.createExecutionNodeApiClient({ baseUrl: 'https://mooyu.fun/',
    credentialVault: vault, fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return response(200, { data: { accessToken: 'access-v1', renewalToken: 'renew-v1' } });
      if (calls === 2) return response(401, { error: { code: 'EXECUTION_NODE_ACCESS_EXPIRED' } });
      throw new Error('connection lost after refresh may have reached the server');
    } });
  await client.pair({ pairingCode: 'PAIR-CODE', node: {} });
  await assert.rejects(client.snapshot(), /connection lost/u);
  assert.ok(await vault.load('execution-node-session-v1-refresh-intent-v1'));
  await assert.rejects(client.snapshot(), error => error.code === 'CAPABILITY_NODE_SESSION_REFRESH_UNCERTAIN');
  assert.equal(calls, 3);
  await client.clearSession();
  assert.equal(await vault.load('execution-node-session-v1-refresh-intent-v1'), null);
});

test('Windows credential vault protects secrets with the current-user DPAPI',
  { skip: process.platform !== 'win32' }, async t => {
    const api = await import(executorUrl), directory = await tempRoot('dpapi-');
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const vault = api.createWindowsDpapiCredentialVault({ directory });
    const secret = 'renewal-token-只属于当前 Windows 用户';
    await vault.store('session', secret);
    const files = await fs.promises.readdir(directory);
    assert.equal(files.length, 1);
    assert.doesNotMatch(await fs.promises.readFile(path.join(directory, files[0]), 'utf8'), /renewal-token/u);
    assert.equal(await vault.load('session'), secret);
    await vault.store('session', `${secret}-rotated`);
    assert.equal(await vault.load('session'), `${secret}-rotated`);
    await vault.remove('session');
    assert.equal(await vault.load('session'), null);
  });
