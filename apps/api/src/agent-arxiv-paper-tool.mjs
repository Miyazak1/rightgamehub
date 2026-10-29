import crypto from 'node:crypto';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { validatePaperEvidenceSpanV1, validatePaperIdentityV1, validatePaperLayoutManifestV1,
  validatePaperVersionV1 } from './agent-paper-research-contracts.mjs';
import { analyzePaperTextLayerPage, assessPaperParseQuality,
  validatePaperParseQualityV1 } from './agent-paper-parse-quality.mjs';

const MAX_METADATA_BYTES = 262144;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 80;
const MAX_TEXT_CHARS = 160000;
const MAX_BLOCK_CHARS = 1800;
const MAX_EVIDENCE = 96;
const PARSER_VERSION = 'pdfjs-dist@6.4.299:text-layer-v2';
const MODERN_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/u;
const LEGACY_ID = /^[a-z][a-z0-9.-]*\/[0-9]{7}(?:v\d+)?$/iu;

export const ARXIV_PAPER_READ_TOOL = Object.freeze({
  toolKey: 'research.paper.arxiv.read',
  contractVersion: 2,
  status: 'active',
  capabilityKey: 'research.paper.read',
  riskLevel: 'L1',
  executionClass: 'remote',
  effectClass: 'read-only',
  inputSchema: { key: 'paper.arxiv.read.input', version: 1 },
  outputSchema: { key: 'paper.arxiv.read.output', version: 2 },
  networkPolicy: {
    allowedOrigins: ['https://export.arxiv.org', 'https://arxiv.org'],
    redirects: 'deny', authentication: 'none', maxRequests: 2,
  },
  filesystemPolicy: { read: false, write: false },
  timeoutSeconds: 90,
  outputLimitBytes: 1048576,
});

export const AGENT_ARXIV_PAPER_LIMITS = Object.freeze({
  maxNetworkRequests: 2, maxMetadataBytes: MAX_METADATA_BYTES, maxPdfBytes: MAX_PDF_BYTES,
  maxPages: MAX_PAGES, maxTextChars: MAX_TEXT_CHARS, maxEvidence: MAX_EVIDENCE,
});

export class AgentArxivPaperToolError extends Error {
  constructor(code, { retryable = false, notDispatched = false, backoffSeconds = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentArxivPaperToolError';
    this.code = code;
    this.retryable = retryable;
    this.notDispatched = notDispatched;
    this.backoffSeconds = backoffSeconds;
  }
}

const fail = (code, options) => { throw new AgentArxivPaperToolError(code, options); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const sha256Bytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function deterministicUuid(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function versionNumber(value) {
  return Number(value.match(/v(\d+)$/u)?.[1] ?? 1);
}

function baseId(value) {
  return value.replace(/v\d+$/u, '');
}

export function normalizeArxivPaperLocator(value) {
  if (typeof value !== 'string' || value.length > 300) {
    fail('AGENT_ARXIV_PAPER_INVALID', { notDispatched: true });
  }
  let locator = value.trim();
  if (/^https?:\/\//iu.test(locator)) {
    let url;
    try { url = new URL(locator); } catch { fail('AGENT_ARXIV_PAPER_INVALID', { notDispatched: true }); }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'arxiv.org' || url.username
      || url.password || url.port || url.search || url.hash) {
      fail('AGENT_ARXIV_PAPER_INVALID', { notDispatched: true });
    }
    const match = url.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/u);
    if (!match) fail('AGENT_ARXIV_PAPER_INVALID', { notDispatched: true });
    try { locator = decodeURIComponent(match[1]); }
    catch { fail('AGENT_ARXIV_PAPER_INVALID', { notDispatched: true }); }
  }
  if (!(MODERN_ID.test(locator) || LEGACY_ID.test(locator))) {
    fail('AGENT_ARXIV_PAPER_INVALID', { notDispatched: true });
  }
  const normalized = locator.toLowerCase();
  return {
    requestedId: normalized,
    baseId: baseId(normalized),
    requestedVersion: /v\d+$/u.test(normalized) ? versionNumber(normalized) : null,
    abstractUrl: `https://arxiv.org/abs/${normalized}`,
  };
}

export function validateArxivPaperReadInput(value) {
  if (!exact(value, ['paper'])) fail('AGENT_ARXIV_TOOL_INPUT_INVALID', { notDispatched: true });
  return { paper: normalizeArxivPaperLocator(value.paper).abstractUrl };
}

function xmlDecode(value) {
  const codePoint = raw => {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff
      || (value >= 0xd800 && value <= 0xdfff)) fail('AGENT_ARXIV_METADATA_INVALID');
    return String.fromCodePoint(value);
  };
  return value.replace(/&#x([0-9a-f]+);/giu, (_, code) => codePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/gu, (_, code) => codePoint(Number(code)))
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'").replace(/&amp;/gu, '&');
}

function element(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'iu'));
  return match ? xmlDecode(match[1].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()) : null;
}

