import { createAgentBlogPrivateCanaryRuntime } from './agent-blog-private-canary-runtime.mjs';
import { PostgresAgentBlogPrivateScheduleRepository, createAgentBlogPrivateScheduleController,
  loadAgentBlogPrivateScheduleConfig } from './agent-blog-private-schedule.mjs';

const scheduleConfig = loadAgentBlogPrivateScheduleConfig();
if (!scheduleConfig.enabled) throw new Error('AGENT_BLOG_PRIVATE_SCHEDULE_DISABLED');
const runtime = createAgentBlogPrivateCanaryRuntime({
  applicationName: 'gamehub-agent-blog-private-scheduler',
});
const repository = new PostgresAgentBlogPrivateScheduleRepository(runtime.pool);
const controller = createAgentBlogPrivateScheduleController({
  repository, acceptanceService: runtime.acceptanceService, supervisor: runtime.supervisor,
});
let stopping = false;
const stop = () => { stopping = true; };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  let lastActivationState = null;
  while (!stopping) {
    try {
      const activation = await controller.ensure({ agentUserId: runtime.config.agentUserId, enabled: true });
      const activationState = JSON.stringify({ enabled: activation.enabled, blocked: activation.blocked,
        passes: activation.readiness?.consecutivePasses ?? null,
        required: activation.readiness?.requiredConsecutivePasses ?? null,
        nextFireAt: activation.schedule?.nextFireAt ?? null });
      if (activationState !== lastActivationState) {
        process.stdout.write(`${JSON.stringify({ service: 'agent-blog-private-scheduler', event: 'activation',
          enabled: activation.enabled, blocked: activation.blocked,
          readiness: activation.readiness, schedule: activation.schedule ?? null })}\n`);
        lastActivationState = activationState;
      }
      if (activation.enabled) {
        const result = await controller.runOnce();
        if (result.status !== 'idle') process.stdout.write(`${JSON.stringify({
          service: 'agent-blog-private-scheduler', event: 'fire-finished', ...result,
        })}\n`);
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ service: 'agent-blog-private-scheduler', event: 'loop-error',
        code: error?.code ?? 'AGENT_BLOG_SCHEDULE_WORKER_FAILED', message: error?.message })}\n`);
    }
    if (!stopping) await pause(scheduleConfig.pollMilliseconds);
  }
} finally {
  await runtime.close();
}
