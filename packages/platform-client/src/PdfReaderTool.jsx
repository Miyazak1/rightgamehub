import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishDataUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import chineseDataUrl from '@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz?url';
import { useI18n } from './I18n.jsx';
import { assertToolDocument, createToolDocument } from './official-tools.mjs';
import { extractPdfDocumentPages } from './pdf-reader-model.mjs';
import './PdfReaderTool.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = 'mooyu.official-tool.pdf-reader.v1';
const MAX_FILE_BYTES = 150 * 1024 * 1024;

function createInitialDocument() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = assertToolDocument(JSON.parse(stored), 'pdf-reader');
      if (parsed.content && typeof parsed.content.notes === 'object') return parsed;
    }
  } catch { /* A stale local draft should not block the reader. */ }
  return createToolDocument('pdf-reader', {
    content: { title: '', fileName: '', fileSize: 0, pageCount: 0, notes: {} },
    view: { page: 1, zoom: 1 },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeStem(fileName) {
  return String(fileName || '墨鱼文献').replace(/\.pdf$/iu, '').replace(/[\\/:*?"<>|]+/gu, '-').slice(0, 80) || '墨鱼文献';
}

function searchSnippet(text, query) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, 120);
  const start = Math.max(0, index - 45);
  const end = Math.min(normalized.length, index + query.length + 75);
  return `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

async function fetchLanguage(code, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${code} OCR data`);
  return { code, data: new Uint8Array(await response.arrayBuffer()) };
}

export default function PdfReaderTool() {
  const { t } = useI18n();
  const [toolDocument, setToolDocument] = useState(createInitialDocument);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pageTexts, setPageTexts] = useState([]);
  const [ocrTexts, setOcrTexts] = useState({});
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [extractProgress, setExtractProgress] = useState({ current: 0, total: 0 });
  const [ocrProgress, setOcrProgress] = useState(null);
  const [readerWidth, setReaderWidth] = useState(0);
  const canvasRef = useRef(null);
  const readerRef = useRef(null);
  const fileInputRef = useRef(null);
  const renderTaskRef = useRef(null);
  const workerRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const extractionGenerationRef = useRef(0);

  const notes = toolDocument.content.notes || {};
  const currentText = ocrTexts[pageNumber] || pageTexts[pageNumber - 1] || '';
  const isLikelyScanned = Boolean(pdfDocument && !currentText.trim());
  const searchResults = useMemo(() => {
    const term = query.trim();
    if (!term) return [];
    return pageTexts.flatMap((text, index) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase())
      ? [{ page: index + 1, snippet: searchSnippet(text, term) }]
      : []);
  }, [pageTexts, query]);

  useEffect(() => {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(toolDocument)); }
    catch { /* Notes remain available in memory if storage is full. */ }
  }, [toolDocument]);

  useEffect(() => {
    if (!readerRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => setReaderWidth(Math.round(entries[0]?.contentRect.width || 0)));
    observer.observe(readerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return undefined;
    let live = true;
    const renderPage = async () => {
      setRendering(true);
      try {
        renderTaskRef.current?.cancel?.();
        const page = await pdfDocument.getPage(pageNumber);
        if (!live || !canvasRef.current) return;
        const base = page.getViewport({ scale: 1 });
        const available = Math.max(300, (readerRef.current?.clientWidth || readerWidth || base.width) - 56);
        const fitScale = Math.min(2.25, available / base.width);
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(globalThis.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const task = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException') setNotice(t('tools.pdfReader.renderFailed'));
      } finally {
        if (live) setRendering(false);
      }
    };
    renderPage();
    return () => { live = false; renderTaskRef.current?.cancel?.(); };
  }, [pdfDocument, pageNumber, zoom, readerWidth, t]);

  useEffect(() => () => {
    extractionGenerationRef.current += 1;
    renderTaskRef.current?.cancel?.();
    workerRef.current?.terminate?.();
    pdfDocumentRef.current?.destroy?.();
    pdfDocumentRef.current = null;
  }, []);

  const patchDocument = (contentPatch, viewPatch = {}) => setToolDocument(current => ({
    ...current,
    revision: current.revision + 1,
    content: { ...current.content, ...contentPatch },
    view: { ...current.view, ...viewPatch },
    metadata: { ...current.metadata, updatedAt: new Date().toISOString() },
  }));

  const extractAllPages = async (document, generation) => {
    const result = await extractPdfDocumentPages(document, {
      isCurrent: () => generation === extractionGenerationRef.current,
      onProgress: progress => {
        setPageTexts(progress.texts);
        setExtractProgress({ current: progress.current, total: progress.total });
      },
    });
    if (result.status === 'complete' && result.failedPages === result.total && result.total > 0) {
      setNotice(t('tools.pdfReader.extractFailed'));
    }
  };

  const openFile = async file => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/iu.test(file.name)) { setNotice(t('tools.pdfReader.pdfOnly')); return; }
    if (file.size > MAX_FILE_BYTES) { setNotice(t('tools.pdfReader.fileTooLarge')); return; }
    setLoading(true);
    setNotice('');
    const generation = extractionGenerationRef.current + 1;
    extractionGenerationRef.current = generation;
    try {
      const previousDocument = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      setPdfDocument(null);
      await previousDocument?.destroy?.();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (generation !== extractionGenerationRef.current) { await document.destroy(); return; }
      const metadata = await document.getMetadata().catch(() => ({ info: {} }));
      const title = String(metadata?.info?.Title || safeStem(file.name));
      pdfDocumentRef.current = document;
      setPdfDocument(document);
      setFileInfo({ name: file.name, size: file.size, title, pages: document.numPages });
      setPageNumber(1);
      setZoom(1);
      setOcrTexts({});
      setQuery('');
      setNotice(t('tools.pdfReader.opened'));
      setToolDocument(current => createToolDocument('pdf-reader', {
        documentId: current.content.fileName === file.name ? current.documentId : undefined,
        content: { title, fileName: file.name, fileSize: file.size, pageCount: document.numPages, notes: current.content.fileName === file.name ? current.content.notes || {} : {} },
        view: { page: 1, zoom: 1 },
        metadata: { createdAt: current.metadata?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() },
      }));
      void extractAllPages(document, generation).catch(() => {
        if (generation === extractionGenerationRef.current) setNotice(t('tools.pdfReader.extractFailed'));
      });
    } catch (error) {
      setNotice(error?.name === 'PasswordException' ? t('tools.pdfReader.passwordUnsupported') : t('tools.pdfReader.openFailed'));
    } finally { setLoading(false); }
  };

  const changePage = value => {
    if (!pdfDocument) return;
    const next = Math.max(1, Math.min(pdfDocument.numPages, Number(value) || 1));
    setPageNumber(next);
    patchDocument({}, { page: next, zoom });
  };

  const changeZoom = value => {
    const next = Math.max(0.6, Math.min(2.4, value));
    setZoom(next);
    patchDocument({}, { page: pageNumber, zoom: next });
  };

  const runOcr = async () => {
    if (!pdfDocument || ocrProgress) return;
    setOcrProgress({ status: t('tools.pdfReader.ocrPreparing'), progress: 0 });
    setNotice('');
    try {
      const page = await pdfDocument.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.6, Math.max(1.7, 2200 / base.width));
      const viewport = page.getViewport({ scale });
      const imageCanvas = document.createElement('canvas');
      imageCanvas.width = Math.floor(viewport.width);
      imageCanvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: imageCanvas.getContext('2d', { alpha: false }), viewport }).promise;
      if (!workerRef.current) {
        const [{ createWorker }, english, chinese] = await Promise.all([
          import('tesseract.js'),
          fetchLanguage('eng', englishDataUrl),
          fetchLanguage('chi_sim', chineseDataUrl),
        ]);
        workerRef.current = await createWorker([english, chinese], 1, {
          workerPath: ocrWorkerUrl,
          corePath: ocrCoreUrl,
          workerBlobURL: false,
          cacheMethod: 'write',
          logger: message => setOcrProgress({ status: t('tools.pdfReader.ocrRunning'), progress: Math.max(0, Math.min(1, message.progress || 0)) }),
        });
      }
      const result = await workerRef.current.recognize(imageCanvas);
      const text = result?.data?.text?.trim() || '';
      setOcrTexts(current => ({ ...current, [pageNumber]: text }));
      setNotice(text ? t('tools.pdfReader.ocrDone') : t('tools.pdfReader.ocrEmpty'));
    } catch {
      await workerRef.current?.terminate?.().catch?.(() => {});
      workerRef.current = null;
      setNotice(t('tools.pdfReader.ocrFailed'));
    } finally { setOcrProgress(null); }
  };

  const writeClipboard = async (value, successKey) => {
    try { await navigator.clipboard.writeText(value); setNotice(t(successKey)); }
    catch { setNotice(t('tools.pdfReader.copyFailed')); }
  };

  const citation = fileInfo ? `《${fileInfo.title}》，第 ${pageNumber} 页` : '';
  const copyCitation = () => writeClipboard(citation, 'tools.pdfReader.citationCopied');
  const copyForAgent = () => writeClipboard(`${t('tools.pdfReader.agentPrompt')}\n\n来源：${citation}\n\n${currentText || t('tools.pdfReader.noText')}${notes[pageNumber] ? `\n\n我的笔记：${notes[pageNumber]}` : ''}`, 'tools.pdfReader.agentCopied');
  const exportMarkdown = () => {
    if (!fileInfo) return;
    const body = pageTexts.map((text, index) => `## 第 ${index + 1} 页\n\n${ocrTexts[index + 1] || text || '_未提取到文字_'}${notes[index + 1] ? `\n\n> 笔记：${notes[index + 1]}` : ''}`).join('\n\n');
    downloadBlob(new Blob([`# ${fileInfo.title}\n\n来源文件：${fileInfo.name}\n\n${body}\n`], { type: 'text/markdown;charset=utf-8' }), `${safeStem(fileInfo.name)}-阅读记录.md`);
  };

  const handleDrop = event => { event.preventDefault(); openFile(event.dataTransfer.files?.[0]); };
  const pageButtons = pdfDocument ? Array.from({ length: Math.min(pdfDocument.numPages, 200) }, (_, index) => index + 1) : [];

  return <section className="pdf-reader-tool" aria-label={t('tools.pdfReader.workspace')}>
    <input ref={fileInputRef} hidden type="file" accept="application/pdf,.pdf" onChange={event => { openFile(event.target.files?.[0]); event.target.value = ''; }}/>
    <div className="pdf-reader-toolbar">
      <div className="pdf-reader-toolbar__identity"><span aria-hidden="true">▤</span><div><strong>{fileInfo?.title || t('tools.pdfReader.emptyTitle')}</strong><small>{notice || (fileInfo ? `${fileInfo.pages} ${t('tools.pdfReader.pages')} · ${formatBytes(fileInfo.size)}` : t('tools.pdfReader.localOnly'))}</small></div></div>
      <div className="pdf-reader-toolbar__actions">
        <button type="button" onClick={() => fileInputRef.current?.click()}>{fileInfo ? t('tools.pdfReader.changeFile') : t('tools.pdfReader.openFile')}</button>
        <button type="button" disabled={!fileInfo} onClick={exportMarkdown}>{t('tools.pdfReader.exportNotes')}</button>
      </div>
    </div>

    {!pdfDocument ? <div className={`pdf-reader-empty ${loading ? 'is-loading' : ''}`} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
      <div className="pdf-reader-empty__mark" aria-hidden="true">PDF</div>
      <span className="kicker">LOCAL DOCUMENT</span>
      <h2>{loading ? t('tools.pdfReader.loading') : t('tools.pdfReader.dropTitle')}</h2>
      <p>{t('tools.pdfReader.dropLead')}</p>
      <button type="button" className="button button--primary" disabled={loading} onClick={() => fileInputRef.current?.click()}>{t('tools.pdfReader.choosePdf')}</button>
      <small>PDF.js · Tesseract.js · {t('tools.pdfReader.privacy')}</small>
    </div> : <div className="pdf-reader-workspace">
      <aside className="pdf-reader-sidebar">
        <div className="pdf-reader-file"><span>{t('tools.pdfReader.document')}</span><strong title={fileInfo.name}>{fileInfo.name}</strong><small>{fileInfo.pages} {t('tools.pdfReader.pages')} · {formatBytes(fileInfo.size)}</small></div>
        <label className="pdf-reader-search"><span>{t('tools.pdfReader.search')}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('tools.pdfReader.searchPlaceholder')}/></label>
        {query.trim() ? <div className="pdf-reader-results"><div><strong>{searchResults.length}</strong><span>{t('tools.pdfReader.matches')}</span></div>{searchResults.length ? searchResults.map(result => <button type="button" key={result.page} onClick={() => changePage(result.page)}><strong>{t('tools.pdfReader.page')} {result.page}</strong><span>{result.snippet}</span></button>) : <p>{extractProgress.current < extractProgress.total ? t('tools.pdfReader.extracting') : t('tools.pdfReader.noMatches')}</p>}</div> : <div className="pdf-reader-pages" aria-label={t('tools.pdfReader.pageList')}>
          <div><span>{t('tools.pdfReader.pageList')}</span>{extractProgress.total > 0 && extractProgress.current < extractProgress.total && <small>{extractProgress.current}/{extractProgress.total}</small>}</div>
          <div className="pdf-reader-page-grid">{pageButtons.map(number => <button type="button" className={number === pageNumber ? 'is-active' : ''} onClick={() => changePage(number)} key={number}>{number}<span aria-hidden="true">{pageTexts[number - 1] ? '·' : ''}</span></button>)}</div>
          {pdfDocument.numPages > pageButtons.length && <small>{t('tools.pdfReader.pageLimit')}</small>}
        </div>}
        <div className="pdf-reader-privacy"><span aria-hidden="true">◎</span><p><strong>{t('tools.pdfReader.localProcessing')}</strong>{t('tools.pdfReader.localProcessingLead')}</p></div>
      </aside>

      <div className="pdf-reader-stage" ref={readerRef}>
        <div className="pdf-reader-controls">
          <div><button type="button" disabled={pageNumber <= 1} onClick={() => changePage(pageNumber - 1)} aria-label={t('tools.pdfReader.previous')}>←</button><label><input type="number" min="1" max={pdfDocument.numPages} value={pageNumber} onChange={event => changePage(event.target.value)}/><span>/ {pdfDocument.numPages}</span></label><button type="button" disabled={pageNumber >= pdfDocument.numPages} onClick={() => changePage(pageNumber + 1)} aria-label={t('tools.pdfReader.next')}>→</button></div>
          <div><button type="button" onClick={() => changeZoom(zoom - 0.1)}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(zoom + 0.1)}>＋</button><button type="button" onClick={() => changeZoom(1)}>{t('tools.pdfReader.fit')}</button></div>
        </div>
        <div className={`pdf-reader-canvas-wrap ${rendering ? 'is-rendering' : ''}`}><canvas ref={canvasRef}/>{rendering && <span>{t('tools.pdfReader.rendering')}</span>}</div>
      </div>

      <aside className="pdf-reader-inspector">
        <section><div className="pdf-reader-section-title"><div><span>{t('tools.pdfReader.pageText')}</span><strong>{t('tools.pdfReader.page')} {pageNumber}</strong></div>{isLikelyScanned && <em>{t('tools.pdfReader.scanned')}</em>}</div>
          <div className="pdf-reader-text">{currentText || <p>{extractProgress.current < pageNumber ? t('tools.pdfReader.extracting') : t('tools.pdfReader.noText')}</p>}</div>
          <button type="button" className="pdf-reader-ocr" disabled={Boolean(ocrProgress)} onClick={runOcr}>{ocrProgress ? `${ocrProgress.status} ${Math.round(ocrProgress.progress * 100)}%` : t('tools.pdfReader.runOcr')}</button>
          {ocrProgress && <progress max="1" value={ocrProgress.progress}/>}<small>{t('tools.pdfReader.ocrNote')}</small>
        </section>
        <section><label className="pdf-reader-note"><span>{t('tools.pdfReader.note')}</span><textarea value={notes[pageNumber] || ''} onChange={event => patchDocument({ notes: { ...notes, [pageNumber]: event.target.value } })} placeholder={t('tools.pdfReader.notePlaceholder')}/></label></section>
        <section className="pdf-reader-citation"><span>{t('tools.pdfReader.citation')}</span><p>{citation}</p><div><button type="button" onClick={copyCitation}>{t('tools.pdfReader.copyCitation')}</button><button type="button" onClick={copyForAgent}>{t('tools.pdfReader.copyAgent')}</button></div></section>
      </aside>
    </div>}
  </section>;
}
