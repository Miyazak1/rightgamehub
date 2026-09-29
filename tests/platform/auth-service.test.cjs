const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const serviceUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/auth-service.mjs'));
const key = 'test-only-key-with-at-least-32-bytes';
const fixedNow = new Date('2026-09-24T12:00:00.000Z');
const makeGif = (frames, delayCs = 10) => {
  const header = Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61,1,0,1,0,0x80,0,0,0,0,0,0xff,0xff,0xff]);
  const chunks = [header];
  for (let index = 0; index < frames; index += 1) chunks.push(Buffer.from([
    0x21,0xf9,0x04,0x01,delayCs & 0xff,(delayCs >>> 8) & 0xff,0,0,
    0x2c,0,0,0,0,1,0,1,0,0,0x02,0x02,0x44,0x01,0,
  ]));
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
};
const pngChunk = (type, data = Buffer.alloc(0)) => {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 4, 'ascii'); data.copy(chunk, 8);
  return chunk;
};
const makeApng = (frames, delayMs = 100) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const control = Buffer.alloc(8); control.writeUInt32BE(frames, 0);
  const chunks = [Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), pngChunk('IHDR', ihdr), pngChunk('acTL', control)];
  for (let index = 0; index < frames; index += 1) { const frame = Buffer.alloc(26); frame.writeUInt32BE(index, 0); frame.writeUInt32BE(1, 4); frame.writeUInt32BE(1, 8); frame.writeUInt16BE(delayMs, 20); frame.writeUInt16BE(1000, 22); chunks.push(pngChunk('fcTL', frame)); }
  chunks.push(pngChunk('IEND'));
  return Buffer.concat(chunks);
};
const webpChunk = (type, data) => { const chunk = Buffer.alloc(8 + data.length + (data.length & 1)); chunk.write(type, 0, 4, 'ascii'); chunk.writeUInt32LE(data.length, 4); data.copy(chunk, 8); return chunk; };
const makeAnimatedWebp = (frames, delayMs = 100) => {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02;
  const chunks = [webpChunk('VP8X', vp8x), webpChunk('ANIM', Buffer.alloc(6))];
  for (let index = 0; index < frames; index += 1) { const frame = Buffer.alloc(16); frame.writeUIntLE(delayMs, 12, 3); chunks.push(webpChunk('ANMF', frame)); }
  const payload = Buffer.concat(chunks); const header = Buffer.alloc(12); header.write('RIFF', 0, 4, 'ascii'); header.writeUInt32LE(payload.length + 4, 4); header.write('WEBP', 8, 4, 'ascii');
  return Buffer.concat([header, payload]);
};
const passthroughAvatarProcessor = async (body, inspected) => ({
  body, mediaType: inspected.mediaType, animated: inspected.animated,
  posterBody: body, posterMediaType: 'image/webp', width: 1, height: 1,
  frameCount: inspected.animated ? 2 : 1, durationMs: inspected.animated ? 200 : 0,
});

test('email challenge normalizes address, stores only HMAC and sends a six-digit code', async () => {
  const { createAuthService } = await import(serviceUrl);
  let stored; let sent;
  const service = createAuthService({
    repository: { createChallenge: async input => { stored = input; } },
    mailer: { sendVerificationCode: async input => { sent = input; } },
    otpHmacKey: key, clock: () => fixedNow, ids: () => '00000000-0000-4000-8000-000000000001',
  });
  const result = await service.requestChallenge({ email: ' Creator@Example.COM ', clientKind: 'cursor' });
  assert.equal(stored.emailNormalized, 'creator@example.com');
  assert.equal(stored.clientKind, 'cursor');
  assert.ok(Buffer.isBuffer(stored.codeHmac));
  assert.doesNotMatch(stored.codeHmac.toString('hex'), new RegExp(sent.code));
  assert.match(sent.code, /^[0-9]{6}$/);
  assert.equal(result.expiresAt, '2026-09-24T12:10:00.000Z');
});

