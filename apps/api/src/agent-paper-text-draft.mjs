import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export const TEXT_DRAFT_NOTICE = '阅读范围：本文是仅依据可用正文生成的待审草稿，未核验复杂表格、公式及图示；不构成对实验数值、效果比较或推导的确认。发布前须人工核对原文。';
const STRUCTURAL_REASONS = new Set(['MULTI_COLUMN_LAYOUT', 'TABLE_STRUCTURE_UNSUPPORTED',
  'FORMULA_STRUCTURE_UNSUPPORTED', 'IMAGE_CONTENT_UNREAD']);
const fail = () => { const error = new Error('AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT');
  error.code = error.message; error.retryable = false; throw error; };
// A scope notice does not make unsupported later historical impact acceptable.
const historicalImpact = /后来.{0,24}(?:成为|得到广泛应用)|影响深远|深远影响|奠定了.{0,12}基础|改变了.{0,12}格局/u;
// Only a complete, clause-initial caution about a generic model comparison is
// exempt. Arbitrary negation, concrete results and double negatives are not.
const comparisonDisclaimer = /(^|[。！？!?；;，,：:\n])\s*(?:不能|不可|不应)(?:直接)?(?:读成|解读为|理解为|视为)对(?:某种|某个|某一|该|这种|一种)?模型(?:全面|普遍|必然)?优于(?:其他|其它|现有|已有|所有其他)?模型的(?:定论|结论)(?=$|[。！？!?；;，,：:\n])/gu;

export function textOnlyDraftExcerpt(text) {
  // Intake chunks may start/end in a sentence. Send only bounded complete
  // sentences, retaining the original evidence row/hash for the audit trail.
  let source = text;
  if (/^\p{Ll}/u.test(source)) source = source.replace(/^.*?[.!?。！？](?:\s|$)/u, '');
  const sentences = source.match(/.+?[.!?。！？](?=\s|$)/gsu) ?? [];
  let result = '';
  for (const sentence of sentences) {
    // Reference numbers are not measurements. Other digits (including model
    // names and hyperparameters) keep the whole sentence outside this mode.
    const withoutReferences = sentence.replace(/\[\d+(?:\s*,\s*\d+)*\]/gu, '');
    if (/\d|%|百分|百分点/u.test(withoutReferences)) continue;
    if (/[=∑∫√±×÷≤≥≈∞∂∇−{}<>\\^|]/u.test(sentence)
      || /state.of.the.art|significant|\b(?:improv\w*|performance|faster|hours|gpus|accuracy|bleu|operations|complexity|resolution)\b|\bThis makes it\b/iu.test(sentence)) continue;
    if (result.length + sentence.length + 1 > 1200) break;
    result += `${result ? ' ' : ''}${sentence.trim()}`;
  }
  return result;
}

export function isTextOnlyDraftQuality(paper) {
  const m = paper.metrics_json;
  return paper.reliability_grade === 'limited-text'
    && stableHash(paper.permitted_uses) === stableHash(['analysis'])
    && Array.isArray(paper.reason_codes) && paper.reason_codes.length > 0
    && paper.reason_codes.every(reason => STRUCTURAL_REASONS.has(reason))
    && m?.textCoverageBp === 10000 && m?.evidenceCoverageBp === 10000
    && m?.orderRiskPageCount === 0 && m?.emptyPageCount === 0
    && m?.scannedPageCount === 0 && m?.lowDensityPageCount === 0;
}

export function isNarrativeDraftEvidence(item) {
  const text = item?.quoteText;
  if (typeof text !== 'string' || text.length < 300 || text.length > 12000
    || stableHash(text) !== item.quoteHash || !item.allowedUses?.includes('analysis')
    || item.locator?.kind !== 'paper.layout' || !Array.isArray(item.locator.pages)
    || item.locator.pages.length !== 1 || !Number.isSafeInteger(item.locator.pages[0])
    || item.locator.pages[0] < 1 || !Array.isArray(item.locator.blockIds)
    || item.locator.blockIds.length !== 1 || item.locator.objectLabel != null) return false;
  // The current intake stores page chunks, not verified geometric paragraphs.
  // Discard mixed chunks in their entirety; never relabel all PDF text as prose.
  if (/[=∑∫√±×÷≤≥≈∞∂∇_{}<>\\^|\uFFFD\u0000-\u0008]/u.test(text)
    || /^\s*Type\s+Sentence\b/iu.test(text)
    || ((text.match(/\bOur model\b/giu)?.length ?? 0) >= 2 && /\bTruth\b/iu.test(text))
    || /\b(?:table|figure|fig\.?|equation|eq\.?|appendix|references|bibliography|bleu|accuracy|benchmark|outperform|arxiv|conference)\b/iu.test(text)
    || /work performed|author contributions|acknowledg/iu.test(text)
    || /(?:公式|参考文献|表\s*\d|图\s*\d|百分点|准确率)/u.test(text)
    || (text.match(/\d/gu)?.length ?? 0) / text.length > .025
    || (text.match(/[.!?。！？](?:\s|$)/gu)?.length ?? 0) < 2
    || textOnlyDraftExcerpt(text).length < 300) return false;
  return true;
}

