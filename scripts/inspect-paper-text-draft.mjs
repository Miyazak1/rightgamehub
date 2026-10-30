// Local diagnostic only: no database, provider, network or publication access.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { extractPaperPdf } from '../apps/api/src/agent-arxiv-paper-tool.mjs';
import { selectTextOnlyDraftEvidence, textOnlyDraftExcerpt, TEXT_DRAFT_NOTICE }
  from '../apps/api/src/agent-paper-text-draft.mjs';
import { stableHash } from '../apps/api/src/researcher-qa-protocol/stable-json.mjs';

const { values } = parseArgs({ options: { pdf: { type: 'string' }, output: { type: 'string' } } });
if (!values.pdf || !values.output) throw new Error('Usage: node scripts/inspect-paper-text-draft.mjs --pdf PATH --output NEW_JSON_PATH');
const file = await fs.open(values.pdf, 'r');
let bytes;
try {
  if ((await file.stat()).size > 20 * 1024 * 1024) throw new Error('PDF_SIZE_LIMIT');
  bytes = new Uint8Array(await file.readFile());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('PDF_SIZE_LIMIT');
} finally { await file.close(); }
// PDF.js may transfer/detach this buffer. Bind provenance before parsing.
const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const artifactVersionId = crypto.randomUUID();
const parsed = await extractPaperPdf(bytes, artifactVersionId);
const q = parsed.qualityAssessment;
const paper = { reliability_grade: q.grade, permitted_uses: q.permittedUses, reason_codes: q.reasonCodes,
  metrics_json: q.metrics, assessment_sha256: stableHash(q), layout_sha256: stableHash({
    artifactVersionId, pageCount: parsed.pageCount, parserVersion: q.parserVersion, pages: parsed.pages }) };
const evidence = parsed.evidence.map((item, i) => ({ index: i + 1, id: crypto.randomUUID(),
  quoteText: item.quoteText, quoteHash: item.quoteHash, evidenceKind: 'direct-quote',
  locator: item.locator, allowedUses: q.permittedUses }));
const selected = selectTextOnlyDraftEvidence(evidence, paper);
const report = { schemaVersion: 'paper-text-draft-local-inspection-v1',
  sourceSha256, originalQuality: q,
  notice: TEXT_DRAFT_NOTICE, readingScope: selected.readingScope,
  evidence: selected.evidence.map(item => ({ ...item, providerExcerpt: textOnlyDraftExcerpt(item.quoteText) })),
  excludedChunkCount: evidence.length - selected.evidence.length,
  providerInvoked: false, databaseAccessed: false, publicationAttempted: false };
await fs.writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: values.output, originalGrade: q.grade,
  selectedChunks: selected.evidence.length, excludedChunks: report.excludedChunkCount,
  manualReviewRequired: true, providerInvoked: false }));
