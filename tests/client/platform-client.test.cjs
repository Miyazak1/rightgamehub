const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('Windows releases download directly outside managed Agent hosts', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  assert.match(source, /const managedWindows = Boolean\(host\?\.desktop\?\.prepareRelease && host\?\.desktop\?\.launchRelease\)/);
  assert.match(source, /<DownloadLink href=\{windowsDownloadUrl\} fileName=\{windows\.fileName\} onClick=.*?>下载 Windows 版<\/DownloadLink>/);
  assert.match(source, /api\.releaseDownloadUrl\(work\.id, windows\.currentReleaseId\)/);
  assert.match(source, /由浏览器下载 Windows 游戏文件/);
  assert.doesNotMatch(source, /需要 GameHub Agent/);
});

test('privacy-preserving analytics distinguish download requests from Agent completion', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  assert.match(source, /type: 'download_start'/);
  assert.match(source, /type: 'download_complete'/);
  assert.match(source, /type: 'session_ping'/);
  assert.match(source, /document\?\.visibilityState === 'visible'/);
  assert.doesNotMatch(source, /analytics.*projectPath/i);
});

test('theme adapter maps modes to complete semantic tokens', async () => {
  const { themeToTokens } = await import('../../packages/host-contract/src/index.mjs');
  for (const mode of ['light', 'dark', 'high-contrast']) {
    const tokens = themeToTokens({ mode });
    for (const name of ['canvas', 'panel', 'raised', 'primary', 'secondary', 'border', 'action', 'hover', 'success', 'warning', 'danger', 'focus', 'glow', 'onAction']) assert.match(tokens[name], /^#[0-9a-f]{6}$/i);
  }
});

test('unsafe light-theme host accent falls back to accessible action color', async () => {
  const { themeToTokens } = await import('../../packages/host-contract/src/index.mjs');
  const tokens = themeToTokens({ mode: 'light', colors: { accent: '#f59e0b' } });
  assert.equal(tokens.action, '#6d36d8');
  assert.equal(tokens.glow, '#f59e0b');
});

test('high contrast never lets a host accent replace the action color', async () => {
  const { themeToTokens } = await import('../../packages/host-contract/src/index.mjs');
  assert.equal(themeToTokens({ mode: 'high-contrast', colors: { accent: '#9b6cff' } }).action, '#ffff00');
});

test('upload display reports small and server-confirmed sizes without misleading zero MB', async () => {
  const { formatBytes, uploadErrorMessage } = await import('../../packages/platform-client/src/upload-display.mjs');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(32 * 1024), '32 KB');
  assert.equal(formatBytes(32 * 1024 * 1024), '32.0 MB');
  assert.match(uploadErrorMessage('ENTRY_MISSING'), /一个 HTML.*自动识别/);
});

test('launch descriptor accepts release origin and rejects mismatched origin', async () => {
  const { validateLaunchDescriptor } = await import('../../packages/player-core/src/index.mjs');
  const base = { apiVersion: 1, runtimeOrigin: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example', entryUrl: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example/index.html' };
  assert.equal(validateLaunchDescriptor(base).entry.pathname, '/index.html');
  assert.throws(() => validateLaunchDescriptor({ ...base, entryUrl: 'https://evil.example/index.html' }), /不一致/);
  assert.throws(() => validateLaunchDescriptor({ ...base, runtimeOrigin: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.evil.example', entryUrl: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.evil.example/index.html' }), /受信任/);
  const production = { ...base, runtimeOrigin: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.runtime.mooyu.fun', entryUrl: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.runtime.mooyu.fun/index.html' };
  assert.equal(validateLaunchDescriptor(production, { runtimeDomain: 'runtime.mooyu.fun' }).entry.pathname, '/index.html');
  const local = { ...base, runtimeOrigin: 'http://r-27c4a881871a4ae18201ed0f4ecbe12a.localhost:3092', entryUrl: 'http://r-27c4a881871a4ae18201ed0f4ecbe12a.localhost:3092/index.html' };
  assert.equal(validateLaunchDescriptor(local, { allowLocalhost: true }).entry.pathname, '/index.html');
  assert.throws(() => validateLaunchDescriptor(local, { allowLocalhost: false }), /安全来源/);
});

test('player mounts an opaque-origin sandbox without host storage access', async () => {
  const { PlayerCore } = await import('../../packages/player-core/src/index.mjs');
  const attributes = {};
  const frame = { setAttribute: (name, value) => { attributes[name] = value; }, addEventListener() {}, remove() {} };
  const container = { ownerDocument: { createElement: () => frame }, replaceChildren() {} };
  const descriptor = {
    apiVersion: 1,
    runtimeOrigin: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example',
    entryUrl: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example/index.html',
    capabilities: { fullscreen: true, pointerLock: true },
  };
  new PlayerCore().mount(container, descriptor);
  assert.equal(attributes.sandbox, 'allow-scripts allow-pointer-lock');
  assert.doesNotMatch(attributes.sandbox, /allow-same-origin/);
});

