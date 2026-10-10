import { createCloudSaveClient } from './cloud-save.mjs';
import { WEB_GAME_BRIDGE_PROTOCOL, WEB_GAME_BRIDGE_VERSION, bridgeEnvelope, parseBridgeRequest } from './protocol.mjs';

const randomId = () => globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`;
const randomNonce = () => {
  const bytes = new Uint8Array(24);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') || `${Date.now()}${Math.random()}`.replace(/\D/gu, '').padEnd(24, '0');
};

export function createGameHubClient({ windowImpl = globalThis.window, parentWindow = windowImpl?.parent, requestTimeoutMs = 15_000, cloudSaveTimeoutMs = 45_000 } = {}) {
  if (!windowImpl?.addEventListener || !parentWindow?.postMessage) throw new TypeError('GameHub SDK requires a browser iframe environment.');
  const listeners = new Map();
  const pending = new Map();
  let port = null;
  let connectPromise = null;
  let closed = false;
  let capabilities = [];
  let cancelConnect = null;

  const emit = (event, payload) => { for (const listener of listeners.get(event) ?? []) listener(payload); };
  const handlePortMessage = event => {
    const message = event.data;
    if (!message || message.protocol !== WEB_GAME_BRIDGE_PROTOCOL || message.version !== WEB_GAME_BRIDGE_VERSION) return;
    if (message.type === 'event') {
      if (message.event === 'bridge.closed') {
        closed = true; port?.close?.(); port = null;
        for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(Object.assign(new Error('Game launch ended.'), { code: 'BRIDGE_CLOSED' })); }
        pending.clear();
      }
      return emit(message.event, message.payload);
    }
    if (message.type !== 'response' || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id); clearTimeout(operation.timer);
    if (message.ok) operation.resolve(message.result);
    else operation.reject(Object.assign(new Error(message.error?.message ?? 'GameHub bridge request failed.'), message.error ?? {}));
  };
  const connect = () => {
    if (closed) return Promise.reject(Object.assign(new Error('GameHub client is closed.'),{code:'BRIDGE_CLOSED'}));
    if (port) return Promise.resolve([...capabilities]);
    if (connectPromise) return connectPromise;
    connectPromise = new Promise((resolve, reject) => {
      const clientNonce = randomNonce();
      const timer = setTimeout(() => { windowImpl.removeEventListener('message', onReady); connectPromise = null; reject(new Error('GameHub bridge connection timed out.')); }, requestTimeoutMs);
      const onReady = event => {
        const message = event.data;
        if (event.source !== parentWindow || message?.protocol !== WEB_GAME_BRIDGE_PROTOCOL || message?.version !== WEB_GAME_BRIDGE_VERSION || message?.type !== 'gamehub.bridge.ready' || message.clientNonce !== clientNonce || !event.ports?.[0]) return;
        if (closed) { event.ports[0].close?.(); return; }
        clearTimeout(timer); windowImpl.removeEventListener('message', onReady); cancelConnect = null;
        port = event.ports[0];
        if (port.addEventListener) port.addEventListener('message', handlePortMessage); else port.onmessage = handlePortMessage;
        port.start?.();
        capabilities = message.capabilities ?? [];
        resolve([...capabilities]);
      };
      cancelConnect = () => { clearTimeout(timer); windowImpl.removeEventListener('message', onReady); connectPromise = null; reject(Object.assign(new Error('GameHub client closed.'),{code:'BRIDGE_CLOSED'})); };
      windowImpl.addEventListener('message', onReady);
      parentWindow.postMessage(bridgeEnvelope({ type: 'gamehub.bridge.connect', clientNonce }), '*');
    });
    return connectPromise;
  };
  const request = async (method, params = {}, timeoutMs = requestTimeoutMs) => {
    await connect();
    if (closed || !port) throw Object.assign(new Error('GameHub client closed.'),{code:'BRIDGE_CLOSED'});
    const id = randomId();
    const envelope = parseBridgeRequest(bridgeEnvelope({ type: 'request',id,method,params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error('GameHub bridge request timed out.'), { code: 'BRIDGE_TIMEOUT', retryable: true })); }, timeoutMs);
      pending.set(id, { resolve,reject,timer });
      try { port.postMessage(envelope); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  };
  const rooms = {
    list: (modeId, query = '') => request('multiplayer.rooms.list', { modeId,query }),
    create: input => request('multiplayer.rooms.create', input),
    get: roomId => request('multiplayer.rooms.get', { roomId }),
    join: (roomId, modeId, joinCode = null) => request('multiplayer.rooms.join', { roomId,modeId,...(joinCode ? { joinCode } : {}) }),
    invite: roomId => request('multiplayer.rooms.invite', { roomId }),
    current: () => request('multiplayer.rooms.current'),
    leave: roomId => request('multiplayer.rooms.leave', { roomId }),
    ready: (roomId, ready) => request('multiplayer.rooms.ready', { roomId,ready }),
    start: roomId => request('multiplayer.rooms.start', { roomId }),
    subscribe: roomId => request('multiplayer.rooms.subscribe', { roomId }),
    unsubscribe: roomId => request('multiplayer.rooms.unsubscribe', { roomId }),
  };
  const matches = {
    subscribe: (matchId, afterSeq = 0) => request('multiplayer.matches.subscribe', { matchId,afterSeq }),
    unsubscribe: matchId => request('multiplayer.matches.unsubscribe', { matchId }),
    command: (matchId, command) => request('multiplayer.matches.command', { matchId,command }),
    resign: matchId => request('multiplayer.matches.resign', { matchId }),
  };
  const cloudSave = createCloudSaveClient({request:(method,params)=>request(method,params,cloudSaveTimeoutMs)});
  return Object.freeze({
    connect,
    files: Object.freeze({
      download: async (input, filename) => {
        if (typeof Blob !== 'undefined' && input instanceof Blob) {
          const data = await input.arrayBuffer();
          return request('files.download', { filename,mimeType: input.type,data }, 130000);
        }
        return request('files.download', input, 130000);
      },
    }),
    shares: Object.freeze({
      create: (input, payload) => request('shares.create', typeof input === 'string' ? { title:input,payload } : input),
      current: () => request('shares.current'),
    }),
    getPlayer: () => request('player.get'),
    cloudSave,
    localSave: cloudSave.local,
    competition: Object.freeze({
      listBoards: () => request('competition.modes.list'),
      start: ({boardId,requestId=randomId()}) => request('competition.runs.start',{boardId,requestId}),
      get: runId => request('competition.runs.get',{runId}),
      finish: (runId,submission) => request('competition.runs.finish',{...submission,runId}),
      abandon: runId => request('competition.runs.abandon',{runId}),
      leaderboard: (boardId,query={}) => request('competition.leaderboards.get',{...query,boardId}),
    }),
    multiplayer: Object.freeze({
      listModes: () => request('multiplayer.modes.list'), rooms: Object.freeze(rooms), matches: Object.freeze(matches),
      connect: () => request('multiplayer.realtime.connect'),
      disconnect: () => request('multiplayer.realtime.disconnect'),
    }),
    on(event, listener) {
      const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(event); };
    },
    close() {
      closed = true; cancelConnect?.(); cancelConnect = null; port?.close?.(); port = null;
      for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(Object.assign(new Error('GameHub client closed.'),{code:'BRIDGE_CLOSED'})); }
      pending.clear(); listeners.clear();
    },
  });
}

export * from './protocol.mjs';
