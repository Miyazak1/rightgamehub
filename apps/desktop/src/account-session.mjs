import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createApiClient, ApiError } from '../../../packages/platform-api-client/src/index.mjs';
import { resolveAuthClientKind } from '../../../packages/platform-client/src/auth-client-kind.mjs';
import { accountOrigin } from './account-configuration.mjs';
import { businessArguments, businessMediaPath, rewriteBusinessMedia, businessRequestLimit } from './business-contract.mjs';
import { localBusinessRuntime, validateDesktopLaunch } from './runtime-policy.mjs';
import { createBusinessRequests } from './business-requests.mjs';
import { createDesktopGameAuthority } from './game-api-contract.mjs';

const fail = (code, status = 400) => { throw new ApiError({ code, status, message: code, retryable: status >= 500 }); };
const abortable = (work, signal) => new Promise((resolve, reject) => {
  const stop = () => reject(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(
    value => { signal.removeEventListener('abort', stop); resolve(value); },
    error => { signal.removeEventListener('abort', stop); reject(error); });
  if (signal.aborted) stop();
});
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

export async function createDesktopAccountSession({ apiOrigin, environment = 'local-test', vault, fetchImpl = globalThis.fetch, onChanged = () => {}, businessRuntime = null, onRuntimeOrigin = () => {}, businessTimeoutMs = 20000, businessConcurrency = 4, openExternal = async () => fail('DESKTOP_BROWSER_UNAVAILABLE', 503) }) {
  const origin = accountOrigin(apiOrigin, environment);
  const runtimePolicy = localBusinessRuntime(businessRuntime, origin, environment);
  if (!origin) fail('DESKTOP_ACCOUNT_NOT_CONFIGURED', 503);
  if (environment !== 'local-test' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('DESKTOP_ACCOUNT_TLS_REQUIRED');
  const key = 'desktop-shell-account:' + createHash('sha256').update(origin).digest('hex');
  let tokens = null, sessionId = null, vaultError = null, tail = Promise.resolve();
  const operation = new AsyncLocalStorage();
  let epoch = 0, sessionAbort = new AbortController(), vaultTail = Promise.resolve(), refreshTail = Promise.resolve(), businessRequests;
  const current = () => !operation.getStore() || operation.getStore().epoch === epoch;
  const gameAuthority = createDesktopGameAuthority();
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
      : { kind: 'os-keychain', description: environment === 'production' ? '登录凭据由 Windows 当前用户 DPAPI 加密保存，并绑定墨鱼工坊正式服务器。' : '登录凭据由 Windows 当前用户 DPAPI 加密保存，并绑定此测试服务器。' } });
  try {
    const raw = await vault.load(key), saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.origin === origin && validTokens(saved.tokens)) { tokens = saved.tokens; sessionId = randomUUID(); }
    else if (saved) await vault.remove(key);
  } catch { vaultError = 'DESKTOP_ACCOUNT_VAULT_UNAVAILABLE'; }
  const persist = async value => {
    if (!validTokens(value)) fail('DESKTOP_ACCOUNT_RESPONSE_INVALID', 502);
    const expected = operation.getStore()?.epoch ?? epoch;
    const write = vaultTail.then(async () => {
      if (expected !== epoch) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
      await vault.store(key, JSON.stringify({ origin, tokens: value }));
      if (expected !== epoch) { await vault.remove(key); fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409); }
      tokens = value; vaultError = null;
    });
    vaultTail = write.catch(() => {}); return write;
  };
  const clear = async () => {
    if (!current()) return;
    epoch++; sessionAbort.abort(Object.assign(new Error('Session changed'), { code: 'DESKTOP_ACCOUNT_SESSION_CHANGED', status: 409 }));
    sessionAbort = new AbortController(); businessRequests?.abortAll(operation.getStore()?.requestId);
    tokens = null; sessionId = null;
    gameAuthority.clear();
    refreshTail = Promise.resolve();
    readiness = null; readinessEpoch = -1;
    api = makeApi(); // A new login must not join the retired client's refresh.
    onChanged(state());
    const remove = vaultTail.then(() => vault.remove(key));
    vaultTail = remove.catch(() => {}); return remove;
  };
  let verifiedInstance = false, readiness = null, readinessEpoch = -1;
  const transport = async (url, options = {}) => {
    const target = new URL(url);
    if (target.origin !== origin || target.username || target.password || !target.pathname.startsWith('/v1/')) fail('DESKTOP_ACCOUNT_ORIGIN_DENIED');
    if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
    const context = operation.getStore();
    const send = (address, settings, shared = false) => {
      // Refresh is shared by concurrent private reads. Cancelling one page must
      // not cancel another page's refresh; logout still cancels the session.
      const refresh = new URL(address).pathname === '/v1/auth/refresh';
      const signals = refresh || shared ? [context?.sessionSignal] : [settings?.signal, context?.signal, context?.sessionSignal];
      const signal = AbortSignal.any([AbortSignal.timeout(refresh ? 15000 : 20000), ...signals.filter(Boolean)]);
      return abortable(() => fetchImpl(address, { ...settings, redirect: 'error', credentials: 'omit', signal }), signal);
    };
    const verify = async () => {
      if (environment === 'production') {
        const response = await send(origin + '/ready', {method:'GET'}, true);
        if (!response.ok || response.redirected) fail('DESKTOP_PRODUCTION_UNAVAILABLE',503);
        let data; try { const body=await response.json(); data=body.data??body; } catch { fail('DESKTOP_PRODUCTION_UNAVAILABLE',503); }
        if (data?.status !== 'ready' || data.database !== true || data.migrations?.ready !== true || data.instance) fail('DESKTOP_PRODUCTION_UNAVAILABLE',503);
      }
      if (environment === 'isolated-test') {
        const response = await send(origin + '/ready-desktop-auth', { method: 'GET' }, true);
        if (!response.ok || response.redirected) fail('DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED', 503);
        let data; try { data = (await response.json()).data; } catch { fail('DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED', 503); }
        if (data?.status !== 'ready' || !['isolated-auth-only', 'isolated-business'].includes(data.instance) || data.backgroundTasksEnabled !== false ||
            data.instance === 'isolated-business' && (data.publishingEnabled !== false || data.modelCallsEnabled !== false) ||
            data.database !== true || data.redis !== true || data.migrations?.ready !== true) fail('DESKTOP_ACCOUNT_TEST_INSTANCE_REQUIRED', 503);
        if (runtimePolicy && (data.instance !== 'isolated-business' || data.runtime?.domain !== runtimePolicy.domain ||
          data.runtime?.scheme !== runtimePolicy.scheme || data.runtime?.port !== runtimePolicy.port)) fail('DESKTOP_RUNTIME_DENIED', 503);
      }
    };
    if (environment !== 'local-test' && !verifiedInstance) {
      if (!readiness || readinessEpoch !== epoch) {
        const expected = epoch;
        const checking = verify().then(() => {
          if (expected !== epoch) fail('DESKTOP_ACCOUNT_SESSION_CHANGED',409);
          verifiedInstance = true;
        });
        readiness = checking; readinessEpoch = expected;
        checking.catch(() => { if (readiness === checking) readiness = null; });
      }
      const pending = readiness;
      await abortable(() => pending, AbortSignal.any([options.signal,context?.signal,context?.sessionSignal].filter(Boolean)));
      if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED',409);
    }
    const response = await send(url, options);
    if (response.redirected || response.status >= 300 && response.status < 400) fail('DESKTOP_ACCOUNT_REDIRECT_DENIED', 502);
    return response;
  };
  const withCredentialRefresh = callback => {
    const result = refreshTail.then(() => { if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409); return callback(); });
    refreshTail = result.catch(() => {}); return result;
  };
  const makeApi = () => createApiClient({ baseUrl: origin, fetchImpl: transport, withRefreshLock: withCredentialRefresh,
    getAccessToken: () => current() ? tokens?.accessToken : null, getRefreshToken: () => current() ? tokens?.refreshToken : null, setTokens: persist });
  let api = makeApi();
  const marker = () => ({ desktopSessionId: sessionId });
  const revokeGitHubTokens = async value => {
    try { await createApiClient({baseUrl:origin,fetchImpl:transport,getAccessToken:()=>value.accessToken}).logout(); } catch {}
  };
  const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DESKTOP_ACCOUNT_INPUT_INVALID'); return value; };
  const text = (value, max) => { if (typeof value !== 'string' || !value.length || value.length>max) fail('DESKTOP_ACCOUNT_INPUT_INVALID'); return value; };
  async function dispatch(method, args, generation) {
    if (method === 'state') return state();
    if (method === 'business') {
      const request = object(args[0]);
      const values = businessArguments(request.method, request.args);
      if (request.method === 'getLaunch' && !runtimePolicy) fail('DESKTOP_RUNTIME_NOT_CONFIGURED', 503);
      gameAuthority.before(request.method, values);
      try {
        const signal = operation.getStore()?.signal;
        // Transport applies the page signal to ordinary I/O. Do not give it to
        // the client's shared refresh promise, which belongs to the session.
        const response = await api[request.method](...values);
        signal?.throwIfAborted();
        if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
        if (request.method === 'getLaunch') {
          onRuntimeOrigin(validateDesktopLaunch(response.data, runtimePolicy, ...values));
          gameAuthority.launched(response.data);
        }
        gameAuthority.completed(request.method, values, response);
        return rewriteBusinessMedia(response, origin);
      }
      catch (error) {
        if (error.code === 'DESKTOP_AUTH_TEST_ROUTE_DISABLED') fail('DESKTOP_BUSINESS_ACCOUNT_ONLY', 503);
        throw error;
      }
    }
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
      return withCredentialRefresh(async () => {
        if (!tokens) return { data: { authenticated: false, profile: null } };
        const result = await api.bootstrapSession(tokens.refreshToken);
        if (!result.data?.authenticated || !result.data.profile) { await clear(); return { data: { authenticated: false, profile: null } }; }
        if (result.data.tokens) await persist(result.data.tokens);
        return { data: { authenticated: true, profile: result.data.profile, tokens: marker() } };
      });
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
  businessRequests = createBusinessRequests({ timeoutMs: businessTimeoutMs, concurrency: businessConcurrency,
    run: item => operation.run({ epoch: item.epoch, requestId: item.id, signal: item.controller.signal, sessionSignal: item.sessionSignal }, async () => {
      if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
      try { return await dispatch('business', [item.request]); }
      catch (error) { if (error.status === 401 && tokens && current() && !item.controller.signal.aborted) await clear(); throw error; }
    }) });
  const exitSession = async method => {
    const retiring = tokens;
    const abandoned = cancelledGrants.splice(0);
    const removed = clear();
    const expected = epoch, signal = sessionAbort.signal;
    const finish = async () => {
      await removed;
      await Promise.all(abandoned.map(revokeGitHubTokens));
      if (method === 'clear' || !retiring) return state();
      // Revoke only the retiring grant. Late results never write the vault or
      // use a newer login's tokens. New auth mutations wait for this barrier.
      return operation.run({ epoch: expected, sessionSignal: signal }, async () => {
        let revokedTokens = retiring;
        const revoker = createApiClient({ baseUrl: origin, fetchImpl: transport,
          getAccessToken: () => revokedTokens.accessToken, getRefreshToken: () => revokedTokens.refreshToken,
          setTokens: value => { revokedTokens = value; } });
        return revoker[method]();
      });
    };
    const result = finish();
    tail = Promise.allSettled([tail, result]).then(() => {});
    return result;
  };
  return {
    state,
    gameContext(workId, capability, descriptor) {
      if (descriptor) gameAuthority.assertLaunch(descriptor, capability);
      else if (!tokens || !gameAuthority.hasLaunch(workId, capability)) fail('DESKTOP_GAME_SESSION_DENIED', 403);
      const expected = epoch;
      return () => { if (expected !== epoch) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409); };
    },
    assertRealtime: (workId, message) => gameAuthority.assertRealtime(workId, message),
    receiveRealtime: (workId, message) => gameAuthority.receiveRealtime(workId, message),
    async realtimeTicket() {
      if (!tokens) fail('AUTH_REQUIRED', 401);
      return operation.run({ epoch, signal: sessionAbort.signal, sessionSignal: sessionAbort.signal }, async () => {
        const result = await api.createRealtimeTicket(); if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409); return result.data;
      });
    },
    async media(value, options = {}) {
      const pathname = businessMediaPath(value, origin);
      if (!pathname) fail('DESKTOP_MEDIA_DENIED', 403);
      const response = await transport(origin + pathname, { method: 'GET', signal:options.signal });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) fail('DESKTOP_MEDIA_UNAVAILABLE', 404);
      if (Number(response.headers.get('content-length')) > 8*1024*1024) {
        await response.body?.cancel().catch(()=>{}); fail('DESKTOP_MEDIA_TOO_LARGE',413);
      }
      const reader = response.body.getReader(); let size = 0, finished = false;
      const stop = async reason => { if (finished) return; finished = true;
        await reader.cancel(reason).catch(()=>{}); try { reader.releaseLock(); } catch {} };
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const part = await reader.read(); if (finished) return;
            if (part.done) { finished=true; reader.releaseLock(); controller.close(); return; }
            size += part.value.length;
            if (size > 8*1024*1024) fail('DESKTOP_MEDIA_TOO_LARGE',413);
            controller.enqueue(part.value);
          } catch (error) { if (!finished) { await stop(error); controller.error(error); } }
        },
        cancel: stop,
      });
      // The anonymous Chromium transport caches eligible public images. Keep
      // the UI-scheme response uncached so account/private media never persist.
      return new Response(body, { headers: { 'Content-Type': type,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    },
    // Auth mutations stay ordered. Business work has a bounded, cancellable
    // queue; state/cancellation/local sign-out never wait behind business I/O.
    call(method, args = []) {
      if (typeof method !== 'string' || !Array.isArray(args) || args.length>1 || JSON.stringify(args).length>(method === 'business' ? businessRequestLimit(args[0]) : 4096)) return Promise.reject(Object.assign(new Error('DESKTOP_ACCOUNT_INPUT_INVALID'), { code: 'DESKTOP_ACCOUNT_INPUT_INVALID' }));
      if (['startGitHubWeb','cancelGitHub','createChallenge','verifyChallenge','clear','logout','logoutAll'].includes(method)) cancelGitHub();
      if (method === 'state') return Promise.resolve(state());
      if (method === 'cancelGitHub') return Promise.all(cancelledGrants.splice(0).map(revokeGitHubTokens)).then(() => ({ cancelled: true }));
      if (method === 'cancelBusiness') {
        try { return Promise.resolve(businessRequests.cancel(args[0])); } catch (error) { return Promise.reject(error); }
      }
      if (method === 'business') {
        try { const request = object(args[0]); businessArguments(request.method, request.args);
          return businessRequests.submit(request, epoch, sessionAbort.signal); }
        catch (error) { return Promise.reject(error); }
      }
      if (['clear', 'logout', 'logoutAll'].includes(method)) return exitSession(method);
      const generation=githubGeneration;
      const context = { epoch, signal: sessionAbort.signal, sessionSignal: sessionAbort.signal };
      const run = tail.then(() => operation.run(context, async () => {
        try {
          if (!current()) {
            if (method === 'bootstrapSession') return { data: { authenticated: false, profile: null } };
            fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
          }
          // Reserve the login epoch after earlier auth/remote-revoke barriers,
          // but before its own network/vault I/O. Retire anonymous page work.
          if (!tokens && (method === 'verifyChallenge' || method === 'accept' && githubGrant?.id === args[0]?.desktopSessionId)) {
            clear().catch(() => {});
            context.epoch = epoch; context.signal = sessionAbort.signal; context.sessionSignal = sessionAbort.signal;
          }
          while(cancelledGrants.length) await revokeGitHubTokens(cancelledGrants.shift());
          const result = method === 'bootstrapSession'
            ? await abortable(() => dispatch(method, args, generation), context.signal)
            : await dispatch(method, args, generation);
          if (!current() && method === 'bootstrapSession') return { data: { authenticated: false, profile: null } };
          if (!current()) fail('DESKTOP_ACCOUNT_SESSION_CHANGED', 409);
          return result;
        }
        catch (error) {
          if (method==='pollGitHubWeb' && [400,401].includes(error.status) && generation===githubGeneration) cancelGitHub();
          if (!current() && method === 'bootstrapSession') return { data: { authenticated: false, profile: null } };
          if (error.status === 401 && tokens && current()) await clear(); throw error;
        }
      }));
      tail = run.catch(() => {}); return run;
    },
  };
}
