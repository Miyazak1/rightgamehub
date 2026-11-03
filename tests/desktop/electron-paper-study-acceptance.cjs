const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');
const { capturePaperWindow } = require('./paper-window-capture.cjs');
const { paperStatusSource } = require('./paper-study-window-state.cjs');
process.argv[1] = '--paper-study-acceptance';
const { createShell } = require('../../apps/desktop/electron/main.cjs');
let window, backend, config, phase = 'startup';
const captures = [];
const capture = async label => { phase = `capture:${label}`; const png = await capturePaperWindow(window, label, { onAttempt: value => { captures.push(value); console.log(JSON.stringify({ capture: value })); } }); await fs.writeFile(path.join(config.profileRoot, label + '.png'), png); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  if (!path.resolve(config.profileRoot).includes(path.sep + '.runtime' + path.sep + 'paper-study' + path.sep)) throw Error('ISOLATED_PAPER_PROFILE_REQUIRED');
  const { createPaperStudyApiFixture } = await import(pathToFileURL(path.resolve(__dirname, 'paper-study-api-fixture.mjs')).href);
  if (config.live || config.resume) {
    const endpoint = new URL(config.accountApiOrigin);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !path.resolve(config.otpFile).startsWith(path.dirname(config.profileRoot) + path.sep)) throw Error('PAPER_LIVE_ISOLATION_REQUIRED');
  } else backend = await createPaperStudyApiFixture();
  const shell = await createShell({ assetRoot: config.assetRoot, profileRoot: config.profileRoot, accountApiOrigin: backend?.origin ?? config.accountApiOrigin, accountEnvironment: 'local-test', visible: true });
  window = await shell.createWindow('/tools/paper-study?lang=zh-CN'); window.setTitle('墨鱼工坊 · 论文研读本地验收');
  const js = value => window.webContents.executeJavaScript(value, true);
  const wait = async (source, label) => { const until = Date.now() + (config.live ? 30*60_000 : 90000); while (!await js(source)) {
    const error = await js("document.querySelector('.paper-study__work .form-error,.paper-study > .form-error')?.textContent");
    if (error) throw Error('PAPER_UI_GATE_STOPPED: ' + error);
    if (Date.now() > until) throw Error('PAPER_UI_TIMEOUT: ' + label); await sleep(config.live ? 250 : 100);
  } };
  const click = text => js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('BUTTON_NOT_FOUND');b.click();})()`);
  const fill = value => js(`(()=>{const e=document.querySelector('.account-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("document.body.innerText.includes('用你的账号管理私有论文')", 'anonymous tool');
  await click('前往登录'); await wait("!!document.querySelector('.account-form')", 'login form');
  await fill('paper-study@example.test'); await js("document.querySelector('.account-form').requestSubmit()");
  await wait("!!document.querySelector('.account-form input[inputmode=numeric]')", 'OTP form');
  await fill(config.live || config.resume ? (await fs.readFile(config.otpFile, 'utf8')).trim() : backend.code()); await js("document.querySelector('.account-form').requestSubmit()");
  await wait("!!document.querySelector('.account-summary')", 'signed-in account');
  await window.loadURL('mooyu-app://client/tools?lang=zh-CN'); await wait("document.body.innerText.includes('论文研读')", 'tools catalog');
  await js("[...document.querySelectorAll('.tool-card')].find(c=>c.textContent.includes('论文研读')).querySelector('button').click()");
  await wait("!!document.querySelector('[data-paper-file]')", 'paper workspace');
  if (config.resume) {
    phase = 'restore-saved-draft';
    await wait("!!document.querySelector('.paper-study__library nav button')", 'saved paper library');
    await js("document.querySelector('.paper-study__library nav button').click()");
    await wait(paperStatusSource('私有待审稿已保存') + " && !!document.querySelector('.paper-study canvas')?.width", 'saved draft and original PDF');
    await js("document.querySelector('#paper-tab-draft').click()");
    await wait("!!document.querySelector('.paper-study__draft')", 'saved draft visible');
    const paragraphs = await js("[...document.querySelectorAll('.paper-study__draft section')].map(s=>s.innerText)");
    config.savedBlocks.forEach((b,i) => { if(b.text) assert.ok(paragraphs[i].includes(b.text)); });
  } else {
  const bytes = await fs.readFile(config.pdf);
  await js(`(()=>{const f=new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))],'1706.03762v7.pdf',{type:'application/pdf'});const d=new DataTransfer();d.items.add(f);const e=document.querySelector('[data-paper-file]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.paper-study__check input').click();})()`);
  if(config.live)await js("(()=>{const e=document.querySelector('input[placeholder=\"1706.03762v7\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1706.03762v7');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await js("document.querySelector('.paper-study__library form').requestSubmit()");
  await wait("!!document.querySelector('.paper-study canvas')?.width && document.body.innerText.includes('可开始分析')", 'actual PDF imported and rendered');
  const initialWidth=await js("document.querySelector('.paper-study canvas').width");
  await js("document.querySelector('[aria-label=放大原文]').click()");
  await wait(`document.querySelector('.paper-study canvas').width>${initialWidth}`, 'PDF zoom');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth + 1'),true);
  await js("document.querySelector('[aria-label=缩小原文]').click()");
  if(backend)assert.equal((await backend.service.list({userId:'31e033b2-13d6-4b81-b214-21b3f25dca60'}))[0].pageCount, 15);
  await click('分析论文'); await wait(paperStatusSource('分析已完成'), 'validated analysis');
  await js("document.querySelector('.paper-study__finding .paper-study__citation').click()");
  await wait("!!document.querySelector('.paper-study__evidence blockquote')", 'analysis evidence selected');
  assert.ok((await js("document.querySelector('.paper-study__evidence blockquote').textContent")).length > 30);
  await click('生成私有待审稿'); await wait(paperStatusSource('私有待审稿已保存'), 'private draft persisted');
  }
  await capture('draft');
  await fs.writeFile(path.join(config.profileRoot,'draft-visible.txt'),await js("document.querySelector('.paper-study__draft').innerText"));
  assert.equal(await js("!!document.querySelector('.paper-study__draft .paper-study__citation')"), true);
  phase = 'draft-evidence-navigation';
  if (config.resume) {
    assert.equal(await js("document.querySelectorAll('.paper-study__draft .paper-study__citation').length"), config.evidenceTargets.length);
    for (const [i, target] of config.evidenceTargets.entries()) {
      await js("document.querySelector('#paper-tab-draft').click()");
      await wait("!!document.querySelector('.paper-study__draft')", 'draft for next evidence');
      await js(`document.querySelectorAll('.paper-study__draft .paper-study__citation')[${i}].click()`);
      await wait(`document.querySelector('#paper-tab-original').getAttribute('aria-selected')==='true' && document.querySelector('.paper-study canvas')?.getAttribute('aria-label')===${JSON.stringify('原文第 ')}+${target.page}+${JSON.stringify(' 页')}`, 'exact evidence page');
      assert.equal(await js("document.querySelector('.paper-study__evidence blockquote').textContent"), target.quote);
      assert.ok(await js("document.querySelector('.paper-study canvas').width > 0"));
    }
  } else await js("document.querySelector('.paper-study__draft .paper-study__citation').click()");
  await wait("document.querySelector('#paper-tab-original').getAttribute('aria-selected')==='true'", 'draft source page navigation');
  await capture('wide');
  phase = 'narrow-layout'; window.setSize(720, 850); await sleep(350);
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth + 1'),true);
  await capture('narrow');
  if(backend){const before = backend.service.list({userId:'31e033b2-13d6-4b81-b214-21b3f25dca60'})[0];
    assert.equal(before.draft.publicationState,'draft'); assert.equal(before.draft.publicPublicationEnabled,false);}
  phase = 'reload-restoration';
  await window.loadURL('mooyu-app://client/tools/paper-study?lang=zh-CN');
  await wait("!!document.querySelector('.paper-study__library nav button')",'library restored after reload');
  await js("document.querySelector('.paper-study__library nav button').click()");
  await wait(paperStatusSource('私有待审稿已保存'),'saved draft reopened');
  if(config.resume) {
    await js("document.querySelector('#paper-tab-draft').click()");
    await wait("!!document.querySelector('.paper-study__draft')", 'restored draft visible');
    assert.equal(await js("document.querySelector('.paper-study__draft').innerText"), await fs.readFile(path.join(config.profileRoot,'draft-visible.txt'),'utf8'));
  }
  phase = 'logout-cleanup';
  await js("window.mooyuDesktop.account.call('logout',[])");
  await wait("!document.querySelector('.paper-study__draft,.paper-study__finding,.paper-study__evidence blockquote,[data-paper-file]')", 'logout clears existing view');
  await window.loadURL('mooyu-app://client/tools/paper-study?lang=zh-CN');
  await wait("document.body.innerText.includes('用你的账号管理私有论文')", 'signed-out tool');
  assert.equal(await js("!!document.querySelector('.paper-study__draft,.paper-study__finding,.paper-study__evidence blockquote,[data-paper-file]')"),false);
  const checks = config.resume ? ['anonymous sign-in gate','shared Tools catalog entry','same verified saved draft and original PDF loaded without processing',
    'all saved paragraph evidence links select the exact quote and source page','draft, wide and narrow screenshots captured',
    'narrow layout without horizontal overflow','identical saved draft restored after reload',
    'logout clears private surfaces before reload and remains anonymous after reload']
    : ['anonymous sign-in gate','shared Tools catalog entry','real 15-page PDF import, canvas reading and bounded zoom',config.live?'real model analysis through the full pipeline':'owner-scoped recorded analysis through the full pipeline','evidence-to-page navigation','full quality-gated private draft','draft paragraph source navigation','narrow layout without horizontal overflow','same-account library and draft restored after reload','logout removes private document, upload and evidence surfaces'];
  await fs.writeFile(config.result,JSON.stringify({passed:true,captureAttempts:captures,modelCalls:config.resume?0:undefined,savedDraftReused:!!config.resume,checks,productionConnected:false,modelInvoked:!!config.live,mode:config.resume?'isolated-saved-draft':config.live?'isolated-live':'isolated-replay',published:false},null,2));
  window.destroy(); await backend?.close(); app.quit();
}
run().catch(async e => { console.error(phase, e.stack); if(config){if(window&&!window.isDestroyed())await fs.writeFile(path.join(config.profileRoot,'failure.png'),await capturePaperWindow(window, 'failure')).catch(()=>{});await fs.writeFile(config.result,JSON.stringify({passed:false,phase,error:e.stack,captureAttempts:captures}));}window?.destroy();await backend?.close();app.exit(1); });
