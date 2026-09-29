import crypto from 'node:crypto';
import { AvatarProcessingError, processAvatarImage } from './avatar-processor.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CLIENTS = new Set(['harness', 'vscode', 'cursor', 'browser']);
const AVATAR_KEYS = new Set(['cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard']);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 1024;
const AVATAR_MAX_PIXELS = 1024 * 1024;
const AVATAR_MAX_ANIMATION_FRAMES = 60;
const AVATAR_MAX_ANIMATION_DURATION_MS = 15_000;

export class AuthError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message);
    this.name = 'AuthError'; this.code = code; this.statusCode = statusCode; this.retryable = retryable;
  }
}

const opaqueToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = token => crypto.createHash('sha256').update(token).digest();

export function createAuthService({ repository, mailer, otpHmacKey, githubClient = null, loginEmailAllowlist = [], avatarProcessor = processAvatarImage, clock = () => new Date(), ids = () => crypto.randomUUID() }) {
  const codeHmac = (challengeId, code) => crypto.createHmac('sha256', otpHmacKey).update(`${challengeId}:${code}`).digest();
  const webTokenKey = crypto.createHash('sha256').update(`gamehub:github-web:${otpHmacKey}`).digest();
  const webVerifier = challengeId => crypto.createHmac('sha256', otpHmacKey).update(`github-web-pkce:${challengeId}`).digest('base64url');
  const sealTokens = tokens => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', webTokenKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  };
  const openTokens = payload => {
    const [iv, tag, encrypted] = String(payload ?? '').split('.');
    if (!iv || !tag || !encrypted) throw new AuthError('GITHUB_CHALLENGE_INVALID', 401, 'GitHub 登录结果无效。');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', webTokenKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'));
    } catch { throw new AuthError('GITHUB_CHALLENGE_INVALID', 401, 'GitHub 登录结果无效。'); }
  };
  const grantMaterial = now => {
    const accessToken = opaqueToken(); const refreshToken = opaqueToken();
    const accessExpiresAt = new Date(now.getTime() + 15 * 60_000);
    const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    return {
      accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, grantId: ids(), accessTokenId: ids(),
      accessTokenHash: tokenHash(accessToken), refreshTokenId: ids(), refreshTokenHash: tokenHash(refreshToken), familyId: ids(),
    };
  };
  const publicTokens = (material, result) => ({
    accessToken: material.accessToken, accessExpiresAt: material.accessExpiresAt.toISOString(),
    refreshToken: material.refreshToken, refreshExpiresAt: material.refreshExpiresAt.toISOString(),
    grantId: result.grantId, profile: result.profile,
  });
  const storedGrant = material => ({
    grantId: material.grantId, accessTokenId: material.accessTokenId, accessTokenHash: material.accessTokenHash,
    accessExpiresAt: material.accessExpiresAt, refreshTokenId: material.refreshTokenId,
    refreshTokenHash: material.refreshTokenHash, refreshExpiresAt: material.refreshExpiresAt, familyId: material.familyId,
  });
  const validateGeometry = (width, height) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION || width * height > AVATAR_MAX_PIXELS) throw new AuthError('AVATAR_DIMENSIONS_INVALID', 400, '头像尺寸必须在 1×1 到 1024×1024 像素之间。');
    return { width, height };
  };
  const jpegGeometry = body => {
    let offset = 2;
    while (offset + 9 < body.length) {
      if (body[offset] !== 0xff) { offset += 1; continue; }
      const marker = body[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (offset + 4 > body.length) break;
      const length = body.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > body.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return validateGeometry(body.readUInt16BE(offset + 5), body.readUInt16BE(offset + 7));
      offset += 2 + length;
    }
    throw new AuthError('AVATAR_INVALID', 400, 'JPEG 图片缺少有效尺寸信息。');
  };
  const webpGeometry = body => {
    const kind = body.subarray(12,16).toString('ascii');
    if (kind === 'VP8X' && body.length >= 30) return validateGeometry(1 + body.readUIntLE(24,3), 1 + body.readUIntLE(27,3));
    if (kind === 'VP8L' && body.length >= 25 && body[20] === 0x2f) {
      const bits = body.readUInt32LE(21); return validateGeometry((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (kind === 'VP8 ' && body.length >= 30 && body[23] === 0x9d && body[24] === 0x01 && body[25] === 0x2a) return validateGeometry(body.readUInt16LE(26) & 0x3fff, body.readUInt16LE(28) & 0x3fff);
    throw new AuthError('AVATAR_INVALID', 400, 'WebP 图片缺少有效尺寸信息。');
  };
  const validateAnimation = (frames, durationMs) => {
    if (!Number.isInteger(frames) || frames < 1 || frames > AVATAR_MAX_ANIMATION_FRAMES || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > AVATAR_MAX_ANIMATION_DURATION_MS) {
      throw new AuthError('AVATAR_ANIMATION_INVALID', 400, '动态头像最多 60 帧、总时长最多 15 秒。');
    }
    return { animated: frames > 1 };
  };
  const skipGifSubBlocks = (body, start) => {
    let offset = start;
    while (offset < body.length) {
      const size = body[offset++];
      if (size === 0) return offset;
      if (offset + size > body.length) throw new AuthError('AVATAR_INVALID', 400, 'GIF 图片结构不完整。');
      offset += size;
    }
    throw new AuthError('AVATAR_INVALID', 400, 'GIF 图片结构不完整。');
  };
  const gifAnimation = body => {
    const packed = body[10];
    let offset = 13 + ((packed & 0x80) ? 3 * (2 ** ((packed & 0x07) + 1)) : 0);
    let frames = 0; let durationMs = 0; let pendingDelayMs = 0; let trailer = false;
    while (offset < body.length) {
      const marker = body[offset++];
      if (marker === 0x3b) { trailer = true; break; }
      if (marker === 0x21) {
        if (offset >= body.length) throw new AuthError('AVATAR_INVALID', 400, 'GIF 图片结构不完整。');
        const label = body[offset++];
        if (label === 0xf9) {
          if (offset + 6 > body.length || body[offset] !== 4 || body[offset + 5] !== 0) throw new AuthError('AVATAR_INVALID', 400, 'GIF 动画控制块无效。');
          const delayCs = body.readUInt16LE(offset + 2);
          pendingDelayMs = (delayCs || 10) * 10;
          offset += 6;
        } else offset = skipGifSubBlocks(body, offset);
        continue;
      }
      if (marker !== 0x2c || offset + 9 > body.length) throw new AuthError('AVATAR_INVALID', 400, 'GIF 图片帧结构无效。');
      const imagePacked = body[offset + 8];
      offset += 9;
      if (imagePacked & 0x80) offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
      if (offset >= body.length) throw new AuthError('AVATAR_INVALID', 400, 'GIF 图片帧结构不完整。');
      offset += 1;
      offset = skipGifSubBlocks(body, offset);
      frames += 1; durationMs += pendingDelayMs || 100; pendingDelayMs = 0;
      validateAnimation(frames, durationMs);
    }
    if (!trailer || frames < 1) throw new AuthError('AVATAR_INVALID', 400, 'GIF 图片缺少完整帧或结束标记。');
    return validateAnimation(frames, durationMs);
  };
  const pngAnimation = body => {
    let offset = 8; let declaredFrames = null; let frames = 0; let durationMs = 0; let ended = false;
    while (offset + 12 <= body.length) {
      const length = body.readUInt32BE(offset); const type = body.subarray(offset + 4, offset + 8).toString('ascii'); const dataStart = offset + 8; const next = dataStart + length + 4;
      if (next > body.length) throw new AuthError('AVATAR_INVALID', 400, 'PNG 图片块结构不完整。');
      if (type === 'acTL') {
        if (length !== 8 || declaredFrames !== null) throw new AuthError('AVATAR_INVALID', 400, 'APNG 动画声明无效。');
        declaredFrames = body.readUInt32BE(dataStart);
      } else if (type === 'fcTL') {
        if (length !== 26) throw new AuthError('AVATAR_INVALID', 400, 'APNG 帧控制块无效。');
        frames += 1;
        const numerator = body.readUInt16BE(dataStart + 20); const denominator = body.readUInt16BE(dataStart + 22) || 100;
        durationMs += Math.max(10, numerator * 1000 / denominator);
        validateAnimation(frames, durationMs);
      } else if (type === 'IEND') { ended = true; offset = next; break; }
      offset = next;
    }
    if (!ended || offset !== body.length) throw new AuthError('AVATAR_INVALID', 400, 'PNG 图片缺少结束标记或包含尾随数据。');
    if (declaredFrames === null) return { animated: false };
    if (declaredFrames < 1 || declaredFrames !== frames) throw new AuthError('AVATAR_INVALID', 400, 'APNG 帧数声明与内容不一致。');
    return validateAnimation(frames, durationMs);
  };
  const webpAnimation = body => {
    if (body.readUInt32LE(4) + 8 !== body.length) throw new AuthError('AVATAR_INVALID', 400, 'WebP 文件长度声明无效。');
    let offset = 12; let frames = 0; let durationMs = 0; let endedAt = offset; let animationHeader = false;
    while (offset + 8 <= body.length) {
      const type = body.subarray(offset, offset + 4).toString('ascii'); const length = body.readUInt32LE(offset + 4); const dataStart = offset + 8; const next = dataStart + length + (length & 1);
      if (next > body.length) throw new AuthError('AVATAR_INVALID', 400, 'WebP 图片块结构不完整。');
      if (type === 'ANIM') {
        if (length !== 6 || animationHeader) throw new AuthError('AVATAR_INVALID', 400, 'WebP 动画头无效。');
        animationHeader = true;
      } else if (type === 'ANMF') {
        if (length < 16) throw new AuthError('AVATAR_INVALID', 400, 'WebP 动画帧无效。');
        frames += 1; durationMs += Math.max(10, body.readUIntLE(dataStart + 12, 3));
        validateAnimation(frames, durationMs);
      }
      offset = next; endedAt = next;
    }
    if (endedAt !== body.length) throw new AuthError('AVATAR_INVALID', 400, 'WebP 图片包含未解析数据。');
    if (frames && !animationHeader) throw new AuthError('AVATAR_INVALID', 400, 'WebP 动画缺少动画头。');
    return frames ? validateAnimation(frames, durationMs) : { animated: false };
  };
  const inspectAvatar = body => {
    if (!Buffer.isBuffer(body) || body.length < 12) throw new AuthError('AVATAR_INVALID', 400, '请选择有效的 PNG、JPEG、GIF 或 WebP 图片。');
    if (body.length > AVATAR_MAX_BYTES) throw new AuthError('AVATAR_TOO_LARGE', 413, '头像不能超过 2 MB。');
    const prefix = body.subarray(0, 12);
    if (prefix.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) { if (body.length < 24 || body.subarray(12,16).toString('ascii') !== 'IHDR') throw new AuthError('AVATAR_INVALID', 400, 'PNG 图片结构无效。'); validateGeometry(body.readUInt32BE(16), body.readUInt32BE(20)); return { mediaType: 'image/png', ...pngAnimation(body) }; }
    if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) { jpegGeometry(body); return { mediaType: 'image/jpeg', animated: false }; }
    if (prefix.subarray(0, 6).toString('ascii') === 'GIF87a' || prefix.subarray(0, 6).toString('ascii') === 'GIF89a') { validateGeometry(body.readUInt16LE(6), body.readUInt16LE(8)); return { mediaType: 'image/gif', ...gifAnimation(body) }; }
    if (prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WEBP') { webpGeometry(body); return { mediaType: 'image/webp', ...webpAnimation(body) }; }
    throw new AuthError('AVATAR_INVALID', 400, '请选择有效的 PNG、JPEG、GIF 或 WebP 图片。');
  };
  return {
    async requestChallenge({ email, clientKind }) {
      const emailNormalized = String(email ?? '').trim().toLowerCase();
      if (!EMAIL.test(emailNormalized) || emailNormalized.length > 320 || !CLIENTS.has(clientKind)) throw new AuthError('SCHEMA_INVALID', 400, 'Email or client kind is invalid.');
      if (loginEmailAllowlist.length && !loginEmailAllowlist.includes(emailNormalized)) throw new AuthError('INVITE_REQUIRED', 403, 'This email is not included in the current invitation list.');
      const now = clock();
      const challengeId = ids();
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(now.getTime() + 10 * 60_000);
      const resendAfter = new Date(now.getTime() + 60_000);
      const creation = await repository.createChallenge({ id: challengeId, emailNormalized, clientKind, codeHmac: codeHmac(challengeId, code), expiresAt, resendAfter, now });
      if (creation?.ok === false) throw new AuthError('RATE_LIMITED', 429, 'Please wait before requesting another verification code.');
      await mailer.sendVerificationCode({ email: emailNormalized, code, expiresAt });
      return { challengeId, expiresAt: expiresAt.toISOString(), resendAfter: resendAfter.toISOString() };
    },
    async verifyChallenge({ challengeId, code, deviceLabel }) {
      if (!/^[0-9]{6}$/.test(String(code ?? '')) || typeof deviceLabel !== 'string' || deviceLabel.length < 1 || deviceLabel.length > 120) throw new AuthError('SCHEMA_INVALID', 400, 'Verification input is invalid.');
      const now = clock();
      const material = grantMaterial(now);
      const result = await repository.consumeChallengeAndAuthorize({
        challengeId, submittedCodeHmac: codeHmac(challengeId, code), deviceLabel,
        ...storedGrant(material), now,
      });
      if (!result.ok) throw new AuthError(result.code, result.code === 'RATE_LIMITED' ? 429 : 401, result.message, false);
      return publicTokens(material, result);
    },
    async startGitHubWeb({ clientKind, deviceLabel }) {
      if (!githubClient?.webConfigured) throw new AuthError('GITHUB_WEB_AUTH_UNAVAILABLE', 503, 'GitHub 网页登录尚未在此环境配置。', true);
      if (!CLIENTS.has(clientKind) || typeof deviceLabel !== 'string' || deviceLabel.length < 1 || deviceLabel.length > 120) throw new AuthError('SCHEMA_INVALID', 400, 'GitHub web input is invalid.');
      const now = clock();
      const challengeId = ids();
      const state = `${challengeId}.${crypto.randomBytes(24).toString('base64url')}`;
      const verifier = webVerifier(challengeId);
      const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const expiresAt = new Date(now.getTime() + 10 * 60_000);
      await repository.createGitHubWebChallenge({ id: challengeId, stateHash: tokenHash(state), clientKind, deviceLabel, expiresAt });
      return {
        challengeId,
        authorizeUrl: githubClient.createAuthorizeUrl({ state, codeChallenge }),
        expiresAt: expiresAt.toISOString(),
        intervalSeconds: 2,
      };
    },
    async completeGitHubWeb({ code, state, error: oauthError }) {
      const challengeId = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\./i.exec(String(state ?? ''))?.[1];
      if (!challengeId) throw new AuthError('GITHUB_STATE_INVALID', 400, 'GitHub 登录状态无效。');
      const now = clock();
      const challenge = await repository.beginGitHubWebCallback({ challengeId, stateHash: tokenHash(state), now });
      if (!challenge.ok) throw new AuthError(challenge.code, 401, 'GitHub 登录状态无效或已失效。');
      if (oauthError || !code) {
        await repository.failGitHubWebChallenge({ challengeId, errorCode: oauthError === 'access_denied' ? 'GITHUB_ACCESS_DENIED' : 'GITHUB_AUTH_FAILED', now });
        return { status: 'failed' };
      }
      try {
        const upstream = await githubClient.exchangeWebCode({ code, codeVerifier: webVerifier(challengeId) });
        if (upstream.error || !upstream.access_token) throw new Error(upstream.error || 'missing_access_token');
        const identity = await githubClient.getUser(upstream.access_token);
        const material = grantMaterial(now);
        const result = await repository.authorizeGitHubWebIdentity({
          subject: identity.subject,
          displayName: (identity.name || identity.login).slice(0, 120),
          clientKind: challenge.clientKind,
          deviceLabel: challenge.deviceLabel,
          ...storedGrant(material),
          now,
        });
        if (!result.ok) throw new Error(result.code || 'authorization_failed');
        const completed = await repository.finishGitHubWebChallenge({ challengeId, tokenPayload: sealTokens(publicTokens(material, result)), now });
        if (!completed) throw new Error('challenge_completion_failed');
        return { status: 'complete' };
      } catch {
        await repository.failGitHubWebChallenge({ challengeId, errorCode: 'GITHUB_AUTH_FAILED', now });
        return { status: 'failed' };
      }
    },
    async pollGitHubWeb({ challengeId }) {
      const result = await repository.pollGitHubWebChallenge({ challengeId, now: clock(), intervalSeconds: 2 });
      if (!result.ok) {
        if (result.code === 'RATE_LIMITED') return { status: 'pending', retryAfter: 2, tokens: null };
        throw new AuthError(result.code, result.code === 'GITHUB_ACCESS_DENIED' ? 401 : 400, result.code === 'GITHUB_ACCESS_DENIED' ? 'GitHub 授权已取消。' : 'GitHub 登录没有完成，请重新开始。');
      }
      return result.status === 'complete'
        ? { status: 'complete', retryAfter: 0, tokens: openTokens(result.tokenPayload) }
        : { status: 'pending', retryAfter: 2, tokens: null };
    },
    async startGitHubDevice({ clientKind, deviceLabel }) {
      if (!githubClient) throw new AuthError('GITHUB_AUTH_UNAVAILABLE', 503, 'GitHub 登录尚未在此环境配置。', true);
      if (!CLIENTS.has(clientKind) || typeof deviceLabel !== 'string' || deviceLabel.length < 1 || deviceLabel.length > 120) throw new AuthError('SCHEMA_INVALID', 400, 'GitHub device input is invalid.');
      let upstream;
      try { upstream = await githubClient.requestDeviceCode(); }
      catch { throw new AuthError('GITHUB_UPSTREAM_ERROR', 502, '暂时无法连接 GitHub，请稍后重试。', true); }
      const expiresIn = Number(upstream.expires_in); const intervalSeconds = Math.max(1, Math.min(60, Number(upstream.interval) || 5));
      if (!upstream.device_code || !upstream.user_code || upstream.verification_uri !== 'https://github.com/login/device' || !Number.isFinite(expiresIn)) throw new AuthError('GITHUB_UPSTREAM_ERROR', 502, 'GitHub 返回了无效的登录挑战。', true);
      const now = clock(); const challengeId = ids(); const expiresAt = new Date(now.getTime() + Math.min(expiresIn, 900) * 1000);
      await repository.createGitHubDeviceChallenge({ id: challengeId, deviceCode: upstream.device_code, userCode: upstream.user_code, verificationUri: upstream.verification_uri, clientKind, deviceLabel, intervalSeconds, expiresAt, now });
      return { challengeId, userCode: upstream.user_code, verificationUri: upstream.verification_uri, expiresAt: expiresAt.toISOString(), intervalSeconds };
    },
    async pollGitHubDevice({ challengeId }) {
      if (!githubClient) throw new AuthError('GITHUB_AUTH_UNAVAILABLE', 503, 'GitHub 登录尚未在此环境配置。', true);
      const now = clock();
      const challenge = await repository.beginGitHubDevicePoll({ challengeId, now });
      if (!challenge.ok) throw new AuthError(challenge.code, challenge.code === 'RATE_LIMITED' ? 429 : 401, challenge.message, challenge.code === 'RATE_LIMITED');
      let upstream;
      try { upstream = await githubClient.pollDeviceCode(challenge.deviceCode); }
      catch { throw new AuthError('GITHUB_UPSTREAM_ERROR', 502, '暂时无法连接 GitHub，请稍后重试。', true); }
      if (upstream.error === 'authorization_pending') return { status: 'pending', retryAfter: challenge.intervalSeconds, tokens: null };
      if (upstream.error === 'slow_down') return { status: 'pending', retryAfter: challenge.intervalSeconds + 5, tokens: null };
      if (upstream.error) throw new AuthError(upstream.error === 'access_denied' ? 'GITHUB_ACCESS_DENIED' : 'GITHUB_CHALLENGE_INVALID', 401, upstream.error === 'access_denied' ? 'GitHub 授权已取消。' : 'GitHub 登录码已失效，请重新开始。');
      if (!upstream.access_token) throw new AuthError('GITHUB_UPSTREAM_ERROR', 502, 'GitHub 返回了无效的访问令牌。', true);
      let identity;
      try { identity = await githubClient.getUser(upstream.access_token); }
      catch { throw new AuthError('GITHUB_UPSTREAM_ERROR', 502, '暂时无法读取 GitHub 账号信息。', true); }
      const material = grantMaterial(now);
      const result = await repository.completeGitHubDeviceAndAuthorize({ challengeId, subject: identity.subject, displayName: (identity.name || identity.login).slice(0, 120), ...storedGrant(material), now });
      if (!result.ok) throw new AuthError(result.code, 401, result.message);
      return { status: 'complete', retryAfter: 0, tokens: publicTokens(material, result) };
    },
    async refresh({ refreshToken: currentToken }) {
      if (typeof currentToken !== 'string' || currentToken.length < 32) throw new AuthError('SCHEMA_INVALID', 400, 'Refresh token is invalid.');
      const accessToken = opaqueToken();
      const refreshToken = opaqueToken();
      const now = clock();
      const accessExpiresAt = new Date(now.getTime() + 15 * 60_000);
      const result = await repository.rotateRefreshToken({
        currentTokenHash: tokenHash(currentToken), accessTokenId: ids(), accessTokenHash: tokenHash(accessToken), accessExpiresAt,
        refreshTokenId: ids(), refreshTokenHash: tokenHash(refreshToken), now,
      });
      if (!result.ok) throw new AuthError(result.code, 401, result.message);
      return {
        accessToken, accessExpiresAt: accessExpiresAt.toISOString(), refreshToken,
        refreshExpiresAt: new Date(result.refreshExpiresAt).toISOString(), grantId: result.grantId, profile: result.profile,
      };
    },
    async authenticateBearer(header) {
      const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(header ?? '');
      if (!match) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication is required.');
      const result = await repository.authenticateAccessToken({ tokenHash: tokenHash(match[1]), now: clock() });
      if (!result) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication is required.');
      return result;
    },
    async getProfile(actor) {
      const profile = await repository.getAccountProfile(actor.userId);
      if (!profile) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication is required.');
      return profile;
    },
    async updateProfile(actor, { displayName }) {
      const normalized = String(displayName ?? '').trim().replace(/\s+/gu, ' ');
      if (normalized.length < 1 || normalized.length > 40) throw new AuthError('SCHEMA_INVALID', 400, '昵称应为 1 到 40 个字符。');
      const profile = await repository.updateAccountProfile({ userId: actor.userId, displayName: normalized, now: clock() });
      if (!profile) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication is required.');
      return profile;
    },
    async setPresetAvatar(actor, { presetKey }) {
      if (!AVATAR_KEYS.has(presetKey)) throw new AuthError('SCHEMA_INVALID', 400, '系统头像不存在。');
      const profile = await repository.setPresetAvatar({ userId: actor.userId, presetKey, now: clock() });
      if (!profile) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication is required.');
      return profile;
    },
    async uploadAvatar(actor, body) {
      const inspected = inspectAvatar(body);
      let processed;
      try { processed = await avatarProcessor(body, inspected); }
      catch (error) { if (error instanceof AvatarProcessingError) throw new AuthError('AVATAR_DECODE_FAILED', 400, error.message); throw error; }
      const profile = await repository.setUploadedAvatar({
        userId: actor.userId, ...processed,
        sha256: crypto.createHash('sha256').update(processed.body).digest(),
        posterSha256: crypto.createHash('sha256').update(processed.posterBody).digest(), now: clock(),
      });
      if (!profile) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication is required.');
      return profile;
    },
    async getAvatar(userId, variant = 'animated') {
      const avatar = await repository.getUploadedAvatar(userId, variant);
      if (!avatar) throw new AuthError('AVATAR_NOT_FOUND', 404, '头像不存在。');
      return avatar;
    },
    async listDevices(actor) {
      return repository.listDeviceGrants({ userId: actor.userId, currentGrantId: actor.grantId, now: clock() });
    },
    async revokeDevice(actor, { grantId }) {
      const revokedCount = await repository.revokeDeviceGrant({ userId: actor.userId, grantId, now: clock() });
      if (!revokedCount) throw new AuthError('DEVICE_NOT_FOUND', 404, '登录设备不存在或已经退出。');
      return { revokedCount };
    },
    async logoutOthers(actor) {
      return { revokedCount: await repository.revokeOtherDeviceGrants({ userId: actor.userId, currentGrantId: actor.grantId, now: clock() }) };
    },
    async logoutAll(actor) {
      return { revokedCount: await repository.revokeAllDeviceGrants({ userId: actor.userId, now: clock() }) };
    },
    async logout(actor) {
      await repository.logoutGrant({ grantId: actor.grantId, now: clock() });
      return actor.profile;
    },
  };
}
