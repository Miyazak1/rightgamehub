import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { stableHash } from '../../apps/api/src/researcher-qa-protocol/stable-json.mjs';

const requireMatch = ok => { if (!ok) throw Error('PAPER_SAVED_DRAFT_INTEGRITY_FAILED'); };
export function validateSavedPaperDraft({ report, papers, rows, pdfBytes }) {
  requireMatch(report.productionConnected === false && report.published === false && papers.length === 1);
  for (const entry of report.artifacts) {
    const row = rows.find(r => r.artifactKey === entry.artifactKey);
    requireMatch(row && row.contentSha256 === entry.contentSha256 && stableHash(row.content) === entry.contentSha256);
  }
  const paper = structuredClone(papers[0]), draft = paper.draft;
  const composition = rows.find(r => r.artifactKey === 'blog.composition');
  const proof = rows.find(r => r.artifactKey === 'blog.verification');
  const semantic = rows.find(r => r.artifactKey === 'paper.semantic-verification');
  requireMatch(semantic?.content.approved === true && report.artifacts.some(a => a.artifactKey === semantic.artifactKey));
  requireMatch(stableHash(paper.analysis.findings) === stableHash(semantic.content.findings.filter(f => f.kind !== 'unknown'))
    && stableHash(paper.analysis.limitations) === stableHash(semantic.content.limitations)
    && stableHash(paper.analysis.readingScope) === stableHash(semantic.content.readingScope));
  requireMatch(composition && proof?.content.approved === true && proof.content.compositionArtifactId === composition.id
    && proof.content.contentSha256 === composition.contentSha256);
  requireMatch(paper.status === 'draft-ready' && paper.private === true && draft?.private === true
    && draft.publicationState === 'draft' && draft.manualReviewRequired === true && draft.publicPublicationEnabled === false);
  requireMatch(crypto.createHash('sha256').update(pdfBytes).digest('hex') === paper.sourceSha256 && paper.sourceSha256 === report.sourceSha256);
  requireMatch(stableHash(draft.content) === draft.contentSha256 && stableHash(composition.content.content) === draft.contentSha256);
  requireMatch(stableHash(draft.paragraphEvidenceBindings) === stableHash(composition.content.paragraphEvidenceBindings));
  requireMatch(stableHash(draft.readingScope) === stableHash(proof.content.readingScope)
    && stableHash(draft.readingScope) === stableHash(paper.analysis.readingScope)
    && stableHash(draft.readingScope) === stableHash(composition.content.selection.readingScope));
  const evidenceIds = new Set(paper.analysis.evidence.map(e => e.id));
  for (const e of paper.analysis.evidence) requireMatch(stableHash(e.quoteText) === e.quoteHash && e.locator.pages.length > 0 && e.locator.pages.every(p => Number.isInteger(p) && p > 0 && p <= paper.pageCount));
  for (const binding of draft.paragraphEvidenceBindings) for (const e of binding.evidence) {
    const source = paper.analysis.evidence.find(item => item.id === e.id);
    requireMatch(source && source.quoteHash === e.quoteHash && stableHash(source.locator.pages) === stableHash(e.pages));
  }
  const keys = new Set(draft.paragraphEvidenceBindings.flatMap(b => b.findingKeys));
  requireMatch(paper.analysis.findings.every(f => keys.has(f.key) && f.relations.every(r => evidenceIds.has(r.evidenceId))));
  return paper;
}

export async function loadSavedPaperDraft(directory, pdf) {
  const read = name => fs.readFile(path.join(directory, name), 'utf8').then(JSON.parse);
  const report = await read('report.json');
  const rows = [];
  for (const entry of report.artifacts) {
    if (!/^artifact-\d+-[a-z0-9.-]+\.json$/i.test(entry.file)) throw Error('PAPER_SAVED_ARTIFACT_PATH_DENIED');
    rows.push(await read(entry.file));
  }
  const pdfBytes = await fs.readFile(pdf);
  const paper = validateSavedPaperDraft({ report, papers: await read('paper-results.json'), rows, pdfBytes });
  return { paper, pdfBytes };
}
