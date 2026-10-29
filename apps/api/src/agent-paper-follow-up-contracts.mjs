import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { validatePaperSemanticFollowUpAnswerV1 } from './agent-paper-semantic-contracts.mjs';

export const PAPER_FOLLOW_UP_WORKFLOW_KEY = 'paper.semantic.follow-up-private';
export const PAPER_FOLLOW_UP_RESPONSE_SCHEMA = Object.freeze({
  key: 'paper.semantic.follow-up-answer', version: 1,
});
export const PAPER_FOLLOW_UP_VERIFICATION_SCHEMA = Object.freeze({
  key: 'paper.semantic.follow-up-verification', version: 1,
});

export class AgentPaperFollowUpContractError extends Error {
  constructor(code) {
    super(code); this.name = 'AgentPaperFollowUpContractError'; this.code = code; this.retryable = false;
  }
}
const fail = code => { throw new AgentPaperFollowUpContractError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));

export function normalizePaperFollowUpInput(value) {
  if (!exact(value, ['schemaVersion', 'analysisId', 'question'])
    || value.schemaVersion !== 'paper-follow-up-run-input-v1'
    || typeof value.analysisId !== 'string' || !UUID.test(value.analysisId)
    || typeof value.question !== 'string' || value.question.trim() !== value.question
    || Array.from(value.question).length < 2 || Array.from(value.question).length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.question)) {
    fail('AGENT_PAPER_FOLLOW_UP_INPUT_INVALID');
  }
  return structuredClone(value);
}

export function verifyPaperFollowUpAnswer({ answer: input, context }) {
  const answer = validatePaperSemanticFollowUpAnswerV1(input);
  if (!context || typeof context !== 'object' || !UUID.test(context.analysisId ?? '')
    || !/^[a-f0-9]{64}$/u.test(context.analysisSha256 ?? '')
    || !Array.isArray(context.findings) || !Array.isArray(context.evidence)) {
    fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_INVALID');
  }
  const findings = new Map(context.findings.map(finding => [finding.key, finding]));
  const evidence = new Map(context.evidence.map(item => [item.index, item]));
  if (findings.size !== context.findings.length || evidence.size !== context.evidence.length
    || context.evidence.some(item => !Number.isSafeInteger(item.index) || item.index < 1 || item.index > 96
      || !UUID.test(item.id ?? '') || !/^[a-f0-9]{64}$/u.test(item.quoteHash ?? ''))) {
    fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_INVALID');
  }
  if (answer.uncertainty === 'insufficient-evidence') {
    if (answer.findingKeys.length !== 0 || answer.evidenceIndexes.length !== 0) {
      fail('AGENT_PAPER_FOLLOW_UP_CITATION_INVALID');
    }
  } else if (answer.findingKeys.length < 1 || answer.evidenceIndexes.length < 1) {
    fail('AGENT_PAPER_FOLLOW_UP_CITATION_INVALID');
  }
  const selectedFindings = answer.findingKeys.map(key => findings.get(key));
  if (selectedFindings.some(value => !value || value.kind === 'unknown')) {
    fail('AGENT_PAPER_FOLLOW_UP_FINDING_INVALID');
  }
  const links = [];
  for (const evidenceIndex of answer.evidenceIndexes) {
    const item = evidence.get(evidenceIndex);
    if (!item) fail('AGENT_PAPER_FOLLOW_UP_EVIDENCE_INVALID');
    let matched = false;
    for (const finding of selectedFindings) {
      const relation = finding.relations?.find(candidate => candidate.evidenceIndex === evidenceIndex
        && candidate.evidenceId === item.id);
      if (!relation) continue;
      links.push({ findingKey: finding.key, evidenceIndex, evidenceId: item.id,
        relation: relation.relation });
      matched = true;
    }
    if (!matched) fail('AGENT_PAPER_FOLLOW_UP_CITATION_INVALID');
  }
  for (const finding of selectedFindings) {
    if (!links.some(link => link.findingKey === finding.key)) {
      fail('AGENT_PAPER_FOLLOW_UP_CITATION_INVALID');
    }
  }
  const proof = {
    schemaVersion: 'paper-follow-up-verification-v1', approved: true,
    analysisId: context.analysisId, analysisSha256: context.analysisSha256,
    questionSha256: stableHash(context.question), answer: answer.answer,
    uncertainty: answer.uncertainty, findingKeys: answer.findingKeys,
    evidenceIndexes: answer.evidenceIndexes, evidenceLinks: links,
  };
  return Object.freeze({ ...proof, answerSha256: stableHash(proof) });
}

export const PAPER_FOLLOW_UP_RESPONSE_SCHEMAS = Object.freeze({
  [`${PAPER_FOLLOW_UP_RESPONSE_SCHEMA.key}@${PAPER_FOLLOW_UP_RESPONSE_SCHEMA.version}`]:
    validatePaperSemanticFollowUpAnswerV1,
});
