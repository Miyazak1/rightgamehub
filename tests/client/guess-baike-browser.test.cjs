const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const playwrightPath = process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
const browserPath = process.env.GAMEHUB_COMMUNITY_BROWSER_PATH;

test('Guess Baike keeps the primary interaction visible and survives restricted storage', { skip: !playwrightPath, timeout: 60000 }, async t => {
  const { chromium } = require(playwrightPath);
  const { build } = require('../../extensions/harness/node_modules/esbuild');
  const app = require('../../apps/api/node_modules/fastify')();
  let browser;
  t.after(async () => { await browser?.close(); await app.close(); });

  const puzzle = {
    id: 'fixture-coffee',
    title: '咖啡',
    aliases: [],
    category: '测试分类',
    content: '咖啡是一种经过烘焙和研磨的咖啡豆制作而成的饮料。咖啡豆来自咖啡属植物的种子。'.repeat(8),
    sourceUrl: 'https://zh.wikipedia.org/wiki/咖啡',
  };
  const bundle = await build({
    stdin: {
      contents: [
        "import React from 'react';import {createRoot} from 'react-dom/client';",
        'import GuessBaikeGame from ' + JSON.stringify(path.join(root, 'packages/platform-client/src/GuessBaikeGame.jsx').replaceAll('\\', '/')) + ';',
        'import {I18nProvider} from ' + JSON.stringify(path.join(root, 'packages/platform-client/src/I18n.jsx').replaceAll('\\', '/')) + ';',
        'const puzzle=' + JSON.stringify(puzzle) + ';',
        "const api={getGuessBaikeDaily:async()=>({data:{date:'2026-10-21',puzzle}}),saveGuessBaikeResult:async()=>({data:{saved:true}})};",
        "createRoot(document.getElementById('root')).render(<I18nProvider initialLocale='zh-CN'><GuessBaikeGame api={api}/></I18nProvider>);",
      ].join('\n'),
      loader: 'jsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    nodePaths: [path.join(root, 'packages/platform-client/node_modules')],
    logLevel: 'silent',
  });
  const css = await fs.readFile(path.join(root, 'packages/platform-client/src/styles.css'), 'utf8');
  const tokens = ':root{--gh-canvas:#0c0b11;--gh-panel:#15131d;--gh-raised:#1d1a28;--gh-primary:#f7f4ff;--gh-secondary:#aaa4b9;--gh-border:#343040;--gh-action:#9b6cff;--gh-onAction:#130d1e;--gh-success:#4fd49a;--gh-warning:#ffbd5b;--gh-danger:#ff6f87;--gh-glow:#8b5cf6}*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#0c0b11}.fixture{container-type:inline-size}.host-bar{height:74px}';
  app.get('/', async (req, reply) => reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + tokens + css + '</style><div class="host-bar"></div><div class="fixture" id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js', async (req, reply) => reply.type('text/javascript').send(bundle.outputFiles[0].text));
  await app.listen({ host: '127.0.0.1', port: 0 });

  browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); }; });
  await page.goto('http://127.0.0.1:' + app.server.address().port);
  await page.getByText('测试分类', { exact: true }).waitFor();

  for (const viewport of [{ width: 1280, height: 720 }, { width: 476, height: 672 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0, 0));
    const layout = await page.evaluate(() => {
      const input = document.querySelector('.guess-input-bar').getBoundingClientRect();
      const article = document.querySelector('.guess-document article');
      return { inputTop: input.top, inputBottom: input.bottom, viewportHeight: innerHeight, articleScrolls: article.scrollHeight > article.clientHeight };
    });
    assert.ok(layout.inputTop >= 0 && layout.inputBottom <= layout.viewportHeight, `guess input must be visible at ${viewport.width}x${viewport.height}`);
    if (viewport.width <= 500) assert.equal(layout.articleScrolls, true, 'the long article should scroll inside its panel on narrow screens');
  }

  const input = page.getByLabel('输入中文、英文或数字，也可直接猜标题', { exact: true });
  await input.fill('咖');
  await input.press('Enter');
  await page.getByText(/^命中 \d+ 处，揭开 1 个新字。$/).waitFor();
  assert.deepEqual(errors, []);
});
