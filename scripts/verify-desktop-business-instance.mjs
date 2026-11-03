import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DESKTOP_BUSINESS_FIXTURE as f } from '../apps/api/src/desktop-business-test-seed.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const keep = process.argv.includes('--keep');
const paper = process.argv.includes('--paper');
if (process.argv.slice(2).some(arg => !['--keep','--paper'].includes(arg))) throw Error('Usage: verify-desktop-business-instance.mjs [--keep] [--paper]');
const clean = JSON.parse(await fs.readFile(path.join(root, '.runtime/desktop-auth-clean/latest.json'), 'utf8'));
if (!clean.passed) throw Error('Run the clean directory regression first');
const source = path.join(clean.directory, 'source');
const project = 'mooyu-business-check-' + Date.now();
const directory = path.join(root, '.runtime/desktop-business-test', project);
await fs.mkdir(directory, { recursive: true });
const freePort = async () => { const s = createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; };
const port = await freePort(); let runtimePort; do { runtimePort = await freePort(); } while (runtimePort === port);
const secret = crypto.randomBytes(32).toString('hex'), otp = crypto.randomBytes(32).toString('hex');
const envFile = path.join(directory, 'instance.env');
// Disposable local verification only. Deployment keeps its named PostgreSQL
// volume. Keep fsync enabled while avoiding Docker Desktop VHD commit latency.
const ephemeralDb=path.join(directory,'ephemeral-db.yml');
await fs.writeFile(ephemeralDb,'services:\n  business-postgres:\n    volumes: !override\n      - type: tmpfs\n        target: /var/lib/postgresql/data\n');
await fs.writeFile(envFile, `DESKTOP_BUSINESS_TEST_PORT=${port}\nDESKTOP_BUSINESS_TEST_RUNTIME_PORT=${runtimePort}\nDESKTOP_BUSINESS_TEST_DB_PASSWORD=${secret}\nDESKTOP_BUSINESS_TEST_OTP_HMAC_KEY=${otp}\n`, { mode: 0o600 });
let endpoint, started = false;
const dockerEnv = { ...process.env };
for (const key of Object.keys(dockerEnv)) if (key.startsWith('DESKTOP_BUSINESS_TEST_')) delete dockerEnv[key];
const redact = text => [secret, otp].reduce((s, value) => s.replaceAll(value, '[redacted]'), text);
async function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', endpoint ? ['--host', endpoint, ...args] : args, { cwd: source, env: dockerEnv, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Docker verification timed out')); }, 360000);
    child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Error(redact((err + out).slice(-5000)))); });
  });
}
const compose = (...args) => docker(['compose', '-p', project, '--env-file', envFile, '-f', path.join(source, 'deploy/compose.desktop-business-test.yml'),
  ...(paper?['-f',path.join(source,'deploy/compose.desktop-paper-study-test.yml')]:[]),'-f',ephemeralDb, ...args]);
const origin = `http://127.0.0.1:${port}`;
async function request(route, options = {}) {
  const started=Date.now();
  try{const r = await fetch(origin + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: await r.json() };}
  catch(error){throw Error('LOCAL_HTTP_FAILED '+(options.method??'GET')+' '+route+' '+(error.cause?.code??error.code??error.name)+' elapsedMs='+(Date.now()-started)+' bytesRead='+(error.cause?.socket?.bytesRead??'unknown'),{cause:error});}
}
const runtimeRequest = (route, host) => new Promise((resolve, reject) => {
  // fetch may replace a supplied Host header. Explicit HTTP is needed to test
  // release vhosts through the local numeric loopback address without DNS.
  const req = http.get({ hostname: '127.0.0.1', port: runtimePort, path: route, headers: { Host: host } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c));
    res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode,
      headers: Object.fromEntries(Object.entries(res.headers).filter(([, v]) => typeof v === 'string')) })));
    res.on('error', reject);
  });
  req.setTimeout(15000, () => req.destroy(Error('Runtime request timeout'))); req.on('error', reject);
});
const report = { project, directory, origin, runtimeOrigin: `http://localhost:${runtimePort}`, source,
  paperStudyEnabled:paper,
  productionConnected: false, realGitHubInvoked: false, modelInvoked: false, deployed: false, checks: [] };
