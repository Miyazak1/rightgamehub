const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { capturePaperWindow } = require('../desktop/paper-window-capture.cjs');
const { paperStatusReady, paperStatusSource } = require('../desktop/paper-study-window-state.cjs');

test('library-only saved status is not readiness; work status and tabs must both exist after reload', () => {
  let workStatus, tab;
  const document = { body: { innerText: '私有待审稿已保存' }, querySelector: selector => selector === '#paper-tab-draft' ? tab : workStatus };
  assert.equal(paperStatusReady(document, '私有待审稿已保存'), false);
  workStatus = { textContent: '私有待审稿已保存' };
  assert.equal(paperStatusReady(document, '私有待审稿已保存'), false);
  tab = {};
  assert.equal(paperStatusReady(document, '私有待审稿已保存'), true);
  assert.equal(paperStatusReady(document, '分析已完成'), false);
  assert.equal(new Function('document', `return ${paperStatusSource('私有待审稿已保存')}`)(document), true);
});

function fakeWindow(results) {
  let minimized = true, visible = false, calls = 0, frames = 0;
  return { isDestroyed: () => false, isMinimized: () => minimized, restore() { minimized = false; }, isVisible: () => visible,
    show() { visible = true; }, getBounds: () => ({ width: 800, height: 600 }), counts: () => ({ calls, frames }),
    webContents: { isDestroyed: () => false,
      async executeJavaScript(source) { new Function(`return (${source})`); frames++; },
      async capturePage(rect, options) { assert.equal(rect, undefined); assert.deepEqual(options, { stayHidden: false, stayAwake: true });
        const result = results[calls++]; if (result instanceof Error) throw result;
        return { isEmpty: () => result === 'empty', toPNG: () => Buffer.from('png') }; } } };
}
test('capture restores visible painting and recovers once from a compositor error without repeating application work', async () => {
  const w = fakeWindow([Error('UnknownVizError'), 'ok']), attempts = [];
  assert.equal((await capturePaperWindow(w, 'draft', { pause: async () => {}, onAttempt: a => attempts.push(a) })).toString(), 'png');
  assert.deepEqual(w.counts(), { calls: 2, frames: 2 });
  assert.ok(attempts.every(a => a.visible && !a.minimized && a.label === 'draft'));
  assert.equal(attempts.filter(a => a.status === 'failed').length, 1);
});
test('persistent compositor errors retain the failing stage and stop after two captures', async () => {
  const w = fakeWindow([Error('UnknownVizError'), Error('UnknownVizError')]);
  await assert.rejects(capturePaperWindow(w, 'narrow', { pause: async () => {} }), /PAPER_CAPTURE_FAILED:narrow:UnknownVizError/);
  assert.equal(w.counts().calls, 2);
});
test('non-compositor errors, empty images and closed windows are never silently retried', async () => {
  for (const result of [Error('renderer crashed'), 'empty']) {
    const w = fakeWindow([result]); await assert.rejects(capturePaperWindow(w, 'wide'));
    assert.equal(w.counts().calls, 1);
  }
  const w = fakeWindow([]); w.isDestroyed = () => true;
  await assert.rejects(capturePaperWindow(w, 'draft'), /PAPER_CAPTURE_WINDOW_CLOSED:draft/);
  assert.equal(w.counts().calls, 0);
});

async function snapshot() {
  const { stableHash } = await import('../../apps/api/src/researcher-qa-protocol/stable-json.mjs');
  const pdfBytes = Buffer.from('%PDF-test');
  const scope = { manualReviewRequired: true, publicPublicationEnabled: false };
  const evidence = { id: 'e', quoteText: 'Verified source text.', quoteHash: stableHash('Verified source text.'), locator: { pages: [2] } };
  const bindings = [{ blockIndex: 1, findingKeys: ['f'], evidence: [{ id: 'e', quoteHash: evidence.quoteHash, pages: [2] }] }];
  const content = { title: '私有稿', blocks: [{ text: '原始正文' }] };
  const composition = { id: 'c', artifactKey: 'blog.composition', content: { content, paragraphEvidenceBindings: bindings, selection: { readingScope: scope } } };
  composition.contentSha256 = stableHash(composition.content);
  const proof = { artifactKey: 'blog.verification', content: { approved: true, compositionArtifactId: 'c', contentSha256: composition.contentSha256, readingScope: scope } };
  proof.contentSha256 = stableHash(proof.content);
  const paper = { id: 'p', private: true, status: 'draft-ready', pageCount: 3, sourceSha256: crypto.createHash('sha256').update(pdfBytes).digest('hex'),
    analysis: { limitations: [{text:'仅使用正文'}], evidence: [evidence], findings: [{ key: 'f', relations: [{ evidenceId: 'e' }] }], readingScope: scope },
    draft: { id: 'd', private: true, content, contentSha256: stableHash(content), paragraphEvidenceBindings: bindings, readingScope: scope,
      publicationState: 'draft', manualReviewRequired: true, publicPublicationEnabled: false } };
  const semantic = { artifactKey: 'paper.semantic-verification', content: { approved: true, findings: structuredClone(paper.analysis.findings), limitations: structuredClone(paper.analysis.limitations), readingScope: scope } };
  semantic.contentSha256 = stableHash(semantic.content);
  const rows = [composition, proof, semantic];
  return { report: { productionConnected: false, published: false, sourceSha256: paper.sourceSha256, artifacts: rows.map(r => ({ artifactKey: r.artifactKey, contentSha256: r.contentSha256 })) }, papers: [paper], rows, pdfBytes };
}
test('saved-draft recovery returns the identical verified content, IDs and evidence bindings', async () => {
  const { validateSavedPaperDraft } = await import('../desktop/paper-study-saved-draft.mjs');
  const input = await snapshot(), original = structuredClone(input.papers[0]);
  const paper = validateSavedPaperDraft(input);
  assert.deepEqual(paper, original); assert.notEqual(paper, input.papers[0]);
});
test('saved-draft recovery rejects modified content, source, bindings, proof and citation text', async () => {
  const { validateSavedPaperDraft } = await import('../desktop/paper-study-saved-draft.mjs');
  for (const mutate of [s => { s.papers[0].draft.content.title = 'changed'; }, s => { s.pdfBytes = Buffer.from('changed'); },
    s => { s.papers[0].draft.paragraphEvidenceBindings[0].evidence[0].pages = [3]; },
    s => { s.rows[1].content.approved = false; }, s => { s.papers[0].analysis.evidence[0].quoteText = 'changed'; },
    s => { s.papers[0].draft.publicPublicationEnabled = true; }]) {
    const input = await snapshot(); mutate(input);
    assert.throws(() => validateSavedPaperDraft(input), /PAPER_SAVED_DRAFT_INTEGRITY_FAILED/);
  }
});


test('saved analysis must match the semantic proof, including same-key text, relationships and limitations', async () => {
  const { validateSavedPaperDraft } = await import('../desktop/paper-study-saved-draft.mjs');
  for (const mutate of [s=>{s.papers[0].analysis.findings[0].text='不同的主张';},
    s=>{s.papers[0].analysis.findings[0].relations[0].relation='contradicts';},
    s=>{s.papers[0].analysis.limitations[0].text='没有限制';},
    s=>{s.rows=s.rows.filter(r=>r.artifactKey!=='paper.semantic-verification');}]){
    const input=await snapshot();mutate(input);
    assert.throws(()=>validateSavedPaperDraft(input),/PAPER_SAVED_DRAFT_INTEGRITY_FAILED/);
  }
});
