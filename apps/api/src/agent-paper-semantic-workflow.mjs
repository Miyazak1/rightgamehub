import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PAPER_SEMANTIC_WORKFLOW_KEY } from './agent-paper-semantic-contracts.mjs';

export const PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: PAPER_SEMANTIC_WORKFLOW_KEY,
  workflowVersion: 2,
  inputSchema: 'paper-semantic-run-input-v1',
  outputSchema: 'paper-semantic-analysis-output-v1',
  requiredCapabilities: [
    { key: 'provider.text.generate', version: 1 },
    { key: 'research.paper.analyze', version: 1 },
  ],
  defaultBudget: { providerCalls: 1, toolCalls: 0, inputTokens: 60000,
    outputTokens: 7000, wallClockSeconds: 1200 },
  stages: [
    { key: 'verify-eligibility', kind: 'deterministic', dependsOn: [], maxAttempts: 1,
      timeoutSeconds: 60 },
    { key: 'reconstruct-sections', kind: 'deterministic', dependsOn: ['verify-eligibility'],
      maxAttempts: 1, timeoutSeconds: 60 },
    { key: 'extract-semantics', kind: 'provider', dependsOn: ['reconstruct-sections'], maxAttempts: 2,
      timeoutSeconds: 600, capability: { key: 'provider.text.generate', version: 1 },
      idempotencyMode: 'key' },
    { key: 'verify-semantics', kind: 'deterministic', dependsOn: ['extract-semantics'],
      maxAttempts: 1, timeoutSeconds: 120 },
    { key: 'persist-analysis', kind: 'domain-write', dependsOn: ['verify-semantics'], maxAttempts: 1,
      timeoutSeconds: 120, capability: { key: 'research.paper.analyze', version: 1 },
      idempotencyMode: 'queryable' },
  ],
});

export class AgentPaperSemanticWorkflowError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperSemanticWorkflowError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperSemanticWorkflowError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizePaperSemanticRunInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['schemaVersion', 'paperVersionId', 'purpose'].includes(key))
    || value.schemaVersion !== 'paper-semantic-run-input-v1'
    || typeof value.paperVersionId !== 'string' || !UUID.test(value.paperVersionId)
    || value.purpose !== 'private-research') fail('AGENT_PAPER_SEMANTIC_INPUT_INVALID');
  return structuredClone(value);
}

export function reconstructPaperSections(evidence, readingScope = null) {
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 96
    || evidence.some((item, index) => item?.index !== index + 1 || !Array.isArray(item?.locator?.pages)
      || item.locator.pages.length < 1 || item.locator.pages.some(page => !Number.isSafeInteger(page) || page < 1))) {
    fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
  }
  const byPage = new Map();
  for (const item of evidence) {
    const page = Math.min(...item.locator.pages);
    const indexes = byPage.get(page) ?? [];
    indexes.push(item.index);
    byPage.set(page, indexes);
  }
  const pages = [...byPage.keys()].sort((left, right) => left - right);
  const windowSize = Math.max(1, Math.ceil(pages.length / 64));
  const sections = [];
  for (let offset = 0; offset < pages.length; offset += windowSize) {
    const window = pages.slice(offset, offset + windowSize);
    const first = window[0], last = window.at(-1);
    sections.push({ key: `page-window-${String(sections.length + 1).padStart(2, '0')}`,
      title: first === last ? `第 ${first} 页` : `第 ${first}–${last} 页`, level: 1,
      kind: 'page-window', pageRange: [first, last],
      evidenceIndexes: window.flatMap(page => byPage.get(page)),
    });
  }
  const manifest = { schemaVersion: 'paper-section-manifest-v1', method: 'deterministic-page-window',
    sections, ...(readingScope ? { readingScope } : {}) };
  return Object.freeze({ ...manifest, manifestSha256: stableHash(manifest) });
}

export function createPaperSemanticCanary({ runtimeRepository, enabled = false } = {}) {
  if (!runtimeRepository) fail('AGENT_PAPER_SEMANTIC_RUNTIME_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('AGENT_PAPER_SEMANTIC_DISABLED'); };
  return Object.freeze({
    async register(actorUserId) {
      requireEnabled();
      const registered = await runtimeRepository.registerWorkflow({ actorUserId,
        manifest: PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(
        PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.workflowKey,
        PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.workflowVersion,
      );
      return PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW;
    },
    async createRun({ agentUserId, triggerKind = 'manual', triggerRef = null,
      idempotencyKey, input, config = {} }) {
      requireEnabled();
      return runtimeRepository.createRun({ agentUserId,
        workflowKey: PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.workflowKey,
        workflowVersion: PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.workflowVersion,
        triggerKind, triggerRef, idempotencyKey, input: normalizePaperSemanticRunInput(input), config,
        budget: PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW.defaultBudget });
    },
  });
}
