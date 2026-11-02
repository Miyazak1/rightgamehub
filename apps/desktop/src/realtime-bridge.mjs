import { parseClientMessage, serverMessageTypes, REALTIME_MAX_MESSAGE_BYTES } from '../../../packages/multiplayer-protocol/src/index.mjs';
import { validateJson } from '../../../packages/web-game-sdk/src/sharing-protocol.mjs';
import { checkServerIdentity } from 'node:tls';
const denied = () => { throw Object.assign(new Error('DESKTOP_REALTIME_DENIED'), { code: 'DESKTOP_REALTIME_DENIED' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
export function desktopRealtimeUrl(ticket, origin, now = Date.now()) {
  const expected = new URL('/v1/realtime', origin); expected.protocol = expected.protocol === 'https:' ? 'wss:' : 'ws:';
  let url; try { url = new URL(ticket?.websocketUrl); } catch { denied(); }
  if (url.href !== expected.href || url.username || url.password || !/^[A-Za-z0-9_-]{43}$/.test(ticket?.ticket ?? '') ||
      !Number.isFinite(Date.parse(ticket.expiresAt)) || Date.parse(ticket.expiresAt) <= now || Date.parse(ticket.expiresAt) > now + 300000) denied();
  url.searchParams.set('ticket', ticket.ticket); return url.href;
}
/** All sockets and tickets stay in the main process; renderer sees protocol events only. */
export function createDesktopRealtime({ account, origin, WebSocketImpl, onEvent, getProxyRoute = async () => ({}) }) {
  const sockets = new Map();
  const emit = (id, type, data) => onEvent({ id, type, ...(data === undefined ? {} : { data }) });
  const close = (id, retired = false) => {
    const row = sockets.get(id); if (!row) return;
    sockets.delete(id); clearTimeout(row.timer); row.socket?.close(1000, 'desktop closed'); row.dispose?.(); emit(id, retired ? 'retired' : 'close');
  };
  return {
    closeAll() { for (const id of [...sockets.keys()]) close(id, true); },
    call(method, input) {
      if (!input || !uuid(input.id) || Object.keys(input).some(key => !['id','workId','data'].includes(key))) denied();
      if (method === 'close') { close(input.id); return { closed: true }; }
      if (method === 'open') {
        if (!uuid(input.workId) || sockets.has(input.id) || sockets.size >= 4 || input.data !== undefined) denied();
        const row = { workId: input.workId, check: account.gameContext(input.workId, 'multiplayer'), socket: null, count: 0, at: Date.now() };
        sockets.set(input.id, row);
        const fail = () => { if (sockets.get(input.id) === row) { emit(input.id, 'error'); close(input.id); } };
        row.timer = setTimeout(fail, 15000); row.timer.unref?.();
        Promise.resolve().then(async () => {
          const ticket = await account.realtimeTicket(); row.check();
          if (sockets.get(input.id) !== row) return;
          const url = desktopRealtimeUrl(ticket, origin);
          const route = await getProxyRoute(url);
          if (sockets.get(input.id) !== row) { route.dispose?.(); return; }
          row.dispose = route.dispose; row.check();
          const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
          const socket = new WebSocketImpl(url, { followRedirects: false, handshakeTimeout: 10000, maxPayload: REALTIME_MAX_MESSAGE_BYTES, origin,
            // CONNECT agents may omit the target host when wrapping an IP socket.
            // Verify the pinned endpoint explicitly; trust-chain checks stay enabled.
            checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate),
            ...(route.agent ? {agent:route.agent} : {}) });
          row.socket = socket;
          socket.on('open', () => { if (sockets.get(input.id) === row) emit(input.id, 'open'); });
          socket.on('message', (data, isBinary) => {
            if (sockets.get(input.id) !== row) return;
            try {
              row.check(); if (isBinary || data.byteLength > REALTIME_MAX_MESSAGE_BYTES) denied();
              const text = data.toString('utf8'), message = JSON.parse(text);
              validateJson(message, { maxBytes: REALTIME_MAX_MESSAGE_BYTES, maxNodes: 5000 });
              if (message.v !== 1 || !serverMessageTypes.includes(message.type)) denied();
              if (!account.receiveRealtime(input.workId, message)) return;
              if (message.type === 'session.ready') clearTimeout(row.timer);
              emit(input.id, 'message', text);
            } catch { fail(); }
          });
          socket.on('error', fail);
          socket.on('close', () => close(input.id));
        }).catch(fail);
        return { accepted: true };
      }
      const row = sockets.get(input.id); if (method !== 'send' || !row || input.workId !== row.workId || row.socket?.readyState !== 1 || typeof input.data !== 'string') denied();
      row.check(); const message = parseClientMessage(input.data); account.assertRealtime(input.workId, message);
      if (Date.now() - row.at >= 1000) { row.at = Date.now(); row.count = 0; }
      if (++row.count > 120) denied(); row.socket.send(input.data); return { sent: true };
    },
  };
}
