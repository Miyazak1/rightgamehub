import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishDataUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import chineseDataUrl from '@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz?url';
import { del as deleteLocalRecord, get as getLocalRecord, set as setLocalRecord, setMany as setOcrCacheEntries } from 'idb-keyval';
import { useI18n } from './I18n.jsx';
import { isEmbeddedAgentTool, subscribePdfReaderStatus, syncPdfReaderContext } from './agent-tool-bridge.mjs';
import { assertToolDocument, createToolDocument } from './official-tools.mjs';
import { extractPdfDocumentPages } from './pdf-reader-model.mjs';
import { OCR_CACHE_PATH, prepareOcrLanguages, withOcrTimeout } from './pdf-reader-ocr.mjs';
import {
  buildPdfReaderContext, createPdfExcerpt, createPdfFingerprint, createPdfWorkspaceRecord,
  findPagesWithoutText, formatPdfCitation, normalizeBibliography, searchPdfPages,
} from './pdf-reader-workspace.mjs';
import './PdfReaderTool.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = 'mooyu.official-tool.pdf-reader.v1';
const LIBRARY_KEY = 'mooyu.official-tool.pdf-reader.library.v2';
const WORKSPACE_PREFIX = 'mooyu.official-tool.pdf-reader.document.v2:';
const MAX_FILE_BYTES = 150 * 1024 * 1024;
const MAX_LIBRARY_DOCUMENTS = 12;

function createInitialDocument() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = assertToolDocument(JSON.parse(stored), 'pdf-reader');
      if (parsed.content && typeof parsed.content.notes === 'object') return {
        ...parsed,
        content: { annotations: [], bibliography: {}, ...parsed.content },
      };
    }
  } catch { /* A stale local draft should not block the reader. */ }
  return createToolDocument('pdf-reader', {
    content: { title: '', fileName: '', fileSize: 0, pageCount: 0, notes: {}, annotations: [], bibliography: {} },
    view: { page: 1, zoom: 1 },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  });
}

