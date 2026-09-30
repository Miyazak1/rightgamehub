import crypto from 'node:crypto';
import { canonicalJson } from '@gamehub/rules-sdk';
import { createServerMessage } from '@gamehub/multiplayer-protocol';

export class MultiplayerMatchError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message); this.name = 'MultiplayerMatchError'; this.code = code; this.statusCode = statusCode; this.retryable = retryable;
  }
}

const requireActor = actor => { if (!actor?.userId) throw new MultiplayerMatchError('AUTH_REQUIRED', 401, '需要登录后使用多人游戏。'); };
const requireIdempotency = key => { if (!/^[\x21-\x7e]{16,128}$/.test(key ?? '')) throw new MultiplayerMatchError('IDEMPOTENCY_KEY_REQUIRED', 400, '需要有效的 Idempotency-Key。'); };
const requestHash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const objectState = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MultiplayerMatchError('ADAPTER_OUTPUT_INVALID', 500, `规则适配器返回了无效的${name}。`);
  return value;
};

export function createMultiplayerMatchService({ repository, rulesRegistry, publisher = null, roomPublisher = null, ids = () => crypto.randomUUID(), randomBytes = size => crypto.randomBytes(size), clock = () => new Date() }) {
  return Object.freeze({
    async startRoom(actor, roomId, idempotencyKey) {
      requireActor(actor); requireIdempotency(idempotencyKey);
      const context = await repository.getStartContext({ roomId,userId: actor.userId });
      if (!context) throw new MultiplayerMatchError('ROOM_NOT_FOUND', 404, '房间不存在或你不是房主。');
      if (context.authority !== 'platform_authoritative') throw new MultiplayerMatchError('MODE_NOT_AUTHORITATIVE', 409, '该模式不由平台权威规则服务启动。');
      if (context.players.length < context.minPlayers || context.players.length > context.maxPlayers || context.players.some(player => !player.ready)) {
        throw new MultiplayerMatchError('PLAYERS_NOT_READY', 409, '人数不足或仍有玩家没有准备。');
      }
      const adapter = rulesRegistry.get(context);
      if (!adapter) throw new MultiplayerMatchError('RULESET_NOT_AVAILABLE', 409, '服务器尚未安装这个规则版本。');
      const matchId = ids();
      const seed = randomBytes(32).toString('base64url');
      const now = clock();
      const state = objectState(adapter.serializeState(adapter.createInitialState({
        matchId,roomId,players: context.players.map(({ userId,seat }) => ({ userId,seat })),settings: context.settings,seed,
      })), '初始状态');
      const restored = adapter.deserializeState(state);
      const stateHash = adapter.hashState(restored);
      if (!/^[a-f0-9]{64}$/u.test(stateHash)) throw new MultiplayerMatchError('ADAPTER_OUTPUT_INVALID', 500, '规则适配器返回了无效的状态哈希。');
      const publicState = objectState(adapter.getSpectatorView(restored), '公开状态');
      const turn = adapter.getTurn(restored);
      if (!turn || !context.players.some(player => player.userId === turn.userId)) throw new MultiplayerMatchError('ADAPTER_OUTPUT_INVALID', 500, '规则适配器返回了无效的行动玩家。');
      const turnSeconds = Number(turn.seconds ?? context.settings.turnSeconds ?? 60);
      if (!Number.isInteger(turnSeconds) || turnSeconds < 10 || turnSeconds > 3600) throw new MultiplayerMatchError('ADAPTER_OUTPUT_INVALID', 500, '规则适配器返回了无效的回合时间。');
      const match = await repository.startMatchIdempotent({
        userId: actor.userId,roomId,modeId: context.modeId,rulesetVersion: context.rulesetVersion,players: context.players.map(({ userId,seat }) => ({ userId,seat })),
        idempotencyKey,requestHash: requestHash({ roomId }),matchId,seedHash: crypto.createHash('sha256').update(seed).digest(),
        state,publicState,stateHash,turnUserId: turn.userId,turnDeadlineAt: new Date(now.getTime() + turnSeconds * 1_000),now,
        startedEvent: { rulesetVersion: context.rulesetVersion, players: context.players.map(({ userId,seat }) => ({ userId,seat })) },
      });
      await roomPublisher?.publish(roomId, createServerMessage('match.started', { match }, { roomId,matchId: match.id,revision: Number(match.revision) }));
      return match;
    },
    async getMatch(actor, matchId) {
      requireActor(actor); const match = await repository.getVisibleMatch({ matchId,userId: actor.userId });
      if (!match) throw new MultiplayerMatchError('MATCH_NOT_FOUND', 404, '对局不存在或不可见。');
      return match;
    },
    async listEvents(actor, matchId, { afterSeq = 0, limit = 100 } = {}) {
      requireActor(actor); const events = await repository.listEvents({ matchId,userId: actor.userId,afterSeq,limit });
      if (!events) throw new MultiplayerMatchError('MATCH_NOT_FOUND', 404, '对局不存在或不可见。');
      return events;
    },
    async getReplay(actor, matchId) {
      requireActor(actor); const replay = await repository.getReplay({ matchId,userId: actor.userId });
      if (!replay) throw new MultiplayerMatchError('MATCH_NOT_FOUND', 404, '对局不存在或不可见。');
      return replay;
    },
    async adminOverview(actor) {
      requireActor(actor);
      if (actor.profile?.role !== 'admin') throw new MultiplayerMatchError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      return repository.adminOverview();
    },
    async adminList(actor, { status = 'all',limit = 50 } = {}) {
      requireActor(actor);
      if (actor.profile?.role !== 'admin') throw new MultiplayerMatchError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      if (!['all','pending','active','finishing','completed','aborted'].includes(status)) throw new MultiplayerMatchError('STATUS_INVALID', 400, '无效的对局状态。');
      return repository.listAdminMatches({ status: status === 'all' ? null : status,limit: Math.min(100,Math.max(1,Number(limit) || 50)) });
    },
    async adminAbort(actor, matchId, body) {
      requireActor(actor);
      if (actor.profile?.role !== 'admin') throw new MultiplayerMatchError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      const reason = String(body?.reason ?? '').trim();
      if (!reason || reason.length > 1000) throw new MultiplayerMatchError('REASON_REQUIRED', 400, '终止原因需要填写，且不能超过 1000 个字符。');
      const result = await repository.abortMatch({ matchId,actorUserId: actor.userId,reason,auditId: ids(),now: clock() });
      if (result.error === 'not_found') throw new MultiplayerMatchError('MATCH_NOT_FOUND', 404, '对局不存在。');
      if (result.error === 'terminal') throw new MultiplayerMatchError('MATCH_ALREADY_TERMINAL', 409, '对局已经结束。');
      await publisher?.publish(matchId, { kind: 'match.changed',event: result.event,causedBy: null });
      return result;
    },
    async adminAudit(actor, { limit = 50 } = {}) {
      requireActor(actor);
      if (actor.profile?.role !== 'admin') throw new MultiplayerMatchError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      return repository.listAdminAudit(Math.min(100,Math.max(1,Number(limit) || 50)));
    },
  });
}
