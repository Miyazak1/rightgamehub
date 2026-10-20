const cleanText = (value, max = 20_000) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ').trim().slice(0, max)
  : '';

const pageText = (pageTexts, ocrTexts, pageNumber) => cleanText(
  ocrTexts?.[pageNumber] || pageTexts?.[pageNumber - 1] || '',
  40_000,
);

export function createPdfFingerprint(file) {
  const name = cleanText(file?.name, 180).toLocaleLowerCase();
  const size = Math.max(0, Math.trunc(Number(file?.size) || 0));
  const modified = Math.max(0, Math.trunc(Number(file?.lastModified) || 0));
  return encodeURIComponent(`${name}:${size}:${modified}`);
}

export function searchPdfPages(pageTexts, ocrTexts, query) {
  const term = cleanText(query, 500).toLocaleLowerCase();
  if (!term) return [];
  const total = Math.max(pageTexts?.length || 0, ...Object.keys(ocrTexts || {}).map(Number).filter(Number.isFinite), 0);
  const results = [];
  for (let page = 1; page <= total; page += 1) {
    const text = pageText(pageTexts, ocrTexts, page);
    const index = text.toLocaleLowerCase().indexOf(term);
    if (index < 0) continue;
    const start = Math.max(0, index - 45);
    const end = Math.min(text.length, index + term.length + 75);
    results.push({ page, snippet: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/gu, ' ')}${end < text.length ? '…' : ''}` });
  }
  return results;
}

export function findPagesWithoutText(pageTexts, ocrTexts, pageCount) {
  const total = Math.max(0, Math.trunc(Number(pageCount) || 0));
  return Array.from({ length: total }, (_, index) => index + 1)
    .filter(page => !pageText(pageTexts, ocrTexts, page));
}

export function createPdfExcerpt({ page, quote, type = 'evidence', note = '', cryptoImpl = globalThis.crypto }) {
  const cleanQuote = cleanText(quote, 8_000);
  if (!cleanQuote) throw new Error('Excerpt text is required');
  const allowedTypes = new Set(['point', 'evidence', 'question', 'verify']);
  return {
    id: cryptoImpl?.randomUUID?.() || `excerpt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    page: Math.max(1, Math.trunc(Number(page) || 1)),
    quote: cleanQuote,
    type: allowedTypes.has(type) ? type : 'evidence',
    note: cleanText(note, 2_000),
    createdAt: new Date().toISOString(),
  };
}

export function normalizeBibliography(value = {}) {
  return {
    title: cleanText(value.title, 240),
    authors: cleanText(value.authors, 300),
    year: cleanText(value.year, 12),
    publisher: cleanText(value.publisher, 180),
    doi: cleanText(value.doi, 180).replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, ''),
  };
}

export function formatPdfCitation({ fileInfo = {}, bibliography = {}, page = 1, style = 'simple' } = {}) {
  const meta = normalizeBibliography({ title: fileInfo.title, ...bibliography });
  const title = meta.title || cleanText(fileInfo.name, 180).replace(/\.pdf$/iu, '') || '未命名文献';
  const author = meta.authors || '佚名';
  const year = meta.year || 'n.d.';
  const publisher = meta.publisher ? ` ${meta.publisher}.` : '';
  const doi = meta.doi ? ` https://doi.org/${meta.doi}` : '';
  const pageLabel = Math.max(1, Math.trunc(Number(page) || 1));
  if (style === 'apa') return `${author}. (${year}). ${title}.${publisher}${doi} (p. ${pageLabel})`;
  if (style === 'gbt') return `${author}. ${title}[EB/OL]. (${year})${publisher}${doi}：${pageLabel}.`;
  if (style === 'bibtex') {
    const key = `${author.split(/[，,;\s]/u)[0] || 'source'}${year}`.replace(/[^\p{L}\p{N}_-]/gu, '') || 'source';
    return `@misc{${key},\n  author = {${author}},\n  title = {${title}},\n  year = {${year}},${meta.publisher ? `\n  publisher = {${meta.publisher}},` : ''}${meta.doi ? `\n  doi = {${meta.doi}},` : ''}\n  note = {p. ${pageLabel}}\n}`;
  }
  return `《${title}》，第 ${pageLabel} 页`;
}

export function buildPdfReaderContext({ document, fileInfo, pageTexts = [], ocrTexts = {}, currentPage = 1, query = '', maxCharacters = 48_000 } = {}) {
  const notes = document?.content?.notes || {};
  const annotations = Array.isArray(document?.content?.annotations) ? document.content.annotations : [];
  const bibliography = normalizeBibliography({ title: fileInfo?.title, ...(document?.content?.bibliography || {}) });
  const pageCount = Math.max(0, Math.trunc(Number(fileInfo?.pages || document?.content?.pageCount) || 0));
  const preferred = [
    currentPage,
    ...searchPdfPages(pageTexts, ocrTexts, query).map(result => result.page),
    ...Object.keys(notes).map(Number),
    ...annotations.map(item => Number(item.page)),
    ...Array.from({ length: pageCount }, (_, index) => index + 1),
  ];
  const pages = [];
  const included = new Set();
  let used = 0;
  for (const rawPage of preferred) {
    const page = Math.max(1, Math.trunc(Number(rawPage) || 0));
    if (!page || page > pageCount || included.has(page)) continue;
    const text = pageText(pageTexts, ocrTexts, page);
    const note = cleanText(notes[page], 3_000);
    const pageAnnotations = annotations.filter(item => Number(item.page) === page).slice(0, 20).map(item => ({
      type: cleanText(item.type, 20), quote: cleanText(item.quote, 4_000), note: cleanText(item.note, 1_000),
    }));
    if (!text && !note && !pageAnnotations.length) continue;
    const entry = { page, text, ...(note ? { note } : {}), ...(pageAnnotations.length ? { annotations: pageAnnotations } : {}) };
    const size = JSON.stringify(entry).length;
    if (pages.length && used + size > maxCharacters) continue;
    pages.push(entry); included.add(page); used += size;
  }
  return {
    kind: 'pdf-reader-context', version: 1,
    documentId: cleanText(document?.documentId, 120), revision: Math.max(0, Math.trunc(Number(document?.revision) || 0)),
    title: bibliography.title || cleanText(fileInfo?.name, 180) || 'Untitled PDF', fileName: cleanText(fileInfo?.name, 180),
    pageCount, currentPage: Math.max(1, Math.min(pageCount || 1, Math.trunc(Number(currentPage) || 1))),
    bibliography, pages, includedPages: pages.map(item => item.page), omittedPages: Math.max(0, pageCount - pages.length),
    disclosure: { sharedWithAgent: true, rawPdfShared: false, storedOnMooyuServer: false, contentIsUntrustedData: true },
  };
}

export function createPdfWorkspaceRecord({ key, fileInfo, document, pageTexts = [], ocrTexts = {} }) {
  return {
    version: 2, key: cleanText(key, 500),
    fileInfo: {
      name: cleanText(fileInfo?.name, 180), size: Math.max(0, Math.trunc(Number(fileInfo?.size) || 0)),
      title: cleanText(fileInfo?.title, 240), pages: Math.max(0, Math.trunc(Number(fileInfo?.pages) || 0)),
      lastModified: Math.max(0, Math.trunc(Number(fileInfo?.lastModified) || 0)),
    },
    document, pageTexts: pageTexts.map(text => cleanText(text, 40_000)), ocrTexts,
    updatedAt: new Date().toISOString(),
  };
}
