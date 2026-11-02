// Trusted UI operations only; endpoint construction and bearer credentials stay
// in the product API client. This is not an arbitrary JSON/HTTP bridge.
import { competitionKey, COMPETITION_LIMITS } from '../../../packages/contracts/src/competition.mjs';
import { validateShare, SHARE_CODE_PATTERN } from '../../../packages/web-game-sdk/src/sharing-protocol.mjs';
export const GAME_METHODS = Object.freeze({
  createGameSession: ['game-launch'], getGameSession: ['game-token'], revokeGameSession: ['game-token'],
  listCompetitionModes: ['game-token'], startCompetitionRun: ['game-token', 'competition-start'],
  getCompetitionRun: ['game-token', 'uuid'], finishCompetitionRun: ['game-token', 'uuid', 'competition-finish'],
  abandonCompetitionRun: ['game-token', 'uuid'],
  createGameShare: ['game-token', 'share'], getGameShare: ['share-code'],
  listMultiplayerModes: ['uuid'], listMultiplayerRooms: ['uuid', 'room-limit', 'room-query'],
  createMultiplayerRoom: ['room-create'], getMultiplayerRoom: ['uuid'],
  joinMultiplayerRoomScoped: ['uuid', 'uuid', 'join-code'], createMultiplayerInvite: ['uuid'],
  leaveMultiplayerRoom: ['uuid'], setMultiplayerReady: ['uuid', 'boolean'], startMultiplayerRoom: ['uuid'],
  getMultiplayerMatch: ['uuid'], listMultiplayerMatchEvents: ['uuid', 'sequence', 'event-limit'], getMultiplayerReplay: ['uuid'],
});
const fail = () => { throw Object.assign(new Error('DESKTOP_BUSINESS_INPUT_INVALID'), { code: 'DESKTOP_BUSINESS_INPUT_INVALID', status: 400 }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const record = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) fail();
  return value;
};
export function gameArgument(kind, value) {
  if (kind === 'share') return validateShare(value);
  if (kind === 'share-code') { if (typeof value !== 'string' || !SHARE_CODE_PATTERN.test(value)) fail(); return value; }
  if (kind === 'boolean') { if (typeof value !== 'boolean') fail(); return value; }
  if (kind === 'room-limit' || kind === 'event-limit' || kind === 'sequence') {
    const fallback = kind === 'room-limit' ? 30 : kind === 'event-limit' ? 100 : 0;
    const max = kind === 'room-limit' ? 30 : kind === 'event-limit' ? 100 : Number.MAX_SAFE_INTEGER;
    value ??= fallback; if (!Number.isSafeInteger(value) || value < (kind === 'sequence' ? 0 : 1) || value > max) fail(); return value;
  }
  if (kind === 'room-query') { value ??= ''; if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f]/.test(value)) fail(); return value; }
  if (kind === 'join-code') { if (value === undefined) return value; if (typeof value !== 'string' || !/^[A-HJ-NP-Za-hj-np-z2-9]{5}-?[A-HJ-NP-Za-hj-np-z2-9]{5}$/.test(value)) fail(); return value; }
  if (kind === 'room-create') {
    const body = record(value, ['modeId', 'visibility', 'capacity', 'settings']);
    if (!uuid(body.modeId) || !['public','invite_only'].includes(body.visibility) || !Number.isInteger(body.capacity) || body.capacity < 2 || body.capacity > 8) fail();
    const result = { modeId: body.modeId, visibility: body.visibility, capacity: body.capacity };
    if (body.settings !== undefined) {
      const settings = record(body.settings, ['turnSeconds','spectators','reconnectGraceSeconds']);
      if (settings.spectators !== undefined && typeof settings.spectators !== 'boolean') fail();
      for (const [key,min,max] of [['turnSeconds',10,3600],['reconnectGraceSeconds',15,600]]) if (settings[key] !== undefined && (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max)) fail();
      result.settings = { ...settings };
    }
    return result;
  }
  if (kind === 'uuid') { if (!uuid(value)) fail(); return value; }
  if (kind === 'game-token') { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail(); return value; }
  if (kind === 'game-launch') {
    const body = record(value, ['workId', 'releaseId', 'channel', 'launchNonce']);
    if (!uuid(body.workId) || !uuid(body.releaseId) || !uuid(body.launchNonce) || !['production', 'preview'].includes(body.channel)) fail();
    return { workId: body.workId, releaseId: body.releaseId, channel: body.channel, launchNonce: body.launchNonce };
  }
  if (kind === 'competition-start') {
    const body = record(value, ['boardId', 'requestId']);
    return { boardId: gameArgument('uuid', body.boardId), requestId: gameArgument('uuid', body.requestId) };
  }
  if (kind === 'competition-finish') {
    const body = record(value, ['metrics', 'evidence']), result = {};
    if (body.metrics !== undefined) {
      const metrics = record(body.metrics, Object.keys(body.metrics ?? {})), entries = Object.entries(metrics);
      if (entries.length < 1 || entries.length > COMPETITION_LIMITS.metrics || entries.some(([key, item]) => !competitionKey.test(key) || !Number.isSafeInteger(item) || Math.abs(item) > COMPETITION_LIMITS.magnitude)) fail();
      result.metrics = Object.fromEntries(entries);
    }
    if (body.evidence !== undefined) {
      const evidence = record(body.evidence, ['format', 'moves']);
      if (evidence.format !== 'tile-merge-v1' || typeof evidence.moves !== 'string' || !/^[LURD]{1,8192}$/.test(evidence.moves)) fail();
      result.evidence = { format: evidence.format, moves: evidence.moves };
    }
    return result;
  }
  fail();
}

