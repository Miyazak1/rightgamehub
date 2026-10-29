import crypto from 'node:crypto';
import { createAgentPaperSemanticRuntime } from './agent-paper-semantic-runtime-bootstrap.mjs';

const runtime = createAgentPaperSemanticRuntime();
try {
  const paperVersionId = process.env.AGENT_PAPER_SEMANTIC_PAPER_VERSION_ID?.trim();
  const requestId = process.env.AGENT_PAPER_SEMANTIC_REQUEST_ID?.trim() || crypto.randomUUID();
  const bootstrap = await runtime.bootstrap();
  const run = await runtime.createRun({ paperVersionId, requestId });
  let state = await runtime.readRun(run.id);
  if (!['succeeded', 'failed', 'rejected', 'cancelled', 'uncertain'].includes(state.status)) {
    const worker = runtime.createWorker(run.id);
    for (let index = 0; index < bootstrap.workflow.stages.length; index += 1) {
      const result = await worker.runOnce();
      if (result.status !== 'completed') break;
    }
    state = await runtime.readRun(run.id);
  }
  const receipt = { schemaVersion: 'agent-paper-semantic-run-receipt-v1', requestId,
    agentUserId: bootstrap.identity.agentUserId, runId: state.id, status: state.status,
    outputType: state.outputType, analysisId: state.outputId,
    errorCode: state.errorCode, publicationAttempted: false };
  console.log(JSON.stringify(receipt));
  if (state.status !== 'succeeded') process.exitCode = 1;
} finally {
  await runtime.close();
}
