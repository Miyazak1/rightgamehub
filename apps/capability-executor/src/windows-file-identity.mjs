import crypto from 'node:crypto';
import fs from 'node:fs';
import { fail } from './errors.mjs';

const DECIMAL_UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const IDENTITY_KEYS = ['schemaVersion', 'volumeSerialNumber', 'fileId', 'sizeBytes'];

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function normalizeWindowsFileIdentity(value) {
  if (!exact(value, IDENTITY_KEYS)
    || value.schemaVersion !== 'windows-file-identity-v1'
    || !DECIMAL_UINT64.test(value.volumeSerialNumber ?? '')
    || !DECIMAL_UINT64.test(value.fileId ?? '')
    || !DECIMAL_UINT64.test(value.sizeBytes ?? '')
    || [value.volumeSerialNumber, value.fileId, value.sizeBytes]
      .some(item => BigInt(item) > MAX_UINT64)) {
    fail('CAPABILITY_WINDOWS_FILE_IDENTITY_INVALID', { safeFailure: true });
  }
  return { ...value };
}

export async function inspectWindowsFileHandle(handle) {
  let stats;
  try { stats = await handle.stat({ bigint: true }); }
  catch { fail('CAPABILITY_WINDOWS_FILE_IDENTITY_UNAVAILABLE', { safeFailure: true }); }
  if (!stats.isFile() || stats.isSymbolicLink?.() || stats.dev < 0n || stats.ino < 0n
    || stats.size < 0n || stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail('CAPABILITY_WINDOWS_FILE_IDENTITY_UNAVAILABLE', { safeFailure: true });
  }
  return normalizeWindowsFileIdentity({ schemaVersion: 'windows-file-identity-v1',
    volumeSerialNumber: stats.dev.toString(10), fileId: stats.ino.toString(10),
    sizeBytes: stats.size.toString(10) });
}

export async function openVerifiedWindowsFile(file, expectedIdentity = null) {
  const pathStats = await fs.promises.lstat(file).catch(() => null);
  if (!pathStats?.isFile() || pathStats.isSymbolicLink()) {
    fail('CAPABILITY_WINDOWS_FILE_IDENTITY_UNAVAILABLE', { safeFailure: true });
  }
  let handle;
  try { handle = await fs.promises.open(file, 'r'); }
  catch { fail('CAPABILITY_WINDOWS_FILE_IDENTITY_UNAVAILABLE', { safeFailure: true }); }
  try {
    const identity = await inspectWindowsFileHandle(handle);
    if (expectedIdentity) {
      const expected = normalizeWindowsFileIdentity(expectedIdentity);
      if (identity.volumeSerialNumber !== expected.volumeSerialNumber
        || identity.fileId !== expected.fileId || identity.sizeBytes !== expected.sizeBytes) {
        fail('CAPABILITY_DESKTOP_FILE_GRANT_SOURCE_CHANGED', { safeFailure: true });
      }
    }
    return { handle, identity };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function sha256FromHandle(handle) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}
