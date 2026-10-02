/** Holds authorization only in the trusted parent. Never send this object over the bridge. */
export function createGameSessionManager({ apiClient, descriptor, signal, clock = Date.now } = {}) {
  let session = null;
  let pending = null;
  let closed = false;
  const revoke = value => { if (value) Promise.resolve(apiClient.revokeGameSession(value.gameSessionId)).catch(() => {}); };
  const close = () => {
    if (closed) return;
    closed = true; signal?.removeEventListener('abort', close); revoke(session); session = null;
  };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) close();
  return Object.freeze({
    async get(capability) {
      if (closed) throw Object.assign(new Error('Game launch closed.'), { code: 'BRIDGE_CLOSED' });
      if (session && Date.parse(session.expiresAt) <= clock() + 10_000) { revoke(session); session = null; }
      if (!session) {
        pending ??= apiClient.createGameSession({
          workId: descriptor.workId, releaseId: descriptor.releaseId, channel: descriptor.channel ?? 'production',
          launchNonce: crypto.randomUUID(),
        }, { signal }).then(({ data }) => {
          if (closed || signal?.aborted) { revoke(data); throw Object.assign(new Error('Game launch closed.'), { code: 'BRIDGE_CLOSED' }); }
          session = data; return data;
        }).finally(() => { pending = null; });
        await pending;
      }
      if (!session.capabilities.includes(capability)) throw Object.assign(new Error('Capability has no approved scope.'), { code: 'BRIDGE_CAPABILITY_NOT_GRANTED' });
      return session.gameSessionId;
    },
    close,
  });
}
