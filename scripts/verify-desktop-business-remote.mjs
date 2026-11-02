import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { desktopAuthCaddyfile } from './prepare-desktop-auth-caddy.mjs';
import { desktopBusinessCaddyfile } from './prepare-desktop-business-caddy.mjs';

if (process.argv.length !== 2) throw Error('Local-only verification takes no remote address');
const root = fileURLToPath(new URL('../', import.meta.url));
const clean = JSON.parse(await fs.readFile(path.join(root, '.runtime/desktop-auth-clean/latest.json')));
if (!clean.passed) throw Error('Run clean directory regression first');
const source = path.join(clean.directory, 'source'), project = 'mooyu-business-remote-check-' + Date.now();
const directory = path.join(root, '.runtime/desktop-business-remote', project);
await fs.mkdir(directory, { recursive: true });
const apiHost = 'desktop-test.example.org', runtimeDomain = 'desktop-runtime-test.example.org';
const api = 'https://' + apiHost, runtime = 'https://' + runtimeDomain;
const secret = crypto.randomBytes(32).toString('hex'), otp = crypto.randomBytes(32).toString('hex');
const testTokens = [];
const ingress = project + '-ingress', envFile = path.join(directory, 'instance.env');
const report = { project, directory, productionConnected: false, realGitHubInvoked: false, checks: [], passed: false };
let endpoint, started = false, network = false;
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (key.startsWith('DESKTOP_BUSINESS_')) delete childEnv[key];
const redact = value => [secret, otp, ...testTokens].reduce((text, key) => text.replaceAll(key, '[redacted]'), value);
async function run(command, args, cwd = source, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, windowsHide: true });
    let text = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('LOCAL_CHECK_TIMEOUT')); }, timeoutMs);
    child.stdout.on('data', c => { text += c; }); child.stderr.on('data', c => { text += c; });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(text) : reject(Error(redact(text.slice(-5000)))); });
  });
}
const docker = args => {
  const waitIndex = args.indexOf('--wait-timeout');
  return run('docker', endpoint ? ['--host', endpoint, ...args] : args, source,
    waitIndex < 0 ? 240000 : Number(args[waitIndex + 1]) * 1000 + 30000);
};
const override = path.join(directory, 'gateway.yml');
const compose = (...args) => docker(['compose', '-p', project, '--env-file', envFile,
  '-f', path.join(source, 'deploy/compose.desktop-business-test.yml'),
  '-f', path.join(source, 'deploy/compose.desktop-business-remote.yml'), '-f', override, ...args]);
