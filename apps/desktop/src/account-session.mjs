import { createHash, randomUUID } from 'node:crypto';
import { createApiClient, ApiError } from '../../../packages/platform-api-client/src/index.mjs';
import { resolveAuthClientKind } from '../../../packages/platform-client/src/auth-client-kind.mjs';
import { accountOrigin } from './account-configuration.mjs';

const fail = (code, status = 400) => { throw new ApiError({ code, status, message: code, retryable: status >= 500 }); };
export function localAccountOrigin(value) {
  return accountOrigin(value, 'local-test');
}
export const ACCOUNT_API_METHODS = Object.freeze(['createChallenge', 'verifyChallenge', 'bootstrapSession',
  'startGitHubWeb', 'pollGitHubWeb', 'getProfile', 'listDevices', 'updateProfile', 'selectAvatar', 'revokeDevice', 'logoutOthers', 'logoutAll', 'logout']);

export function validateGitHubAuthorizeUrl(value, challengeId, origin) {
  let url; try { url = new URL(value); } catch { fail('DESKTOP_GITHUB_URL_DENIED'); }
  const github = url.origin === 'https://github.com' && url.pathname === '/login/oauth/authorize';
  const local = new URL(origin).protocol === 'http:' && url.origin === origin && url.pathname === '/__github/authorize';
  if ((!github && !local) || url.username || url.password || url.hash || value.length>4096
    || !url.searchParams.get('state')?.startsWith(challengeId+'.')
    || url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge')) fail('DESKTOP_GITHUB_URL_DENIED');
  if (new URL(origin).protocol === 'https:' && url.searchParams.get('redirect_uri') !== origin + '/v1/auth/github/web/callback') fail('DESKTOP_GITHUB_URL_DENIED');
  return url.href;
}

export async function createDesktopAccountSession({ apiOrigin, environment = 'local-test', vault, fetchImpl = globalThis.fetch, onChanged = () => {}, openExternal = async () => fail('DESKTOP_BROWSER_UNAVAILABLE', 503) }) {
  const origin = accountOrigin(apiOrigin, environment);
  if (!origin) fail('DESKTOP_ACCOUNT_NOT_CONFIGURED', 503);
  if (environment === 'isolated-test' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('DESKTOP_ACCOUNT_TLS_REQUIRED');
  const key = 'desktop-shell-account:' + createHash('sha256').update(origin).digest('hex');
  let tokens = null, sessionId = null, vaultError = null, tail = Promise.resolve();
  let githubAttempt = null, githubGrant = null, githubGeneration = 0;
  const cancelledGrants = [];
  const cancelGitHub = () => {
    githubGeneration++; githubAttempt = null;
    if (githubGrant) cancelledGrants.push(githubGrant.tokens);
    githubGrant = null;
  };
  const validTokens = value => value && ['accessToken', 'refreshToken'].every(k => typeof value[k] === 'string' && value[k].length>0 && value[k].length<16384);
  const state = () => ({ authenticated: !!tokens, desktopSessionId: sessionId, errorCode: vaultError,
    persistence: vaultError ? { kind: 'unavailable', description: '本地凭据无法读取，请重新登录；保存成功后会恢复加密持久化。' }
      : { kind: 'os-keychain', description: '登录凭据由 Windows 当前用户 DPAPI 加密保存，并绑定此测试服务器。' } });
  try {
    const raw = await vault.load(key), saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.origin === origin && validTokens(saved.tokens)) { tokens = saved.tokens; sessionId = randomUUID(); }
    else if (saved) await vault.remove(key);
  } catch { vaultError = 'DESKTOP_ACCOUNT_VAULT_UNAVAILABLE'; }
  const persist = async value => {
    if (!validTokens(value)) fail('DESKTOP_ACCOUNT_RESPONSE_INVALID', 502);
    await vault.store(key, JSON.stringify({ origin, tokens: value })); tokens = value; vaultError = null;
  };
  const clear = async () => {
    tokens = null; sessionId = null;
    try { await vault.remove(key); } finally { onChanged(state()); }
  };
  let verifiedInstance = false;
  const transport = async (url, options = {}) => {
    const target = new URL(url);
    if (target.origin !== origin || target.username || target.password || !target.pathname.startsWith('/v1/')) fail('DESKTOP_ACCOUNT_ORIGIN_DENIED');
    const send = (address, settings) => fetchImpl(address, { ...settings, redirect: 'error', credentials: 'omit',
      signal: settings?.signal ? AbortSignal.any([settings.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    if (environment === 'isolated-test' && !verifiedInstance) {
      const response = await send(origin + '/ready-desktop-auth', { method: 'GET' });
      if (!response.ok || response.redirected) fail('DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED', 503);
      let data; try { data = (await response.json()).data; } catch { fail('DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED', 503); }
      if (data?.status !== 'ready' || data.instance !== 'isolated-auth-only' || data.backgroundTasksEnabled !== false ||
          data.database !== true || data.redis !== true || data.migrations?.ready !== true) fail('DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED', 503);
      verifiedInstance = true;
    }
    const response = await send(url, options);
    if (response.redirected || response.status >= 300 && response.status < 400) fail('DESKTOP_ACCOUNT_REDIRECT_DENIED', 502);
    return response;
  };
  const api = createApiClient({ baseUrl: origin, fetchImpl: transport,
    getAccessToken: () => tokens?.accessToken, getRefreshToken: () => tokens?.refreshToken, setTokens: persist });
  const marker = () => ({ desktopSessionId: sessionId });
  const revokeGitHubTokens = async value => {
    try { await createApiClient({baseUrl:origin,fetchImpl:transport,getAccessToken:()=>value.accessToken}).logout(); } catch {}
  };
  const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DESKTOP_ACCOUNT_INPUT_INVALID'); return value; };
  const text = (value, max) => { if (typeof value !== 'string' || !value.length || value.length>max) fail('DESKTOP_ACCOUNT_INPUT_INVALID'); return value; };
  async function dispatch(method, args, generation) {
    if (method === 'state') return state();
    if (method === 'cancelGitHub') return { cancelled: true };
    if (method === 'openGitHub') {
      if (!githubAttempt || githubAttempt.generation !== generation || Date.now()>=githubAttempt.expiresAt
        || args[0] !== githubAttempt.authorizeUrl) fail('DESKTOP_GITHUB_URL_DENIED');
      await openExternal(githubAttempt.authorizeUrl); return { opened: true };
    }
    if (method === 'clear') { await clear(); return state(); }
    if (method === 'accept') {
      if (githubGrant && object(args[0]).desktopSessionId === githubGrant.id) {
        const grant = githubGrant;
        if (grant.generation!==githubGeneration || Date.now()>=grant.expiresAt) { cancelGitHub(); fail('DESKTOP_GITHUB_CANCELLED',409); }
        await persist(grant.tokens);
        if (grant.generation!==githubGeneration) { await clear(); await revokeGitHubTokens(grant.tokens); fail('DESKTOP_GITHUB_CANCELLED',409); }
        githubGrant=null; sessionId=grant.id; onChanged(state()); return state();
      }
      if (!tokens || object(args[0]).desktopSessionId !== sessionId) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
      return state();
    }
    if (!ACCOUNT_API_METHODS.includes(method)) fail('DESKTOP_ACCOUNT_OPERATION_DENIED', 403);
    if (method === 'startGitHubWeb') {
      if (tokens) fail('DESKTOP_ACCOUNT_SIGN_OUT_REQUIRED', 409);
      const result = await api.startGitHubWeb({ clientKind: resolveAuthClientKind({host:'desktop-app'}), deviceLabel:'墨鱼工坊 Windows 桌面版' });
      if (generation !== githubGeneration) fail('DESKTOP_GITHUB_CANCELLED', 409);
      const data = result.data, expiresAt = Date.parse(data?.expiresAt);
      if (typeof data?.challengeId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(data.challengeId) || !Number.isFinite(expiresAt) || expiresAt<=Date.now() || expiresAt>Date.now()+11*60_000) fail('DESKTOP_ACCOUNT_RESPONSE_INVALID',502);
      const authorizeUrl = validateGitHubAuthorizeUrl(data.authorizeUrl,data.challengeId,origin);
      githubAttempt = { generation, challengeId:data.challengeId, authorizeUrl, expiresAt };
      return { data: { challengeId:data.challengeId, authorizeUrl, expiresAt:data.expiresAt, intervalSeconds:Math.max(1,Math.min(60,Number(data.intervalSeconds)||2)) } };
    }
    if (method === 'pollGitHubWeb') {
      if (!githubAttempt || args[0] !== githubAttempt.challengeId || generation!==githubAttempt.generation) fail('DESKTOP_GITHUB_CANCELLED',409);
      if (Date.now()>=githubAttempt.expiresAt) { cancelGitHub(); fail('DESKTOP_GITHUB_EXPIRED',400); }
      const expiresAt=githubAttempt.expiresAt;
      const { data } = await api.pollGitHubWeb(githubAttempt.challengeId);
      const cancelled = () => generation!==githubGeneration || !githubAttempt;
      const discard = async () => {
        if (validTokens(data?.tokens)) await revokeGitHubTokens(data.tokens);
        fail('DESKTOP_GITHUB_CANCELLED',409);
      };
      if (cancelled()) return discard();
      if (data?.status === 'pending') return {data:{status:'pending',retryAfter:Math.max(1,Math.min(60,Number(data.retryAfter)||2)),tokens:null}};
      if (data?.status !== 'complete') fail('DESKTOP_ACCOUNT_RESPONSE_INVALID',502);
      if (!validTokens(data.tokens)) fail('DESKTOP_ACCOUNT_RESPONSE_INVALID',502);
      githubGrant={id:randomUUID(),tokens:data.tokens,generation,expiresAt};githubAttempt=null;
      // Match the shared finishLogin handshake: no persistence or sign-in until
      // the still-active renderer accepts this opaque result.
      return {data:{status:'complete',tokens:{desktopSessionId:githubGrant.id}}};
    }
    if (method === 'createChallenge') {
      const body = object(args[0]);
      if (tokens) fail('DESKTOP_ACCOUNT_SIGN_OUT_REQUIRED', 409);
      return api.createChallenge({ email: text(body.email, 254), clientKind: resolveAuthClientKind({ host: 'desktop-app' }), locale: ['en', 'en-US'].includes(body.locale) ? 'en' : 'zh-CN' });
    }
    if (method === 'verifyChallenge') {
      const body = object(args[0]);
      if (tokens) fail('DESKTOP_ACCOUNT_SIGN_OUT_REQUIRED', 409);
      const code = text(body.code, 6); if (!/^\d{6}$/.test(code)) fail('DESKTOP_ACCOUNT_INPUT_INVALID');
      const result = await api.verifyChallenge({ challengeId: text(body.challengeId, 200), code, deviceLabel: '墨鱼工坊 Windows 桌面版' });
      await persist(result.data); sessionId = randomUUID(); onChanged(state());
      return { data: marker() };
    }
    if (method === 'bootstrapSession') {
      if (!tokens) return { data: { authenticated: false, profile: null } };
      const result = await api.bootstrapSession(tokens.refreshToken);
      if (!result.data?.authenticated || !result.data.profile) { await clear(); return { data: { authenticated: false, profile: null } }; }
      if (result.data.tokens) await persist(result.data.tokens);
      return { data: { authenticated: true, profile: result.data.profile, tokens: marker() } };
    }
    if (!tokens) fail('AUTH_REQUIRED', 401);
    if (method === 'logout' || method === 'logoutAll') {
      try { return await api[method](); } finally { await clear(); }
    }
    if (method === 'updateProfile') return api.updateProfile({ displayName: text(object(args[0]).displayName, 80) });
    if (method === 'selectAvatar') return api.selectAvatar(text(args[0], 100));
    if (method === 'revokeDevice') return api.revokeDevice(text(args[0], 100));
    return api[method]();
  }
  return {
    state,
    // Serialize auth mutations and refreshes. A queued logout wins over in-flight login/refresh.
    call(method, args = []) {
      if (typeof method !== 'string' || !Array.isArray(args) || args.length>1 || JSON.stringify(args).length>4096) return Promise.reject(Object.assign(new Error('DESKTOP_ACCOUNT_INPUT_INVALID'), { code: 'DESKTOP_ACCOUNT_INPUT_INVALID' }));
      if (['startGitHubWeb','cancelGitHub','createChallenge','verifyChallenge','clear','logout','logoutAll'].includes(method)) cancelGitHub();
      const generation=githubGeneration;
      const run = tail.then(async () => {
        try {
          while(cancelledGrants.length) await revokeGitHubTokens(cancelledGrants.shift());
          return await dispatch(method, args, generation);
        }
        catch (error) {
          if (method==='pollGitHubWeb' && [400,401].includes(error.status) && generation===githubGeneration) cancelGitHub();
          if (error.status === 401) await clear(); throw error;
        }
      });
      tail = run.catch(() => {}); return run;
    },
  };
}
