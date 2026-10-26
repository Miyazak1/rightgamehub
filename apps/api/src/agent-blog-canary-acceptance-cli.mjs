import pg from 'pg';
import { PostgresAgentBlogCanaryAcceptanceRepository,
  createAgentBlogCanaryAcceptanceService } from './agent-blog-canary-acceptance.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const agentUserId = process.env.AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID?.trim();
const draftRunId = process.env.AGENT_BLOG_PRIVATE_CANARY_DRAFT_RUN_ID?.trim();
if (!agentUserId) throw new Error('AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID is required');
if (!draftRunId) throw new Error('AGENT_BLOG_PRIVATE_CANARY_DRAFT_RUN_ID is required');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, application_name: 'gamehub-agent-blog-canary-acceptance',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const service = createAgentBlogCanaryAcceptanceService({
    repository: new PostgresAgentBlogCanaryAcceptanceRepository(pool),
  });
  const report = await service.attest(agentUserId, draftRunId);
  const readiness = await service.readiness(agentUserId);
  process.stdout.write(`${JSON.stringify({ report, readiness })}\n`);
  if (report.verdict !== 'passed') process.exitCode = 1;
} finally {
  await pool.end();
}
