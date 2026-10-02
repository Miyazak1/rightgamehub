import { createMultiplayerSession } from './multiplayer-session.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requireUuid = (value, label) => { if (!uuid.test(value ?? '')) throw Object.assign(new Error(`${label} is invalid.`), { code: 'BRIDGE_PARAMETER_INVALID' }); return value; };

export function createMultiplayerHandlers({ apiClient, workId, initialRoomId = null, sessionFactory = options => createMultiplayerSession(options), sendEvent, logger = console, signal } = {}) {
  let session = null;
  let sessionOff = [];
  let modesPromise = null;
  const rooms = new Map();
  const matches = new Map();

  const loadModes = async () => {
    modesPromise ??= apiClient.listMultiplayerModes(workId).then(response => response.data ?? response).catch(error => { modesPromise = null; throw error; });
    return modesPromise;
  };
  const requireMode = async modeId => {
    requireUuid(modeId, 'modeId');
    const mode = (await loadModes()).find(item => item.id === modeId && item.enabled);
    if (!mode) throw Object.assign(new Error('Multiplayer mode does not belong to this game.'), { code: 'MODE_NOT_ALLOWED' });
    return mode;
  };
  const trackRoom = async room => { await requireMode(room?.modeId); rooms.set(room.id, room.modeId); return room; };
  const requireRoom = roomId => { requireUuid(roomId, 'roomId'); if (!rooms.has(roomId)) throw Object.assign(new Error('Room must be loaded through this game session first.'), { code: 'ROOM_NOT_SCOPED' }); return roomId; };
  const trackMatch = async match => { await requireMode(match?.modeId); matches.set(match.id, match.modeId); if (match.roomId) rooms.set(match.roomId, match.modeId); return match; };
  const requireMatch = matchId => { requireUuid(matchId, 'matchId'); if (!matches.has(matchId)) throw Object.assign(new Error('Match must be loaded through this game session first.'), { code: 'MATCH_NOT_SCOPED' }); return matchId; };
  const disposeSession = () => {
    sessionOff.forEach(off => off()); sessionOff = [];
    session?.close(); session = null;
  };
  const ensureSession = () => {
    if (signal?.aborted) throw Object.assign(new Error('Bridge closed.'), { code: 'BRIDGE_CLOSED' });
    if (session) return session;
    session = sessionFactory({ apiClient,logger });
    sessionOff = [
      session.on('status', value => sendEvent('multiplayer.status', { status: value })),
      session.on('room', room => { trackRoom(room).then(value => sendEvent('multiplayer.room', value)).catch(error => logger?.warn?.({ error }, 'Rejected cross-game room event')); }),
      session.on('match', payload => { trackMatch(payload.match).then(() => sendEvent('multiplayer.match', payload)).catch(error => logger?.warn?.({ error }, 'Rejected cross-game match event')); }),
      session.on('matchEvent', payload => matches.has(payload.matchId) && sendEvent('multiplayer.match.event', payload)),
      session.on('matchTerminal', payload => matches.has(payload.matchId) && sendEvent('multiplayer.match.terminal', payload)),
      session.on('error', payload => sendEvent('multiplayer.error', payload)),
      session.on('message', message => {
        const match = message.type === 'match.started' ? message.payload?.match : null;
        if (match?.id && match?.roomId && rooms.has(match.roomId) && rooms.get(match.roomId) === match.modeId) {
          matches.set(match.id, match.modeId); sendEvent('multiplayer.match.started', match);
        }
      }),
    ];
    return session;
  };
  const handlers = {
    'multiplayer.modes.list': loadModes,
    'multiplayer.rooms.list': async ({ modeId,query = '' }) => { await requireMode(modeId); const result = (await apiClient.listMultiplayerRooms(modeId,30,String(query).slice(0,80))).data; await Promise.all(result.map(trackRoom)); return result; },
    'multiplayer.rooms.create': async params => { await requireMode(params.modeId); return trackRoom((await apiClient.createMultiplayerRoom(params)).data); },
    'multiplayer.rooms.get': async ({ roomId }) => trackRoom((await apiClient.getMultiplayerRoom(requireUuid(roomId, 'roomId'))).data),
    'multiplayer.rooms.join': async ({ roomId,modeId,joinCode }) => { await requireMode(modeId); return trackRoom((await apiClient.joinMultiplayerRoomScoped(requireUuid(roomId, 'roomId'), modeId, joinCode)).data); },
    'multiplayer.rooms.invite': async ({ roomId }) => {
      const id = requireRoom(roomId); const invite = (await apiClient.createMultiplayerInvite(id)).data;
      return { code: invite.code,expiresAt: invite.expiresAt };
    },
    'multiplayer.rooms.current': async () => initialRoomId ? trackRoom((await apiClient.getMultiplayerRoom(requireUuid(initialRoomId, 'initialRoomId'))).data) : null,
    'multiplayer.rooms.leave': async ({ roomId }) => trackRoom((await apiClient.leaveMultiplayerRoom(requireRoom(roomId))).data),
    'multiplayer.rooms.ready': async ({ roomId,ready }) => { if (typeof ready !== 'boolean') throw Object.assign(new Error('ready must be boolean.'), { code: 'BRIDGE_PARAMETER_INVALID' }); const id = requireRoom(roomId); if (session?.getStatus() === 'connected' && session.getSubscribedRoomIds().includes(id)) return { commandId: session.setReady(id, ready) }; return trackRoom((await apiClient.setMultiplayerReady(id, ready)).data); },
    'multiplayer.rooms.start': async ({ roomId }) => trackMatch((await apiClient.startMultiplayerRoom(requireRoom(roomId))).data),
    'multiplayer.realtime.connect': async () => ensureSession().connect(),
    'multiplayer.realtime.disconnect': async () => { disposeSession(); return { closed: true }; },
    'multiplayer.rooms.subscribe': async ({ roomId }) => ({ commandId: ensureSession().subscribeRoom(requireRoom(roomId)) }),
    'multiplayer.rooms.unsubscribe': async ({ roomId }) => ({ commandId: ensureSession().unsubscribeRoom(requireRoom(roomId)) }),
    'multiplayer.matches.subscribe': async ({ matchId,afterSeq = 0 }) => {
      requireUuid(matchId, 'matchId');
      if (!matches.has(matchId)) await trackMatch((await apiClient.getMultiplayerMatch(matchId)).data);
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw Object.assign(new Error('afterSeq is invalid.'), { code: 'BRIDGE_PARAMETER_INVALID' });
      return { commandId: ensureSession().subscribeMatch(matchId, afterSeq) };
    },
    'multiplayer.matches.unsubscribe': async ({ matchId }) => { ensureSession().unsubscribeMatch(requireMatch(matchId)); return { unsubscribed: true }; },
    'multiplayer.matches.command': async ({ matchId,command }) => { if (!command || typeof command !== 'object' || Array.isArray(command)) throw Object.assign(new Error('command must be an object.'), { code: 'BRIDGE_PARAMETER_INVALID' }); return { commandId: ensureSession().sendMatchCommand(requireMatch(matchId), command) }; },
    'multiplayer.matches.resign': async ({ matchId }) => ({ commandId: ensureSession().resignMatch(requireMatch(matchId)) }),
  };
  return { handlers, close() { disposeSession(); rooms.clear(); matches.clear(); modesPromise = null; } };
}
