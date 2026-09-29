import Fastify from 'fastify';
import crypto from 'node:crypto';
import { AuthError } from './auth-service.mjs';
import { WorkError } from './work-service.mjs';
import { UploadError } from './upload-service.mjs';
import { CatalogError } from './catalog-service.mjs';
import { EngagementError } from './engagement-service.mjs';
import { ModerationError } from './moderation-service.mjs';
import { SocialError } from './social-service.mjs';
import { GuessBaikeError } from './guess-baike-service.mjs';

const envelope = data => ({ data });
const readLimitedBody = async (stream, limit) => {
  const chunks = []; let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > limit) throw new AuthError('AVATAR_TOO_LARGE', 413, '头像不能超过 2 MB。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
const githubCallbackPage = (success, nonce) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${success ? 'GitHub 登录完成' : 'GitHub 登录未完成'}</title><style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0b11;color:#f7f4ff;font-family:ui-monospace,monospace}.card{max-width:420px;margin:24px;padding:32px;border:2px solid ${success ? '#4fd49a' : '#ff6f87'};background:#15131d;box-shadow:7px 7px 0 #343040;text-align:center}b{display:block;margin-bottom:12px;font-size:20px}p{margin:0 0 18px;color:#aaa4b9;line-height:1.7}button{border:1px solid #6f66ff;background:#6f66ff;color:#fff;padding:9px 16px;font:inherit;cursor:pointer}</style></head><body><main class="card"><b>${success ? '✓ 已连接 GameHub' : '× 授权没有完成'}</b><p>${success ? '登录已完成，本页将自动关闭。' : '请关闭此页面，返回 GameHub 后重新尝试。'}</p><button id="close-page" type="button">关闭页面</button></main><script nonce="${nonce}">const closePage=()=>window.close();document.getElementById('close-page').addEventListener('click',closePage);${success ? 'setTimeout(closePage,700);' : ''}</script></body></html>`;

export function createApp({ config, database, migrations, authService, workService, uploadService, catalogService, engagementService, guessBaikeService, guessBaikeAutomation, moderationService, socialService, logger = false }) {
  const app = Fastify({
    logger,
    bodyLimit: config.requestBodyLimit,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    ajv: { customOptions: { removeAdditional: false } },
  });
  const corsOrigins = new Set(config.corsOrigins ?? []);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const trustedEditorWebview = (config.nodeEnv === 'development' || config.trustEditorWebviews) && /^vscode-webview:\/\/[a-z0-9-]+$/i.test(origin ?? '');
    if (!origin || (!corsOrigins.has(origin) && !trustedEditorWebview)) return;
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, If-Match');
    reply.header('Access-Control-Expose-Headers', 'ETag, X-Request-Id');
    if (request.method === 'OPTIONS') return reply.status(204).send();
  });
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof AuthError || error instanceof WorkError || error instanceof UploadError || error instanceof CatalogError || error instanceof EngagementError || error instanceof ModerationError || error instanceof SocialError || error instanceof GuessBaikeError;
    const statusCode = known ? error.statusCode : (error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    const code = known ? error.code : (statusCode === 400 ? 'SCHEMA_INVALID' : 'INTERNAL_ERROR');
    reply.status(statusCode).send({ error: { code, message: known ? error.message : (statusCode < 500 ? error.message : 'An internal error occurred.'), requestId: request.id, retryable: known ? error.retryable : statusCode >= 500, details: {} } });
  });
  app.addContentTypeParser(['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'], (request, payload, done) => done(null, payload));

  app.get('/health', async () => envelope({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      const [databaseOk, migration] = await Promise.all([database.ping(), migrations.status()]);
      if (!databaseOk || !migration.ready) return reply.status(503).send(envelope({ status: 'not-ready', database: databaseOk, migrations: migration }));
      return envelope({ status: 'ready', database: true, migrations: migration });
    } catch {
      return reply.status(503).send(envelope({ status: 'not-ready', database: false }));
    }
  });

  app.post('/v1/auth/email/challenges', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'clientKind'], properties: { email: { type: 'string', maxLength: 320 }, clientKind: { type: 'string', enum: ['harness', 'vscode', 'cursor', 'browser'] } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.requestChallenge(request.body));
  });

  app.post('/v1/auth/email/verify', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['challengeId', 'code', 'deviceLabel'], properties: { challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^[0-9]{6}$' }, deviceLabel: { type: 'string', minLength: 1, maxLength: 120 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.verifyChallenge(request.body));
  });

  app.post('/v1/auth/github/device', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['clientKind', 'deviceLabel'], properties: { clientKind: { type: 'string', enum: ['harness', 'vscode', 'cursor', 'browser'] }, deviceLabel: { type: 'string', minLength: 1, maxLength: 120 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.startGitHubDevice(request.body));
  });

  app.post('/v1/auth/github/device/:challengeId/poll', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['challengeId'], properties: { challengeId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.pollGitHubDevice(request.params));
  });

  app.post('/v1/auth/github/web', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['clientKind', 'deviceLabel'], properties: { clientKind: { type: 'string', enum: ['harness', 'vscode', 'cursor', 'browser'] }, deviceLabel: { type: 'string', minLength: 1, maxLength: 120 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.startGitHubWeb(request.body));
  });

  app.get('/v1/auth/github/web/callback', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['state'], properties: { code: { type: 'string', minLength: 1, maxLength: 512 }, state: { type: 'string', minLength: 20, maxLength: 256 }, error: { type: 'string', maxLength: 120 }, error_description: { type: 'string', maxLength: 500 }, iss: { type: 'string', enum: ['https://github.com', 'https://github.com/login/oauth'] } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const scriptNonce = crypto.randomBytes(18).toString('base64url');
    reply.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; base-uri 'none'; form-action 'none'`);
    const result = await authService.completeGitHubWeb(request.query);
    return reply.type('text/html; charset=utf-8').send(githubCallbackPage(result.status === 'complete', scriptNonce));
  });

  app.post('/v1/auth/github/web/:challengeId/poll', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['challengeId'], properties: { challengeId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.pollGitHubWeb(request.params));
  });

  app.post('/v1/auth/refresh', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['refreshToken'], properties: { refreshToken: { type: 'string', minLength: 32 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.refresh(request.body));
  });

  const requireAuth = async request => { request.actor = await authService.authenticateBearer(request.headers.authorization); };
  const workKeySchema = { type: 'string', pattern: '^(?:gamehub-[a-z0-9-]{1,100}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$' };
  if (guessBaikeService) {
    app.get('/v1/games/guess-baike/daily', async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=60');
      return envelope(await guessBaikeService.daily());
    });
  }
  if (catalogService) {
    app.get('/v1/works', {
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, kind: { type: 'string', enum: ['game', 'creative', 'tool'] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'public, max-age=30');
      return envelope(await catalogService.list(request.query));
    });
    app.get('/v1/works/:workId', {
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'public, max-age=30');
      return envelope(await catalogService.get(request.params.workId));
    });
    app.get('/v1/works/:workId/launch', {
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } },
        querystring: { type: 'object', additionalProperties: false, properties: { releaseId: { type: 'string', format: 'uuid' } } },
      },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await catalogService.launch(request.params.workId, request.query.releaseId));
    });
  }
  app.get('/v1/me', { preHandler: requireAuth }, async request => envelope(await authService.getProfile(request.actor)));
  app.patch('/v1/me', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', additionalProperties: false, required: ['displayName'], properties: { displayName: { type: 'string', minLength: 1, maxLength: 40 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.updateProfile(request.actor, request.body));
  });
  app.patch('/v1/me/avatar', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', additionalProperties: false, required: ['presetKey'], properties: { presetKey: { type: 'string', enum: ['cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard'] } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.setPresetAvatar(request.actor, request.body));
  });
  app.put('/v1/me/avatar', {
    preHandler: requireAuth,
    bodyLimit: 3 * 1024 * 1024,
  }, async (request, reply) => {
    const body = await readLimitedBody(request.body, 2 * 1024 * 1024);
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.uploadAvatar(request.actor, body));
  });
  app.get('/v1/avatars/:userId', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } },
      querystring: { type: 'object', additionalProperties: false, properties: { variant: { type: 'string', enum: ['animated', 'static'] }, v: { type: 'string', maxLength: 64 } } },
    },
  }, async (request, reply) => {
    const avatar = await authService.getAvatar(request.params.userId, request.query.variant);
    reply.header('Cache-Control', 'public, max-age=300');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return reply.type(avatar.mediaType).send(avatar.body);
  });
  app.post('/v1/auth/device/logout', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.logout(request.actor));
  });
  app.post('/v1/auth/devices/logout-others', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.logoutOthers(request.actor));
  });
  app.post('/v1/auth/devices/logout-all', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.logoutAll(request.actor));
  });
  app.get('/v1/me/devices', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.listDevices(request.actor));
  });
  app.delete('/v1/me/devices/:grantId', {
    preHandler: requireAuth,
    schema: { params: { type: 'object', additionalProperties: false, required: ['grantId'], properties: { grantId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.revokeDevice(request.actor, request.params));
  });

  if (engagementService) {
    const libraryParams = { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } };
    app.get('/v1/me/library', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await engagementService.list(request.actor));
    });
    app.get('/v1/me/library/:workId', { preHandler: requireAuth, schema: { params: libraryParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await engagementService.get(request.actor, request.params.workId));
    });
    app.put('/v1/me/library/:workId', { preHandler: requireAuth, schema: { params: libraryParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await engagementService.save(request.actor, request.params.workId));
    });
    app.delete('/v1/me/library/:workId', { preHandler: requireAuth, schema: { params: libraryParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await engagementService.unsave(request.actor, request.params.workId));
    });
    app.post('/v1/me/recent/:workId', { preHandler: requireAuth, schema: { params: libraryParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await engagementService.recordPlay(request.actor, request.params.workId));
    });
    app.post('/v1/games/guess-baike/results', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['puzzleDate','puzzleId','guessedCount','elapsedSeconds','hints'], properties: {
        puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, puzzleId: { type: 'string', minLength: 1, maxLength: 120 },
        guessedCount: { type: 'integer', minimum: 0, maximum: 500 }, elapsedSeconds: { type: 'integer', minimum: 0, maximum: 86400 }, hints: { type: 'integer', minimum: 0, maximum: 2 },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      await guessBaikeService?.assertPuzzle(request.body.puzzleDate, request.body.puzzleId);
      return envelope(await engagementService.saveGuessResult(request.actor, request.body));
    });
  }

  if (guessBaikeService) {
    const puzzleIdParams = { type: 'object', additionalProperties: false, required: ['puzzleId'], properties: { puzzleId: { type: 'string', minLength: 1, maxLength: 120 } } };
    app.get('/v1/admin/games/guess-baike/puzzles', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await guessBaikeService.listAdmin(request.actor));
    });
    app.get('/v1/admin/games/guess-baike/automation', { preHandler: requireAuth }, async (request, reply) => {
      guessBaikeService.authorizeAdmin(request.actor); reply.header('Cache-Control', 'no-store');
      return envelope(await guessBaikeAutomation.status());
    });
    app.patch('/v1/admin/games/guess-baike/puzzles/:puzzleId', {
      preHandler: requireAuth,
      schema: { params: puzzleIdParams, body: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['ready','disabled'] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await guessBaikeService.setStatus(request.actor, request.params.puzzleId, request.body.status));
    });
    app.put('/v1/admin/games/guess-baike/schedule', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['date','puzzleId'], properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, puzzleId: { type: 'string', minLength: 1, maxLength: 120 } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await guessBaikeService.schedule(request.actor, request.body));
    });
  }

  if (socialService) {
    const userParams = { type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } };
    const puzzleDateBody = { type: 'object', additionalProperties: false, required: ['puzzleDate'], properties: { puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } };
    app.get('/v1/me/social', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.getSettings(request.actor));
    });
    app.patch('/v1/me/social', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['bio','visibility'], properties: { bio: { type: 'string', maxLength: 160 }, visibility: { type: 'string', enum: ['public','followers','private'] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.updateSettings(request.actor, request.body));
    });
    app.get('/v1/users/:userId', { preHandler: requireAuth, schema: { params: userParams } }, async (request, reply) => envelope(await socialService.getProfile(request.actor, request.params.userId)));
    app.put('/v1/users/:userId/follow', { preHandler: requireAuth, schema: { params: userParams } }, async (request, reply) => envelope(await socialService.follow(request.actor, request.params.userId)));
    app.delete('/v1/users/:userId/follow', { preHandler: requireAuth, schema: { params: userParams } }, async (request, reply) => envelope(await socialService.unfollow(request.actor, request.params.userId)));
    app.put('/v1/users/:userId/block', { preHandler: requireAuth, schema: { params: userParams } }, async (request, reply) => envelope(await socialService.block(request.actor, request.params.userId)));
    app.delete('/v1/users/:userId/block', { preHandler: requireAuth, schema: { params: userParams } }, async (request, reply) => envelope(await socialService.unblock(request.actor, request.params.userId)));
    app.get('/v1/games/guess-baike/leaderboard', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, required: ['date','scope'], properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, scope: { type: 'string', enum: ['global','following'] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.leaderboard(request.actor, request.query));
    });
    app.put('/v1/games/guess-baike/reactions/:userId', {
      preHandler: requireAuth,
      schema: { params: userParams, body: { ...puzzleDateBody, required: ['puzzleDate','reaction'], properties: { ...puzzleDateBody.properties, reaction: { type: 'string', enum: ['gg','spark','wow','coffee'] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.react(request.actor, request.params.userId, request.body));
    });
    app.delete('/v1/games/guess-baike/reactions/:userId', {
      preHandler: requireAuth, schema: { params: userParams, body: puzzleDateBody },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.removeReaction(request.actor, request.params.userId, request.body));
    });
    app.get('/v1/me/notifications', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.listNotifications(request.actor));
    });
    app.post('/v1/me/notifications/read', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.markNotificationsRead(request.actor));
    });
    app.post('/v1/games/guess-baike/challenges', {
      preHandler: requireAuth, schema: { body: puzzleDateBody },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.createChallenge(request.actor, request.body));
    });
    const challengeParams = { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,24}$' } } };
    app.get('/v1/challenges/:code', {
      preHandler: requireAuth,
      schema: { params: challengeParams },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.getChallenge(request.actor, request.params.code));
    });
    app.post('/v1/challenges/:code/accept', { preHandler: requireAuth, schema: { params: challengeParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.acceptChallenge(request.actor, request.params.code));
    });
    app.post('/v1/challenges/:code/complete', { preHandler: requireAuth, schema: { params: challengeParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.completeChallenge(request.actor, request.params.code));
    });
    app.get('/v1/me/challenges', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.listChallenges(request.actor));
    });
    app.get('/v1/me/retention', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.getRetention(request.actor));
    });
    const preferenceBody = { type: 'object', additionalProperties: false, required: ['follow','reaction','challenge'], properties: { follow: { type: 'boolean' }, reaction: { type: 'boolean' }, challenge: { type: 'boolean' } } };
    app.get('/v1/me/notification-preferences', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.getNotificationPreferences(request.actor));
    });
    app.put('/v1/me/notification-preferences', { preHandler: requireAuth, schema: { body: preferenceBody } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await socialService.updateNotificationPreferences(request.actor, request.body));
    });
  }

  if (moderationService) {
    const reportParams = { type: 'object', additionalProperties: false, required: ['reportId'], properties: { reportId: { type: 'string', format: 'uuid' } } };
    app.post('/v1/works/:workId/reports', {
      preHandler: requireAuth,
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } },
        body: { type: 'object', additionalProperties: false, required: ['category'], properties: {
          category: { type: 'string', enum: ['unsafe','malware','harassment','copyright','other'] },
          details: { type: 'string', maxLength: 1000 },
        } },
      },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await moderationService.report(request.actor, request.params.workId, request.body));
    });
    app.get('/v1/admin/reports', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', enum: ['open','resolved','dismissed','all'] }, limit: { type: 'integer', minimum: 1, maximum: 100 },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await moderationService.list(request.actor, request.query));
    });
    app.post('/v1/admin/reports/:reportId/decision', {
      preHandler: requireAuth,
      schema: { params: reportParams, body: { type: 'object', additionalProperties: false, required: ['action','note'], properties: {
        action: { type: 'string', enum: ['suspend','dismiss'] }, note: { type: 'string', minLength: 1, maxLength: 1000 },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await moderationService.decide(request.actor, request.params.reportId, request.body));
    });
    app.get('/v1/admin/audit', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await moderationService.audit(request.actor, request.query));
    });
  }

  if (workService) {
    app.get('/v1/creator/works', { preHandler: requireAuth }, async request => envelope(await workService.list(request.actor)));
    app.post('/v1/creator/works', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['title', 'description', 'kind'], properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, instructions: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['game', 'creative', 'tool'] } } } },
    }, async (request, reply) => {
      const result = await workService.create(request.actor, request.body, request.headers['idempotency-key']);
      reply.header('ETag', result.etag);
      return envelope(result.work);
    });
    app.patch('/v1/creator/works/:workId', {
      preHandler: requireAuth,
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, instructions: { type: 'string', maxLength: 4000 } } },
      },
    }, async (request, reply) => {
      const result = await workService.update(request.actor, request.params.workId, request.body, request.headers['idempotency-key'], request.headers['if-match']);
      reply.header('ETag', result.etag);
      return envelope(result.work);
    });
    app.get('/v1/creator/works/:workId/releases', {
      preHandler: requireAuth,
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await workService.listReleases(request.actor, request.params.workId));
    });
    app.put('/v1/creator/works/:workId/cover', {
      preHandler: requireAuth,
      bodyLimit: 6 * 1024 * 1024,
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } } },
    }, async (request, reply) => {
      const body = await readLimitedBody(request.body, 5 * 1024 * 1024);
      const result = await workService.uploadCover(request.actor, request.params.workId, body);
      reply.header('Cache-Control', 'no-store'); reply.header('ETag', result.etag);
      return envelope(result.work);
    });
    app.get('/v1/works/:workId/cover', {
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } },
        querystring: { type: 'object', additionalProperties: false, properties: { v: { type: 'string', maxLength: 64 } } },
      },
    }, async (request, reply) => {
      const cover = await workService.getCover(request.params.workId);
      reply.header('Cache-Control', 'public, max-age=300'); reply.header('X-Content-Type-Options', 'nosniff'); reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
      return reply.type(cover.mediaType).send(cover.body);
    });
    app.post('/v1/creator/works/:workId/withdraw', {
      preHandler: requireAuth,
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } } },
    }, async (request, reply) => {
      const result = await workService.withdraw(request.actor, request.params.workId, request.headers['idempotency-key'], request.headers['if-match']);
      reply.header('ETag', result.etag);
      return envelope(result.work);
    });
  }
  if (uploadService) {
    const uploadParams = { type: 'object', additionalProperties: false, required: ['uploadId'], properties: { uploadId: { type: 'string', format: 'uuid' } } };
    app.post('/v1/creator/works/:workId/uploads', {
      preHandler: requireAuth,
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object', additionalProperties: false,
          required: ['fileName', 'declaredBytes', 'sha256', 'releaseLabel', 'autoPublish', 'targetKey', 'packageType'],
          properties: {
            fileName: { type: 'string', minLength: 1, maxLength: 255 },
            declaredBytes: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
            sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            releaseLabel: { type: 'string', minLength: 1, maxLength: 64 },
            autoPublish: { type: 'boolean' },
            targetKey: { type: 'string', enum: ['web', 'windows-x64', 'windows-x86', 'windows-arm64'] },
            packageType: { type: 'string', enum: ['web_zip', 'windows_portable_zip', 'windows_standalone_exe', 'windows_installer_exe'] },
          },
        },
      },
    }, async request => envelope(await uploadService.create(request.actor, request.params.workId, request.body, request.headers['idempotency-key'])));

    app.post('/v1/creator/uploads/:uploadId/grant', { preHandler: requireAuth, schema: { params: uploadParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await uploadService.grant(request.actor, request.params.uploadId));
    });

    app.put('/v1/creator/uploads/:uploadId/content', { schema: { params: uploadParams } }, async request => (
      envelope(await uploadService.receive(request.params.uploadId, request.headers.authorization, request.body))
    ));

    app.post('/v1/creator/uploads/:uploadId/complete', { preHandler: requireAuth, schema: { params: uploadParams } }, async request => (
      envelope(await uploadService.complete(request.actor, request.params.uploadId, request.headers['idempotency-key']))
    ));

    app.get('/v1/creator/uploads/:uploadId', { preHandler: requireAuth, schema: { params: uploadParams } }, async request => (
      envelope(await uploadService.get(request.actor, request.params.uploadId))
    ));
  }
  return app;
}
