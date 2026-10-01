import crypto from 'node:crypto';

export class MultiplayerRoomError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message);
    this.name = 'MultiplayerRoomError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const requestHash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requireActor = actor => {
  if (!actor?.userId) throw new MultiplayerRoomError('AUTH_REQUIRED', 401, '需要登录后使用多人游戏。');
};
const requireIdempotencyKey = key => {
  if (!/^[\x21-\x7e]{16,128}$/.test(key ?? '')) throw new MultiplayerRoomError('IDEMPOTENCY_KEY_REQUIRED', 400, '需要有效的 Idempotency-Key。');
};
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const createInviteCode = () => {
  const bytes = crypto.randomBytes(10);
  const raw = Array.from(bytes, byte => INVITE_ALPHABET[byte & 31]).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
};
const normalizeInviteCode = value => String(value ?? '').trim().toUpperCase();

export function createMultiplayerRoomService({ repository, roomCodeHmacKey, rulesRegistry = null, ids = () => crypto.randomUUID(), clock = () => new Date() }) {
  if (Buffer.byteLength(roomCodeHmacKey ?? '', 'utf8') < 32) throw new TypeError('roomCodeHmacKey must contain at least 32 UTF-8 bytes.');
  const codeFor = roomId => crypto.createHmac('sha256', roomCodeHmacKey).update(`gamehub:room-code:${roomId}`).digest('base64url').slice(0, 12);
  const digestFor = code => crypto.createHmac('sha256', roomCodeHmacKey).update(`gamehub:room-code-value:${code}`).digest();
  const inviteDigestFor = code => crypto.createHmac('sha256', roomCodeHmacKey).update(`gamehub:room-invite:${normalizeInviteCode(code)}`).digest();
  const withJoinCode = room => ({ ...room, joinCode: null });

  return Object.freeze({
    async listModes(workId) { return UUID.test(workId) ? repository.listModes(workId) : []; },
    async createMode(actor, input) {
      requireActor(actor);
      if (actor.profile?.role !== 'admin') throw new MultiplayerRoomError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      if (input.minPlayers > input.maxPlayers) throw new MultiplayerRoomError('PLAYER_RANGE_INVALID', 400, '最少人数不能超过最多人数。');
      if (input.authority === 'platform_authoritative' && rulesRegistry && !rulesRegistry.get({ workId: input.workId,modeKey: input.key,rulesetVersion: input.rulesetVersion })) throw new MultiplayerRoomError('RULESET_NOT_AVAILABLE', 409, '服务器尚未安装并信任这个规则版本。');
      const mode = await repository.createMode({ id: ids(), ...input, now: clock() });
      if (!mode) throw new MultiplayerRoomError('WORK_NOT_ELIGIBLE', 409, '只有已发布的游戏作品可以启用多人模式。');
      return mode;
    },
    async listRooms(input) { return repository.listPublicRooms({ modeId: input.modeId, limit: input.limit ?? 30, query: input.query ?? '' }); },
    async getRoom(actor, roomId) {
      requireActor(actor);
      const room = await repository.getVisibleRoom(actor.userId, roomId);
      if (!room) throw new MultiplayerRoomError('ROOM_NOT_FOUND', 404, '房间不存在或不可见。');
      return room;
    },
    async createRoom(actor, input, idempotencyKey) {
      requireActor(actor); requireIdempotencyKey(idempotencyKey);
      const roomId = ids();
      const now = clock();
      const code = input.visibility === 'invite_only' ? codeFor(roomId) : null;
      const room = await repository.createRoomIdempotent({
        actor, idempotencyKey, requestHash: requestHash(input), roomId, modeId: input.modeId,
        visibility: input.visibility, capacity: input.capacity, settings: input.settings ?? {},
        joinCodeDigest: code ? digestFor(code) : null, now, expiresAt: new Date(now.getTime() + 30 * 60_000),
      });
      return withJoinCode(room);
    },
    async joinRoom(actor, roomId, input = {}) {
      requireActor(actor);
      const normalizedCode = normalizeInviteCode(input.joinCode);
      const room = await repository.joinRoom({ userId: actor.userId, roomId, expectedModeId: input.modeId ?? null, joinCodeDigest: normalizedCode ? inviteDigestFor(normalizedCode) : null, now: clock() });
      if (room?.error === 'not_found') throw new MultiplayerRoomError('ROOM_NOT_FOUND', 404, '房间不存在或不可加入。');
      if (room?.error === 'code_required') throw new MultiplayerRoomError('ROOM_CODE_REQUIRED', 403, '需要正确的邀请码。');
      if (room?.error === 'claimed') throw new MultiplayerRoomError('INVITE_CLAIMED', 409, '这份邀请已被其他玩家领取。');
      if (room?.error === 'private') throw new MultiplayerRoomError('ROOM_PRIVATE', 403, '这是私密房间。');
      if (room?.error === 'blocked') throw new MultiplayerRoomError('ROOM_NOT_FOUND', 404, '房间不存在或不可加入。');
      if (room?.error === 'full') throw new MultiplayerRoomError('ROOM_FULL', 409, '房间已满。');
      if (room?.error === 'not_open') throw new MultiplayerRoomError('ROOM_NOT_OPEN', 409, '房间当前不可加入。');
      return room;
    },
    async createInvite(actor, roomId) {
      requireActor(actor);
      const code = createInviteCode();
      const invite = await repository.rotateInvite({ id: ids(),roomId,userId: actor.userId,tokenDigest: inviteDigestFor(code),now: clock() });
      if (invite?.error === 'not_found') throw new MultiplayerRoomError('ROOM_NOT_FOUND', 404, '房间不存在。');
      if (invite?.error === 'not_owner') throw new MultiplayerRoomError('ROOM_OWNER_REQUIRED', 403, '只有房主可以生成邀请码。');
      if (invite?.error === 'not_invite_only') throw new MultiplayerRoomError('ROOM_INVITE_UNAVAILABLE', 409, '公开房间不需要邀请码。');
      if (invite?.error === 'occupied') throw new MultiplayerRoomError('ROOM_INVITE_CLAIMED', 409, '邀请已被玩家领取。');
      if (invite?.error === 'not_open') throw new MultiplayerRoomError('ROOM_NOT_OPEN', 409, '房间当前不能生成邀请。');
      return { code,expiresAt: invite.expiresAt };
    },
    async leaveRoom(actor, roomId) {
      requireActor(actor);
      const room = await repository.leaveRoom({ userId: actor.userId, roomId, now: clock() });
      if (!room) throw new MultiplayerRoomError('ROOM_NOT_FOUND', 404, '你不在这个房间中。');
      if (room.error === 'not_open') throw new MultiplayerRoomError('ROOM_NOT_OPEN', 409, '对局准备开始后不能直接离开房间。');
      return room;
    },
    async setReady(actor, roomId, ready) {
      requireActor(actor);
      const room = await repository.setReady({ userId: actor.userId, roomId, ready, now: clock() });
      if (!room) throw new MultiplayerRoomError('ROOM_NOT_FOUND', 404, '你不在这个房间中。');
      if (room.error === 'not_open') throw new MultiplayerRoomError('ROOM_NOT_OPEN', 409, '房间当前不能修改准备状态。');
      return room;
    },
  });
}
