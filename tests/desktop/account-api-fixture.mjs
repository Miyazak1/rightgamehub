import http from 'node:http';
import crypto from 'node:crypto';
import { createAuthService, AuthError } from '../../apps/api/src/auth-service.mjs';

// In-memory repository + mail capture. Uses the product authentication service;
// no database, SMTP, real account, production config or external credentials.
export async function createIsolatedAccountApi({ onMail = () => {}, onGitHubChallenge = () => {}, onBrowserVisit = () => {}, automaticOAuth = false, handleBusinessRequest = async () => false } = {}) {
  const profile = { id: '31e033b2-13d6-4b81-b214-21b3f25dca60', displayName: '桌面隔离测试用户',
    role: 'user', canPublish: false, createdAt: '2026-11-01T00:00:00Z', profileHandle: null,
    avatar: { kind: 'preset', presetKey: 'cat' }, linkedAccounts: [] };
  const challenges = new Map(), grants = new Map(), calls = [];
  const webChallenges = new Map(), upstreamTokens = new Set();
  let origin;
  let sentCode, now = new Date(), offline = false, refreshCount = 0, redirect = false;
  const equal = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);
  const validGrant = g => !g.revoked && new Date(g.refreshExpiresAt)>now;
  const denied = () => ({ ok: false, code: 'AUTH_REQUIRED', message: 'Test session expired' });
  const repository = {
    async createGitHubWebChallenge(row) { webChallenges.set(row.id,{...row,status:'pending'}); },
    async beginGitHubWebCallback({challengeId,stateHash}) {
      const c=webChallenges.get(challengeId);
      if (!c || c.status!=='pending' || c.callbackStarted || c.expiresAt<=now || !equal(c.stateHash,stateHash)) return {ok:false,code:'GITHUB_STATE_INVALID'};
      c.callbackStarted=true; return {ok:true,clientKind:c.clientKind,deviceLabel:c.deviceLabel};
    },
    async failGitHubWebChallenge({challengeId,errorCode}) { Object.assign(webChallenges.get(challengeId),{status:'failed',errorCode}); },
    async authorizeGitHubWebIdentity(row) {
      profile.linkedAccounts=[{provider:'github',label:'isolated-github-user'}];
      grants.set(row.grantId,{...row,userId:profile.id}); return {ok:true,grantId:row.grantId,profile};
    },
    async finishGitHubWebChallenge({challengeId,tokenPayload}) { Object.assign(webChallenges.get(challengeId),{status:'complete',tokenPayload}); return true; },
    async pollGitHubWebChallenge({challengeId}) {
      const c=webChallenges.get(challengeId);
      if (!c || c.consumed || c.expiresAt<=now) return {ok:false,code:'GITHUB_CHALLENGE_INVALID'};
      if (c.status==='failed') return {ok:false,code:c.errorCode};
      if (c.status!=='complete') return {ok:true,status:'pending'};
      c.consumed=true; return {ok:true,status:'complete',tokenPayload:c.tokenPayload};
    },
    async createChallenge(row) { challenges.set(row.id, row); return { ok: true }; },
    async consumeChallengeAndAuthorize(row) {
      const challenge = challenges.get(row.challengeId);
      if (!challenge || challenge.expiresAt<=now || !equal(challenge.codeHmac, row.submittedCodeHmac)) return denied();
      challenges.delete(row.challengeId); grants.set(row.grantId, { ...row, userId: profile.id, clientKind: challenge.clientKind });
      return { ok: true, grantId: row.grantId, profile };
    },
    async authenticateAccessToken({ tokenHash }) {
      const g = [...grants.values()].find(g => validGrant(g) && new Date(g.accessExpiresAt)>now && equal(g.accessTokenHash, tokenHash));
      return g ? { userId: profile.id, grantId: g.grantId, profile } : null;
    },
    async rotateRefreshToken(row) {
      const g = [...grants.values()].find(g => validGrant(g) && equal(g.refreshTokenHash, row.currentTokenHash));
      if (!g) return denied(); refreshCount++; Object.assign(g, row);
      return { ok: true, refreshExpiresAt: g.refreshExpiresAt, grantId: g.grantId, profile };
    },
    async getAccountProfile() { return structuredClone(profile); },
    async updateAccountProfile({ displayName }) { profile.displayName = displayName; return structuredClone(profile); },
    async setPresetAvatar({ presetKey }) { profile.avatar = { kind: 'preset', presetKey }; return structuredClone(profile); },
    async listDeviceGrants({ currentGrantId }) { return [...grants.values()].filter(validGrant).map(g => ({ id: g.grantId, deviceLabel: g.deviceLabel, clientKind: g.clientKind, current: g.grantId===currentGrantId, authenticatedAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: g.refreshExpiresAt.toISOString() })); },
    async logoutGrant({ grantId }) { grants.get(grantId).revoked = true; },
    async revokeDeviceGrant({ grantId }) { const g = grants.get(grantId); if (!g || g.revoked) return 0; g.revoked = true; return 1; },
    async revokeOtherDeviceGrants({ currentGrantId }) { let n=0; for (const g of grants.values()) if (g.grantId!==currentGrantId && !g.revoked) { g.revoked=true; n++; } return n; },
    async revokeAllDeviceGrants() { let n=0; for (const g of grants.values()) if (!g.revoked) { g.revoked=true; n++; } return n; },
  };
  const githubClient={webConfigured:true,
    createAuthorizeUrl({state,codeChallenge}) {
      const c=webChallenges.get(state.split('.')[0]); c.codeChallenge=codeChallenge;
      const url=new URL('/__github/authorize',origin);
      url.search=new URLSearchParams({client_id:'isolated-fixture',state,code_challenge:codeChallenge,code_challenge_method:'S256'}).toString();
      void onGitHubChallenge({challengeId:c.id,authorizeUrl:url.href}); return url.href;
    },
    async exchangeWebCode({code,codeVerifier}) {
      const c=webChallenges.get(code.replace(/^approved-/u,''));
      if (!c?.callbackStarted || crypto.createHash('sha256').update(codeVerifier).digest('base64url')!==c.codeChallenge) throw Error('fixture PKCE mismatch');
      const token=crypto.randomBytes(32).toString('base64url');upstreamTokens.add(token);return {access_token:token};
    },
    async getUser(token) { if(!upstreamTokens.delete(token))throw Error('fixture token mismatch');return {subject:'isolated-github-user',login:'isolated-github-user'}; },
  };
  const auth = createAuthService({ repository, githubClient, otpHmacKey: crypto.randomBytes(32).toString('hex'),
    clock: () => now, mailer: { async sendVerificationCode({ code }) { sentCode = code; await onMail(code); } } });
  const server = http.createServer(async (req, res) => {
    // Persist paths only, never authorization headers, OTP or token bodies.
    const url=new URL(req.url,origin);
    calls.push({ method: req.method, path: url.pathname });
    try {
      if (offline) throw new AuthError('TEST_OFFLINE', 503, 'Local fixture offline');
      if (redirect) { redirect = false; res.writeHead(302, { Location: 'http://127.0.0.1:9/redirect-denied' }); res.end(); return; }
      if (await handleBusinessRequest(req, res, url, () => auth.authenticateBearer(req.headers.authorization))) return;
      if(req.method==='GET' && url.pathname==='/__github/authorize') {
        const state=url.searchParams.get('state')||'', c=webChallenges.get(state.split('.')[0]);
        if(!c || !equal(c.stateHash,crypto.createHash('sha256').update(state).digest()))throw new AuthError('GITHUB_STATE_INVALID',400,'Invalid fixture state');
        await onBrowserVisit(c.id);
        const escaped=state.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"});
        res.end(`<title>墨鱼工坊本地 GitHub OAuth 测试</title><body style="background:#15131d;color:#f7f4ff;font:16px/1.8 system-ui;max-width:680px;margin:80px auto"><h1>本地 GitHub OAuth 模拟授权</h1><p>这是本机隔离测试，不连接 GitHub，不需要真实账号或密码。</p>${automaticOAuth?'<p>自动验收进行中，授权选择由测试脚本处理。手动体验请使用独立测试入口。</p>':''}<form action="/__github/decision" method="get"><input type="hidden" name="state" value="${escaped}"><button ${automaticOAuth?'disabled':''} name="decision" value="approve">同意本地测试授权</button> <button ${automaticOAuth?'disabled':''} name="decision" value="deny">取消授权</button></form></body>`);return;
      }
      if(req.method==='GET' && url.pathname==='/__github/decision') {
        const state=url.searchParams.get('state')||'',callback=new URL('/v1/auth/github/web/callback',origin);
        callback.searchParams.set('state',state);
        callback.searchParams.set(url.searchParams.get('decision')==='approve'?'code':'error',url.searchParams.get('decision')==='approve'?'approved-'+state.split('.')[0]:'access_denied');
        res.writeHead(302,{Location:callback.href});res.end();return;
      }
      if(req.method==='GET' && url.pathname==='/v1/auth/github/web/callback') {
        let status=200,message;
        try {
          const result=await auth.completeGitHubWeb(Object.fromEntries(url.searchParams));
          message=result.status==='complete'?'本地模拟授权回调已处理。请返回桌面，最终登录状态以桌面窗口为准。':'本地模拟授权已取消，桌面不会因此登录。';
        } catch(e) {
          if(!(e instanceof AuthError))throw e;
          status=e.statusCode;message='这条测试授权链接已失效或已被使用。请返回桌面重新发起登录，不要重复刷新此回调页。';
        }
        const nonce=crypto.randomBytes(16).toString('base64url');
        res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`});
        res.end(`<title>墨鱼工坊本地授权结果</title><body style="background:#15131d;color:#f7f4ff;font:16px/1.8 system-ui;max-width:680px;margin:80px auto"><h1>墨鱼工坊本地授权结果</h1><p>${message}</p><p style="color:#aaa4b9">这是本机隔离测试，没有连接真实 GitHub。可以关闭此标签页。</p><script nonce="${nonce}">history.replaceState(null,'',location.pathname)</script></body>`);return;
      }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length>8192) throw Error('body too large'); }
      const input = body ? JSON.parse(body) : {}, route = req.method + ' ' + req.url;
      let data;
      if (route === 'POST /v1/auth/email/challenges') data = await auth.requestChallenge(input);
      else if(route==='POST /v1/auth/github/web') data=await auth.startGitHubWeb(input);
      else if(req.method==='POST' && /^\/v1\/auth\/github\/web\/[^/]+\/poll$/u.test(url.pathname)) data=await auth.pollGitHubWeb({challengeId:url.pathname.split('/')[5]});
      else if (route === 'POST /v1/auth/email/verify') data = await auth.verifyChallenge(input);
      else if (route === 'POST /v1/auth/refresh') data = await auth.refresh(input);
      else if (route === 'POST /v1/auth/session') {
        let actor; try { actor = await auth.authenticateBearer(req.headers.authorization); } catch {}
        if (actor) data = { authenticated: true, profile: await auth.getProfile(actor), tokens: null };
        else {
          try { const tokens = await auth.refresh(input); data = { authenticated: true, profile: tokens.profile, tokens }; }
          catch (e) { if (![400,401].includes(e.statusCode)) throw e; data = { authenticated: false, profile: null, tokens: null }; }
        }
      } else {
        const actor = await auth.authenticateBearer(req.headers.authorization);
        if (route === 'GET /v1/me') data = await auth.getProfile(actor);
        else if (route === 'PATCH /v1/me') data = await auth.updateProfile(actor, input);
        else if (route === 'PATCH /v1/me/avatar') data = await auth.setPresetAvatar(actor, input);
        else if (route === 'GET /v1/me/devices') data = await auth.listDevices(actor);
        else if (route === 'POST /v1/auth/device/logout') data = await auth.logout(actor);
        else if (route === 'POST /v1/auth/devices/logout-all') data = await auth.logoutAll(actor);
        else if (route === 'POST /v1/auth/devices/logout-others') data = await auth.logoutOthers(actor);
        else if (req.method === 'DELETE' && req.url.startsWith('/v1/me/devices/')) data = await auth.revokeDevice(actor, { grantId: req.url.split('/').at(-1) });
        else throw new AuthError('TEST_ROUTE_UNAVAILABLE', 404, 'Fixture route unavailable');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ data }));
    } catch (e) { res.writeHead(e.statusCode ?? 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: e.code ?? 'TEST_FAILED', message: 'Isolated test request failed' } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  return { origin, calls, code: () => sentCode,
    async decide(authorizeUrl,decision='approve') { const source=new URL(authorizeUrl),url=new URL('/__github/decision',origin);url.search=new URLSearchParams({state:source.searchParams.get('state'),decision}).toString();return fetch(url); },
    expireAccess() { now = new Date(+now + 16*60_000); }, offline(value) { offline = value; },
    revoke() { for (const g of grants.values()) g.revoked = true; }, redirectNext() { redirect = true; },
    get refreshCount() { return refreshCount; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
