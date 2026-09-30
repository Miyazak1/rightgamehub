import { createServerMessage } from '@gamehub/multiplayer-protocol';

export function createRoomSessionManager({ repository, coordinator, heartbeatIntervalMs = 20_000, reconnectGraceMs = 120_000, logger = console, clock = () => new Date() } = {}) {
  if (!repository || !coordinator) throw new TypeError('Room repository and coordinator are required.');
  const localRooms = new Map();
  const graceTimers = new Map();
  const presenceTtlMs = Math.max(heartbeatIntervalMs * 3, 30_000);
  let stopEvents = () => {};

  const send = (socket, message) => socket.readyState === 1 && socket.send(JSON.stringify(message));
  const reject = (socket, message, code, detail, extra = {}) => send(socket, createServerMessage(
    'command.rejected', { code, message: detail, ...extra }, { causedBy: message.id, ...(message.roomId ? { roomId: message.roomId } : {}) },
  ));
  const event = (type, room, causedBy) => createServerMessage(type, { room }, {
    roomId: room.id,
    revision: Number(room.revision),
    ...(causedBy ? { causedBy } : {}),
  });
  const broadcastLocal = (roomId, message) => {
    for (const socket of localRooms.get(roomId) ?? []) send(socket, message);
  };
  const publish = (roomId, message) => coordinator.publish(roomId, message);
  const memberKey = (roomId,userId) => `${roomId}:${userId}`;
  const cancelGrace = (roomId,userId) => {
    const key = memberKey(roomId,userId);
    const timer = graceTimers.get(key);
    if (timer) clearTimeout(timer);
    graceTimers.delete(key);
  };
  const scheduleOffline = (roomId,userId,graceMs = reconnectGraceMs) => {
    cancelGrace(roomId,userId);
    const key = memberKey(roomId,userId);
    const timer = setTimeout(async () => {
      graceTimers.delete(key);
      try {
        if (await coordinator.countPresence({ roomId,userId }) > 0) return;
        const result = await repository.setMemberOffline({ roomId,userId,now: clock() });
        if (result?.changed) await publish(roomId, event('room.member.changed', result.room));
      } catch (error) { logger?.error?.({ error, roomId, userId }, 'Realtime offline transition failed'); }
    }, graceMs);
    timer.unref?.();
    graceTimers.set(key, timer);
  };
  const addLocal = (socket, roomId) => {
    socket.roomIds ??= new Set();
    socket.roomIds.add(roomId);
    const subscribers = localRooms.get(roomId) ?? new Set();
    subscribers.add(socket);
    localRooms.set(roomId, subscribers);
  };
  const removeLocal = (socket, roomId) => {
    socket.roomIds?.delete(roomId);
    const subscribers = localRooms.get(roomId);
    subscribers?.delete(socket);
    if (subscribers?.size === 0) localRooms.delete(roomId);
  };
  const subscribe = async (socket, message, resumed = false) => {
    const { roomId } = message;
    if (socket.roomIds?.has(roomId)) {
      const current = await repository.connectMember({ roomId,userId: socket.session.userId,now: clock() });
      if (!current.room) return reject(socket, message, current.error === 'not_member' ? 'ROOM_NOT_MEMBER' : 'ROOM_NOT_AVAILABLE', '房间不存在、已关闭，或你不是房间成员。');
      send(socket, event('room.snapshot', current.room, message.id));
      send(socket, createServerMessage('command.ack', { commandType: resumed ? 'session.resume' : 'room.subscribe', revision: current.room.revision }, { causedBy: message.id, roomId }));
      return current;
    }
    if ((socket.roomIds?.size ?? 0) >= 8) return reject(socket, message, 'ROOM_SUBSCRIPTION_LIMIT', '单个连接最多订阅 8 个房间。');
    const result = await repository.connectMember({ roomId,userId: socket.session.userId,now: clock() });
    if (result.error) return reject(socket, message, result.error === 'not_member' ? 'ROOM_NOT_MEMBER' : 'ROOM_NOT_AVAILABLE', '房间不存在、已关闭，或你不是房间成员。');
    addLocal(socket, roomId);
    cancelGrace(roomId, socket.session.userId);
    await coordinator.registerPresence({ roomId,userId: socket.session.userId,connectionId: socket.connectionId,ttlMs: presenceTtlMs });
    send(socket, event('room.snapshot', result.room, message.id));
    if (result.changed) await publish(roomId, event('room.member.changed', result.room, message.id));
    send(socket, createServerMessage('command.ack', { commandType: resumed ? 'session.resume' : 'room.subscribe', revision: result.room.revision }, { causedBy: message.id, roomId }));
    return result;
  };
  const unsubscribe = async (socket, roomId, causedBy) => {
    if (!socket.roomIds?.has(roomId)) return;
    removeLocal(socket, roomId);
    const remaining = await coordinator.removePresence({ roomId,userId: socket.session.userId,connectionId: socket.connectionId });
    if (remaining === 0) {
      const result = await repository.setMemberGrace({ roomId,userId: socket.session.userId,now: clock() });
      if (result?.changed) await publish(roomId, event('room.member.changed', result.room, causedBy));
      const configuredGraceMs = Number(result?.room?.settings?.reconnectGraceSeconds) * 1_000;
      scheduleOffline(roomId, socket.session.userId, Number.isFinite(configuredGraceMs) ? configuredGraceMs : reconnectGraceMs);
    }
  };

  return Object.freeze({
    supports(message) { return message.type === 'session.resume' || message.type.startsWith('room.'); },
    async start() { stopEvents = await coordinator.start((roomId, message) => broadcastLocal(roomId, message)); },
    async ping() { return (await coordinator.ping()) && (await repository.ping()); },
    async refresh(socket) {
      await Promise.all([...(socket.roomIds ?? [])].map(roomId => coordinator.registerPresence({
        roomId,userId: socket.session.userId,connectionId: socket.connectionId,ttlMs: presenceTtlMs,
      })));
    },
    async handle(socket, message) {
      if (message.type === 'session.resume') {
        for (const roomId of message.payload.roomIds) await subscribe(socket, { ...message, roomId }, true);
        return;
      }
      if (message.type === 'room.subscribe') return subscribe(socket, message);
      if (message.type === 'room.unsubscribe') {
        await unsubscribe(socket, message.roomId, message.id);
        return send(socket, createServerMessage('command.ack', { commandType: message.type }, { causedBy: message.id, roomId: message.roomId }));
      }
      if (message.type === 'room.ready') {
        if (!socket.roomIds?.has(message.roomId)) return reject(socket, message, 'ROOM_NOT_SUBSCRIBED', '请先订阅房间。');
        const result = await repository.setReady({
          roomId: message.roomId,userId: socket.session.userId,ready: message.payload.ready,expectedRevision: message.expectedRevision,now: clock(),
        });
        if (result.error === 'revision_conflict') return reject(socket, message, 'REVISION_CONFLICT', '房间状态已经变化，请先同步。', { revision: result.revision, room: result.room });
        if (result.error) return reject(socket, message, result.error === 'not_member' ? 'ROOM_NOT_MEMBER' : 'ROOM_NOT_OPEN', '房间当前不能修改准备状态。');
        if (result.changed) await publish(message.roomId, event('room.member.changed', result.room, message.id));
        return send(socket, createServerMessage('command.ack', { commandType: message.type, revision: result.room.revision }, { causedBy: message.id, roomId: message.roomId }));
      }
      return reject(socket, message, 'NOT_IMPLEMENTED', '该房间命令尚未实现。');
    },
    async disconnect(socket) { await Promise.all([...(socket.roomIds ?? [])].map(roomId => unsubscribe(socket, roomId))); },
    close() {
      stopEvents();
      for (const timer of graceTimers.values()) clearTimeout(timer);
      graceTimers.clear();
      localRooms.clear();
    },
  });
}
