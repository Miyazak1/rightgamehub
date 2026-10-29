import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  validatePaperPdfRenderManifestV1,
  validatePaperPdfRenderRequestV1,
} from '../../../packages/agent-capabilities/src/paper-pdf-render.mjs';
import { CapabilityExecutorError, fail } from './errors.mjs';

const MANIFEST_FILE = 'render-manifest.json';
const PAGE_DIRECTORY = 'pages';
let runtimePromise = null;
const require = createRequire(import.meta.url);
const pdfjsRoot = path.resolve(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
  '../..');
// PDF.js requires a trailing forward slash even when its Node binary factory reads Windows paths.
const pdfjsResource = name => `${path.join(pdfjsRoot, name)}/`;

const runtime = () => {
  runtimePromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('@napi-rs/canvas'),
  ]).then(([pdfjs, canvas]) => ({ getDocument: pdfjs.getDocument,
    createCanvas: canvas.createCanvas }));
  return runtimePromise;
};

async function renameWithRetry(source, destination) {
  for (let attempt = 0;; attempt += 1) {
    try { await fs.promises.rename(source, destination); return; }
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
  await renameWithRetry(temporary, file);
}

async function stableSource(request) {
  const before = await fs.promises.lstat(request.artifact.sourcePath).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink() || before.size < 5
    || before.size > request.limits.maxSourceBytes) fail('PAPER_PDF_RENDER_SOURCE_INVALID');
  const handle = await fs.promises.open(request.artifact.sourcePath, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      fail('PAPER_PDF_RENDER_SOURCE_CHANGED');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      fail('PAPER_PDF_RENDER_SOURCE_CHANGED');
    }
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== request.artifact.sha256) fail('PAPER_PDF_RENDER_SOURCE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}

async function hashFile(file, maximumBytes) {
  const stats = await fs.promises.lstat(file).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maximumBytes) {
    fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
  }
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { sha256: hash.digest('hex'), sizeBytes: stats.size };
}

export async function verifyPaperPdfRenderOutput({ request: requestValue } = {}) {
  const request = validatePaperPdfRenderRequestV1(requestValue);
  const expectedManifest = path.join(request.output.directoryPath, MANIFEST_FILE);
  if (!path.isAbsolute(request.artifact.sourcePath) || !path.isAbsolute(request.output.directoryPath)
    || path.resolve(request.output.manifestPath) !== expectedManifest) {
    fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
  }
  const rootStats = await fs.promises.lstat(request.output.directoryPath).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
  }
  const rootEntries = await fs.promises.readdir(request.output.directoryPath, { withFileTypes: true });
  if (rootEntries.length !== 2 || !rootEntries.some(item => item.name === MANIFEST_FILE && item.isFile())
    || !rootEntries.some(item => item.name === PAGE_DIRECTORY && item.isDirectory())
    || rootEntries.some(item => item.isSymbolicLink())) fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
  const manifestBytes = await fs.promises.readFile(request.output.manifestPath);
  if (manifestBytes.length < 2 || manifestBytes.length > 4 * 1024 ** 2) {
    fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
  }
  let manifest;
  try { manifest = validatePaperPdfRenderManifestV1(JSON.parse(manifestBytes.toString('utf8')),
    { request }); } catch { fail('PAPER_PDF_RENDER_OUTPUT_INVALID'); }
  const pageDirectory = path.join(request.output.directoryPath, PAGE_DIRECTORY);
  const entries = await fs.promises.readdir(pageDirectory, { withFileTypes: true });
  const expected = new Set(manifest.pages.map(page => path.basename(page.relativePath)));
  if (entries.length !== expected.size || entries.some(item => !item.isFile()
    || item.isSymbolicLink() || !expected.has(item.name))) fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
  for (const page of manifest.pages) {
    if (path.dirname(page.relativePath) !== PAGE_DIRECTORY) fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
    const content = await hashFile(path.join(request.output.directoryPath, page.relativePath),
      request.limits.maxOutputBytes);
    if (content.sha256 !== page.sha256 || content.sizeBytes !== page.sizeBytes) {
      fail('PAPER_PDF_RENDER_OUTPUT_INVALID');
    }
  }
  return manifest;
}

