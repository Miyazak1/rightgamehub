export const PAPER_PARSE_QUALITY_SCHEMA = Object.freeze({
  key: 'research.paper.parse-quality', version: 1,
});

export const PAPER_PARSE_QUALITY_POLICY = Object.freeze({
  policyVersion: 'paper-text-layer-gate-v1',
  blockedTextCoverageBp: 7500,
  blockedEvidenceCoverageBp: 7500,
  blockedOrderRiskRatioBp: 2500,
  lowDensityCharsPerPage: 40,
});

const GRADES = new Set(['trusted-text', 'limited-text', 'blocked']);
const USES = new Set(['analysis', 'citation', 'comparison']);
const REASONS = new Set([
  'EMPTY_TEXT_PAGES',
  'SCANNED_PAGES',
  'LOW_TEXT_DENSITY',
  'READING_ORDER_UNCERTAIN',
  'MULTI_COLUMN_LAYOUT',
  'TABLE_STRUCTURE_UNSUPPORTED',
  'FORMULA_STRUCTURE_UNSUPPORTED',
  'IMAGE_CONTENT_UNREAD',
  'EVIDENCE_COVERAGE_LOW',
]);

export class AgentPaperParseQualityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperParseQualityError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperParseQualityError(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, min, max) => typeof value === 'string' && value.trim() === value
  && Array.from(value).length >= min && Array.from(value).length <= max;

function basisPoints(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10000);
}

function itemPosition(item) {
  if (!Array.isArray(item?.transform) || item.transform.length < 6
    || !Number.isFinite(Number(item.transform[4])) || !Number.isFinite(Number(item.transform[5]))) return null;
  return { x: Number(item.transform[4]), y: Number(item.transform[5]),
    width: Number.isFinite(Number(item.width)) ? Math.max(0, Number(item.width)) : 0 };
}

function lineGroups(items) {
  const lines = new Map();
  for (const item of items) {
    const position = itemPosition(item);
    if (!position) continue;
    const key = Math.round(position.y / 4) * 4;
    const line = lines.get(key) ?? [];
    line.push({ ...position, text: String(item.str ?? '').trim() });
    lines.set(key, line);
  }
  return [...lines.values()];
}

export function analyzePaperTextLayerPage({ page, width, height, items, imageCount = 0 }) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0 || !Array.isArray(items)
    || !Number.isSafeInteger(imageCount) || imageCount < 0) fail('AGENT_PAPER_PAGE_SIGNAL_INPUT_INVALID');
  const visible = items.filter(item => typeof item?.str === 'string' && item.str.trim().length > 0);
  const positions = visible.map(itemPosition).filter(Boolean);
  const charCount = visible.reduce((total, item) => total + Array.from(item.str.trim()).length, 0);
  const left = positions.filter(item => item.x + item.width / 2 < width * 0.45);
  const right = positions.filter(item => item.x + item.width / 2 > width * 0.55);
  const ySpan = list => list.length < 2 ? 0 : Math.max(...list.map(item => item.y)) - Math.min(...list.map(item => item.y));
  const multiColumn = visible.length >= 12 && left.length >= 4 && right.length >= 4
    && ySpan(left) >= height * 0.2 && ySpan(right) >= height * 0.2;
  let upwardTransitions = 0;
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index].y - positions[index - 1].y > height * 0.18) upwardTransitions += 1;
  }
  const lines = lineGroups(visible);
  const tabularLines = lines.filter(line => {
    const xBuckets = new Set(line.filter(item => item.text.length > 0 && item.text.length <= 24)
      .map(item => Math.round(item.x / 24)));
    return xBuckets.size >= 3;
  }).length;
  const joined = visible.map(item => item.str).join(' ');
  const formulaRisk = /[=∑∫√±×÷≤≥≈∞∂∇]|\b(?:argmin|argmax|softmax)\b/iu.test(joined);
  return {
    page,
    charCount,
    hasText: charCount > 0,
    scannedCandidate: charCount === 0 && imageCount > 0,
    lowDensity: charCount > 0 && charCount < PAPER_PARSE_QUALITY_POLICY.lowDensityCharsPerPage,
    readingOrderRisk: multiColumn && upwardTransitions > 0,
    multiColumn,
    tableRisk: tabularLines >= 3,
    formulaRisk,
    imageCount,
  };
}

