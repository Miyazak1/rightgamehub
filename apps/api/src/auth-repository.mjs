import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const safeDisplayName = email => email.split('@')[0].slice(0, 120) || 'Creator';
const avatarKeys = ['cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard'];
const randomAvatarKey = () => avatarKeys[crypto.randomInt(avatarKeys.length)];

export class PostgresAuthRepository {
  constructor(pool, avatarStore = null) { this.pool = pool; this.avatarStore = avatarStore; }

  async removeAvatarObjects(keys, except = new Set()) {
    if (!this.avatarStore) return;
    await Promise.all(keys.filter(Boolean).filter(key => !except.has(key)).map(key => this.avatarStore.remove(key).catch(() => {})));
  }

  async createChallenge(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${input.emailNormalized}`]);
      const latest = (await client.query(
        `SELECT resend_after FROM email_challenges
          WHERE email_normalized=$1 ORDER BY created_at DESC LIMIT 1`, [input.emailNormalized],
      )).rows[0];
      if (latest && new Date(latest.resend_after) > input.now) return { ok: false };
      await client.query(
        `INSERT INTO email_challenges(id,email_normalized,client_kind,code_hmac,expires_at,resend_after)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.id, input.emailNormalized, input.clientKind, input.codeHmac, input.expiresAt, input.resendAfter],
      );
      return { ok: true };
    });
  }

  async consumeChallengeAndAuthorize(input) {
    return withTransaction(this.pool, async client => {
      const challenge = (await client.query(
        `SELECT id,email_normalized,client_kind,code_hmac,expires_at,attempts,consumed_at
           FROM email_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId],
      )).rows[0];
      if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= input.now) return { ok: false, code: 'CHALLENGE_INVALID', message: 'The verification challenge is invalid or expired.' };
      if (challenge.attempts >= 5) return { ok: false, code: 'RATE_LIMITED', message: 'Too many verification attempts.' };
      const expected = Buffer.from(challenge.code_hmac);
      if (expected.length !== input.submittedCodeHmac.length || !crypto.timingSafeEqual(expected, input.submittedCodeHmac)) {
        await client.query('UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1', [input.challengeId]);
        return { ok: false, code: 'CODE_INVALID', message: 'The verification code is invalid.' };
      }
      await client.query('UPDATE email_challenges SET consumed_at=$2 WHERE id=$1', [input.challengeId, input.now]);

      let identity = (await client.query(
        `SELECT u.id,u.display_name,u.role,u.can_publish,u.status
           FROM auth_identities i JOIN users u ON u.id=i.user_id
          WHERE i.provider='email' AND i.subject=$1 FOR UPDATE OF u`, [challenge.email_normalized],
      )).rows[0];
      if (!identity) {
        const userId = crypto.randomUUID();
        const displayName = safeDisplayName(challenge.email_normalized);
        await client.query('INSERT INTO users(id,display_name) VALUES ($1,$2)', [userId, displayName]);
        await client.query("INSERT INTO user_avatars(user_id,kind,preset_key) VALUES ($1,'preset',$2)", [userId, randomAvatarKey()]);
        await client.query(`INSERT INTO auth_identities(id,user_id,provider,subject) VALUES ($1,$2,'email',$3)`, [crypto.randomUUID(), userId, challenge.email_normalized]);
        await client.query('INSERT INTO creator_usage(user_id) VALUES ($1)', [userId]);
        identity = { id: userId, display_name: displayName, role: 'user', can_publish: false, status: 'active' };
      }
      if (identity.status !== 'active') return { ok: false, code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended.' };

      await client.query(
        `INSERT INTO device_grants(id,user_id,device_label,client_kind,scopes,authenticated_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.grantId, identity.id, input.deviceLabel, challenge.client_kind,
          identity.can_publish ? ['profile:read', 'works:read', 'works:write', 'publish', 'upload'] : ['profile:read'],
          input.now, input.refreshExpiresAt],
      );
      await client.query('INSERT INTO access_tokens(id,token_hash,grant_id,expires_at) VALUES ($1,$2,$3,$4)', [input.accessTokenId, input.accessTokenHash, input.grantId, input.accessExpiresAt]);
      await client.query(
        `INSERT INTO refresh_tokens(id,token_hash,grant_id,family_id,generation,expires_at)
         VALUES ($1,$2,$3,$4,0,$5)`,
        [input.refreshTokenId, input.refreshTokenHash, input.grantId, input.familyId, input.refreshExpiresAt],
      );
      return { ok: true, grantId: input.grantId, profile: { id: identity.id, displayName: identity.display_name, role: identity.role, canPublish: identity.can_publish } };
    });
  }

  async createGitHubWebChallenge(input) {
    await this.pool.query(
      `INSERT INTO github_web_challenges(id,state_hash,client_kind,device_label,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.id, input.stateHash, input.clientKind, input.deviceLabel, input.expiresAt],
    );
  }

  async beginGitHubWebCallback(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `SELECT id,state_hash,client_kind,device_label,expires_at,status,callback_started_at,consumed_at
           FROM github_web_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId],
      )).rows[0];
      if (!row || row.consumed_at || row.status !== 'pending' || row.callback_started_at || new Date(row.expires_at) <= input.now) return { ok: false, code: 'GITHUB_CHALLENGE_INVALID' };
      const expected = Buffer.from(row.state_hash);
      if (expected.length !== input.stateHash.length || !crypto.timingSafeEqual(expected, input.stateHash)) return { ok: false, code: 'GITHUB_STATE_INVALID' };
      await client.query('UPDATE github_web_challenges SET callback_started_at=$2 WHERE id=$1', [input.challengeId, input.now]);
      return { ok: true, clientKind: row.client_kind, deviceLabel: row.device_label };
    });
  }

  async authorizeGitHubWebIdentity(input) {
    return withTransaction(this.pool, async client => {
      let identity = (await client.query(
        `SELECT u.id,u.display_name,u.role,u.can_publish,u.status
           FROM auth_identities i JOIN users u ON u.id=i.user_id
          WHERE i.provider='github' AND i.subject=$1 FOR UPDATE OF u`, [input.subject],
      )).rows[0];
      if (!identity) {
        const userId = crypto.randomUUID();
        await client.query('INSERT INTO users(id,display_name) VALUES ($1,$2)', [userId, input.displayName]);
        await client.query("INSERT INTO user_avatars(user_id,kind,preset_key) VALUES ($1,'preset',$2)", [userId, randomAvatarKey()]);
        await client.query(`INSERT INTO auth_identities(id,user_id,provider,subject) VALUES ($1,$2,'github',$3)`, [crypto.randomUUID(), userId, input.subject]);
        await client.query('INSERT INTO creator_usage(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        identity = { id: userId, display_name: input.displayName, role: 'user', can_publish: false, status: 'active' };
      }
      if (identity.status !== 'active') return { ok: false, code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended.' };
      await client.query(
        `INSERT INTO device_grants(id,user_id,device_label,client_kind,scopes,authenticated_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.grantId, identity.id, input.deviceLabel, input.clientKind,
          identity.can_publish ? ['profile:read', 'works:read', 'works:write', 'publish', 'upload'] : ['profile:read'],
          input.now, input.refreshExpiresAt],
      );
      await client.query('INSERT INTO access_tokens(id,token_hash,grant_id,expires_at) VALUES ($1,$2,$3,$4)', [input.accessTokenId, input.accessTokenHash, input.grantId, input.accessExpiresAt]);
      await client.query(
        `INSERT INTO refresh_tokens(id,token_hash,grant_id,family_id,generation,expires_at)
         VALUES ($1,$2,$3,$4,0,$5)`,
        [input.refreshTokenId, input.refreshTokenHash, input.grantId, input.familyId, input.refreshExpiresAt],
      );
      return { ok: true, grantId: input.grantId, profile: { id: identity.id, displayName: identity.display_name, role: identity.role, canPublish: identity.can_publish } };
    });
  }

  async finishGitHubWebChallenge(input) {
    const result = await this.pool.query(
      `UPDATE github_web_challenges SET status='complete',token_payload=$2,completed_at=$3
        WHERE id=$1 AND status='pending' AND callback_started_at IS NOT NULL AND consumed_at IS NULL`,
      [input.challengeId, input.tokenPayload, input.now],
    );
    return result.rowCount === 1;
  }

  async failGitHubWebChallenge(input) {
    await this.pool.query(
      `UPDATE github_web_challenges SET status='failed',error_code=$2,completed_at=$3
        WHERE id=$1 AND status='pending' AND consumed_at IS NULL`,
      [input.challengeId, input.errorCode, input.now],
    );
  }

  async pollGitHubWebChallenge(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `SELECT status,token_payload,error_code,expires_at,last_polled_at,consumed_at
           FROM github_web_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId],
      )).rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at) <= input.now) return { ok: false, code: 'GITHUB_CHALLENGE_INVALID' };
      if (row.last_polled_at && input.now.getTime() - new Date(row.last_polled_at).getTime() < input.intervalSeconds * 1000) return { ok: false, code: 'RATE_LIMITED' };
      await client.query('UPDATE github_web_challenges SET last_polled_at=$2 WHERE id=$1', [input.challengeId, input.now]);
      if (row.status === 'failed') return { ok: false, code: row.error_code || 'GITHUB_AUTH_FAILED' };
      if (row.status !== 'complete') return { ok: true, status: 'pending' };
      await client.query("UPDATE github_web_challenges SET status='consumed',consumed_at=$2,token_payload=NULL WHERE id=$1", [input.challengeId, input.now]);
      return { ok: true, status: 'complete', tokenPayload: row.token_payload };
    });
  }

  async createGitHubDeviceChallenge(input) {
    await this.pool.query(
      `INSERT INTO github_device_challenges(id,device_code,user_code,verification_uri,client_kind,device_label,interval_seconds,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.id, input.deviceCode, input.userCode, input.verificationUri, input.clientKind, input.deviceLabel, input.intervalSeconds, input.expiresAt],
    );
  }

  async beginGitHubDevicePoll(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `SELECT id,device_code,interval_seconds,expires_at,last_polled_at,consumed_at
           FROM github_device_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId],
      )).rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at) <= input.now) return { ok: false, code: 'GITHUB_CHALLENGE_INVALID', message: 'GitHub login code is invalid or expired.' };
      if (row.last_polled_at && input.now.getTime() - new Date(row.last_polled_at).getTime() < Number(row.interval_seconds) * 1000) return { ok: false, code: 'RATE_LIMITED', message: 'Wait before checking GitHub authorization again.' };
      await client.query('UPDATE github_device_challenges SET last_polled_at=$2 WHERE id=$1', [input.challengeId, input.now]);
      return { ok: true, deviceCode: row.device_code, intervalSeconds: Number(row.interval_seconds) };
    });
  }

  async completeGitHubDeviceAndAuthorize(input) {
    return withTransaction(this.pool, async client => {
      const challenge = (await client.query(
        `SELECT id,client_kind,device_label,expires_at,consumed_at
           FROM github_device_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId],
      )).rows[0];
      if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= input.now) return { ok: false, code: 'GITHUB_CHALLENGE_INVALID', message: 'GitHub login code is invalid or expired.' };
      let identity = (await client.query(
        `SELECT u.id,u.display_name,u.role,u.can_publish,u.status
           FROM auth_identities i JOIN users u ON u.id=i.user_id
          WHERE i.provider='github' AND i.subject=$1 FOR UPDATE OF u`, [input.subject],
      )).rows[0];
      if (!identity) {
        const userId = crypto.randomUUID();
        await client.query('INSERT INTO users(id,display_name) VALUES ($1,$2)', [userId, input.displayName]);
        await client.query("INSERT INTO user_avatars(user_id,kind,preset_key) VALUES ($1,'preset',$2)", [userId, randomAvatarKey()]);
        await client.query(`INSERT INTO auth_identities(id,user_id,provider,subject) VALUES ($1,$2,'github',$3)`, [crypto.randomUUID(), userId, input.subject]);
        await client.query('INSERT INTO creator_usage(user_id) VALUES ($1)', [userId]);
        identity = { id: userId, display_name: input.displayName, role: 'user', can_publish: false, status: 'active' };
      }
      if (identity.status !== 'active') return { ok: false, code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended.' };
      await client.query('UPDATE github_device_challenges SET consumed_at=$2,device_code=$3 WHERE id=$1', [input.challengeId, input.now, `consumed:${input.challengeId}`]);
      await client.query(
        `INSERT INTO device_grants(id,user_id,device_label,client_kind,scopes,authenticated_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.grantId, identity.id, challenge.device_label, challenge.client_kind,
          identity.can_publish ? ['profile:read', 'works:read', 'works:write', 'publish', 'upload'] : ['profile:read'],
          input.now, input.refreshExpiresAt],
      );
      await client.query('INSERT INTO access_tokens(id,token_hash,grant_id,expires_at) VALUES ($1,$2,$3,$4)', [input.accessTokenId, input.accessTokenHash, input.grantId, input.accessExpiresAt]);
      await client.query(
        `INSERT INTO refresh_tokens(id,token_hash,grant_id,family_id,generation,expires_at)
         VALUES ($1,$2,$3,$4,0,$5)`,
        [input.refreshTokenId, input.refreshTokenHash, input.grantId, input.familyId, input.refreshExpiresAt],
      );
      return { ok: true, grantId: input.grantId, profile: { id: identity.id, displayName: identity.display_name, role: identity.role, canPublish: identity.can_publish } };
    });
  }

  async rotateRefreshToken(input) {
    return withTransaction(this.pool, async client => {
      const token = (await client.query(
        `SELECT r.id,r.grant_id,r.family_id,r.generation,r.expires_at,r.used_at,r.revoked_at,
                g.expires_at AS grant_expires_at,g.revoked_at AS grant_revoked_at,
                u.id AS user_id,u.display_name,u.role,u.can_publish,u.status
           FROM refresh_tokens r JOIN device_grants g ON g.id=r.grant_id JOIN users u ON u.id=g.user_id
          WHERE r.token_hash=$1 FOR UPDATE OF r,g,u`, [input.currentTokenHash],
      )).rows[0];
      if (!token) return { ok: false, code: 'REFRESH_INVALID', message: 'Refresh token is invalid.' };
      if (token.used_at || token.revoked_at) {
        await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE family_id=$1', [token.family_id, input.now]);
        await client.query('UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=$1', [token.grant_id, input.now]);
        return { ok: false, code: 'REFRESH_REUSED', message: 'Refresh token reuse was detected; sign in again.' };
      }
      if (new Date(token.expires_at) <= input.now || new Date(token.grant_expires_at) <= input.now || token.grant_revoked_at || token.status !== 'active') {
        return { ok: false, code: 'REFRESH_INVALID', message: 'Refresh token is invalid.' };
      }
      await client.query('INSERT INTO access_tokens(id,token_hash,grant_id,expires_at) VALUES ($1,$2,$3,$4)', [input.accessTokenId, input.accessTokenHash, token.grant_id, input.accessExpiresAt]);
      await client.query(
        `INSERT INTO refresh_tokens(id,token_hash,grant_id,family_id,generation,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.refreshTokenId, input.refreshTokenHash, token.grant_id, token.family_id, Number(token.generation) + 1, token.expires_at],
      );
      await client.query('UPDATE refresh_tokens SET used_at=$2,replaced_by=$3 WHERE id=$1', [token.id, input.now, input.refreshTokenId]);
      return {
        ok: true, grantId: token.grant_id, refreshExpiresAt: token.expires_at,
        profile: { id: token.user_id, displayName: token.display_name, role: token.role, canPublish: token.can_publish },
      };
    });
  }

  async authenticateAccessToken(input) {
    const row = (await this.pool.query(
      `SELECT g.id AS grant_id,g.scopes,g.last_seen_at,u.id,u.display_name,u.role,u.can_publish
         FROM access_tokens a JOIN device_grants g ON g.id=a.grant_id JOIN users u ON u.id=g.user_id
        WHERE a.token_hash=$1 AND a.revoked_at IS NULL AND a.expires_at>$2
          AND g.revoked_at IS NULL AND g.expires_at>$2 AND u.status='active'`,
      [input.tokenHash, input.now],
    )).rows[0];
    if (!row) return null;
    if (input.now.getTime() - new Date(row.last_seen_at).getTime() >= 5 * 60_000) {
      await this.pool.query('UPDATE device_grants SET last_seen_at=$2 WHERE id=$1 AND last_seen_at<$2', [row.grant_id, input.now]);
    }
    return { grantId: row.grant_id, userId: row.id, scopes: row.scopes, profile: { id: row.id, displayName: row.display_name, role: row.role, canPublish: row.can_publish } };
  }

  async getAccountProfile(userId) {
    const user = (await this.pool.query(
      `SELECT u.id,u.display_name,u.role,u.can_publish,u.created_at,
              a.kind AS avatar_kind,a.preset_key,a.media_type,a.sha256,a.animated,a.poster_body,a.poster_key
         FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id
        WHERE u.id=$1 AND u.status='active'`,
      [userId],
    )).rows[0];
    if (!user) return null;
    const identities = (await this.pool.query(
      'SELECT provider,subject,created_at FROM auth_identities WHERE user_id=$1 ORDER BY created_at ASC',
      [userId],
    )).rows;
    return {
      id: user.id,
      displayName: user.display_name,
      role: user.role,
      canPublish: user.can_publish,
      createdAt: new Date(user.created_at).toISOString(),
      avatar: user.avatar_kind === 'upload' ? {
        kind: 'upload', presetKey: null, url: `/v1/avatars/${user.id}?v=${Buffer.from(user.sha256).toString('hex').slice(0, 12)}`,
        staticUrl: (user.poster_body || user.poster_key) ? `/v1/avatars/${user.id}?variant=static&v=${Buffer.from(user.sha256).toString('hex').slice(0, 12)}` : null,
        mediaType: user.media_type, animated: user.animated,
      } : { kind: 'preset', presetKey: user.preset_key || 'cat', url: null, staticUrl: null, mediaType: null, animated: false },
      linkedAccounts: identities.map(identity => ({
        provider: identity.provider,
        label: identity.provider === 'email' ? identity.subject : 'GitHub',
        linkedAt: new Date(identity.created_at).toISOString(),
      })),
    };
  }

  async updateAccountProfile(input) {
    await this.pool.query(
      'UPDATE users SET display_name=$2,updated_at=$3 WHERE id=$1 AND status=\'active\'',
      [input.userId, input.displayName, input.now],
    );
    return this.getAccountProfile(input.userId);
  }

  async setPresetAvatar(input) {
    const previous = await withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT body_key,poster_key FROM user_avatars WHERE user_id=$1 FOR UPDATE', [input.userId])).rows[0];
      await client.query(
        `INSERT INTO user_avatars(user_id,kind,preset_key,updated_at)
       VALUES ($1,'preset',$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET kind='preset',preset_key=EXCLUDED.preset_key,media_type=NULL,body=NULL,body_key=NULL,sha256=NULL,byte_length=NULL,animated=false,poster_media_type=NULL,poster_body=NULL,poster_key=NULL,poster_sha256=NULL,width=NULL,height=NULL,frame_count=NULL,duration_ms=NULL,updated_at=EXCLUDED.updated_at`,
        [input.userId, input.presetKey, input.now],
      );
      return row;
    });
    await this.removeAvatarObjects([previous?.body_key, previous?.poster_key]);
    return this.getAccountProfile(input.userId);
  }

  async setUploadedAvatar(input) {
    let bodyKey = null; let posterKey = null;
    if (this.avatarStore) {
      bodyKey = await this.avatarStore.put({ userId: input.userId, variant: 'animated', body: input.body, sha256: input.sha256 });
      try { posterKey = await this.avatarStore.put({ userId: input.userId, variant: 'static', body: input.posterBody, sha256: input.posterSha256 }); }
      catch (error) { await this.avatarStore.remove(bodyKey).catch(() => {}); throw error; }
    }
    let previous;
    try {
      previous = await withTransaction(this.pool, async client => {
        const row = (await client.query('SELECT body_key,poster_key FROM user_avatars WHERE user_id=$1 FOR UPDATE', [input.userId])).rows[0];
        await client.query(
          `INSERT INTO user_avatars(user_id,kind,media_type,body,body_key,sha256,byte_length,animated,poster_media_type,poster_body,poster_key,poster_sha256,width,height,frame_count,duration_ms,updated_at)
           VALUES ($1,'upload',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (user_id) DO UPDATE SET kind='upload',preset_key=NULL,media_type=EXCLUDED.media_type,body=EXCLUDED.body,body_key=EXCLUDED.body_key,sha256=EXCLUDED.sha256,byte_length=EXCLUDED.byte_length,animated=EXCLUDED.animated,poster_media_type=EXCLUDED.poster_media_type,poster_body=EXCLUDED.poster_body,poster_key=EXCLUDED.poster_key,poster_sha256=EXCLUDED.poster_sha256,width=EXCLUDED.width,height=EXCLUDED.height,frame_count=EXCLUDED.frame_count,duration_ms=EXCLUDED.duration_ms,updated_at=EXCLUDED.updated_at`,
          [input.userId, input.mediaType, this.avatarStore ? null : input.body, bodyKey, input.sha256, input.body.length, input.animated, input.posterMediaType, this.avatarStore ? null : input.posterBody, posterKey, input.posterSha256, input.width, input.height, input.frameCount, input.durationMs, input.now],
        );
        return row;
      });
    } catch (error) {
      await this.removeAvatarObjects([bodyKey, posterKey]);
      throw error;
    }
    await this.removeAvatarObjects([previous?.body_key, previous?.poster_key], new Set([bodyKey, posterKey].filter(Boolean)));
    return this.getAccountProfile(input.userId);
  }

  async getUploadedAvatar(userId, variant = 'animated') {
    const row = (await this.pool.query(
      "SELECT media_type,body,body_key,sha256,animated,poster_media_type,poster_body,poster_key,poster_sha256 FROM user_avatars WHERE user_id=$1 AND kind='upload'",
      [userId],
    )).rows[0];
    if (!row) return null;
    if (variant === 'static' && (row.poster_body || row.poster_key)) {
      const body = row.poster_key && this.avatarStore ? await this.avatarStore.get(row.poster_key) : Buffer.from(row.poster_body);
      return { mediaType: row.poster_media_type, body, sha256: Buffer.from(row.poster_sha256), animated: false };
    }
    const body = row.body_key && this.avatarStore ? await this.avatarStore.get(row.body_key) : Buffer.from(row.body);
    return { mediaType: row.media_type, body, sha256: Buffer.from(row.sha256), animated: row.animated };
  }

  async listDeviceGrants(input) {
    const rows = (await this.pool.query(
      `SELECT id,device_label,client_kind,authenticated_at,last_seen_at,expires_at
         FROM device_grants
        WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>$2
        ORDER BY last_seen_at DESC`,
      [input.userId, input.now],
    )).rows;
    return rows.map(row => ({
      id: row.id,
      deviceLabel: row.device_label,
      clientKind: row.client_kind,
      authenticatedAt: new Date(row.authenticated_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      current: row.id === input.currentGrantId,
    }));
  }

  async revokeDeviceGrant(input) {
    return withTransaction(this.pool, async client => {
      const revoked = (await client.query(
        `UPDATE device_grants SET revoked_at=COALESCE(revoked_at,$3)
          WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
        [input.grantId, input.userId, input.now],
      )).rows;
      if (!revoked.length) return 0;
      await client.query('UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=$1', [input.grantId, input.now]);
      await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=$1', [input.grantId, input.now]);
      return 1;
    });
  }

  async revokeOtherDeviceGrants(input) {
    return withTransaction(this.pool, async client => {
      const ids = (await client.query(
        `UPDATE device_grants SET revoked_at=COALESCE(revoked_at,$3)
          WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id`,
        [input.userId, input.currentGrantId, input.now],
      )).rows.map(row => row.id);
      if (!ids.length) return 0;
      await client.query('UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=ANY($1::uuid[])', [ids, input.now]);
      await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=ANY($1::uuid[])', [ids, input.now]);
      return ids.length;
    });
  }

  async revokeAllDeviceGrants(input) {
    return withTransaction(this.pool, async client => {
      const ids = (await client.query(
        `UPDATE device_grants SET revoked_at=COALESCE(revoked_at,$2)
          WHERE user_id=$1 AND revoked_at IS NULL RETURNING id`,
        [input.userId, input.now],
      )).rows.map(row => row.id);
      if (!ids.length) return 0;
      await client.query('UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=ANY($1::uuid[])', [ids, input.now]);
      await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=ANY($1::uuid[])', [ids, input.now]);
      return ids.length;
    });
  }

  async logoutGrant(input) {
    await withTransaction(this.pool, async client => {
      await client.query('UPDATE device_grants SET revoked_at=COALESCE(revoked_at,$2) WHERE id=$1', [input.grantId, input.now]);
      await client.query('UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=$1', [input.grantId, input.now]);
      await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,$2) WHERE grant_id=$1', [input.grantId, input.now]);
    });
  }
}
