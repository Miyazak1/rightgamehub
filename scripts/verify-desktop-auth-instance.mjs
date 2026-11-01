import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { desktopAuthCaddyfile } from './prepare-desktop-auth-caddy.mjs';
import { readFile, appendFile } from 'node:fs/promises';
import { fetchWithTestCA } from '../tests/desktop/https-account-fixture.mjs';
import http from 'node:http';

const gateway = process.argv.slice(2).join(' ') === '--caddy';
if (process.argv.length > 2 && !gateway) throw Error('Usage: node scripts/verify-desktop-auth-instance.mjs [--caddy]');

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `mooyu-auth-check-${Date.now()}`;
const output = path.join(root, '.runtime', 'desktop-auth-test', project);
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const envFile = path.join(output, 'instance.env');
const secrets = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
await writeFile(envFile, `DESKTOP_AUTH_TEST_PUBLIC_ORIGIN=http://127.0.0.1:${port}\nDESKTOP_AUTH_TEST_PORT=${port}\nDESKTOP_AUTH_TEST_DB_PASSWORD=${secrets[0]}\nDESKTOP_AUTH_TEST_OTP_HMAC_KEY=${secrets[1]}\n`, { flag: 'wx', mode: 0o600 });
const redact = value => secrets.reduce((text, key) => text.replaceAll(key, '[redacted]'), value);
let localEndpoint;
const dockerEnv = { ...process.env };
for (const key of Object.keys(dockerEnv)) {
  if (key.startsWith('DESKTOP_AUTH_TEST_')) delete dockerEnv[key];
}
async function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', localEndpoint ? ['--host', localEndpoint, ...args] : args,
      { cwd: root, windowsHide: true, env: dockerEnv });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Docker verification timed out')); }, 240000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(redact(`Docker exit ${code}: ${stderr.slice(-3000)} ${stdout.slice(-1000)}`)));
    });
  });
}
let gatewayCompose, gatewayPort, mainPort, gatewayFile, originalGateway, gatewayCertificate, networkCreated = false;
let stalledContainer = null;
const ingressNetwork = project + '-ingress';
const compose = (...args) => docker(['compose', '-p', project, '--env-file', envFile,
  '-f', 'deploy/compose.desktop-auth-test.yml', ...(gateway ? ['-f', 'deploy/compose.desktop-auth-ingress.yml', '-f', gatewayCompose, '-f', 'deploy/compose.desktop-auth-caddy.yml'] : []), ...args]);