export function validatePaperParseQualityV1(value) {
  const metricKeys = ['pageCount', 'textPageCount', 'emptyPageCount', 'scannedPageCount', 'textChars',
    'evidencePageCount', 'textCoverageBp', 'evidenceCoverageBp', 'lowDensityPageCount',
    'orderRiskPageCount', 'multiColumnPageCount', 'tableRiskPageCount', 'formulaRiskPageCount',
    'imagePageCount'];
  if (!exact(value, ['schemaVersion', 'policyVersion', 'parserVersion', 'grade', 'permittedUses',
    'reasonCodes', 'metrics']) || value.schemaVersion !== 'paper-parse-quality-v1'
    || value.policyVersion !== PAPER_PARSE_QUALITY_POLICY.policyVersion
    || !text(value.parserVersion, 3, 120) || !GRADES.has(value.grade)
    || !Array.isArray(value.permittedUses) || value.permittedUses.some(use => !USES.has(use))
    || new Set(value.permittedUses).size !== value.permittedUses.length
    || !Array.isArray(value.reasonCodes) || value.reasonCodes.some(reason => !REASONS.has(reason))
    || new Set(value.reasonCodes).size !== value.reasonCodes.length
    || !exact(value.metrics, metricKeys) || metricKeys.some(key => !integer(value.metrics[key]))
    || value.metrics.pageCount < 1 || value.metrics.textPageCount + value.metrics.emptyPageCount
      !== value.metrics.pageCount
    || value.metrics.evidencePageCount > value.metrics.textPageCount
    || value.metrics.textCoverageBp > 10000 || value.metrics.evidenceCoverageBp > 10000
    || value.metrics.scannedPageCount > value.metrics.emptyPageCount
    || value.metrics.lowDensityPageCount > value.metrics.textPageCount
    || value.metrics.orderRiskPageCount > value.metrics.pageCount
    || value.metrics.multiColumnPageCount > value.metrics.pageCount
    || value.metrics.tableRiskPageCount > value.metrics.pageCount
    || value.metrics.formulaRiskPageCount > value.metrics.pageCount
    || value.metrics.imagePageCount > value.metrics.pageCount
    || (value.grade === 'trusted-text'
      && (value.permittedUses.join(',') !== 'analysis,citation,comparison' || value.reasonCodes.length > 0))
    || (value.grade === 'limited-text' && value.permittedUses.join(',') !== 'analysis')
    || (value.grade === 'blocked' && value.permittedUses.length !== 0)) {
    fail('AGENT_PAPER_PARSE_QUALITY_INVALID');
  }
  return structuredClone(value);
}

export function assessPaperParseQuality({ parserVersion, pageSignals, evidencePages }) {
  if (!text(parserVersion, 3, 120) || !Array.isArray(pageSignals) || pageSignals.length < 1
    || !Array.isArray(evidencePages) || evidencePages.some(page => !Number.isSafeInteger(page) || page < 1)) {
    fail('AGENT_PAPER_PARSE_QUALITY_INPUT_INVALID');
  }
  const pageNumbers = pageSignals.map(signal => signal?.page);
  if (pageNumbers.some(page => !Number.isSafeInteger(page) || page < 1)
    || new Set(pageNumbers).size !== pageSignals.length) fail('AGENT_PAPER_PARSE_QUALITY_INPUT_INVALID');
  const count = key => pageSignals.filter(signal => signal[key] === true).length;
  const pageCount = pageSignals.length;
  const textPageCount = count('hasText');
  const metrics = {
    pageCount,
    textPageCount,
    emptyPageCount: pageCount - textPageCount,
    scannedPageCount: count('scannedCandidate'),
    textChars: pageSignals.reduce((total, signal) => total
      + (Number.isSafeInteger(signal.charCount) && signal.charCount >= 0 ? signal.charCount : 0), 0),
    evidencePageCount: new Set(evidencePages.filter(page => pageNumbers.includes(page))).size,
    textCoverageBp: basisPoints(textPageCount, pageCount),
    evidenceCoverageBp: 0,
    lowDensityPageCount: count('lowDensity'),
    orderRiskPageCount: count('readingOrderRisk'),
    multiColumnPageCount: count('multiColumn'),
    tableRiskPageCount: count('tableRisk'),
    formulaRiskPageCount: count('formulaRisk'),
    imagePageCount: pageSignals.filter(signal => Number(signal.imageCount) > 0).length,
  };
  metrics.evidenceCoverageBp = basisPoints(metrics.evidencePageCount, Math.max(1, textPageCount));
  const reasonCodes = [];
  if (metrics.emptyPageCount > 0) reasonCodes.push('EMPTY_TEXT_PAGES');
  if (metrics.scannedPageCount > 0) reasonCodes.push('SCANNED_PAGES');
  if (metrics.lowDensityPageCount > 0) reasonCodes.push('LOW_TEXT_DENSITY');
  if (metrics.orderRiskPageCount > 0) reasonCodes.push('READING_ORDER_UNCERTAIN');
  if (metrics.multiColumnPageCount > 0) reasonCodes.push('MULTI_COLUMN_LAYOUT');
  if (metrics.tableRiskPageCount > 0) reasonCodes.push('TABLE_STRUCTURE_UNSUPPORTED');
  if (metrics.formulaRiskPageCount > 0) reasonCodes.push('FORMULA_STRUCTURE_UNSUPPORTED');
  if (metrics.imagePageCount > 0) reasonCodes.push('IMAGE_CONTENT_UNREAD');
  if (metrics.evidenceCoverageBp < 10000) reasonCodes.push('EVIDENCE_COVERAGE_LOW');
  const orderRiskRatioBp = basisPoints(metrics.orderRiskPageCount, pageCount);
  const blocked = metrics.textCoverageBp < PAPER_PARSE_QUALITY_POLICY.blockedTextCoverageBp
    || metrics.evidenceCoverageBp < PAPER_PARSE_QUALITY_POLICY.blockedEvidenceCoverageBp
    || orderRiskRatioBp > PAPER_PARSE_QUALITY_POLICY.blockedOrderRiskRatioBp;
  const grade = blocked ? 'blocked' : reasonCodes.length > 0 ? 'limited-text' : 'trusted-text';
  return validatePaperParseQualityV1({
    schemaVersion: 'paper-parse-quality-v1',
    policyVersion: PAPER_PARSE_QUALITY_POLICY.policyVersion,
    parserVersion,
    grade,
    permittedUses: grade === 'trusted-text' ? ['analysis', 'citation', 'comparison']
      : grade === 'limited-text' ? ['analysis'] : [],
    reasonCodes,
    metrics,
  });
}
