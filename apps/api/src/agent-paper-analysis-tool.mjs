import { validatePaperArticleEvidencePack } from './agent-paper-article-generation.mjs';

export const PAPER_ANALYSIS_READ_TOOL = Object.freeze({
  toolKey: 'research.paper.analysis.read',
  contractVersion: 1,
  status: 'active',
  capabilityKey: 'research.paper.read',
  riskLevel: 'L1',
  executionClass: 'in-process',
  effectClass: 'read-only',
  inputSchema: { key: 'paper.analysis.read.input', version: 1 },
  outputSchema: { key: 'paper.analysis.read.output', version: 1 },
  networkPolicy: { allowedOrigins: [], redirects: 'deny', authentication: 'none', maxRequests: 0 },
  filesystemPolicy: { read: false, write: false },
  timeoutSeconds: 15,
  outputLimitBytes: 1048576,
});

export class AgentPaperAnalysisToolError extends Error {
  constructor(code, { notDispatched = false, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentPaperAnalysisToolError';
    this.code = code;
    this.retryable = false;
    this.notDispatched = notDispatched;
  }
}

const fail = (code, options) => { throw new AgentPaperAnalysisToolError(code, options); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validatePaperAnalysisReadInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !UUID.test(value.analysisId ?? '')) {
    fail('AGENT_PAPER_ANALYSIS_TOOL_INPUT_INVALID', { notDispatched: true });
  }
  return { analysisId: value.analysisId.toLowerCase() };
}

export function validatePaperAnalysisReadOutput(value) {
  try { return validatePaperArticleEvidencePack(value); }
  catch (error) { fail('AGENT_PAPER_ANALYSIS_TOOL_OUTPUT_INVALID', { cause: error }); }
}

export function createPaperAnalysisReadAdapter({ repository, agentUserId,
  clock = () => new Date().toISOString() } = {}) {
  if (!repository || typeof repository.loadArticleEvidence !== 'function'
    || !UUID.test(agentUserId ?? '') || typeof clock !== 'function') {
    fail('AGENT_PAPER_ANALYSIS_TOOL_CONFIG_INVALID', { notDispatched: true });
  }
  return async ({ request }) => {
    const input = validatePaperAnalysisReadInput(request);
    const output = validatePaperAnalysisReadOutput(await repository.loadArticleEvidence({
      agentUserId, analysisId: input.analysisId, accessedAt: clock(),
    }));
    return { receiptId: `paper-analysis:${output.analysisId}:${output.analysisSha256.slice(0, 16)}`,
      output, responseRef: { analysisId: output.analysisId, paperVersionId: output.paperVersionId,
        analysisSha256: output.analysisSha256 }, usage: { toolCalls: 1, networkRequests: 0 } };
  };
}
