import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export const PAPER_IDENTITY_SCHEMA = Object.freeze({ key: 'research.paper.identity', version: 1 });
export const PAPER_VERSION_SCHEMA = Object.freeze({ key: 'research.paper.version', version: 1 });
export const PAPER_LAYOUT_MANIFEST_SCHEMA = Object.freeze({ key: 'research.paper.layout-manifest', version: 1 });
export const PAPER_EVIDENCE_SPAN_SCHEMA = Object.freeze({ key: 'research.paper.evidence-span', version: 1 });

export class AgentPaperResearchContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperResearchContractError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperResearchContractError(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const text = (value, min, max) => typeof value === 'string' && value.trim() === value
  && Array.from(value).length >= min && Array.from(value).length <= max;
const nullableText = (value, min, max) => value === null || text(value, min, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;

function iso(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function httpsUrl(value) {
  if (!text(value, 8, 2000)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function validatePaperIdentityV1(value) {
  if (!exact(value, ['artifactType', 'canonicalId', 'identifiers', 'title', 'authors', 'year', 'venue',
    'identityConfidence']) || value.artifactType !== 'academic-paper'
    || !text(value.canonicalId, 5, 300)
    || !exact(value.identifiers, ['doi', 'arxiv'])
    || !nullableText(value.identifiers.doi, 5, 300)
    || !nullableText(value.identifiers.arxiv, 5, 120)
    || (value.identifiers.doi === null && value.identifiers.arxiv === null)
    || !text(value.title, 1, 1000) || !Array.isArray(value.authors) || value.authors.length < 1
    || value.authors.length > 200 || value.authors.some(author => !text(author, 1, 240))
    || !Number.isSafeInteger(value.year) || value.year < 1600 || value.year > 3000
    || !nullableText(value.venue, 1, 500)
    || !['confirmed', 'provisional', 'unresolved'].includes(value.identityConfidence)) {
    fail('AGENT_PAPER_IDENTITY_INVALID');
  }
  return structuredClone(value);
}

export function validatePaperVersionV1(value) {
  if (!exact(value, ['artifactVersionId', 'identityCanonicalId', 'versionKind', 'sourceUrl', 'fetchedAt',
    'contentSha256', 'accessLevel', 'parentVersionId', 'versionRelation'])
    || typeof value.artifactVersionId !== 'string' || !UUID.test(value.artifactVersionId)
    || !text(value.identityCanonicalId, 5, 300)
    || !['preprint', 'conference', 'journal', 'author-manuscript', 'supplement', 'erratum',
      'retraction-notice', 'unknown'].includes(value.versionKind)
    || !httpsUrl(value.sourceUrl) || !iso(value.fetchedAt)
    || typeof value.contentSha256 !== 'string' || !SHA256.test(value.contentSha256)
    || !['metadata-only', 'abstract-only', 'fulltext-open', 'fulltext-user-provided',
      'fulltext-restricted'].includes(value.accessLevel)
    || !(value.parentVersionId === null || (typeof value.parentVersionId === 'string'
      && UUID.test(value.parentVersionId)))
    || !['initial', 'revises', 'supplements', 'corrects', 'retracts', 'related-unconfirmed']
      .includes(value.versionRelation)
    || (value.versionRelation === 'initial') !== (value.parentVersionId === null)) {
    fail('AGENT_PAPER_VERSION_INVALID');
  }
  return structuredClone(value);
}

const PAPER_BLOCK_KINDS = new Set(['title', 'abstract', 'heading', 'paragraph', 'footnote', 'formula',
  'algorithm', 'code', 'table', 'figure', 'caption', 'reference']);

function validatePaperBlock(block, pageWidth, pageHeight) {
  if (!exact(block, ['id', 'kind', 'bbox', 'text', 'confidence', 'extractionMethod'])
    || !text(block.id, 1, 160) || !PAPER_BLOCK_KINDS.has(block.kind)
    || !Array.isArray(block.bbox) || block.bbox.length !== 4
    || block.bbox.some(number => typeof number !== 'number' || !Number.isFinite(number))
    || block.bbox[0] < 0 || block.bbox[1] < 0 || block.bbox[2] <= block.bbox[0]
    || block.bbox[3] <= block.bbox[1] || block.bbox[2] > pageWidth || block.bbox[3] > pageHeight
    || !text(block.text, 1, 20000) || typeof block.confidence !== 'number'
    || block.confidence < 0 || block.confidence > 1
    || !['text-layer', 'ocr', 'visual-object'].includes(block.extractionMethod)) {
    fail('AGENT_PAPER_LAYOUT_BLOCK_INVALID');
  }
}

export function validatePaperLayoutManifestV1(value) {
  if (!exact(value, ['artifactVersionId', 'pageCount', 'parserVersion', 'pages'])
    || typeof value.artifactVersionId !== 'string' || !UUID.test(value.artifactVersionId)
    || !Number.isSafeInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 5000
    || !text(value.parserVersion, 3, 120) || !Array.isArray(value.pages)
    || value.pages.length !== value.pageCount) fail('AGENT_PAPER_LAYOUT_INVALID');
  const pageNumbers = new Set();
  const globalBlockIds = new Set();
  for (const page of value.pages) {
    if (!exact(page, ['page', 'width', 'height', 'readingOrder', 'blocks'])
      || !Number.isSafeInteger(page.page) || page.page < 1 || page.page > value.pageCount
      || typeof page.width !== 'number' || page.width <= 0 || page.width > 20000
      || typeof page.height !== 'number' || page.height <= 0 || page.height > 20000
      || !Array.isArray(page.readingOrder) || !Array.isArray(page.blocks) || page.blocks.length > 5000) {
      fail('AGENT_PAPER_LAYOUT_PAGE_INVALID');
    }
    if (pageNumbers.has(page.page)) fail('AGENT_PAPER_LAYOUT_PAGE_INVALID');
    pageNumbers.add(page.page);
    const pageIds = new Set();
    for (const block of page.blocks) {
      validatePaperBlock(block, page.width, page.height);
      if (globalBlockIds.has(block.id)) fail('AGENT_PAPER_LAYOUT_BLOCK_INVALID');
      globalBlockIds.add(block.id);
      pageIds.add(block.id);
    }
    if (page.readingOrder.length !== pageIds.size || new Set(page.readingOrder).size !== pageIds.size
      || page.readingOrder.some(id => !pageIds.has(id))) fail('AGENT_PAPER_LAYOUT_READING_ORDER_INVALID');
  }
  return structuredClone(value);
}

export function validatePaperEvidenceSpanV1(value) {
  if (!exact(value, ['artifactVersionId', 'locator', 'quoteText', 'quoteHash', 'extractionMethod',
    'confidence']) || typeof value.artifactVersionId !== 'string' || !UUID.test(value.artifactVersionId)
    || !exact(value.locator, ['kind', 'pages', 'sectionPath', 'blockIds', 'objectLabel'])
    || value.locator.kind !== 'paper.layout' || !Array.isArray(value.locator.pages)
    || value.locator.pages.length < 1 || value.locator.pages.length > 50
    || value.locator.pages.some(page => !Number.isSafeInteger(page) || page < 1)
    || !Array.isArray(value.locator.sectionPath) || value.locator.sectionPath.length > 20
    || value.locator.sectionPath.some(item => !text(item, 1, 500))
    || !Array.isArray(value.locator.blockIds) || value.locator.blockIds.length < 1
    || value.locator.blockIds.length > 200 || value.locator.blockIds.some(item => !text(item, 1, 160))
    || !nullableText(value.locator.objectLabel, 1, 240)
    || !text(value.quoteText, 1, 8000) || typeof value.quoteHash !== 'string'
    || !SHA256.test(value.quoteHash) || value.quoteHash !== stableHash(value.quoteText)
    || !['text-layer', 'ocr', 'visual-object'].includes(value.extractionMethod)
    || typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) {
    fail('AGENT_PAPER_EVIDENCE_SPAN_INVALID');
  }
  return structuredClone(value);
}

export const AGENT_PAPER_RESEARCH_RESPONSE_SCHEMAS = Object.freeze({
  [`${PAPER_IDENTITY_SCHEMA.key}@${PAPER_IDENTITY_SCHEMA.version}`]: validatePaperIdentityV1,
  [`${PAPER_VERSION_SCHEMA.key}@${PAPER_VERSION_SCHEMA.version}`]: validatePaperVersionV1,
  [`${PAPER_LAYOUT_MANIFEST_SCHEMA.key}@${PAPER_LAYOUT_MANIFEST_SCHEMA.version}`]: validatePaperLayoutManifestV1,
  [`${PAPER_EVIDENCE_SPAN_SCHEMA.key}@${PAPER_EVIDENCE_SPAN_SCHEMA.version}`]: validatePaperEvidenceSpanV1,
});