function elements(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'giu'))]
    .map(match => xmlDecode(match[1].replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()));
}

function parseAtom(xml, requestedBaseId) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail('AGENT_ARXIV_METADATA_INVALID');
  const entry = xml.match(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/iu)?.[1];
  if (!entry) fail('AGENT_ARXIV_PAPER_NOT_FOUND');
  const idUrl = element(entry, 'id');
  let resolved;
  try {
    const url = new URL(idUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    if (!['arxiv.org', 'export.arxiv.org'].includes(url.hostname.toLowerCase())) throw new Error('host');
    resolved = url.pathname.replace(/^\/abs\//u, '').replace(/\/$/u, '').toLowerCase();
  } catch (error) { fail('AGENT_ARXIV_METADATA_INVALID', { cause: error }); }
  if (!(MODERN_ID.test(resolved) || LEGACY_ID.test(resolved)) || baseId(resolved) !== requestedBaseId) {
    fail('AGENT_ARXIV_METADATA_INVALID');
  }
  const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/giu)]
    .map(match => element(match[1], 'name')).filter(Boolean).slice(0, 200);
  const categoryTerms = [...entry.matchAll(/<category\s+[^>]*term=["']([^"']+)["'][^>]*\/?\s*>/giu)]
    .map(match => xmlDecode(match[1]).trim()).filter(Boolean).slice(0, 50);
  const published = element(entry, 'published');
  const updated = element(entry, 'updated');
  const doi = element(entry, 'arxiv:doi')?.toLowerCase() ?? null;
  const title = element(entry, 'title');
  const summary = element(entry, 'summary');
  const venue = element(entry, 'arxiv:journal_ref');
  if (!title || !summary || authors.length === 0 || !published || !updated
    || !Number.isFinite(new Date(published).getTime()) || !Number.isFinite(new Date(updated).getTime())) {
    fail('AGENT_ARXIV_METADATA_INVALID');
  }
  return { resolvedId: resolved, title: title.slice(0, 1000), abstract: summary.slice(0, 12000),
    authors, categories: [...new Set(categoryTerms)], publishedAt: new Date(published).toISOString(),
    updatedAt: new Date(updated).toISOString(), doi: doi?.slice(0, 300) ?? null,
    venue: venue?.slice(0, 500) ?? null };
}

function retryAfter(response) {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  const seconds = /^\d+$/u.test(raw.trim()) ? Number(raw.trim())
    : Math.ceil((new Date(raw).getTime() - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(3600, Math.max(1, seconds)) : null;
}

async function readBytes(response, maxBytes, code) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) fail(code);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) fail(code);
  return bytes;
}

function normalizePageText(items) {
  return items.map(item => typeof item?.str === 'string' ? item.str : '').join(' ')
    .replace(/\u0000/gu, '').replace(/\s+/gu, ' ').trim();
}

function splitBlocks(text, maxChars = MAX_BLOCK_CHARS) {
  const blocks = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + maxChars);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary > offset + Math.floor(maxChars * 0.6)) end = boundary;
    }
    const value = text.slice(offset, end).trim();
    if (value) blocks.push(value);
    offset = end;
    while (offset < text.length && /\s/u.test(text[offset])) offset += 1;
  }
  return blocks;
}

