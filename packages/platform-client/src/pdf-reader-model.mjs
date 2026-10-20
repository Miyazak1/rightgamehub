export function textFromPdfContent(content) {
  let text = '';
  for (const item of content?.items || []) {
    if (typeof item.str !== 'string') continue;
    text += item.str;
    text += item.hasEOL ? '\n' : ' ';
  }
  return text.replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
}

export async function extractPdfDocumentPages(pdfDocument, options = {}) {
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const total = Math.max(0, Math.trunc(Number(pdfDocument?.numPages) || 0));
  const texts = Array(total).fill('');
  let failedPages = 0;

  onProgress({ current: 0, total, texts: [...texts] });

  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    if (!isCurrent()) return { status: 'cancelled', current: pageNumber - 1, total, texts, failedPages };
    try {
      const page = await pdfDocument.getPage(pageNumber);
      texts[pageNumber - 1] = textFromPdfContent(await page.getTextContent());
    } catch {
      failedPages += 1;
      texts[pageNumber - 1] = '';
    }
    if (!isCurrent()) return { status: 'cancelled', current: pageNumber - 1, total, texts, failedPages };
    onProgress({ current: pageNumber, total, texts: [...texts] });
  }

  return { status: 'complete', current: total, total, texts, failedPages };
}
