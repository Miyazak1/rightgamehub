import Fastify from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateAssetPath } from './web-package-policy.mjs';

class RuntimeEdgeError extends Error {
  constructor(code, statusCode, message) { super(message); this.code = code; this.statusCode = statusCode; }
}

const releaseIdFromHost = (hostHeader, domain) => {
  const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '');
  const match = new RegExp(`^r-([a-f0-9]{32})\\.${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).exec(host);
  if (!match) throw new RuntimeEdgeError('RUNTIME_HOST_INVALID', 421, 'Runtime host is invalid.');
  const value = match[1];
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const requestAssetPath = (rawUrl, entry) => {
  const rawPath = rawUrl.split('?', 1)[0];
  if (rawPath.length > 2048 || /%2f|%5c/i.test(rawPath)) throw new RuntimeEdgeError('RUNTIME_PATH_INVALID', 400, 'Runtime path is invalid.');
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { throw new RuntimeEdgeError('RUNTIME_PATH_INVALID', 400, 'Runtime path encoding is invalid.'); }
  const relative = decoded.replace(/^\//, '') || entry;
  try { return validateAssetPath(relative); } catch { throw new RuntimeEdgeError('RUNTIME_PATH_INVALID', 400, 'Runtime path is invalid.'); }
};

const rangeFor = (header, size) => {
  if (size === 0) {
    if (header) throw new RuntimeEdgeError('RANGE_INVALID', 416, 'Range is invalid for an empty asset.');
    return { start: 0, end: -1, partial: false };
  }
  if (!header) return { start: 0, end: size - 1, partial: false };
  if (header.includes(',')) throw new RuntimeEdgeError('RANGE_INVALID', 416, 'Multiple ranges are not supported.');
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new RuntimeEdgeError('RANGE_INVALID', 416, 'Range is invalid.');
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new RuntimeEdgeError('RANGE_INVALID', 416, 'Range is invalid.');
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) throw new RuntimeEdgeError('RANGE_INVALID', 416, 'Range is invalid.');
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
};

const cspFor = capabilities => {
  const pointerLock = capabilities.includes('pointerLock') ? ' allow-pointer-lock' : '';
  return `default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts${pointerLock}`;
};
const permissionsFor = capabilities => `fullscreen=${capabilities.includes('fullscreen') ? '(self)' : '()'}, camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=(), display-capture=(), clipboard-read=(), clipboard-write=()`;

export function createRuntimeEdgeApp({ repository, objectStore, runtimeDomain, logger = false }) {
  const app = Fastify({ logger, requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() });
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof RuntimeEdgeError;
    const statusCode = known ? error.statusCode : 503;
    if (statusCode === 416 && request.runtimeAssetSize != null) reply.header('Content-Range', `bytes */${request.runtimeAssetSize}`);
    reply.header('Cache-Control', 'no-store').status(statusCode).send({ error: { code: known ? error.code : 'RUNTIME_UNAVAILABLE', message: known ? error.message : 'Runtime is temporarily unavailable.', requestId: request.id, retryable: !known || statusCode >= 500, details: {} } });
  });

  const serve = async (request, reply) => {
    const releaseId = releaseIdFromHost(request.headers.host, runtimeDomain);
    const release = await repository.resolveRelease(releaseId);
    if (!release) throw new RuntimeEdgeError('NOT_FOUND', 404, 'Runtime release not found.');
    const manifest = await objectStore.loadManifest(release.asset_prefix, release.asset_manifest_sha256);
    if (manifest.fileCount !== release.asset_count || Number(manifest.totalBytes) !== Number(release.expanded_bytes) || manifest.entry !== release.entry_path) throw new RuntimeEdgeError('RUNTIME_MANIFEST_INVALID', 503, 'Runtime manifest does not match the release.');
    const relative = requestAssetPath(request.raw.url, manifest.entry);
    const expected = manifest.assets[relative];
    if (!expected) throw new RuntimeEdgeError('NOT_FOUND', 404, 'Runtime asset not found.');
    const asset = await objectStore.inspectAsset(release.asset_prefix, relative, expected);
    request.runtimeAssetSize = asset.size;
    const selected = rangeFor(request.headers.range, asset.size);
    const length = selected.end - selected.start + 1;
    const etag = `"${expected.sha256}"`;
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('ETag', etag);
    reply.header('Content-Type', expected.mime);
    reply.header('Content-Length', length);
    if (/^text\/html/.test(expected.mime)) {
      reply.header('Content-Security-Policy', cspFor(manifest.approvedCapabilities));
      reply.header('Permissions-Policy', permissionsFor(manifest.approvedCapabilities));
    }
    if (!selected.partial && request.headers['if-none-match'] === etag) return reply.status(304).send();
    if (selected.partial) {
      reply.status(206);
      reply.header('Content-Range', `bytes ${selected.start}-${selected.end}/${asset.size}`);
    }
    if (asset.size === 0) return reply.send(Buffer.alloc(0));
    const stream = asset.open
      ? await asset.open({ start: selected.start, end: selected.end })
      : fs.createReadStream(asset.path, { start: selected.start, end: selected.end });
    return reply.send(stream);
  };
  app.get('/', { exposeHeadRoute: true }, serve);
  app.get('/*', { exposeHeadRoute: true }, serve);
  const rejectMutation = async (_request, reply) => {
    reply.header('Allow', 'GET, HEAD');
    throw new RuntimeEdgeError('METHOD_NOT_ALLOWED', 405, 'Runtime assets are read-only.');
  };
  app.route({ method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url: '/', handler: rejectMutation });
  app.route({ method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url: '/*', handler: rejectMutation });
  return app;
}
