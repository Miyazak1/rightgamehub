import pg from 'pg';
import { resumeAgentBlogPublicSchedule } from './agent-blog-public-resume.mjs';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2,
  connectionTimeoutMillis: 5000, application_name: 'gamehub-agent-blog-public-resume',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try {
  const result = await resumeAgentBlogPublicSchedule({ pool });
  console.log(JSON.stringify({ service: 'agent-blog-public-scheduler', event: 'explicit-resume',
    enabled: result.enabled, blocked: result.blocked, blockers: result.blockers,
    alreadyEnabled: result.alreadyEnabled, schedule: result.schedule ?? null }));
  // This is an idempotent control operation: waiting on an already enabled
  // plan is diagnostic, not a failed deployment or a request to restart it.
  if (result.blocked && !result.alreadyEnabled) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ event: 'resume-failed', code: error.code ?? error.message }));
  process.exitCode = 1;
} finally { await pool.end(); }
