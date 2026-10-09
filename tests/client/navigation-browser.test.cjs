const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const root = path.resolve(__dirname, '../..'), playwrightPath = process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;

test('navigation: roles, account menu keyboard/focus, creator routes, mobile and live permission changes', { skip: !playwrightPath, timeout: 90000 }, async t => {
  const { chromium } = require(playwrightPath), { build } = require('../../extensions/harness/node_modules/esbuild');
  const { createModerationService } = await import('../../apps/api/src/moderation-service.mjs');
  const moderation = createModerationService({ repository: { listReports: async () => [] } });
  const app = require('../../apps/api/node_modules/fastify')();
  let browser, page, identity = 'guest', visit = 0;
  const out = path.join(root, '.runtime/navigation-acceptance'); await fs.mkdir(out, { recursive: true });
  t.after(async () => { if (page) await page.screenshot({ path: path.join(out, 'last.png'), fullPage: true }); await browser?.close(); await app.close(); });
  const profiles = Object.fromEntries(['player','creator','admin'].map(role => [role, { id: role, displayName: role === 'player' ? '这是一位拥有很长显示名称的普通玩家' : role === 'creator' ? '测试创作者' : '测试管理员', role: role === 'admin' ? 'admin' : 'user', canPublish: role !== 'player', createdAt: '2026-10-01T00:00:00Z', avatar: { kind: 'preset', presetKey: 'cat' }, linkedAccounts: [] }]));
  const workId = '0d4748b7-2ac5-4a5c-847b-80505a21a7f1';
  const work = { id: workId, title: '纸飞机竞速', description: '越过障碍抵达终点。', instructions: '方向键操作。', estimatedMinutes: 5, tags: [], kind: 'game', state: 'draft', visibility: 'private', revision: '7', targets: [] };
  app.setErrorHandler((error, request, reply) => reply.code(error.statusCode || 500).send({ error: { code: error.code, message: error.message } }));
  // This endpoint calls the actual service authorization, independently of the menu.
  app.get('/v1/admin/reports', async () => ({ data: await moderation.list(identity === 'guest' ? null : { userId: identity, profile: profiles[identity] }, {}) }));
  app.get('/v1/*', async (req, reply) => {
    const url = req.url.split('?')[0], profile = profiles[identity];
    if (url === '/v1/me') return profile ? { data: profile } : reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } });
    if (url.startsWith('/v1/creator/') && !profile?.canPublish) return reply.code(profile ? 403 : 401).send({ error: { code: profile ? 'CREATOR_REQUIRED' : 'AUTH_REQUIRED' } });
    if (url.startsWith('/v1/admin/') && profile?.role !== 'admin') return reply.code(403).send({ error: { code: 'ADMIN_REQUIRED' } });
    if (url === '/v1/creator/works') return { data: [work] };
    if (url === '/v1/me/creator-application') return { data: { application: null } };
    if (url.endsWith('/analytics')) return { data: { totals: {}, daily: [], works: [], hosts: [] } };
    if (url === '/v1/contribution-notifications') return { data: { items: [], unreadCount: 0 } };
    if (['/v1/admin/storage','/v1/admin/source-imports/overview','/v1/admin/games/guess-baike/automation'].includes(url)) return { data: null };
    return { data: [] };
  });
  app.post('/v1/analytics/events', async () => ({ data: { accepted: 1 } }));
  const entry = [
    "import React from 'react';import{createRoot}from'react-dom/client';",
    'import App from ' + JSON.stringify(path.join(root, 'packages/platform-client/src/App.jsx').replaceAll('\\','/')) + ';',
    'import{createApiClient}from' + JSON.stringify(path.join(root, 'packages/platform-api-client/src/index.mjs').replaceAll('\\','/')) + ';',
    "const root=createRoot(document.getElementById('root'));window.refreshIdentity=()=>root.render(<React.StrictMode><App apiClient={createApiClient({getAccessToken:()=> 'fixture'})} demo={false} routing={new URLSearchParams(location.search).get('routing')==='memory'?'memory':'hash'}/></React.StrictMode>);window.refreshIdentity();",
  ].join('\n');
  const bundle = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife', nodePaths: [path.join(root, 'packages/platform-client/node_modules')], loader: { '.png': 'dataurl' }, define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' });
  const css = await fs.readFile(path.join(root, 'packages/platform-client/src/styles.css'), 'utf8');
  app.get('/', async (req, reply) => reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js', async (req, reply) => reply.type('text/javascript').send(bundle.outputFiles[0].text));
  await app.listen({ host: '127.0.0.1', port: 0 }); const base = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const menu = page.getByRole('menu', { name: '账号操作' }), avatar = page.getByRole('button', { name: '账号菜单', exact: true });
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
  const goAs = async (role, route = '/discover') => { identity = role; await page.goto(base + '/?visit=' + (++visit) + '#' + route); await page.getByRole('button', { name: role === 'guest' ? '登录' : '账号菜单', exact: true }).waitFor(); };
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const rects = await page.locator('.header button:visible,.header .host-chip:visible').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right }; }));
    for (const r of rects) assert.ok(r.left >= -1 && r.right <= page.viewportSize().width + 1, 'header clipped: ' + JSON.stringify(r));
    for (let i = 1; i < rects.length; i++) assert.ok(rects[i].left >= rects[i-1].right - 1, 'header controls overlap');
  };
  await goAs('guest');
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  assert.deepEqual(await nav.getByRole('button').allTextContents(), ['✦发现','✣分享','↗共建','▣游戏库']);
  assert.equal(await nav.getByRole('button', { name: /添加到 Agent|创作|治理/ }).count(), 0);
  assert.equal(await page.locator('.header__tools').getByRole('button', { name: /添加到 Agent/ }).count(), 1);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '登录或创建账号' }).waitFor();
  await goAs('player'); await avatar.focus(); await page.keyboard.press('Enter');
  assert.equal(await focused(), '账号与设置');
  assert.equal(await menu.getByRole('menuitem', { name: '创作中心', exact: true }).count(), 0);
  assert.equal(await menu.getByRole('menuitem', { name: '治理', exact: true }).count(), 0);
  await page.keyboard.press('ArrowUp'); assert.equal(await focused(), '申请成为创作者');
  await page.keyboard.press('Home'); assert.equal(await focused(), '账号与设置');
  await page.keyboard.press('End'); assert.equal(await focused(), '申请成为创作者');
  await page.keyboard.press('ArrowDown'); assert.equal(await focused(), '账号与设置');
  await page.keyboard.press('Escape'); assert.equal(await menu.count(), 0); assert.equal(await avatar.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowUp'); assert.equal(await focused(), '申请成为创作者');
  await page.keyboard.press('Shift+Tab'); assert.equal(await menu.count(), 0); assert.equal(await avatar.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
  assert.equal(await menu.count(), 0); assert.equal(await page.evaluate(() => document.activeElement === document.body), false);
  await avatar.click(); await avatar.click(); assert.equal(await menu.count(), 0, 'clicking the avatar twice closes the menu');
  await avatar.focus(); await page.keyboard.press('Space'); await menu.waitFor(); await page.keyboard.press('Escape');
  await avatar.click(); await page.getByRole('heading', { name: '休息一下？' }).click(); assert.equal(await menu.count(), 0);
  await avatar.click(); await menu.getByRole('menuitem', { name: '申请成为创作者' }).click();
  await page.getByRole('heading', { name: '申请成为创作者' }).waitFor(); assert.equal(await page.getByRole('navigation', { name: '创作中心导航' }).count(), 0);
  await goAs('player', '/admin'); await page.getByRole('heading', { name: '仅管理员可访问' }).waitFor();
  assert.equal((await page.request.get(base + '/v1/admin/reports')).status(), 403);
  await goAs('creator'); await avatar.click(); await menu.getByRole('menuitem', { name: '创作中心', exact: true }).click();
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor();
  const workspace = page.getByRole('navigation', { name: '创作中心导航' });
  assert.deepEqual(await workspace.getByRole('link').allTextContents(), ['我的作品','上传发布','GitHub 导入','AI 接入联机','AI 接入排行榜']);
  assert.equal(await page.getByRole('navigation', { name: /主导航|侧栏导航/ }).count(), 0);
  await page.getByRole('heading', { name: '作者数据', exact: true }).waitFor(); await page.getByRole('heading', { name: '玩家反馈' }).waitFor();
  await workspace.getByRole('link', { name: '上传发布' }).click(); await page.getByRole('heading', { name: '新建作品' }).waitFor();
  await workspace.getByRole('link', { name: 'AI 接入排行榜' }).click(); await page.getByRole('heading', { name: '让 AI 添加排行榜' }).waitFor();
  assert.equal(await workspace.getByRole('link', { name: 'AI 接入排行榜' }).getAttribute('aria-current'), 'page');
  await page.goto(base + '/#/creator/works/' + workId + '/ai/multiplayer'); await page.getByLabel('选择作品', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('选择作品', { exact: true }).inputValue(), workId);
  assert.equal(await workspace.getByRole('link', { name: 'AI 接入联机' }).getAttribute('aria-current'), 'page');
  await page.goto(base + '/#/creator/multiplayer/docs'); await page.getByRole('heading', { name: '联网游戏开发者中心', exact: true }).waitFor();
  await page.getByRole('button', { name: /返回 GameHub/ }).click(); await page.getByRole('heading', { name: '休息一下？' }).waitFor();
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '游戏库', exact: true }).click(); assert.match(page.url(), /#\/library$/);
  await goAs('admin'); await avatar.click(); await menu.getByRole('menuitem', { name: '治理', exact: true }).click();
  await page.getByRole('heading', { name: '平台运营', exact: true }).waitFor(); assert.equal((await page.request.get(base + '/v1/admin/reports')).status(), 200);
  await goAs('admin'); await avatar.click(); identity = 'player'; await page.evaluate(() => window.refreshIdentity());
  await menu.waitFor({ state: 'hidden' }); await avatar.waitFor(); assert.equal(await menu.count(), 0); await avatar.click(); await menu.getByRole('menuitem', { name: '申请成为创作者' }).waitFor(); assert.equal(await menu.getByRole('menuitem', { name: '治理', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  for (const width of [320,360,480,768,960,1024,1365]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow();
    const activeNav = page.getByRole('navigation', { name: width <= 1000 ? '侧栏导航' : '主导航', exact: true });
    assert.equal(await activeNav.getByRole('button', { name: '游戏库', exact: true }).isVisible(), true);
    await activeNav.getByRole('button', { name: '游戏库', exact: true }).click(); assert.match(page.url(), /#\/library$/);
    await avatar.click(); const box = await page.locator('.account-menu__panel').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    if (width === 360 || width === 1365) await page.screenshot({ path: path.join(out, 'account-' + width + '.png') });
    await page.keyboard.press('Escape');
  }
  await goAs('creator', '/creator'); await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor();
  for (const width of [320,360,768,1365]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow();
    for (const link of await workspace.getByRole('link').all()) { const box = await link.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1); }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    if (width === 360 || width === 1365) await page.screenshot({ path: path.join(out, 'creator-' + width + '.png') });
  }
  // Agent webviews use memory routing; links must also work without a URL hash.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(base + '/?routing=memory'); await avatar.click();
  await menu.getByRole('menuitem', { name: '创作中心', exact: true }).click();
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor();
  await workspace.getByRole('link', { name: 'AI 接入排行榜' }).click();
  await page.getByRole('heading', { name: '让 AI 添加排行榜', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  await page.getByRole('button', { name: /返回 GameHub/ }).click();
  await page.getByRole('navigation', { name: '侧栏导航' }).getByRole('button', { name: '游戏库', exact: true }).click();
  await page.getByRole('heading', { name: '游戏库', exact: true }).waitFor(); await noOverflow();
  assert.deepEqual(errors, []);
});
