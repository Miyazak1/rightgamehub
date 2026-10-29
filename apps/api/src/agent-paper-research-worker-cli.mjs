import { createAgentBlogPrivateCanaryRuntime } from './agent-blog-private-canary-runtime.mjs';
import { ARXIV_PAPER_READ_TOOL } from './agent-arxiv-paper-tool.mjs';
import { PostgresAgentToolGatewayRepository } from './agent-tool-gateway-repository.mjs';

if (process.env.AGENT_PAPER_RESEARCH_WORKER_ENABLED !== 'true') {
  throw new Error('AGENT_PAPER_RESEARCH_WORKER_DISABLED');
}

if (!process.env.AGENT_ARXIV_CONTACT_EMAIL?.trim()) {
  throw new Error('AGENT_PAPER_RESEARCH_ARXIV_CONTACT_REQUIRED');
}

const runtime = createAgentBlogPrivateCanaryRuntime({
  applicationName: 'gamehub-agent-paper-research-worker',
});

let stopping = false;
let operationsTimer = null;
let operationsRunning = false;
const worker = runtime.paperResearch.createWorker();
const operationsIntervalMs=Math.max(60000,Math.min(3600000,
  Number(process.env.AGENT_PAPER_RESEARCH_OPERATIONS_INTERVAL_SECONDS||300)*1000));

async function inspectOperations(){
  if(operationsRunning)return;
  operationsRunning=true;
  try{const evaluation=await runtime.paperResearchOperations.evaluate(runtime.config.agentUserId);
    const delivery=await runtime.paperResearchOperations.deliverPending(runtime.config.agentUserId);
    process.stdout.write(`${JSON.stringify({service:'agent-paper-research-worker',event:'operations.evaluated',evaluation,delivery})}\n`);
  }catch(error){process.stderr.write(`${JSON.stringify({service:'agent-paper-research-worker',event:'operations.failed',
    code:error?.code??'PAPER_RESEARCH_OPERATIONS_EVALUATION_FAILED',message:String(error?.message??error)})}\n`);
  }finally{operationsRunning=false;}
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if(operationsTimer)clearInterval(operationsTimer);
  process.stderr.write(`${JSON.stringify({ service: 'agent-paper-research-worker',
    event: 'shutdown', signal })}\n`);
  await worker.stop().catch(() => {});
  await runtime.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { shutdown(signal).finally(() => process.exit(0)); });
}

try {
  const identity = (await runtime.pool.query(`SELECT operator_user_id
    FROM agent_accounts WHERE user_id=$1 AND status='active'`,
  [runtime.config.agentUserId])).rows[0];
  if (!identity?.operator_user_id) throw new Error('AGENT_PAPER_RESEARCH_IDENTITY_NOT_READY');
  // The durable worker owns this prerequisite. Registering it idempotently at
  // startup prevents a healthy worker from accepting Runs whose arXiv tool was
  // omitted by an older or publication-only bootstrap.
  const arxivTool = await new PostgresAgentToolGatewayRepository(runtime.pool)
    .registerTool(ARXIV_PAPER_READ_TOOL);
  if (arxivTool.status !== 'active') throw new Error('AGENT_PAPER_RESEARCH_ARXIV_TOOL_NOT_ACTIVE');
  await runtime.paperResearch.canary.register(identity.operator_user_id);
  process.stdout.write(`${JSON.stringify({ service: 'agent-paper-research-worker',
    event: 'ready', agentUserId: runtime.config.agentUserId,
    workflowKey: 'paper.private.research',
    tool: { toolKey: arxivTool.toolKey, contractVersion: arxivTool.contractVersion,
      existing: arxivTool.existing === true } })}\n`);
  await inspectOperations();
  operationsTimer=setInterval(()=>void inspectOperations(),operationsIntervalMs);
  operationsTimer.unref?.();
  await worker.start();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ service: 'agent-paper-research-worker',
    event: 'fatal', code: error?.code ?? 'AGENT_PAPER_RESEARCH_WORKER_FAILED',
    message: String(error?.message ?? error) })}\n`);
  process.exitCode = 1;
} finally {
  await shutdown('process-exit');
}
