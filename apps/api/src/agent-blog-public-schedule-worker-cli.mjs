import crypto from 'node:crypto';
import { runAgentBlogPublicScheduleCycle } from './agent-blog-public-schedule-cycle.mjs';
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
const shutdown=new AbortController();
const stop = () => { stopping = true; shutdown.abort(Object.assign(new Error('AGENT_RUNTIME_INTERRUPTED'),{code:'AGENT_RUNTIME_INTERRUPTED'})); };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  let activated=false;
  while (!stopping) {
    try {
      if(!activated){
        const activation=await controller.ensure({agentUserId:runtime.config.agentUserId,enabled:true,preserveExisting:true});
        activated=!activation.blocked;
        process.stdout.write(`${JSON.stringify({service:'agent-blog-public-scheduler',event:'activation',...activation})}\n`);
      }
      const result = await runAgentBlogPublicScheduleCycle({ controller,
        signal:shutdown.signal,
        agentUserId: runtime.config.agentUserId, instanceId,
        heartbeatMilliseconds: Math.min(scheduleConfig.pollMilliseconds, 30000),
        onHeartbeatError: error => process.stderr.write(`${JSON.stringify({
          service: 'agent-blog-public-scheduler', event: 'heartbeat-error',
          code: error?.code ?? 'AGENT_BLOG_PUBLIC_HEARTBEAT_FAILED' })}\n`),
      });
      if (result.status !== 'idle') process.stdout.write(`${JSON.stringify({
        service: 'agent-blog-public-scheduler', event: 'fire-finished', ...result,
      })}\n`);
    } catch (error) {
      await controller.heartbeat({ agentUserId: runtime.config.agentUserId, instanceId,
        state: 'degraded' }).catch(() => {});
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
