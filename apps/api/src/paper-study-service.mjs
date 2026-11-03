import crypto from 'node:crypto';
import { extractPaperPdf } from './agent-arxiv-paper-tool.mjs';
import { validatePaperArticleEvidencePack } from './agent-paper-article-generation.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { TEXT_DRAFT_NOTICE } from './agent-paper-text-draft.mjs';

const fail = (code, status = 422) => { throw Object.assign(Error(code), { code, status }); };
const copy = value => structuredClone(value);
export const PAPER_STUDY_MAX_BYTES = 20 * 1024 * 1024;
// Explicit ephemeral repository for local/isolated instances. Never registered
// by the production application; a durable repository must be supplied there.
export function createPaperStudyMemoryRepository() {
  const rows = new Map();
  return { get: id => rows.get(id), put: row => rows.set(row.id, row), list: owner => [...rows.values()].filter(x => x.owner === owner) };
}
export function createPaperStudyService({ repository, processor, extract = extractPaperPdf, mode = 'isolated-replay' }) {
  if (!repository || !processor?.analyze || !processor?.compose || !processor?.verify) fail('PAPER_STUDY_CONFIGURATION', 503);
  const scoped = (actor, id) => {
    if (!actor?.userId) fail('AUTH_REQUIRED', 401);
    const row = repository.get(id);
    if (!row || row.owner !== actor.userId) fail('PAPER_STUDY_NOT_FOUND', 404);
    return row;
  };
  const view = row => ({ id: row.id, title: row.title, filename: row.filename, sourceSha256: row.sourceSha256,
    status: row.status, errorCode: row.errorCode, pageCount: row.pages?.length ?? 0, pages: row.pages ?? [],
    analysis: row.pack ? { findings: row.pack.findings, evidence: row.pack.evidence, limitations: row.pack.limitations,
      readingScope: row.pack.readingScope, notice: TEXT_DRAFT_NOTICE } : null,
    draft: row.draft ?? null, mode, private: true, publicPublicationEnabled: false, manualReviewRequired: true });
  const launch = (row, status, task) => {
    row.status = status; row.errorCode = null; repository.put(row);
    // Task is stored before starting work; repeated clicks cannot schedule a second job.
    row.job = Promise.resolve().then(task).catch(error => {
      row.status = 'failed'; row.errorCode = /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code ?? error.message ?? '') ? (error.code ?? error.message) : 'PAPER_STUDY_PROCESSING_FAILED';
    }).finally(() => { row.job = null; repository.put(row); });
    return view(row);
  };
  return Object.freeze({
    list(actor) { if (!actor?.userId) fail('AUTH_REQUIRED', 401); return repository.list(actor.userId).map(view); },
    read(actor, id) { return view(scoped(actor, id)); },
    source(actor, id) { return { pdfBase64: scoped(actor, id).bytes.toString('base64') }; },
    import(actor, input) {
      if (!actor?.userId) fail('AUTH_REQUIRED', 401);
      if (repository.list(actor.userId).length >= 20) fail('PAPER_STUDY_LIBRARY_LIMIT', 429);
      if (!input || Object.keys(input).some(k => !['pdfBase64', 'filename', 'title', 'rightsConfirmed', 'arxivId'].includes(k))
        || input.rightsConfirmed !== true || typeof input.filename !== 'string' || input.filename.length > 200
        || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300
        || typeof input.pdfBase64 !== 'string' || input.pdfBase64.length > Math.ceil(PAPER_STUDY_MAX_BYTES / 3) * 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.pdfBase64)
        || input.arxivId !== undefined && (typeof input.arxivId !== 'string' || input.arxivId !== '' && !/^\d{4}\.\d{4,5}(?:v\d+)?$/.test(input.arxivId))) fail('PAPER_STUDY_IMPORT_INVALID', 400);
      const bytes = Buffer.from(input.pdfBase64, 'base64');
      if (bytes.toString('base64') !== input.pdfBase64 || bytes.length > PAPER_STUDY_MAX_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') fail('PAPER_STUDY_IMPORT_INVALID', 400);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      const existing = repository.list(actor.userId).find(x => x.sourceSha256 === hash);
      if (existing) { if (!existing.job && !existing.pack && input.arxivId) existing.arxivId = input.arxivId; return view(existing); }
      const row = { id: crypto.randomUUID(), owner: actor.userId, title: input.title.trim(), filename: input.filename.replace(/[\\/\u0000-\u001f]/g, '_'),
        bytes, arxivId: input.arxivId || null, sourceSha256: hash, pages: [], pack: null, draft: null };
      return launch(row, 'importing', async () => {
        const parsed = await extract(new Uint8Array(bytes), row.id);
        if (parsed.pageCount > 80 || !parsed.pages?.length) fail('PAPER_STUDY_PAGE_LIMIT');
        row.parsed = parsed;
        row.pages = parsed.pages.map((p, i) => ({ page: i + 1, text: (p.blocks ?? []).map(b => b.text).join('\n\n') }));
        row.status = 'imported';
      });
    },
    analyze(actor, id) {
      const row = scoped(actor, id);
      if (row.job || row.pack) return view(row);
      if (!row.parsed) fail('PAPER_STUDY_NOT_READY', 409);
      if (!row.parsed.qualityAssessment?.permittedUses?.includes('analysis')) fail('PAPER_STUDY_QUALITY_BLOCKED');
      return launch(row, 'analyzing', async () => {
        const result = await processor.analyze(copy({ sourceSha256: row.sourceSha256, arxivId: row.arxivId, parsed: row.parsed }));
        if (result.sourceSha256 !== row.sourceSha256) fail('PAPER_STUDY_SOURCE_DRIFT');
        const pack = validatePaperArticleEvidencePack(result.pack);
        if (!pack.readingScope || pack.readingScope.publicPublicationEnabled !== false || pack.readingScope.manualReviewRequired !== true) fail('PAPER_STUDY_SCOPE_REQUIRED');
        // PDF hash binding is enforced by the processor; every evidence page must exist.
        for (const e of pack.evidence) if (e.locator.pages.some(p => p > row.parsed.pageCount)) fail('PAPER_STUDY_EVIDENCE_PAGE_INVALID');
        row.pack = pack; row.title = pack.paper.title; row.status = 'analyzed';
      });
    },
    draft(actor, id) {
      const row = scoped(actor, id);
      if (row.job || row.draft) return view(row);
      if (!row.pack) fail('PAPER_STUDY_ANALYSIS_REQUIRED', 409);
      return launch(row, 'drafting', async () => {
        const composition = await processor.compose(copy(row.pack));
        await processor.verify(copy(composition), copy(row.pack));
        if (stableHash(composition.selection?.readingScope) !== stableHash(row.pack.readingScope)) fail('PAPER_STUDY_SCOPE_DRIFT');
        row.draft = { id: crypto.randomUUID(), content: composition.content, paragraphEvidenceBindings: composition.paragraphEvidenceBindings,
          readingScope: row.pack.readingScope, contentSha256: stableHash(composition.content), publicationState: 'draft',
          private: true, manualReviewRequired: true, publicPublicationEnabled: false };
        row.status = 'draft-ready';
      });
    },
  });
}
