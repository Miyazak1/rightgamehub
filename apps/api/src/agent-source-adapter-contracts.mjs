import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export const SOURCE_ARCHIVE_SCHEMA = Object.freeze({ key: 'research.source.archive', version: 1 });

export class AgentSourceAdapterContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentSourceAdapterContractError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentSourceAdapterContractError(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const text = (value, min, max) => typeof value === 'string' && value.trim() === value
  && Array.from(value).length >= min && Array.from(value).length <= max;
const nullableText = (value, min, max) => value === null || text(value, min, max);
const SHA256 = /^[a-f0-9]{64}$/u;

function iso(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function https(value) {
  if (!text(value, 8, 2000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function validJsonObject(value, maxBytes = 16384) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
}

export function validateSourceArchiveV1(value) {
  if (!exact(value, ['schemaVersion', 'artifactKind', 'source', 'version', 'evidence', 'extension'])
    || value.schemaVersion !== 'research-source-archive-v1'
    || !['github.repository', 'paper', 'web.page', 'user.file'].includes(value.artifactKind)
    || !exact(value.source, ['canonicalUrl', 'sourceType', 'publisher', 'authorityTier'])
    || !https(value.source.canonicalUrl)
    || !['http', 'rss', 'github', 'search', 'pdf', 'api'].includes(value.source.sourceType)
    || !nullableText(value.source.publisher, 1, 500)
    || !['official-primary', 'official-implementation', 'institutional', 'independent-reputable',
      'community', 'unknown']
      .includes(value.source.authorityTier)
    || !exact(value.version, ['fetchedAt', 'publishedAt', 'contentHash', 'locator', 'contentType'])
    || !iso(value.version.fetchedAt) || !(value.version.publishedAt === null || iso(value.version.publishedAt))
    || !SHA256.test(value.version.contentHash) || !validJsonObject(value.version.locator)
    || !text(value.version.contentType, 3, 240)
    || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 256
    || !validJsonObject(value.extension, 262144)) {
    fail('AGENT_SOURCE_ARCHIVE_INVALID');
  }
  for (const span of value.evidence) {
    if (!exact(span, ['role', 'evidenceKind', 'locator', 'quoteText', 'quoteHash', 'allowedUses'])
      || !['metadata', 'primary-text', 'supporting-text'].includes(span.role)
      || !['metadata', 'direct-quote', 'structured-fact', 'change-excerpt'].includes(span.evidenceKind)
      || !validJsonObject(span.locator) || !text(span.quoteText, 1, 2000)
      || !SHA256.test(span.quoteHash) || span.quoteHash !== stableHash(span.quoteText)
      || !Array.isArray(span.allowedUses) || span.allowedUses.length > 8
      || new Set(span.allowedUses).size !== span.allowedUses.length
      || span.allowedUses.some(use => !['analysis', 'citation', 'comparison'].includes(use))) {
      fail('AGENT_SOURCE_ARCHIVE_EVIDENCE_INVALID');
    }
  }
  const blockedPaper = value.artifactKind === 'paper'
    && value.extension?.qualityAssessment?.grade === 'blocked';
  if (value.evidence.some(span => span.allowedUses.length === 0) && !blockedPaper) {
    fail('AGENT_SOURCE_ARCHIVE_EVIDENCE_INVALID');
  }
  if ((value.artifactKind === 'paper') !== (value.extension.kind === 'paper')) {
    fail('AGENT_SOURCE_ARCHIVE_EXTENSION_INVALID');
  }
  return structuredClone(value);
}

export function sourceArchiveEvidence({ role, evidenceKind, locator, quoteText,
  allowedUses = ['analysis', 'citation', 'comparison'] }) {
  const span = { role, evidenceKind, locator, quoteText, quoteHash: stableHash(quoteText), allowedUses };
  validateSourceArchiveV1({
    schemaVersion: 'research-source-archive-v1', artifactKind: 'web.page',
    source: { canonicalUrl: 'https://example.invalid/', sourceType: 'http', publisher: null,
      authorityTier: 'unknown' },
    version: { fetchedAt: new Date(0).toISOString(), publishedAt: null,
      contentHash: stableHash('contract-probe'), locator: {}, contentType: 'text/plain' },
    evidence: [span], extension: { kind: 'generic' },
  });
  return span;
}
