import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createServerMessage, parseClientMessage, RealtimeProtocolError, REALTIME_MAX_MESSAGE_BYTES } from '@gamehub/multiplayer-protocol';

const json = value => JSON.stringify(value);
const hashRealtimeTicket = ticket => crypto.createHash('sha256').update(ticket).digest('hex');
const rejectUpgrade = (socket, statusCode, message) => {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

export function createRealtimeServer({ ticketStore, allowedOrigins = [], trustEditorWebviews = false, nodeEnv = 'development', heartbeatIntervalMs = 20_000, logger = console } = {}) {
  if (!ticketStore?.consume || !ticketStore?.ping) throw new TypeError('A realtime ticket store is required.');
  const trustedOrigins = new Set(allowedOrigins);
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (path === '/health') return response.end(json({ data: { status: 'ok' } }));
    if (path === '/ready') {
      try {
        if (await ticketStore.ping()) return response.end(json({ data: { status: 'ready', redis: true } }));
      } catch (error) { logger?.error?.({ error }, 'Realtime readiness failed'); }
      response.statusCode = 503;
      return response.end(json({ data: { status: 'not-ready', redis: false } }));
    }
    response.statusCode = 404;
    return response.end(json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));
  });
  const sockets = new Set();
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: REALTIME_MAX_MESSAGE_BYTES });

  const originAllowed = origin => {
    if (!origin) return true;
    if (trustedOrigins.has(origin)) return true;
    return (nodeEnv === 'development' || trustEditorWebviews) && /^vscode-webview:\/\/[a-z0-9-]+$/iu.test(origin);
  };

  server.on('upgrade', async (request, socket, head) => {
    socket.setTimeout(5_000, () => socket.destroy());
    let url;
    try { url = new URL(request.url ?? '/', 'http://localhost'); } catch { return rejectUpgrade(socket, 400, 'Bad Request'); }
    if (url.pathname !== '/v1/realtime') return rejectUpgrade(socket, 404, 'Not Found');
    if (!originAllowed(request.headers.origin)) return rejectUpgrade(socket, 403, 'Forbidden');
    const ticket = url.searchParams.get('ticket');
    if (!ticket || ticket.length < 32 || ticket.length > 128) return rejectUpgrade(socket, 401, 'Unauthorized');
    let session;
    try { session = await ticketStore.consume(hashRealtimeTicket(ticket)); }
    catch (error) { logger?.error?.({ error }, 'Realtime ticket consumption failed'); return rejectUpgrade(socket, 503, 'Service Unavailable'); }
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return rejectUpgrade(socket, 401, 'Unauthorized');
    socket.setTimeout(0);
    websocketServer.handleUpgrade(request, socket, head, websocket => websocketServer.emit('connection', websocket, request, session));
  });

  websocketServer.on('connection', (socket, _request, session) => {
    const connectionId = crypto.randomUUID();
    socket.isAlive = true;
    socket.session = session;
    sockets.add(socket);
    socket.send(json(createServerMessage('session.ready', {
      connectionId,
      userId: session.userId,
      heartbeatIntervalMs,
      protocol: 'gamehub.realtime.v1',
    })));
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', raw => {
      try {
        const message = parseClientMessage(raw);
        if (message.type !== 'heartbeat.ping') {
          socket.send(json(createServerMessage('command.rejected', { code: 'NOT_IMPLEMENTED', message: 'This command is not available in the foundation milestone.' }, { causedBy: message.id })));
          return;
        }
        socket.send(json(createServerMessage('heartbeat.pong', { receivedMessageId: message.id })));
      } catch (error) {
        const code = error instanceof RealtimeProtocolError ? error.code : 'MESSAGE_INVALID';
        socket.send(json(createServerMessage('error', { code, message: error.message })));
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', error => logger?.warn?.({ error, connectionId }, 'Realtime socket error'));
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  return Object.freeze({
    server,
    websocketServer,
    async listen(options) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(options, () => { server.off('error', reject); resolve(server.address()); }); }); },
    async close() {
      clearInterval(heartbeat);
      for (const socket of sockets) socket.close(1001, 'server shutdown');
      await new Promise(resolve => websocketServer.close(() => resolve()));
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  });
}
