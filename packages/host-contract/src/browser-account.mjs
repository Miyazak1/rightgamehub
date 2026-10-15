// Credentials remain in tab-scoped storage; live same-origin tabs exchange snapshots.
const credentialKey = 'gamehub.browser.credentials.v1';
const stateKey = 'gamehub.browser.session.v1';
const channelName = 'gamehub.browser.session.v1';
const validTokens = value => value && typeof value.accessToken === 'string' && typeof value.refreshToken === 'string';
const validState = value => value && Number.isSafeInteger(value.clock) && value.clock >= 0
  && typeof value.sender === 'string' && (value.tokens === null || validTokens(value.tokens));

export function createBrowserAccount(browserWindow) {
  const listeners = new Set();
  const sender = browserWindow?.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  let state = { clock: 0, sender: '', tokens: null };
  try {
    const saved = JSON.parse(browserWindow?.sessionStorage?.getItem(stateKey) ?? 'null');
    const legacy = JSON.parse(browserWindow?.sessionStorage?.getItem(credentialKey) ?? 'null');
    if (validState(saved)) state = saved;
    else if (validTokens(legacy)) state = { clock: 1, sender: 'legacy', tokens: legacy };
  } catch {}
  let channel, ready, disposed = false;
  const pending = new Map();
  const persist = () => {
    try {
      browserWindow?.sessionStorage?.setItem(stateKey, JSON.stringify(state));
      if (state.tokens) browserWindow?.sessionStorage?.setItem(credentialKey, JSON.stringify(state.tokens));
      else browserWindow?.sessionStorage?.removeItem(credentialKey);
    } catch {}
  };
  const post = message => { try { channel?.postMessage(message); } catch {} };
  const apply = incoming => {
    if (!validState(incoming)) return;
    if (incoming.clock < state.clock || (incoming.clock === state.clock && incoming.sender <= state.sender)) return;
    const changed = JSON.stringify(state.tokens) !== JSON.stringify(incoming.tokens);
    state = structuredClone(incoming);
    persist();
    if (changed) listeners.forEach(listener => listener(state.tokens ? { ...state.tokens } : null));
  };
  const synchronize = () => {
    if (!channel || disposed) return Promise.resolve();
    return new Promise(resolve => {
      const requestId = sender + ':' + Math.random().toString(36).slice(2);
      // Collect replies from all peers, including logout tombstones.
      const timer = setTimeout(() => { pending.delete(requestId); resolve(); }, 150);
      pending.set(requestId, () => { clearTimeout(timer); resolve(); });
      post({ type: 'request', requestId });
    });
  };
  const initialize = () => {
    if (ready) return ready;
    // Sharing rotating refresh tokens requires an origin-wide refresh lock.
    try {
      if (!disposed && browserWindow?.BroadcastChannel && browserWindow?.navigator?.locks?.request) {
        channel = new browserWindow.BroadcastChannel(channelName);
        channel.onmessage = ({ data }) => {
          if (data?.type === 'request' && typeof data.requestId === 'string') {
            post({ type: 'snapshot', requestId: data.requestId, state });
          } else if (data?.type === 'update' || (data?.type === 'snapshot' && pending.has(data.requestId))) {
            apply(data.state);
          }
        };
      }
    } catch {}
    ready = synchronize();
    return ready;
  };
  const update = tokens => {
    state = { clock: Math.max(Date.now(), state.clock + 1), sender, tokens: tokens ? { ...tokens } : null };
    persist();
    post({ type: 'update', state });
  };
  return {
    async getAccessToken() { await initialize(); return state.tokens?.accessToken ?? null; },
    async getRefreshToken() { await initialize(); return state.tokens?.refreshToken ?? null; },
    async getTokens() { await initialize(); return state.tokens ? { ...state.tokens } : null; },
    async setTokens(tokens) { await initialize(); update(tokens); },
    async clearTokens() { await initialize(); update(null); },
    onTokensChanged(listener) { listeners.add(listener); initialize(); return () => listeners.delete(listener); },
    async withRefreshLock(callback, signal) {
      await initialize();
      if (!channel) return callback();
      return browserWindow.navigator.locks.request('gamehub.browser.refresh.v1', { ...(signal ? { signal } : {}) }, async () => {
        await synchronize();
        return callback();
      });
    },
    dispose() {
      disposed = true;
      channel?.close();
      channel = null;
      pending.forEach(resolve => resolve());
      pending.clear();
      listeners.clear();
    },
  };
}

