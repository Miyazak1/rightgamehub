import { createMultiplayerSession } from './multiplayer-session.mjs';
import { WEB_GAME_BRIDGE_PROTOCOL, WEB_GAME_BRIDGE_VERSION, WEB_GAME_EXPORT_MAX_BYTES, bridgeEnvelope, isBridgeConnectMessage, parseBridgeRequest } from '@gamehub/web-game-sdk/protocol';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requireUuid = (value, label) => { if (!uuid.test(value ?? '')) throw Object.assign(new Error(`${label} is invalid.`), { code: 'BRIDGE_PARAMETER_INVALID' }); return value; };
const publicProfile = profile => ({ id: profile.id,displayName: profile.displayName,avatar: profile.avatar ?? null });
const exportTypes = new Map([['image/png','.png'],['application/json','.json']]);
const arrayBuffer = value => Object.prototype.toString.call(value) === '[object ArrayBuffer]';

function validateFileExport({ filename,mimeType,data } = {}) {
  if (typeof filename !== 'string' || filename.length < 1 || filename.length > 120 || /[\\/\u0000-\u001f\u007f]/u.test(filename)) throw Object.assign(new Error('Export filename is invalid.'), { code: 'FILE_EXPORT_INVALID' });
  const extension = exportTypes.get(mimeType);
  if (!extension || !filename.toLocaleLowerCase('en-US').endsWith(extension)) throw Object.assign(new Error('Export file type is not allowed.'), { code: 'FILE_EXPORT_TYPE_NOT_ALLOWED' });
  if (!arrayBuffer(data) || data.byteLength < 1 || data.byteLength > WEB_GAME_EXPORT_MAX_BYTES) throw Object.assign(new Error('Export file bytes are invalid or too large.'), { code: 'FILE_EXPORT_INVALID' });
  return { filename,mimeType,data };
}

export function createBrowserFileExporter({ documentImpl = globalThis.document,URLImpl = globalThis.URL,BlobImpl = globalThis.Blob,revokeDelayMs = 60_000 } = {}) {
  if (!documentImpl?.createElement || !URLImpl?.createObjectURL || !BlobImpl) throw new TypeError('Browser file export is unavailable.');
  return async input => {
    const { filename,mimeType,data } = validateFileExport(input);
    const url = URLImpl.createObjectURL(new BlobImpl([data], { type: mimeType }));
    const anchor = documentImpl.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.hidden = true;
    documentImpl.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URLImpl.revokeObjectURL(url), revokeDelayMs); }
    return { accepted: true,filename,sizeBytes: data.byteLength };
  };
}

export function createWebGameMultiplayerHost({
  windowImpl = globalThis.window,
  frame,
  launchId,
  descriptor = {},
  workId,
  initialRoomId = null,
  initialShareCode = null,
  apiClient,
  sessionFactory = options => createMultiplayerSession(options),
  MessageChannelImpl = globalThis.MessageChannel,
  fileExporter = null,
  logger = console,
} = {}) {
  const multiplayerEnabled = Boolean(descriptor.capabilities?.multiplayer);
  const fileExportEnabled = Boolean(descriptor.capabilities?.fileExport);
  const shareLinksEnabled = Boolean(descriptor.capabilities?.shareLinks);
  if (!windowImpl?.addEventListener || !frame?.contentWindow || !workId || !MessageChannelImpl || ((multiplayerEnabled || shareLinksEnabled) && !apiClient)) throw new TypeError('A window, game frame, work, required API client and MessageChannel are required.');
  const exportFile = fileExportEnabled ? (fileExporter ?? createBrowserFileExporter({ documentImpl: windowImpl.document,URLImpl: windowImpl.URL ?? globalThis.URL })) : null;
  let port = null;
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
  const sendEvent = (event, payload) => port?.postMessage(bridgeEnvelope({ type: 'event',event,payload }));
  const disposeSession = () => {
    sessionOff.forEach(off => off()); sessionOff = [];
    session?.close(); session = null;
  };
  const ensureSession = () => {
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
    'player.get': async () => publicProfile((await apiClient.getProfile()).data),
    'files.download': async params => exportFile(validateFileExport(params)),
    'shares.create': async ({ title,payload }) => {
      const share = (await apiClient.createGameShare(workId, { title,payload })).data;
      const origin = windowImpl.location?.origin ?? '';
      return { ...share,url: `${origin}/#/play/${encodeURIComponent(workId)}/share/${encodeURIComponent(share.code)}` };
    },
    'shares.current': async () => {
      if (!initialShareCode) return null;
      const share = (await apiClient.getGameShare(initialShareCode)).data;
      if (share?.workId !== workId) throw Object.assign(new Error('Share link belongs to another game.'), { code: 'SHARE_WORK_MISMATCH' });
      return share;
    },
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
  const respond = (id, result) => port?.postMessage(bridgeEnvelope({ type: 'response',id,ok: true,result }));
  const reject = (id, error) => port?.postMessage(bridgeEnvelope({ type: 'response',id,ok: false,error: { code: error.code ?? 'BRIDGE_REQUEST_FAILED',message: error.message ?? 'Bridge request failed.',retryable: Boolean(error.retryable),...(Number.isInteger(error.status) ? { status: error.status } : {}) } }));
  const onPortMessage = async event => {
    let request;
    try { request = parseBridgeRequest(event.data); }
    catch (error) { return reject(event.data?.id ?? null, error); }
    const authorized = request.method === 'files.download'
      ? fileExportEnabled
      : request.method.startsWith('shares.')
        ? shareLinksEnabled
      : request.method === 'player.get' || request.method.startsWith('multiplayer.')
        ? multiplayerEnabled
        : false;
    if (!authorized) return reject(request.id, Object.assign(new Error('Bridge capability was not approved for this release.'), { code: 'BRIDGE_CAPABILITY_REQUIRED' }));
    try { respond(request.id, await handlers[request.method](request.params ?? {})); }
    catch (error) { reject(request.id, error); }
  };
  const onConnect = event => {
    if (event.source !== frame.contentWindow || !isBridgeConnectMessage(event.data)) return;
    port?.close?.();
    const channel = new MessageChannelImpl(); port = channel.port1;
    port.addEventListener?.('message', onPortMessage); if (!port.addEventListener) port.onmessage = onPortMessage; port.start?.();
    const capabilities = [multiplayerEnabled && 'identity',multiplayerEnabled && 'multiplayer',fileExportEnabled && 'fileExport',shareLinksEnabled && 'shareLinks'].filter(Boolean);
    frame.contentWindow.postMessage(bridgeEnvelope({ type: 'gamehub.bridge.ready',clientNonce: event.data.clientNonce,launchId,capabilities }), '*', [channel.port2]);
  };
  windowImpl.addEventListener('message', onConnect);
  return Object.freeze({
    close() {
      windowImpl.removeEventListener('message', onConnect); port?.close?.(); port = null;
      disposeSession();
      rooms.clear(); matches.clear();
    },
  });
}
