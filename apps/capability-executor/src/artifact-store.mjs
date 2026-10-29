import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail } from './errors.mjs';

const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;
const CONTRACT_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function renameWithTransientRetry(source, destination) {
  for (let attempt = 0;; attempt += 1) {
    try { await fs.promises.rename(source, destination); return; }
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, json(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await renameWithTransientRetry(temporary, file);
}

async function hashAndCopy(source, destination, maxArtifactBytes) {
  const hash = crypto.createHash('sha256');
  let sizeBytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    sizeBytes += chunk.length;
    if (sizeBytes > maxArtifactBytes) return callback(Object.assign(
      new Error('CAPABILITY_ARTIFACT_SIZE_EXCEEDED'), { code: 'CAPABILITY_ARTIFACT_SIZE_EXCEEDED' }));
    hash.update(chunk);
    callback(null, chunk);
  } });
  await pipeline(fs.createReadStream(source), meter,
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return { sha256: hash.digest('hex'), sizeBytes };
}

async function hashFile(file, maxArtifactBytes) {
  const hash = crypto.createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    sizeBytes += chunk.length;
    if (sizeBytes > maxArtifactBytes) fail('CAPABILITY_ARTIFACT_SIZE_EXCEEDED');
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

export function createLocalArtifactStore({ rootDirectory,
  maxArtifactBytes = 8 * 1024 ** 3 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !Number.isSafeInteger(maxArtifactBytes)
    || maxArtifactBytes < 1 || maxArtifactBytes > 50 * 1024 ** 3) {
    fail('CAPABILITY_ARTIFACT_STORE_CONFIG_INVALID');
  }
  const stagingRoot = path.join(rootDirectory, '.staging');

  const put = async ({ sourcePath, mediaType, contract, metadata = {} }) => {
    if (!path.isAbsolute(sourcePath) || typeof mediaType !== 'string' || mediaType.length > 160
      || !MEDIA_TYPE.test(mediaType) || !object(contract)
      || typeof contract.key !== 'string' || !CONTRACT_KEY.test(contract.key)
      || !Number.isSafeInteger(contract.version) || contract.version < 1
      || !object(metadata) || Object.hasOwn(metadata, 'executor')) {
      fail('CAPABILITY_ARTIFACT_INPUT_INVALID');
    }
    const sourceStats = await fs.promises.lstat(sourcePath).catch(() => null);
    if (!sourceStats?.isFile() || sourceStats.isSymbolicLink()) fail('CAPABILITY_ARTIFACT_SOURCE_INVALID');
    const staging = path.join(stagingRoot, crypto.randomUUID());
    await fs.promises.mkdir(staging, { recursive: true });
    const stagedArtifact = path.join(staging, 'artifact.bin');
    try {
      const content = await hashAndCopy(sourcePath, stagedArtifact, maxArtifactBytes);
      const directory = path.join(rootDirectory, content.sha256.slice(0, 2), content.sha256);
      const artifactFile = path.join(directory, 'artifact.bin');
      const manifestFile = path.join(directory, 'artifact.json');
      if (await fs.promises.stat(directory).then(item => item.isDirectory()).catch(() => false)) {
        const existing = await hashFile(artifactFile, maxArtifactBytes);
        if (existing.sha256 !== content.sha256 || existing.sizeBytes !== content.sizeBytes) {
          fail('CAPABILITY_ARTIFACT_STORE_CORRUPTED');
        }
      } else {
        await fs.promises.mkdir(path.dirname(directory), { recursive: true });
        await atomicJson(path.join(staging, 'artifact.json'), {
          schemaVersion: 'capability-local-artifact-v1', sha256: content.sha256,
          sizeBytes: content.sizeBytes, createdAt: new Date().toISOString(),
        });
        try { await renameWithTransientRetry(staging, directory); }
        catch (error) {
          const concurrentlyCreated = await fs.promises.stat(directory)
            .then(item => item.isDirectory()).catch(() => false);
          if (error?.code !== 'EEXIST' && !concurrentlyCreated) throw error;
          const existing = await hashFile(artifactFile, maxArtifactBytes);
          if (existing.sha256 !== content.sha256 || existing.sizeBytes !== content.sizeBytes) {
            fail('CAPABILITY_ARTIFACT_STORE_CORRUPTED');
          }
        }
      }
      const outputMetadata = { ...structuredClone(metadata), executor: {
        schemaVersion: 'capability-local-artifact-pointer-v1', localArtifactKey: content.sha256,
      } };
      if (Buffer.byteLength(JSON.stringify(outputMetadata), 'utf8') > 8192) {
        fail('CAPABILITY_ARTIFACT_METADATA_TOO_LARGE');
      }
      return { schemaVersion: 'capability-output-ref-v1', artifactId: crypto.randomUUID(),
        storage: 'node-local', sha256: content.sha256, sizeBytes: content.sizeBytes,
        mediaType, contract: structuredClone(contract), metadata: outputMetadata,
        local: { artifactFile, manifestFile } };
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  };

  const resolve = async sha256 => {
    if (!/^[a-f0-9]{64}$/u.test(String(sha256 ?? ''))) fail('CAPABILITY_ARTIFACT_KEY_INVALID');
    const directory = path.join(rootDirectory, sha256.slice(0, 2), sha256);
    const artifactFile = path.join(directory, 'artifact.bin');
    const content = await hashFile(artifactFile, maxArtifactBytes).catch(() => null);
    if (!content || content.sha256 !== sha256) fail('CAPABILITY_ARTIFACT_NOT_FOUND');
    return { artifactFile, sizeBytes: content.sizeBytes };
  };
  return { put, resolve };
}
