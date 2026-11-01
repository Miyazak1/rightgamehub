import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHttpsAccountFixture } from '../tests/desktop/https-account-fixture.mjs';
import { isolatedAccountProfile } from '../apps/desktop/src/account-configuration.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.runtime/desktop-shell');
await fs.mkdir(base, { recursive: true });
const directory = await fs.mkdtemp(path.join(base, 'https-account-acceptance-'));
const mailbox = path.join(directory, 'test-mailbox.txt');
const server = await createHttpsAccountFixture({ onMail: code => fs.writeFile(mailbox, code) });
const other = await createHttpsAccountFixture();
const env = { ...process.env, NODE_EXTRA_CA_CERTS: fileURLToPath(new URL('../tests/desktop/fixtures/https/loopback-test-cert.pem', import.meta.url)) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_TLS_REJECT_UNAUTHORIZED;
const phases = [];
try {
  for (const phase of ['initial', 'other-server', 'restore', 'signed-out']) {
    const fixture = phase === 'other-server' ? other : server;
    if (phase === 'restore') server.backend.expireAccess();
    const config = path.join(directory, phase + '-config.json'), report = path.join(directory, phase + '.json');
    await fs.writeFile(config, JSON.stringify({ phase, report, mailbox,
      assetRoot: path.join(base, 'web'), profileRoot: isolatedAccountProfile(path.join(directory, 'profiles'), fixture.origin),
      accountApiOrigin: fixture.origin, accountEnvironment: 'isolated-test' }));
    await new Promise((resolve, reject) => {
      const child = spawn(path.resolve(root, '../../.runtime/electron-v44.4.5-win32-x64/electron.exe'),
        [path.join(root, 'tests/desktop/electron-account-acceptance.cjs'), '--config', config],
        { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      const timer = setTimeout(() => { child.kill(); reject(Error('HTTPS account acceptance timed out: ' + phase)); }, 120000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('HTTPS account acceptance failed: ' + phase + '; ' + report)); });
    });
    phases.push(JSON.parse(await fs.readFile(report, 'utf8')));
  }
  assert.equal(server.backend.refreshCount, 1);
  assert.equal(other.requests.filter(r => r.authenticated).length, 0);
  const result = { ok: true, directory, checks: phases.reduce((n, p) => n + p.checks.length, 0),
    refreshCount: server.backend.refreshCount, productionConnected: false,
    realGitHubInvoked: false, requests: server.requests, otherServerRequests: other.requests };
  await fs.writeFile(path.join(base, 'https-account-verification-latest.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, directory, checks: result.checks, refreshCount: result.refreshCount }));
} finally { await server.close(); await other.close(); await fs.rm(mailbox, { force: true }); }