test('platform player shell exposes honest lifecycle controls and recoverable stage states', async () => {
  const [source, styles] = await Promise.all([
    fs.readFile('packages/platform-client/src/App.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/styles.css', 'utf8'),
  ]);
  assert.match(source, /className="player-bar__identity"/);
  assert.match(source, /进入全屏/);
  assert.match(source, /游戏已最小化/);
  assert.match(source, /游戏已停止/);
  assert.match(source, /重新启动游戏/);
  assert.match(source, /停止会结束当前游戏会话/);
  assert.match(source, /className="player-frame-host" ref=\{mount\}/);
  assert.doesNotMatch(source, /隐藏或显示游戏/);
  assert.match(styles, /\.player-stage \{[^}]*border-radius: 2px/);
  assert.match(styles, /\.player-stage-state \{/);
  assert.match(styles, /\.player-frame-host,\.player-built-in/);
});

test('API client maps server errors and sends idempotency and bearer headers', async () => {
  const { createApiClient, ApiError } = await import('../../packages/platform-api-client/src/index.mjs');
  let request;
  const client = createApiClient({ getAccessToken: () => 'secret', fetchImpl: async (url, init) => { request = { url, init }; return new Response(JSON.stringify({ error: { code: 'CONFLICT', message: '冲突', retryable: false } }), { status: 409, headers: { 'content-type': 'application/json' } }); } });
  await assert.rejects(() => client.createWork({ title: 'A', description: '', kind: 'game' }), error => error instanceof ApiError && error.code === 'CONFLICT' && !error.retryable);
  assert.equal(request.init.headers.Authorization, 'Bearer secret');
  assert.ok(request.init.headers['Idempotency-Key'].length >= 16);
});

test('API client exposes catalog data without inventing local works', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let requested='';
  const client = createApiClient({ fetchImpl: async url => {requested=String(url);return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });} });
  assert.deepEqual((await client.listWorks({openSource:true,remixable:true,claimable:true,runtime:'web',source:'github_import'})).data, []);
  assert.match(requested,/openSource=true/);assert.match(requested,/remixable=true/);assert.match(requested,/claimable=true/);assert.match(requested,/runtime=web/);assert.match(requested,/source=github_import/);
});

test('API client creates authenticated playable shares and opens them publicly', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken:()=>'account-token',fetchImpl:async(url,init)=>{
    requests.push({ url,init });
    return new Response(JSON.stringify({ data:{ code:'BingoLink1234567890abcdef123456' } }),{ status:200,headers:{ 'content-type':'application/json' } });
  } });
  const gameSessionId='a'.repeat(43);
  await client.createGameShare(gameSessionId,{ title:'动画 Bingo',payload:{ kind:'bingo-pack' } });
  await client.getGameShare('BingoLink1234567890abcdef123456');
  assert.deepEqual(requests.map(item=>item.init.method),['POST','GET']);
  assert.equal(requests[0].init.headers.Authorization,'Bearer account-token');
  assert.equal(requests[0].init.headers['X-GameHub-Session'],gameSessionId);
  assert.equal(requests[1].init.headers.Authorization,undefined);
  assert.match(requests[0].url,/\/v1\/game-shares$/u);
  assert.match(requests[1].url,/\/v1\/game-shares\/BingoLink1234567890abcdef123456$/u);
});

test('API client submits analytics and reads administrator and creator overviews', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'analytics-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.trackAnalytics([{ type: 'page_view' }]);
  await client.getAdminAnalytics(30);
  await client.getCreatorAnalytics(90);
  await client.getAdminStorage();
  assert.deepEqual(requests.map(item => item.init.method), ['POST','GET','GET','GET']);
  assert.match(requests[0].url, /\/v1\/analytics\/events$/);
  assert.match(requests[1].url, /\/v1\/admin\/analytics\?days=30$/);
  assert.match(requests[2].url, /\/v1\/creator\/analytics\?days=90$/);
  assert.match(requests[3].url, /\/v1\/admin\/storage$/);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer analytics-token'));
});

test('creator studio exposes private aggregate insights and README play badges', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  assert.match(source, /CREATOR INSIGHTS/);
  assert.match(source, /api\.getCreatorAnalytics\(insights\.days\)/);
  assert.match(source, /复制 README 徽章/);
  assert.match(source, /\/v1\/works\/\$\{work\.id\}\/badge\.svg/);
  assert.match(source, /const PUBLIC_GAMEHUB_URL = 'https:\/\/mooyu\.fun'/);
  assert.match(source, /PUBLIC_GAMEHUB_URL}\/w\/\$\{work\.id\}/);
  assert.match(source, /复制分享链接/);
  assert.match(source, /PUBLIC_GAMEHUB_URL}\/w\/\$\{encodeURIComponent\(work\.id\)\}/);
});

test('stable public work handoff keeps the public URL visible and leaves it cleanly on navigation', async () => {
  const { readBrowserRoute, consumePublicWorkHandoff, navigateBrowserRoute } = await import('../../packages/platform-client/src/public-work-route.mjs');
  const location = { pathname: '/', hash: '#/works/work-123?public=1' };
  const calls = [];
  const history = {
    state: { test: true },
    replaceState: (_state, _title, url) => { calls.push(['replace', url]); location.pathname = url; location.hash = ''; },
    pushState: (_state, _title, url) => { calls.push(['push', url]); location.pathname = '/'; location.hash = url.slice(1); },
  };
  assert.equal(readBrowserRoute('hash', location), '/works/work-123');
  assert.equal(consumePublicWorkHandoff(location, history), true);
  assert.equal(location.pathname, '/w/work-123');
  assert.equal(readBrowserRoute('hash', location), '/works/work-123');
  let route = '';
  navigateBrowserRoute('hash', '/discover', location, history, next => { route = next; });
  assert.deepEqual(calls, [['replace', '/w/work-123'], ['push', '/#/discover']]);
  assert.equal(route, '/discover');
  assert.equal(location.pathname, '/');
});

