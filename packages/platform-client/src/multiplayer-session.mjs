import { REALTIME_MAX_MESSAGE_BYTES, REALTIME_PROTOCOL_VERSION } from '@gamehub/multiplayer-protocol';

const safeJson = value => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (new TextEncoder().encode(text).byteLength > REALTIME_MAX_MESSAGE_BYTES) throw new Error('Realtime message exceeds the protocol limit.');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== REALTIME_PROTOCOL_VERSION || typeof parsed.type !== 'string') throw new Error('Invalid realtime server message.');
  return parsed;
};

export function createMultiplayerSession({
  apiClient,
  WebSocketImpl = globalThis.WebSocket,
  randomUUID = () => globalThis.crypto.randomUUID(),
  reconnectDelaysMs = [500,1_000,2_000,4_000,8_000],
  logger = console,
} = {}) {
  if (!apiClient?.createRealtimeTicket) throw new TypeError('apiClient.createRealtimeTicket is required.');
  if (!WebSocketImpl) throw new TypeError('WebSocket is not available.');
  const listeners = new Map();
  const rooms = new Map();
  const desiredRooms = new Set();
  let socket;
  let generation = 0;
  let reconnectAttempt = 0;
  let reconnectTimer;
  let heartbeatTimer;
  let wanted = false;
  let status = 'idle';
  let pendingConnect;

  const emit = (type, value) => { for (const listener of listeners.get(type) ?? []) listener(value); };
  const setStatus = value => { status = value; emit('status', value); };
  const clearTimers = () => { clearTimeout(reconnectTimer); clearInterval(heartbeatTimer); reconnectTimer = undefined; heartbeatTimer = undefined; };
  const send = (type, fields = {}) => {
    if (!socket || socket.readyState !== (WebSocketImpl.OPEN ?? 1)) throw new Error('Realtime session is not connected.');
    const message = { v: REALTIME_PROTOCOL_VERSION, id: randomUUID(), type, sentAt: new Date().toISOString(), payload: {}, ...fields };
    socket.send(JSON.stringify(message));
    return message.id;
  };
  const scheduleReconnect = () => {
    if (!wanted || reconnectTimer) return;
    const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
    reconnectAttempt += 1;
    setStatus('reconnecting');
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect().catch(error => { logger?.warn?.({ error }, 'GameHub realtime reconnect failed'); scheduleReconnect(); }); }, delay);
  };
  const handleMessage = message => {
    emit('message', message);
    if (message.type === 'session.ready') {
      reconnectAttempt = 0;
      setStatus('connected');
      const interval = Math.max(5_000, Math.floor(Number(message.payload?.heartbeatIntervalMs ?? 20_000) * 0.75));
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        try { send('heartbeat.ping'); } catch (error) { logger?.warn?.({ error }, 'GameHub realtime heartbeat failed'); }
      }, interval);
      if (desiredRooms.size) send('session.resume', { payload: { roomIds: [...desiredRooms] } });
      pendingConnect?.resolve(message.payload);
      pendingConnect = undefined;
      return;
    }
    if ((message.type === 'room.snapshot' || message.type === 'room.member.changed') && message.payload?.room?.id) {
      rooms.set(message.payload.room.id, message.payload.room);
      emit('room', message.payload.room);
    }
    if (message.type === 'server.draining') {
      socket?.close(1012, 'server draining');
      return;
    }
    if (message.type === 'error' || message.type === 'command.rejected') emit('error', message);
  };
  const connect = async () => {
    wanted = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const currentGeneration = ++generation;
    setStatus(reconnectAttempt ? 'reconnecting' : 'connecting');
    const response = await apiClient.createRealtimeTicket();
    if (currentGeneration !== generation || !wanted) throw new Error('Realtime connection was superseded.');
    const ticket = response.data ?? response;
    const url = new URL(ticket.websocketUrl);
    url.searchParams.set('ticket', ticket.ticket);
    socket?.close(1000, 'replaced');
    socket = new WebSocketImpl(url.toString());
    const ready = new Promise((resolve, reject) => { pendingConnect = { resolve, reject }; });
    socket.addEventListener('message', event => {
      try { handleMessage(safeJson(event.data)); }
      catch (error) { logger?.warn?.({ error }, 'Invalid GameHub realtime message'); emit('error', { type: 'error', payload: { code: 'SERVER_MESSAGE_INVALID', message: error.message } }); }
    });
    socket.addEventListener('error', () => pendingConnect?.reject(new Error('Realtime connection failed.')));
    socket.addEventListener('close', () => {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      if (pendingConnect) { pendingConnect.reject(new Error('Realtime connection closed before it became ready.')); pendingConnect = undefined; }
      if (wanted && currentGeneration === generation) scheduleReconnect();
      else if (!wanted) setStatus('closed');
    });
    return ready;
  };

  return Object.freeze({
    connect,
    close() {
      wanted = false;
      generation += 1;
      clearTimers();
      pendingConnect?.reject(new Error('Realtime session was closed.'));
      pendingConnect = undefined;
      socket?.close(1000, 'client close');
      socket = undefined;
      setStatus('closed');
    },
    subscribeRoom(roomId) { desiredRooms.add(roomId); return send('room.subscribe', { roomId }); },
    unsubscribeRoom(roomId) { desiredRooms.delete(roomId); rooms.delete(roomId); return send('room.unsubscribe', { roomId }); },
    setReady(roomId, ready) {
      const revision = rooms.get(roomId)?.revision;
      const expectedRevision = Number(revision);
      return send('room.ready', { roomId, ...(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 ? { expectedRevision } : {}), payload: { ready } });
    },
    getStatus() { return status; },
    getRoom(roomId) { return rooms.get(roomId) ?? null; },
    getSubscribedRoomIds() { return [...desiredRooms]; },
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener); listeners.set(type, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(type); };
    },
  });
}
