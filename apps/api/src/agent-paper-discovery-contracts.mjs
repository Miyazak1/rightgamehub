import crypto from 'node:crypto';
import { normalizeDoi } from './agent-paper-intake-security.mjs';
import { normalizeArxivPaperLocator } from './agent-arxiv-paper-tool.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const collapse = value => value.normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const limited = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.trim().length <= max ? value.trim() : null;

export class AgentPaperDiscoveryContractError extends Error {
  constructor(code) { super(code); this.name = 'AgentPaperDiscoveryContractError'; this.code = code; }
}
const fail = code => { throw new AgentPaperDiscoveryContractError(code); };
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const deterministicUuid = seed => {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};

export function normalizePaperTitle(value) {
  const title = limited(value, 1000); if (!title) fail('PAPER_DISCOVERY_TITLE_INVALID');
  const normalized = collapse(title); if (!normalized) fail('PAPER_DISCOVERY_TITLE_INVALID');
  return { title, normalized, fingerprint: sha256(normalized) };
}

export function normalizePaperAuthors(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) fail('PAPER_DISCOVERY_AUTHORS_INVALID');
  const authors = value.map(item => limited(item, 300)).filter(Boolean);
  if (authors.length !== value.length) fail('PAPER_DISCOVERY_AUTHORS_INVALID');
  const normalized = [...new Set(authors.map(collapse))].sort();
  return { authors, normalized, fingerprint: sha256(normalized.join('\n')) };
}

export function normalizeDiscoveryQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('PAPER_DISCOVERY_INPUT_INVALID');
  const kind = input.kind;
  if (kind === 'doi') return { kind, doi: normalizeDoi(input.doi) };
  if (kind === 'arxiv') return { kind, arxivId: normalizeArxivPaperLocator(input.arxivId).requestedId };
  if (kind === 'private-intake') {
    if (!/^[0-9a-f-]{36}$/iu.test(input.intakeId ?? '')) fail('PAPER_DISCOVERY_INPUT_INVALID');
    return { kind, intakeId: input.intakeId.toLowerCase() };
  }
  if (kind === 'title-author') {
    const { title, normalized } = normalizePaperTitle(input.title);
    const author = limited(input.author, 300); if (!author) fail('PAPER_DISCOVERY_AUTHORS_INVALID');
    return { kind, title, normalizedTitle: normalized, author, normalizedAuthor: collapse(author) };
  }
  fail('PAPER_DISCOVERY_INPUT_INVALID');
}

export function normalizeDiscoveryCandidate(input) {
  const title = normalizePaperTitle(input?.title);
  const authors = normalizePaperAuthors(input?.authors);
  const year = input.publicationYear == null ? null : Number(input.publicationYear);
  if (year != null && (!Number.isInteger(year) || year < 1600 || year > 3000)) fail('PAPER_DISCOVERY_YEAR_INVALID');
  let doi = null; let arxivId = null; let localDocumentId = null;
  if (input.doi) doi = normalizeDoi(input.doi);
  if (input.arxivId) arxivId = normalizeArxivPaperLocator(input.arxivId).baseId;
  if (input.localDocumentId) {
    if (!/^[a-f0-9]{64}$/u.test(input.localDocumentId)) fail('PAPER_DISCOVERY_DOCUMENT_INVALID');
    localDocumentId = input.localDocumentId;
  }
  if (!doi && !arxivId && !localDocumentId && year == null) fail('PAPER_DISCOVERY_LOCATOR_REQUIRED');
  const venue = input.venue == null ? null : limited(input.venue, 500);
  if (input.venue != null && !venue) fail('PAPER_DISCOVERY_VENUE_INVALID');
  const sourceKind = input.sourceKind;
  if (!['crossref','arxiv','private-intake'].includes(sourceKind)) fail('PAPER_DISCOVERY_SOURCE_INVALID');
  const externalKey = limited(input.externalKey, 400); if (!externalKey) fail('PAPER_DISCOVERY_SOURCE_INVALID');
  const canonical = { sourceKind, externalKey, doi, arxivId, localDocumentId,
    title: title.title, normalizedTitle: title.normalized, titleFingerprint: title.fingerprint,
    authors: authors.authors, authorFingerprint: authors.fingerprint, publicationYear: year, venue,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    provenance: input.provenance && typeof input.provenance === 'object' ? input.provenance : {} };
  return { ...canonical, candidateSha256: stableHash(canonical) };
}

export function resolvePaperIdentity(candidate, evidence) {
  const exact = new Map();
  for (const match of evidence.identifierMatches ?? []) {
    if (!exact.has(match.identityId)) exact.set(match.identityId, []);
    exact.get(match.identityId).push(match.basis);
  }
  if (exact.size > 1) return { decision: 'conflict', identityId: null, versionId: null,
    matchBasis: [], reason: 'stable-identifiers-resolve-to-different-identities' };
  if (evidence.versionMatch) {
    const stable = [...exact.keys()][0];
    if (stable && stable !== evidence.versionMatch.identityId) return { decision: 'conflict',
      identityId: null, versionId: null, matchBasis: [], reason: 'content-and-identifier-conflict' };
    return { decision: 'exact-version', identityId: evidence.versionMatch.identityId,
      versionId: evidence.versionMatch.versionId, matchBasis: ['content-sha256'], reason: 'exact-content-hash' };
  }
  if (exact.size === 1) {
    const [identityId, basis] = [...exact.entries()][0];
    return { decision: 'exact-identity', identityId, versionId: null,
      matchBasis: [...new Set(basis)].sort(), reason: 'stable-identifier-match' };
  }
  if ((evidence.fingerprintMatches ?? []).length > 1) return { decision: 'conflict', identityId: null,
    versionId: null, matchBasis: [], reason: 'ambiguous-title-author-year' };
  if ((evidence.fingerprintMatches ?? []).length === 1) return { decision: 'possible-match',
    identityId: evidence.fingerprintMatches[0].identityId, versionId: null,
    matchBasis: ['title-author-year'], reason: 'requires-verified-identifier' };
  return { decision: 'new-identity-candidate', identityId: null, versionId: null,
    matchBasis: [], reason: 'no-existing-identity' };
}

export function queueStateForResolution(resolution) {
  return ['exact-version','exact-identity','new-identity-candidate'].includes(resolution.decision)
    ? 'queued' : 'blocked';
}