function createInitialLibrary() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(LIBRARY_KEY) || '[]');
    if (Array.isArray(parsed)) return parsed.filter(item => item?.key && item?.name).slice(0, MAX_LIBRARY_DOCUMENTS);
  } catch { /* Ignore malformed history. */ }
  return [];
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeStem(fileName) {
  return String(fileName || '墨鱼文献').replace(/\.pdf$/iu, '').replace(/[\\/:*?"<>|]+/gu, '-').slice(0, 80) || '墨鱼文献';
}

function normalizeStoredDocument(value, fallback) {
  try {
    const parsed = assertToolDocument(value, 'pdf-reader');
    return { ...parsed, content: { notes: {}, annotations: [], bibliography: {}, ...parsed.content } };
  } catch { return fallback; }
}

export default function PdfReaderTool() {
  const { t } = useI18n();
  const [toolDocument, setToolDocument] = useState(createInitialDocument);
  const [library, setLibrary] = useState(createInitialLibrary);
  const [fileKey, setFileKey] = useState('');
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
  const [selectedQuote, setSelectedQuote] = useState('');
  const [annotationType, setAnnotationType] = useState('evidence');
  const [annotationNote, setAnnotationNote] = useState('');
  const [citationStyle, setCitationStyle] = useState('simple');
  const [agentStatus, setAgentStatus] = useState('idle');
  const canvasRef = useRef(null);
  const readerRef = useRef(null);
  const textRef = useRef(null);
  const fileInputRef = useRef(null);
  const renderTaskRef = useRef(null);
  const workerRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const extractionGenerationRef = useRef(0);
  const ocrJobRef = useRef(null);
  const agentSurface = isEmbeddedAgentTool();

  const notes = toolDocument.content.notes || {};
  const annotations = Array.isArray(toolDocument.content.annotations) ? toolDocument.content.annotations : [];
  const bibliography = normalizeBibliography({ title: fileInfo?.title, ...(toolDocument.content.bibliography || {}) });
  const currentText = ocrTexts[pageNumber] || pageTexts[pageNumber - 1] || '';
  const currentAnnotations = annotations.filter(item => Number(item.page) === pageNumber);
  const isLikelyScanned = Boolean(fileInfo && !currentText.trim());
  const searchResults = useMemo(() => searchPdfPages(pageTexts, ocrTexts, query), [pageTexts, ocrTexts, query]);
  const missingPages = useMemo(() => findPagesWithoutText(pageTexts, ocrTexts, fileInfo?.pages), [pageTexts, ocrTexts, fileInfo?.pages]);

  useEffect(() => {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(toolDocument)); }
    catch { /* Notes remain available in memory if storage is full. */ }
  }, [toolDocument]);

  useEffect(() => {
    try { globalThis.localStorage?.setItem(LIBRARY_KEY, JSON.stringify(library)); }
    catch { /* Recent-document metadata is optional. */ }
  }, [library]);

  useEffect(() => {
    if (!fileKey || !fileInfo) return undefined;
    const timer = setTimeout(() => {
      const record = createPdfWorkspaceRecord({ key: fileKey, fileInfo, document: toolDocument, pageTexts, ocrTexts });
      void setLocalRecord(`${WORKSPACE_PREFIX}${fileKey}`, record).catch(() => {});
      setLibrary(current => [{ key: fileKey, name: fileInfo.name, title: fileInfo.title, pages: fileInfo.pages, size: fileInfo.size, updatedAt: record.updatedAt }, ...current.filter(item => item.key !== fileKey)].slice(0, MAX_LIBRARY_DOCUMENTS));
    }, 650);
    return () => clearTimeout(timer);
  }, [fileKey, fileInfo, toolDocument, pageTexts, ocrTexts]);

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
        const viewport = page.getViewport({ scale: Math.min(2.25, available / base.width) * zoom });
        const outputScale = Math.min(globalThis.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
        const task = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException') setNotice(t('tools.pdfReader.renderFailed'));
      } finally { if (live) setRendering(false); }
    };
    void renderPage();
    return () => { live = false; renderTaskRef.current?.cancel?.(); };
  }, [pdfDocument, pageNumber, zoom, readerWidth, t]);

  useEffect(() => subscribePdfReaderStatus(message => setAgentStatus(message.status === 'synced' ? 'synced' : 'failed')), []);

  useEffect(() => {
    if (!agentSurface || !fileInfo) return undefined;
    setAgentStatus('syncing');
    const timer = setTimeout(() => {
      const context = buildPdfReaderContext({ document: toolDocument, fileInfo, pageTexts, ocrTexts, currentPage: pageNumber, query });
      if (!syncPdfReaderContext(context)) setAgentStatus('failed');
    }, 700);
    return () => clearTimeout(timer);
  }, [agentSurface, toolDocument, fileInfo, pageTexts, ocrTexts, pageNumber, query]);

  useEffect(() => () => {
    extractionGenerationRef.current += 1;
    if (ocrJobRef.current) ocrJobRef.current.cancelled = true;
    renderTaskRef.current?.cancel?.(); workerRef.current?.terminate?.(); pdfDocumentRef.current?.destroy?.();
    pdfDocumentRef.current = null;
  }, []);

  const patchDocument = (contentPatch, viewPatch = {}) => setToolDocument(current => ({
    ...current, revision: current.revision + 1,
    content: { ...current.content, ...contentPatch }, view: { ...current.view, ...viewPatch },
    metadata: { ...current.metadata, updatedAt: new Date().toISOString() },
  }));

  const extractAllPages = async (document, generation) => {
    const result = await extractPdfDocumentPages(document, {
      isCurrent: () => generation === extractionGenerationRef.current,
      onProgress: progress => {
        setPageTexts(current => progress.texts.map((text, index) => text || current[index] || ''));
        setExtractProgress({ current: progress.current, total: progress.total });
      },
    });
    if (result.status === 'complete' && result.failedPages === result.total && result.total > 0) setNotice(t('tools.pdfReader.extractFailed'));
  };

  const openFile = async file => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/iu.test(file.name)) { setNotice(t('tools.pdfReader.pdfOnly')); return; }
    if (file.size > MAX_FILE_BYTES) { setNotice(t('tools.pdfReader.fileTooLarge')); return; }
    setLoading(true); setNotice('');
    const generation = extractionGenerationRef.current + 1;
    extractionGenerationRef.current = generation;
    try {
      const key = createPdfFingerprint(file);
      const saved = await getLocalRecord(`${WORKSPACE_PREFIX}${key}`).catch(() => null);
      const previousDocument = pdfDocumentRef.current;
      pdfDocumentRef.current = null; setPdfDocument(null); await previousDocument?.destroy?.();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (generation !== extractionGenerationRef.current) { await document.destroy(); return; }
      const metadata = await document.getMetadata().catch(() => ({ info: {} }));
      const title = String(saved?.fileInfo?.title || metadata?.info?.Title || safeStem(file.name));
      const nextFileInfo = { name: file.name, size: file.size, lastModified: file.lastModified || 0, title, pages: document.numPages };
      const fallbackDocument = createToolDocument('pdf-reader', {
        content: { title, fileName: file.name, fileSize: file.size, pageCount: document.numPages, notes: {}, annotations: [], bibliography: { title } },
        view: { page: 1, zoom: 1 }, metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
      const restoredDocument = normalizeStoredDocument(saved?.document, fallbackDocument);
      pdfDocumentRef.current = document; setPdfDocument(document); setFileKey(key); setFileInfo(nextFileInfo);
      setToolDocument({ ...restoredDocument, content: { ...restoredDocument.content, title, fileName: file.name, fileSize: file.size, pageCount: document.numPages } });
      setPageTexts(Array.isArray(saved?.pageTexts) ? saved.pageTexts.slice(0, document.numPages) : Array(document.numPages).fill(''));
      setOcrTexts(saved?.ocrTexts && typeof saved.ocrTexts === 'object' ? saved.ocrTexts : {});
      setPageNumber(Math.max(1, Math.min(document.numPages, Number(restoredDocument.view?.page) || 1)));
      setZoom(Math.max(.6, Math.min(2.4, Number(restoredDocument.view?.zoom) || 1)));
      setQuery(''); setSelectedQuote(''); setExtractProgress({ current: 0, total: document.numPages });
      setNotice(saved ? t('tools.pdfReader.restored') : t('tools.pdfReader.opened'));
      void extractAllPages(document, generation).catch(() => { if (generation === extractionGenerationRef.current) setNotice(t('tools.pdfReader.extractFailed')); });
    } catch (error) {
      setNotice(error?.name === 'PasswordException' ? t('tools.pdfReader.passwordUnsupported') : t('tools.pdfReader.openFailed'));
    } finally { setLoading(false); }
  };

  const openRecent = async key => {
    if (!key || key === fileKey) return;
    const record = await getLocalRecord(`${WORKSPACE_PREFIX}${key}`).catch(() => null);
    if (!record?.fileInfo || !record?.document) { setNotice(t('tools.pdfReader.historyMissing')); return; }
    extractionGenerationRef.current += 1;
    const previousDocument = pdfDocumentRef.current;
    pdfDocumentRef.current = null; setPdfDocument(null); await previousDocument?.destroy?.();
    const restoredDocument = normalizeStoredDocument(record.document, createInitialDocument());
    setFileKey(key); setFileInfo(record.fileInfo); setToolDocument(restoredDocument);
    setPageTexts(Array.isArray(record.pageTexts) ? record.pageTexts : []); setOcrTexts(record.ocrTexts || {});
    setPageNumber(Math.max(1, Math.min(record.fileInfo.pages || 1, Number(restoredDocument.view?.page) || 1)));
    setZoom(Number(restoredDocument.view?.zoom) || 1); setQuery(''); setNotice(t('tools.pdfReader.reopenForPages'));
  };

  const removeRecent = async () => {
    if (!fileKey) return;
    const removedKey = fileKey;
    extractionGenerationRef.current += 1;
    if (ocrJobRef.current) ocrJobRef.current.cancelled = true;
    renderTaskRef.current?.cancel?.(); await workerRef.current?.terminate?.().catch?.(() => {}); workerRef.current = null;
    const previousDocument = pdfDocumentRef.current;
    pdfDocumentRef.current = null; setPdfDocument(null); await previousDocument?.destroy?.();
    setFileKey(''); setFileInfo(null); setPageTexts([]); setOcrTexts({}); setQuery(''); setPageNumber(1); setZoom(1);
    await deleteLocalRecord(`${WORKSPACE_PREFIX}${removedKey}`).catch(() => {});
    setLibrary(current => current.filter(item => item.key !== removedKey));
    setNotice(t('tools.pdfReader.historyRemoved'));
  };

  const changePage = value => {
    if (!fileInfo) return;
    const next = Math.max(1, Math.min(fileInfo.pages, Number(value) || 1));
    setPageNumber(next); setSelectedQuote(''); patchDocument({}, { page: next, zoom });
  };
  const changeZoom = value => { const next = Math.max(.6, Math.min(2.4, value)); setZoom(next); patchDocument({}, { page: pageNumber, zoom: next }); };

  const ensureOcrWorker = async () => {
    if (workerRef.current) return workerRef.current;
    const [{ createWorker }, languages] = await Promise.all([
      import('tesseract.js'),
      prepareOcrLanguages([{ code: 'eng', url: englishDataUrl }, { code: 'chi_sim', url: chineseDataUrl }], { writeCache: setOcrCacheEntries }),
    ]);
    let initializationError;
    const workerPromise = createWorker(languages, 1, {
      workerPath: ocrWorkerUrl, corePath: ocrCoreUrl, workerBlobURL: false, cachePath: OCR_CACHE_PATH, cacheMethod: 'readOnly',
      errorHandler: error => { initializationError = error; },
      logger: message => {
        const job = ocrJobRef.current;
        if (!job) return;
        setOcrProgress({ status: t('tools.pdfReader.ocrRunning'), progress: Math.max(0, Math.min(.99, message.progress || 0)), current: job.index, total: job.total });
      },
    });
    workerRef.current = await withOcrTimeout(workerPromise.then(worker => {
      if (initializationError) throw new Error(String(initializationError));
      return worker;
    }), 90_000, 'OCR worker initialization timed out');
    return workerRef.current;
  };

  const recognizePage = async number => {
    const page = await pdfDocument.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.6, Math.max(1.7, 2200 / base.width)) });
    const imageCanvas = document.createElement('canvas'); imageCanvas.width = Math.floor(viewport.width); imageCanvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: imageCanvas.getContext('2d', { alpha: false }), viewport }).promise;
    const worker = await ensureOcrWorker();
    const result = await withOcrTimeout(worker.recognize(imageCanvas), 120_000, 'OCR recognition timed out');
    const text = result?.data?.text?.trim() || '';
    setOcrTexts(current => ({ ...current, [number]: text }));
    return text;
  };

  const runOcrPages = async pages => {
    if (!pdfDocument || ocrProgress || !pages.length) return;
    const job = { cancelled: false, index: 0, total: pages.length };
    ocrJobRef.current = job; setNotice(''); setOcrProgress({ status: t('tools.pdfReader.ocrPreparing'), progress: 0, current: 0, total: pages.length });
    let recognized = 0;
    try {
      for (let index = 0; index < pages.length; index += 1) {
        if (job.cancelled) break;
        job.index = index + 1;
        setOcrProgress({ status: t('tools.pdfReader.ocrRunning'), progress: 0, current: job.index, total: job.total });
        if (await recognizePage(pages[index])) recognized += 1;
      }
      setNotice(job.cancelled ? t('tools.pdfReader.ocrCancelled') : t('tools.pdfReader.ocrBatchDone', { count: recognized }));
    } catch {
      await workerRef.current?.terminate?.().catch?.(() => {}); workerRef.current = null;
      setNotice(job.cancelled ? t('tools.pdfReader.ocrCancelled') : t('tools.pdfReader.ocrFailed'));
    } finally { ocrJobRef.current = null; setOcrProgress(null); }
  };

  const cancelOcr = async () => {
    if (ocrJobRef.current) ocrJobRef.current.cancelled = true;
    await workerRef.current?.terminate?.().catch?.(() => {}); workerRef.current = null;
  };

  const captureSelection = () => {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.isCollapsed || !textRef.current?.contains(selection.anchorNode) || !textRef.current?.contains(selection.focusNode)) return;
    setSelectedQuote(selection.toString().trim().slice(0, 8_000));
  };

  const addExcerpt = () => {
    if (!selectedQuote) return;
    try {
      const excerpt = createPdfExcerpt({ page: pageNumber, quote: selectedQuote, type: annotationType, note: annotationNote });
      patchDocument({ annotations: [...annotations, excerpt] });
      setSelectedQuote(''); setAnnotationNote(''); setNotice(t('tools.pdfReader.excerptSaved'));
    } catch { setNotice(t('tools.pdfReader.excerptFailed')); }
  };

  const removeExcerpt = id => patchDocument({ annotations: annotations.filter(item => item.id !== id) });
  const patchBibliography = patch => patchDocument({ bibliography: { ...bibliography, ...patch } });
  const writeClipboard = async (value, successKey) => { try { await navigator.clipboard.writeText(value); setNotice(t(successKey)); } catch { setNotice(t('tools.pdfReader.copyFailed')); } };
  const citation = fileInfo ? formatPdfCitation({ fileInfo, bibliography, page: pageNumber, style: citationStyle }) : '';
  const copyCitation = () => writeClipboard(citation, 'tools.pdfReader.citationCopied');
  const copyForAgent = () => writeClipboard(`${t('tools.pdfReader.agentPrompt')}\n\n来源：${citation}\n\n${currentText || t('tools.pdfReader.noText')}${notes[pageNumber] ? `\n\n我的笔记：${notes[pageNumber]}` : ''}`, 'tools.pdfReader.agentCopied');

  const exportMarkdown = () => {
    if (!fileInfo) return;
    const total = fileInfo.pages || pageTexts.length;
    const body = Array.from({ length: total }, (_, index) => {
      const page = index + 1; const text = ocrTexts[page] || pageTexts[index] || '_未提取到文字_';
      const pageNotes = notes[page] ? `\n\n> 笔记：${notes[page]}` : '';
      const excerpts = annotations.filter(item => Number(item.page) === page).map(item => `\n\n> [${item.type}] ${item.quote}${item.note ? ` — ${item.note}` : ''}`).join('');
      return `## 第 ${page} 页\n\n${text}${pageNotes}${excerpts}`;
    }).join('\n\n');
    const source = formatPdfCitation({ fileInfo, bibliography, page: 1, style: 'apa' });
    downloadBlob(new Blob([`# ${fileInfo.title}\n\n来源：${source}\n\n${body}\n`], { type: 'text/markdown;charset=utf-8' }), `${safeStem(fileInfo.name)}-阅读记录.md`);
  };

  const handleDrop = event => { event.preventDefault(); void openFile(event.dataTransfer.files?.[0]); };
  const pageButtons = fileInfo ? Array.from({ length: Math.min(fileInfo.pages, 200) }, (_, index) => index + 1) : [];

  return <section className="pdf-reader-tool" aria-label={t('tools.pdfReader.workspace')}>
    <input ref={fileInputRef} hidden type="file" accept="application/pdf,.pdf" onChange={event => { void openFile(event.target.files?.[0]); event.target.value = ''; }}/>
    <div className="pdf-reader-toolbar">
      <div className="pdf-reader-toolbar__identity"><span aria-hidden="true">▤</span><div><strong>{fileInfo?.title || t('tools.pdfReader.emptyTitle')}</strong><small>{notice || (fileInfo ? `${fileInfo.pages} ${t('tools.pdfReader.pages')} · ${formatBytes(fileInfo.size)}` : t('tools.pdfReader.localOnly'))}</small></div></div>
      <div className="pdf-reader-toolbar__actions">
        {agentSurface && fileInfo && <span className={`pdf-reader-agent-state is-${agentStatus}`}>{t(`tools.pdfReader.agent.${agentStatus}`)}</span>}
        <button type="button" onClick={() => fileInputRef.current?.click()}>{fileInfo ? t('tools.pdfReader.changeFile') : t('tools.pdfReader.openFile')}</button>
        <button type="button" disabled={!fileInfo} onClick={exportMarkdown}>{t('tools.pdfReader.exportNotes')}</button>
      </div>
    </div>

    {!fileInfo ? <div className={`pdf-reader-empty ${loading ? 'is-loading' : ''}`} onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
      <div className="pdf-reader-empty__mark" aria-hidden="true">PDF</div><span className="kicker">LOCAL DOCUMENT</span>
      <h2>{loading ? t('tools.pdfReader.loading') : t('tools.pdfReader.dropTitle')}</h2><p>{t('tools.pdfReader.dropLead')}</p>
      <button type="button" className="button button--primary" disabled={loading} onClick={() => fileInputRef.current?.click()}>{t('tools.pdfReader.choosePdf')}</button>
      <ol className="pdf-reader-guide"><li><strong>1</strong><span>{t('tools.pdfReader.guideOpen')}</span></li><li><strong>2</strong><span>{t('tools.pdfReader.guideOcr')}</span></li><li><strong>3</strong><span>{t('tools.pdfReader.guideExcerpt')}</span></li><li><strong>4</strong><span>{t('tools.pdfReader.guideAgent')}</span></li></ol>
      {library.length > 0 && <div className="pdf-reader-recent"><strong>{t('tools.pdfReader.recent')}</strong>{library.map(item => <button type="button" key={item.key} onClick={() => void openRecent(item.key)}><span>{item.title || item.name}</span><small>{item.pages} {t('tools.pdfReader.pages')}</small></button>)}</div>}
      <small>PDF.js · Tesseract.js · {t('tools.pdfReader.privacy')}</small>
    </div> : <div className="pdf-reader-workspace">
      <aside className="pdf-reader-sidebar">
        <label className="pdf-reader-library"><span>{t('tools.pdfReader.library')}</span><select value={fileKey} onChange={event => void openRecent(event.target.value)}>{library.map(item => <option key={item.key} value={item.key}>{item.title || item.name}</option>)}</select></label>
        <div className="pdf-reader-file"><span>{t('tools.pdfReader.document')}</span><strong title={fileInfo.name}>{fileInfo.name}</strong><small>{fileInfo.pages} {t('tools.pdfReader.pages')} · {formatBytes(fileInfo.size)}</small><button type="button" onClick={() => void removeRecent()}>{t('tools.pdfReader.removeHistory')}</button></div>
        <label className="pdf-reader-search"><span>{t('tools.pdfReader.search')}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('tools.pdfReader.searchPlaceholder')}/></label>
        {query.trim() ? <div className="pdf-reader-results"><div><strong>{searchResults.length}</strong><span>{t('tools.pdfReader.matches')}</span></div>{searchResults.length ? searchResults.map(result => <button type="button" key={result.page} onClick={() => changePage(result.page)}><strong>{t('tools.pdfReader.page')} {result.page}</strong><span>{result.snippet}</span></button>) : <p>{extractProgress.current < extractProgress.total ? t('tools.pdfReader.extracting') : t('tools.pdfReader.noMatches')}</p>}</div> : <div className="pdf-reader-pages" aria-label={t('tools.pdfReader.pageList')}>
          <div><span>{t('tools.pdfReader.pageList')}</span>{extractProgress.total > 0 && extractProgress.current < extractProgress.total && <small>{extractProgress.current}/{extractProgress.total}</small>}</div>
          <div className="pdf-reader-page-grid">{pageButtons.map(number => <button type="button" className={number === pageNumber ? 'is-active' : ''} onClick={() => changePage(number)} key={number}>{number}<span aria-hidden="true">{(ocrTexts[number] || pageTexts[number - 1]) ? '·' : ''}</span></button>)}</div>
          {fileInfo.pages > pageButtons.length && <small>{t('tools.pdfReader.pageLimit')}</small>}
        </div>}
        <div className="pdf-reader-privacy"><span aria-hidden="true">◎</span><p><strong>{t('tools.pdfReader.localProcessing')}</strong>{t('tools.pdfReader.localProcessingLead')}</p></div>
      </aside>

      <div className="pdf-reader-stage" ref={readerRef}>
        <div className="pdf-reader-controls"><div><button type="button" disabled={pageNumber <= 1} onClick={() => changePage(pageNumber - 1)}>←</button><label><input type="number" min="1" max={fileInfo.pages} value={pageNumber} onChange={event => changePage(event.target.value)}/><span>/ {fileInfo.pages}</span></label><button type="button" disabled={pageNumber >= fileInfo.pages} onClick={() => changePage(pageNumber + 1)}>→</button></div><div><button type="button" disabled={!pdfDocument} onClick={() => changeZoom(zoom - .1)}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" disabled={!pdfDocument} onClick={() => changeZoom(zoom + .1)}>＋</button><button type="button" disabled={!pdfDocument} onClick={() => changeZoom(1)}>{t('tools.pdfReader.fit')}</button></div></div>
        {pdfDocument ? <div className={`pdf-reader-canvas-wrap ${rendering ? 'is-rendering' : ''}`}><canvas ref={canvasRef}/>{rendering && <span>{t('tools.pdfReader.rendering')}</span>}</div> : <div className="pdf-reader-reopen"><strong>{t('tools.pdfReader.historyReady')}</strong><p>{t('tools.pdfReader.reopenForPages')}</p><button type="button" onClick={() => fileInputRef.current?.click()}>{t('tools.pdfReader.reopen')}</button></div>}
      </div>

      <aside className="pdf-reader-inspector">
        <section><div className="pdf-reader-section-title"><div><span>{t('tools.pdfReader.pageText')}</span><strong>{t('tools.pdfReader.page')} {pageNumber}</strong></div>{isLikelyScanned && <em>{t('tools.pdfReader.scanned')}</em>}</div>
          <div ref={textRef} className="pdf-reader-text" onMouseUp={captureSelection}>{currentText || <p>{extractProgress.current < pageNumber && pdfDocument ? t('tools.pdfReader.extracting') : t('tools.pdfReader.noText')}</p>}</div>
          {selectedQuote && <div className="pdf-reader-excerpt-compose"><blockquote>{selectedQuote}</blockquote><div><select value={annotationType} onChange={event => setAnnotationType(event.target.value)}><option value="point">{t('tools.pdfReader.type.point')}</option><option value="evidence">{t('tools.pdfReader.type.evidence')}</option><option value="question">{t('tools.pdfReader.type.question')}</option><option value="verify">{t('tools.pdfReader.type.verify')}</option></select><input value={annotationNote} onChange={event => setAnnotationNote(event.target.value)} placeholder={t('tools.pdfReader.excerptNote')}/></div><button type="button" onClick={addExcerpt}>{t('tools.pdfReader.saveExcerpt')}</button></div>}
          <div className="pdf-reader-ocr-actions"><button type="button" className="pdf-reader-ocr" disabled={!pdfDocument || Boolean(ocrProgress)} onClick={() => void runOcrPages([pageNumber])}>{t('tools.pdfReader.runOcr')}</button><button type="button" disabled={!pdfDocument || !missingPages.length || Boolean(ocrProgress)} onClick={() => void runOcrPages(missingPages)}>{t('tools.pdfReader.ocrMissing', { count: missingPages.length })}</button></div>
          {ocrProgress && <><div className="pdf-reader-ocr-status"><span>{ocrProgress.status} {ocrProgress.current}/{ocrProgress.total}</span><button type="button" onClick={() => void cancelOcr()}>{t('tools.pdfReader.cancel')}</button></div><progress max="1" value={ocrProgress.progress}/></>}<small>{t('tools.pdfReader.ocrNote')}</small>
        </section>
        {currentAnnotations.length > 0 && <section className="pdf-reader-excerpts"><span>{t('tools.pdfReader.excerpts')}</span>{currentAnnotations.map(item => <article key={item.id}><header><strong>{t(`tools.pdfReader.type.${item.type}`)}</strong><button type="button" onClick={() => removeExcerpt(item.id)}>×</button></header><p>{item.quote}</p>{item.note && <small>{item.note}</small>}</article>)}</section>}
        <section><label className="pdf-reader-note"><span>{t('tools.pdfReader.note')}</span><textarea value={notes[pageNumber] || ''} onChange={event => patchDocument({ notes: { ...notes, [pageNumber]: event.target.value } })} placeholder={t('tools.pdfReader.notePlaceholder')}/></label></section>
        <section className="pdf-reader-citation"><span>{t('tools.pdfReader.citation')}</span><select value={citationStyle} onChange={event => setCitationStyle(event.target.value)}><option value="simple">{t('tools.pdfReader.citationSimple')}</option><option value="apa">APA</option><option value="gbt">GB/T 7714</option><option value="bibtex">BibTeX</option></select><p>{citation}</p><div><button type="button" onClick={copyCitation}>{t('tools.pdfReader.copyCitation')}</button>{!agentSurface && <button type="button" onClick={copyForAgent}>{t('tools.pdfReader.copyAgent')}</button>}</div>
          <details className="pdf-reader-metadata"><summary>{t('tools.pdfReader.metadata')}</summary><label>{t('tools.pdfReader.authors')}<input value={bibliography.authors} onChange={event => patchBibliography({ authors: event.target.value })}/></label><label>{t('tools.pdfReader.year')}<input value={bibliography.year} onChange={event => patchBibliography({ year: event.target.value })}/></label><label>{t('tools.pdfReader.publisher')}<input value={bibliography.publisher} onChange={event => patchBibliography({ publisher: event.target.value })}/></label><label>DOI<input value={bibliography.doi} onChange={event => patchBibliography({ doi: event.target.value })}/></label></details>
        </section>
      </aside>
    </div>}
  </section>;
}