export function selectTextOnlyDraftEvidence(evidence, paper) {
  if (!isTextOnlyDraftQuality(paper)) fail();
  const selected = evidence.filter(isNarrativeDraftEvidence);
  if (selected.length < 2 || selected.reduce((n, item) => n + item.quoteText.length, 0) < 1200) fail();
  const readingScope = {
    schemaVersion: 'paper-text-only-draft-scope-v1', mode: 'text-only-draft',
    originalGrade: 'limited-text', reasonCodes: [...paper.reason_codes],
    parseAssessmentSha256: paper.assessment_sha256, layoutSha256: paper.layout_sha256,
    selectedEvidence: selected.map(item => ({ id: item.id, quoteHash: item.quoteHash })),
    manualReviewRequired: true, publicPublicationEnabled: false,
  };
  return { evidence: selected.map((item, i) => ({ ...item, index: i + 1 })), readingScope };
}

export function validateTextOnlyDraftScope(scope, evidence) {
  if (!scope || scope.schemaVersion !== 'paper-text-only-draft-scope-v1'
    || Object.keys(scope).some(key => !['schemaVersion', 'mode', 'originalGrade', 'reasonCodes',
      'parseAssessmentSha256', 'layoutSha256', 'selectedEvidence', 'manualReviewRequired', 'publicPublicationEnabled'].includes(key))
    || scope.mode !== 'text-only-draft' || scope.originalGrade !== 'limited-text'
    || scope.manualReviewRequired !== true || scope.publicPublicationEnabled !== false
    || !/^[a-f0-9]{64}$/u.test(scope.parseAssessmentSha256 ?? '')
    || !/^[a-f0-9]{64}$/u.test(scope.layoutSha256 ?? '')
    || !Array.isArray(scope.reasonCodes) || !scope.reasonCodes.length
    || new Set(scope.reasonCodes).size !== scope.reasonCodes.length
    || scope.reasonCodes.some(reason => !STRUCTURAL_REASONS.has(reason))
    || !Array.isArray(scope.selectedEvidence) || scope.selectedEvidence.length < 2
    || scope.selectedEvidence.length > 96
    || new Set(scope.selectedEvidence.map(item => item.id)).size !== scope.selectedEvidence.length
    || scope.selectedEvidence.some(item => !/^[a-f0-9-]{36}$/iu.test(item.id ?? '')
      || Object.keys(item).length !== 2
      || !/^[a-f0-9]{64}$/u.test(item.quoteHash ?? ''))
    || evidence.some(item => !isNarrativeDraftEvidence(item)
      || !scope.selectedEvidence.some(bound => bound.id === item.id && bound.quoteHash === item.quoteHash))) fail();
  return structuredClone(scope);
}

export function assertTextOnlyDraftFindings(findings) {
  if (!Array.isArray(findings) || !findings.some(item => item.kind === 'author_claim')
    || findings.some(item => !['author_claim', 'unknown'].includes(item.kind)
      || historicalImpact.test(item.text ?? '')
      || /\d|百分|百分点|倍于|优于|超过|最好|显著提升|操作数|计算复杂度|时间复杂度|空间复杂度|outperform|accuracy|bleu/iu.test(item.text ?? ''))) fail();
}

export function assertTextOnlyDraftComposition(content) {
  const blocks = content.blocks.filter(block => ['paragraph', 'list'].includes(block.type));
  // Headings can carry factual claims too; author attribution is only required
  // in prose/list items, so neutral section labels remain valid.
  const fields = [content.title, content.summary, ...content.blocks.flatMap(b => b.items ?? [b.text])];
  const text = fields.join(' ');
  // This is a validation-only copy, evaluated per field to prevent a disclaimer
  // in one block from excusing a positive claim in another. Keep stored text.
  const comparisonText = fields.map(value => String(value ?? '').replace(comparisonDisclaimer,
    match => match.replace('优于', '[比较]'))).join(' ');
  if (historicalImpact.test(text)
    || /\d|百分|百分点|操作数|计算复杂度|时间复杂度|空间复杂度|outperform|accuracy|bleu/iu.test(text)
    || /倍于|优于|超过|最好|显著提升/iu.test(comparisonText)
    || blocks.some(block => !(block.items ?? [block.text]).every(value => value === TEXT_DRAFT_NOTICE
      || /作者|论文|文中/u.test(value)))) fail();
}
