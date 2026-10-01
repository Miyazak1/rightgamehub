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
  const client = createApiClient({ fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) });
  assert.deepEqual((await client.listWorks()).data, []);
});

test('API client submits analytics and reads the administrator overview', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = [];
  const client = createApiClient({ getAccessToken: () => 'analytics-token', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.trackAnalytics([{ type: 'page_view' }]);
  await client.getAdminAnalytics(30);
  await client.getAdminStorage();
  assert.deepEqual(requests.map(item => item.init.method), ['POST','GET','GET']);
  assert.match(requests[0].url, /\/v1\/analytics\/events$/);
  assert.match(requests[1].url, /\/v1\/admin\/analytics\?days=30$/);
  assert.match(requests[2].url, /\/v1\/admin\/storage$/);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer analytics-token'));
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
  assert.deepEqual(requests.map(item => item.init.method),['POST','GET','POST','POST','GET','POST']);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer rules-token'));
  assert.ok(requests[0].init.headers['Idempotency-Key']);
  assert.ok(requests[3].init.headers['Idempotency-Key']);
  assert.match(requests[4].url,/state=queue&limit=20$/u);
});

test('multiplayer rule UI states that approval is not execution, signing or deployment', async () => {
  const submission = await fs.readFile('packages/platform-client/src/MultiplayerRuleSubmissionPage.jsx','utf8');
  const review = await fs.readFile('packages/platform-client/src/MultiplayerRuleReviewQueue.jsx','utf8');
  assert.match(submission,/平台审核、受控构建、摘要确认和离线签名完成前，不会在 API 或 Realtime 中执行/);
  assert.match(submission,/提交不等于上线/);
  assert.match(review,/“批准构建”不会自动签名、部署或注册模式/);
  assert.match(review,/approve_for_build/);
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
