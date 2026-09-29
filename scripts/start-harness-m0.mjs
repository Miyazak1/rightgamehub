import { readFile, access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const harnessRoot = path.resolve(process.argv[2] || process.env.GAMEHUB_HARNESS_ROOT || 'E:/DEEPSEEKHARNESS');
const cli = path.join(harnessRoot, 'apps/cli/lib/bin.js');
const taskHome = path.join(projectRoot, '.runtime/m0/dsh-home');
const profileName = process.env.GAMEHUB_HARNESS_PROFILE || 'gamehub-m0';
const port = process.env.GAMEHUB_HARNESS_PORT || '3081';
if (!/^gamehub-[a-z0-9-]+$/.test(profileName) || !/^\d{4,5}$/.test(port) || +port > 65535) throw new Error('Invalid test profile or port');
const storageName = profileName === 'gamehub-m0' ? 'gamehub-storage' : `${profileName}-storage`;
const env = { ...process.env, DSH_HOME: taskHome, GAMEHUB_STORAGE_DIR: path.join(projectRoot, '.runtime/m0', storageName) };
const localBin = path.join(harnessRoot, 'node_modules/.bin');
const localPnpm = path.join(localBin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
// Explorer-launched BAT files do not inherit Codex's package-manager PATH.
// Windows treats PATH keys case-insensitively; send exactly one to child processes.
const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path');
const inheritedPath = pathKeys.map(key => env[key]).filter(Boolean).join(path.delimiter);
for (const key of pathKeys) delete env[key];
env[process.platform === 'win32' ? 'Path' : 'PATH'] = [localBin, path.dirname(process.execPath), inheritedPath].filter(Boolean).join(path.delimiter);
let stage = 'checking the local Harness installation';

async function requireFile(file, hint) {
  try { await access(file); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${hint}\nMissing: ${file}`);
    throw error;
  }
}

function run(args, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: projectRoot, env, stdio: quiet ? ['inherit', 'ignore', 'inherit'] : 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Harness exited with code ${code}`)));
  });
}

try {
  await requireFile(cli, 'Harness is not built. Run its start-harness.bat --prepare --rebuild first.');
  await requireFile(localPnpm, 'Harness local pnpm is missing. Run its start-harness.bat --prepare --rebuild to restore dependencies.');
  stage = 'checking the GameHub package';
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'extensions/harness/package.json'), 'utf8'));
  const artifact = path.join(projectRoot, `artifacts/gamehub-harness-plugin-${manifest.version}.tgz`);
  await requireFile(artifact, 'Build the GameHub package first: npm run pack:harness');
  await mkdir(taskHome, { recursive: true });
  console.log(`Using Harness local pnpm: ${localPnpm}`);
  stage = 'preparing the isolated test profile';
  const profile = path.join(taskHome, 'profiles', profileName, 'package.json');
  try { await access(profile); } catch {
    await run(['--profile', profileName, '--from-default-profile', 'web', '--dump-config'], true);
  }
  stage = 'installing the GameHub test package';
  await run(['plugin', '--profile', profileName, 'add', artifact, '--offline', '--ignore-scripts', '--store-dir', path.join(projectRoot, '.runtime/pnpm-store')]);
  console.log('\nGameHub Harness — open the local URL printed by Harness. No model key is needed.');
  console.log('In a session: open the right sidebar, then select GameHub or 本机试验场. Press Ctrl+C to stop.\n');
  stage = 'starting the Harness Web UI';
  await run(['--profile', profileName, '--no-open', '--port', port]);
} catch (error) {
  console.error(`Failed while ${stage}: ${error.message}`);
  process.exitCode = 1;
}