test('invitation allowlist rejects unknown email before challenge creation or delivery', async () => {
  const { createAuthService, AuthError } = await import(serviceUrl);
  let created = false; let sent = false;
  const service = createAuthService({
    repository: { createChallenge: async () => { created = true; } },
    mailer: { sendVerificationCode: async () => { sent = true; } },
    otpHmacKey: key,
    loginEmailAllowlist: ['invited@example.com'],
    clock: () => fixedNow,
  });
  await assert.rejects(
    service.requestChallenge({ email: 'unknown@example.com', clientKind: 'browser' }),
    error => error instanceof AuthError && error.code === 'INVITE_REQUIRED' && error.statusCode === 403,
  );
  assert.equal(created, false);
  assert.equal(sent, false);
  await service.requestChallenge({ email: ' Invited@Example.com ', clientKind: 'browser' });
  assert.equal(created, true);
  assert.equal(sent, true);
});

test('verification returns plaintext tokens only to caller and gives repository hashes', async () => {
  const { createAuthService } = await import(serviceUrl);
  let code; let authorization;
  const repository = {
    createChallenge: async () => {},
    consumeChallengeAndAuthorize: async input => {
      authorization = input;
      return { ok: true, grantId: input.grantId, profile: { id: 'u', displayName: 'Creator', role: 'user', canPublish: false } };
    },
  };
  const service = createAuthService({
    repository,
    mailer: { sendVerificationCode: async input => { code = input.code; } },
    otpHmacKey: key, clock: () => fixedNow,
  });
  const challenge = await service.requestChallenge({ email: 'creator@example.com', clientKind: 'harness' });
  const result = await service.verifyChallenge({ challengeId: challenge.challengeId, code, deviceLabel: 'Harness desktop' });
  assert.match(result.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.refreshToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Buffer.isBuffer(authorization.accessTokenHash));
  assert.ok(Buffer.isBuffer(authorization.refreshTokenHash));
  assert.notEqual(authorization.accessTokenHash.toString('utf8'), result.accessToken);
  assert.equal(result.accessExpiresAt, '2026-09-24T12:15:00.000Z');
  assert.equal(result.refreshExpiresAt, '2026-10-24T12:00:00.000Z');
});

test('repository rejection does not expose generated credentials', async () => {
  const { createAuthService, AuthError } = await import(serviceUrl);
  const service = createAuthService({
    repository: { consumeChallengeAndAuthorize: async () => ({ ok: false, code: 'CODE_INVALID', message: 'Invalid.' }) },
    mailer: { sendVerificationCode: async () => {} }, otpHmacKey: key, clock: () => fixedNow,
  });
  await assert.rejects(
    service.verifyChallenge({ challengeId: '00000000-0000-4000-8000-000000000001', code: '000000', deviceLabel: 'device' }),
    error => error instanceof AuthError && error.code === 'CODE_INVALID' && error.statusCode === 401,
  );
});

test('account profile trims display names and delegates authenticated updates', async () => {
  const { createAuthService, AuthError } = await import(serviceUrl);
  let updated;
  const profile = { id: 'u', displayName: 'Pixel Player', role: 'user', canPublish: false, createdAt: fixedNow.toISOString(), linkedAccounts: [] };
  const service = createAuthService({
    repository: {
      getAccountProfile: async () => profile,
      updateAccountProfile: async input => { updated = input; return { ...profile, displayName: input.displayName }; },
    },
    mailer: { sendVerificationCode: async () => {} }, otpHmacKey: key, clock: () => fixedNow,
  });
  assert.equal((await service.getProfile({ userId: 'u' })).displayName, 'Pixel Player');
  assert.equal((await service.updateProfile({ userId: 'u' }, { displayName: '  New   Name  ' })).displayName, 'New Name');
  assert.equal(updated.userId, 'u');
  await assert.rejects(
    service.updateProfile({ userId: 'u' }, { displayName: ' '.repeat(3) }),
    error => error instanceof AuthError && error.code === 'SCHEMA_INVALID',
  );
});

