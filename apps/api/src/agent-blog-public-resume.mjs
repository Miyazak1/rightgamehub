import { loadAgentBlogPublicRuntimeConfig, PostgresAgentBlogPublicRuntimePreflightRepository } from './agent-blog-public-runtime-preflight.mjs';
import { loadAgentBlogPublicScheduleConfig, PostgresAgentBlogPublicScheduleRepository,
  createAgentBlogPublicScheduleController } from './agent-blog-public-schedule.mjs';

// Reuse admission and schedule ownership locks. This operation creates no Run,
// does not replay missed fires, and does not rewrite history or credentials.
export async function resumeAgentBlogPublicSchedule({ pool, env = process.env, clock = () => new Date() }) {
  const runtimeConfig = loadAgentBlogPublicRuntimeConfig(env);
  const scheduleConfig = loadAgentBlogPublicScheduleConfig(env);
  if (!runtimeConfig.enabled || !scheduleConfig.enabled) throw Error('AGENT_BLOG_PUBLIC_RESUME_SWITCHES_DISABLED');
  for (const flag of ['PAPER_STUDY_ENABLED', 'PAPER_STUDY_WORKER_ENABLED', 'PAPER_STUDY_MODELS_ENABLED', 'PAPER_STUDY_PUBLISH_ENABLED']) {
    if ((env[flag] ?? 'false') !== 'false') throw Error('AGENT_BLOG_PUBLIC_RESUME_PAPER_MUST_STAY_DISABLED');
  }
  const row = (await pool.query(`SELECT enabled, config_json FROM agent_schedules
    WHERE agent_user_id=$1 AND workflow_key='blog.project.discovery-shadow'
      AND config_json->>'mode'='foundation-public'`, [runtimeConfig.agentUserId])).rows[0];
  if (!row) throw Error('AGENT_BLOG_PUBLIC_SCHEDULE_MISSING');
  const worker = row.config_json?.worker, age = clock().getTime() - Date.parse(worker?.heartbeatAt);
  if (!Number.isFinite(age) || age < -30000 || age > Math.max(90000, scheduleConfig.pollMilliseconds * 3)
    || !['idle', 'busy', 'suspended'].includes(worker?.state)) throw Error('AGENT_BLOG_PUBLIC_SCHEDULER_HEARTBEAT_STALE');
  const controller = createAgentBlogPublicScheduleController({
    repository: new PostgresAgentBlogPublicScheduleRepository(pool, { clock }),
    preflightRepository: new PostgresAgentBlogPublicRuntimePreflightRepository(pool), runtimeConfig,
  });
  const alreadyEnabled = row.enabled && !row.config_json?.suspendedAt;
  const result = await controller.ensure({ agentUserId: runtimeConfig.agentUserId, enabled: true,
    resume: !alreadyEnabled, preserveExisting: Boolean(alreadyEnabled) });
  return { ...result, alreadyEnabled: Boolean(alreadyEnabled) };
}