export async function renderPaperPdfPages({ request: requestValue, signal,
  onProgress = null } = {}) {
  const request = validatePaperPdfRenderRequestV1(requestValue);
  const expectedManifest = path.join(request.output.directoryPath, MANIFEST_FILE);
  if (!path.isAbsolute(request.artifact.sourcePath) || !path.isAbsolute(request.output.directoryPath)
    || path.resolve(request.output.manifestPath) !== expectedManifest
    || onProgress !== null && typeof onProgress !== 'function') {
    fail('PAPER_PDF_RENDER_CONFIG_INVALID');
  }
  const parent = path.dirname(request.output.directoryPath);
  const parentStats = await fs.promises.lstat(parent).catch(() => null);
  if (!parentStats?.isDirectory() || parentStats.isSymbolicLink()) {
    fail('PAPER_PDF_RENDER_CONFIG_INVALID');
  }
  try { await fs.promises.mkdir(request.output.directoryPath, { mode: 0o700 }); }
  catch (error) {
    if (error?.code === 'EEXIST') fail('PAPER_PDF_RENDER_OUTPUT_EXISTS');
    throw error;
  }
  let pdfDocument;
  try {
    if (signal?.aborted) fail('PAPER_PDF_RENDER_CANCELLED', { safeFailure: true });
    const source = await stableSource(request);
    const { getDocument, createCanvas } = await runtime();
    const loading = getDocument({ data: new Uint8Array(source), disableWorker: true,
      disableRange: true, disableStream: true, disableAutoFetch: true,
      isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, stopAtErrors: true,
      cMapUrl: pdfjsResource('cmaps'), cMapPacked: true,
      standardFontDataUrl: pdfjsResource('standard_fonts'),
      wasmUrl: pdfjsResource('wasm'), iccUrl: pdfjsResource('iccs') });
    pdfDocument = await loading.promise;
    if (!Number.isSafeInteger(pdfDocument.numPages) || pdfDocument.numPages < 1
      || pdfDocument.numPages > request.limits.maxPages
      || request.pages.at(-1) > pdfDocument.numPages) fail('PAPER_PDF_RENDER_PAGE_INVALID');
    const pageDirectory = path.join(request.output.directoryPath, PAGE_DIRECTORY);
    await fs.promises.mkdir(pageDirectory, { mode: 0o700 });
    const pages = [];
    let totalBytes = 0;
    for (let index = 0; index < request.pages.length; index += 1) {
      if (signal?.aborted) fail('PAPER_PDF_RENDER_CANCELLED', { safeFailure: true });
      const pageNumber = request.pages[index], page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: request.render.scaleBp / 10000 });
      const widthPx = Math.ceil(viewport.width), heightPx = Math.ceil(viewport.height);
      if (!Number.isSafeInteger(widthPx) || !Number.isSafeInteger(heightPx)
        || widthPx < 1 || heightPx < 1
        || widthPx * heightPx > request.limits.maxPixelsPerPage) {
        page.cleanup?.(); fail('PAPER_PDF_RENDER_PIXEL_LIMIT_EXCEEDED');
      }
      const canvas = createCanvas(widthPx, heightPx), context = canvas.getContext('2d');
      context.save(); context.fillStyle = request.render.background;
      context.fillRect(0, 0, widthPx, heightPx); context.restore();
      await page.render({ canvasContext: context, viewport, background: request.render.background,
        intent: 'display' }).promise;
      page.cleanup?.();
      const bytes = canvas.toBuffer('image/png');
      totalBytes += bytes.length;
      if (totalBytes > request.limits.maxOutputBytes) fail('PAPER_PDF_RENDER_OUTPUT_LIMIT_EXCEEDED');
      const relativePath = `${PAGE_DIRECTORY}/page-${String(pageNumber).padStart(6, '0')}.png`;
      await atomicWrite(path.join(request.output.directoryPath, relativePath), bytes);
      const rotation = ((Number(viewport.rotation) % 360) + 360) % 360;
      pages.push({ page: pageNumber, widthPx, heightPx, rotationDegrees: rotation,
        mediaType: 'image/png', relativePath, sizeBytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      if (onProgress) await onProgress({ current: index + 1, total: request.pages.length,
        page: pageNumber });
    }
    const manifest = validatePaperPdfRenderManifestV1({
      schemaVersion: 'paper-pdf-render-manifest-v1', requestId: request.requestId,
      artifactSha256: request.artifact.sha256,
      renderer: { name: 'pdfjs-dist', version: '6.4.299', rasterizer: '@napi-rs/canvas',
        rasterizerVersion: '1.0.11', platform: process.platform, arch: process.arch,
        scaleBp: request.render.scaleBp, background: request.render.background },
      documentPageCount: pdfDocument.numPages,
      pages, totalBytes,
    }, { request });
    await atomicWrite(request.output.manifestPath,
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
    return await verifyPaperPdfRenderOutput({ request });
  } catch (error) {
    await fs.promises.rm(request.output.directoryPath, { recursive: true, force: true })
      .catch(() => {});
    if (error instanceof CapabilityExecutorError) throw error;
    fail('PAPER_PDF_RENDER_FAILED', { safeFailure: true, cause: error });
  } finally { await pdfDocument?.destroy?.().catch?.(() => {}); }
}
