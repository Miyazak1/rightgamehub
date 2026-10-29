const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/agent-source-adapter-contracts.mjs'));

test('source archive contract rejects unbounded or unverifiable evidence', async () => {
  const { validateSourceArchiveV1, sourceArchiveEvidence } = await import(moduleUrl);
  const valid = {
    schemaVersion: 'research-source-archive-v1', artifactKind: 'web.page',
    source: { canonicalUrl: 'https://example.com/source', sourceType: 'http', publisher: null,
      authorityTier: 'unknown' },
    version: { fetchedAt: '2026-10-27T00:00:00.000Z', publishedAt: null,
      contentHash: 'a'.repeat(64), locator: { section: 1 }, contentType: 'text/plain' },
    evidence: [sourceArchiveEvidence({ role: 'primary-text', evidenceKind: 'direct-quote',
      locator: { line: 1 }, quoteText: 'bounded evidence', allowedUses: ['analysis', 'citation'] })],
    extension: { kind: 'generic' },
  };
  assert.equal(validateSourceArchiveV1(valid).artifactKind, 'web.page');
  assert.throws(() => validateSourceArchiveV1({ ...valid, evidence: [{ ...valid.evidence[0],
    quoteText: 'changed without rehashing' }] }), error => error.code === 'AGENT_SOURCE_ARCHIVE_EVIDENCE_INVALID');
  assert.throws(() => validateSourceArchiveV1({ ...valid, artifactKind: 'paper' }),
    error => error.code === 'AGENT_SOURCE_ARCHIVE_EXTENSION_INVALID');
  const noUseEvidence = [{ ...valid.evidence[0], allowedUses: [] }];
  assert.throws(() => validateSourceArchiveV1({ ...valid, evidence: noUseEvidence }),
    error => error.code === 'AGENT_SOURCE_ARCHIVE_EVIDENCE_INVALID');
  const blockedPaper = { ...valid, artifactKind: 'paper', evidence: noUseEvidence,
    source: { ...valid.source, sourceType: 'pdf' },
    version: { ...valid.version, contentType: 'application/pdf' },
    extension: { kind: 'paper', qualityAssessment: { grade: 'blocked' } } };
  assert.equal(validateSourceArchiveV1(blockedPaper).evidence[0].allowedUses.length, 0);
});