const freePort = async () => { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; await new Promise(r => server.close(r)); return port; };
let tlsPort, mainPort, ca;
const request = (host, route, method = 'GET', headers = {}, body = null) => new Promise((resolve, reject) => {
  const req = https.request({ hostname: '127.0.0.1', port: tlsPort, servername: host, ca,
    method, path: route, headers: { Host: host, ...headers }, rejectUnauthorized: true }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  }); req.setTimeout(15000, () => req.destroy(Error('LOCAL_TLS_TIMEOUT'))); req.on('error', reject); req.end(body);
});
const main = () => new Promise((resolve, reject) => {
  const req = http.get({ hostname: '127.0.0.1', port: mainPort, headers: { Host: 'main.example.test' } }, res => {
    let text = ''; res.on('data', c => { text += c; }); res.on('end', () => { try { assert.equal(text, 'existing-main-route'); resolve(); } catch (e) { reject(e); } });
  }); req.setTimeout(10000, () => req.destroy(Error('LOCAL_MAIN_TIMEOUT'))); req.on('error', reject);
});
const check = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
try {
  endpoint = JSON.parse((await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'])).trim());
  assert.match(endpoint, /^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/);
  if (process.env.DOCKER_HOST) assert.equal(process.env.DOCKER_HOST, endpoint);
  tlsPort = await freePort(); do { mainPort = await freePort(); } while (mainPort === tlsPort);
  await fs.writeFile(envFile, `DESKTOP_BUSINESS_TEST_MODE=remote-https
DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN=${api}
DESKTOP_BUSINESS_TEST_RUNTIME_ORIGIN=${runtime}
DESKTOP_BUSINESS_TEST_PORT=39190
DESKTOP_BUSINESS_TEST_RUNTIME_PORT=443
DESKTOP_BUSINESS_TEST_DB_PASSWORD=${secret}
DESKTOP_BUSINESS_TEST_OTP_HMAC_KEY=${otp}
DESKTOP_BUSINESS_TEST_IMAGE=${project}:local
DESKTOP_BUSINESS_INGRESS_NETWORK=${ingress}
DESKTOP_AUTH_CADDY_FILE=${path.join(directory, 'baseline.Caddyfile').replaceAll('\\', '/')}
DESKTOP_AUTH_CADDY_IMAGE=gamehub-production-web:latest
DESKTOP_AUTH_INGRESS_NETWORK=${project}-old-auth-ingress
DESKTOP_BUSINESS_CADDY_FILE=${path.join(directory, 'Caddyfile').replaceAll('\\', '/')}
DESKTOP_BUSINESS_CADDY_IMAGE=gamehub-production-web:latest
`, { mode: 0o600 });
  // Per-run throwaway certificate. No ACME, AliDNS, OS trust-store changes or TLS bypass.
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const opensslConfig = path.join(directory, 'openssl.cnf');
  await fs.writeFile(opensslConfig, '[req]\ndistinguished_name=dn\n[dn]\n');
  await run(openssl, ['req', '-config', opensslConfig, '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', path.join(directory, 'key.pem'),
    '-out', path.join(directory, 'cert.pem'), '-subj', '/CN=desktop-test.example.org',
    '-addext', 'subjectAltName=DNS:desktop-test.example.org,DNS:*.desktop-runtime-test.example.org'], directory);
  ca = await fs.readFile(path.join(directory, 'cert.pem'));
  const baseline = desktopAuthCaddyfile('{\n auto_https off\n}\nhttp://main.example.test:8080 {\n respond "existing-main-route"\n}\n', apiHost);
  const candidate = desktopBusinessCaddyfile(baseline, api, runtime);
  const offline = path.join(directory, 'offline.Caddyfile'); await fs.writeFile(offline, candidate);
  const gatewayImage = 'gamehub-production-web:latest'; // Local cached binary; no production container is addressed.
  await check('AliDNS candidate validates with networking disabled and dummy credentials', async () => {
    await docker(['run', '--rm', '--network', 'none', '-e', 'ALIYUN_ACCESS_KEY_ID=fixture', '-e', 'ALIYUN_ACCESS_KEY_SECRET=fixture',
      '--mount', `type=bind,source=${offline},target=/candidate,readonly`, '--entrypoint', 'caddy', gatewayImage,
      'validate', '--config', '/candidate', '--adapter', 'caddyfile']);
  });
  const tls = text => text.replace(/  tls \{\n    dns alidns \{[\s\S]*?\n  \}/g, '  tls /test/cert.pem /test/key.pem');
  await fs.writeFile(path.join(directory, 'baseline.Caddyfile'), tls(baseline));
  await fs.writeFile(path.join(directory, 'Caddyfile'), tls(candidate));
  assert.doesNotMatch(tls(candidate), /dns alidns/);
  await check('gateway Compose upgrade preserves all non-web services and existing auth ingress, ports and certificate volumes', async () => {
    const base = ['compose', '--env-file', path.join(source, 'deploy/.env.prod.example'), '--env-file', envFile,
      '-f', path.join(source, 'deploy/compose.prod.yml'), '-f', path.join(source, 'deploy/compose.desktop-auth-caddy.yml')];
    const before = JSON.parse(await docker([...base, 'config', '--format', 'json']));
    const after = JSON.parse(await docker([...base, '-f', path.join(source, 'deploy/compose.desktop-business-caddy.yml'), 'config', '--format', 'json']));
    assert.deepEqual(Object.keys(before.services), Object.keys(after.services));
    for (const name of Object.keys(before.services)) if (name !== 'web') assert.deepEqual(after.services[name], before.services[name]);
    assert.deepEqual(before.services.web.environment, after.services.web.environment);
    assert.deepEqual(before.services.web.ports, after.services.web.ports);
    for (const [name, value] of Object.entries(before.services.web.networks)) assert.deepEqual(after.services.web.networks[name], value);
    assert.ok(Object.hasOwn(after.services.web.networks, 'desktop-business-ingress'));
    for (const v of before.services.web.volumes.filter(v => v.target !== '/etc/caddy/Caddyfile'))
      assert.ok(after.services.web.volumes.some(w => JSON.stringify(w) === JSON.stringify(v)));
  });
  const mockCode = "require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({data:{status:'ready',instance:'isolated-auth-only'}}))}).listen(3090,'0.0.0.0')";
  await fs.writeFile(override, `services:
  web:
    image: ${gatewayImage}
    networks: [desktop-business-ingress, local-web]
    ports: ["127.0.0.1:${tlsPort}:443", "127.0.0.1:${mainPort}:8080"]
    volumes:
      - type: bind
        source: ${JSON.stringify(directory.replaceAll('\\', '/'))}
        target: /test
        read_only: true
    command: [caddy, run, --config, /test/Caddyfile, --adapter, caddyfile]
  old-auth:
    image: node:22-bookworm-slim
    command: [node, -e, ${JSON.stringify(mockCode)}]
    networks:
      desktop-business-ingress:
        aliases: [desktop-auth-test-api]
networks:
  local-web:
`);
  await check('remote Compose keeps database and Redis internal, no host API/runtime ports and no production volumes', async () => {
    const model = JSON.parse(await compose('config', '--format', 'json'));
    for (const name of ['business-postgres', 'business-redis', 'business-migrate', 'business-seed']) {
      assert.equal(model.services[name].ports, undefined);
      assert.deepEqual(Object.keys(model.services[name].networks), ['business-internal']);
    }
    assert.equal(model.services['business-api'].ports, undefined);
    assert.equal(model.networks['business-internal'].internal, true);
    assert.equal(model.services['business-gateway'], undefined);
    for (const v of Object.values(model.volumes)) assert.ok(!v.external && v.name.startsWith(project + '_'));
  });
  await docker(['network', 'create', '--internal', '--label', 'mooyu.local-check=' + project, ingress]); network = true;
  console.log('Building isolated API image from the verified clean tree.');
  await compose('build', 'business-api'); started = true;
  // Fresh schema creation can be slow on Docker Desktop; keep a finite startup
  // budget without relaxing individual Redis/HTTP readiness deadlines.
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '300');
  await check('HTTPS readiness, anonymous session, seeded catalog/article/course and TLS hostname verification', async () => {
    const ready = await request(apiHost, '/ready-desktop-business'); assert.equal(ready.status, 200);
    const d = JSON.parse(ready.text).data;
    assert.equal(d.database, true); assert.equal(d.redis, true); assert.equal(d.migrations.ready, true);
    assert.deepEqual(d.runtime, { domain: runtimeDomain, scheme: 'https', port: 443 });
    assert.equal(d.emailConfigured, false); assert.equal(d.githubConfigured, false);
    for (const flag of ['backgroundTasksEnabled', 'publishingEnabled', 'modelCallsEnabled']) assert.equal(d[flag], false);
    const works = JSON.parse((await request(apiHost, '/v1/works')).text).data;
    for (const id of ['d7b00000-0000-4000-8000-000000000002', 'd7b00000-0000-4000-8000-000000000004'])
      assert.ok(works.some(work => work.id === id));
    assert.equal((await request(apiHost, '/v1/blog/articles/desktop-business-fixture')).status, 200);
    assert.equal((await request(apiHost, '/v1/me/library')).status, 401);
    await assert.rejects(request('wrong.example.org', '/ready-desktop-business'), error =>
      error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || error.code === 'EPROTO' && /TLS|SSL/i.test(error.message));
  });
  await check('HTTPS account controls preserve authentication, profile validation, ownership and target-only session revocation', async () => {
    // Create disposable sessions with the real auth service/repository and an
    // in-process fake provider. No public login route, email capture or GitHub
    // network access is enabled by this setup; no production credentials exist.
    const setup = await compose('exec', '-T', 'business-api', 'node', '--input-type=module', '-e', `
      import {createDesktopBusinessTestRuntime} from './apps/api/src/desktop-business-test-server.mjs';
      import {createAuthService} from './apps/api/src/auth-service.mjs';
      import {PostgresAuthRepository} from './apps/api/src/auth-repository.mjs';
      const r=createDesktopBusinessTestRuntime(process.env);let result;
      try {
        const identity=(await r.database.pool.query('SELECT current_database() AS db,current_user AS usr')).rows[0];
        if(identity.db!=='desktop_business_test'||identity.usr!=='desktop_business_test')throw Error('TEST_DATABASE_REQUIRED');
        let subject='990000001';
        const auth=createAuthService({repository:new PostgresAuthRepository(r.database.pool),otpHmacKey:r.config.otpHmacKey,
          githubClient:{webConfigured:true,createAuthorizeUrl:({state})=>'https://provider.invalid/?state='+encodeURIComponent(state),
            exchangeWebCode:async()=>({access_token:'local-provider-fixture'}),getUser:async()=>({subject,login:'Fixture',name:'Fixture'})}});
        const login=async(label)=>{
          const start=await auth.startGitHubWeb({clientKind:'browser',deviceLabel:label});
          await auth.completeGitHubWeb({code:'offline-fixture',state:new URL(start.authorizeUrl).searchParams.get('state')});
          const polled=await auth.pollGitHubWeb({challengeId:start.challengeId});
          if(polled.status!=='complete')throw Error('TEST_AUTH_SETUP_FAILED');
          const {accessToken,refreshToken,grantId}=polled.tokens;return {accessToken,refreshToken,grantId};
        };
        const owner=await login('Fixture owner'),target=await login('Fixture target');
        subject='990000002';const other=await login('Fixture other');result={owner,target,other};
      } finally {await r.app.close();}
      console.log(JSON.stringify(result));`);
    const { owner, target, other } = JSON.parse(setup);
    for (const session of [owner, target, other]) testTokens.push(session.accessToken, session.refreshToken);
    const call = (method, route, payload, token) => request(apiHost, route, method,
      { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      payload === undefined ? null : JSON.stringify(payload));
    for (const token of [undefined, 'invalid'.repeat(6)]) for (const [method, route, payload] of [
      ['PATCH', '/v1/me', { displayName: 'Unauthorized' }], ['PATCH', '/v1/me/avatar', { presetKey: 'wizard' }],
      ['DELETE', '/v1/me/devices/' + target.grantId],
    ]) assert.equal((await call(method, route, payload, token)).status, 401);
    const before = JSON.parse((await call('GET', '/v1/me', undefined, other.accessToken)).text).data;
    for (const displayName of ['', '   ', 'x'.repeat(41)])
      assert.equal((await call('PATCH', '/v1/me', { displayName }, owner.accessToken)).status, 400);
    assert.equal((await call('PATCH', '/v1/me/avatar', { presetKey: 'unknown' }, owner.accessToken)).status, 400);
    let response = await call('PATCH', '/v1/me', { displayName: '  Remote   Reader  ' }, owner.accessToken);
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.text).data.displayName, 'Remote Reader');
    response = await call('PATCH', '/v1/me/avatar', { presetKey: 'wizard' }, owner.accessToken);
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.text).data.avatar.presetKey, 'wizard');
    const readback = JSON.parse((await call('GET', '/v1/me', undefined, target.accessToken)).text).data;
    assert.equal(readback.displayName, 'Remote Reader'); assert.equal(readback.avatar.presetKey, 'wizard');
    response = await call('DELETE', '/v1/me/devices/' + other.grantId, undefined, owner.accessToken);
    assert.equal(response.status, 404); assert.equal(JSON.parse(response.text).error.code, 'DEVICE_NOT_FOUND');
    response = await call('DELETE', '/v1/me/devices/' + target.grantId, undefined, owner.accessToken);
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.text).data.revokedCount, 1);
    assert.equal((await call('GET', '/v1/me', undefined, target.accessToken)).status, 401);
    assert.equal((await call('POST', '/v1/auth/refresh', { refreshToken: target.refreshToken })).status, 401);
    assert.equal((await call('GET', '/v1/me', undefined, owner.accessToken)).status, 200);
    const otherResponse = await call('GET', '/v1/me', undefined, other.accessToken);
    assert.equal(otherResponse.status, 200);
    assert.equal(JSON.parse(otherResponse.text).data.displayName, before.displayName);
    assert.deepEqual(JSON.parse(otherResponse.text).data.avatar, before.avatar);
    for (const [method, route] of [['PUT', '/v1/me/avatar'], ['POST', '/v1/uploads'],
      ['POST', '/v1/me/blog/articles/d7b00000-0000-4000-8000-000000000006/publish'],
      ['POST', '/v1/admin/agents'], ['POST', '/v1/research/topics'], ['PATCH', '/v1/me/permissions']]) {
      response = await call(method, route, {}, owner.accessToken);
      assert.equal(response.status, 404); assert.equal(JSON.parse(response.text).error.code, 'DESKTOP_BUSINESS_TEST_ROUTE_DISABLED');
    }
    response = await request(apiHost, '/ready-desktop-business');
    for (const flag of ['backgroundTasksEnabled', 'publishingEnabled', 'modelCallsEnabled']) assert.equal(JSON.parse(response.text).data[flag], false);
  });
  await check('test PostgreSQL backup restores into another local database; Redis snapshot and restart preserve a test marker', async () => {
    await compose('exec', '-T', 'business-postgres', 'sh', '-ec',
      'pg_dump -U desktop_business_test -d desktop_business_test -Fc > /tmp/business-check.dump; ' +
      'pg_restore --list /tmp/business-check.dump > /tmp/business-check.list; ' +
      'createdb -U desktop_business_test desktop_business_restore_check; ' +
      'pg_restore -U desktop_business_test -d desktop_business_restore_check --no-owner --exit-on-error /tmp/business-check.dump');
    const rows = (await compose('exec', '-T', 'business-postgres', 'psql', '-X', '-At', '-U', 'desktop_business_test',
      '-d', 'desktop_business_restore_check', '-c', "SELECT (SELECT count(*) FROM works WHERE id IN ('d7b00000-0000-4000-8000-000000000002','d7b00000-0000-4000-8000-000000000004')), (SELECT count(*) FROM schema_migrations);")).trim();
    assert.equal(rows, '2|158');
    await compose('exec', '-T', 'business-postgres', 'dropdb', '-U', 'desktop_business_test', 'desktop_business_restore_check');
    await compose('exec', '-T', 'business-redis', 'redis-cli', 'SET', 'desktop-local-backup-check', 'preserved');
    await compose('exec', '-T', 'business-redis', 'redis-cli', 'SAVE');
    await compose('exec', '-T', 'business-redis', 'redis-check-rdb', '/data/dump.rdb');
    await compose('restart', 'business-redis');
    let value = '';
    for (let i = 0; i < 30; i++) {
      try { value = (await compose('exec', '-T', 'business-redis', 'redis-cli', 'GET', 'desktop-local-backup-check')).trim(); if (value === 'preserved') break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(value, 'preserved');
    await compose('exec', '-T', 'business-redis', 'redis-cli', 'DEL', 'desktop-local-backup-check');
  });
  await check('HTTPS launch binds release host; game assets and sandbox CSP work; invalid host, method and publication are denied', async () => {
    const work = 'd7b00000-0000-4000-8000-000000000002';
    const launch = JSON.parse((await request(apiHost, '/v1/works/' + work + '/launch')).text).data;
    const url = new URL(launch.entryUrl); assert.equal(url.protocol, 'https:'); assert.ok(url.hostname.endsWith('.' + runtimeDomain));
    const html = await request(url.hostname, url.pathname); assert.equal(html.status, 200); assert.match(html.headers['content-security-policy'], /sandbox allow-scripts/);
    const js = await request(url.hostname, '/game.js', 'GET', { Cookie: 'test=private', Authorization: 'Bearer private' });
    assert.equal(js.status, 200); assert.match(js.text, /increment/);
    assert.equal((await request('wrong.' + runtimeDomain, '/index.html')).status, 403);
    assert.equal((await request(url.hostname, '/game.js', 'POST')).status, 403);
    assert.equal((await request(apiHost, '/v1/creator/works', 'POST')).status, 404);
    assert.equal((await request(apiHost, '/v1/auth/email/challenges', 'POST')).status, 404);
    assert.equal((await request(apiHost, '/v1/auth/github/web', 'POST')).status, 404);
    await main();
  });
  await check('current gateway backup reload restores auth-only baseline, then business configuration re-applies', async () => {
    const web = (await compose('ps', '-q', 'web')).trim();
    await docker(['exec', web, 'caddy', 'reload', '--config', '/test/baseline.Caddyfile', '--adapter', 'caddyfile']);
    assert.equal(JSON.parse((await request(apiHost, '/ready-desktop-auth')).text).data.instance, 'isolated-auth-only'); await main();
    await docker(['exec', web, 'caddy', 'reload', '--config', '/test/Caddyfile', '--adapter', 'caddyfile']);
    assert.equal(JSON.parse((await request(apiHost, '/ready-desktop-business')).text).data.instance, 'isolated-business'); await main();
  });
  await check('upstream failure logs redact OAuth query, Referer, Cookie and Authorization', async () => {
    await compose('stop', 'business-api');
    const response = await request(apiHost, '/v1/auth/github/web/callback?code=private-code&state=private-state', 'GET',
      { Referer: 'https://example.org/?private-referer', Cookie: 'private-cookie', Authorization: 'Bearer private-bearer' });
    assert.equal(response.status, 502);
    const logs = await compose('logs', '--no-color', 'web');
    assert.doesNotMatch(logs, /private-(?:code|state|referer|cookie|bearer)/); assert.match(logs, /redacted/);
    await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'business-api');
    assert.equal((await request(apiHost, '/ready-desktop-business')).status, 200);
  });
  report.passed = true;
} catch (error) { report.error = redact(error.stack || String(error)); process.exitCode = 1; }
finally {
  if (started && !report.passed) {
    try { await fs.writeFile(path.join(directory, 'startup.log'), redact(await compose('logs', '--no-color', '--tail', '100'))); }
    catch { /* Keep the original failure while still cleaning up the owned project. */ }
  }
  if (started) { try { await compose('down', '--volumes', '--remove-orphans'); report.cleanedUp = true; }
    catch (e) { report.cleanupError = redact(e.message); report.passed = false; process.exitCode = 1; } }
  if (network) { try { await docker(['network', 'rm', ingress]); } catch (e) { report.cleanupError = redact(e.message); report.passed = false; process.exitCode = 1; } }
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(root, '.runtime/desktop-business-remote/latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