test('avatars validate presets and persist animated image bytes by detected signature', async () => {
  const { createAuthService, AuthError } = await import(serviceUrl);
  let presetInput; let uploadInput;
  const repository = {
    setPresetAvatar: async input => { presetInput = input; return { avatar: { kind: 'preset', presetKey: input.presetKey } }; },
    setUploadedAvatar: async input => { uploadInput = input; return { avatar: { kind: 'upload', mediaType: input.mediaType, animated: input.animated } }; },
    getUploadedAvatar: async () => ({ mediaType: 'image/gif', body: Buffer.from('GIF89a-avatar'), animated: true }),
  };
  const service = createAuthService({ repository, mailer: { sendVerificationCode: async () => {} }, otpHmacKey: key, avatarProcessor: passthroughAvatarProcessor, clock: () => fixedNow });
  assert.equal((await service.setPresetAvatar({ userId: 'u' }, { presetKey: 'wizard' })).avatar.presetKey, 'wizard');
  assert.equal(presetInput.userId, 'u');
  const gif = makeGif(2);
  const uploaded = await service.uploadAvatar({ userId: 'u' }, gif);
  assert.equal(uploaded.avatar.mediaType, 'image/gif');
  assert.equal(uploaded.avatar.animated, true);
  assert.equal(uploadInput.body, gif);
  assert.equal(uploadInput.sha256.length, 32);
  assert.equal((await service.uploadAvatar({ userId: 'u' }, makeApng(2))).avatar.animated, true);
  assert.equal((await service.uploadAvatar({ userId: 'u' }, makeAnimatedWebp(2))).avatar.animated, true);
  assert.equal((await service.getAvatar('u')).body.toString(), 'GIF89a-avatar');
  await assert.rejects(
    service.setPresetAvatar({ userId: 'u' }, { presetKey: 'unknown' }),
    error => error instanceof AuthError && error.code === 'SCHEMA_INVALID',
  );
  await assert.rejects(
    service.uploadAvatar({ userId: 'u' }, Buffer.from('<svg></svg>')),
    error => error instanceof AuthError && error.code === 'AVATAR_INVALID',
  );
  const oversizedPng = Buffer.alloc(24); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(oversizedPng); Buffer.from('IHDR').copy(oversizedPng,12); oversizedPng.writeUInt32BE(2048,16); oversizedPng.writeUInt32BE(2048,20);
  await assert.rejects(
    service.uploadAvatar({ userId: 'u' }, oversizedPng),
    error => error instanceof AuthError && error.code === 'AVATAR_DIMENSIONS_INVALID',
  );
  await assert.rejects(
    service.uploadAvatar({ userId: 'u' }, makeGif(61)),
    error => error instanceof AuthError && error.code === 'AVATAR_ANIMATION_INVALID',
  );
  await assert.rejects(
    service.uploadAvatar({ userId: 'u' }, makeGif(2, 1000)),
    error => error instanceof AuthError && error.code === 'AVATAR_ANIMATION_INVALID',
  );
  await assert.rejects(
    service.uploadAvatar({ userId: 'u' }, makeApng(61)),
    error => error instanceof AuthError && error.code === 'AVATAR_ANIMATION_INVALID',
  );
  await assert.rejects(
    service.uploadAvatar({ userId: 'u' }, makeAnimatedWebp(2, 8000)),
    error => error instanceof AuthError && error.code === 'AVATAR_ANIMATION_INVALID',
  );
});

test('device sessions can be listed and revoked only through the authenticated account', async () => {
  const { createAuthService, AuthError } = await import(serviceUrl);
  const calls = [];
  const repository = {
    listDeviceGrants: async input => { calls.push(['list', input]); return [{ id: 'g-current', current: true }]; },
    revokeDeviceGrant: async input => { calls.push(['one', input]); return input.grantId === 'g-other' ? 1 : 0; },
    revokeOtherDeviceGrants: async input => { calls.push(['others', input]); return 2; },
    revokeAllDeviceGrants: async input => { calls.push(['all', input]); return 3; },
  };
  const service = createAuthService({ repository, mailer: { sendVerificationCode: async () => {} }, otpHmacKey: key, clock: () => fixedNow });
  const actor = { userId: 'u', grantId: 'g-current' };
  assert.equal((await service.listDevices(actor))[0].current, true);
  assert.deepEqual(await service.revokeDevice(actor, { grantId: 'g-other' }), { revokedCount: 1 });
  assert.deepEqual(await service.logoutOthers(actor), { revokedCount: 2 });
  assert.deepEqual(await service.logoutAll(actor), { revokedCount: 3 });
  assert.equal(calls[0][1].currentGrantId, 'g-current');
  assert.equal(calls[1][1].userId, 'u');
  await assert.rejects(
    service.revokeDevice(actor, { grantId: 'missing' }),
    error => error instanceof AuthError && error.code === 'DEVICE_NOT_FOUND' && error.statusCode === 404,
  );
});

