import { GameShareError } from './game-share-service.mjs';
import { registerGameShareRoutes } from './game-share-routes.mjs';
import {CompetitionError} from './competition-service.mjs';
import {registerCompetitionRoutes} from './competition-routes.mjs';
import {registerSaveOperationsRoutes} from './save-operations-routes.mjs';
import {registerSaveLibraryRoutes} from './save-library-routes.mjs';
import Fastify from 'fastify';
import { CommunityError } from './community-errors.mjs';
import { registerCommunityRoutes } from './community-routes.mjs';
import { GameSaveError } from './game-save-service.mjs';
import { registerGameSaveRoutes } from './game-save-routes.mjs';
import { GameSessionError } from './game-session-service.mjs';
import { registerGameSessionRoutes } from './game-session-routes.mjs';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { AuthError } from './auth-service.mjs';
import { WorkError } from './work-service.mjs';
import { UploadError } from './upload-service.mjs';
import { CatalogError } from './catalog-service.mjs';
import { EngagementError } from './engagement-service.mjs';
import { ModerationError } from './moderation-service.mjs';
import { SocialError } from './social-service.mjs';
import { PublicProfileError } from './public-profile-service.mjs';
import { GuessBaikeError } from './guess-baike-service.mjs';
import { AnalyticsError } from './analytics-service.mjs';
import { CreatorFeedbackError } from './creator-feedback-service.mjs';
import { ContributionTaskError } from './contribution-task-service.mjs';
import { StorageCapacityError } from './storage-capacity-service.mjs';
import { RealtimeTicketError } from './realtime-ticket-service.mjs';
import { MultiplayerRoomError } from './multiplayer-room-service.mjs';
import { MultiplayerMatchError } from './multiplayer-match-service.mjs';
import { GitHubSourceError } from './github-source-service.mjs';
import { MultiplayerRuleSubmissionError } from './multiplayer-rule-submission-service.mjs';
import { SourceBuildRepositoryError } from './source-build-repository.mjs';
import { CreatorDraftError, CREATOR_STUDIOS } from './creator-draft-service.mjs';
import { ProjectClaimError } from './project-claim-service.mjs';
import { registerProjectClaimRoutes } from './project-claim-routes.mjs';

const envelope = data => ({ data });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const publicWorkPage = ({ work, siteOrigin, nonce }) => {
  const encodedWorkId = encodeURIComponent(work.id);
  const canonicalUrl = `${siteOrigin}/w/${encodedWorkId}`;
  const appUrl = `${siteOrigin}/#/works/${encodedWorkId}`;
  const title = `${work.title} | GameHub`;
  const description = String(work.description || `在 GameHub 在线体验《${work.title}》。`).replace(/\s+/gu, ' ').trim().slice(0, 200);
  const creator = work.creatorDisplayName ? `作者：${work.creatorDisplayName}` : 'GameHub 社区作品';
  const coverUrl = work.coverUrl ? new URL(work.coverUrl, `${siteOrigin}/`).href : null;
  const imageMeta = coverUrl ? `<meta property="og:image" content="${escapeHtml(coverUrl)}"><meta name="twitter:image" content="${escapeHtml(coverUrl)}">` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonicalUrl)}"><meta property="og:type" content="website"><meta property="og:site_name" content="GameHub"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonicalUrl)}">${imageMeta}<meta name="twitter:card" content="${coverUrl ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><style>html{color-scheme:light dark}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f7f6fb;color:#17131f;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei UI",sans-serif}.card{width:min(520px,calc(100% - 48px));padding:32px;border:1px solid #d8d3e2;background:#fff;box-shadow:5px 5px 0 #ded9e8}.label{color:#7651f5;font:800 11px ui-monospace,monospace;letter-spacing:.14em}h1{margin:12px 0 8px;font-size:28px}p{margin:0 0 20px;color:#625c6d;line-height:1.7}.creator{font-size:13px}a{display:inline-block;padding:10px 16px;background:#8255f6;color:#fff;font-weight:800;text-decoration:none}@media(prefers-color-scheme:dark){body{background:#111018;color:#f6f3ff}.card{border-color:#393445;background:#1b1822;box-shadow:5px 5px 0 #09080d}p{color:#b8b0c3}}</style></head><body><main class="card"><span class="label">GAMEHUB WORK</span><h1>${escapeHtml(work.title)}</h1><p>${escapeHtml(description)}</p><p class="creator">${escapeHtml(creator)}</p><a href="${escapeHtml(appUrl)}">打开作品</a></main><script nonce="${nonce}">window.location.replace(${JSON.stringify(appUrl).replace(/</gu, '\\u003c')});</script></body></html>`;
};
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

