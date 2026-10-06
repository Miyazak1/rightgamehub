import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiClient } from '../packages/platform-api-client/src/index.mjs';
import { createSaveBridge } from '../tests/helpers/game-save-bridge.cjs';
const stateRoot = new URL('../.runtime/adarkroom-installed/', import.meta.url);
const session = JSON.parse(await fs.readFile(new URL('session.json', stateRoot), 'utf8'));
const baseUrl = 'http://127.0.0.1:3086';
assert.equal(session.url, baseUrl + '/');
const anonymous = createApiClient({ baseUrl });
const bridges = [], accounts = [], checks = [];
const pass = text => { checks.push(text); console.log('PASS ' + text); };
async function login(email, clientKind) {
  let challenge;
  try { challenge = (await anonymous.createChallenge({ email, clientKind })).data; }
  catch (error) {
    if (error.code !== 'RATE_LIMITED') throw error;
    console.log('Waiting for the real 60-second OTP resend limit...');
    await delay(60500);
    challenge = (await anonymous.createChallenge({ email, clientKind })).data;
  }
  const mailbox = JSON.parse(await fs.readFile(new URL('mailbox.json', stateRoot), 'utf8'));
  const verify = await fetch(baseUrl + '/v1/auth/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.challengeId, code: mailbox[email].code, deviceLabel: 'ADR automated ' + clientKind }) });
  assert.equal(verify.status, 200);
  let tokens = (await verify.json()).data;
  const identity = () => JSON.stringify([tokens.profile.id, tokens.grantId]);
  const api = createApiClient({ baseUrl, getAccessToken: () => tokens.accessToken, getRefreshToken: () => tokens.refreshToken, setTokens: value => { tokens = value; } });
  const account = { api, identity, tokens: () => tokens };
  accounts.push(account);
  return account;
}
async function bridge(account, descriptor) {
  const item = await createSaveBridge({ api: account.api, descriptor, identity: account.identity, cloudSaveTimeoutMs: 10000 });
  bridges.push(item); return item.client.cloudSave;
}
try {
  const cursor = await login(session.emails[0], 'cursor');
  const other = await login(session.emails[1], 'browser');
  assert.notEqual(cursor.tokens().profile.id, other.tokens().profile.id);
  const work = (await cursor.api.getWork(session.workId)).data;
  assert.equal(work.id, session.workId);
  const descriptor = (await cursor.api.getLaunch(session.workId)).data;
  assert.equal(descriptor.capabilities.cloudSave, true);
  pass('real OTP authentication and PostgreSQL catalog launch');
  const c = await bridge(cursor, descriptor), b = await bridge(other, descriptor);
  const resource = { namespace: 'default', slot: 'acceptance-' + crypto.randomUUID() };
  const data = JSON.parse(await fs.readFile(new URL('../samples/adarkroom/fixtures/observed/pre-ending.json', import.meta.url), 'utf8'));
  const first = await c.write({ ...resource, createOnly: true, idempotencyKey: crypto.randomUUID(), schemaVersion: 1, data });
  assert.deepEqual((await c.read(resource)).data, data);
  assert.equal(await b.read(resource), null);
  pass('real authenticated SDK, chunked HTTP save/read, and account isolation');
  const before = cursor.tokens();
  const refresh = await fetch(baseUrl + '/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: before.refreshToken }) });
  assert.equal(refresh.status, 200);
  const refreshed = (await refresh.json()).data;
  assert.equal(refreshed.grantId, before.grantId);
  // Exercise the API client's actual automatic refresh with an invalid access token.
  // Keep its legitimate rotated refresh token; no database/auth stub.
  before.accessToken = 'invalid-access-token-for-local-test-000000';
  before.refreshToken = refreshed.refreshToken;
  assert.deepEqual((await c.read(resource)).data, data);
  assert.notEqual(cursor.tokens().accessToken, before.accessToken);
  assert.equal(cursor.tokens().grantId, before.grantId);
  pass('access-token refresh preserves the existing game identity');

  const web = await login(session.emails[0], 'browser');
  assert.equal(web.tokens().profile.id, cursor.tokens().profile.id);
  assert.notEqual(web.tokens().grantId, cursor.tokens().grantId);
  const w = await bridge(web, descriptor);
  assert.deepEqual((await w.read(resource)).data, data);
  const second = await w.write({ ...resource, expectedEtag: first.etag, idempotencyKey: crypto.randomUUID(), schemaVersion: 1, data: { stage: 'web continuation' } });
  await assert.rejects(c.write({ ...resource, expectedEtag: first.etag, idempotencyKey: crypto.randomUUID(), schemaVersion: 1, data: { stage: 'stale cursor' } }), { code: 'SAVE_CONFLICT' });
  assert.equal((await c.read(resource)).etag, second.etag);
  pass('different real device grants resume the same account and reject stale CAS');
  await web.api.revokeDevice(cursor.tokens().grantId);
  await assert.rejects(c.read(resource), error => ['TOKEN_INVALID','REFRESH_INVALID','BRIDGE_CLOSED','GAME_SESSION_INVALID'].includes(error.code) || error.status === 401);
  assert.deepEqual((await w.read(resource)).data, { stage: 'web continuation' });
  pass('revoking a real device blocks its save bridge without affecting the other device');
  await w.delete({ ...resource, expectedEtag: second.etag, idempotencyKey: crypto.randomUUID() });
  await fs.writeFile(new URL('verification.json', stateRoot), JSON.stringify({ at: new Date().toISOString(), workId: session.workId, checks }, null, 2));
} finally {
  for (const item of bridges) item.close();
  for (const account of accounts) await account.api.logout({ allowRefresh: false }).catch(() => {});
}