test('challenge resend throttling fails before sending another email', async () => {
  const { createAuthService, AuthError } = await import(serviceUrl);
  let sends = 0;
  const service = createAuthService({
    repository: { createChallenge: async () => ({ ok: false }) },
    mailer: { sendVerificationCode: async () => { sends += 1; } },
    otpHmacKey: key, clock: () => fixedNow,
  });
  await assert.rejects(
    service.requestChallenge({ email: 'creator@example.com', clientKind: 'harness' }),
    error => error instanceof AuthError && error.code === 'RATE_LIMITED' && error.statusCode === 429,
  );
  assert.equal(sends, 0);
});

test('GitHub device flow returns only GameHub tokens after verified identity lookup', async () => {
  const { createAuthService } = await import(serviceUrl);
  let stored; let authorization;
  const service = createAuthService({
    repository: {
      createGitHubDeviceChallenge: async input => { stored = input; },
      beginGitHubDevicePoll: async () => ({ ok: true, deviceCode: 'github-device-secret', intervalSeconds: 5 }),
      completeGitHubDeviceAndAuthorize: async input => { authorization = input; return { ok: true, grantId: input.grantId, profile: { id: 'u', displayName: 'Octo', role: 'user', canPublish: false } }; },
    },
    mailer: { sendVerificationCode: async () => {} }, otpHmacKey: key, clock: () => fixedNow,
    githubClient: {
      requestDeviceCode: async () => ({ device_code: 'github-device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }),
      pollDeviceCode: async () => ({ access_token: 'github-access-token' }),
      getUser: async token => ({ subject: token === 'github-access-token' ? '42' : 'bad', login: 'octo', name: 'Octo' }),
    },
  });
  const challenge = await service.startGitHubDevice({ clientKind: 'harness', deviceLabel: 'GameHub Harness' });
  const result = await service.pollGitHubDevice({ challengeId: challenge.challengeId });
  assert.equal(stored.deviceCode, 'github-device-secret');
  assert.equal(challenge.userCode, 'ABCD-EFGH');
  assert.equal(result.status, 'complete');
  assert.match(result.tokens.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(authorization.subject, '42');
  assert.ok(Buffer.isBuffer(authorization.accessTokenHash));
  assert.equal(authorization.accessToken, undefined);
  assert.equal(authorization.refreshToken, undefined);
});

test('GitHub web flow redirects with PKCE and releases encrypted GameHub tokens once', async () => {
  const { createAuthService } = await import(serviceUrl);
  let created; let tokenPayload; let authorizeInput; let verifier;
  const repository = {
    createGitHubWebChallenge: async input => { created = input; },
    beginGitHubWebCallback: async () => ({ ok: true, clientKind: 'cursor', deviceLabel: 'GameHub Cursor' }),
    authorizeGitHubWebIdentity: async input => ({ ok: true, grantId: input.grantId, profile: { id: 'u', displayName: 'Octo', role: 'user', canPublish: false } }),
    finishGitHubWebChallenge: async input => { tokenPayload = input.tokenPayload; return true; },
    failGitHubWebChallenge: async () => {},
    pollGitHubWebChallenge: async () => ({ ok: true, status: 'complete', tokenPayload }),
  };
  const service = createAuthService({
    repository,
    mailer: { sendVerificationCode: async () => {} }, otpHmacKey: key, clock: () => fixedNow,
    githubClient: {
      webConfigured: true,
      createAuthorizeUrl: input => { authorizeInput = input; return `https://github.com/login/oauth/authorize?state=${encodeURIComponent(input.state)}`; },
      exchangeWebCode: async input => { verifier = input.codeVerifier; return { access_token: 'github-web-access' }; },
      getUser: async () => ({ subject: '42', login: 'octo', name: 'Octo' }),
    },
  });
  const challenge = await service.startGitHubWeb({ clientKind: 'cursor', deviceLabel: 'GameHub Cursor' });
  assert.match(challenge.authorizeUrl, /^https:\/\/github\.com\/login\/oauth\/authorize/);
  assert.ok(Buffer.isBuffer(created.stateHash));
  assert.match(authorizeInput.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  await service.completeGitHubWeb({ code: 'temporary-code', state: authorizeInput.state });
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(tokenPayload, /accessToken|refreshToken/);
  const result = await service.pollGitHubWeb({ challengeId: challenge.challengeId });
  assert.equal(result.status, 'complete');
  assert.match(result.tokens.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.tokens.profile.displayName, 'Octo');
});
