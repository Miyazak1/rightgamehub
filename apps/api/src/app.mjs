import Fastify from 'fastify';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { AuthError } from './auth-service.mjs';
import { WorkError } from './work-service.mjs';
import { UploadError } from './upload-service.mjs';
import { CatalogError } from './catalog-service.mjs';
import { EngagementError } from './engagement-service.mjs';
import { ModerationError } from './moderation-service.mjs';
import { SocialError } from './social-service.mjs';
import { GuessBaikeError } from './guess-baike-service.mjs';
import { AnalyticsError } from './analytics-service.mjs';
import { StorageCapacityError } from './storage-capacity-service.mjs';
import { RealtimeTicketError } from './realtime-ticket-service.mjs';
import { MultiplayerRoomError } from './multiplayer-room-service.mjs';
import { MultiplayerMatchError } from './multiplayer-match-service.mjs';
import { GitHubSourceError } from './github-source-service.mjs';

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

export function createApp({ config, database, migrations, authService, workService, githubSourceService, uploadService, catalogService, engagementService, guessBaikeService, guessBaikeAutomation, moderationService, socialService, analyticsService, storageCapacityService, realtimeTicketService, multiplayerRoomService, multiplayerMatchService, logger = false }) {
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
    const known = error instanceof AuthError || error instanceof WorkError || error instanceof GitHubSourceError || error instanceof UploadError || error instanceof CatalogError || error instanceof EngagementError || error instanceof ModerationError || error instanceof SocialError || error instanceof GuessBaikeError || error instanceof AnalyticsError || error instanceof StorageCapacityError || error instanceof RealtimeTicketError || error instanceof MultiplayerRoomError || error instanceof MultiplayerMatchError;
    const statusCode = known ? error.statusCode : (error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    const code = known ? error.code : (statusCode === 400 ? 'SCHEMA_INVALID' : 'INTERNAL_ERROR');
    reply.status(statusCode).send({ error: { code, message: known ? error.message : (statusCode < 500 ? error.message : 'An internal error occurred.'), requestId: request.id, retryable: known ? error.retryable : statusCode >= 500, details: {} } });
  });
  app.addContentTypeParser(['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'], (request, payload, done) => done(null, payload));

  app.get('/health', async () => envelope({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      const [databaseOk, migration, realtimeOk] = await Promise.all([database.ping(), migrations.status(), realtimeTicketService?.ready?.() ?? true]);
      if (!databaseOk || !migration.ready || !realtimeOk) return reply.status(503).send(envelope({ status: 'not-ready', database: databaseOk, migrations: migration, realtime: realtimeOk }));
      return envelope({ status: 'ready', database: true, migrations: migration, realtime: realtimeOk });
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
  const identifyOptional = async request => {
    request.actor = request.headers.authorization ? await authService.authenticateBearer(request.headers.authorization) : null;
  };
  const workKeySchema = { type: 'string', pattern: '^(?:gamehub-[a-z0-9-]{1,100}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$' };
  if (realtimeTicketService) {
    app.post('/v1/realtime/tickets', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await realtimeTicketService.issue(request.actor));
    });
  }
  if (multiplayerRoomService) {
    const modeParams = { type: 'object', additionalProperties: false, required: ['modeId'], properties: { modeId: { type: 'string', format: 'uuid' } } };
    const roomParams = { type: 'object', additionalProperties: false, required: ['roomId'], properties: { roomId: { type: 'string', format: 'uuid' } } };
    const roomSettings = { type: 'object', additionalProperties: false, properties: {
      turnSeconds: { type: 'integer', minimum: 10, maximum: 3600 }, spectators: { type: 'boolean' }, reconnectGraceSeconds: { type: 'integer', minimum: 15, maximum: 600 },
    } };
    app.get('/v1/works/:workId/multiplayer-modes', {
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'public, max-age=30'); return envelope(await multiplayerRoomService.listModes(request.params.workId)); });
    app.post('/v1/admin/multiplayer/modes', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['workId','key','name','authority','minPlayers','maxPlayers','rulesetVersion'], properties: {
        workId: { type: 'string', format: 'uuid' }, key: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' }, name: { type: 'string', minLength: 1, maxLength: 80 },
        authority: { type: 'string', enum: ['platform_authoritative','external_authoritative','relay_unverified'] }, minPlayers: { type: 'integer', minimum: 2, maximum: 8 }, maxPlayers: { type: 'integer', minimum: 2, maximum: 8 },
        rulesetVersion: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' }, config: roomSettings,
      } } },
    }, async request => envelope(await multiplayerRoomService.createMode(request.actor, request.body)));
    app.get('/v1/multiplayer/rooms', {
      schema: { querystring: { type: 'object', additionalProperties: false, required: ['modeId'], properties: { modeId: { type: 'string', format: 'uuid' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, query: { type: 'string', maxLength: 80 } } } },
    }, async request => envelope(await multiplayerRoomService.listRooms(request.query)));
    app.post('/v1/multiplayer/rooms', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['modeId','visibility','capacity'], properties: {
        modeId: { type: 'string', format: 'uuid' }, visibility: { type: 'string', enum: ['public','invite_only'] }, capacity: { type: 'integer', minimum: 2, maximum: 8 }, settings: roomSettings,
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerRoomService.createRoom(request.actor, request.body, request.headers['idempotency-key'])); });
    app.get('/v1/multiplayer/rooms/:roomId', { preHandler: requireAuth, schema: { params: roomParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerRoomService.getRoom(request.actor, request.params.roomId));
    });
    app.post('/v1/multiplayer/rooms/:roomId/join', {
      preHandler: requireAuth, schema: { params: roomParams, body: { type: 'object', additionalProperties: false, properties: { joinCode: { type: 'string', pattern: '^[A-HJ-NP-Za-hj-np-z2-9]{5}-?[A-HJ-NP-Za-hj-np-z2-9]{5}$' }, modeId: { type: 'string', format: 'uuid' } } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerRoomService.joinRoom(request.actor, request.params.roomId, request.body)); });
    app.post('/v1/multiplayer/rooms/:roomId/invite', { preHandler: requireAuth, schema: { params: roomParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerRoomService.createInvite(request.actor, request.params.roomId));
    });
    app.post('/v1/multiplayer/rooms/:roomId/leave', { preHandler: requireAuth, schema: { params: roomParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerRoomService.leaveRoom(request.actor, request.params.roomId));
    });
    app.post('/v1/multiplayer/rooms/:roomId/ready', {
      preHandler: requireAuth, schema: { params: roomParams, body: { type: 'object', additionalProperties: false, required: ['ready'], properties: { ready: { type: 'boolean' } } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerRoomService.setReady(request.actor, request.params.roomId, request.body.ready)); });
  }
  if (multiplayerMatchService) {
    const matchParams = { type: 'object', additionalProperties: false, required: ['matchId'], properties: { matchId: { type: 'string', format: 'uuid' } } };
    app.post('/v1/multiplayer/rooms/:roomId/start', {
      preHandler: requireAuth,
      schema: { params: { type: 'object', additionalProperties: false, required: ['roomId'], properties: { roomId: { type: 'string', format: 'uuid' } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await multiplayerMatchService.startRoom(request.actor, request.params.roomId, request.headers['idempotency-key']));
    });
    app.get('/v1/multiplayer/matches/:matchId', { preHandler: requireAuth, schema: { params: matchParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.getMatch(request.actor, request.params.matchId));
    });
    app.get('/v1/multiplayer/matches/:matchId/events', {
      preHandler: requireAuth,
      schema: { params: matchParams, querystring: { type: 'object', additionalProperties: false, properties: {
        afterSeq: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.listEvents(request.actor, request.params.matchId, request.query));
    });
    app.get('/v1/multiplayer/matches/:matchId/replay', { preHandler: requireAuth, schema: { params: matchParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.getReplay(request.actor, request.params.matchId));
    });
    app.get('/v1/admin/multiplayer/overview', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.adminOverview(request.actor));
    });
    app.get('/v1/admin/multiplayer/matches', {
      preHandler: requireAuth,schema: { querystring: { type: 'object',additionalProperties: false,properties: {
        status: { type: 'string',enum: ['all','pending','active','finishing','completed','aborted'] },limit: { type: 'integer',minimum: 1,maximum: 100 },
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.adminList(request.actor,request.query)); });
    app.post('/v1/admin/multiplayer/matches/:matchId/abort', {
      preHandler: requireAuth,schema: { params: matchParams,body: { type: 'object',additionalProperties: false,required: ['reason'],properties: { reason: { type: 'string',minLength: 1,maxLength: 1000 } } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.adminAbort(request.actor,request.params.matchId,request.body)); });
    app.get('/v1/admin/multiplayer/audit', {
      preHandler: requireAuth,schema: { querystring: { type: 'object',additionalProperties: false,properties: { limit: { type: 'integer',minimum: 1,maximum: 100 } } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await multiplayerMatchService.adminAudit(request.actor,request.query)); });
  }
  if (analyticsService) {
    const analyticsEvent = {
      type: 'object', additionalProperties: false, required: ['type','anonymousId','sessionId','hostKind','occurredAt'], properties: {
        type: { type: 'string', enum: ['page_view','session_ping','work_view','download_start','download_complete','game_start','game_end'] },
        anonymousId: { type: 'string', format: 'uuid' }, sessionId: { type: 'string', format: 'uuid' },
        hostKind: { type: 'string', enum: ['browser','cursor','vscode','code','harness','codex','claude','opencode','unknown'] },
        route: { type: 'string', enum: ['discover','library','social','creator','admin','work','play','auth','settings','unknown'] },
        workId: workKeySchema, releaseId: { type: 'string', format: 'uuid' },
        durationMs: { type: 'integer', minimum: 0, maximum: 600000 }, occurredAt: { type: 'string', format: 'date-time' },
      },
    };
    app.post('/v1/analytics/events', {
      preHandler: identifyOptional,
      schema: { body: { type: 'object', additionalProperties: false, required: ['events'], properties: { events: { type: 'array', minItems: 1, maxItems: 20, items: analyticsEvent } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.status(202).send(envelope(await analyticsService.record(request.actor, request.body)));
    });
    app.get('/v1/admin/analytics', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: [7,30,90] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await analyticsService.overview(request.actor, request.query));
    });
  }
  if (storageCapacityService) {
    app.get('/v1/admin/storage', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await storageCapacityService.adminOverview(request.actor));
    });
  }
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
    app.get('/v1/works/:workId/releases/:releaseId/download', {
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId','releaseId'], properties: {
        workId: workKeySchema, releaseId: { type: 'string', format: 'uuid' },
      } } },
    }, async (request, reply) => {
      const artifact = await catalogService.download(request.params.workId, request.params.releaseId);
      const fallback = `gamehub-${artifact.releaseId}.exe`;
      const fileName = /^[^\\/:*?"<>|\x00-\x1f]{1,180}\.exe$/i.test(artifact.fileName ?? '') ? artifact.fileName : fallback;
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      reply.header('Content-Length', String(artifact.sizeBytes));
      reply.header('ETag', `"${artifact.sha256}"`);
      return reply.type('application/octet-stream').send(createReadStream(artifact.filePath));
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
  app.get('/v1/me/creator-application', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.getCreatorApplication(request.actor));
  });
  app.post('/v1/me/creator-application', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', additionalProperties: false, required: ['statement'], properties: {
      statement: { type: 'string', minLength: 20, maxLength: 1000 },
    } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.applyForCreator(request.actor, request.body));
  });
  app.get('/v1/admin/creator-applications', {
    preHandler: requireAuth,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', enum: ['pending','approved','rejected','all'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.listCreatorApplications(request.actor, request.query));
  });
  app.post('/v1/admin/creator-applications/:applicationId/decision', {
    preHandler: requireAuth,
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['applicationId'], properties: {
        applicationId: { type: 'string', format: 'uuid' },
      } },
      body: { type: 'object', additionalProperties: false, required: ['decision','note'], properties: {
        decision: { type: 'string', enum: ['approve','reject'] },
        note: { type: 'string', minLength: 1, maxLength: 1000 },
      } },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await authService.decideCreatorApplication(request.actor, request.params, request.body));
  });
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
    const workDiscoveryProperties = {
      estimatedMinutes: { type: 'integer', minimum: 1, maximum: 30 },
      tags: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 20 } },
      agentLabel: { anyOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
      repositoryUrl: { anyOf: [{ type: 'string', pattern: '^https://github\\.com/[^/\\s]+/[^/\\s]+/?$' }, { type: 'null' }] },
      licenseSpdx: { anyOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
    };
    app.get('/v1/creator/works', { preHandler: requireAuth }, async request => envelope(await workService.list(request.actor)));
    app.post('/v1/creator/works', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['title', 'description', 'kind'], properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, instructions: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['game', 'creative', 'tool'] }, ...workDiscoveryProperties } } },
    }, async (request, reply) => {
      const result = await workService.create(request.actor, request.body, request.headers['idempotency-key']);
      reply.header('ETag', result.etag);
      return envelope(result.work);
    });
    app.patch('/v1/creator/works/:workId', {
      preHandler: requireAuth,
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, instructions: { type: 'string', maxLength: 4000 }, ...workDiscoveryProperties } },
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
  if (githubSourceService) {
    const connectionParams = { type: 'object', additionalProperties: false, required: ['connectionId'], properties: { connectionId: { type: 'string', format: 'uuid' } } };
    const workParams = { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } };
    app.get('/v1/integrations/github/setup', {
      schema: { querystring: { type: 'object', additionalProperties: true, required: ['state'], properties: {
        state: { type: 'string', minLength: 32, maxLength: 128 }, installation_id: { type: 'string', pattern: '^[1-9][0-9]*$' },
        setup_action: { type: 'string', enum: ['install','update'] },
      } } },
    }, async (request, reply) => {
      if (!config.githubSourceImportEnabled || !config.githubAppCallbackUrl) throw new GitHubSourceError('GITHUB_SOURCE_IMPORT_DISABLED', 404, 'GitHub source import is not enabled.');
      const target = new URL(config.githubAppCallbackUrl);
      target.searchParams.set('state', request.query.state);
      if (request.query.installation_id) target.searchParams.set('installation_id', request.query.installation_id);
      if (request.query.setup_action) target.searchParams.set('setup_action', request.query.setup_action);
      return reply.redirect(target.toString());
    });
    app.post('/v1/creator/source-connections/github/install', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await githubSourceService.startInstall(request.actor));
    });
    app.post('/v1/creator/source-connections/github/complete', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['state','installationId'], properties: {
        state: { type: 'string', minLength: 32, maxLength: 128 }, installationId: { type: 'string', pattern: '^[1-9][0-9]*$' },
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.completeInstall(request.actor, request.body)); });
    app.get('/v1/creator/source-connections', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.listConnections(request.actor));
    });
    app.delete('/v1/creator/source-connections/:connectionId', { preHandler: requireAuth, schema: { params: connectionParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.disconnect(request.actor, request.params.connectionId));
    });
    app.get('/v1/creator/source-connections/:connectionId/repositories', { preHandler: requireAuth, schema: { params: connectionParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.listRepositories(request.actor, request.params.connectionId));
    });
    app.post('/v1/creator/source-imports/preview', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['connectionId','repositoryId'], properties: {
        connectionId: { type: 'string', format: 'uuid' }, repositoryId: { type: 'string', pattern: '^[1-9][0-9]*$' },
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.preview(request.actor, request.body)); });
    app.post('/v1/creator/source-imports/drafts', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['importId','title'], properties: {
        importId: { type: 'string', format: 'uuid' }, title: { type: 'string', minLength: 1, maxLength: 120 },
        description: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['game','creative','tool'] },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await githubSourceService.createDraft(request.actor, request.body, request.headers['idempotency-key']));
    });
    app.get('/v1/creator/works/:workId/source', { preHandler: requireAuth, schema: { params: workParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.getWorkSource(request.actor, request.params.workId));
    });
    app.get('/v1/admin/source-imports/overview', { preHandler: requireAuth }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.adminOverview(request.actor));
    });
    app.get('/v1/admin/source-imports/audit', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await githubSourceService.adminAudit(request.actor, request.query.limit)); });
    app.register(async webhookApp => {
      webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));
      webhookApp.post('/v1/webhooks/github', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        return envelope(await githubSourceService.handleWebhook(request.headers, request.body));
      });
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

    app.put('/v1/creator/uploads/:uploadId/content', { bodyLimit: 500 * 1024 * 1024, schema: { params: uploadParams } }, async request => (
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