const report = { project, productionConnected: false, realGitHubInvoked: false, checks: [] };
let started = false;
try {
  const endpoint = JSON.parse((await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'])).trim());
  assert.match(endpoint, /^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/, 'Only a local Docker endpoint is allowed');
  if (process.env.DOCKER_HOST) assert.equal(process.env.DOCKER_HOST, endpoint, 'DOCKER_HOST must match the local context');
  localEndpoint = endpoint;
  if (gateway) {
    const freePort = async () => {
      const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
    };
    do { gatewayPort = await freePort(); } while (gatewayPort === port);
    do { mainPort = await freePort(); } while ([port, gatewayPort].includes(mainPort));
    const portable = value => value.replaceAll('\\', '/');
    const image = 'gamehub-production-web:latest'; // Cached local Caddy binary; no existing container is touched.
    const offlineConfig = path.join(output, 'offline.Caddyfile');
    const source = await readFile(path.join(root, 'deploy/Caddyfile'), 'utf8');
    await writeFile(offlineConfig, desktopAuthCaddyfile(source, 'desktop-test.example.org'));
    await docker(['run', '--rm', '--network', 'none', '--entrypoint', 'caddy',
      '-e', 'APP_DOMAIN=existing.example.org', '-e', 'RUNTIME_DOMAIN=runtime.example.org', '-e', 'ACME_EMAIL=ops@example.org',
      '-e', 'ALIYUN_ACCESS_KEY_ID=isolated-placeholder', '-e', 'ALIYUN_ACCESS_KEY_SECRET=isolated-placeholder',
      '--mount', `type=bind,source=${offlineConfig},target=/etc/caddy/Caddyfile,readonly`, image,
      'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
    report.checks.push('unchanged repository routes plus AliDNS test site validated with network disabled and dummy credentials');
    originalGateway = '{\n auto_https off\n}\nhttp://main.example.test:8080 {\n respond "existing-main-route"\n}\n';
    const combined = desktopAuthCaddyfile(originalGateway, 'desktop-test.example.org');
    const localConfig = combined.replace(/  tls \{\n    dns alidns \{[\s\S]*?\n  \}/, '  tls /test-ca/gateway-test-cert.pem /test-ca/gateway-test-key.pem');
    gatewayCertificate = await readFile(path.join(root, 'tests/desktop/fixtures/https/gateway-test-cert.pem'));
    assert.match(localConfig, /auto_https off/);
    assert.doesNotMatch(localConfig, /dns alidns|disable_redirects/);
    gatewayFile = path.join(output, 'Caddyfile'); await writeFile(gatewayFile, localConfig);
    gatewayCompose = path.join(output, 'gateway.yml');
    const certificates = portable(path.join(root, 'tests/desktop/fixtures/https'));
    await writeFile(gatewayCompose, `services:\n  web:\n    image: ${image}\n    networks: [backend]\n    ports: ["127.0.0.1:${gatewayPort}:443", "127.0.0.1:${mainPort}:8080"]\n    volumes:\n      - type: bind\n        source: ${JSON.stringify(certificates)}\n        target: /test-ca\n        read_only: true\nnetworks:\n  backend: {}\n`);
    await appendFile(envFile, `DESKTOP_AUTH_CADDY_FILE=${portable(gatewayFile)}\nDESKTOP_AUTH_CADDY_IMAGE=${image}\nDESKTOP_AUTH_INGRESS_NETWORK=${ingressNetwork}\n`);
    dockerEnv.DESKTOP_AUTH_CADDY_FILE = portable(gatewayFile);
    dockerEnv.DESKTOP_AUTH_CADDY_IMAGE = image;
    dockerEnv.DESKTOP_AUTH_INGRESS_NETWORK = ingressNetwork;
    const prod = ['compose', '--env-file', 'deploy/.env.prod.example', '-f', 'deploy/compose.prod.yml'];
    const before = JSON.parse(await docker([...prod, 'config', '--format', 'json']));
    const after = JSON.parse(await docker([...prod, '-f', 'deploy/compose.desktop-auth-caddy.yml', 'config', '--format', 'json']));
    assert.deepEqual(Object.keys(before.services), Object.keys(after.services));
    for (const name of Object.keys(before.services)) if (name !== 'web') assert.ok(JSON.stringify(after.services[name]) === JSON.stringify(before.services[name]), 'Non-web service changed: ' + name);
    assert.ok(JSON.stringify(after.services.web.environment) === JSON.stringify(before.services.web.environment), 'Gateway environment changed');
    assert.deepEqual(after.services.web.ports, before.services.web.ports);
    assert.equal(after.services.web.image, image);
    assert.equal(after.services.web.networks.backend !== undefined, true);
    for (const volume of before.services.web.volumes) assert.ok(after.services.web.volumes.some(v => v.target === volume.target && v.source === volume.source));
    report.checks.push('production Compose merge changes only web; image pinned and original environment, ports and certificate volumes retained');
    await docker(['network', 'create', '--internal', '--label', 'mooyu.desktop-auth-test=ingress-v1', ingressNetwork]); networkCreated = true;
  }
  const model = JSON.parse(await compose('config', '--format', 'json'));
  assert.deepEqual(Object.keys(model.services).sort(), ['auth-api', 'auth-migrate', 'auth-postgres', 'auth-redis', ...(gateway ? ['web'] : [])]);
  for (const [name, service] of Object.entries(model.services)) {
    assert.equal(service.env_file, undefined);
    for (const volume of service.volumes || []) { if (name === 'web') assert.equal(volume.read_only, true); else assert.equal(volume.type, 'volume'); }
  }
  for (const volume of Object.values(model.volumes)) {
    assert.equal(Boolean(volume.external), false);
    assert.ok(volume.name.startsWith(project + '_'));
  }
  for (const name of ['auth-postgres', 'auth-redis', 'auth-migrate']) assert.equal(model.services[name].ports, undefined);
  assert.equal(model.services['auth-api'].ports[0].host_ip, '127.0.0.1');
  assert.equal(model.networks['auth-data'].internal, true);
  if (gateway) {
    assert.deepEqual(Object.keys(model.services['auth-postgres'].networks), ['auth-data']);
    assert.deepEqual(Object.keys(model.services['auth-redis'].networks), ['auth-data']);
    assert.equal(model.services['auth-migrate'].networks['desktop-auth-ingress'], undefined);
    assert.deepEqual(Object.keys(model.services.web.networks).sort(), ['backend', 'desktop-auth-ingress']);
    assert.ok(model.services['auth-api'].networks['desktop-auth-ingress'].aliases.includes('desktop-auth-test-api'));
    report.checks.push('only test API and gateway join the dedicated ingress; test database, Redis and migration remain outside');
  }
  report.checks.push('separate project, volumes, network and loopback-only API port');
  console.log('Starting a fresh local database and account API; no production resources used.');
  started = true;
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '150');
  const origin = `http://127.0.0.1:${port}`;
  const request = async (url, options = {}) => {
    const response = await fetch(origin + url, { ...options, signal: AbortSignal.timeout(10000), redirect: 'error' });
    return { status: response.status, body: await response.json() };
  };
  const ready = await request('/ready-desktop-auth');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.data.migrations.ready, true);
  assert.equal(ready.body.data.redis, true);
  assert.equal(ready.body.data.githubConfigured, false);
  assert.equal(ready.body.data.emailConfigured, false);
  assert.equal(ready.body.data.backgroundTasksEnabled, false);
  report.checks.push('fresh PostgreSQL migration and Redis readiness; OAuth accurately unconfigured');
  const session = await request('/v1/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 200);
  assert.equal(session.body.data.authenticated, false);
  const github = await request('/v1/auth/github/web', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKind: 'browser', deviceLabel: 'Isolated local check' }) });
  assert.equal(github.status, 503);
  assert.match(github.body.error.code, /GITHUB.*UNAVAILABLE|GITHUB.*NOT_CONFIGURED/);
  report.checks.push('shared anonymous session and fail-closed GitHub start');
  for (const url of ['/ready', '/v1/blog/articles', '/v1/works', '/v1/me/game-saves']) {
    const result = await request(url);
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'DESKTOP_AUTH_TEST_ROUTE_DISABLED');
  }
  report.checks.push('business, publication and full-runtime endpoints blocked');
  const db = JSON.parse((await compose('exec', '-T', 'auth-postgres', 'psql', '-X', '-At', '-U', 'desktop_auth_test', '-d', 'desktop_auth_test', '-v', 'ON_ERROR_STOP=1', '-c',
    "SELECT json_build_object('database',current_database(),'user',current_user,'migrations',(SELECT count(*) FROM schema_migrations));")).trim());
  assert.equal(db.database, 'desktop_auth_test');
  assert.equal(db.user, 'desktop_auth_test');
  assert.equal(Number(db.migrations), ready.body.data.migrations.expected);
  report.migrations = Number(db.migrations);
  report.checks.push('database identity and migration count verified inside task-owned PostgreSQL');
  await compose('stop', 'auth-redis');
  const outageStarted = Date.now();
  const outage = await Promise.all(Array.from({ length: 5 }, () => request('/ready-desktop-auth')));
  assert.ok(outage.every(result => result.status === 503 && result.body.data.status === 'not-ready'));
  assert.ok(Date.now() - outageStarted < 4000);
  await compose('stop', '--timeout', '5', 'auth-api');
  const apiId = (await compose('ps', '--all', '--quiet', 'auth-api')).trim();
  assert.equal((await docker(['inspect', '--format', '{{.State.ExitCode}}', apiId])).trim(), '0');
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'auth-redis', 'auth-api');
  assert.equal((await request('/ready-desktop-auth')).status, 200);
  report.checks.push('Redis outage returns bounded 503 under concurrent probes, API shuts down cleanly, and Redis/API restart recovers');
  if (gateway) {
    const proxy = () => fetchWithTestCA(`https://127.0.0.1:${gatewayPort}/ready-desktop-auth`, {
      method: 'GET', headers: { Host: 'desktop-test.example.org' }, ca: gatewayCertificate, signal: AbortSignal.timeout(10000) });
    const main = () => new Promise((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${mainPort}`, { headers: { Host: 'main.example.test' }, signal: AbortSignal.timeout(10000) }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; }); response.on('error', reject);
        response.on('end', () => { try { assert.equal(response.statusCode, 200); assert.equal(body, 'existing-main-route'); resolve(); } catch (error) { reject(error); } });
      }); request.on('error', reject);
    });
    report.gatewayStep = 'existing-hostname'; await main();
    report.gatewayStep = 'test-tls'; let response = await proxy(); assert.equal(response.status, 200); assert.equal((await response.json()).data.instance, 'isolated-auth-only');
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    report.checks.push('real Caddy TLS proxy reaches isolated API while existing hostname response is unchanged');
    const faultHeaders = { Host: 'desktop-test.example.org', Referer: 'https://example.org/?code=private-referer',
      Authorization: 'Bearer private-bearer', Cookie: 'session=private-cookie' };
    const callback = query => fetchWithTestCA(`https://127.0.0.1:${gatewayPort}/v1/auth/github/web/callback?${query}`, {
      headers: faultHeaders, ca: gatewayCertificate, signal: AbortSignal.timeout(10000) });
    const assertPrivateLogs = async () => {
      const logs = await compose('logs', '--no-color', 'web');
      assert.doesNotMatch(logs, /private-(?:code|state|repeat|bad|referer|bearer|cookie|description)/);
      const entries = logs.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line.slice(line.indexOf('{')))]; } catch { return []; } });
      assert.ok(entries.some(entry => entry.level === 'error' && entry.request?.uri === '/v1/auth/github/web/callback?[redacted]' && entry.status >= 500));
    };
    await compose('stop', 'auth-api');
    for (const query of ['code=private-code-a&state=private-state-a&error_description=private-description',
      '%63ode=private-code-b&state=private-state-b&code=private-repeat', 'code=private-code-c&state=%zz-private-bad']) {
      const failed = await callback(query); assert.ok([502, 503, 504].includes(failed.status)); await failed.text();
    }
    await assertPrivateLogs(); await main();
    await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'auth-api');
    report.checks.push('callback connection failures redact normal, encoded, repeated and malformed query strings plus sensitive headers in runtime error logs');
    const liveGateway = await readFile(gatewayFile, 'utf8');
    stalledContainer = (await docker(['run', '-d', '--name', project + '-stalled', '--network', ingressNetwork,
      '--network-alias', 'desktop-auth-stalled', '--entrypoint', 'node', 'node:22-bookworm-slim', '-e',
      "require('node:http').createServer((q,s)=>{if(q.url.includes('mode=echo'))s.end(q.url)}).listen(3090,'0.0.0.0')"])).trim();
    assert.match(stalledContainer, /^[a-f0-9]{64}$/);
    const timeoutConfig = liveGateway.replace('desktop-auth-test-api:3090', 'desktop-auth-stalled:3090').replace('response_header_timeout 20s', 'response_header_timeout 250ms');
    await writeFile(gatewayFile, timeoutConfig);
    await compose('exec', '-T', 'web', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile');
    const echoQuery = 'code=private-code-forward&state=private-state-forward&mode=echo';
    let forwarded = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await callback(echoQuery), body = await result.text();
      if (result.status === 200) { forwarded = body; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(forwarded, '/v1/auth/github/web/callback?' + echoQuery);
    const timeoutStart = Date.now(), timedOut = await callback('code=private-code-timeout&state=private-state-timeout');
    assert.ok([502, 504].includes(timedOut.status)); await timedOut.text();
    assert.ok(Date.now() - timeoutStart < 4000);
    await assertPrivateLogs();
    await writeFile(gatewayFile, liveGateway);
    await compose('exec', '-T', 'web', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile');
    await docker(['rm', '-f', '-v', stalledContainer]); stalledContainer = null;
    assert.equal((await proxy()).status, 200);
    report.checks.push('callback header timeout redacts logs while successful proxying preserves original query parameters, then restores the healthy route');
    const blocked = await fetchWithTestCA(`https://127.0.0.1:${gatewayPort}/v1/blog/articles`, { headers: { Host: 'desktop-test.example.org' }, ca: gatewayCertificate, signal: AbortSignal.timeout(10000) });
    assert.equal(blocked.status, 404); assert.equal((await blocked.json()).error.code, 'DESKTOP_AUTH_TEST_ROUTE_DISABLED');
    await compose('restart', 'web');
    let restored = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await proxy()).status === 200) { restored = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(restored, true); await main();
    report.checks.push('gateway restart retains the mounted test route and dedicated ingress');
    await compose('exec', '-T', 'web', 'sh', '-c', "printf 'this is invalid {' > /tmp/invalid.caddyfile");
    await assert.rejects(compose('exec', '-T', 'web', 'caddy', 'reload', '--config', '/tmp/invalid.caddyfile', '--adapter', 'caddyfile'));
    assert.equal((await proxy()).status, 200); await main();
    report.checks.push('invalid Caddy reload is rejected and prior active routes remain available');
    await writeFile(gatewayFile, originalGateway);
    await compose('exec', '-T', 'web', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile');
    await compose('exec', '-T', 'web', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile');
    await main();
    let removed = false;
    try { removed = (await proxy()).status !== 200; } catch { removed = true; }
    assert.equal(removed, true);
    report.checks.push('rollback reload removes test TLS listener and retains existing hostname');
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = redact(error.message);
  if (error.cause?.code) report.cause = error.cause.code;
  if (gateway && started) {
    try { report.gatewayLog = redact((await compose('logs', '--no-color', '--tail', '20', 'web')).slice(-5000)); } catch {}
    try { report.migrationLog = redact((await compose('logs', '--no-color', '--tail', '20', 'auth-migrate')).slice(-3000)); } catch {}
  }
  process.exitCode = 1;
} finally {
  if (stalledContainer && /^[a-f0-9]{64}$/.test(stalledContainer)) {
    try { await docker(['rm', '-f', '-v', stalledContainer]); }
    catch (error) { report.cleanupError = redact(error.message); process.exitCode = 1; }
  }
  // Only this run's randomly named project is removed; never uses the server project.
  if (started) {
    try { await compose('down', '--volumes'); report.cleanedUp = true; }
    catch (error) { report.cleanedUp = false; report.cleanupError = redact(error.message); process.exitCode = 1; }
  }
  if (networkCreated) {
    try { await docker(['network', 'rm', ingressNetwork]); report.ingressCleanedUp = true; }
    catch (error) { report.ingressCleanedUp = false; report.cleanupError = redact(error.message); process.exitCode = 1; }
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, reportFile: path.join(output, 'report.json') }, null, 2));
}
