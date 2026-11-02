const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { createShell } = require('../../apps/desktop/electron/main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let window, config;
const js = source => window.webContents.executeJavaScript(source, true);
async function wait(source, label) {
  const until = Date.now() + 18000;
  while (Date.now() < until) { if (await js(source)) return; await delay(100); }
  throw Error('Timed out: ' + label + '; text=' + (await js('document.body.innerText')).slice(-1200));
}
async function route(value) {
  await window.loadURL('mooyu-app://client' + value + '?lang=zh-CN');
  await wait("!!document.querySelector('main')", 'shared page');
}
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function capture(name) {
  window.show(); await delay(250);
  await fs.writeFile(path.join(path.dirname(config.report), name + '.png'), (await window.webContents.capturePage()).toPNG());
  window.hide();
}
async function run() {
  config = JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--config') + 1], 'utf8'));
  const shell = await createShell({ ...config, visible: false });
  window = await shell.createWindow('/discover?lang=zh-CN');
  if (config.phase === 'business') {
    await check('shared discovery uses server data and raster cover proxy, with no desktop sample', async () => {
      await wait("document.querySelectorAll('.discovery-game').length === 2", 'server catalog');
      assert.equal(await js("document.body.innerText.includes('桌面兼容测试样本')"), false);
      await wait("[...document.querySelectorAll('.discovery-game img')].every(i=>i.complete&&i.naturalWidth>0)", 'server cover');
      await capture('discovery');
    });
    await check('shared journal list and full article load from business API', async () => {
      await route('/blog'); await wait("document.body.innerText.includes('隔离服务日志')", 'journal list');
      await route('/blog/local-article'); await wait("document.body.innerText.includes('这段正文来自独立的本地 API。')", 'article');
    });
    await check('shared learning catalog combines shipped courseware with server courseware', async () => {
      await route('/learn'); await wait("document.body.innerText.includes('隔离服务课件')", 'server courseware');
    });
    await check('shared work detail and public author profile load from the same server', async () => {
      await route('/works/local-server-game'); await wait("document.querySelector('.detail-page h1')?.textContent === '隔离服务作品'", 'work detail');
      await route('/u/local-author'); await wait("document.querySelector('.public-profile-page') && document.body.innerText.includes('本地测试作者')", 'author profile');
    });
    await check('shared local tool catalog and PDF module remain available', async () => {
      await route('/tools'); await wait("!!document.querySelector('.tools-grid .tool-card')", 'tools');
      await js("[...document.querySelectorAll('.tool-card')].find(e=>/PDF/.test(e.innerText)).querySelector('button').click()");
      await wait("document.querySelector('.tool-host') && document.body.innerText.includes('PDF')", 'PDF module');
      await wait("!document.body.innerText.includes('正在加载工具')", 'PDF lazy load');
    });
  }
  // Fake email/OTP exists only in this local contract fixture. No real login UI
  // or third-party identity is automated by this acceptance driver.
  await route('/account');
  const challenge = await js("window.mooyuDesktop.account.call('createChallenge',[{email:'business@example.test'}])");
  const code = await fs.readFile(config.codeFile, 'utf8');
  const result = await js(`window.mooyuDesktop.account.call('verifyChallenge',[${JSON.stringify({ challengeId: challenge.value.data.challengeId, code })}])`);
  assert.equal(result.ok, true);
  if (config.phase === 'business') {
    await check('managed authenticated library writes and shared library page read the same server', async () => {
      await route('/works/local-server-game');
      await wait("[...document.querySelectorAll('.detail-actions button')].some(e=>e.innerText.includes('加入游戏库'))", 'save action');
      await js("[...document.querySelectorAll('.detail-actions button')].find(e=>e.innerText.includes('加入游戏库')).click()");
      await wait("[...document.querySelectorAll('.detail-actions button')].some(e=>e.innerText.includes('移出游戏库'))", 'saved action');
      await route('/library'); await wait("document.querySelector('.library-page') && document.body.innerText.includes('隔离服务作品')", 'saved library');
      await capture('library');
    });
    await check('renderer cannot directly fetch the API or publish via business IPC', async () => {
      assert.equal(await js(`fetch(${JSON.stringify(config.accountApiOrigin + '/v1/works')}).then(()=>false,()=>true)`), true);
      const denied = await js("window.mooyuDesktop.account.call('business',[{method:'publishBlogArticle',args:['x']}])");
      assert.equal(denied.ok, false);
    });
    await check('actual cancellation IPC stops a slow business request without blocking state or the next page', async () => {
      const result = await js(`(async()=>{
        const id=crypto.randomUUID();
        const pending=window.mooyuDesktop.account.call('business',[{method:'listWorks',args:[{q:'__slow__'}],requestId:id}]);
        await new Promise(r=>setTimeout(r,100));
        const cancel=await window.mooyuDesktop.account.call('cancelBusiness',[id]);
        const state=await window.mooyuDesktop.account.call('state',[]);
        const response=await pending;return {cancel,state,response};
      })()`);
      assert.equal(result.cancel.value.cancelled, true); assert.equal(result.state.value.authenticated, true);
      assert.equal(result.response.error.code, 'REQUEST_CANCELLED');
      await route('/discover'); await wait("document.querySelectorAll('.discovery-game').length === 2", 'page after cancellation');
    });
    await check('logout retires slow I/O and clears the visible private library without a navigation reload', async () => {
      await route('/library'); await wait("document.body.innerText.includes('隔离服务作品')", 'private library before logout');
      const result = await js(`(async()=>{
        const pending=window.mooyuDesktop.account.call('business',[{method:'listWorks',args:[{q:'__slow__'}],requestId:crypto.randomUUID()}]);
        await new Promise(r=>setTimeout(r,100));
        const exit=await window.mooyuDesktop.account.call('logout',[]);
        return {exit,response:await pending,state:await window.mooyuDesktop.account.call('state',[])};
      })()`);
      assert.equal(result.exit.ok, true); assert.equal(result.response.error.code, 'REQUEST_CANCELLED');
      assert.equal(result.state.value.authenticated, false);
      await wait("document.querySelector('.library-page') && !document.body.innerText.includes('隔离服务作品')", 'private content cleared');
    });
  } else {
    for (const pathname of ['/discover', '/blog', '/learn', '/library', '/u/local-author', '/works/local-server-game']) {
      await check('account-only server shows explicit capability error on ' + pathname, async () => {
        await route(pathname); await wait("document.body.innerText.includes('仅开放账号接口')", 'account-only explanation');
        assert.equal(await js("document.body.innerText.includes('桌面兼容测试样本')"), false);
        if (pathname === '/discover') {
          assert.equal(await js("document.querySelectorAll('.discovery-game').length"), 0);
          assert.equal(await js("document.body.innerText.includes('请检查网络后重试')"), false);
          await capture('account-only');
        }
      });
    }
  }
  await fs.writeFile(config.report, JSON.stringify({ verified: true, checks }, null, 2));
  app.exit(0);
}
run().catch(async error => {
  console.error(error.stack);
  if (config) await fs.writeFile(config.report, JSON.stringify({ verified: false, checks, error: error.message }, null, 2));
  app.exit(1);
});
