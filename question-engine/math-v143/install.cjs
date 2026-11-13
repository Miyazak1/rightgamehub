'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const manifest = require('./integration.json');
const root = path.resolve(__dirname, '../..');
const runtimeDirectory = path.join(root, manifest.runtimeDirectory);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function verifyArchive() {
  const archive = path.join(root, manifest.archive);
  if (sha(fs.readFileSync(archive)) !== manifest.archiveSha256) throw Error('math_lab_archive_digest_mismatch');
  return archive;
}

function verifyRuntime(directory = runtimeDirectory) {
  const release = fs.readFileSync(path.join(directory, 'RELEASE-FILES.sha256'));
  if (sha(release) !== manifest.releaseManifestSha256) throw Error('math_lab_release_manifest_digest_mismatch');
  const lines = release.toString('utf8').trim().split(/\r?\n/);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) throw Error('math_lab_release_manifest_invalid');
    const target = path.resolve(directory, match[2]);
    if (!target.startsWith(path.resolve(directory) + path.sep)) throw Error('math_lab_release_path_invalid');
    if (sha(fs.readFileSync(target)) !== match[1]) throw Error('math_lab_runtime_digest_mismatch:' + match[2]);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.applicationVersion) throw Error('math_lab_version_mismatch');
  return { version: pkg.version, verifiedFiles: lines.length, archiveSha256: manifest.archiveSha256 };
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: runtimeDirectory, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('math_lab_setup_command_failed:' + executable);
}

function install({ dependencies = true } = {}) {
  const archive = verifyArchive();
  if (!fs.existsSync(runtimeDirectory)) {
    fs.mkdirSync(path.dirname(runtimeDirectory), { recursive: true });
    // Both paths are fixed by the checked-in manifest, never supplied by an API request.
    if (process.platform === 'win32') {
      const quote = value => "'" + value.replace(/'/g, "''") + "'";
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(runtimeDirectory)})`], { cwd: root });
    } else {
      run('unzip', ['-q', archive, '-d', runtimeDirectory], { cwd: root });
    }
  }
  const verified = verifyRuntime();
  if (dependencies && !fs.existsSync(path.join(runtimeDirectory, 'node_modules', '.package-lock.json'))) {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { shell: process.platform === 'win32' });
  }
  return verified;
}

if (require.main === module) {
  try { console.log(JSON.stringify(install({ dependencies: !process.argv.includes('--no-dependencies') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { root, runtimeDirectory, verifyArchive, verifyRuntime, install };