export async function extractPaperPdf(bytes, artifactVersionId, pdfLoader = getDocument) {
  let task;
  try {
    task = pdfLoader({ data: bytes, disableFontFace: true, useSystemFonts: false,
      isEvalSupported: false, stopAtErrors: true });
    const document = await task.promise;
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) fail('AGENT_ARXIV_PDF_INVALID');
    if (document.numPages > MAX_PAGES) fail('AGENT_ARXIV_PDF_TOO_MANY_PAGES');
    const pages = [];
    const pageSignals = [];
    let totalChars = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableCombineTextItems: false });
      const pageText = normalizePageText(content.items ?? []);
      totalChars += Array.from(pageText).length;
      if (totalChars > MAX_TEXT_CHARS) fail('AGENT_ARXIV_PDF_TEXT_TOO_LARGE');
      const blocks = splitBlocks(pageText).map((text, index) => ({
        id: `p${pageNumber}-b${index + 1}`, kind: 'paragraph',
        bbox: [0, 0, Number(viewport.width), Number(viewport.height)], text,
        confidence: 0.9, extractionMethod: 'text-layer',
      }));
      pages.push({ page: pageNumber, width: Number(viewport.width), height: Number(viewport.height),
        readingOrder: blocks.map(block => block.id), blocks });
      let imageCount = 0;
      if (typeof page.getOperatorList === 'function') {
        const operators = await page.getOperatorList();
        const imageOps = new Set([OPS.paintImageMaskXObject, OPS.paintImageXObject,
          OPS.paintInlineImageXObject].filter(Number.isSafeInteger));
        imageCount = (operators?.fnArray ?? []).filter(operator => imageOps.has(operator)).length;
      }
      pageSignals.push(analyzePaperTextLayerPage({ page: pageNumber, width: Number(viewport.width),
        height: Number(viewport.height), items: content.items ?? [], imageCount }));
      page.cleanup?.();
    }
    await document.destroy?.();
    if (totalChars === 0) fail('AGENT_ARXIV_PDF_TEXT_EMPTY');
    const candidates = pages.flatMap(page => page.blocks.map(block => ({ page, block })));
    const selected = [];
    for (const page of pages) {
      const first = page.blocks[0];
      if (first) selected.push({ page, block: first });
    }
    for (const candidate of candidates) {
      if (selected.length >= MAX_EVIDENCE) break;
      if (!selected.some(item => item.block.id === candidate.block.id)) selected.push(candidate);
    }
    const evidence = selected.slice(0, MAX_EVIDENCE).map(({ page, block }) => ({ artifactVersionId,
      locator: { kind: 'paper.layout', pages: [page.page], sectionPath: [],
        blockIds: [block.id], objectLabel: null },
      quoteText: block.text, quoteHash: stableHash(block.text), extractionMethod: 'text-layer',
      confidence: 0.9 }));
    if (evidence.length === 0) fail('AGENT_ARXIV_PDF_TEXT_EMPTY');
    const qualityAssessment = assessPaperParseQuality({ parserVersion: PARSER_VERSION, pageSignals,
      evidencePages: evidence.flatMap(span => span.locator.pages) });
    return { pageCount: pages.length, pages, evidence, qualityAssessment, pageSignals };
  } catch (error) {
    if (error instanceof AgentArxivPaperToolError) throw error;
    fail('AGENT_ARXIV_PDF_INVALID', { cause: error });
  } finally { await task?.destroy?.(); }
}

