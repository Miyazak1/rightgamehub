import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const report = JSON.parse(await fs.readFile(path.join(root, '.runtime/desktop-business-test/latest.json'), 'utf8'));
if (!report.verified || !report.keptRunning || report.productionConnected !== false || !/^mooyu-business-check-\d+$/.test(report.project) ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(report.origin) || !/^http:\/\/localhost:\d+$/.test(report.runtimeOrigin) ||
  !/^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/.test(report.dockerEndpoint)) throw Error('A running local verified business instance is required');
const directory = await fs.mkdtemp(path.join(report.directory, 'electron-'));
const executable = path.resolve(root, '../../.runtime/electron-v44.4.5-win32-x64/electron.exe');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const checks = [];
for (const phase of ['initial', 'restore']) {
  const file = path.join(directory, phase + '-config.json');
  await fs.writeFile(file, JSON.stringify({ ...report, assetRoot: path.join(report.source, '.runtime/desktop-shell/web'),
    accountApiOrigin: report.origin, accountEnvironment: 'local-test',
    businessRuntime: { domain: 'localhost', scheme: 'http', port: Number(new URL(report.runtimeOrigin).port) },
    profileRoot: path.join(directory, 'profile'), phase, report: path.join(directory, phase + '.json') }));
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [path.join(root, 'tests/desktop/electron-business-database.cjs'), '--config', file],
      { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    const timeout = setTimeout(() => { child.kill(); reject(Error('Database-backed desktop acceptance timed out')); }, 120000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error('Database-backed desktop phase failed: ' + phase)); });
  });
  checks.push(...JSON.parse(await fs.readFile(path.join(directory, phase + '.json'), 'utf8')).checks);
}
const result = { verified: true, directory, project: report.project, checks, productionConnected: false, realGitHubInvoked: false };
await fs.writeFile(path.join(root, '.runtime/desktop-business-test/electron-latest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
