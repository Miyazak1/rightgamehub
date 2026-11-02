import { createMultiplayerSession } from '../../../packages/platform-client/src/multiplayer-session.mjs';
/** Web's heartbeat/resume/reconnect logic uses an IPC socket, never renderer networking. */
export function createDesktopMultiplayerFactory(bridge, origin) {
  return ({ workId }) => {
    let owner;
    class DesktopSocket {
      static OPEN = 1;
      constructor(url) {
        this.id = new URL(url).searchParams.get('ticket'); this.readyState = 0; this.openSent = false; this.listeners = new Map();
        this.off = bridge.onEvent(event => {
          if (event.id !== this.id) return;
          if (event.type === 'retired') { owner?.close(); return; }
          if (event.type === 'open') this.readyState = 1;
          if (event.type === 'close') { this.readyState = 3; this.off(); }
          this.emit(event.type, event.type === 'message' ? { data: event.data } : {});
        });
        queueMicrotask(() => { if (this.readyState !== 0) return; this.openSent = true; this.call('open'); });
      }
      emit(type, value) { for (const listener of this.listeners.get(type) ?? []) listener(value); }
      addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
      call(method, data) {
        Promise.resolve(bridge.call(method, { id: this.id, workId, ...(data === undefined ? {} : { data }) })).then(result => {
          if (!result.ok) throw Error('Desktop realtime request failed.');
        }).catch(() => { if (this.readyState === 3) return; this.emit('error', {}); if (method !== 'close') this.close(); });
      }
      send(data) { if (this.readyState !== 1) throw Error('Realtime socket is not ready.'); this.call('send', data); }
      close() { if (this.readyState === 3) return; this.readyState = 3; this.off(); if (this.openSent) this.call('close'); this.emit('close', {}); }
    }
    owner = createMultiplayerSession({ WebSocketImpl: DesktopSocket, logger: { warn() {} }, apiClient: {
      // An opaque local connection handle substitutes for the web ticket handshake.
      // The actual API ticket and endpoint are obtained and verified in main.
      async createRealtimeTicket() { const url = new URL('/v1/realtime', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; return { data: { websocketUrl: url.href, ticket: crypto.randomUUID() } }; },
    } });
    return owner;
  };
}