test('creator publishing stays direct while Agent toolkits remain optional', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  for (const key of ['bingo','bitsy','puzzlescript','twine','pixel-assets']) assert.match(source, new RegExp(`key: '${key}'`));
  assert.match(source, /OPTIONAL CREATOR TOOLS/);
  assert.match(source, /不是发布流程，也不是上传作品的前置条件/);
  assert.match(source, /不使用它们也不会影响创建、上传或发布/);
  assert.match(source, /复制这条 Agent 任务/);
  assert.match(source, /<dt>执行位置<\/dt><dd>用户本地<\/dd>/);
  assert.match(source, /工具与发布相互独立/);
  assert.match(source, /不会替你创建作品、改变上传入口/);
  assert.match(source, /onClick=\{\(\) => go\('\/creator\/tools'\)\}>创作工具/);
  assert.match(source, /onClick=\{\(\) => go\('\/creator\/works\/new'\)\}>新建作品/);
  assert.match(source, /route === '\/creator\/tools'\) content = <CreatorToolsPage/);
  assert.match(source, /route === '\/creator\/works\/new'\) content = <NewWorkPage/);
  assert.doesNotMatch(source, /className="ai-studio-gateway"/);
  assert.doesNotMatch(source, /打开官方工具/);
  assert.doesNotMatch(source, /editorUrl/);
  assert.doesNotMatch(source, /title: 'Bingo 快速编辑'/);
  assert.doesNotMatch(source, /content = <StudioDraftPage/);
  assert.match(source, /content = <RetiredStudioPage go=\{go\}\/>/);
  assert.match(source, /content = <CreatorDraftReviewPage/);
  assert.match(source, /这里不提供内容编辑/);
  assert.match(source, /建立作品资料后，下一步直接上传可运行的 Web ZIP/);
});

