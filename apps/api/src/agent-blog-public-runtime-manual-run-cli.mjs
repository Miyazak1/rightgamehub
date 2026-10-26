import crypto from 'node:crypto';
import { createAgentBlogPublicRuntime } from './agent-blog-public-runtime.mjs';

const requestId = process.env.AGENT_BLOG_PUBLIC_RUNTIME_REQUEST_ID?.trim() || crypto.randomUUID();
const runtime = createAgentBlogPublicRuntime({ applicationName: 'gamehub-agent-blog-public-manual' });

try {
  const result = await runtime.runner.run({ requestId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.publication?.publicationState !== 'published') process.exitCode = 1;
} finally {
  await runtime.close();
}
