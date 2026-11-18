// Keep the durable scheduler heartbeat fresh while a model/tool stage is busy.
// Heartbeat failures are diagnostic and must not replace a committed fire result.
export async function runAgentBlogPublicScheduleCycle({ controller, agentUserId, instanceId,
  heartbeatMilliseconds = 30000, onHeartbeatError = () => {}, signal }) {
  if (!Number.isSafeInteger(heartbeatMilliseconds) || heartbeatMilliseconds < 1000
    || heartbeatMilliseconds > 30000) throw Error('AGENT_BLOG_PUBLIC_HEARTBEAT_INTERVAL_INVALID');
  const heartbeat = state => controller.heartbeat({ agentUserId, instanceId, state });
  let pending = null, result;
  const report = error => { try { onHeartbeatError(error); } catch {} };
  // Recovery can precede first schedule registration. A missing heartbeat row
  // or a temporary DB disconnect must not gate recovery of an accepted task.
  try {await heartbeat('busy');} catch(error){report(error);}
  const timer = setInterval(() => {
    if (pending) return;
    pending = Promise.resolve().then(() => heartbeat('busy')).catch(report).finally(() => { pending = null; });
  }, heartbeatMilliseconds);
  timer.unref?.();
  try {
    result = await controller.runOnce({signal});
    return result;
  } finally {
    clearInterval(timer);
    await pending;
    await heartbeat(result?.fire?.scheduleSuspended ? 'suspended' : result?.status==='waiting'?'waiting':'idle').catch(report);
  }
}