test('API client creates an authenticated realtime connection ticket', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let request;
  const client = createApiClient({ getAccessToken: () => 'realtime-token', fetchImpl: async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ data: { ticket: 't'.repeat(43), websocketUrl: 'wss://mooyu.fun/v1/realtime', expiresAt: '2026-09-30T00:00:30.000Z', protocol: 'gamehub.realtime.v1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await client.createRealtimeTicket();
  assert.equal(result.data.protocol, 'gamehub.realtime.v1');
  assert.match(request.url, /\/v1\/realtime\/tickets$/u);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer realtime-token');
});

test('API client exposes multiplayer mode and room lifecycle operations', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const roomId = '00000000-0000-4000-8000-000000000301';
  const modeId = '00000000-0000-4000-8000-000000000302';
  const client = createApiClient({ getAccessToken: () => 'room-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.listMultiplayerModes('gamehub-example');
  await client.listMultiplayerRooms(modeId,30,'Miyazaki');
  await client.createMultiplayerRoom({ modeId, visibility: 'public', capacity: 2 });
  await client.getMultiplayerRoom(roomId);
  await client.joinMultiplayerRoom(roomId, 'ABCDE-23456');
  await client.joinMultiplayerRoomScoped(roomId, modeId, 'ABCDE-23456');
  await client.createMultiplayerInvite(roomId);
  await client.setMultiplayerReady(roomId, true);
  await client.leaveMultiplayerRoom(roomId);
  assert.deepEqual(requests.map(item => item.init.method), ['GET','GET','POST','GET','POST','POST','POST','POST','POST']);
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(requests[1].init.headers.Authorization, undefined);
  assert.ok(requests.slice(2).every(item => item.init.headers.Authorization === 'Bearer room-token'));
  assert.ok(requests[2].init.headers['Idempotency-Key'].length >= 16);
  assert.match(requests[1].url,/query=Miyazaki/u);
  assert.equal(requests[4].init.body, JSON.stringify({ joinCode: 'ABCDE-23456' }));
  assert.equal(requests[5].init.body, JSON.stringify({ modeId, joinCode: 'ABCDE-23456' }));
  assert.match(requests[6].url,/\/rooms\/[^/]+\/invite$/u);
});

test('API client starts and recovers authoritative multiplayer matches', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const roomId = '00000000-0000-4000-8000-000000000303';
  const matchId = '00000000-0000-4000-8000-000000000304';
  const client = createApiClient({ getAccessToken: () => 'match-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.startMultiplayerRoom(roomId);
  await client.getMultiplayerMatch(matchId);
  await client.listMultiplayerMatchEvents(matchId, 8, 40);
  await client.getMultiplayerReplay(matchId);
  await client.getAdminMultiplayerOverview();
  await client.listAdminMultiplayerMatches('active', 25);
  await client.abortAdminMultiplayerMatch(matchId, 'stuck');
  await client.listAdminMultiplayerAudit(20);
  assert.deepEqual(requests.map(item => item.init.method), ['POST','GET','GET','GET','GET','GET','POST','GET']);
  assert.match(requests[0].url, new RegExp(`/v1/multiplayer/rooms/${roomId}/start$`));
  assert.ok(requests[0].init.headers['Idempotency-Key'].length >= 16);
  assert.match(requests[2].url, /afterSeq=8&limit=40$/u);
  assert.match(requests[3].url, new RegExp(`/v1/multiplayer/matches/${matchId}/replay$`));
  assert.match(requests[5].url, /status=active&limit=25$/u);
  assert.equal(requests[6].init.body, JSON.stringify({ reason: 'stuck' }));
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer match-token'));
});

test('API client reads the authenticated creator collection', async () => {
  let request;
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const client = createApiClient({ getAccessToken: () => 'creator-token', fetchImpl: async (url, init) => { request = { url, init }; return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); } });
  assert.deepEqual((await client.listCreatorWorks()).data, []);
  assert.match(request.url, /\/v1\/creator\/works$/);
  assert.equal(request.init.headers.Authorization, 'Bearer creator-token');
});

test('API client reads release history and withdraws with optimistic concurrency', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const workId = '00000000-0000-4000-8000-000000000111';
  const client = createApiClient({ getAccessToken: () => 'creator-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: url.endsWith('/releases') ? [] : { id: workId, revision: '8', state: 'withdrawn' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.listWorkReleases(workId);
  await client.withdrawWork(workId, '7');
  assert.deepEqual(requests.map(item => item.init.method), ['GET', 'POST']);
  assert.match(requests[0].url, new RegExp(`/v1/creator/works/${workId}/releases$`));
  assert.equal(requests[1].init.headers['If-Match'], `"work-${workId}-7"`);
  assert.ok(requests[1].init.headers['Idempotency-Key'].length >= 16);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer creator-token'));
});

test('API client uploads a work cover as authenticated image bytes', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let request;
  const workId = '00000000-0000-4000-8000-000000000112';
  const client = createApiClient({ getAccessToken: () => 'creator-token', fetchImpl: async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ data: { id: workId, coverUrl: `/v1/works/${workId}/cover` } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const file = new Blob([Buffer.from('png-cover')], { type: 'image/png' });
  await client.uploadWorkCover(workId, file);
  assert.match(request.url, new RegExp(`/v1/creator/works/${workId}/cover$`));
  assert.equal(request.init.method, 'PUT');
  assert.equal(request.init.body, file);
  assert.equal(request.init.headers.Authorization, 'Bearer creator-token');
  assert.equal(request.init.headers['Content-Type'], 'image/png');
});

test('API client submits reports and exposes admin decisions and audit reads', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const workId = '00000000-0000-4000-8000-000000000113';
  const reportId = '00000000-0000-4000-8000-000000000114';
  const client = createApiClient({ getAccessToken: () => 'moderator-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.reportWork(workId, { category: 'unsafe', details: 'Unexpected request.' });
  await client.listReports('open');
  await client.decideReport(reportId, { action: 'dismiss', note: 'Not reproducible.' });
  await client.listModerationAudit();
  assert.deepEqual(requests.map(item => item.init.method), ['POST','GET','POST','GET']);
  assert.match(requests[0].url, new RegExp(`/v1/works/${workId}/reports$`));
  assert.match(requests[1].url, /\/v1\/admin\/reports\?status=open$/);
  assert.match(requests[2].url, new RegExp(`/v1/admin/reports/${reportId}/decision$`));
  assert.match(requests[3].url, /\/v1\/admin\/audit$/);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer moderator-token'));
});

test('API client keeps player feedback and author-controlled GitHub issue drafting separate', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const workId = '00000000-0000-4000-8000-000000000115';
  const feedbackId = '00000000-0000-4000-8000-000000000116';
  const client = createApiClient({ getAccessToken: () => 'player-or-creator-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.createCreatorFeedback(workId, { category: 'bug', summary: 'Cannot restart level', details: 'Restart leaves the player frozen.' });
  await client.listCreatorFeedback('new');
  await client.createCreatorFeedbackIssueDraft(feedbackId);
  await client.updateCreatorFeedback(feedbackId, { action: 'archive' });
  assert.deepEqual(requests.map(item => item.init.method), ['POST','GET','POST','PATCH']);
  assert.match(requests[0].url, new RegExp(`/v1/works/${workId}/feedback$`));
  assert.match(requests[1].url, /\/v1\/creator\/feedback\?status=new$/);
  assert.match(requests[2].url, new RegExp(`/v1/creator/feedback/${feedbackId}/issue-draft$`));
  assert.match(requests[3].url, new RegExp(`/v1/creator/feedback/${feedbackId}$`));
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer player-or-creator-token'));
});

test('player feedback form explains minimum lengths instead of silently disabling submit', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  assert.match(source, /一句话标题至少需要 5 个字，还差/);
  assert.match(source, /详细说明至少需要 10 个字，还差/);
  assert.match(source, /\{summaryLength\}\/160 · 至少 5 个字/);
  assert.match(source, /\{detailsLength\}\/2000 · 至少 10 个字/);
  assert.match(source, /type="submit" disabled=\{state === 'sending'\}/);
  assert.doesNotMatch(source, /disabled=\{state === 'sending' \|\| form\.summary\.trim\(\)\.length/);
});

test('API client exposes the contribution draft, claim, submission and acceptance loop', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = []; const feedbackId = crypto.randomUUID(); const taskId = crypto.randomUUID();
  const client = createApiClient({ getAccessToken: () => 'contributor-token', fetchImpl: async (url, init) => {
    requests.push({ url, init }); return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.createContributionTaskFromFeedback(feedbackId, { title: 'Improve controls', description: 'Document keyboard controls and verification.', difficulty: 'starter', skills: ['docs'] });
  await client.listCreatorContributionTasks(); await client.updateCreatorContributionTask(taskId, { action: 'publish' }); await client.createContributionIssueDraft(taskId);
  await client.listContributionTasks('open'); await client.claimContributionTask(taskId); await client.submitContributionTask(taskId, { url: 'https://github.com/example/game/pull/7', note: 'Ready for review.' }); await client.releaseContributionTask(taskId);
  assert.deepEqual(requests.map(item => item.init.method), ['POST','GET','PATCH','POST','GET','POST','POST','POST']);
  assert.match(requests[0].url, new RegExp(`/v1/creator/feedback/${feedbackId}/contribution-task$`));
  assert.match(requests[4].url, /\/v1\/contribution-tasks\?status=open&limit=50$/);
  assert.match(requests[6].url, new RegExp(`/v1/contribution-tasks/${taskId}/submission$`));
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer contributor-token'));
});

test('API client reads, updates and logs out the current account with bearer auth', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({
    getAccessToken: () => 'account-token',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ data: { id: 'u', displayName: 'Player' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.getProfile();
  await client.updateProfile({ displayName: 'Player' });
  await client.logout();
  assert.deepEqual(requests.map(request => request.init.method), ['GET', 'PATCH', 'POST']);
  assert.ok(requests.every(request => request.init.headers.Authorization === 'Bearer account-token'));
  assert.match(requests[1].url, /\/v1\/me$/);
  assert.match(requests[2].url, /\/v1\/auth\/device\/logout$/);
});

test('API client lists and revokes account device sessions', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'account-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: url.endsWith('/devices') && init.method === 'GET' ? [] : { revokedCount: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.listDevices();
  await client.revokeDevice('00000000-0000-4000-8000-000000000001');
  await client.logoutOthers();
  await client.logoutAll();
  assert.deepEqual(requests.map(request => request.init.method), ['GET', 'DELETE', 'POST', 'POST']);
  assert.match(requests[1].url, /\/v1\/me\/devices\/00000000-0000-4000-8000-000000000001$/);
  assert.match(requests[2].url, /\/v1\/auth\/devices\/logout-others$/);
  assert.match(requests[3].url, /\/v1\/auth\/devices\/logout-all$/);
  assert.ok(requests.every(request => request.init.headers.Authorization === 'Bearer account-token'));
});

test('API client selects presets and uploads animated avatar bytes with bearer auth', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({
    baseUrl: 'https://api.example', getAccessToken: () => 'account-token',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ data: { avatar: { kind: 'preset', presetKey: 'fox' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const gif = new Blob([Buffer.from('GIF89a-avatar')], { type: 'image/gif' });
  await client.selectAvatar('fox');
  await client.uploadAvatar(gif);
  assert.deepEqual(requests.map(request => request.init.method), ['PATCH', 'PUT']);
  assert.equal(requests[0].init.body, JSON.stringify({ presetKey: 'fox' }));
  assert.equal(requests[1].init.body, gif);
  assert.equal(requests[1].init.headers['Content-Type'], 'image/gif');
  assert.ok(requests.every(request => request.init.headers.Authorization === 'Bearer account-token'));
  assert.equal(client.avatarUrl({ url: '/v1/avatars/u?v=1' }), 'https://api.example/v1/avatars/u?v=1');
});

test('API client persists library state, recent plays and daily results', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'account-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: url.endsWith('/daily') ? { date: '2026-09-28' } : [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.listLibrary();
  await client.getLibraryState('gamehub-guess-baike');
  await client.saveToLibrary('gamehub-guess-baike');
  await client.removeFromLibrary('gamehub-guess-baike');
  await client.recordPlay('gamehub-guess-baike');
  await client.getGuessBaikeDaily();
  await client.saveGuessBaikeResult({ puzzleDate: '2026-09-28', puzzleId: 'wikipedia-1', guessedCount: 8, elapsedSeconds: 42, hints: 0 });
  assert.deepEqual(requests.map(item => item.init.method), ['GET','GET','PUT','DELETE','POST','GET','POST']);
  assert.ok(requests.slice(0,5).every(item => item.init.headers.Authorization === 'Bearer account-token'));
  assert.equal(requests[5].init.headers.Authorization, undefined);
  assert.equal(requests[6].init.headers.Authorization, 'Bearer account-token');
});

test('API client exposes automatic Guess Baike inventory and emergency controls', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'admin-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.listAdminGuessBaikePuzzles();
  await client.getGuessBaikeAutomationStatus();
  await client.updateAdminGuessBaikePuzzle('wikipedia-100', 'disabled');
  assert.deepEqual(requests.map(item => [item.url,item.init.method]), [
    ['/v1/admin/games/guess-baike/puzzles','GET'],['/v1/admin/games/guess-baike/automation','GET'],['/v1/admin/games/guess-baike/puzzles/wikipedia-100','PATCH'],
  ]);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer admin-token'));
});

test('API client exposes bounded social profile and Guess Baike leaderboard operations', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'account-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const userId = '00000000-0000-4000-8000-000000000002';
  await client.getSocialProfile();
  await client.updateSocialProfile({ bio: 'Pixel player', visibility: 'followers' });
  await client.getPublicProfile(userId);
  await client.followUser(userId);
  await client.unfollowUser(userId);
  await client.blockUser(userId);
  await client.unblockUser(userId);
  await client.getGuessBaikeLeaderboard('2026-09-29', 'following');
  await client.reactToGuessBaikeResult(userId, { puzzleDate: '2026-09-29', reaction: 'gg' });
  await client.removeGuessBaikeReaction(userId, '2026-09-29');
  await client.listSocialNotifications();
  await client.markSocialNotificationsRead();
  await client.createGuessBaikeChallenge('2026-09-29');
  await client.getGuessBaikeChallenge('PIXEL_LINK_1');
  assert.deepEqual(requests.map(item => item.init.method), ['GET','PATCH','GET','PUT','DELETE','PUT','DELETE','GET','PUT','DELETE','GET','POST','POST','GET']);
  assert.match(requests[7].url, /date=2026-09-29&scope=following$/);
  assert.match(requests.at(-1).url, /\/v1\/challenges\/PIXEL_LINK_1$/);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer account-token'));
});

test('API client starts and polls GitHub device authorization without bearer credentials', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: url.endsWith('/poll') ? { status: 'pending', retryAfter: 5, tokens: null } : { challengeId: 'c', userCode: 'ABCD-EFGH' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.startGitHubDevice({ clientKind: 'harness', deviceLabel: 'Harness' });
  await client.pollGitHubDevice('00000000-0000-4000-8000-000000000001');
  assert.match(requests[0].url, /\/v1\/auth\/github\/device$/);
  assert.match(requests[1].url, /\/v1\/auth\/github\/device\/00000000-0000-4000-8000-000000000001\/poll$/);
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(requests[1].init.headers.Authorization, undefined);
});

test('API client starts and polls GitHub web authorization without bearer credentials', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: url.endsWith('/poll') ? { status: 'pending', retryAfter: 2, tokens: null } : { challengeId: 'c', authorizeUrl: 'https://github.com/login/oauth/authorize' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.startGitHubWeb({ clientKind: 'cursor', deviceLabel: 'Cursor' });
  await client.pollGitHubWeb('00000000-0000-4000-8000-000000000001');
  assert.match(requests[0].url, /\/v1\/auth\/github\/web$/);
  assert.match(requests[1].url, /\/v1\/auth\/github\/web\/00000000-0000-4000-8000-000000000001\/poll$/);
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(requests[1].init.headers.Authorization, undefined);
});

test('GitHub source import UI stays read-only and hands drafts to the controlled build flow', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  assert.match(source, /function GitHubImportPage/);
  assert.match(source, /只读取你授权仓库的元数据、README、许可证和固定提交信息，不执行仓库代码/);
  assert.match(source, /导入不会自动执行或发布仓库代码/);
  assert.match(source, /私有仓库地址不会出现在公开作品资料中/);
  assert.match(source, /未检测到许可证/);
  assert.match(source, /已找到 index\.html/);
  assert.match(source, /确认你有权为这个仓库选择或修改许可证/);
  assert.match(source, /不是仓库权利人？请联系原作者补充许可证/);
  assert.match(source, /重新检测/);
  assert.match(source, /创建私有草稿并继续/);
  assert.match(source, /继续已有草稿/);
  assert.match(source, /state\.preview\.workId/);
  assert.match(source, /继续构建/);
  assert.match(source, /sourceProvider === 'github'/);
  assert.match(source, /createGitHubImportedDraft/);
  assert.match(source, /go\(`\/creator\/works\/\$\{result\.work\.id\}\/builds`\)/);
  assert.match(source, /function SourceBuildPage/);
  assert.match(source, /不会运行 package\.json、脚本或自定义命令/);
});

test('API client exposes idempotent source builds, status polling and explicit publish', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests=[];
  const client=createApiClient({ getAccessToken:()=> 'creator-token',fetchImpl:async(url,init)=>{ requests.push({ url,init }); return new Response(JSON.stringify({ data:[] }),{ status:200,headers:{ 'content-type':'application/json' } }); } });
  const workId='00000000-0000-4000-8000-000000000001'; const buildId='00000000-0000-4000-8000-000000000002';
  await client.createSourceBuild(workId,{ templateKey:'static-v1',releaseLabel:'1.0.0' });
  await client.listSourceBuilds(workId);
  await client.getSourceBuild(workId,buildId);
  await client.publishSourceBuild(workId,buildId);
  assert.deepEqual(requests.map(item=>item.init.method),['POST','GET','GET','POST']);
  assert.ok(requests[0].init.headers['Idempotency-Key']);
  assert.ok(requests.every(item=>item.init.headers.Authorization==='Bearer creator-token'));
  assert.match(requests[3].url,/\/builds\/00000000-0000-4000-8000-000000000002\/publish$/u);
});

test('API client exposes authenticated GitHub source operations and idempotent draft creation', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'creator-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const id = '00000000-0000-4000-8000-000000000001';
  await client.startGitHubSourceInstall();
  await client.listGitHubSourceConnections();
  await client.listGitHubSourceRepositories(id);
  await client.previewGitHubSourceImport({ connectionId: id, repositoryId: '7' });
  await client.createGitHubImportedDraft({ importId: id, title: 'Desk Cat' });
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer creator-token'));
  assert.ok(requests.at(-1).init.headers['Idempotency-Key']);
  assert.match(requests.at(-1).url, /\/v1\/creator\/source-imports\/drafts$/);
});

test('API client and work detail expose the governed project claim loop', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests=[];
  const client=createApiClient({getAccessToken:()=> 'claim-token',fetchImpl:async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({data:[]}),{status:200,headers:{'content-type':'application/json'}});}});
  const workId='00000000-0000-4000-8000-000000000001',claimId='00000000-0000-4000-8000-000000000002',connectionId='00000000-0000-4000-8000-000000000003';
  await client.getPublicProjectClaim(workId);
  await client.createProjectClaim(workId,{evidenceType:'github',connectionId,repositoryId:'42',relationship:'owner'});
  await client.listMyProjectClaims();
  await client.cancelProjectClaim(claimId);
  await client.listAdminProjectClaims();
  await client.listAdminProjectClaimEvents(claimId);
  await client.listAdminWorkProvenance();
  await client.listAdminWorkProvenanceEvents(workId);
  await client.updateAdminWorkProvenance(workId,{attributionKind:'community_catalog',repositoryUrl:null,licenseSpdx:null,expectedRevision:'1',note:'平台代为收录'});
  await client.decideProjectClaim(claimId,{action:'approve',note:'GitHub repository verified'});
  assert.deepEqual(requests.map(item=>item.init.method),['GET','POST','GET','POST','GET','GET','GET','GET','PATCH','POST']);
  assert.equal(requests[0].init.headers.Authorization,undefined);
  assert.ok(requests.slice(1).every(item=>item.init.headers.Authorization==='Bearer claim-token'));
  assert.match(requests[5].url,/\/v1\/admin\/project-claims\/00000000-0000-4000-8000-000000000002\/events$/u);
  assert.match(requests[7].url,/\/v1\/admin\/works\/00000000-0000-4000-8000-000000000001\/provenance-events$/u);
  assert.match(requests[8].url,/\/v1\/admin\/works\/00000000-0000-4000-8000-000000000001\/provenance$/u);
  assert.match(requests[9].url,/\/v1\/admin\/project-claims\/00000000-0000-4000-8000-000000000002\/decision$/u);
  const source=await fs.readFile('packages/platform-client/src/App.jsx','utf8');
  assert.match(source,/社区收录，尚未认领/);assert.match(source,/发布者直接上传/);assert.match(source,/我是作者\/维护者/);assert.match(source,/MY GAME CLAIMS/);assert.match(source,/GAME CLAIM GOVERNANCE/);assert.match(source,/GAME PROVENANCE/);assert.match(source,/审核与权限历史/);assert.match(source,/来源修正历史/);assert.match(source,/GitHub 只是可选证据/);
});

test('API client exposes staged multiplayer rule submission and administrative review', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'rules-token',fetchImpl: async (url,init) => {
    requests.push({ url,init });
    return new Response(JSON.stringify({ data: [] }),{ status: 200,headers: { 'content-type': 'application/json' } });
  } });
  const workId = '00000000-0000-4000-8000-000000000001'; const submissionId = '00000000-0000-4000-8000-000000000002';
  await client.createMultiplayerRuleSubmission(workId,{ modeKey: 'duel' });
  await client.listMultiplayerRuleSubmissions(workId);
  await client.createMultiplayerRuleUploadGrant(submissionId);
  await client.submitMultiplayerRuleSubmission(submissionId);
  await client.listAdminMultiplayerRuleSubmissions('queue',20);
  await client.reviewAdminMultiplayerRuleSubmission(submissionId,{ action: 'start' });
  await client.downloadAdminMultiplayerRuleBuild(submissionId);
  assert.deepEqual(requests.map(item => item.init.method),['POST','GET','POST','POST','GET','POST',undefined]);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer rules-token'));
  assert.ok(requests[0].init.headers['Idempotency-Key']);
  assert.ok(requests[3].init.headers['Idempotency-Key']);
  assert.match(requests[4].url,/state=queue&limit=20$/u);
  assert.match(requests[6].url,/\/v1\/admin\/multiplayer\/rule-builds\/.+\/package$/u);
  assert.equal(requests[6].init.headers.Accept,'application/javascript');
});

test('multiplayer rule UI states that approval is not execution, signing or deployment', async () => {
  const submission = await fs.readFile('packages/platform-client/src/MultiplayerRuleSubmissionPage.jsx','utf8');
  const review = await fs.readFile('packages/platform-client/src/MultiplayerRuleReviewQueue.jsx','utf8');
  assert.match(submission,/平台审核、受控构建、摘要确认和离线签名完成前，不会在 API 或 Realtime 中执行/);
  assert.match(submission,/提交不等于上线/);
  assert.match(review,/“批准构建”不会自动签名、部署或注册模式/);
  assert.match(review,/approve_for_build/);
});

test('multiplayer rule review panel keeps its heading and queue inset from the governance border', async () => {
  const styles = await fs.readFile('packages/platform-client/src/styles.css', 'utf8');
  assert.match(styles, /\.rule-review-queue \{[^}]*padding: 20px;/);
  assert.match(styles, /\.rule-review-queue > \.puzzle-ops__head \{ margin-bottom: 0; \}/);
  assert.match(styles, /@container \(max-width: 560px\) \{ \.rule-review-queue \{ padding: 12px; \} \}/);
});

test('creator contribution empty state stays centered and omits redundant first-page controls', async () => {
  const [source, styles] = await Promise.all([
    fs.readFile('packages/platform-client/src/ContributionCenter.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/styles.css', 'utf8'),
  ]);

  assert.match(source, /className="creator-contributions__empty"/);
  assert.match(source, /\(page>0\|\|state\.data\.length>pageSize\)&&<Pages/);
  assert.match(styles, /\.creator-contributions__list\.is-empty\{[^}]*place-items:center/);
  assert.match(styles, /\.creator-contributions__empty,\.creator-contributions__state\{[^}]*text-align:center/);
});

test('community navigation unifies sharing and contribution without breaking legacy task routes', async () => {
  const [navigation, shell, app, contribution, community, styles] = await Promise.all([
    fs.readFile('packages/platform-client/src/PlatformNavigation.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/CommunityShell.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/App.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/ContributionCenter.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/CommunityPage.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/styles.css', 'utf8'),
  ]);

  assert.match(navigation, /\['\/community', '社区'/);
  assert.doesNotMatch(navigation, /\['\/contribute', '共建'/);
  assert.match(shell, /'首页'.*'动态'.*'一起做'.*'活动'.*'游戏组队'.*'我的参与'/s);
  assert.match(app, /parts\[0\] === 'community' && parts\[1\] === 'projects'/);
  assert.match(app, /route === '\/contribute'.*<CommunityShell/s);
  assert.match(contribution, /\/community\/projects\/tasks\/\$\{item\.id\}/);
  assert.match(community, /<CommunityShell route=\{route\} go=\{go\}>/);
  assert.match(community, /今天，和谁一起做点什么/);
  assert.match(shell, /className="community-hub-toolbar"/);
  assert.match(shell, /aria-haspopup="menu"/);
  assert.match(shell, /event\.key==='Escape'/);
  assert.match(shell, /open\('\/community\/projects\/new'\)/);
  assert.doesNotMatch(shell, /<details className="community-launch"/);
  assert.match(styles, /\.community-launch__backdrop\{position:fixed;z-index:80;inset:0;display:block/);
  assert.match(community, /mode==='feed'\?' is-feed':''/);
  const narrowCommunityPage = styles.indexOf('.community-page:not(.is-home)');
  const wideCommunityFeed = styles.indexOf('.community-page.is-feed{width:100%;max-width:none;margin-inline:0}');
  assert.ok(narrowCommunityPage >= 0 && wideCommunityFeed > narrowCommunityPage);
});

test('community projects add a real project workflow and reuse contribution tasks', async () => {
  const [client,projects,contribution,app] = await Promise.all([
    fs.readFile('packages/platform-api-client/src/community.mjs', 'utf8'),
    fs.readFile('packages/platform-client/src/CommunityProjects.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/ContributionCenter.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/App.jsx', 'utf8'),
  ]);
  assert.match(client, /communityProjectCreate/);
  assert.match(client, /communityProjectApply/);
  assert.match(client, /communityProjectDecide/);
  assert.match(projects, /申请加入/);
  assert.match(projects, /待处理申请/);
  assert.match(projects, /<ContributionCenterPage[^>]*projectId=\{project\.id\}/);
  assert.match(contribution, /来自项目：\{item\.project\.title\}/);
  assert.match(app, /<CommunityProjects/);
  assert.match(app, /startCreating=\{parts\[2\]==='new'\}/);
  assert.match(projects, /startCreating=false/);
  assert.match(projects, /if\(startCreating\).*setCreating\(true\).*go\('\/account'\)/);
  assert.match(projects, /发布项目更新/);
});

test('community typography follows the navigation scale and styles form controls', async () => {
  const styles = await fs.readFile('packages/platform-client/src/styles.css', 'utf8');
  const baselineStart = styles.indexOf('/* Community typography hierarchy');
  assert.ok(baselineStart >= 0);
  const baseline = styles.slice(baselineStart);
  assert.match(baseline, /\.community-hub-page \{[^}]*--community-control-font:[^}]*Cascadia Mono[^}]*font-size: 14px;/s);
  assert.match(baseline, /\.community-hub-page \.button \{[^}]*min-height: 40px;[^}]*font-size: 12px;/s);
  assert.match(baseline, /\.community-hub-page input:not\([^}]*\),[\s\S]*?\.community-hub-page select \{[^}]*height: 42px;[^}]*min-height: 42px;/);
  assert.match(baseline, /\.community-hub-page input,[\s\S]*?\.community-hub-page textarea \{[^}]*font-family: var\(--community-control-font\);[^}]*font-size: 14px;/);
  assert.match(baseline, /\.community-hub-page select \{[^}]*appearance: none;[^}]*background-image:/s);
  assert.match(baseline, /\.community-hub-page :is\([^}]*\) label \{[^}]*font-size: 12px;/s);
  assert.match(baseline, /\.community-hub-page \.community-project-detail__body > div > p,[\s\S]*?font-size: 14px;/);
  assert.match(baseline, /@container \(max-width: 600px\) \{[\s\S]*?\.community-hub-page \.community-hub-nav button \{[^}]*font-size: 12px;/);
});

