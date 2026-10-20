const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.resolve('packages/platform-client/src/pdf-reader-workspace.mjs')).href);

test('PDF search includes persisted OCR text and locates pages without text', async () => {
  const { searchPdfPages, findPagesWithoutText } = await load();
  const pageTexts = ['native introduction', '', ''];
  const ocrTexts = { 2: '扫描页包含重要证据' };
  assert.deepEqual(searchPdfPages(pageTexts, ocrTexts, '重要').map(item => item.page), [2]);
  assert.deepEqual(findPagesWithoutText(pageTexts, ocrTexts, 3), [3]);
});

test('PDF excerpts and citations retain page provenance', async () => {
  const { createPdfExcerpt, formatPdfCitation } = await load();
  const excerpt = createPdfExcerpt({ page: 7, quote: '  quoted evidence  ', type: 'evidence', cryptoImpl: { randomUUID: () => 'quote-1' } });
  assert.equal(excerpt.id, 'quote-1');
  assert.equal(excerpt.page, 7);
  assert.equal(excerpt.quote, 'quoted evidence');
  assert.match(formatPdfCitation({ fileInfo: { title: 'Research' }, bibliography: { authors: 'Li', year: '2026', doi: 'https://doi.org/10.1/test' }, page: 7, style: 'apa' }), /Li\. \(2026\).*p\. 7/u);
});

test('PDF Agent context prioritizes the active page and never claims to share the raw file', async () => {
  const { buildPdfReaderContext } = await load();
  const context = buildPdfReaderContext({
    document: { documentId: 'pdf-1', revision: 3, content: { notes: { 2: 'check this' }, annotations: [{ page: 2, type: 'question', quote: 'why?' }] } },
    fileInfo: { name: 'paper.pdf', title: 'Paper', pages: 3 },
    pageTexts: ['one', '', 'three'], ocrTexts: { 2: 'two from OCR' }, currentPage: 2,
  });
  assert.equal(context.pages[0].page, 2);
  assert.equal(context.pages[0].text, 'two from OCR');
  assert.equal(context.disclosure.rawPdfShared, false);
  assert.equal(context.disclosure.storedOnMooyuServer, false);
});
