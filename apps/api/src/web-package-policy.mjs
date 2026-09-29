import path from 'node:path';

export const WEB_POLICY_VERSION = 1;
export const WEB_LIMITS = Object.freeze({ archiveBytes: 100 * 1024 ** 2, totalBytes: 300 * 1024 ** 2, fileBytes: 100 * 1024 ** 2, files: 5000, depth: 16, manifestBytes: 16 * 1024, timeoutMs: 120_000 });
export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.data': 'application/octet-stream', '.pak': 'application/octet-stream', '.mem': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.map': 'application/json',
});

export function validateAssetPath(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 512 || value !== value.normalize('NFC') || /[\\%?#:\x00-\x1f\x7f<>"|*]/u.test(value)) throw Object.assign(new Error('Package path contains unsupported characters.'), { code: 'ZIP_PATH_INVALID' });
  const parts = value.split('/');
  if (parts.length > WEB_LIMITS.depth || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || Buffer.byteLength(part) > 160 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw Object.assign(new Error('Package path is unsafe or too deep.'), { code: 'ZIP_PATH_INVALID' });
  return value;
}

export function containedPath(root, relative) {
  validateAssetPath(relative);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw Object.assign(new Error('Package path escapes its root.'), { code: 'ZIP_PATH_INVALID' });
  return target;
}

export function mimeFor(relative) {
  const mime = MIME[path.posix.extname(relative).toLowerCase()];
  if (!mime) throw Object.assign(new Error('Package contains an unsupported file type.'), { code: 'ZIP_TYPE_UNSUPPORTED' });
  return mime;
}
