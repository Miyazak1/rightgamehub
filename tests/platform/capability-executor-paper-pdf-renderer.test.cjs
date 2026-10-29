const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const contractUrl = pathToFileURL(path.resolve(__dirname,
  '../../packages/agent-capabilities/src/index.mjs')).href;

function escapePdfText(value) { return String(value).replace(/([\\()])/gu, '\\$1'); }
function createTextPdf(pageTexts) {
  const pageCount = pageTexts.length, fontObjectId = 3 + pageCount * 2;
  const objects = new Map(), pageReferences = [];
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  for (let index = 0; index < pageCount; index += 1) {
    const pageObjectId = 3 + index * 2, contentObjectId = pageObjectId + 1;
    pageReferences.push(`${pageObjectId} 0 R`);
    objects.set(pageObjectId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(pageTexts[index])}) Tj ET`;
    objects.set(contentObjectId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.set(2, `<< /Type /Pages /Kids [${pageReferences.join(' ')}] /Count ${pageCount} >>`);
  objects.set(fontObjectId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let source = '%PDF-1.4\n';
  const offsets = Array(fontObjectId + 1).fill(0);
  for (let objectId = 1; objectId <= fontObjectId; objectId += 1) {
    offsets[objectId] = Buffer.byteLength(source);
    source += `${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${fontObjectId + 1}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId <= fontObjectId; objectId += 1) {
    source += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`;
  }
  source += `trailer\n<< /Size ${fontObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source);
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-pdf-render-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'paper.pdf'), bytes = createTextPdf(['Page one', 'Page two']);
  await fs.writeFile(sourcePath, bytes);
  return { directory, sourcePath, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function requestFor(item, requestId, name, overrides = {}) {
  const { createPaperPdfRenderRequest } = await import(contractUrl);
  const outputDirectory = path.join(item.directory, name);
  return createPaperPdfRenderRequest({ requestId, sourcePath: item.sourcePath,
    sourceSha256: item.sha256, pages: [1, 2], outputDirectory,
    manifestPath: path.join(outputDirectory, 'render-manifest.json'), scaleBp: 10000,
    maxSourceBytes: 1024 * 1024, maxPages: 10, maxPixelsPerPage: 2_000_000,
    maxOutputBytes: 10 * 1024 * 1024, ...overrides });
}

test('real local PDF rendering emits deterministic, hashed page PNGs', async t => {
  const item = await fixture(t), api = await import(executorUrl);
  const firstRequest = await requestFor(item, '31111111-1111-4111-8111-111111111111', 'first');
  const progress = [], first = await api.renderPaperPdfPages({ request: firstRequest,
    onProgress: value => progress.push(value) });
  assert.equal(first.documentPageCount, 2);
  assert.deepEqual(first.pages.map(page => [page.page, page.widthPx, page.heightPx]),
    [[1, 612, 792], [2, 612, 792]]);
  assert.deepEqual(progress.map(item => item.page), [1, 2]);
  for (const page of first.pages) {
    const bytes = await fs.readFile(path.join(firstRequest.output.directoryPath, page.relativePath));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.deepEqual(await api.verifyPaperPdfRenderOutput({ request: firstRequest }), first);

  const secondRequest = await requestFor(item, '31111111-1111-4111-8111-111111111112', 'second');
  const second = await api.renderPaperPdfPages({ request: secondRequest });
  assert.deepEqual(second.pages.map(page => page.sha256), first.pages.map(page => page.sha256));
});

test('render output verification rejects page tampering and undeclared files', async t => {
  const item = await fixture(t), api = await import(executorUrl);
  const request = await requestFor(item, '31111111-1111-4111-8111-111111111113', 'tamper');
  const manifest = await api.renderPaperPdfPages({ request });
  await fs.appendFile(path.join(request.output.directoryPath, manifest.pages[0].relativePath), 'x');
  await assert.rejects(api.verifyPaperPdfRenderOutput({ request }),
    error => error.code === 'PAPER_PDF_RENDER_OUTPUT_INVALID');
});

test('renderer fails closed on source digest changes and removes partial output', async t => {
  const item = await fixture(t), api = await import(executorUrl);
  const request = await requestFor(item, '31111111-1111-4111-8111-111111111114', 'changed');
  await fs.appendFile(item.sourcePath, 'changed');
  await assert.rejects(api.renderPaperPdfPages({ request }),
    error => error.code === 'PAPER_PDF_RENDER_SOURCE_CHANGED');
  await assert.rejects(fs.stat(request.output.directoryPath), error => error.code === 'ENOENT');
});

test('renderer enforces pixel limits before encoding a page', async t => {
  const item = await fixture(t), api = await import(executorUrl);
  const request = await requestFor(item, '31111111-1111-4111-8111-111111111115', 'pixels',
    { pages: [1], scaleBp: 20000, maxPixelsPerPage: 1_000_000 });
  await assert.rejects(api.renderPaperPdfPages({ request }),
    error => error.code === 'PAPER_PDF_RENDER_PIXEL_LIMIT_EXCEEDED');
  await assert.rejects(fs.stat(request.output.directoryPath), error => error.code === 'ENOENT');
});

test('renderer honours cancellation without retaining a partial page set', async t => {
  const item = await fixture(t), api = await import(executorUrl);
  const request = await requestFor(item, '31111111-1111-4111-8111-111111111116', 'cancel');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.renderPaperPdfPages({ request, signal: controller.signal }),
    error => error.code === 'PAPER_PDF_RENDER_CANCELLED');
  await assert.rejects(fs.stat(request.output.directoryPath), error => error.code === 'ENOENT');
});
