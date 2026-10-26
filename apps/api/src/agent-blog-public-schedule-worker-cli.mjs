import crypto from 'node:crypto';
import { createAgentBlogPublicRuntime } from './agent-blog-public-runtime.mjs';
import { PostgresAgentBlogPublicRuntimePreflightRepository } from './agent-blog-public-runtime-preflight.mjs';
import { PostgresAgentBlogPublicScheduleRepository, createAgentBlogPublicScheduleController,
  loadAgentBlogPublicScheduleConfig } from './agent-blog-public-schedule.mjs';

const scheduleConfig = loadAgentBlogPublicScheduleConfig();
if (!scheduleConfig.enabled) throw new Error('AGENT_BLOG_PUBLIC_SCHEDULE_DISABLED');
const runtime = createAgentBlogPublicRuntime({ applicationName: 'gamehub-agent-blog-public-scheduler' });
const controller = createAgentBlogPublicScheduleController({
  repository: new PostgresAgentBlogPublicScheduleRepository(runtime.pool),
  preflightRepository: new PostgresAgentBlogPublicRuntimePreflightRepository(runtime.pool),
  runtimeConfig: runtime.config, runner: runtime.runner,
});
let stopping = false;
const instanceId = crypto.randomUUID();
const stop = () => { stopping = true; };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  const activation = await controller.ensure({ agentUserId: runtime.config.agentUserId, enabled: true });
  process.stdout.write(`${JSON.stringify({ service: 'agent-blog-public-scheduler', event: 'activation',
    enabled: activation.enabled, blocked: activation.blocked, blockers: activation.blockers,
    schedule: activation.schedule ?? null })}\n`);
  if (!activation.enabled) throw Object.assign(new Error('AGENT_BLOG_PUBLIC_SCHEDULE_ACTIVATION_BLOCKED'), {
    code: 'AGENT_BLOG_PUBLIC_SCHEDULE_ACTIVATION_BLOCKED', blockers: activation.blockers,
  });
  await controller.heartbeat({ agentUserId: runtime.config.agentUserId, instanceId, state: 'idle' });
  while (!stopping) {
    try {
      await controller.heartbeat({ agentUserId: runtime.config.agentUserId, instanceId, state: 'busy' });
      const result = await controller.runOnce();
      await controller.heartbeat({ agentUserId: runtime.config.agentUserId, instanceId,
        state: result.status === 'failed' ? 'suspended' : 'idle' });
      if (result.status !== 'idle') process.stdout.write(`${JSON.stringify({
        service: 'agent-blog-public-scheduler', event: 'fire-finished', ...result,
      })}\n`);
    } catch (error) {
      await controller.heartbeat({ agentUserId: runtime.config.agentUserId, instanceId,
        state: 'idle' }).catch(() => {});
      process.stderr.write(`${JSON.stringify({ service: 'agent-blog-public-scheduler', event: 'loop-error',
        code: error?.code ?? 'AGENT_BLOG_PUBLIC_SCHEDULE_WORKER_FAILED', message: error?.message })}\n`);
    }
    if (!stopping) await pause(scheduleConfig.pollMilliseconds);
  }
} finally {
  await controller.heartbeat({ agentUserId: runtime.config.agentUserId, instanceId,
    state: 'stopped' }).catch(() => {});
  await runtime.close();
}
