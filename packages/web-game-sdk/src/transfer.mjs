// These limits measure decoded payload bytes. The JSON envelope remains <= 32 KiB.
export const GAME_TRANSFER_CHUNK_BYTES = 16 * 1024;
export const GAME_TRANSFER_MAX_BYTES = 2 * 1024 * 1024;
export const GAME_TRANSFER_TTL_MS = 5 * 60 * 1000;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const sha256Hex = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
export function encodeChunk(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > GAME_TRANSFER_CHUNK_BYTES) fail('TRANSFER_CHUNK_INVALID', 'Chunk exceeds 16 KiB.');
  return btoa(String.fromCharCode(...bytes));
}
export function decodeChunk(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(GAME_TRANSFER_CHUNK_BYTES / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    fail('TRANSFER_CHUNK_INVALID', 'Chunk must be canonical Base64.');
  }
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (bytes.length > GAME_TRANSFER_CHUNK_BYTES || encodeChunk(bytes) !== encoded) fail('TRANSFER_CHUNK_INVALID', 'Chunk must be canonical Base64.');
  return bytes;
}

/** A connection owns exactly one transfer. A scope is supplied by a trusted handler. */
export function createGameTransfer({ maxBytes = 256 * 1024, clock = Date.now, ids = () => crypto.randomUUID(), digest = sha256Hex } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > GAME_TRANSFER_MAX_BYTES) throw new TypeError('Invalid transfer bound.');
  let current = null;
  let closed = false;
  const sweep = () => { if (current && clock() - current.touchedAt >= GAME_TRANSFER_TTL_MS) current = null; };
  const requireCurrent = (scope, transferId, direction = 'upload') => {
    sweep();
    if (closed || !current || current.id !== transferId || current.scope !== scope || current.direction !== direction) fail('TRANSFER_EXPIRED', 'Transfer is unavailable or expired.');
    return current;
  };
  const status = entry => ({ transferId: entry.id, nextIndex: entry.nextIndex, totalBytes: entry.totalBytes, chunkBytes: GAME_TRANSFER_CHUNK_BYTES });
  return Object.freeze({
    begin(scope, { totalBytes, sha256, contentType = 'application/octet-stream', encoding = 'identity' }) {
      sweep();
      if (closed) fail('TRANSFER_CLOSED', 'Transfer channel is closed.');
      if (current) fail('TRANSFER_BUSY', 'Only one active transfer is allowed.');
      if (!scope || !Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > maxBytes || !/^[a-f0-9]{64}$/u.test(sha256 ?? '')
        || typeof contentType !== 'string' || contentType.length > 128 || encoding !== 'identity') fail('TRANSFER_INVALID', 'Invalid transfer metadata.');
      current = { id: ids(), scope, direction: 'upload', totalBytes, sha256, contentType, encoding, bytes: new Uint8Array(totalBytes), nextIndex: 0, touchedAt: clock(), committing: false };
      return status(current);
    },
    append(scope, { transferId, index, chunk }) {
      const entry = requireCurrent(scope, transferId);
      if (entry.committing) fail('TRANSFER_BUSY', 'Transfer is committing.');
      const count = Math.ceil(entry.totalBytes / GAME_TRANSFER_CHUNK_BYTES);
      if (!Number.isSafeInteger(index) || index < 0 || index > entry.nextIndex || index >= count) fail('TRANSFER_ORDER_INVALID', 'Unexpected chunk index.');
      const bytes = decodeChunk(chunk);
      const offset = index * GAME_TRANSFER_CHUNK_BYTES;
      if (bytes.length !== Math.min(GAME_TRANSFER_CHUNK_BYTES, entry.totalBytes - offset)) fail('TRANSFER_CHUNK_INVALID', 'Unexpected chunk length.');
      if (index < entry.nextIndex) {
        if (bytes.some((byte, i) => byte !== entry.bytes[offset + i])) fail('TRANSFER_REPLAY_MISMATCH', 'Retransmitted chunk differs.');
      } else { entry.bytes.set(bytes, offset); entry.nextIndex += 1; }
      entry.touchedAt = clock(); return status(entry);
    },
    async commit(scope, { transferId, retain = false }) {
      const entry = requireCurrent(scope, transferId);
      if (entry.committing) fail('TRANSFER_BUSY', 'Transfer is committing.');
      if (entry.nextIndex !== Math.ceil(entry.totalBytes / GAME_TRANSFER_CHUNK_BYTES)) fail('TRANSFER_INCOMPLETE', 'Transfer is incomplete.');
      entry.committing = true;
      try {
        const actual = await digest(entry.bytes);
        if (requireCurrent(scope, transferId) !== entry) fail('TRANSFER_EXPIRED', 'Transfer was replaced.');
        if (actual !== entry.sha256) fail('TRANSFER_DIGEST_MISMATCH', 'Transfer digest does not match.');
        if (!retain) current = null;
        return { bytes: entry.bytes, sha256: actual, contentType: entry.contentType, encoding: entry.encoding };
      } catch (error) {
        if (current === entry) current = null;
        throw error;
      }
    },
    reserve(scope) {
      sweep();
      if (closed || current) fail('TRANSFER_BUSY', 'Transfer channel is unavailable.');
      if (!scope) fail('TRANSFER_INVALID', 'A trusted scope is required.');
      current = { id: ids(), scope, direction: 'reserved', touchedAt: clock() };
      return { transferId: current.id };
    },
    async openRead(scope, bytes, contentType = 'application/octet-stream', { reservationId } = {}) {
      sweep();
      if (reservationId) requireCurrent(scope, reservationId, 'reserved');
      if (closed || current && !reservationId) fail('TRANSFER_BUSY', 'Transfer channel is unavailable.');
      if (!scope || !(bytes instanceof Uint8Array) || bytes.length > maxBytes || typeof contentType !== 'string' || contentType.length > 128) fail('TRANSFER_INVALID', 'Invalid read payload.');
      const entry = { id: reservationId ?? ids(), scope, direction: 'download', bytes: bytes.slice(), totalBytes: bytes.length, nextIndex: 0, contentType, touchedAt: clock() };
      current = entry;
      try {
        const sha256 = await digest(entry.bytes);
        requireCurrent(scope, entry.id, 'download');
        return { ...status(entry), sha256, contentType, encoding: 'identity' };
      } catch (error) { if (current === entry) current = null; throw error; }
    },
    read(scope, { transferId, index }) {
      const entry = requireCurrent(scope, transferId, 'download');
      if (!Number.isSafeInteger(index) || index < 0 || index > entry.nextIndex || index >= Math.ceil(entry.totalBytes / GAME_TRANSFER_CHUNK_BYTES)) fail('TRANSFER_ORDER_INVALID', 'Unexpected read index.');
      const offset = index * GAME_TRANSFER_CHUNK_BYTES;
      const chunk = encodeChunk(entry.bytes.subarray(offset, offset + GAME_TRANSFER_CHUNK_BYTES));
      entry.nextIndex = Math.max(entry.nextIndex, index + 1); entry.touchedAt = clock();
      return { transferId, index, chunk, done: offset + GAME_TRANSFER_CHUNK_BYTES >= entry.totalBytes };
    },
    abort(scope, { transferId }) {
      if (current?.id === transferId && current.scope === scope) current = null;
      return { aborted: true };
    },
    close() { closed = true; current = null; },
  });
}
