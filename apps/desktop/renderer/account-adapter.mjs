const methods = ['createChallenge', 'verifyChallenge', 'bootstrapSession', 'getProfile', 'listDevices',
  'startGitHubWeb', 'pollGitHubWeb', 'updateProfile', 'selectAvatar', 'revokeDevice', 'logoutOthers', 'logoutAll', 'logout'];
export function createDesktopAccountAdapter(bridge) {
  const call = async (method, args = []) => {
    const result = await bridge.call(method, args);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return result.value;
  };
  let identity = null;
  const listeners = new Set();
  const off = bridge.onChanged(state => { identity = null; for (const listener of listeners) listener(state.authenticated ? { desktopSessionId: state.desktopSessionId } : null); });
  const api = Object.fromEntries(methods.map(method => [method, (...args) => call(method, args.slice(0, method === 'bootstrapSession' ? 0 : 1))]));
  return { api, navigation: { openExternal: url => call('openGitHub',[url]) }, account: {
    githubDeviceAvailable: false,
    // Presence indicators satisfy the shared bootstrap contract; these are never bearer tokens.
    async getAccessToken() { return (await call('state')).authenticated ? 'desktop-managed-session' : null; },
    async getRefreshToken() { return (await call('state')).authenticated ? 'desktop-managed-session' : null; },
    async getTokens() {
      const before = await call('state');
      if (!before.authenticated) return null;
      // The save owner is the server's user, never a credential or an anonymous
      // fallback. Fence the profile read against logout/account replacement.
      if (!identity || identity.sessionId !== before.desktopSessionId) {
        const pending = { sessionId: before.desktopSessionId, promise: call('getProfile').then(result => result.data) };
        identity = pending;
        pending.promise.catch(() => { if (identity === pending) identity = null; });
      }
      const profile = await identity.promise;
      const after = await call('state');
      if (!after.authenticated || after.desktopSessionId !== before.desktopSessionId)
        throw Object.assign(new Error('Desktop account changed while opening local saves.'), { code: 'DESKTOP_ACCOUNT_SESSION_CHANGED' });
      if (!profile?.id) throw Object.assign(new Error('Account identity is unavailable.'), { code: 'AUTH_REQUIRED' });
      return { desktopSessionId: after.desktopSessionId, grantId: after.desktopSessionId, profile: { id: profile.id } };
    },
    setTokens: value => call('accept', [value]), clearTokens: () => call('clear'),
    cancelLogin: () => call('cancelGitHub'),
    async persistence() { return (await call('state')).persistence; },
    onTokensChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { identity = null; listeners.clear(); off(); },
  } };
}