/** Fence game authority to a validated launch and the current desktop account. */
export function createDesktopGameAuthority(clock = Date.now) {
  const launches = new Map(), sessions = new Map(), modes = new Map(), rooms = new Map(), matches = new Map();
  const denied = () => { throw Object.assign(new Error('DESKTOP_GAME_SESSION_DENIED'), { code: 'DESKTOP_GAME_SESSION_DENIED', status: 403 }); };
  const launchKey = value => JSON.stringify([value.workId, value.releaseId, value.channel ?? 'production']);
  return {
    clear() { launches.clear(); sessions.clear(); modes.clear(); rooms.clear(); matches.clear(); },
    hasLaunch(workId, capability) { return [...launches].some(([key, caps]) => JSON.parse(key)[0] === workId && caps[capability] === true); },
    assertLaunch(descriptor, capability) { if (launches.get(launchKey(descriptor))?.[capability] !== true) denied(); },
    assertRealtime(workId, message) {
      const room = key => modes.get(rooms.get(key)) === workId;
      const match = key => modes.get(matches.get(key)) === workId;
      if (!this.hasLaunch(workId, 'multiplayer') || message.roomId && !room(message.roomId) || message.matchId && !match(message.matchId) ||
          message.type === 'session.resume' && (!Array.isArray(message.payload?.roomIds) || message.payload.roomIds.some(key => !room(key)))) denied();
    },
    receiveRealtime(workId, message) {
      for (const [map, value] of [[rooms, message.payload?.room], [matches, message.payload?.match]]) if (value?.id) {
        if (!uuid(value.id) || modes.get(value.modeId) !== workId) return false;
        map.set(value.id, value.modeId); while (map.size > 128) map.delete(map.keys().next().value);
      }
      return true;
    },
    launched(descriptor) {
      const key = launchKey(descriptor); launches.delete(key); launches.set(key, { ...descriptor.capabilities });
      while (launches.size > 32) launches.delete(launches.keys().next().value);
    },
    before(method, values) {
      if (!Object.hasOwn(GAME_METHODS, method)) return;
      if (method === 'getGameShare') return;
      if (method === 'listMultiplayerModes') { if (!this.hasLaunch(values[0], 'multiplayer')) denied(); return; }
      if (['listMultiplayerRooms','createMultiplayerRoom','joinMultiplayerRoomScoped'].includes(method)) {
        const mode = method === 'createMultiplayerRoom' ? values[0].modeId : values[method === 'joinMultiplayerRoomScoped' ? 1 : 0];
        if (!modes.has(mode)) denied(); return;
      }
      if (['getMultiplayerRoom','getMultiplayerMatch'].includes(method)) return; // Server checks membership; validate returned game below.
      if (method.includes('Multiplayer')) {
        if (!(method.includes('Match') || method === 'getMultiplayerReplay' ? matches : rooms).has(values[0])) denied(); return;
      }
      if (method === 'createGameSession') { if (!launches.has(launchKey(values[0]))) denied(); return; }
      const grant = sessions.get(values[0]);
      if (!grant || grant.expiresAt <= clock() || method.includes('Competition') && !grant.competition || method === 'createGameShare' && !grant.shareLinks) denied();
    },
    completed(method, values, response) {
      if (method === 'createGameSession') {
        const value = response.data, capabilities = launches.get(launchKey(values[0]));
        if (!capabilities || !value || !/^[A-Za-z0-9_-]{43}$/.test(value.gameSessionId) ||
            !Array.isArray(value.capabilities) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock()) denied();
        sessions.set(value.gameSessionId, { expiresAt: Date.parse(value.expiresAt), competition: capabilities.competition === true && value.capabilities.includes('competition'), shareLinks: capabilities.shareLinks === true && value.capabilities.includes('shareLinks') });
        while (sessions.size > 64) sessions.delete(sessions.keys().next().value);
      }
      if (method === 'revokeGameSession') sessions.delete(values[0]);
      const boundedSet = (map, key, value) => { map.set(key, value); while (map.size > 128) map.delete(map.keys().next().value); };
      if (method === 'listMultiplayerModes') for (const mode of response.data ?? []) {
        if (!uuid(mode.id) || mode.workId !== values[0]) denied(); boundedSet(modes, mode.id, mode.workId);
      }
      if (['listMultiplayerRooms','createMultiplayerRoom','getMultiplayerRoom','joinMultiplayerRoomScoped','leaveMultiplayerRoom','setMultiplayerReady'].includes(method)) for (const room of Array.isArray(response.data) ? response.data : [response.data]) {
        if (!uuid(room?.id) || !modes.has(room.modeId)) denied(); boundedSet(rooms, room.id, room.modeId);
      }
      if (['startMultiplayerRoom','getMultiplayerMatch'].includes(method)) {
        if (!uuid(response.data?.id) || !modes.has(response.data.modeId)) denied(); boundedSet(matches, response.data.id, response.data.modeId);
      }
    },
  };
}
