import crypto from 'node:crypto';
import { createAgentBlogPublicRuntime } from './agent-blog-public-runtime.mjs';

const analysisId = process.env.AGENT_PAPER_ARTICLE_ANALYSIS_ID?.trim();
const requestId = process.env.AGENT_PAPER_ARTICLE_REQUEST_ID?.trim() || crypto.randomUUID();
const runtime = createAgentBlogPublicRuntime({ applicationName: 'gamehub-agent-paper-article-manual' });

try {
  const result = await runtime.paperArticleRunner.run({ analysisId, requestId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.publicationState !== 'draft' || result.publicationAttempted !== false) process.exitCode = 1;
} finally {
  await runtime.close();
}