export function validateArxivPaperReadOutput(value) {
  const version = value?.schemaVersion === 'arxiv-paper-research-v2' ? 2
    : value?.schemaVersion === 'arxiv-paper-research-v1' ? 1 : 0;
  const required = ['schemaVersion', 'identity', 'version', 'layoutManifest', 'evidenceSpans',
    'metadata', 'sourceVersion', ...(version === 2 ? ['qualityAssessment'] : [])];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !required.includes(key)) || required.some(key => !Object.hasOwn(value, key))
    || version === 0
    || !exact(value.metadata, ['abstract', 'categories', 'updatedAt', 'versionedArxivId', 'extractionMethod'])
    || typeof value.metadata.abstract !== 'string' || value.metadata.abstract.length < 1
    || value.metadata.abstract.length > 12000 || !Array.isArray(value.metadata.categories)
    || value.metadata.categories.length > 50
    || value.metadata.categories.some(item => typeof item !== 'string' || item.trim() !== item
      || item.length < 1 || item.length > 120)
    || new Set(value.metadata.categories).size !== value.metadata.categories.length
    || !Number.isFinite(new Date(value.metadata.updatedAt).getTime())
    || !(MODERN_ID.test(value.metadata.versionedArxivId) || LEGACY_ID.test(value.metadata.versionedArxivId))
    || value.metadata.extractionMethod !== 'pdfjs-text-layer'
    || !exact(value.sourceVersion, ['revision', 'canonicalUri', 'fetchedAt', 'contentSha256'])
    || value.sourceVersion.revision !== value.metadata.versionedArxivId
    || value.sourceVersion.contentSha256 !== value.version.contentSha256
    || !Array.isArray(value.evidenceSpans) || value.evidenceSpans.length < 1
    || value.evidenceSpans.length > MAX_EVIDENCE) fail('AGENT_ARXIV_TOOL_OUTPUT_INVALID');
  validatePaperIdentityV1(value.identity);
  validatePaperVersionV1(value.version);
  validatePaperLayoutManifestV1(value.layoutManifest);
  value.evidenceSpans.forEach(validatePaperEvidenceSpanV1);
  if (version === 2) {
    validatePaperParseQualityV1(value.qualityAssessment);
    if (value.qualityAssessment.parserVersion !== value.layoutManifest.parserVersion) {
      fail('AGENT_ARXIV_TOOL_OUTPUT_INVALID');
    }
  }
  if (value.layoutManifest.artifactVersionId !== value.version.artifactVersionId
    // New acquisitions use the direct PDF URL; retain compatibility with archived .pdf references.
    || ![`https://arxiv.org/pdf/${value.metadata.versionedArxivId}`,
      `https://arxiv.org/pdf/${value.metadata.versionedArxivId}.pdf`].includes(value.sourceVersion.canonicalUri)
    || value.version.sourceUrl !== value.sourceVersion.canonicalUri
    || value.sourceVersion.fetchedAt !== value.version.fetchedAt
    || baseId(value.metadata.versionedArxivId) !== value.identity.identifiers.arxiv
    || value.evidenceSpans.some(span => span.artifactVersionId !== value.version.artifactVersionId)) {
    fail('AGENT_ARXIV_TOOL_OUTPUT_INVALID');
  }
  const blockIds = new Set(value.layoutManifest.pages.flatMap(page => page.blocks.map(block => block.id)));
  if (value.evidenceSpans.some(span => span.locator.pages.some(page => page > value.layoutManifest.pageCount)
    || span.locator.blockIds.some(id => !blockIds.has(id)))) fail('AGENT_ARXIV_TOOL_OUTPUT_INVALID');
  return structuredClone(value);
}

