import crypto from 'node:crypto';
import { createAgentBlogPublicRuntime } from './agent-blog-public-runtime.mjs';

const analysisIds = String(process.env.AGENT_PAPER_ARTICLE_ACCEPTANCE_ANALYSIS_IDS ?? '')
  .split(',').map(value => value.trim()).filter(Boolean);
const requestId = process.env.AGENT_PAPER_ARTICLE_ACCEPTANCE_REQUEST_ID?.trim() || crypto.randomUUID();
const runtime = createAgentBlogPublicRuntime({ applicationName: 'gamehub-agent-paper-article-acceptance' });

try {
  const result = await runtime.paperArticleAcceptance.run({ agentUserId: runtime.config.agentUserId,
    analysisIds, requestId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.verdict !== 'passed' || result.publicationAttempted !== false
    || result.automaticScheduleChange !== false) process.exitCode = 1;
} finally {
  await runtime.close();
}
