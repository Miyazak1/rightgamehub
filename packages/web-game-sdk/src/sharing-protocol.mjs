export const SHARE_PAYLOAD_BYTES = 16 * 1024;
export const FILE_EXPORT_BYTES = 2 * 1024 * 1024;
export const SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]{32}$/u;
export function capabilityError(code, message, retryable = false) { return Object.assign(new Error(message), { code, retryable }); }
export function validateJson(value, { maxBytes = SHARE_PAYLOAD_BYTES, maxNodes = 2000 } = {}) {
  let nodes = 0;
  const walk = (item, depth) => {
    if (++nodes > maxNodes || depth > 12) throw capabilityError('SHARE_PAYLOAD_INVALID', 'JSON 结构过深或过大。');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string' && item.length <= maxBytes) return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (const child of item) walk(child, depth + 1); return; }
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      for (const [key, child] of Object.entries(item)) {
        if (key.length > 128 || ['__proto__','prototype','constructor'].includes(key)) throw capabilityError('SHARE_PAYLOAD_INVALID', 'JSON 字段无效。');
        walk(child, depth + 1);
      }
      return;
    }
    throw capabilityError('SHARE_PAYLOAD_INVALID', '只允许有限的 JSON 数据。');
  };
  walk(value, 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > maxBytes) throw capabilityError('SHARE_PAYLOAD_INVALID', 'JSON 数据超出大小限制。');
  return text;
}
export function validateShare(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(key => !['title','payload'].includes(key))
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || /[\u0000-\u001f\u007f]/u.test(input.title)
    || !input.payload || Array.isArray(input.payload) || typeof input.payload !== 'object') throw capabilityError('SHARE_PAYLOAD_INVALID', '分享需要 1–120 字标题和 JSON 对象。');
  validateJson(input.payload);
  return { title: input.title.trim(), payload: JSON.parse(JSON.stringify(input.payload)) };
}
export function validateFileExport(input) {
  const fail = () => { throw capabilityError('FILE_EXPORT_INVALID', '仅支持安全文件名的 PNG（2 MiB 内）或 JSON（256 KiB 内）。'); };
  if (!input || Object.keys(input).some(key => !['filename','mimeType','data'].includes(key))) fail();
  const { filename, mimeType, data } = input;
  if (typeof filename !== 'string' || filename.length > 120 || !/^[\p{L}\p{N}_()-][\p{L}\p{N} ._()-]*\.(png|json)$/u.test(filename)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[ .]|$)/iu.test(filename) || filename.includes('..')) fail();
  if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > FILE_EXPORT_BYTES) fail();
  const bytes = new Uint8Array(data);
  if (mimeType === 'application/json' && filename.endsWith('.json')) {
    if (bytes.length > 256 * 1024) fail();
    try { validateJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), { maxBytes: 256 * 1024, maxNodes: 20000 }); } catch { fail(); }
  } else if (mimeType === 'image/png' && filename.endsWith('.png')) {
    if (bytes.length < 57 || [137,80,78,71,13,10,26,10].some((b,i) => bytes[i] !== b)) fail();
    const view = new DataView(data); let offset = 8, image = false, end = false, chunks = 0;
    while (offset < bytes.length) {
      if (++chunks > 4096 || offset + 12 > bytes.length) fail();
      const size = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      if (size > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/u.test(type) || type === 'acTL') fail();
      if (offset === 8) { if (type !== 'IHDR' || size !== 13) fail(); const w=view.getUint32(offset+8),h=view.getUint32(offset+12); if (!w || !h || w>4096 || h>4096 || w*h>16777216) fail(); }
      else if (type === 'IHDR') fail();
      let crc = 0xffffffff;
      for (let i=offset+4;i<offset+8+size;i++) { crc ^= bytes[i]; for (let b=0;b<8;b++) crc = (crc>>>1) ^ (crc&1 ? 0xedb88320 : 0); }
      if (((crc^0xffffffff)>>>0) !== view.getUint32(offset+8+size)) fail();
      if (type === 'IDAT') image = true;
      offset += size + 12;
      if (type === 'IEND') { if (size || offset !== bytes.length || !image) fail(); end = true; }
    }
    if (!end) fail();
  } else fail();
  return { filename, mimeType, data };
}
