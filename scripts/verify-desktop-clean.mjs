import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const scopeArgument = process.argv.length === 4 && process.argv[2] === '--scope' ? path.resolve(process.argv[3]) : null;
if (process.argv.length !== 2 && !scopeArgument) throw Error('CLEAN_CHECK_ARGUMENTS');
if (scopeArgument && !scopeArgument.startsWith(root + path.sep) && !scopeArgument.startsWith(root)) throw Error('CLEAN_SCOPE_OUTSIDE_WORKSPACE');
const scope = JSON.parse(await fs.readFile(scopeArgument ?? path.join(root, 'scripts/desktop-auth-scope.json'), 'utf8'));
const parent = path.join(root, '.runtime/desktop-auth-clean');
await fs.mkdir(parent, { recursive: true });
const directory = await fs.mkdtemp(path.join(parent, 'check-'));
const clean = path.join(directory, 'source');
await fs.mkdir(clean);
const report = { passed: false, directory, files: scope.files.length, productionConnected: false };
async function run(command, args, cwd, logName) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (scope.offlinePaperTests === true) for (const key of ['QA_LEDGER_TEST_ISOLATED', 'QA_LEDGER_TEST_URL', 'DATABASE_URL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL']) delete env[key];
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('CLEAN_CHECK_TIMEOUT: ' + logName)); }, 180000);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', async code => {
      clearTimeout(timer);
      try { await fs.writeFile(path.join(directory, logName + '.txt'), output); }
      catch (error) { reject(error); return; }
      if (code !== 0) reject(Error('CLEAN_CHECK_FAILED: ' + logName)); else resolve(output);
    });
  });
}
const exists = async file => fs.access(file).then(() => true, () => false);
const inside = (base, target) => { const relative = path.relative(base, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

try {
  await run('git', ['archive', '--format=tar', '--output=' + path.join(directory, 'head.tar'), 'HEAD'], root, 'archive');
  await run('tar', ['-xf', path.join(directory, 'head.tar'), '-C', clean], root, 'extract');
  const unique = new Set();
  for (const file of scope.files) {
    const target = path.resolve(clean, file);
    if (!inside(clean, target) || file.startsWith('.runtime/') || unique.has(file) || scope.deferred.includes(file)) throw Error('CLEAN_SCOPE_INVALID');
    unique.add(file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(root, file), target);
  }
  for (const exclusion of scope.excludeLines ?? []) {
    if (!unique.has(exclusion.file) || !Array.isArray(exclusion.lines)) throw Error('CLEAN_EXCLUSION_INVALID');
    const file = path.join(clean, exclusion.file), text = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, text.split(/\r?\n/).filter(line => !exclusion.lines.includes(line.trim())).join('\n'));
  }
  // Vendor code may be reused. Internal workspace packages must resolve to the
  // exported tree, never to unrelated uncommitted sources through a junction.
  const folders = ['.'];
  for (const parentName of ['apps', 'packages', 'extensions']) {
    for (const item of await fs.readdir(path.join(root, parentName), { withFileTypes: true })) if (item.isDirectory()) folders.push(path.join(parentName, item.name));
  }
  const link = async (source, target) => {
    const real = await fs.realpath(source);
    const workspace = inside(root, real) && !path.relative(root, real).split(path.sep).includes('node_modules');
    const resolved = workspace ? path.resolve(clean, path.relative(root, real)) : real;
    if (!await exists(resolved)) throw Error('CLEAN_WORKSPACE_DEPENDENCY_MISSING');
    await fs.symlink(resolved, target, process.platform === 'win32' ? 'junction' : 'dir');
  };
  for (const folder of folders) {
    const source = path.join(root, folder, 'node_modules'), target = path.join(clean, folder, 'node_modules');
    if (!await exists(source) || !await exists(path.dirname(target))) continue;
    await fs.mkdir(target, { recursive: true });
    for (const item of await fs.readdir(source, { withFileTypes: true })) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      if (item.name.startsWith('@')) {
        await fs.mkdir(path.join(target, item.name), { recursive: true });
        for (const name of await fs.readdir(path.join(source, item.name))) await link(path.join(source, item.name, name), path.join(target, item.name, name));
      } else await link(path.join(source, item.name), path.join(target, item.name));
    }
  }
  if (scope.regenerateInventory === true) await run(process.execPath, ['scripts/audit-desktop-web-reuse.mjs'], clean, 'inventory-generate');
  await run(process.execPath, ['scripts/audit-desktop-web-reuse.mjs', '--check'], clean, 'inventory');
  report.inventoryPassed = true;
  const output = await run(process.execPath, ['--test', ...scope.tests], clean, 'tests');
  report.tests = Number(/^# tests (\d+)/m.exec(output)?.[1]);
  report.failed = Number(/^# fail (\d+)/m.exec(output)?.[1]);
  report.skipped = Number(/^# skipped (\d+)/m.exec(output)?.[1]);
  await run(process.execPath, ['scripts/build-desktop-shell.mjs'], clean, 'build');
  report.buildPassed = true; report.passed = report.failed === 0;
} catch (error) { report.error = error.message; process.exitCode = 1; }
await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(parent, 'latest.json'), JSON.stringify({ ...report, reportFile: path.join(directory, 'report.json') }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
