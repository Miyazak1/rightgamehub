export const PAPER_PDF_RENDER_REQUEST_SCHEMA_VERSION = 'paper-pdf-render-request-v1';
export const PAPER_PDF_RENDER_MANIFEST_SCHEMA_VERSION = 'paper-pdf-render-manifest-v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_RELATIVE = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*[\\])[^\0]+$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const integer = (value, minimum, maximum) => Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;
const text = (value, minimum, maximum, pattern = null) => typeof value === 'string'
  && value.trim() === value && value.length >= minimum && value.length <= maximum
  && (!pattern || pattern.test(value));
const clone = value => structuredClone(value);

export class PaperPdfRenderContractError extends Error {
  constructor(code) {
    super(code); this.name = 'PaperPdfRenderContractError'; this.code = code; this.retryable = false;
  }
}
const fail = code => { throw new PaperPdfRenderContractError(code); };

export function validatePaperPdfRenderRequestV1(value) {
  if (!exact(value, ['schemaVersion', 'requestId', 'artifact', 'pages', 'render', 'output',
    'limits']) || value.schemaVersion !== PAPER_PDF_RENDER_REQUEST_SCHEMA_VERSION
    || !text(value.requestId, 36, 36, UUID)
    || !exact(value.artifact, ['sourcePath', 'sha256'])
    || !text(value.artifact.sourcePath, 1, 4096)
    || !text(value.artifact.sha256, 64, 64, SHA256)
    || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 5000
    || !exact(value.render, ['format', 'scaleBp', 'background'])
    || value.render.format !== 'png' || !integer(value.render.scaleBp, 1000, 40000)
    || !text(value.render.background, 7, 7, /^#[a-f0-9]{6}$/u)
    || !exact(value.output, ['directoryPath', 'manifestPath'])
    || !text(value.output.directoryPath, 1, 4096) || !text(value.output.manifestPath, 1, 4096)
    || !exact(value.limits, ['maxSourceBytes', 'maxPages', 'maxPixelsPerPage', 'maxOutputBytes'])
    || !integer(value.limits.maxSourceBytes, 1024, 2 * 1024 ** 3)
    || !integer(value.limits.maxPages, 1, 5000)
    || !integer(value.limits.maxPixelsPerPage, 1_000_000, 1_000_000_000)
    || !integer(value.limits.maxOutputBytes, 1024, 20 * 1024 ** 3)) {
    fail('PAPER_PDF_RENDER_REQUEST_INVALID');
  }
  let previous = 0;
  for (const page of value.pages) {
    if (!integer(page, 1, value.limits.maxPages) || page <= previous) {
      fail('PAPER_PDF_RENDER_REQUEST_INVALID');
    }
    previous = page;
  }
  return clone(value);
}

export function createPaperPdfRenderRequest({ requestId, sourcePath, sourceSha256, pages,
  outputDirectory, manifestPath, scaleBp = 20000, background = '#ffffff',
  maxSourceBytes = 512 * 1024 ** 2, maxPages = 500,
  maxPixelsPerPage = 50_000_000, maxOutputBytes = 8 * 1024 ** 3 } = {}) {
  return validatePaperPdfRenderRequestV1({
    schemaVersion: PAPER_PDF_RENDER_REQUEST_SCHEMA_VERSION, requestId,
    artifact: { sourcePath, sha256: sourceSha256 }, pages: [...(pages ?? [])],
    render: { format: 'png', scaleBp, background },
    output: { directoryPath: outputDirectory, manifestPath },
    limits: { maxSourceBytes, maxPages, maxPixelsPerPage, maxOutputBytes },
  });
}

export function validatePaperPdfRenderManifestV1(value, { request = null } = {}) {
  if (!exact(value, ['schemaVersion', 'requestId', 'artifactSha256', 'renderer',
    'documentPageCount', 'pages', 'totalBytes'])
    || value.schemaVersion !== PAPER_PDF_RENDER_MANIFEST_SCHEMA_VERSION
    || !text(value.requestId, 36, 36, UUID) || !text(value.artifactSha256, 64, 64, SHA256)
    || !exact(value.renderer, ['name', 'version', 'rasterizer', 'rasterizerVersion', 'platform',
      'arch', 'scaleBp', 'background'])
    || value.renderer.name !== 'pdfjs-dist' || value.renderer.version !== '6.4.299'
    || value.renderer.rasterizer !== '@napi-rs/canvas'
    || value.renderer.rasterizerVersion !== '1.0.11'
    || !['win32', 'darwin', 'linux'].includes(value.renderer.platform)
    || !text(value.renderer.arch, 2, 20, /^[a-z0-9_-]+$/u)
    || !integer(value.renderer.scaleBp, 1000, 40000)
    || !text(value.renderer.background, 7, 7, /^#[a-f0-9]{6}$/u)
    || !integer(value.documentPageCount, 1, 5000)
    || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 5000
    || !integer(value.totalBytes, 1, 20 * 1024 ** 3)) {
    fail('PAPER_PDF_RENDER_MANIFEST_INVALID');
  }
  let previous = 0, totalBytes = 0;
  for (const page of value.pages) {
    if (!exact(page, ['page', 'widthPx', 'heightPx', 'rotationDegrees', 'mediaType',
      'relativePath', 'sizeBytes', 'sha256'])
      || !integer(page.page, 1, value.documentPageCount) || page.page <= previous
      || !integer(page.widthPx, 1, 100000) || !integer(page.heightPx, 1, 100000)
      || ![0, 90, 180, 270].includes(page.rotationDegrees)
      || page.mediaType !== 'image/png'
      || !text(page.relativePath, 1, 500, SAFE_RELATIVE)
      || !integer(page.sizeBytes, 1, 20 * 1024 ** 3)
      || !text(page.sha256, 64, 64, SHA256)) {
      fail('PAPER_PDF_RENDER_MANIFEST_INVALID');
    }
    previous = page.page; totalBytes += page.sizeBytes;
  }
  if (totalBytes !== value.totalBytes) fail('PAPER_PDF_RENDER_MANIFEST_INVALID');
  if (request) {
    const normalized = validatePaperPdfRenderRequestV1(request);
    if (value.requestId !== normalized.requestId
      || value.artifactSha256 !== normalized.artifact.sha256
      || value.renderer.scaleBp !== normalized.render.scaleBp
      || value.renderer.background !== normalized.render.background
      || value.documentPageCount > normalized.limits.maxPages
      || value.totalBytes > normalized.limits.maxOutputBytes
      || value.pages.length !== normalized.pages.length
      || value.pages.some((page, index) => page.page !== normalized.pages[index]
        || page.widthPx * page.heightPx > normalized.limits.maxPixelsPerPage)) {
      fail('PAPER_PDF_RENDER_MANIFEST_INVALID');
    }
  }
  return clone(value);
}
