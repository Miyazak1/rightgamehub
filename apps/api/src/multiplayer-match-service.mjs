import crypto from 'node:crypto';
import { canonicalJson } from '@gamehub/rules-sdk';

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

export function createMultiplayerMatchService({ repository, rulesRegistry, ids = () => crypto.randomUUID(), randomBytes = size => crypto.randomBytes(size), clock = () => new Date() }) {
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
      return repository.startMatchIdempotent({
        userId: actor.userId,roomId,modeId: context.modeId,rulesetVersion: context.rulesetVersion,players: context.players.map(({ userId,seat }) => ({ userId,seat })),
        idempotencyKey,requestHash: requestHash({ roomId }),matchId,seedHash: crypto.createHash('sha256').update(seed).digest(),
        state,publicState,stateHash,turnUserId: turn.userId,turnDeadlineAt: new Date(now.getTime() + turnSeconds * 1_000),now,
        startedEvent: { rulesetVersion: context.rulesetVersion, players: context.players.map(({ userId,seat }) => ({ userId,seat })) },
      });
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
  });
}
