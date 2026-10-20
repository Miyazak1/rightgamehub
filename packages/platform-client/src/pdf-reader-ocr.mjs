export const OCR_CACHE_PATH = 'mooyu-pdf-reader-ocr-v1';

export async function prepareOcrLanguages(languageAssets, { fetchImpl = globalThis.fetch, writeCache } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('OCR language fetch is unavailable');
  if (typeof writeCache !== 'function') throw new TypeError('OCR language cache is unavailable');

  const cached = await Promise.all(languageAssets.map(async ({ code, url }) => {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Unable to load ${code} OCR data`);
    return [`${OCR_CACHE_PATH}/${code}.traineddata`, new Uint8Array(await response.arrayBuffer())];
  }));
  await writeCache(cached);

  // Tesseract.js 7 initializes object-based languages from `data`, while the
  // loader reads their binary payload from IndexedDB. Keeping the code in
  // `data` and the bytes in its normal cache gives both stages valid input.
  return languageAssets.map(({ code }) => ({ code, data: code }));
}

export function withOcrTimeout(promise, timeoutMs, message = 'OCR timed out') {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
