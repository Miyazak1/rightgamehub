import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';

const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HOST_ENVIRONMENT_KEYS = ['ALLUSERSPROFILE', 'APPDATA', 'ComSpec', 'LOCALAPPDATA', 'PATH',
  'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP',
  'USERPROFILE', 'WINDIR'];

const hostEnvironment = () => Object.fromEntries(HOST_ENVIRONMENT_KEYS
  .filter(key => typeof process.env[key] === 'string' && process.env[key].length > 0)
  .map(key => [key, process.env[key]]));

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function boundedCollector(stream, maximum, stop) {
  const chunks = [];
  let bytes = 0;
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= maximum) chunks.push(chunk);
      else stop('CAPABILITY_SANDBOX_DIAGNOSTIC_LIMIT');
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ bytes, value: Buffer.concat(chunks).toString('utf8') }));
  });
}

function validateRunSpec(spec) {
  const permissions = spec?.permissions;
  if (!object(spec) || !path.isAbsolute(spec.executable)
    || !path.isAbsolute(spec.installationRoot) || !path.isAbsolute(spec.workingDirectory)
    || !path.isAbsolute(spec.cancellationFile) || !Array.isArray(spec.arguments)
    || spec.arguments.some(value => typeof value !== 'string') || !object(spec.environment)
    || !Array.isArray(spec.fileGrants)
    || spec.readOnlyResources != null && !Array.isArray(spec.readOnlyResources) || !object(permissions)
    || !Array.isArray(permissions.networkDomains) || !Array.isArray(permissions.devices)
    || !object(spec.resources) || !object(spec.dataPolicy)
    || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1000
    || !Number.isSafeInteger(spec.maxDiagnosticBytes) || spec.maxDiagnosticBytes < 1024
    || spec.signal != null && !(spec.signal instanceof AbortSignal)) {
    fail('CAPABILITY_SANDBOX_RUN_INVALID', { safeFailure: true });
  }
  if (permissions.networkDomains.length !== 0 || permissions.devices.length !== 0) {
    fail('CAPABILITY_SANDBOX_POLICY_UNSUPPORTED', { safeFailure: true });
  }
}

function normalizeResult(value, requestId, stderr) {
  if (!object(value) || value.schemaVersion !== 'windows-sandbox-host-result-v1'
    || value.requestId !== requestId || typeof value.ok !== 'boolean') {
    fail('CAPABILITY_SANDBOX_PROTOCOL_INVALID', { safeFailure: true, cause: stderr });
  }
  if (!value.ok) {
    fail(typeof value.errorCode === 'string' ? value.errorCode : 'CAPABILITY_SANDBOX_HOST_FAILED', {
      safeFailure: value.started !== true,
      cause: `${stderr || value.message || ''}${value.win32Error ? ` (win32=${value.win32Error})` : ''}`,
    });
  }
  const result = value.process;
  if (!object(result) || !Number.isSafeInteger(result.exitCode)
    || !['exited', 'timeout', 'cancelled', 'diagnostic-limit', 'disk-limit'].includes(result.terminationReason)
    || !Number.isSafeInteger(result.stdoutBytes) || result.stdoutBytes < 0
    || !Number.isSafeInteger(result.stderrBytes) || result.stderrBytes < 0) {
    fail('CAPABILITY_SANDBOX_PROTOCOL_INVALID', { safeFailure: true });
  }
  return { exitCode: result.exitCode, terminationReason: result.terminationReason,
    stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes };
}

export function createWindowsSandboxHost({ helperPath, helperSha256, platform = process.platform,
  spawnImpl = spawn, cancellationRoot = path.join(os.tmpdir(), 'mooyu-capability-cancel'),
  hardStopGraceMs = 3_000 } = {}) {
  if (platform !== 'win32' || !path.isAbsolute(helperPath) || !HEX_SHA256.test(String(helperSha256 ?? ''))
    || typeof spawnImpl !== 'function' || !path.isAbsolute(cancellationRoot)
    || !Number.isSafeInteger(hardStopGraceMs) || hardStopGraceMs < 500 || hardStopGraceMs > 30_000) {
    fail('CAPABILITY_SANDBOX_HOST_CONFIG_INVALID');
  }
  let verified = false;
  const verifyHelper = async () => {
    const stats = await fs.promises.lstat(helperPath).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink() || await sha256(helperPath) !== helperSha256) {
      fail('CAPABILITY_SANDBOX_HOST_TAMPERED', { safeFailure: true });
    }
    verified = true;
  };
  const run = async spec => {
    const requestId = crypto.randomUUID();
    const cancellationFile = path.join(cancellationRoot, `${requestId}.cancel`);
    validateRunSpec({ ...spec, cancellationFile });
    if (spec.signal?.aborted) fail('CAPABILITY_NATIVE_RUN_CANCELLED', { safeFailure: true });
    if (!verified) await verifyHelper();
    else if (await sha256(helperPath) !== helperSha256) {
      verified = false;
      fail('CAPABILITY_SANDBOX_HOST_TAMPERED', { safeFailure: true });
    }
    await fs.promises.mkdir(cancellationRoot, { recursive: true });
    await fs.promises.rm(cancellationFile, { force: true }).catch(() => {});
    const request = { schemaVersion: 'windows-sandbox-host-request-v4', requestId,
      executable: spec.executable, installationRoot: spec.installationRoot,
      arguments: spec.arguments, workingDirectory: spec.workingDirectory,
      environment: spec.environment, fileGrants: spec.fileGrants,
      readOnlyResources: spec.readOnlyResources ?? [],
      permissions: spec.permissions, resources: spec.resources, dataPolicy: spec.dataPolicy,
      timeoutMs: spec.timeoutMs, maxDiagnosticBytes: spec.maxDiagnosticBytes, cancellationFile };
    const child = spawnImpl(helperPath, [], { shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], env: hostEnvironment() });
    let stopCode = null;
    let hardStopTimer;
    const stop = code => {
      if (stopCode) return;
      stopCode = code;
      fs.writeFileSync(cancellationFile, code, { encoding: 'utf8', flag: 'w' });
      hardStopTimer = setTimeout(() => child.kill(), hardStopGraceMs);
      hardStopTimer.unref?.();
    };
    const abort = () => stop('CAPABILITY_NATIVE_RUN_CANCELLED');
    spec.signal?.addEventListener('abort', abort, { once: true });
    const stdout = boundedCollector(child.stdout, 4 * 1024 * 1024, stop);
    const stderr = boundedCollector(child.stderr, spec.maxDiagnosticBytes, stop);
    const completion = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    child.stdin.end(JSON.stringify(request));
    try {
      const [{ code, signal }, protocol, diagnostics] = await Promise.all([completion, stdout, stderr]);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      if (stopCode && !protocol.value) fail(stopCode, { safeFailure: true, cause: diagnostics.value });
      let value;
      try { value = JSON.parse(protocol.value); }
      catch { fail('CAPABILITY_SANDBOX_PROTOCOL_INVALID', { safeFailure: true,
        cause: diagnostics.value || `${code ?? ''}:${signal ?? ''}` }); }
      return normalizeResult(value, requestId, diagnostics.value);
    } finally {
      spec.signal?.removeEventListener('abort', abort);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      await fs.promises.rm(cancellationFile, { force: true }).catch(() => {});
    }
  };
  return { capabilities: { schemaVersion: 'windows-sandbox-host-capabilities-v1', platform: 'win32',
    features: { restrictedToken: true, jobObject: true, filesystemProjection: true,
      networkIsolation: true, deviceIsolation: true, processTreeTermination: true } }, run };
}
