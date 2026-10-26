import crypto from 'node:crypto';
import { createAgentBlogPrivateCanaryRuntime } from './agent-blog-private-canary-runtime.mjs';

const requestId = process.env.AGENT_BLOG_PRIVATE_CANARY_REQUEST_ID?.trim() || crypto.randomUUID();
const runtime = createAgentBlogPrivateCanaryRuntime({
  applicationName: 'gamehub-agent-blog-private-canary-manual',
});

try {
  const result = await runtime.supervisor.run({ requestId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.acceptance.verdict !== 'passed') process.exitCode = 1;
} finally {
  await runtime.close();
}
