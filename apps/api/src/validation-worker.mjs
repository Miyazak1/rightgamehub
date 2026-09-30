import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { validateAssetPath, mimeFor, WEB_LIMITS } from './web-package-policy.mjs';
import { validateWindowsExecutable } from './windows-exe-validator.mjs';
import { runLocalWebValidator } from './web-validation-runner.mjs';

const permanentError = code => /^(ARCHIVE_INTEGRITY_CHANGED|UPLOAD_TOO_LARGE|ZIP_|MANIFEST_|CAPABILITY_|ENTRY_|PACKAGE_INVALID|VALIDATOR_REPORT_INVALID|EXE_)/.test(code ?? '');
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

export function createValidationWorker({ repository, quarantineStore, runtimeStore, validatorRoot, validationRunner = { run: runLocalWebValidator }, ids = () => crypto.randomUUID() }) {
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
        let published;
        if (claim.targetKey === 'web' && claim.packageType === 'web_zip') {
          const output = path.join(working, 'output');
          const report = validateReport(await validationRunner.run({
            inputPath: input,
            objectKey: claim.objectKey,
            outputDirectory: output,
            onHeartbeat: () => repository.renewLease({ jobId: claim.jobId, leaseToken: claim.leaseToken }),
          }));
          published = await runtimeStore.publishAttempt({ releaseId: claim.releaseId, attemptId: claim.leaseToken, sourceDirectory: output, report });
        } else if (claim.targetKey === 'windows-x64' && claim.packageType === 'windows_standalone_exe') {
          const manifest = await validateWindowsExecutable(input, claim.fileName);
          await repository.renewLease({ jobId: claim.jobId, leaseToken: claim.leaseToken });
          published = { prefix: null, manifest, manifestSha256: null };
        } else {
          throw Object.assign(new Error('Package target is unsupported.'), { code: 'PACKAGE_INVALID' });
        }
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
