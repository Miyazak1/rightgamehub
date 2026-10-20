const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const modelUrl = pathToFileURL(path.resolve('packages/platform-client/src/pdf-reader-model.mjs')).href;
const pdfjsUrl = pathToFileURL(path.resolve('packages/platform-client/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;

function escapePdfText(value) {
  return String(value).replace(/([\\()])/gu, '\\$1');
}

function createTextPdf(pageTexts) {
  const pageCount = pageTexts.length;
  const fontObjectId = 3 + pageCount * 2;
  const objects = new Map();
  const pageReferences = [];

  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  for (let index = 0; index < pageCount; index += 1) {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
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
  return new Uint8Array(Buffer.from(source));
}

test('PDF reader extracts real text and completes progress for a 41-page document', async () => {
  const [{ extractPdfDocumentPages }, pdfjsLib] = await Promise.all([
    import(modelUrl),
    import(pdfjsUrl),
  ]);
  const expected = Array.from({ length: 41 }, (_, index) => `Twin Peaks page ${index + 1}`);
  const pdfDocument = await pdfjsLib.getDocument({ data: createTextPdf(expected), disableWorker: true, useSystemFonts: true }).promise;
  const progress = [];
  try {
    const result = await extractPdfDocumentPages(pdfDocument, { onProgress: item => progress.push({ current: item.current, total: item.total }) });
    assert.equal(result.status, 'complete');
    assert.equal(result.total, 41);
    assert.equal(result.failedPages, 0);
    assert.match(result.texts[0], /Twin Peaks page 1/u);
    assert.match(result.texts[40], /Twin Peaks page 41/u);
    assert.deepEqual(progress[0], { current: 0, total: 41 });
    assert.deepEqual(progress.at(-1), { current: 41, total: 41 });
  } finally {
    await pdfDocument.destroy?.();
  }
});

test('PDF reader cancellation stops stale extraction before another page is read', async () => {
  const { extractPdfDocumentPages } = await import(modelUrl);
  let current = true;
  const visited = [];
  const pdfDocument = {
    numPages: 3,
    async getPage(pageNumber) {
      visited.push(pageNumber);
      return { async getTextContent() { return { items: [{ str: `Page ${pageNumber}`, hasEOL: true }] }; } };
    },
  };
  const result = await extractPdfDocumentPages(pdfDocument, {
    isCurrent: () => current,
    onProgress: progress => { if (progress.current === 1) current = false; },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.current, 1);
  assert.deepEqual(visited, [1]);
});
