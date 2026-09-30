export const WEB_GAME_BRIDGE_PROTOCOL = 'gamehub.web-game.v1';
export const WEB_GAME_BRIDGE_VERSION = 1;
export const WEB_GAME_BRIDGE_MAX_BYTES = 32 * 1024;

export const WEB_GAME_BRIDGE_METHODS = Object.freeze([
  'player.get',
  'multiplayer.modes.list',
  'multiplayer.rooms.list',
  'multiplayer.rooms.create',
  'multiplayer.rooms.get',
  'multiplayer.rooms.join',
  'multiplayer.rooms.leave',
  'multiplayer.rooms.ready',
  'multiplayer.rooms.start',
  'multiplayer.realtime.connect',
  'multiplayer.realtime.disconnect',
  'multiplayer.rooms.subscribe',
  'multiplayer.rooms.unsubscribe',
  'multiplayer.matches.subscribe',
  'multiplayer.matches.unsubscribe',
  'multiplayer.matches.command',
  'multiplayer.matches.resign',
]);

const methods = new Set(WEB_GAME_BRIDGE_METHODS);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function isBridgeConnectMessage(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && value.protocol === WEB_GAME_BRIDGE_PROTOCOL
    && value.version === WEB_GAME_BRIDGE_VERSION
    && value.type === 'gamehub.bridge.connect'
    && typeof value.clientNonce === 'string'
    && /^[A-Za-z0-9_-]{16,128}$/u.test(value.clientNonce));
}

export function parseBridgeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || byteLength(value) > WEB_GAME_BRIDGE_MAX_BYTES) throw Object.assign(new Error('Bridge request is invalid or too large.'), { code: 'BRIDGE_REQUEST_INVALID' });
  const allowed = new Set(['protocol','version','type','id','method','params']);
  if (Object.keys(value).some(key => !allowed.has(key)) || value.protocol !== WEB_GAME_BRIDGE_PROTOCOL || value.version !== WEB_GAME_BRIDGE_VERSION || value.type !== 'request') throw Object.assign(new Error('Bridge request envelope is invalid.'), { code: 'BRIDGE_REQUEST_INVALID' });
  if (!uuid.test(value.id ?? '')) throw Object.assign(new Error('Bridge request id must be a UUID.'), { code: 'BRIDGE_REQUEST_ID_INVALID' });
  if (!methods.has(value.method)) throw Object.assign(new Error('Bridge method is not allowed.'), { code: 'BRIDGE_METHOD_NOT_ALLOWED' });
  if (value.params !== undefined && (!value.params || typeof value.params !== 'object' || Array.isArray(value.params))) throw Object.assign(new Error('Bridge request params must be an object.'), { code: 'BRIDGE_REQUEST_INVALID' });
  return value;
}

export const bridgeEnvelope = fields => ({ protocol: WEB_GAME_BRIDGE_PROTOCOL, version: WEB_GAME_BRIDGE_VERSION, ...fields });