export function createArxivPaperReadAdapter({ fetchImpl = globalThis.fetch,
  contactEmail = process.env.AGENT_ARXIV_CONTACT_EMAIL ?? null, pdfLoader = getDocument } = {}) {
  if (typeof fetchImpl !== 'function' || typeof pdfLoader !== 'function') {
    fail('AGENT_ARXIV_ADAPTER_CONFIG_INVALID', { notDispatched: true });
  }
  if (typeof contactEmail !== 'string' || contactEmail.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)) {
    fail('AGENT_ARXIV_CONTACT_REQUIRED', { notDispatched: true });
  }
  const request = async (url, timeoutSeconds) => {
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: { Accept: '*/*', 'User-Agent': `GameHub-Agent-Research/1.0 (${contactEmail})` } });
    } catch (error) { fail('AGENT_ARXIV_NETWORK_FAILED', { retryable: true, cause: error }); }
    if (!response.ok) {
      const backoffSeconds = retryAfter(response)
        ?? ([429, 503].includes(response.status) || response.status >= 500 ? 60 : null);
      fail(response.status === 404 ? 'AGENT_ARXIV_PAPER_NOT_FOUND'
        : [429, 503].includes(response.status) ? 'AGENT_ARXIV_RATE_LIMITED' : 'AGENT_ARXIV_UPSTREAM_FAILED',
      { retryable: backoffSeconds !== null, backoffSeconds });
    }
    return response;
  };
  return async ({ request: input, timeoutSeconds = 90 }) => {
    const validatedInput = validateArxivPaperReadInput(input);
    const locator = normalizeArxivPaperLocator(validatedInput.paper);
    const metadataUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(locator.requestedId)}`;
    const metadataResponse = await request(metadataUrl, timeoutSeconds);
    const metadataContentType = (metadataResponse.headers.get('content-type') ?? '').toLowerCase();
    if (metadataContentType && !metadataContentType.includes('xml')
      && !metadataContentType.includes('atom')) fail('AGENT_ARXIV_METADATA_CONTENT_TYPE_INVALID');
    const metadataBytes = await readBytes(metadataResponse, MAX_METADATA_BYTES,
      'AGENT_ARXIV_METADATA_TOO_LARGE');
    let metadata;
    try {
      metadata = parseAtom(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes), locator.baseId);
    } catch (error) {
      if (error instanceof AgentArxivPaperToolError) throw error;
      fail('AGENT_ARXIV_METADATA_INVALID', { cause: error });
    }
    if (locator.requestedVersion !== null && versionNumber(metadata.resolvedId) !== locator.requestedVersion) {
      fail('AGENT_ARXIV_VERSION_NOT_FOUND');
    }
    const pdfUrl = `https://arxiv.org/pdf/${metadata.resolvedId}`;
    const pdfResponse = await request(pdfUrl, timeoutSeconds);
    const contentType = (pdfResponse.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('application/pdf')) fail('AGENT_ARXIV_PDF_CONTENT_TYPE_INVALID');
    const pdfBytes = await readBytes(pdfResponse, MAX_PDF_BYTES, 'AGENT_ARXIV_PDF_TOO_LARGE');
    const contentSha256 = sha256Bytes(pdfBytes);
    const artifactVersionId = deterministicUuid(`arxiv:${metadata.resolvedId}:${contentSha256}`);
    const extracted = await extractPaperPdf(pdfBytes, artifactVersionId, pdfLoader);
    const identity = {
      artifactType: 'academic-paper',
      canonicalId: metadata.doi ? `doi:${metadata.doi}` : `arxiv:${locator.baseId}`,
      identifiers: { doi: metadata.doi, arxiv: locator.baseId }, title: metadata.title,
      authors: metadata.authors, year: new Date(metadata.publishedAt).getUTCFullYear(),
      venue: metadata.venue, identityConfidence: 'confirmed',
    };
    const fetchedAt = new Date().toISOString();
    const version = { artifactVersionId, identityCanonicalId: identity.canonicalId,
      versionKind: 'preprint', sourceUrl: pdfUrl, fetchedAt, contentSha256,
      accessLevel: 'fulltext-open', parentVersionId: null, versionRelation: 'initial' };
    const layoutManifest = { artifactVersionId, pageCount: extracted.pageCount,
      parserVersion: PARSER_VERSION, pages: extracted.pages };
    const output = { schemaVersion: 'arxiv-paper-research-v2', identity, version, layoutManifest,
      evidenceSpans: extracted.evidence, qualityAssessment: extracted.qualityAssessment,
      metadata: { abstract: metadata.abstract, categories: metadata.categories,
        updatedAt: metadata.updatedAt, versionedArxivId: metadata.resolvedId,
        extractionMethod: 'pdfjs-text-layer' },
      sourceVersion: { revision: metadata.resolvedId, canonicalUri: pdfUrl, fetchedAt, contentSha256 } };
    validateArxivPaperReadOutput(output);
    return { receiptId: `arxiv:${metadata.resolvedId}@${contentSha256}`,
      output, responseRef: { sourceType: 'paper', canonicalUri: pdfUrl,
        revision: metadata.resolvedId, contentSha256 },
      usage: { toolCalls: 1, networkRequests: 2 } };
  };
}
