// Executed by Electron, never imported into the product renderer or preload.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { app } = require('electron');
const { createShell } = require('../../apps/desktop/electron/main.cjs');
const root = path.resolve(__dirname, '../..');
const requireClient = createRequire(path.join(root, 'packages/platform-client/package.json'));
const checks = [], messages = [];
let window, config;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (source, userGesture = false) => window.webContents.executeJavaScript(source, userGesture);
async function waitFor(source, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await js(source)) return; await delay(100); }
  throw Error('Timed out: ' + label);
}
async function check(name, run) { await run(); checks.push(name); process.stdout.write('PASS ' + name + '\n'); }
async function load(route) {
  await window.loadURL('mooyu-app://client' + route);
  await waitFor("!!document.querySelector('.app[data-host=\"desktop-app\"]')", route);
}
async function upload(bytes, name) {
  await js(`(() => { const bytes=Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}),c=>c.charCodeAt(0)); const d=new DataTransfer();d.items.add(new File([bytes],${JSON.stringify(name)},{type:'application/pdf'})); const input=document.querySelector('input[type=file][accept*=pdf]'); input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function run() {
  const index = process.argv.indexOf('--config');
  config = JSON.parse(require('node:fs').readFileSync(process.argv[index + 1], 'utf8'));
  const phase = process.argv[process.argv.indexOf('--phase') + 1];
  const shell = await createShell({ ...config, visible: false });
  const savedWindow = shell.windowStateStore.read();
  window = await shell.createWindow('/discover?lang=en');
  window.webContents.on('console-message', event => { if (['warning', 'error'].includes(event.level) && messages.length < 30) messages.push(String(event.message).slice(0, 700)); });
  await waitFor("!!document.querySelector('.app[data-host=\"desktop-app\"]')", 'shared App ready');
  if (phase === 'restart') {
    await check('window bounds survive a full Electron process restart', async () => assert.deepEqual(window.getNormalBounds(), savedWindow.bounds));
    await check('localStorage survives a full Electron process restart', async () => assert.equal(await js("localStorage.getItem('mooyu.desktop.acceptance')"), 'stored-before-restart'));
    await check('IndexedDB survives a full Electron process restart', async () => assert.equal(await js("new Promise((resolve,reject)=>{const r=indexedDB.open('mooyu-desktop-acceptance',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('values').objectStore('values').get('key');q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)})"), 'persisted-value'));
  } else {
    await check('shared React navigation and Web design tokens render', async () => {
      assert.ok(await js("!!document.querySelector('.header .desktop-nav') && !!document.querySelector('.discovery-game[data-work-id=\"desktop-fixture-game\"]')"));
      assert.ok(await js("getComputedStyle(document.querySelector('.app')).getPropertyValue('--gh-action').trim().startsWith('#')"));
      assert.match(await js('document.body.innerText'), /本地样本/u);
    });
    await check('main renderer is sandboxed and exposes only environment and bounded chrome operations', async () => {
      assert.deepEqual(await js("({node:typeof require,process:typeof process,bridge:Object.keys(window.mooyuDesktop)})"), { node: 'undefined', process: 'undefined', bridge: ['environment', 'account', 'chrome'] });
      assert.equal((await js('window.mooyuDesktop.environment()')).connected, false);
      assert.equal(window.webContents.getLastWebPreferences().contextIsolation, true);
      assert.equal(window.webContents.getLastWebPreferences().sandbox, true);
      assert.equal(window.webContents.getLastWebPreferences().webSecurity, true);
    });
    await check('integrated titlebar reserves native buttons and removes duplicate browser entry points', async () => {
      assert.equal(await js('navigator.windowControlsOverlay.visible'), true);
      assert.equal(await js("Math.round(document.querySelector('.header--desktop').getBoundingClientRect().height)"), 64);
      assert.equal(await js("(()=>{const header=document.querySelector('.header--desktop').getBoundingClientRect();return [...document.querySelectorAll('.desktop-history,.brand-button,.desktop-nav,.header__tools')].every(el=>{const r=el.getBoundingClientRect();return r.top>=header.top && r.bottom<=header.bottom+1})})()"), true);
      assert.equal(await js("!!document.querySelector('.desktop-preview-banner,.header-agent-cta,.host-chip')"), false);
      assert.ok(await js("!!document.querySelector('[data-desktop-preview]') && !!document.querySelector('[data-desktop-menu]')"));
      assert.equal((await js('window.mooyuDesktop.chrome.state()')).closeBehavior, 'quit-preview');
      assert.equal((await js('window.mooyuDesktop.chrome.state()')).backgroundTasksSupported, false);
      assert.equal(await js("window.mooyuDesktop.chrome.action('open-file').then(()=>false,()=>true)"), true);
      assert.equal(await js("window.mooyuDesktop.chrome.theme('__proto__').then(()=>false,()=>true)"), true);
    });
    await check('desktop menu relocates integrations and supports keyboard dismissal', async () => {
      await js("document.querySelector('[data-desktop-menu]').click()");
      await waitFor("!!document.querySelector('.desktop-menu__panel')", 'desktop menu');
      assert.ok(await js("document.querySelector('.desktop-menu__panel').textContent.includes('Integrations and Agents')"));
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await waitFor("!document.querySelector('.desktop-menu__panel') && document.activeElement.matches('[data-desktop-menu]')", 'menu focus restore');
    });
    await check('three shared themes synchronize the native window overlay', async () => {
      const scrollColors = new Set();
      for (let i = 0; i < 3; i++) {
        const before = (await js('window.mooyuDesktop.chrome.state()')).theme;
        const next = { dark: 'light', light: 'high-contrast', 'high-contrast': 'dark' }[before];
        await js("document.querySelector('.header__tools > .icon-button').click()");
        await waitFor(`window.mooyuDesktop.chrome.state().then(s=>s.theme===${JSON.stringify(next)})`, 'native theme ' + next);
        assert.equal(await js("(()=>{const header=document.querySelector('.header--desktop'),r=header.getBoundingClientRect(),native=navigator.windowControlsOverlay.getTitlebarAreaRect();return native.bottom<=r.bottom-parseFloat(getComputedStyle(header).borderBottomWidth)})()"), true, 'native controls leave the full-width separator visible');
        scrollColors.add(await js("getComputedStyle(document.documentElement,'::-webkit-scrollbar-thumb').backgroundColor"));
      }
      assert.equal(scrollColors.size, 3, 'scrollbar follows all three shared themes');
    });
    await check('desktop navigation remains reachable without overlap across widths, languages and zoom levels', async () => {
      const before = window.getBounds();
      try {
        for (const lang of ['en', 'zh-CN']) {
          await load('/discover?lang=' + lang);
          for (const zoom of [1, 1.25, 1.5]) {
            window.webContents.setZoomFactor(zoom);
            for (const width of [1320, 1120, 1100, 1000, 960]) {
              window.setSize(width, 720); await delay(150);
              const layout = await js(`(()=>{
                const header=document.querySelector('.header--desktop'),h=header.getBoundingClientRect(),
                  native=navigator.windowControlsOverlay.getTitlebarAreaRect(),grip=document.querySelector('.desktop-title-grip'),
                  items=[...header.children].filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect());
                return { width:innerWidth, reachable:innerWidth<=1100 || !!document.querySelector('.desktop-nav').getClientRects().length,
                  aligned:items.every(r=>r.top>=h.top && r.bottom<=h.bottom+1 && r.right<=native.right+1),
                  ordered:items.every((r,i)=>!i || items[i-1].right<=r.left+1),
                  dragWidth:grip.getBoundingClientRect().width, drag:getComputedStyle(grip).getPropertyValue('app-region'),
                  overflow:document.scrollingElement.scrollWidth>innerWidth+1 };
              })()`);
              assert.ok(layout.reachable && layout.aligned && layout.ordered && !layout.overflow && layout.dragWidth>=32 && layout.drag==='drag', JSON.stringify({ lang, zoom, width, layout }));
              if (layout.width<=1100) {
                await js("document.querySelector('[data-desktop-menu]').click()", true);
                await waitFor("!!document.querySelector('.desktop-menu__panel')", 'compact navigation');
                assert.ok(await js("[...document.querySelectorAll('.desktop-menu-nav button')].filter(b=>b.getClientRects().length).length>=5"));
                assert.equal(await js("[...document.querySelectorAll('.desktop-menu-nav button')].every(b=>b.getBoundingClientRect().height>=36)"), true, 'compact navigation retains usable hit targets');
                assert.equal(await js("document.querySelector('.desktop-menu__panel').getBoundingClientRect().bottom<=innerHeight"), true, 'compact menu stays inside the window');
                assert.equal(await js("document.activeElement===document.querySelector('.desktop-menu-nav button')"), true);
                await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
                await waitFor("!document.querySelector('.desktop-menu__panel')", 'compact dismissal');
              }
            }
          }
        }
        await js("document.querySelector('[data-desktop-menu]').click()", true);
        await waitFor("!!document.querySelector('.desktop-menu-nav button')", 'menu navigation');
        await js("document.querySelectorAll('.desktop-menu-nav button')[3].click()", true);
        await waitFor("location.pathname==='/tools'", 'tools reachable from compact menu');
      } finally { window.webContents.setZoomFactor(1); window.setBounds(before); await load('/discover?lang=en'); }
    });
    await check('maximize and restore retain usable desktop chrome and normal bounds', async () => {
      const before=window.getNormalBounds();
      window.maximize();
      await waitFor('window.mooyuDesktop.chrome.state().then(s=>s.maximized)', 'maximized state');
      window.unmaximize();
      await waitFor('window.mooyuDesktop.chrome.state().then(s=>!s.maximized)', 'restored state');
      assert.deepEqual(window.getNormalBounds(), before);
      window.setBounds(before);
    });
    await check('desktop scrollbars stay narrow while wheel and keyboard scrolling still work', async () => {
      await load('/tools?lang=en');
      assert.equal(await js("getComputedStyle(document.documentElement,'::-webkit-scrollbar').width"), '8px');
      assert.equal(await js("getComputedStyle(document.documentElement,'::-webkit-scrollbar-button').display"), 'none');
      assert.ok(await js('document.scrollingElement.scrollHeight>innerHeight'));
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: 650, y: 450, deltaY: -350, deltaX: 0 });
      await waitFor('document.scrollingElement.scrollTop>0', 'wheel scroll with narrow scrollbar');
      await js('document.activeElement?.blur()');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home', modifiers: ['control'] });
      await waitFor('document.scrollingElement.scrollTop===0', 'keyboard scroll to top');
      await load('/discover?lang=en');
    });
    await check('external network is denied in the preview', async () => assert.equal(await js("fetch('https://mooyu.fun/v1/me').then(()=>false,()=>true)"), true));
    await check('shared navigation, history back and refresh retain routes', async () => {
      await js("[...document.querySelectorAll('.desktop-nav button')].find(b=>b.textContent.includes('Tools')).click()", true);
      await waitFor("location.pathname==='/tools' && !!document.querySelector('.tools-grid')", 'tools navigation');
      await waitFor("!document.querySelector('[data-desktop-back]').disabled", 'native back available');
      await js("document.querySelector('[data-desktop-back]').click()", true); await waitFor("location.pathname==='/discover'", 'native history back');
      await waitFor("!document.querySelector('[data-desktop-forward]').disabled", 'native forward available');
      await js("document.querySelector('[data-desktop-forward]').click()", true); await waitFor("location.pathname==='/tools'", 'native history forward');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt'] });
      await waitFor("location.pathname==='/discover'", 'Alt Left shortcut');
      await load('/tools/document-compare?lang=en');
      await waitFor("!!document.querySelector('.tool-host') && !document.querySelector('.tool-host__slot')", 'document tool');
      const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded;
      await waitFor("location.pathname==='/tools/document-compare' && !!document.querySelector('.app')", 'deep route refresh');
    });
    await check('learning, five tools and standalone radar mount in shared pages', async () => {
      for (const route of ['/learn', '/tools/knowledge-map', '/tools/privacy-redactor', '/tools/document-compare', '/tools/spreadsheet-audit', '/tools/pdf-reader', '/apps/change-radar']) {
        await load(route + '?lang=en');
        await waitFor("!!document.querySelector('main h1') && !document.querySelector('.tool-host__slot')", route);
        assert.ok((await js("document.querySelector('main h1').textContent")).trim());
      }
    });
    await check('actual PlayerCore iframe loads and handles game interaction without desktop privileges', async () => {
      await load('/play/desktop-fixture-game?lang=en');
      const deadline = Date.now() + 20000; let frame;
      while (Date.now() < deadline) { frame = window.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('http://127.0.0.1:')); if (frame && await frame.executeJavaScript("document.getElementById('isolation')?.textContent.includes('Node')")) break; await delay(100); }
      assert.ok(frame, 'sandboxed game frame');
      assert.equal(await frame.executeJavaScript("typeof require+':'+typeof process+':'+typeof window.mooyuDesktop"), 'undefined:undefined:undefined');
      assert.equal(await frame.executeJavaScript("(()=>{try{parent.document.body;return false}catch{return true}})()"), true);
      assert.equal(await frame.executeJavaScript("document.getElementById('increment').click(); document.getElementById('score').textContent"), '1');
      assert.equal(await js("document.querySelector('iframe').getAttribute('sandbox')"), 'allow-scripts');
    });
    await load('/tools/pdf-reader?lang=en');
    await waitFor("!!document.querySelector('input[type=file][accept*=pdf]')", 'PDF component');
    const { PDFDocument, StandardFonts } = requireClient('pdf-lib');
    await check('PDF.js Worker renders and extracts a real PDF through the shared component', async () => {
      const pdf = await PDFDocument.create(), page = pdf.addPage([640, 500]);
      page.drawText('Mooyu Desktop PDF Test', { x: 40, y: 380, size: 28, font: await pdf.embedFont(StandardFonts.Helvetica) });
      await upload(await pdf.save(), 'desktop-text.pdf');
      await waitFor("!!document.querySelector('.pdf-reader-canvas-wrap canvas') && document.body.innerText.includes('Mooyu Desktop PDF Test')", 'PDF render and text', 40000);
      assert.ok(await js("document.querySelector('.pdf-reader-canvas-wrap canvas').width>100"));
      assert.equal(await js("getComputedStyle(document.querySelector('.pdf-reader-canvas-wrap'),'::-webkit-scrollbar').width"), '8px');
    });
    await check('Tesseract Worker and WASM OCR a scanned PDF using local language assets', async () => {
      const png = await js("(()=>{const c=document.createElement('canvas');c.width=1400;c.height=400;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='bold 76px Arial';x.fillText('MOOYU OCR TEST 12345',45,210);return c.toDataURL('image/png').split(',')[1]})()");
      const pdf = await PDFDocument.create(), image = await pdf.embedPng(Buffer.from(png, 'base64'));
      pdf.addPage([1400, 400]).drawImage(image, { x: 0, y: 0, width: 1400, height: 400 });
      await upload(await pdf.save(), 'desktop-scanned.pdf');
      await waitFor("document.querySelector('.pdf-reader-toolbar__identity').textContent.includes('desktop-scanned') && !!document.querySelector('.pdf-reader-canvas-wrap canvas')", 'scanned PDF');
      await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Recognize page (ZH / EN)').click()");
      await waitFor("document.body.innerText.includes('MOOYU OCR TEST 12345')", 'actual OCR text', 150000);
    });
    if (config.paperFile) await check('existing 15-page arXiv PDF imports, renders and exposes text in the shared reader', async () => {
      assert.equal(path.isAbsolute(config.paperFile), true);
      assert.ok((await fs.stat(config.paperFile)).size < 16 * 1024 * 1024);
      await upload(await fs.readFile(config.paperFile), 'attention-real-paper.pdf');
      await waitFor("document.body.innerText.includes('15 pages') && document.body.innerText.includes('Attention Is All You Need') && !!document.querySelector('.pdf-reader-canvas-wrap canvas')", 'actual paper PDF', 60000);
      await fs.writeFile(config.report.replace(/\.json$/u, '-paper.png'), (await window.webContents.capturePage()).toPNG());
    });
    await check('localStorage and IndexedDB can store persistent values on the desktop origin', async () => {
      await js("localStorage.setItem('mooyu.desktop.acceptance','stored-before-restart')");
      assert.equal(await js("new Promise((resolve,reject)=>{const r=indexedDB.open('mooyu-desktop-acceptance',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>{const db=r.result;const tx=db.transaction('values','readwrite');tx.objectStore('values').put('persisted-value','key');tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)})"), true);
      await shell.session.flushStorageData();
    });
  }
  await load('/discover?lang=en');
  await waitFor("!document.body.innerText.includes('Loading account')", 'anonymous account settled');
  await fs.writeFile(config.report.replace(/\.json$/u, '-' + phase + '.png'), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(config.report, JSON.stringify({ ok: true, phase, checks, blockedRequests: shell.blockedRequests, messages, versions: process.versions }, null, 2));
  app.quit();
}
run().catch(async error => {
  // Compositor failures must not reject the failure reporter and hide the original error.
  const diagnostic = task => Promise.race([task.catch(() => null), delay(3000).then(() => null)]);
  let view = null;
  if (window && !window.isDestroyed()) {
    view = { text: (await diagnostic(js('document.body.innerText')))?.slice(-3500), frames: window.webContents.mainFrame.framesInSubtree.map(f => f.url), chrome: await diagnostic(js('window.mooyuDesktop.chrome.state()')), history: window.webContents.navigationHistory.getAllEntries().map(({ url }) => ({ url })), active: window.webContents.navigationHistory.getActiveIndex() };
    const screenshot = await diagnostic(window.webContents.capturePage());
    if (config?.report && screenshot) await fs.writeFile(config.report.replace(/\.json$/u, '-failed.png'), screenshot.toPNG());
  }
  const report = { ok: false, checks, error: error.message, messages, view };
  if (config?.report) await fs.writeFile(config.report, JSON.stringify(report, null, 2));
  process.stderr.write(JSON.stringify(report) + '\n'); app.exit(1);
});