const check = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
try {
  endpoint = JSON.parse((await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'])).trim());
  assert.match(endpoint, /^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/);
  if (process.env.DOCKER_HOST) assert.equal(process.env.DOCKER_HOST, endpoint);
  const config = JSON.parse(await compose('config', '--format', 'json'));
  assert.equal(config.networks['business-internal'].internal, true);
  for (const [name, service] of Object.entries(config.services)) {
    assert.deepEqual(Object.keys(service.networks).sort(), name === 'business-gateway' ? ['business-internal', 'business-loopback'] : ['business-internal']);
    if (name !== 'business-gateway') assert.equal(service.ports, undefined);
    else assert.ok(service.ports.every(p => p.host_ip === '127.0.0.1'));
    assert.ok(!Object.entries(service.environment ?? {}).some(([key, value]) =>
      /DEEPSEEK|CLIENT_SECRET|ALIYUN|AWS_SECRET/.test(key) && !(key === 'GITHUB_CLIENT_SECRET' && value === '')));
    for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL'])
      assert.ok(service.environment?.[key] === undefined || service.environment[key] === '');
  }
  console.log('Building clean-source local business image...');
  await fs.writeFile(path.join(directory, 'build.log'), redact(await compose('build', 'business-api')));
  started = true;
  try { await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '300'); }
  catch (error) { await fs.writeFile(path.join(directory, 'startup.log'), redact(await compose('logs', '--no-color', '--tail', '100'))); throw error; }
  await check('fresh PostgreSQL migrations, Redis and business readiness; no publishing/model/background tasks', async () => {
    const { status, body: { data: d } } = await request('/ready-desktop-business');
    assert.equal(status, 200); assert.equal(d.instance, 'isolated-business');
    for (const key of ['database', 'redis']) assert.equal(d[key], true);
    assert.equal(d.migrations.ready, true);
    report.migrations = d.migrations;
    for (const key of ['publishingEnabled', 'modelCallsEnabled', 'backgroundTasksEnabled']) assert.equal(d[key], false);
    const identity = JSON.parse(await compose('exec', '-T', 'business-api', 'node', '--input-type=module', '-e',
      `import {createDesktopBusinessTestRuntime} from './apps/api/src/desktop-business-test-server.mjs';const r=createDesktopBusinessTestRuntime(process.env);try{console.log(JSON.stringify((await r.database.pool.query('SELECT current_database() AS db,current_user AS username')).rows[0]));}finally{await r.app.close();}`));
    assert.deepEqual(identity, { db: 'desktop_business_test', username: 'desktop_business_test' });
  });
  await check('real product discovery, work detail, cover, journal, author and learning routes read seeded PostgreSQL data', async () => {
    const works = (await request('/v1/works?limit=24')).body.data;
    assert.ok(works.some(w => w.id === f.gameId)); assert.ok(works.some(w => w.id === f.courseId));
    assert.equal((await request('/v1/works/' + f.gameId)).body.data.title, '隔离测试计数游戏');
    assert.equal((await request('/v1/works?kind=courseware&limit=50')).body.data[0].id, f.courseId);
    assert.equal((await request('/v1/blog/articles')).body.data.items[0].id, f.articleId);
    assert.equal((await request('/v1/blog/articles/' + f.articleSlug)).body.data.blocks.length, 3);
    assert.equal((await request('/v1/profiles/' + f.authorHandle)).body.data.displayName, '桌面隔离测试作者');
    const cover = await fetch(origin + '/v1/works/' + f.gameId + '/cover');
    assert.equal(cover.status, 200); assert.match(cover.headers.get('content-type'), /image\/webp/);
  });
  let accessToken;
  await check('public leaderboard routes return empty lists for unconfigured works and real board data through the desktop bridge', async () => {
    for (const id of [f.gameId, f.courseId]) {
      const result = await request('/v1/works/' + id + '/leaderboards');
      assert.equal(result.status, 200); assert.deepEqual(result.body.data, []);
    }
    const builtin = await request('/v1/works/gamehub-guess-baike/leaderboards');
    assert.equal(builtin.status, 200); assert.equal(builtin.body.data[0].id, 'daily');
    const daily = await request('/v1/works/gamehub-guess-baike/leaderboards/daily');
    assert.equal(daily.status, 200); assert.equal(daily.body.data.total, 0);
    const missing = await request('/v1/works/' + f.gameId + '/leaderboards/missing');
    assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'COMPETITION_BOARD_NOT_FOUND');
    await compose('exec', '-T', 'business-api', 'node', '--input-type=module', '-e',
      `import {createDesktopBusinessTestRuntime} from './apps/api/src/desktop-business-test-server.mjs';
       import {registerCompetitionRelease} from './apps/api/src/competition-service.mjs';
       import {withTransaction} from './apps/api/src/database.mjs';
       const r=createDesktopBusinessTestRuntime(process.env);try{await withTransaction(r.database.pool,c=>registerCompetitionRelease(c,{
       workId:'${f.gameId}',releaseId:'${f.gameReleaseId}',ownerUserId:'${f.authorId}',competition:{version:1,boards:[{
       key:'score',title:'隔离测试榜',modeKey:'counter',rulesetVersion:1,period:'all-time',verification:'client_reported',
       metrics:[{key:'score',label:'计数',unit:'次',min:0,max:1000}],ranking:[{metric:'score',direction:'desc'}]}]}}));}finally{await r.app.close();}`);
    const { createDesktopAccountSession } = await import(pathToFileURL(path.join(source, 'apps/desktop/src/account-session.mjs')));
    const { createMemoryCredentialVault } = await import(pathToFileURL(path.join(source, 'apps/capability-executor/src/credential-vault.mjs')));
    const { createDesktopBusinessApi } = await import(pathToFileURL(path.join(source, 'apps/desktop/renderer/business-api.mjs')));
    const session = await createDesktopAccountSession({ apiOrigin: origin, vault: createMemoryCredentialVault() });
    const api = createDesktopBusinessApi({ async call(method,args) { return {ok:true,value:await session.call(method,args)}; } },origin);
    const definition = (await api.listWorkLeaderboards(f.gameId)).data[0];
    assert.equal(definition.title, '隔离测试榜');
    const board = (await api.readCompetitionLeaderboard(f.gameId, definition.id, {limit:10,offset:0})).data;
    assert.equal(board.boardId, definition.id); assert.deepEqual(board.entries, []); assert.equal(board.myEntry, null);
    assert.equal((await request('/v1/competition/runs', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).body.error.code,'DESKTOP_BUSINESS_TEST_ROUTE_DISABLED');
  });
  await check('real synthetic-email login and authenticated library save/remove/recent writes use the independent database', async () => {
    assert.equal((await request('/v1/me/library')).status, 401);
    const challenge = await request('/v1/auth/email/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'desktop-reader@example.test', clientKind: 'browser', locale: 'zh-CN' }) });
    assert.equal(challenge.status, 200);
    const code = JSON.parse(await compose('exec', '-T', 'business-api', 'node', '-e', "console.log(require('fs').readFileSync('/data/desktop-business/test-mail.json','utf8'))")).code;
    const verified = await request('/v1/auth/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.body.data.challengeId, code, deviceLabel: 'Local business regression' }) });
    assert.equal(verified.status, 200); accessToken = verified.body.data.accessToken;
    const headers = { Authorization: 'Bearer ' + accessToken };
    const daily = await request('/v1/works/gamehub-guess-baike/leaderboards/daily', { headers });
    assert.equal(daily.status, 200); assert.equal(daily.body.data.myEntry, null);
    assert.equal((await request('/v1/me/library/' + f.gameId, { method: 'PUT', headers })).status, 200);
    assert.equal((await request('/v1/me/library', { headers })).body.data[0].work.id, f.gameId);
    assert.equal((await request('/v1/me/recent/' + f.gameId, { method: 'POST', headers })).status, 200);
    assert.equal((await request('/v1/me/library?recent=true', { headers })).body.data[0].playCount, 1);
    assert.equal((await request('/v1/me/library/' + f.gameId, { method: 'DELETE', headers })).body.data.savedAt, null);
  });
  await check('HTTP publishing, model, admin, worker, upload and OAuth operations remain denied even with a valid session', async () => {
    for (const route of ['/v1/me/blog/articles/' + f.articleId + '/publish', '/v1/creator/works', '/v1/admin/agents', '/v1/research/topics', '/v1/uploads', '/v1/auth/github/web',
      '/v1/competition/runs', '/v1/competition/runs/' + f.gameId + '/finish', '/v1/games/guess-baike/results']) {
      const result = await request(route, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(result.status, 404); assert.equal(result.body.error.code, 'DESKTOP_BUSINESS_TEST_ROUTE_DISABLED');
    }
  });
  if(paper)await check('private paper HTTP import/read survives API, worker and Redis restart with zero model or publication actions',async()=>{
    const route='/v1/me/paper-studies',headers={Authorization:'Bearer '+accessToken,'Content-Type':'application/json'};
    const pdf=await fs.readFile(path.join(root,'.runtime/paper-layout-audit/1706.03762v7.pdf'));
    const input={filename:'paper.pdf',title:'隔离论文阅读验收',rightsConfirmed:true,pdfBase64:pdf.toString('base64')};
    assert.equal((await request(route)).status,401);
    assert.equal((await request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const imports=await Promise.all(Array.from({length:3},()=>request(route,{method:'POST',headers,body:JSON.stringify(input)})));
    imports.forEach(r=>assert.equal(r.status,202));const id=imports[0].body.data.id;
    assert.ok(imports.every(r=>r.body.data.id===id));
    let doc;
    for(let i=0;i<80;i++){doc=(await request(route+'/'+id,{headers})).body.data;if(doc.status==='imported')break;assert.notEqual(doc.status,'failed');await new Promise(r=>setTimeout(r,250));}
    assert.equal(doc.status,'imported');assert.equal(doc.pageCount,15);assert.ok(doc.pages.some(p=>p.text.length>100));assert.equal(doc.modelCallsEnabled,false);
    try{assert.equal((await request(route+'/'+id+'/source',{headers})).body.data.pdfBase64,input.pdfBase64);}
    catch(error){
      const probe=await compose('exec','-T','business-api','node','--input-type=module','-e',
        `for(const host of ['127.0.0.1','business-gateway']){try{const r=await fetch('http://'+host+':3090${route}/${id}/source',{headers:{Authorization:${JSON.stringify('Bearer '+accessToken)}},signal:AbortSignal.timeout(10000)});console.log(JSON.stringify({host,status:r.status,bytes:(await r.text()).length}));}catch(e){console.log(JSON.stringify({host,error:e.cause?.code??e.code??e.name}));}}`);
      await fs.writeFile(path.join(directory,'source-probe.jsonl'),probe);throw error;
    }
    for(const suffix of ['/analyze','/draft','/publish'])assert.equal((await request(route+'/'+id+suffix,{method:'POST',headers,body:'{}'})).status,404);
    const prep=JSON.parse(await compose('exec','-T','business-api','node','apps/api/src/desktop-paper-study-worker.mjs','--prepare'));assert.equal(prep.prepared,true);
    await compose('restart','business-paper-worker','business-redis','business-api');
    let ready=false;for(let i=0;i<80;i++){try{const r=await request('/ready-desktop-business');if(r.status===200){assert.equal(r.body.data.paperStudy.enabled,true);ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.equal(ready,true);
    const restored=(await request(route+'/'+id,{headers})).body.data;assert.equal(restored.id,id);assert.equal(restored.sourceSha256,doc.sourceSha256);assert.equal(restored.status,'imported');
    assert.equal((await request(route+'/'+id+'/source',{headers})).body.data.pdfBase64,input.pdfBase64);
    const state=JSON.parse(await compose('exec','-T','business-api','node','--input-type=module','-e',
      `import {createDesktopBusinessTestRuntime} from './apps/api/src/desktop-business-test-server.mjs';const r=createDesktopBusinessTestRuntime(process.env);try{console.log(JSON.stringify((await r.database.pool.query("SELECT (SELECT count(*)::int FROM paper_study_tasks) AS tasks,(SELECT count(*)::int FROM agent_provider_calls) AS calls,(SELECT count(*)::int FROM agent_run_actions) AS actions,(SELECT count(*)::int FROM paper_study_documents WHERE analysis_json IS NOT NULL OR draft_json IS NOT NULL) AS generated")).rows[0]));}finally{await r.app.close();}`));
    assert.deepEqual(state,{tasks:1,calls:0,actions:0,generated:0});
  });
  await check('product Runtime Edge serves manifest-verified game and course assets and rejects wrong hosts, traversal and mutations', async () => {
    const descriptor = (await request('/v1/works/' + f.gameId + '/launch')).body.data;
    const entry = new URL(descriptor.entryUrl);
    assert.equal(entry.hostname, 'r-' + f.gameReleaseId.replaceAll('-', '') + '.localhost');
    const runtime = route => runtimeRequest(route, entry.host);
    const html = await runtime(entry.pathname); assert.equal(html.status, 200); assert.match(await html.text(), /计数小游戏/);
    assert.match(html.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.equal((await runtime('/game.js')).status, 200);
    assert.equal((await runtime('/%2e%2e%2fsecret')).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${runtimePort}/index.html`)).status, 421);
    assert.equal((await fetch(`http://127.0.0.1:${runtimePort}/index.html`, { method: 'POST', headers: { Host: entry.host } })).status, 405);
    const course = (await request('/v1/works/' + f.courseId + '/launch')).body.data;
    const url = new URL(course.entryUrl);
    assert.equal((await runtimeRequest(url.pathname, url.host)).status, 200);
  });
  await check('seed is idempotent and complete API restart preserves the independent business database', async () => {
    const seed = JSON.parse(await compose('exec', '-T', 'business-api', 'node', 'apps/api/src/desktop-business-test-server.mjs', '--seed'));
    assert.equal(seed.existing, true);
    await compose('restart', 'business-api');
    let ready = false;
    for (let i = 0; i < 40; i++) { try { if ((await request('/ready-desktop-business')).status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.equal(ready, true); assert.equal((await request('/v1/blog/articles')).body.data.items[0].id, f.articleId);
  });
  await check('Runtime Edge refuses a same-length modified asset until the original bytes are restored', async () => {
    const mutate = async mode => compose('exec', '-T', 'business-api', 'node', '--input-type=module', '-e',
      `import fs from 'node:fs/promises';import path from 'node:path';import {createDesktopBusinessTestRuntime} from './apps/api/src/desktop-business-test-server.mjs';
       const r=createDesktopBusinessTestRuntime(process.env);try{
       const row=(await r.database.pool.query('SELECT asset_prefix FROM releases WHERE id=$1',['${f.gameReleaseId}'])).rows[0];
       const file=path.join(r.runtimeStore.resolvePrefix(row.asset_prefix),'assets/game.js');
       if('${mode}'==='change'){const body=await fs.readFile(file);await fs.writeFile(file+'.test-original',body,{flag:'wx'});body[0]^=1;await fs.writeFile(file,body);}
       else{await fs.writeFile(file,await fs.readFile(file+'.test-original'));await fs.unlink(file+'.test-original');}
       }finally{await r.app.close();}`);
    const host = 'r-' + f.gameReleaseId.replaceAll('-', '') + '.localhost:' + runtimePort;
    await mutate('change');
    try { assert.equal((await runtimeRequest('/game.js', host)).status, 503); }
    finally { await mutate('restore'); }
    assert.equal((await runtimeRequest('/game.js', host)).status, 200);
  });
  report.verified = true;
} catch (error) { report.verified = false; report.error = redact(error.stack ?? error.message); console.error(report.error); process.exitCode = 1; }
finally {
  if(started&&!report.verified){try{await fs.writeFile(path.join(directory,'failure-services.log'),redact(await compose('logs','--no-color','--tail','80')));}catch{}}
  if (started && (!keep || !report.verified)) {
    try { await compose('down', '--volumes', '--remove-orphans'); report.cleanedUp = true; }
    catch (error) { report.cleanedUp = false; report.cleanupError = redact(error.message); process.exitCode = 1; }
  } else if (started) { report.keptRunning = true; report.envFile = envFile; report.dockerEndpoint = endpoint; }
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(root, '.runtime/desktop-business-test/latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
