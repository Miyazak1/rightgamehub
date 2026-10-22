const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const playwrightPath = process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;

test('change radar renders an empty account and opens long-term news tracking without a URL', { skip: !playwrightPath, timeout: 90000 }, async t => {
  const { chromium } = require(playwrightPath);
  const { build } = require('../../extensions/harness/node_modules/esbuild');
  const app = require('../../apps/api/node_modules/fastify')();
  let browser;
  let page;
  const outputDirectory = path.join(root, '.runtime/change-radar-acceptance');
  await fs.mkdir(outputDirectory, { recursive: true });

  t.after(async () => {
    if (page) await page.screenshot({ path: path.join(outputDirectory, 'last.png'), fullPage: true });
    await browser?.close();
    await app.close();
  });

  const entry = [
    "import React from 'react';import{createRoot}from'react-dom/client';",
    'import ChangeRadarTool from ' + JSON.stringify(path.join(root, 'packages/platform-client/src/ChangeRadarTool.jsx').replaceAll('\\', '/')) + ';',
    'import{I18nProvider}from' + JSON.stringify(path.join(root, 'packages/platform-client/src/I18n.jsx').replaceAll('\\', '/')) + ';',
    "const empty=async()=>({data:[]});const api={listChangeWatches:empty,listChangeEvents:empty,listResearchTopics:empty,getResearchNewsSourceCatalog:async()=>({data:null})};",
    "const profile={id:'empty-account',displayName:'空账号测试用户',role:'user'};",
    "createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider initialLocale='zh-CN'><ChangeRadarTool api={api} accountProfile={profile} go={()=>{}}/></I18nProvider></React.StrictMode>);",
  ].join('\n');
  const bundle = await build({
    stdin: { contents: entry, loader: 'jsx', resolveDir: root },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    nodePaths: [path.join(root, 'packages/platform-client/node_modules')],
    loader: { '.png': 'dataurl' },
    define: { 'import.meta.env.DEV': 'false' },
    logLevel: 'silent',
  });
  const css = await fs.readFile(path.join(root, 'packages/platform-client/src/styles.css'), 'utf8');
  app.get('/', async (request, reply) => reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js', async (request, reply) => reply.type('text/javascript').send(bundle.outputFiles[0].text));
  await app.listen({ host: '127.0.0.1', port: 0 });

  const base = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(base + '/');
  await page.getByRole('heading', { name: '选择一个监控任务' }).waitFor();
  assert.equal(await page.getByText('还没有监控任务。', { exact: true }).count(), 1);

  await page.getByRole('button', { name: /长期新闻观察/ }).click();
  await page.getByRole('heading', { name: '新建新闻追踪', exact: true }).waitFor();
  assert.equal(await page.getByLabel('关注对象', { exact: true }).count(), 1);
  assert.equal(await page.locator('.change-radar__topic-form input[type="url"]').count(), 0, 'creating a news tracker must not require a URL');
  assert.equal(await page.locator('.change-radar__topic-form').isVisible(), true);
  assert.deepEqual(errors, []);
});
