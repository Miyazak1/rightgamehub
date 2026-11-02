import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBusinessApiFixture } from '../tests/desktop/business-api-fixture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.runtime/desktop-shell');
await fs.mkdir(base, { recursive: true });
const directory = await fs.mkdtemp(path.join(base, 'business-acceptance-'));
const codeFile = path.join(directory, 'fixture-otp.txt');
const backend = await createBusinessApiFixture({ onMail: code => fs.writeFile(codeFile, code), slowQuery: true });
const executable = path.resolve(root, '../../.runtime/electron-v44.4.5-win32-x64/electron.exe');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
try {
  for (const phase of ['business', 'account-only']) {
    backend.accountOnly(phase === 'account-only');
    const file = path.join(directory, phase + '-config.json');
    await fs.writeFile(file, JSON.stringify({ assetRoot: path.join(base, 'web'),
      profileRoot: path.join(directory, phase + '-profile'), accountApiOrigin: backend.origin,
      accountEnvironment: 'local-test', report: path.join(directory, phase + '.json'), codeFile, phase }));
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [path.join(root, 'tests/desktop/electron-business-acceptance.cjs'), '--config', file],
        { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      const timer = setTimeout(() => { child.kill(); reject(Error('Desktop business acceptance timed out')); }, 150000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Desktop business acceptance failed: ' + phase + '; report=' + directory)); });
    });
  }
  const reports = await Promise.all(['business', 'account-only'].map(p => fs.readFile(path.join(directory, p + '.json'), 'utf8').then(JSON.parse)));
  const report = { verified: true, directory, checks: reports.flatMap(r => r.checks),
    server: 'loopback-contract-fixture-with-product-auth-service', productionConnected: false, deployed: false };
  await fs.writeFile(path.join(base, 'business-verification-latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await backend.close(); }
