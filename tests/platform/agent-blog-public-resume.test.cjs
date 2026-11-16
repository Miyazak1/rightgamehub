const test = require('node:test');
const assert = require('node:assert/strict');

test('public recovery refuses disabled switches or enabled paper before database access', async () => {
  const { resumeAgentBlogPublicSchedule } = await import('../../apps/api/src/agent-blog-public-resume.mjs');
  const pool = { query: () => { throw Error('database must not be touched'); } };
  const enabled = { AGENT_BLOG_PUBLIC_RUNTIME_ENABLED: 'true', AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED: 'true',
    AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID: 'c98abda1-d115-4e05-9c2e-43f68119386a' };
  for (const key of ['AGENT_BLOG_PUBLIC_RUNTIME_ENABLED', 'AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED']) {
    await assert.rejects(resumeAgentBlogPublicSchedule({ pool, env: { ...enabled, [key]: 'false' } }), /SWITCHES_DISABLED/u);
  }
  for (const key of ['PAPER_STUDY_ENABLED', 'PAPER_STUDY_WORKER_ENABLED', 'PAPER_STUDY_MODELS_ENABLED', 'PAPER_STUDY_PUBLISH_ENABLED']) {
    await assert.rejects(resumeAgentBlogPublicSchedule({ pool, env: { ...enabled, [key]: 'true' } }), /PAPER_MUST_STAY_DISABLED/u);
  }
});
