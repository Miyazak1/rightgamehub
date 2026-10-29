import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail } from './errors.mjs';

export async function downloadCapabilityPackage({ url, destinationDirectory, expectedBytes,
  expectedSha256, fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof url !== 'string' || !url.startsWith('https://') || !path.isAbsolute(destinationDirectory)
    || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1
    || !/^[a-f0-9]{64}$/u.test(String(expectedSha256 ?? '')) || typeof fetchImpl !== 'function') {
    fail('CAPABILITY_PACKAGE_DOWNLOAD_INPUT_INVALID');
  }
  await fs.promises.mkdir(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, `${crypto.randomUUID()}.package.part`);
  let response;
  try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal,
    headers: { accept: 'application/zip,application/octet-stream' } }); }
  catch (error) { throw Object.assign(new Error('CAPABILITY_PACKAGE_DOWNLOAD_FAILED', { cause: error }),
    { code: 'CAPABILITY_PACKAGE_DOWNLOAD_FAILED', retryable: true, safeFailure: true }); }
  if (!response.ok || !response.body) fail('CAPABILITY_PACKAGE_DOWNLOAD_FAILED',
    { retryable: response.status >= 500, safeFailure: true });
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) !== expectedBytes) {
    fail('CAPABILITY_PACKAGE_DOWNLOAD_SIZE_MISMATCH', { safeFailure: true });
  }
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > expectedBytes) return callback(Object.assign(
      new Error('CAPABILITY_PACKAGE_DOWNLOAD_SIZE_MISMATCH'),
      { code: 'CAPABILITY_PACKAGE_DOWNLOAD_SIZE_MISMATCH', safeFailure: true }));
    hash.update(chunk);
    callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), meter,
      fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (bytes !== expectedBytes || hash.digest('hex') !== expectedSha256) {
      fail('CAPABILITY_PACKAGE_DOWNLOAD_HASH_MISMATCH', { safeFailure: true });
    }
    const completed = destination.replace(/\.part$/u, '.zip');
    await fs.promises.rename(destination, completed);
    return completed;
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}
