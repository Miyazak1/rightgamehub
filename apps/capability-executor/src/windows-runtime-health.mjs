import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function probeWindowsSandboxHost({ helperPath, helperSha256,
  platform = process.platform, spawnImpl = spawn, timeoutMs = 15_000 } = {}) {
  if (platform !== 'win32' || !path.isAbsolute(helperPath)
    || !SHA256.test(String(helperSha256 ?? '')) || typeof spawnImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    fail('CAPABILITY_RUNTIME_HEALTH_CONFIG_INVALID');
  }
  const stats = await fs.promises.lstat(helperPath).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink() || await sha256(helperPath) !== helperSha256) {
    fail('CAPABILITY_RUNTIME_HEALTH_HELPER_TAMPERED', { safeFailure: true });
  }
  const child = spawnImpl(helperPath, ['--self-test'], { shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [], errors = [];
  let bytes = 0, errorBytes = 0;
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= 1024 * 1024) chunks.push(chunk); });
  child.stderr.on('data', chunk => {
    if (errorBytes >= 64 * 1024) return;
    const accepted = chunk.subarray(0, 64 * 1024 - errorBytes);
    errorBytes += accepted.length; errors.push(accepted);
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  timer.unref?.();
  let completion;
  try {
    completion = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } finally { clearTimeout(timer); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('CAPABILITY_RUNTIME_HEALTH_PROTOCOL_INVALID', { safeFailure: true }); }
  if (completion.code !== 0 || completion.signal || bytes > 1024 * 1024
    || result?.schemaVersion !== 'windows-sandbox-host-self-test-v1' || result.ok !== true
    || result.restrictedToken !== true || result.jobObject !== true
    || result.appContainerProfile !== true) {
    fail('CAPABILITY_RUNTIME_HEALTH_FAILED', { safeFailure: true,
      cause: Buffer.concat(errors).toString('utf8') });
  }
  return result;
}
