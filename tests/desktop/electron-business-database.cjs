const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { createShell } = require('../../apps/desktop/electron/main.cjs');
const {capturePaperWindow}=require('./paper-window-capture.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let config, window;
const gameId = 'd7b00000-0000-4000-8000-000000000002', releaseId = 'd7b00000-0000-4000-8000-000000000003';
const js = source => window.webContents.executeJavaScript(source, true);
const paperPainted="(()=>{const c=document.querySelector('.paper-study canvas');if(!c||c.height<400)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=16)if(d[i+3]>0&&d[i]<180&&d[i+1]<180&&d[i+2]<180&&++n>40)return true;return false;})()";
async function wait(source, label) { const end = Date.now() + 25000; while (Date.now() < end) { if (await js(source)) return; await delay(100); } throw Error('Timed out: ' + label + '; text=' + (await js('document.body.innerText')).slice(-900)); }
async function route(value) { await window.loadURL('mooyu-app://client' + value + '?lang=zh-CN'); }
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function capture(name) { await fs.writeFile(path.join(path.dirname(config.report),name+'.png'),await capturePaperWindow(window,name));window.hide(); }
async function run() {
  config = JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--config') + 1], 'utf8'));
  if (!/^mooyu-business-check-\d+$/.test(config.project)) throw Error('LOCAL_TEST_PROJECT_REQUIRED');
  const shell = await createShell({ ...config, visible: false }); window = await shell.createWindow('/discover?lang=zh-CN');
  if (config.phase === 'initial') {
    await check('database-backed desktop discovery and real cover load without compatibility samples', async () => {
      await wait(`!!document.querySelector('[data-work-id="${gameId}"]')`, 'PostgreSQL catalog');
      await wait(`document.querySelector('[data-work-id="${gameId}"] img')?.naturalWidth === 960`, 'database cover');
      assert.equal(await js("document.body.innerText.includes('桌面兼容测试样本')"), false);
      await capture('postgres-discovery');
    });
    await check('database-backed journal, author and courseware are visible through shared pages', async () => {
      await route('/blog/desktop-business-fixture'); await wait("document.body.innerText.includes('验证完整业务链路')", 'journal');
      await route('/u/desktop-fixture-author'); await wait("document.querySelector('.public-profile-page') && document.body.innerText.includes('桌面隔离测试作者')", 'author');
      await route('/learn'); await wait("document.body.innerText.includes('隔离测试弹簧课件')", 'courseware');
    });
    await check('synthetic email login uses real PostgreSQL auth and private game library', async () => {
      await route('/account');
      await wait("!!document.querySelector('.account-form')", 'synthetic sign-in screen');
      let challenge;
      for (let attempt = 0; attempt < 14; attempt++) {
        challenge = await js("window.mooyuDesktop.account.call('createChallenge',[{email:'desktop-reader@example.test'}])");
        if (challenge.ok || challenge.error?.code !== 'RATE_LIMITED') break;
        if (!attempt) console.log('Waiting for the synthetic email resend window; rate limiting remains enabled.');
        await delay(5000);
      }
      assert.equal(challenge.ok, true, challenge.error?.code);
      const command = spawnSync('docker', ['--host', config.dockerEndpoint, 'compose', '-p', config.project, '--env-file', config.envFile,
        '-f', path.join(config.source, 'deploy/compose.desktop-business-test.yml'), 'exec', '-T', 'business-api', 'node', '-e',
        "console.log(require('fs').readFileSync('/data/desktop-business/test-mail.json','utf8'))"], { windowsHide: true, encoding: 'utf8' });
      assert.equal(command.status, 0, 'Could not read synthetic test mail');
      const code = JSON.parse(command.stdout).code;
      const result = await js(`window.mooyuDesktop.account.call('verifyChallenge',[${JSON.stringify({ challengeId: challenge.value.data.challengeId, code, deviceLabel: 'Local database desktop regression' })}])`);
      assert.equal(result.ok, true);
      await route('/works/' + gameId);
      await wait("!!document.querySelector('.detail-page')", 'work detail');
      const saved = await js(`window.mooyuDesktop.account.call('business',[{method:'saveToLibrary',args:['${gameId}']}])`); assert.equal(saved.ok, true);
      await route('/library'); await wait("document.body.innerText.includes('隔离测试计数游戏')", 'library');
    });
    await check('real Runtime Edge game runs in sandboxed release iframe and responds to input', async () => {
      await route('/play/' + gameId + '/' + releaseId);
      await wait("!!document.querySelector('iframe')", 'game iframe');
      const origin = 'http://r-' + releaseId.replaceAll('-', '') + '.localhost:' + config.businessRuntime.port;
      let frame;
      for (let i = 0; i < 80; i++) { frame = window.webContents.mainFrame.frames.find(f => f.url.startsWith(origin + '/')); if (frame && await frame.executeJavaScript("!!document.getElementById('increment') && document.getElementById('isolation')?.textContent.startsWith('Node: ')").catch(() => false)) break; await delay(100); }
      assert.ok(frame, 'Release frame missing');
      assert.ok(await frame.executeJavaScript("document.getElementById('isolation')?.textContent.startsWith('Node: ')"),'Fixture script must finish initialization before clicking');
      assert.equal(await frame.executeJavaScript("document.getElementById('score').textContent"), '0');
      await frame.executeJavaScript("document.getElementById('increment').click()");
      for(let i=0;i<50&&(await frame.executeJavaScript("document.getElementById('score').textContent"))!=='1';i++)await delay(100);
      assert.equal(await frame.executeJavaScript("document.getElementById('score').textContent"), '1');
      assert.equal(await frame.executeJavaScript("typeof require + ':' + typeof window.mooyuDesktop"), 'undefined:undefined');
      assert.equal(await frame.executeJavaScript("(()=>{try{void parent.localStorage;return false}catch{return true}})()"), true);
      assert.equal(await js("document.querySelector('iframe').getAttribute('sandbox')"), 'allow-scripts');
      assert.equal(await js(`fetch('http://unminted.localhost:${config.businessRuntime.port}/index.html').then(()=>false,()=>true)`), true);
      await capture('postgres-game');
    });
    if(config.paper)await check('PostgreSQL paper imports through desktop, renders real PDF and restores without model generation',async()=>{
      window.show();
      await route('/tools/paper-study');await wait("!!document.querySelector('[data-paper-file]')",'persistent paper workspace');
      const bytes=await fs.readFile(config.pdf);
      await js(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))],'paper.pdf',{type:'application/pdf'}));const e=document.querySelector('[data-paper-file]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.paper-study__check input').click();})()`);
      await js("document.querySelector('.paper-study__library form').requestSubmit()");
      await wait("document.querySelector('.paper-study canvas')?.height > 400 && document.body.innerText.includes('模型分析暂未启用')",'stored PDF canvas');
      await wait(paperPainted,'original PDF content painted');
      assert.equal(await js("document.querySelectorAll('.paper-study__library nav button').length"),1);
      assert.equal(await js("[...document.querySelectorAll('.paper-study__actions button')].every(b=>b.disabled)"),true);
      await js("[...document.querySelectorAll('.paper-study__pages button')].find(b=>b.textContent==='下一页').click()");
      await wait("document.querySelector('.paper-study__pages').innerText.includes('2 / 15')",'PDF page 2');
      await js("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");await wait(paperPainted,'page 2 content painted');
      await js("window.scrollTo(0,window.scrollY+document.querySelector('.paper-study__pages').getBoundingClientRect().top-90)");
      await capture('postgres-paper');
      window.show();
      await route('/tools/paper-study');await wait("!!document.querySelector('.paper-study__library nav button')",'restored paper list');
      await js("document.querySelector('.paper-study__library nav button').click()");await wait("document.querySelector('.paper-study canvas')?.height > 400",'restored original');
      await wait(paperPainted,'restored PDF painted');
    });
  } else {
    await check('full desktop restart restores DPAPI account and PostgreSQL library', async () => {
      await route('/account'); await wait("!!document.querySelector('.account-summary')", 'restored account');
      await route('/library'); await wait("document.body.innerText.includes('隔离测试计数游戏')", 'restored library');
      if(config.paper){window.show();await route('/tools/paper-study');await wait("!!document.querySelector('.paper-study__library nav button')",'paper after process restart');await js("document.querySelector('.paper-study__library nav button').click()");await wait(paperPainted,'PDF after process restart');}
    });
    await check('logout clears managed credentials and blocks private library access', async () => {
      assert.equal((await js("window.mooyuDesktop.account.call('logout',[])")).ok, true);
      await route('/library'); await wait("!!document.querySelector('.state-panel') || document.body.innerText.includes('登录')", 'signed out');
      const state = await js("window.mooyuDesktop.account.call('state',[])"); assert.equal(state.value.authenticated, false);
      const result = await js("window.mooyuDesktop.account.call('business',[{method:'listLibrary',args:[{}]}])"); assert.equal(result.ok, false); assert.equal(result.error.status, 401);
      if(config.paper){await route('/tools/paper-study');await wait("document.body.innerText.includes('用你的账号管理私有论文')",'paper cleared on logout');assert.equal(await js("!!document.querySelector('.paper-study__library')"),false);}
    });
  }
  await fs.writeFile(config.report, JSON.stringify({ verified: true, checks }, null, 2)); app.exit(0);
}
run().catch(async error => { console.error(error.stack); if (config) await fs.writeFile(config.report, JSON.stringify({ verified: false, checks, error: error.message }, null, 2)); app.exit(1); });
