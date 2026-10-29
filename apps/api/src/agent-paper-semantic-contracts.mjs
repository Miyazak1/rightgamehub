import { parseWholeJson } from './researcher-qa-protocol/model-json.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export const PAPER_SEMANTIC_WORKFLOW_KEY = 'paper.single.semantic-shadow';
export const PAPER_SEMANTIC_EXTRACTION_SCHEMA = Object.freeze({ key: 'paper.semantic.extraction', version: 1 });
export const PAPER_SEMANTIC_VERIFICATION_SCHEMA = Object.freeze({ key: 'paper.semantic.verification', version: 1 });
export const PAPER_SEMANTIC_FOLLOW_UP_SCHEMA = Object.freeze({ key: 'paper.semantic.follow-up-answer', version: 1 });

export class AgentPaperSemanticContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperSemanticContractError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperSemanticContractError(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const text = (value, min, max) => typeof value === 'string' && value.trim() === value
  && Array.from(value).length >= min && Array.from(value).length <= max;
const keyText = value => typeof value === 'string' && /^[a-z][a-z0-9-]{1,79}$/u.test(value);
const unique = values => new Set(values).size === values.length;
const indexes = (value, { min = 0, max = 96 } = {}) => Array.isArray(value)
  && value.length >= min && value.length <= max && value.every(index => Number.isSafeInteger(index)
    && index >= 1 && index <= 96) && unique(value);

function providerObject(value) {
  if (typeof value === 'string') {
    if (!value.trim() || Buffer.byteLength(value) > 1048576) fail('AGENT_PAPER_SEMANTIC_PROVIDER_OUTPUT_INVALID');
    try { value = parseWholeJson(value.trim()); } catch { fail('AGENT_PAPER_SEMANTIC_PROVIDER_OUTPUT_INVALID'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('AGENT_PAPER_SEMANTIC_PROVIDER_OUTPUT_INVALID');
  }
  return value;
}

function validateRelation(value) {
  return exact(value, ['evidenceIndex', 'relation'])
    && Number.isSafeInteger(value.evidenceIndex) && value.evidenceIndex >= 1 && value.evidenceIndex <= 96
    && ['supports', 'weakens', 'contradicts', 'context'].includes(value.relation);
}

export function validatePaperSemanticExtractionV1(value) {
  const output = providerObject(value);
  if (!exact(output, ['schemaVersion', 'sections', 'findings', 'limitations', 'followUpQuestions'])
    || output.schemaVersion !== 'paper-semantic-extraction-v1'
    || !Array.isArray(output.sections) || output.sections.length < 1 || output.sections.length > 64
    || !Array.isArray(output.findings) || output.findings.length < 1 || output.findings.length > 128
    || !Array.isArray(output.limitations) || output.limitations.length > 32
    || !Array.isArray(output.followUpQuestions) || output.followUpQuestions.length < 3
    || output.followUpQuestions.length > 8) fail('AGENT_PAPER_SEMANTIC_SCHEMA_INVALID');
  for (const section of output.sections) {
    if (!exact(section, ['key', 'title', 'level', 'evidenceIndexes']) || !keyText(section.key)
      || !text(section.title, 1, 300) || !Number.isSafeInteger(section.level)
      || section.level < 1 || section.level > 6 || !indexes(section.evidenceIndexes, { min: 1 })) {
      fail('AGENT_PAPER_SEMANTIC_SECTION_INVALID');
    }
  }
  if (!unique(output.sections.map(section => section.key))) fail('AGENT_PAPER_SEMANTIC_SECTION_INVALID');
  for (const finding of output.findings) {
    if (!exact(finding, ['key', 'kind', 'text', 'evidenceIndexes', 'relations', 'confidence'])
      || !keyText(finding.key) || !['author_claim', 'observed_result', 'xiaomoyu_inference', 'unknown', 'conflict']
        .includes(finding.kind) || !text(finding.text, 1, 2000)
      || !indexes(finding.evidenceIndexes, { min: finding.kind === 'unknown' ? 0 : 1 })
      || !Array.isArray(finding.relations) || finding.relations.length > 96
      || finding.relations.some(relation => !validateRelation(relation))
      || !['high', 'medium', 'low'].includes(finding.confidence)) {
      fail('AGENT_PAPER_SEMANTIC_FINDING_INVALID');
    }
    if (!unique(finding.relations.map(relation => `${relation.evidenceIndex}:${relation.relation}`))
      || finding.relations.some(relation => !finding.evidenceIndexes.includes(relation.evidenceIndex))) {
      fail('AGENT_PAPER_SEMANTIC_FINDING_INVALID');
    }
    if (finding.kind === 'unknown' && (finding.evidenceIndexes.length || finding.relations.length)) {
      fail('AGENT_PAPER_SEMANTIC_FINDING_INVALID');
    }
    if (finding.kind !== 'unknown' && !finding.relations.some(relation => relation.relation === 'supports')) {
      fail('AGENT_PAPER_SEMANTIC_FINDING_INVALID');
    }
    if (finding.kind === 'conflict' && !finding.relations.some(relation => relation.relation === 'contradicts')) {
      fail('AGENT_PAPER_SEMANTIC_FINDING_INVALID');
    }
  }
  if (!unique(output.findings.map(finding => finding.key))) fail('AGENT_PAPER_SEMANTIC_FINDING_INVALID');
  for (const limitation of output.limitations) {
    if (!exact(limitation, ['key', 'text', 'evidenceIndexes']) || !keyText(limitation.key)
      || !text(limitation.text, 1, 1200) || !indexes(limitation.evidenceIndexes)) {
      fail('AGENT_PAPER_SEMANTIC_LIMITATION_INVALID');
    }
  }
  if (!unique(output.limitations.map(item => item.key))
    || output.followUpQuestions.some(question => !text(question, 2, 500))
    || !unique(output.followUpQuestions)) fail('AGENT_PAPER_SEMANTIC_SCHEMA_INVALID');
  return structuredClone(output);
}

export function validatePaperSemanticFollowUpAnswerV1(value) {
  const output = providerObject(value);
  if (!exact(output, ['schemaVersion', 'answer', 'findingKeys', 'evidenceIndexes', 'uncertainty'])
    || output.schemaVersion !== 'paper-semantic-follow-up-answer-v1'
    || !text(output.answer, 1, 8000) || !Array.isArray(output.findingKeys)
    || output.findingKeys.length > 32 || output.findingKeys.some(item => !keyText(item))
    || !unique(output.findingKeys) || !indexes(output.evidenceIndexes)
    || !['none', 'bounded', 'insufficient-evidence'].includes(output.uncertainty)
    || (output.uncertainty === 'insufficient-evidence' && output.evidenceIndexes.length > 0)
    || (output.uncertainty !== 'insufficient-evidence' && output.evidenceIndexes.length < 1)) {
    fail('AGENT_PAPER_SEMANTIC_FOLLOW_UP_INVALID');
  }
  return structuredClone(output);
}

export function verifyPaperSemanticExtraction({ extraction, evidence }) {
  const value = validatePaperSemanticExtractionV1(extraction);
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 96
    || evidence.some((item, index) => item?.index !== index + 1 || typeof item?.id !== 'string'
      || !/^[0-9a-f-]{36}$/iu.test(item.id) || !/^[0-9a-f]{64}$/u.test(item.quoteHash ?? ''))) {
    fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
  }
  const ensureBound = list => {
    if (list.some(index => index > evidence.length)) fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INDEX_INVALID');
  };
  value.sections.forEach(section => ensureBound(section.evidenceIndexes));
  value.findings.forEach(finding => ensureBound(finding.evidenceIndexes));
  value.limitations.forEach(limitation => ensureBound(limitation.evidenceIndexes));
  const evidenceByIndex = new Map(evidence.map(item => [item.index, item]));
  const findings = value.findings.map(finding => ({ ...finding,
    evidenceIds: finding.evidenceIndexes.map(index => evidenceByIndex.get(index).id),
    relations: finding.relations.map(relation => ({ ...relation,
      evidenceId: evidenceByIndex.get(relation.evidenceIndex).id })),
  }));
  const verified = {
    schemaVersion: 'paper-semantic-verification-v1', approved: true,
    sections: value.sections, findings, limitations: value.limitations,
    followUpQuestions: value.followUpQuestions,
    evidenceManifestSha256: stableHash(evidence.map(item => ({ index: item.index, id: item.id,
      quoteHash: item.quoteHash }))),
  };
  return Object.freeze({ ...verified, analysisSha256: stableHash(verified) });
}

export const PAPER_SEMANTIC_RESPONSE_SCHEMAS = Object.freeze({
  [`${PAPER_SEMANTIC_EXTRACTION_SCHEMA.key}@${PAPER_SEMANTIC_EXTRACTION_SCHEMA.version}`]:
    validatePaperSemanticExtractionV1,
  [`${PAPER_SEMANTIC_FOLLOW_UP_SCHEMA.key}@${PAPER_SEMANTIC_FOLLOW_UP_SCHEMA.version}`]:
    validatePaperSemanticFollowUpAnswerV1,
});