test('community home spacing stays compact and a lone project uses the full row', async () => {
  const styles = await fs.readFile('packages/platform-client/src/styles.css', 'utf8');
  assert.match(styles, /\.community-hub-hero\{min-height:124px;[^}]*padding:20px 24px;/);
  assert.match(styles, /\.community-hub-toolbar\{[^}]*margin:12px 0 20px;/);
  assert.match(styles, /\.community-card,\.community-editor,\.community-members \{ padding:20px;/);
  assert.match(styles, /\.community-blocks \{ margin:14px 0 18px;[^}]*gap:10px;/);
  assert.match(styles, /\.community-dashboard__intro\{margin-bottom:0;padding:22px;/);
  assert.match(styles, /\.community-dashboard__section\{margin-top:24px\}/);
  assert.match(styles, /\.community-dashboard__heading\{margin-bottom:12px;[^}]*padding-bottom:8px/);
  assert.match(styles, /@container\(min-width:761px\)\{\.community-dashboard__projects>button:only-child\{grid-column:1\/-1;/);
});

test('player routes preserve share links and community room entry after integration', async () => {
  const source = await fs.readFile('packages/platform-client/src/App.jsx', 'utf8');
  assert.match(source, /releaseId=\{\['challenge','share','room'\]\.includes\(parts\[2\]\)/);
  assert.match(source, /initialRoomId=\{parts\[2\] === 'room' \? parts\[3\] : parts\[3\] === 'room' \? parts\[4\] : null\}/);
  assert.match(source, /initialShareCode=\{parts\[2\] === 'share' \? parts\[3\] : null\}/);
});

test('API client refreshes an expired access token once and updates host memory', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let access = 'expired-access'; let saved; const requests = [];
  const client = createApiClient({
    getAccessToken: () => access, getRefreshToken: () => 'valid-refresh',
    setTokens: tokens => { saved = tokens; access = tokens.accessToken; },
    fetchImpl: async (url, init) => {
      requests.push({ url, authorization: init.headers.Authorization });
      if (url.endsWith('/v1/auth/refresh')) return new Response(JSON.stringify({ data: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (init.headers.Authorization === 'Bearer expired-access') return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual((await client.listCreatorWorks()).data, []);
  assert.equal(saved.accessToken, 'fresh-access');
  assert.equal(requests.length, 3);
  assert.equal(requests[2].authorization, 'Bearer fresh-access');
});

test('API client shares one refresh across concurrent expired requests', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let access = 'expired-access'; let refresh = 'single-use-refresh'; let refreshCalls = 0;
  const client = createApiClient({
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    setTokens: tokens => { access = tokens.accessToken; refresh = tokens.refreshToken; },
    fetchImpl: async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response(JSON.stringify({ data: { accessToken: 'fresh-access', refreshToken: 'rotated-refresh' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (init.headers.Authorization === 'Bearer expired-access') {
        return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const [works, connections, profile] = await Promise.all([
    client.listCreatorWorks(),
    client.listGitHubSourceConnections(),
    client.getProfile(),
  ]);
  assert.deepEqual(works.data, []);
  assert.deepEqual(connections.data, []);
  assert.deepEqual(profile.data, []);
  assert.equal(refreshCalls, 1);
  assert.equal(access, 'fresh-access');
  assert.equal(refresh, 'rotated-refresh');
});
