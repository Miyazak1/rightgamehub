import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.runtime/desktop-shell');
await fs.mkdir(base, { recursive: true });
const directory = await fs.mkdtemp(path.join(base, 'acceptance-'));
const executable = path.resolve(root, '../../.runtime/electron-v44.4.5-win32-x64/electron.exe');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const paperIndex = process.argv.indexOf('--paper');
const paperFile = paperIndex >= 0 ? process.argv[paperIndex + 1] : null;
if (paperFile && !path.isAbsolute(paperFile)) throw Error('DESKTOP_TEST_PAPER_PATH_INVALID');
for (const phase of ['initial', 'restart']) {
  const report = path.join(directory, phase + '.json'), configuration = path.join(directory, phase + '-config.json');
  await fs.writeFile(configuration, JSON.stringify({ assetRoot: path.join(base, 'web'), profileRoot: path.join(directory, 'profile'), report, paperFile }));
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [path.join(root, 'tests/desktop/electron-preview-acceptance.cjs'), '--config', configuration, '--phase', phase],
      { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    const timeout = setTimeout(() => { child.kill(); reject(Error('Desktop acceptance timed out')); }, 220000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error('Desktop acceptance failed: ' + phase + '; report=' + report)); });
  });
}
// Exercise the actual product entry as well as imported test helpers. This catches
// Electron default-app loader differences that an imported createShell test cannot.
const entryProfile = path.join(directory, 'entry-profile'), entryConfig = path.join(directory, 'entry-config.json');
await fs.writeFile(entryConfig, JSON.stringify({ assetRoot: path.join(base, 'web'), profileRoot: entryProfile, visible: false }));
const entry = spawn(executable, [path.join(root, 'apps/desktop/electron/main.cjs'), '--config', entryConfig],
  { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let entryExited = false; entry.once('exit', () => { entryExited = true; });
const deadline = Date.now() + 30000;
let entryReady = false;
while (Date.now() < deadline && !entryExited) {
  const events = await fs.readFile(path.join(entryProfile, 'startup.ndjson'), 'utf8').catch(() => '');
  if (events.includes('"window-loaded"')) { entryReady = true; break; }
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!entryExited) { const exited = new Promise(resolve => entry.once('exit', resolve)); entry.kill(); await exited; }
if (!entryReady) throw Error('Product Electron entry did not create and load its window');
console.log('PASS actual product entry starts and loads the shared app');
const result = { verified: true, directory, productEntryVerified: true };
await fs.writeFile(path.join(base, 'verification-latest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
