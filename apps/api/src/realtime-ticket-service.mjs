import crypto from 'node:crypto';

export class RealtimeTicketError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message);
    this.name = 'RealtimeTicketError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const ticketHash = ticket => crypto.createHash('sha256').update(ticket).digest('hex');

export function createRealtimeTicketService({ store, websocketUrl, ttlSeconds = 30, clock = () => new Date(), randomBytes = size => crypto.randomBytes(size) }) {
  if (!store?.put) throw new TypeError('A realtime ticket store is required.');
  let parsedUrl;
  try { parsedUrl = new URL(websocketUrl); } catch { throw new TypeError('websocketUrl must be a valid URL.'); }
  if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) throw new TypeError('websocketUrl must use ws or wss.');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 120) throw new TypeError('ttlSeconds must be between 5 and 120.');

  return Object.freeze({
    async ready() { return store.ping ? store.ping() : true; },
    async issue(actor) {
      if (!actor?.userId) throw new RealtimeTicketError('AUTH_REQUIRED', 401, 'Authentication is required.');
      const issuedAt = clock();
      const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
      const ticket = randomBytes(32).toString('base64url');
      await store.put(ticketHash(ticket), {
        userId: actor.userId,
        grantId: actor.grantId ?? null,
        scopes: Array.isArray(actor.scopes) ? actor.scopes : [],
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }, ttlSeconds);
      return { ticket, websocketUrl: parsedUrl.toString(), expiresAt: expiresAt.toISOString(), protocol: 'gamehub.realtime.v1' };
    },
  });
}

export { ticketHash as hashRealtimeTicket };
