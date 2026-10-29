import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail } from './errors.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function validUrl(value, allowInsecureLocalhost) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || allowInsecureLocalhost === true && url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch { return false; }
}

const DOWNLOAD_PROFILES = Object.freeze({
  runtime: Object.freeze({ completedSuffix: '.zip', metadataSchema: 'runtime-download-part-v1',
    accept: 'application/zip,application/octet-stream', errorPrefix: 'CAPABILITY_RUNTIME_DOWNLOAD' }),
  component: Object.freeze({ completedSuffix: '.component',
    metadataSchema: 'component-download-part-v1', accept: 'application/octet-stream',
    errorPrefix: 'CAPABILITY_COMPONENT_DOWNLOAD' }),
});

async function downloadResumable({ url, destinationDirectory, expectedBytes,
  expectedSha256, fetchImpl = globalThis.fetch, signal, allowInsecureLocalhost = false }, profile) {
  const code = suffix => `${profile.errorPrefix}_${suffix}`;
  if (!validUrl(url, allowInsecureLocalhost) || !path.isAbsolute(destinationDirectory)
    || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1
    || !SHA256.test(String(expectedSha256 ?? '')) || typeof fetchImpl !== 'function') {
    fail(code('INPUT_INVALID'));
  }
  await fs.promises.mkdir(destinationDirectory, { recursive: true });
  const base = path.join(destinationDirectory, expectedSha256);
  const completed = `${base}${profile.completedSuffix}`, partial = `${base}.part`;
  const metadataFile = `${base}.part.json`;
  const completedStats = await fs.promises.stat(completed).catch(() => null);
  if (completedStats?.isFile() && completedStats.size === expectedBytes
    && await sha256(completed) === expectedSha256) return completed;
  if (completedStats) await fs.promises.rm(completed, { force: true });

  let offset = 0, priorEtag = null;
  const partialStats = await fs.promises.stat(partial).catch(() => null);
  if (partialStats?.isFile() && partialStats.size < expectedBytes) {
    let metadata;
    try { metadata = JSON.parse(await fs.promises.readFile(metadataFile, 'utf8')); } catch {}
    if (metadata?.schemaVersion === profile.metadataSchema && metadata.url === url
      && metadata.expectedBytes === expectedBytes && metadata.expectedSha256 === expectedSha256) {
      offset = partialStats.size; priorEtag = metadata.etag ?? null;
    } else {
      await fs.promises.rm(partial, { force: true });
      await fs.promises.rm(metadataFile, { force: true });
    }
  } else if (partialStats) {
    await fs.promises.rm(partial, { force: true });
    await fs.promises.rm(metadataFile, { force: true });
  }
  const requestHeaders = { accept: profile.accept };
  if (offset > 0) {
    requestHeaders.range = `bytes=${offset}-`;
    if (priorEtag) requestHeaders['if-range'] = priorEtag;
  }
  let response;
  try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal, headers: requestHeaders }); }
  catch (error) { throw Object.assign(new Error(code('FAILED'), { cause: error }),
    { code: code('FAILED'), retryable: true, safeFailure: true }); }
  if (!response.ok || !response.body) fail(code('FAILED'),
    { retryable: response.status >= 500, safeFailure: true });
  const etag = response.headers.get('etag');
  if (offset > 0) {
    const range = response.headers.get('content-range');
    if (response.status !== 206 || !range?.startsWith(`bytes ${offset}-`)
      || priorEtag && etag && priorEtag !== etag) offset = 0;
  }
  if (offset === 0 && response.status === 206) fail(code('RANGE_INVALID'));
  const advertised = response.headers.get('content-length');
  if (advertised !== null && Number(advertised) !== expectedBytes - offset) {
    fail(code('SIZE_MISMATCH'), { safeFailure: true });
  }
  await fs.promises.writeFile(metadataFile, json({ schemaVersion: profile.metadataSchema,
    url, expectedBytes, expectedSha256, etag }), { encoding: 'utf8', mode: 0o600 });
  let received = offset;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    if (received > expectedBytes) return callback(Object.assign(
      new Error(code('SIZE_MISMATCH')),
      { code: code('SIZE_MISMATCH'), safeFailure: true }));
    callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), meter,
      fs.createWriteStream(partial, { flags: offset > 0 ? 'a' : 'w', mode: 0o600 }));
  } catch (error) {
    // A transport interruption intentionally leaves the verified-length partial for a later Range request.
    throw error;
  }
  if (received !== expectedBytes) fail(code('SIZE_MISMATCH'), { safeFailure: true });
  if (await sha256(partial) !== expectedSha256) {
    await fs.promises.rm(partial, { force: true });
    await fs.promises.rm(metadataFile, { force: true });
    fail(code('HASH_MISMATCH'), { safeFailure: true });
  }
  await fs.promises.rename(partial, completed);
  await fs.promises.rm(metadataFile, { force: true });
  return completed;
}

export async function downloadFileResumable(options = {}) {
  return downloadResumable(options, DOWNLOAD_PROFILES.runtime);
}

export async function downloadComponentFileResumable(options = {}) {
  return downloadResumable(options, DOWNLOAD_PROFILES.component);
}
