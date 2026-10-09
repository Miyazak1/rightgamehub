const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const root = path.resolve(__dirname, '../..'), playwrightPath = process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;

test('Creator AI browser: contextual routes, copy and download, stale requests, retries and narrow layout', { skip: !playwrightPath, timeout: 90000 }, async t => {
  const { chromium } = require(playwrightPath), { build } = require('../../extensions/harness/node_modules/esbuild');
  const app = require('../../apps/api/node_modules/fastify')();
  let browser, page, releaseSlow;
  const out = path.join(root, '.runtime/creator-ai-acceptance'); await fs.mkdir(out, { recursive: true });
  t.after(async () => { releaseSlow?.(); if (page) await page.screenshot({ path: path.join(out, 'last.png'), fullPage: true }); await browser?.close(); await app.close(); });
  const first = '0d4748b7-2ac5-4a5c-847b-80505a21a7f1', second = '1d4748b7-2ac5-4a5c-847b-80505a21a7f2';
  const works = [
    { id: first, title: '纸飞机竞速', description: '越过障碍抵达终点。', kind: 'game', state: 'published', visibility: 'public', revision: '7', targets: [{ targetKey: 'web', state: 'published', currentReleaseId: 'live-first' }] },
    { id: second, title: '方格对战', description: '轮流移动棋子。', kind: 'game', state: 'draft', visibility: 'private', revision: '2', targets: [] },
  ];
  let listState = 'ready', failRelease = false, slowSecond = false;
  const requests = [];
  app.addHook('onRequest', async req => requests.push({ method: req.method, url: req.url }));
  app.get('/v1/me', async () => ({ data: { id: 'owner', canPublish: true, displayName: '测试作者', role: 'user', avatar: { kind: 'preset', presetKey: 'cat' } } }));
  app.post('/v1/analytics/events', async () => ({ data: { accepted: 1 } }));
  app.get('/v1/creator/works', async (req, reply) => listState === 'auth' ? reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } }) : listState === 'error' ? reply.code(503).send({ error: { code: 'UNAVAILABLE' } }) : ({ data: listState === 'empty' ? [] : works }));
  app.get('/v1/creator/works/:id/releases', async (req, reply) => {
    if (failRelease) { failRelease = false; return reply.code(503).send({ error: { code: 'UNAVAILABLE' } }); }
    if (slowSecond && req.params.id === second) { slowSecond = false; await new Promise(resolve => { releaseSlow = resolve; }); }
    return { data: req.params.id === first ? [{ id: 'draft-first', targetKey: 'web', label: '2.0-draft', packageType: 'web_zip' }, { id: 'live-first', targetKey: 'web', label: '1.2.0', packageType: 'web_zip' }] : [] };
  });
  app.get('/v1/creator/feedback', async () => ({ data: [] }));
  app.get('/v1/creator/contribution-tasks', async () => ({ data: [] }));
  app.get('/v1/contribution-notifications', async () => ({ data: { items: [], unreadCount: 0 } }));
  const entry = [
    "import React from 'react';import{createRoot}from'react-dom/client';",
    'import App from ' + JSON.stringify(path.join(root, 'packages/platform-client/src/App.jsx').replaceAll('\\', '/')) + ';',
    'import{createApiClient}from' + JSON.stringify(path.join(root, 'packages/platform-api-client/src/index.mjs').replaceAll('\\', '/')) + ';',
    "const api=createApiClient({getAccessToken:()=> 'fixture-owner'});createRoot(document.getElementById('root')).render(<React.StrictMode><App apiClient={api} demo={false}/></React.StrictMode>);",
  ].join('\n');
  const bundle = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife', nodePaths: [path.join(root, 'packages/platform-client/node_modules')], loader: { '.png': 'dataurl' }, define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' });
  const css = await fs.readFile(path.join(root, 'packages/platform-client/src/styles.css'), 'utf8');
  app.get('/', async (req, reply) => reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js', async (req, reply) => reply.type('text/javascript').send(bundle.outputFiles[0].text));
  await app.listen({ host: '127.0.0.1', port: 0 }); const base = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1365, height: 1050 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.copied = []; window.clipboardFails = false; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (window.clipboardFails) throw Error('permission denied'); window.copied.push(text); } } }); });
  await page.goto(base + '/#/creator/works/' + first + '/ai/leaderboards');
  await page.getByLabel('什么时候计分，怎么算？').fill('通关成功后记录耗时毫秒，暂停时间不计入。');
  assert.equal(await page.getByLabel('选择作品', { exact: true }).inputValue(), first);
  await page.getByText('web · 1.2.0', { exact: true }).waitFor();
  await page.getByLabel('排名指标', { exact: true }).fill('通关用时');
  await page.getByLabel('怎样排在前面').selectOption('asc');
  await page.getByLabel('榜单周期').selectOption('daily');
  await page.getByRole('button', { name: '生成 AI 任务', exact: true }).click();
  await page.getByRole('button', { name: '复制中文任务说明', exact: true }).click();
  assert.match((await page.evaluate(() => window.copied))[0], /不得自动上传/);
  await page.getByText('给 AI 或工具使用的 JSON 任务包', { exact: true }).click();
  await page.getByRole('button', { name: '复制 JSON', exact: true }).click();
  const task = JSON.parse((await page.evaluate(() => window.copied)).at(-1));
  assert.equal(task.context.work.id, first); assert.equal(task.context.currentPublishedReleases[0].id, 'live-first');
  assert.equal(task.requirements.direction, 'asc'); assert.equal(task.requirements.period, 'daily'); assert.equal(task.executionPolicy.autoPublish, false);
  const pendingDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 JSON 任务包', exact: true }).click();
  const download = await pendingDownload; await download.saveAs(path.join(out, download.suggestedFilename()));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, download.suggestedFilename()), 'utf8')), task);
  await page.evaluate(() => { window.clipboardFails = true; });
  await page.getByRole('button', { name: '复制中文任务说明', exact: true }).click();
  await page.getByText(/无法自动复制，已选中文本/).waitFor();
  assert.equal(await page.getByLabel('中文 AI 任务说明').evaluate(el => el.selectionEnd - el.selectionStart), (await page.getByLabel('中文 AI 任务说明').inputValue()).length);
  await page.getByLabel('排名指标', { exact: true }).fill('用时');
  assert.equal(await page.getByLabel('中文 AI 任务说明').count(), 0, 'editing invalidates previously generated output');
  await page.getByRole('button', { name: '生成 AI 任务', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  slowSecond = true;
  const slowRequest = page.waitForRequest(req => req.url().includes(second + '/releases'));
  await page.getByLabel('选择作品', { exact: true }).selectOption(second); await slowRequest;
  assert.equal(await page.getByLabel('中文 AI 任务说明').count(), 0);
  await page.getByLabel('选择作品', { exact: true }).selectOption(first); await page.getByText('web · 1.2.0', { exact: true }).waitFor();
  const slowResponse = page.waitForResponse(response => response.url().includes(second + '/releases')); releaseSlow(); await slowResponse;
  assert.equal(await page.getByLabel('选择作品', { exact: true }).inputValue(), first);
  await page.getByText('web · 1.2.0', { exact: true }).waitFor();
  failRelease = true;
  await page.getByLabel('选择作品', { exact: true }).selectOption(second);
  await page.getByRole('button', { name: '重试读取版本', exact: true }).click();
  await page.getByText('尚无公开发布版本', { exact: true }).waitFor();
  await page.goto(base + '/#/creator/works/' + second + '/ai/multiplayer');
  await page.getByLabel('联机玩法', { exact: true }).fill('两个人轮流移动棋子，先到终点获胜。');
  await page.getByLabel('每局玩家人数').selectOption('2');
  await page.getByRole('button', { name: '生成 AI 任务', exact: true }).click();
  assert.match(await page.getByLabel('中文 AI 任务说明').inputValue(), /getPlayerView/);
  assert.doesNotMatch(await page.getByLabel('中文 AI 任务说明').inputValue(), /live-first/);
  await page.getByRole('button', { name: '高级：技术文档与官方模板 →', exact: true }).click();
  await page.getByRole('heading', { name: '联网游戏开发者中心', exact: true }).waitFor();
  await page.goto(base + '/#/creator');
  await page.getByRole('button', { name: /让 AI 添加排行榜/ }).click();
  await page.getByRole('heading', { name: '让 AI 添加排行榜', exact: true }).waitFor();
  listState = 'empty'; await page.reload(); await page.getByRole('heading', { name: '先创建一个作品', exact: true }).waitFor();
  listState = 'error'; await page.reload(); await page.getByRole('button', { name: '重试读取作品', exact: true }).waitFor(); listState = 'ready'; await page.getByRole('button', { name: '重试读取作品', exact: true }).click(); await page.getByLabel('选择作品', { exact: true }).waitFor();
  listState = 'auth'; await page.reload(); await page.getByRole('heading', { name: '登录后选择你的作品', exact: true }).waitFor();
  assert.equal(await page.getByLabel('中文 AI 任务说明').count(), 0);
  assert.deepEqual(requests.filter(req => req.method !== 'GET' && !req.url.startsWith('/v1/analytics/')), [], 'generating and copying tasks must not upload, publish or change platform data');
  assert.deepEqual(errors, []);
});