export function createApp(dependencies) {
  const {
    config,
    database,
    migrations,
    authService,
    workService,
    githubSourceService,
    sourceBuildService,
    uploadService,
    catalogService,
    engagementService,
    guessBaikeService,
    guessBaikeAutomation,
    moderationService,
    socialService,
    communityService,
    communityMediaService,
    publicProfileService,
    analyticsService,
    creatorFeedbackService,
    contributionTaskService,
    creatorDraftService,
    projectClaimService,
    storageCapacityService,
    realtimeTicketService,
    gameSessionService,
    competitionService,
    gameSaveService,
    saveLibraryService,
    saveOperationsService,
    rulesStatus = null,
    rulesRegistry = null,
    multiplayerRoomService,
    multiplayerMatchService,
    multiplayerRuleSubmissionService,
    gameShareService,
    logger = false,
  } = dependencies;
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
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match, X-GameHub-Session, X-GameHub-Save-Schema, X-Content-SHA256, Content-Encoding');
    reply.header('Access-Control-Expose-Headers', 'ETag, X-Request-Id, X-GameHub-Save-Schema, X-Content-SHA256');
    if (request.method === 'OPTIONS') return reply.status(204).send();
  });
  // Reject before authentication/body parsing; disabled services are never registered.
  if (config.cloudSaveEnabled !== true) app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (/^\/v1\/(?:me\/(?:game-saves|save-library)(?:\/|$)|creator\/save-health(?:\/|$)|admin\/save-operations(?:\/|$)|works\/[^/]+\/save-policy(?:\/|$))/.test(path)) {
      return reply.header('Cache-Control', 'no-store').status(503).send({error:{
        code:'CLOUD_SAVE_DISABLED', message:'Cloud saves are disabled. Use local saves on this device.',
        requestId:request.id, retryable:false, details:{},
      }});
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof GameShareError || error instanceof CompetitionError || error instanceof CommunityError || error instanceof GameSaveError || error instanceof GameSessionError || error instanceof AuthError || error instanceof WorkError || error instanceof CreatorDraftError || error instanceof ProjectClaimError || error instanceof GitHubSourceError || error instanceof SourceBuildRepositoryError || error instanceof UploadError || error instanceof CatalogError || error instanceof EngagementError || error instanceof ModerationError || error instanceof SocialError || error instanceof PublicProfileError || error instanceof GuessBaikeError || error instanceof AnalyticsError || error instanceof CreatorFeedbackError || error instanceof ContributionTaskError || error instanceof StorageCapacityError || error instanceof RealtimeTicketError || error instanceof MultiplayerRoomError || error instanceof MultiplayerMatchError || error instanceof MultiplayerRuleSubmissionError;
    const statusCode = known ? error.statusCode : (error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    const code = known ? error.code : (statusCode === 400 ? 'SCHEMA_INVALID' : 'INTERNAL_ERROR');
    reply.status(statusCode).send({ error: { code, message: known ? error.message : (statusCode < 500 ? error.message : 'An internal error occurred.'), requestId: request.id, retryable: known ? error.retryable : statusCode >= 500, details: error instanceof GameSaveError ? error.details : {} } });
  });
  app.addContentTypeParser(['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'], (request, payload, done) => done(null, payload));

  app.get('/health', async () => envelope({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      const [databaseOk, migration, realtimeOk] = await Promise.all([database.ping(), migrations.status(), realtimeTicketService?.ready?.() ?? true]);
      if (!databaseOk || !migration.ready || !realtimeOk) return reply.status(503).send(envelope({ status: 'not-ready', database: databaseOk, migrations: migration, realtime: realtimeOk }));
      return envelope({ status: 'ready', database: true, migrations: migration, realtime: realtimeOk, rules: rulesStatus ?? rulesRegistry?.describe?.() ?? null, saves: { mode: config.cloudSaveEnabled === true ? 'cloud' : 'local', cloudEnabled: config.cloudSaveEnabled === true } });
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
  if (projectClaimService) registerProjectClaimRoutes(app,{service:projectClaimService,requireAuth});
  if (communityService) registerCommunityRoutes(app,{service:communityService,media:communityMediaService,requireAuth});
  if (config.cloudSaveEnabled === true && saveOperationsService) registerSaveOperationsRoutes(app,{service:saveOperationsService,requireAuth});
  if (config.cloudSaveEnabled === true && saveLibraryService) registerSaveLibraryRoutes(app, { service: saveLibraryService, requireAuth });
  if (config.cloudSaveEnabled === true && gameSaveService) registerGameSaveRoutes(app, { service: gameSaveService, requireAuth });
  if (gameShareService) registerGameShareRoutes(app, {service:gameShareService,requireAuth});
  if (gameSessionService) registerGameSessionRoutes(app, { service: gameSessionService, requireAuth });
  const identifyOptional = async request => {
    request.actor = request.headers.authorization ? await authService.authenticateBearer(request.headers.authorization) : null;
  };
  if (competitionService) registerCompetitionRoutes(app,{service:competitionService,requireAuth,identifyOptional});
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
  if (multiplayerRuleSubmissionService) {
    const submissionParams = { type: 'object',additionalProperties: false,required: ['submissionId'],properties: { submissionId: { type: 'string',format: 'uuid' } } };
    const submissionIdentity = { type: 'object',additionalProperties: true,required: ['version','workId','modeKey','rulesetVersion','authority','players'],properties: {
      version: { const: 1 },workId: workKeySchema,modeKey: { type: 'string',pattern: '^[a-z][a-z0-9_]{1,63}$' },rulesetVersion: { type: 'string',pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },authority: { const: 'platform_authoritative' },
      players: { type: 'object',additionalProperties: true,required: ['min','max'],properties: { min: { type: 'integer',minimum: 2,maximum: 8 },max: { type: 'integer',minimum: 2,maximum: 8 } } },
    } };
    const doctorReport = { type: 'object',additionalProperties: true,required: ['version','ok','summary','findings'],properties: {
      version: { const: 1 },ok: { type: 'boolean' },summary: { type: 'object',additionalProperties: true,required: ['errors','warnings','info'],properties: { errors: { type: 'integer',minimum: 0 },warnings: { type: 'integer',minimum: 0 },info: { type: 'integer',minimum: 0 } } },findings: { type: 'array',maxItems: 500 },
    } };
    const createSubmissionBody = { type: 'object',additionalProperties: false,required: ['modeKey','modeName','rulesetVersion','minPlayers','maxPlayers','fileName','declaredBytes','sha256','creatorSubmission','doctorReport'],properties: {
      modeKey: { type: 'string',pattern: '^[a-z][a-z0-9_]{1,63}$' },modeName: { type: 'string',minLength: 1,maxLength: 80 },rulesetVersion: { type: 'string',pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
      minPlayers: { type: 'integer',minimum: 2,maximum: 8 },maxPlayers: { type: 'integer',minimum: 2,maximum: 8 },modeConfig: { type: 'object',additionalProperties: false,properties: { turnSeconds: { type: 'integer',minimum: 10,maximum: 3600 },spectators: { type: 'boolean' },reconnectGraceSeconds: { type: 'integer',minimum: 15,maximum: 600 } } },
      fileName: { type: 'string',minLength: 1,maxLength: 255,pattern: '^[^\\\\/\\u0000]+\\.zip$' },declaredBytes: { anyOf: [{ type: 'integer',minimum: 1,maximum: 20971520 },{ type: 'string',pattern: '^[1-9][0-9]{0,7}$' }] },sha256: { type: 'string',pattern: '^[a-f0-9]{64}$' },creatorSubmission: submissionIdentity,doctorReport,
    } };
    app.post('/v1/creator/works/:workId/multiplayer-rule-submissions', {
      preHandler: requireAuth,schema: { params: { type: 'object',additionalProperties: false,required: ['workId'],properties: { workId: workKeySchema } },body: createSubmissionBody },
    }, async (request, reply) => { reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.create(request.actor,request.params.workId,request.body,request.headers['idempotency-key'])); });
    app.get('/v1/creator/works/:workId/multiplayer-rule-submissions', {
      preHandler: requireAuth,schema: { params: { type: 'object',additionalProperties: false,required: ['workId'],properties: { workId: workKeySchema } } },
    }, async (request, reply) => { reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.listMine(request.actor,request.params.workId)); });
    app.get('/v1/creator/multiplayer-rule-submissions/:submissionId', { preHandler: requireAuth,schema: { params: submissionParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.getMine(request.actor,request.params.submissionId));
    });
    app.post('/v1/creator/multiplayer-rule-submissions/:submissionId/grant', { preHandler: requireAuth,schema: { params: submissionParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.grant(request.actor,request.params.submissionId));
    });
    app.put('/v1/creator/multiplayer-rule-submissions/:submissionId/package', { schema: { params: submissionParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.receive(request.params.submissionId,request.headers.authorization,request.body));
    });
    app.post('/v1/creator/multiplayer-rule-submissions/:submissionId/submit', { preHandler: requireAuth,schema: { params: submissionParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.submit(request.actor,request.params.submissionId,request.headers['idempotency-key']));
    });
    app.get('/v1/admin/multiplayer/rule-submissions', {
      preHandler: requireAuth,schema: { querystring: { type: 'object',additionalProperties: false,properties: { state: { type: 'string',enum: ['queue','submitted','in_review','changes_requested','approved_for_build','rejected','failed'] },limit: { type: 'integer',minimum: 1,maximum: 100 } } } },
    }, async (request,reply) => { reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.adminList(request.actor,request.query)); });
    app.get('/v1/admin/multiplayer/rule-submissions/:submissionId', { preHandler: requireAuth,schema: { params: submissionParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.adminGet(request.actor,request.params.submissionId));
    });
    app.get('/v1/admin/multiplayer/rule-submissions/:submissionId/package', { preHandler: requireAuth,schema: { params: submissionParams } }, async (request,reply) => {
      const item = await multiplayerRuleSubmissionService.adminPackage(request.actor,request.params.submissionId);
      reply.header('Cache-Control','no-store'); reply.header('X-Content-Type-Options','nosniff'); reply.header('Digest',`sha-256=${Buffer.from(item.sha256,'hex').toString('base64')}`);
      reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.fileName)}`); return reply.type('application/zip').send(createReadStream(item.path));
    });
    app.get('/v1/admin/multiplayer/rule-builds/:buildId/package', { preHandler: requireAuth,schema: { params: { type: 'object',additionalProperties: false,required: ['buildId'],properties: { buildId: { type: 'string',format: 'uuid' } } } } }, async (request,reply) => {
      const item=await multiplayerRuleSubmissionService.adminBuiltPackage(request.actor,request.params.buildId);
      reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');reply.header('Digest',`sha-256=${Buffer.from(item.sha256,'hex').toString('base64')}`);
      reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.fileName)}`);return reply.type('application/javascript').send(item.content);
    });
    app.post('/v1/admin/multiplayer/rule-submissions/:submissionId/review', {
      preHandler: requireAuth,schema: { params: submissionParams,body: { type: 'object',additionalProperties: false,required: ['action'],properties: { action: { type: 'string',enum: ['start','request_changes','approve_for_build','reject'] },note: { type: 'string',minLength: 1,maxLength: 2000 } } } },
    }, async (request,reply) => { reply.header('Cache-Control','no-store'); return envelope(await multiplayerRuleSubmissionService.adminReview(request.actor,request.params.submissionId,request.body)); });
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
    app.get('/v1/creator/analytics', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: [7,30,90] } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await analyticsService.creatorOverview(request.actor, request.query));
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
    app.get('/w/:workId', {
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } } },
    }, async (request, reply) => {
      const work = await catalogService.get(request.params.workId);
      const siteOrigin = new URL(config.gameShareSiteOrigin || 'https://mooyu.fun').origin;
      const nonce = crypto.randomBytes(18).toString('base64');
      reply.header('Cache-Control', 'public, max-age=60');
      reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.type('text/html; charset=utf-8').send(publicWorkPage({ work, siteOrigin, nonce }));
    });
    app.get('/v1/works', {
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, kind: { type: 'string', enum: ['game', 'creative', 'tool'] },q:{type:'string',maxLength:100},offset:{type:'integer',minimum:0,maximum:100000},openSource:{type:'boolean'},remixable:{type:'boolean'},claimable:{type:'boolean'},runtime:{type:'string',enum:['web','windows']},source:{type:'string',enum:['platform','github_import','zip_upload','community_catalog']} } } },
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
    app.get('/v1/works/:workId/badge.svg', {
      schema: { params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } } },
    }, async (request, reply) => {
      await catalogService.get(request.params.workId);
      const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="212" height="32" viewBox="0 0 212 32" role="img" aria-label="Play on GameHub"><rect width="212" height="32" fill="#14111f"/><rect x="1" y="1" width="210" height="30" fill="none" stroke="#8b5cf6" stroke-width="2"/><path fill="#8b5cf6" d="M13 8h4v4h4v4h4v4h-4v4h-4v-4h-4z"/><text x="34" y="21" fill="#f5f3ff" font-family="monospace" font-size="12" font-weight="700">PLAY ON GAMEHUB</text></svg>`;
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "default-src 'none'");
      return reply.type('image/svg+xml; charset=utf-8').send(svg);
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
    app.get('/v1/me/library', { preHandler: requireAuth,schema:{querystring:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:100},recent:{type:'boolean'}}}} }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await engagementService.list(request.actor,request.query));
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
    app.get('/v1/works/:workId/leaderboard', {
      preHandler: identifyOptional,
      schema:{params:{type:'object',additionalProperties:false,required:['workId'],properties:{workId:workKeySchema}},
        querystring:{type:'object',additionalProperties:false,properties:{
          date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},puzzleId:{type:'string',minLength:1,maxLength:120},
          limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0,maximum:100000},
        }}},
    },async(request,reply)=>{
      reply.header('Cache-Control','private, no-store');
      return envelope(await socialService.workLeaderboard(request.actor,{...request.query,workId:request.params.workId}));
    });
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

  if (publicProfileService) {
    const handleParams = { type: 'object', additionalProperties: false, required: ['handle'], properties: { handle: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9-]{2,31}$' } } };
    const profileLink = { type: 'object', additionalProperties: false, required: ['kind','label','url'], properties: {
      kind: { type: 'string', enum: ['github','website','portfolio','bilibili','other'] }, label: { type: 'string', minLength: 1, maxLength: 40 }, url: { type: 'string', minLength: 1, maxLength: 2048 },
    } };
    app.get('/v1/profiles/:handle', { preHandler: identifyOptional, schema: { params: handleParams } }, async (request, reply) => {
      reply.header('Cache-Control', request.actor ? 'private, no-store' : 'public, max-age=60');
      return envelope(await publicProfileService.get(request.actor, request.params.handle));
    });
    app.patch('/v1/me/public-profile', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['handle','headline','about','visibility','links','featuredWorkIds'], properties: {
        handle: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9-]{2,31}$' }, headline: { type: 'string', maxLength: 160 }, about: { type: 'string', maxLength: 2000 }, visibility: { type: 'string', enum: ['public','followers','private'] },
        libraryVisibility: { type: 'string', enum: ['public','followers','private'] },
        links: { type: 'array', maxItems: 5, items: profileLink }, featuredWorkIds: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
        githubRepositoryIds: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await publicProfileService.update(request.actor, request.body));
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

  if (creatorFeedbackService) {
    const feedbackParams = { type: 'object', additionalProperties: false, required: ['feedbackId'], properties: { feedbackId: { type: 'string', format: 'uuid' } } };
    app.post('/v1/works/:workId/feedback', {
      preHandler: requireAuth,
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: workKeySchema } },
        body: { type: 'object', additionalProperties: false, required: ['category','summary','details'], properties: {
          category: { type: 'string', enum: ['bug','idea','compatibility','other'] },
          summary: { type: 'string', minLength: 5, maxLength: 160 },
          details: { type: 'string', minLength: 10, maxLength: 2000 },
          reproductionSteps: { type: 'string', maxLength: 2000 },
          environment: { type: 'string', maxLength: 500 },
        } },
      },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.status(201);
      return envelope(await creatorFeedbackService.submit(request.actor, request.params.workId, request.body));
    });
    app.get('/v1/creator/feedback', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', enum: ['new','reviewed','archived','issue_drafted','issue_linked','resolved','all'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await creatorFeedbackService.list(request.actor, request.query));
    });
    app.post('/v1/creator/feedback/:feedbackId/issue-draft', {
      preHandler: requireAuth,
      schema: { params: feedbackParams },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await creatorFeedbackService.issueDraft(request.actor, request.params.feedbackId));
    });
    app.patch('/v1/creator/feedback/:feedbackId', {
      preHandler: requireAuth,
      schema: { params: feedbackParams, body: { type: 'object', additionalProperties: false, required: ['action'], properties: {
        action: { type: 'string', enum: ['review','archive','reopen','link_issue'] },
        issueUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await creatorFeedbackService.update(request.actor, request.params.feedbackId, request.body));
    });
  }

  if (contributionTaskService) {
    const pageProperties = { limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } };
    const taskParams = { type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: { type: 'string', format: 'uuid' } } };
    const contributionTaskBody = { type: 'object', additionalProperties: false, required: ['title','description','difficulty','skills'], properties: {
      title: { type: 'string', minLength: 5, maxLength: 160 }, description: { type: 'string', minLength: 20, maxLength: 4000 },
      difficulty: { type: 'string', enum: ['starter','intermediate','advanced'] },
      skills: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 30 } },
      projectId: { type: ['string','null'], format: 'uuid' },
    } };
    app.post('/v1/creator/feedback/:feedbackId/contribution-task', {
      preHandler: requireAuth,
      schema: { params: { type: 'object', additionalProperties: false, required: ['feedbackId'], properties: { feedbackId: { type: 'string', format: 'uuid' } } }, body: contributionTaskBody },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); reply.status(201);
      return envelope(await contributionTaskService.createFromFeedback(request.actor, request.params.feedbackId, request.body));
    });
    app.get('/v1/creator/contribution-tasks', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: pageProperties } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await contributionTaskService.listForCreator(request.actor, request.query)); });
    app.patch('/v1/creator/contribution-tasks/:taskId', {
      preHandler: requireAuth,
      schema: { params: taskParams, body: { type: 'object', additionalProperties: false, required: ['action','expectedVersion'], properties: {
        ...contributionTaskBody.properties, expectedVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', maxLength: 2000 }, releaseId: { type: ['string','null'], format: 'uuid' },
        action: { type: 'string', enum: ['edit','publish','close','reopen','complete','request_changes','link_issue','link_release'] }, issueUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await contributionTaskService.creatorAction(request.actor, request.params.taskId, request.body)); });
    app.post('/v1/creator/contribution-tasks/:taskId/issue-draft', { preHandler: requireAuth, schema: { params: taskParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await contributionTaskService.issueDraft(request.actor, request.params.taskId));
    });
    app.get('/v1/contribution-tasks', {
      preHandler: identifyOptional,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', enum: ['all','open','claimed','submitted','completed','closed'] }, ...pageProperties, mine: { type: 'boolean' }, projectId: { type: 'string', format: 'uuid' }, standalone: { type: 'boolean' },
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', request.actor ? 'private, no-store' : 'public, max-age=30'); return envelope(await contributionTaskService.listPublic(request.actor, request.query)); });
    app.post('/v1/contribution-tasks/:taskId/claim', { preHandler: requireAuth, schema: { params: taskParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await contributionTaskService.claim(request.actor, request.params.taskId));
    });
    app.post('/v1/contribution-tasks/:taskId/release', { preHandler: requireAuth, schema: { params: taskParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await contributionTaskService.release(request.actor, request.params.taskId));
    });
    app.post('/v1/contribution-tasks/:taskId/submission', {
      preHandler: requireAuth,
      schema: { params: taskParams, body: { type: 'object', additionalProperties: false, required: ['url','note'], properties: {
        expectedVersion: { type: 'integer', minimum: 1 }, url: { type: 'string', minLength: 1, maxLength: 2048 }, note: { type: 'string', minLength: 5, maxLength: 2000 },
      } } },
    }, async (request, reply) => { reply.header('Cache-Control', 'no-store'); return envelope(await contributionTaskService.submit(request.actor, request.params.taskId, request.body)); });
    app.get('/v1/contribution-tasks/:taskId', { preHandler: identifyOptional, schema: { params: taskParams } }, async (request, reply) => {
      reply.header('Cache-Control','private, no-store'); return envelope(await contributionTaskService.get(request.actor,request.params.taskId));
    });
    for (const action of ['renew','withdraw']) app.post('/v1/contribution-tasks/:taskId/'+action, { preHandler: requireAuth, schema: { params: taskParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await contributionTaskService[action](request.actor,request.params.taskId));
    });
    app.get('/v1/contribution-notifications', { preHandler: requireAuth, schema: { querystring: { type:'object',additionalProperties:false,properties:pageProperties } } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await contributionTaskService.notifications(request.actor,request.query));
    });
    app.post('/v1/contribution-notifications/:taskId/read', { preHandler: requireAuth, schema: { params:taskParams } }, async (request,reply) => {
      reply.header('Cache-Control','no-store'); return envelope(await contributionTaskService.readNotification(request.actor,request.params.taskId));
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
      schema: { body: { type: 'object', additionalProperties: false, required: ['title', 'description', 'kind'], properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, instructions: { type: 'string', maxLength: 4000 }, kind: { type: 'string', enum: ['game', 'creative', 'tool'] }, attributionKind:{type:'string',enum:['publisher','community_catalog']}, ...workDiscoveryProperties } } },
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
  if (creatorDraftService) {
    const draftParams = { type: 'object', additionalProperties: false, required: ['draftId'], properties: { draftId: { type: 'string', format: 'uuid' } } };
    const contentSchema = { type: 'object', additionalProperties: true, maxProperties: 5000 };
    app.get('/v1/creator/drafts', {
      preHandler: requireAuth,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { studio: { type: 'string', enum: CREATOR_STUDIOS } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await creatorDraftService.list(request.actor, request.query.studio));
    });
    app.post('/v1/creator/drafts', {
      preHandler: requireAuth,
      schema: { body: { type: 'object', additionalProperties: false, required: ['studio','title','content'], properties: {
        studio: { type: 'string', enum: CREATOR_STUDIOS }, schemaVersion: { type: 'integer', minimum: 1, maximum: 1000 },
        title: { type: 'string', minLength: 1, maxLength: 120 }, content: contentSchema,
      } } },
    }, async (request, reply) => {
      const result = await creatorDraftService.create(request.actor, request.body, request.headers['idempotency-key']);
      reply.header('Cache-Control', 'no-store').header('ETag', result.etag);
      return envelope(result.draft);
    });
    app.get('/v1/creator/drafts/:draftId', { preHandler: requireAuth, schema: { params: draftParams } }, async (request, reply) => {
      const result = await creatorDraftService.get(request.actor, request.params.draftId);
      reply.header('Cache-Control', 'no-store').header('ETag', result.etag);
      return envelope(result.draft);
    });
    app.get('/v1/creator/drafts/:draftId/preview', { preHandler: requireAuth, schema: { params: draftParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(await creatorDraftService.preview(request.actor, request.params.draftId));
    });
    app.put('/v1/creator/drafts/:draftId', {
      preHandler: requireAuth,
      schema: { params: draftParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 }, schemaVersion: { type: 'integer', minimum: 1, maximum: 1000 }, content: contentSchema,
      } } },
    }, async (request, reply) => {
      const result = await creatorDraftService.update(request.actor, request.params.draftId, request.body, request.headers['idempotency-key'], request.headers['if-match']);
      reply.header('Cache-Control', 'no-store').header('ETag', result.etag);
      return envelope(result.draft);
    });
    app.post('/v1/creator/drafts/:draftId/builds', {
      preHandler: requireAuth,
      schema: { params: draftParams, body: { type: 'object', additionalProperties: false, required: ['releaseLabel'], properties: { releaseLabel: { type: 'string', minLength: 1, maxLength: 64 } } } },
    }, async (request, reply) => {
      const result = await creatorDraftService.build(request.actor, request.params.draftId, request.body, request.headers['idempotency-key'], request.headers['if-match']);
      reply.status(202).header('Cache-Control', 'no-store');
      return envelope(result);
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
        attributionKind: { type: 'string', enum: ['publisher','community_catalog'] },
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
  if (sourceBuildService) {
    const workBuildParams = { type: 'object', additionalProperties: false, required: ['workId'], properties: { workId: { type: 'string', format: 'uuid' } } };
    const buildParams = { type: 'object', additionalProperties: false, required: ['workId','buildId'], properties: { workId: { type: 'string', format: 'uuid' }, buildId: { type: 'string', format: 'uuid' } } };
    app.post('/v1/creator/works/:workId/builds', {
      preHandler: requireAuth,
      schema: { params: workBuildParams, body: { type: 'object', additionalProperties: false, required: ['templateKey','releaseLabel'], properties: {
        templateKey: { type: 'string', enum: ['static-v1'] }, templateVersion: { type: 'string', enum: ['1'] }, subdirectory: { type: 'string', maxLength: 255 }, releaseLabel: { type: 'string', minLength: 1, maxLength: 64 },
      } } },
    }, async (request, reply) => {
      reply.status(202).header('Cache-Control', 'no-store');
      return envelope(await sourceBuildService.create(request.actor, request.params.workId, request.body, request.headers['idempotency-key']));
    });
    app.get('/v1/creator/works/:workId/builds', { preHandler: requireAuth, schema: { params: workBuildParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await sourceBuildService.list(request.actor, request.params.workId));
    });
    app.get('/v1/creator/works/:workId/builds/:buildId', { preHandler: requireAuth, schema: { params: buildParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await sourceBuildService.get(request.actor, request.params.workId, request.params.buildId));
    });
    app.post('/v1/creator/works/:workId/builds/:buildId/publish', { preHandler: requireAuth, schema: { params: buildParams } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); return envelope(await sourceBuildService.publish(request.actor, request.params.workId, request.params.buildId));
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
