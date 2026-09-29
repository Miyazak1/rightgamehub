import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateAssetPath, mimeFor, WEB_LIMITS } from './web-package-policy.mjs';

const cliPath = fileURLToPath(new URL('./web-zip-validator-cli.mjs', import.meta.url));
const permanentError = code => /^(ARCHIVE_INTEGRITY_CHANGED|UPLOAD_TOO_LARGE|ZIP_|MANIFEST_|CAPABILITY_|ENTRY_|PACKAGE_INVALID|VALIDATOR_REPORT_INVALID)/.test(code ?? '');
const sha256File = input => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const stream = fs.createReadStream(input);
  stream.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
  stream.on('error', reject);
  stream.on('end', () => resolve({ bytes, sha256: hash.digest('hex') }));
});

function validateReport(report) {
  if (!report || typeof report !== 'object' || report.policyVersion !== 1 || typeof report.entry !== 'string' || !report.assets || typeof report.assets !== 'object') throw Object.assign(new Error('Validator returned an invalid report.'), { code: 'VALIDATOR_REPORT_INVALID' });
  const names = Object.keys(report.assets);
  if (names.length !== report.fileCount || names.length < 1 || names.length > WEB_LIMITS.files || !Number.isSafeInteger(report.totalBytes) || report.totalBytes < 1 || report.totalBytes > WEB_LIMITS.totalBytes) throw Object.assign(new Error('Validator report limits are invalid.'), { code: 'VALIDATOR_REPORT_INVALID' });
  let total = 0;
  for (const name of names) {
    validateAssetPath(name);
    const asset = report.assets[name];
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > WEB_LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.mime !== mimeFor(name)) throw Object.assign(new Error('Validator asset report is invalid.'), { code: 'VALIDATOR_REPORT_INVALID' });
    total += asset.size;
  }
  if (total !== report.totalBytes || !report.assets[report.entry] || !Array.isArray(report.approvedCapabilities)) throw Object.assign(new Error('Validator report totals or entry are invalid.'), { code: 'VALIDATOR_REPORT_INVALID' });
  return report;
}

function runParser({ input, output, onHeartbeat }) {
  return new Promise((resolve, reject) => {
    const childEnvironment = Object.fromEntries(['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG'].flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
    const child = spawn(process.execPath, [cliPath, input, output], { cwd: path.dirname(cliPath), env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const stop = error => { if (!settled) { settled = true; child.kill(); reject(error); } };
    const timeout = setTimeout(() => stop(Object.assign(new Error('ZIP validation timed out.'), { code: 'VALIDATION_TIMEOUT' })), WEB_LIMITS.timeoutMs);
    const heartbeat = setInterval(async () => {
      try { if (!(await onHeartbeat())) stop(Object.assign(new Error('Validation lease was lost.'), { code: 'LEASE_LOST' })); }
      catch (error) { stop(Object.assign(error, { code: error.code ?? 'LEASE_RENEW_FAILED' })); }
    }, 10_000);
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > 8 * 1024 * 1024) stop(Object.assign(new Error('Validator report is too large.'), { code: 'VALIDATOR_REPORT_INVALID' }));
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => { if (stderr.reduce((sum, value) => sum + value.length, 0) < 64 * 1024) stderr.push(chunk); });
    child.on('error', stop);
    child.on('close', code => {
      clearTimeout(timeout); clearInterval(heartbeat);
      if (settled) return;
      settled = true;
      let result;
      try { result = JSON.parse(Buffer.concat(stdout).toString('utf8')); } catch { return reject(Object.assign(new Error('Validator returned malformed JSON.'), { code: 'VALIDATOR_REPORT_INVALID' })); }
      if (code !== 0 || !result.ok) return reject(Object.assign(new Error(result.error?.message ?? Buffer.concat(stderr).toString('utf8') ?? 'Validation failed.'), { code: result.error?.code ?? 'PACKAGE_INVALID' }));
      resolve(validateReport(result.report));
    });
  });
}

export function createValidationWorker({ repository, quarantineStore, runtimeStore, validatorRoot, ids = () => crypto.randomUUID() }) {
  const root = path.resolve(validatorRoot);
  return {
    async runOnce({ targetUploadId = null } = {}) {
      const claim = await repository.claimNext({ leaseToken: ids(), releaseId: ids(), targetUploadId });
      if (!claim) return null;
      await fsp.mkdir(root, { recursive: true });
      const working = await fsp.mkdtemp(path.join(root, 'attempt-'));
      try {
        const input = quarantineStore.pathFor(claim.objectKey);
        const archive = await sha256File(input);
        if (archive.bytes !== claim.actualBytes || archive.sha256 !== claim.actualSha256) throw Object.assign(new Error('Quarantine object changed after upload.'), { code: 'ARCHIVE_INTEGRITY_CHANGED' });
        const output = path.join(working, 'output');
        const report = await runParser({ input, output, onHeartbeat: () => repository.renewLease({ jobId: claim.jobId, leaseToken: claim.leaseToken }) });
        const published = await runtimeStore.publishAttempt({ releaseId: claim.releaseId, attemptId: claim.leaseToken, sourceDirectory: output, report });
        return await repository.complete({ claim, published });
      } catch (error) {
        const failure = { jobId: claim.jobId, leaseToken: claim.leaseToken, uploadId: claim.uploadId, errorCode: error.code ?? 'VALIDATION_FAILED' };
        if (permanentError(failure.errorCode)) await repository.fail(failure).catch(() => {});
        else await repository.retry(failure).catch(() => {});
        throw error;
      } finally {
        await fsp.rm(working, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
