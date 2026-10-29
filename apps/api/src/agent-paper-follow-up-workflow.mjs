import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PAPER_FOLLOW_UP_WORKFLOW_KEY, normalizePaperFollowUpInput }
  from './agent-paper-follow-up-contracts.mjs';

export const PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: PAPER_FOLLOW_UP_WORKFLOW_KEY,
  workflowVersion: 1,
  inputSchema: 'paper-follow-up-run-input-v1',
  outputSchema: 'paper-follow-up-answer-output-v1',
  requiredCapabilities: [
    { key: 'provider.text.generate', version: 1 },
    { key: 'research.paper.follow-up', version: 1 },
  ],
  defaultBudget: { providerCalls: 1, toolCalls: 0, inputTokens: 30000,
    outputTokens: 3000, wallClockSeconds: 600 },
  stages: [
    { key: 'freeze-context', kind: 'deterministic', dependsOn: [], maxAttempts: 1,
      timeoutSeconds: 60 },
    { key: 'answer-question', kind: 'provider', dependsOn: ['freeze-context'], maxAttempts: 1,
      timeoutSeconds: 360, capability: { key: 'provider.text.generate', version: 1 },
      idempotencyMode: 'key' },
    { key: 'verify-answer', kind: 'deterministic', dependsOn: ['answer-question'], maxAttempts: 1,
      timeoutSeconds: 60 },
    { key: 'persist-answer', kind: 'domain-write', dependsOn: ['verify-answer'], maxAttempts: 1,
      timeoutSeconds: 60, capability: { key: 'research.paper.follow-up', version: 1 },
      idempotencyMode: 'queryable' },
  ],
});

export class AgentPaperFollowUpWorkflowError extends Error {
  constructor(code) {
    super(code); this.name = 'AgentPaperFollowUpWorkflowError'; this.code = code; this.retryable = false;
  }
}
const fail = code => { throw new AgentPaperFollowUpWorkflowError(code); };

export function createPaperFollowUpCanary({ runtimeRepository, enabled = true } = {}) {
  if (!runtimeRepository) fail('AGENT_PAPER_FOLLOW_UP_RUNTIME_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('AGENT_PAPER_FOLLOW_UP_DISABLED'); };
  return Object.freeze({
    async register(actorUserId) {
      requireEnabled();
      const registered = await runtimeRepository.registerWorkflow({ actorUserId,
        manifest: PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(
        PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW.workflowKey,
        PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW.workflowVersion,
      );
      return PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW;
    },
    async createRun({ agentUserId, requestId, input, config = {} }) {
      requireEnabled();
      const normalized = normalizePaperFollowUpInput(input);
      return runtimeRepository.createRun({ agentUserId,
        workflowKey: PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW.workflowKey,
        workflowVersion: PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW.workflowVersion,
        triggerKind: 'manual', triggerRef: requestId,
        idempotencyKey: `paper-follow-up:${requestId}`,
        input: normalized, config,
        budget: PAPER_SEMANTIC_FOLLOW_UP_WORKFLOW.defaultBudget });
    },
    inputSha256: value => stableHash(normalizePaperFollowUpInput(value)),
  });
}
