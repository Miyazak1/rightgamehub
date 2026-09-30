import crypto from 'node:crypto';

export const REALTIME_PROTOCOL = 'gamehub.realtime.v1';
export const REALTIME_PROTOCOL_VERSION = 1;
export const REALTIME_MAX_MESSAGE_BYTES = 16 * 1024;
export const REALTIME_HEARTBEAT_INTERVAL_MS = 20_000;

export const clientMessageTypes = Object.freeze([
  'heartbeat.ping',
  'session.resume',
  'room.subscribe',
  'room.unsubscribe',
  'room.ready',
  'match.command',
  'match.resign',
  'match.sync.request',
]);

export const serverMessageTypes = Object.freeze([
  'session.ready',
  'heartbeat.pong',
  'command.ack',
  'command.rejected',
  'room.snapshot',
  'room.member.changed',
  'match.started',
  'match.event',
  'match.snapshot',
  'match.completed',
  'match.aborted',
  'session.replaced',
  'server.draining',
  'error',
]);

const clientTypes = new Set(clientMessageTypes);
const allowedClientKeys = new Set(['v', 'id', 'type', 'sentAt', 'roomId', 'matchId', 'clientSeq', 'expectedRevision', 'payload']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class RealtimeProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RealtimeProtocolError';
    this.code = code;
  }
}

export function createServerMessage(type, payload = {}, fields = {}) {
  if (!serverMessageTypes.includes(type)) throw new RealtimeProtocolError('SERVER_MESSAGE_TYPE_INVALID', `Unsupported server message type: ${type}`);
  return {
    v: REALTIME_PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    type,
    sentAt: new Date().toISOString(),
    ...fields,
    payload,
  };
}

export function parseClientMessage(input, { maxBytes = REALTIME_MAX_MESSAGE_BYTES } = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new RealtimeProtocolError('MESSAGE_TOO_LARGE', `Message exceeds ${maxBytes} bytes.`);
  let message;
  try { message = JSON.parse(text); } catch { throw new RealtimeProtocolError('MESSAGE_JSON_INVALID', 'Message must be valid JSON.'); }
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new RealtimeProtocolError('MESSAGE_INVALID', 'Message must be an object.');
  for (const key of Object.keys(message)) if (!allowedClientKeys.has(key)) throw new RealtimeProtocolError('MESSAGE_FIELD_UNKNOWN', `Unknown message field: ${key}`);
  if (message.v !== REALTIME_PROTOCOL_VERSION) throw new RealtimeProtocolError('PROTOCOL_VERSION_UNSUPPORTED', 'Unsupported realtime protocol version.');
  if (!uuid.test(message.id ?? '')) throw new RealtimeProtocolError('MESSAGE_ID_INVALID', 'Message id must be a UUID.');
  if (!clientTypes.has(message.type)) throw new RealtimeProtocolError('MESSAGE_TYPE_UNSUPPORTED', 'Unsupported client message type.');
  if (message.sentAt !== undefined && !Number.isFinite(Date.parse(message.sentAt))) throw new RealtimeProtocolError('MESSAGE_TIME_INVALID', 'sentAt must be an ISO timestamp.');
  for (const key of ['roomId', 'matchId']) if (message[key] !== undefined && !uuid.test(message[key])) throw new RealtimeProtocolError('MESSAGE_REFERENCE_INVALID', `${key} must be a UUID.`);
  for (const key of ['clientSeq', 'expectedRevision']) if (message[key] !== undefined && (!Number.isSafeInteger(message[key]) || message[key] < 0)) throw new RealtimeProtocolError('MESSAGE_SEQUENCE_INVALID', `${key} must be a non-negative safe integer.`);
  if (message.payload !== undefined && (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload))) throw new RealtimeProtocolError('MESSAGE_PAYLOAD_INVALID', 'payload must be an object.');
  if (message.type.startsWith('room.') && !message.roomId) throw new RealtimeProtocolError('MESSAGE_REFERENCE_REQUIRED', 'roomId is required for room commands.');
  if (message.type === 'room.ready') {
    const keys = Object.keys(message.payload ?? {});
    if (keys.length !== 1 || keys[0] !== 'ready' || typeof message.payload.ready !== 'boolean') throw new RealtimeProtocolError('MESSAGE_PAYLOAD_INVALID', 'room.ready payload must contain only a boolean ready field.');
  }
  if (message.type === 'session.resume') {
    const keys = Object.keys(message.payload ?? {});
    if (keys.some(key => key !== 'roomIds') || !Array.isArray(message.payload?.roomIds) || message.payload.roomIds.length > 8 || message.payload.roomIds.some(roomId => !uuid.test(roomId))) {
      throw new RealtimeProtocolError('MESSAGE_PAYLOAD_INVALID', 'session.resume payload must contain up to eight roomIds.');
    }
  }
  if (message.type.startsWith('match.') && !message.matchId) throw new RealtimeProtocolError('MESSAGE_REFERENCE_REQUIRED', 'matchId is required for match commands.');
  if (message.type === 'match.command') {
    const keys = Object.keys(message.payload ?? {});
    if (message.expectedRevision === undefined || keys.length !== 1 || keys[0] !== 'command' || !message.payload.command || typeof message.payload.command !== 'object' || Array.isArray(message.payload.command)) {
      throw new RealtimeProtocolError('MESSAGE_PAYLOAD_INVALID', 'match.command requires expectedRevision and one command object.');
    }
  }
  if (message.type === 'match.resign') {
    if (message.expectedRevision === undefined || Object.keys(message.payload ?? {}).length !== 0) throw new RealtimeProtocolError('MESSAGE_PAYLOAD_INVALID', 'match.resign requires expectedRevision and an empty payload.');
  }
  if (message.type === 'match.sync.request') {
    const keys = Object.keys(message.payload ?? {});
    if (keys.some(key => key !== 'afterSeq') || (message.payload?.afterSeq !== undefined && (!Number.isSafeInteger(message.payload.afterSeq) || message.payload.afterSeq < 0))) {
      throw new RealtimeProtocolError('MESSAGE_PAYLOAD_INVALID', 'match.sync.request accepts only a non-negative afterSeq.');
    }
  }
  return message;
}
