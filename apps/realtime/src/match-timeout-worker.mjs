import { normalizeRulesTransition, RulesTransitionError } from './rules-transition.mjs';

export function createMatchTimeoutWorker({ repository, coordinator, rulesRegistry, intervalMs = 1_000, batchSize = 50, logger = console, clock = () => new Date() } = {}) {
  if (!repository || !coordinator || !rulesRegistry) throw new TypeError('Timeout repository, coordinator and rules registry are required.');
  let timer = null; let running = false;
  const runOnce = async () => {
    if (running) return { processed: 0,skipped: true };
    running = true; let processed = 0;
    try {
      const now = clock();
      const matchIds = await repository.listDueMatchIds({ now,limit: batchSize });
      for (const matchId of matchIds) {
        try {
          const result = await repository.applyTimeout({
            matchId,now,
            transition: context => {
              const adapter = rulesRegistry.get(context);
              if (!adapter) throw new RulesTransitionError('RULESET_NOT_AVAILABLE', '服务器没有安装该对局使用的规则版本。');
              return normalizeRulesTransition({ adapter,context,kind: 'timeout',now });
            },
          });
          if (!result.stale) {
            processed += 1;
            await coordinator.publish(matchId, { kind: 'match.changed',event: result.event,causedBy: null });
          }
        } catch (error) { logger?.error?.({ error,matchId }, 'Realtime match timeout failed'); }
      }
      return { processed,skipped: false };
    } finally { running = false; }
  };
  return Object.freeze({
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => runOnce().catch(error => logger?.error?.({ error }, 'Realtime timeout sweep failed')), intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  });
}
