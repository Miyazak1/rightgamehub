const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'GameHub-Agent-Client',
};

export function createGitHubOAuthClient({ clientId, clientSecret = null, callbackUrl = null, fetchImpl = globalThis.fetch } = {}) {
  if (!clientId) return null;
  const post = async (url, fields) => {
    const response = await fetchImpl(url, { method: 'POST', headers: JSON_HEADERS, body: new URLSearchParams(fields) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('GitHub OAuth request failed.'), { code: 'GITHUB_UPSTREAM_ERROR', status: response.status });
    return payload;
  };
  return Object.freeze({
    webConfigured: Boolean(clientSecret && callbackUrl),
    createAuthorizeUrl({ state, codeChallenge }) {
      if (!clientSecret || !callbackUrl) throw new Error('GitHub web OAuth is not configured.');
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'read:user',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },
    async exchangeWebCode({ code, codeVerifier }) {
      if (!clientSecret || !callbackUrl) throw new Error('GitHub web OAuth is not configured.');
      return post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
        code_verifier: codeVerifier,
      });
    },
    async requestDeviceCode() {
      return post('https://github.com/login/device/code', { client_id: clientId, scope: 'read:user' });
    },
    async pollDeviceCode(deviceCode) {
      return post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    },
    async getUser(accessToken) {
      const response = await fetchImpl('https://api.github.com/user', { headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GameHub-Agent-Client',
      } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.id || !payload.login) throw Object.assign(new Error('GitHub identity lookup failed.'), { code: 'GITHUB_UPSTREAM_ERROR', status: response.status });
      return { subject: String(payload.id), login: String(payload.login), name: typeof payload.name === 'string' ? payload.name : null };
    },
  });
}
