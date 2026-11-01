const methods = ['createChallenge', 'verifyChallenge', 'bootstrapSession', 'getProfile', 'listDevices',
  'startGitHubWeb', 'pollGitHubWeb', 'updateProfile', 'selectAvatar', 'revokeDevice', 'logoutOthers', 'logoutAll', 'logout'];
export function createDesktopAccountAdapter(bridge) {
  const call = async (method, args = []) => {
    const result = await bridge.call(method, args);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return result.value;
  };
  const listeners = new Set();
  const off = bridge.onChanged(state => { for (const listener of listeners) listener(state.authenticated ? { desktopSessionId: state.desktopSessionId } : null); });
  const api = Object.fromEntries(methods.map(method => [method, (...args) => call(method, args.slice(0, method === 'bootstrapSession' ? 0 : 1))]));
  return { api, navigation: { openExternal: url => call('openGitHub',[url]) }, account: {
    githubDeviceAvailable: false,
    // Presence indicators satisfy the shared bootstrap contract; these are never bearer tokens.
    async getAccessToken() { return (await call('state')).authenticated ? 'desktop-managed-session' : null; },
    async getRefreshToken() { return (await call('state')).authenticated ? 'desktop-managed-session' : null; },
    setTokens: value => call('accept', [value]), clearTokens: () => call('clear'),
    cancelLogin: () => call('cancelGitHub'),
    async persistence() { return (await call('state')).persistence; },
    onTokensChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { listeners.clear(); off(); },
  } };
}
