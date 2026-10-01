import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_BUILD_LIMITS } from './source-build-policy.mjs';

const errorCode = error => typeof error?.code === 'string' && error.code.length <= 100 ? error.code : 'SOURCE_BUILD_FAILED';

export function createSourceBuildWorker({
  repository,
  githubClient,
  buildRunner,
  quarantineStore,
  storageCapacityService,
  uploadRepository,
  workingRoot,
  enabled = true,
  builderImageDigest,
  ids = () => crypto.randomUUID(),
}) {
  const root = path.resolve(workingRoot);
  return Object.freeze({
    async runOnce({ targetBuildId = null } = {}) {
      if (!enabled) return null;
      const claim = await repository.claimNext({ leaseToken: ids(), targetBuildId });
      if (!claim) return null;
      await fsp.mkdir(root, { recursive: true });
      const working = await fsp.mkdtemp(path.join(root, 'attempt-'));
      const sourcePath = path.join(working, 'source.zip');
      let output = null;
      let objectKey = null;
      try {
        if (!builderImageDigest || claim.builderImageDigest !== builderImageDigest) throw Object.assign(new Error('Queued build does not match the deployed builder image.'), { code: 'BUILDER_IMAGE_CHANGED' });
        const archive = await githubClient.downloadRepositoryArchive(
          claim.installationId, claim.owner, claim.name, claim.commitSha, SOURCE_BUILD_LIMITS.archiveBytes,
        );
        await fsp.writeFile(sourcePath, archive, { flag: 'wx', mode: 0o600 });
        await repository.markBuilding(claim);
        output = await buildRunner.run({
          inputPath: sourcePath,
          plan: claim.config,
          onHeartbeat: () => repository.renewLease({ jobId: claim.jobId, leaseToken: claim.leaseToken }),
        });
        const reservations = await uploadRepository.globalCapacityReservations();
        await storageCapacityService.assertCanAccept({ packageType: 'web_zip', declaredBytes: output.report.artifactBytes, existingReservations: reservations });
        const uploadId = ids();
        objectKey = `quarantine/${uploadId}/${ids()}.zip`;
        await repository.beginArtifact({ claim, uploadId, objectKey, report: output.report });
        const stored = await quarantineStore.putStream(objectKey, fs.createReadStream(output.outputPath), SOURCE_BUILD_LIMITS.outputBytes);
        if (stored.bytes !== output.report.artifactBytes || stored.sha256 !== output.report.artifactSha256) {
          throw Object.assign(new Error('Stored build artifact does not match the builder report.'), { code: 'BUILDER_OUTPUT_INTEGRITY_INVALID' });
        }
        await repository.finishArtifact({ claim, uploadId, validationJobId: ids() });
        return { buildId: claim.id, uploadId, state: 'validating', artifactSha256: stored.sha256, artifactBytes: String(stored.bytes) };
      } catch (error) {
        if (objectKey) await quarantineStore.remove(objectKey).catch(() => {});
        await repository.fail({ claim, errorCode: errorCode(error) }).catch(() => {});
        throw error;
      } finally {
        await output?.cleanup?.().catch(() => {});
        await fsp.rm(working, { recursive: true, force: true }).catch(() => {});
      }
    },
  });
}
