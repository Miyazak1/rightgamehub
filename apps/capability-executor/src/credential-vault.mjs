import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';

const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$entropy = [Text.Encoding]::UTF8.GetBytes('mooyu-capability-executor-v1')
if ($request.operation -eq 'protect') {
  $plain = [Convert]::FromBase64String([string]$request.value)
  $protected = [Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($protected))
} elseif ($request.operation -eq 'unprotect') {
  $protected = [Convert]::FromBase64String([string]$request.value)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} else { throw 'Unsupported DPAPI operation.' }
`;
const ENCODED_SCRIPT = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');

const recordName = key => {
  if (typeof key !== 'string' || key.length < 1 || key.length > 200) fail('CAPABILITY_VAULT_KEY_INVALID');
  return crypto.createHash('sha256').update(key).digest('hex');
};

function dpapi(operation, value, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(Object.assign(new Error('CAPABILITY_VAULT_DPAPI_FAILED'), {
        code: 'CAPABILITY_VAULT_DPAPI_FAILED', detail: Buffer.concat(errors).toString('utf8').slice(0, 500) }));
      const result = Buffer.concat(output).toString('utf8').trim();
      try { resolve(operation === 'unprotect' ? Buffer.from(result, 'base64').toString('utf8') : result); }
      catch (error) { reject(Object.assign(new Error('CAPABILITY_VAULT_DPAPI_OUTPUT_INVALID', { cause: error }),
        { code: 'CAPABILITY_VAULT_DPAPI_OUTPUT_INVALID' })); }
    });
    const wireValue = operation === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : value;
    child.stdin.end(JSON.stringify({ operation, value: wireValue }));
  });
}

export function createWindowsDpapiCredentialVault({ directory, platform = process.platform,
  spawnImpl = spawn } = {}) {
  if (platform !== 'win32') fail('CAPABILITY_VAULT_PLATFORM_UNSUPPORTED');
  if (!path.isAbsolute(directory)) fail('CAPABILITY_VAULT_DIRECTORY_INVALID');
  const file = key => path.join(directory, `${recordName(key)}.dpapi`);
  const store = async (key, value) => {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024 * 1024) {
      fail('CAPABILITY_VAULT_VALUE_INVALID');
    }
    await fs.promises.mkdir(directory, { recursive: true });
    const protectedValue = await dpapi('protect', value, spawnImpl);
    const target = file(key), temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, protectedValue, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.promises.rename(temporary, target);
  };
  const load = async key => {
    const protectedValue = await fs.promises.readFile(file(key), 'utf8').catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    return protectedValue === null ? null : dpapi('unprotect', protectedValue, spawnImpl);
  };
  const remove = key => fs.promises.rm(file(key), { force: true });
  return { store, load, remove };
}

export function createMemoryCredentialVault() {
  const values = new Map();
  return { async store(key, value) { values.set(key, value); }, async load(key) {
    return values.has(key) ? values.get(key) : null;
  }, async remove(key) { values.delete(key); } };
}
