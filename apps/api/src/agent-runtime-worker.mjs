import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const RUNTIME_VERSION = '1.0.0';

export class AgentRuntimeWorkerError extends Error {
  constructor(code, { retryable = false, uncertain = false, backoffSeconds = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentRuntimeWorkerError';
    this.code = code;
    this.retryable = retryable;
    this.uncertain = uncertain;
    this.backoffSeconds = backoffSeconds;
  }
}
const fail = (code, options) => { throw new AgentRuntimeWorkerError(code, options); };
const integer = (value, min, max, code) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(code);
  return value;
};

function normalizeHandlers(input) {
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input ?? {});
  const handlers = new Map();
  for (const [route, handler] of entries) {
    if (typeof route !== 'string' || !/^[a-z][a-z0-9.-]{2,119}:[a-z][a-z0-9-]{1,79}$/u.test(route)
      || typeof handler !== 'function' || handlers.has(route)) fail('AGENT_RUNTIME_HANDLER_INVALID');
    handlers.set(route, handler);
  }
  return handlers;
}

function normalizeResult(result) {
  if (result == null) return { outputRef: {}, runOutput: null };
  if (typeof result !== 'object' || Array.isArray(result)) fail('AGENT_RUNTIME_HANDLER_RESULT_INVALID');
  const outputRef = result.outputRef ?? {};
  const runOutput = result.runOutput ?? null;
  if (!outputRef || typeof outputRef !== 'object' || Array.isArray(outputRef)) fail('AGENT_RUNTIME_HANDLER_RESULT_INVALID');
  if (runOutput !== null && (!runOutput || typeof runOutput !== 'object' || Array.isArray(runOutput)
    || typeof runOutput.type !== 'string' || typeof runOutput.id !== 'string')) fail('AGENT_RUNTIME_HANDLER_RESULT_INVALID');
  return { outputRef, runOutput };
}

function errorDetails(error, stage) {
  const code = typeof error?.code === 'string' && error.code.length <= 120 ? error.code : 'AGENT_STAGE_EXECUTION_FAILED';
  const message = String(error?.message ?? error ?? code).slice(0, 500);
  const explicitRetryable = typeof error?.retryable === 'boolean' ? error.retryable : null;
  const requestedBackoff = Number(error?.backoffSeconds);
  const exponentialBackoff = Math.min(300, 2 ** Math.max(0, stage.attempt - 1));
  return {
    errorCode: code,
    errorMessage: message,
    retryable: explicitRetryable ?? stage.kind === 'deterministic',
    uncertain: error?.uncertain === true,
    backoffSeconds: Number.isFinite(requestedBackoff) && requestedBackoff >= 0
      ? Math.min(3600, Math.max(exponentialBackoff, Math.ceil(requestedBackoff)))
      : exponentialBackoff,
  };
}

export function loadAgentRuntimeWorkerConfig(env = process.env) {
  const enabled = env.AGENT_RUNTIME_WORKER_ENABLED === 'true';
  if (env.AGENT_RUNTIME_WORKER_ENABLED != null && !['true', 'false'].includes(env.AGENT_RUNTIME_WORKER_ENABLED)) fail('AGENT_RUNTIME_WORKER_ENABLED_INVALID');
  const workerId = env.AGENT_RUNTIME_WORKER_ID?.trim() || 'agent-runtime-worker-1';
  if (workerId.length > 120) fail('AGENT_RUNTIME_WORKER_ID_INVALID');
  const leaseSeconds = integer(Number(env.AGENT_RUNTIME_LEASE_SECONDS ?? 120), 15, 3600, 'AGENT_RUNTIME_LEASE_SECONDS_INVALID');
  const heartbeatSeconds = integer(Number(env.AGENT_RUNTIME_HEARTBEAT_SECONDS ?? 30), 5, 1200, 'AGENT_RUNTIME_HEARTBEAT_SECONDS_INVALID');
  if (heartbeatSeconds * 2 >= leaseSeconds) fail('AGENT_RUNTIME_HEARTBEAT_INTERVAL_UNSAFE');
  return {
    enabled,
    workerId,
    leaseSeconds,
    heartbeatSeconds,
    pollMilliseconds: integer(Number(env.AGENT_RUNTIME_POLL_MS ?? 1000), 50, 60000, 'AGENT_RUNTIME_POLL_INVALID'),
    outboxLeaseSeconds: integer(Number(env.AGENT_RUNTIME_OUTBOX_LEASE_SECONDS ?? 30), 5, 600, 'AGENT_RUNTIME_OUTBOX_LEASE_INVALID'),
    recoveryBatch: integer(Number(env.AGENT_RUNTIME_RECOVERY_BATCH ?? 25), 1, 200, 'AGENT_RUNTIME_RECOVERY_BATCH_INVALID'),
    outboxBatch: integer(Number(env.AGENT_RUNTIME_OUTBOX_BATCH ?? 25), 1, 200, 'AGENT_RUNTIME_OUTBOX_BATCH_INVALID'),
  };
}

export function createAgentRuntimeWorker({
  repository,
  handlers = {},
  onOutbox = async message => {
    if (message.eventType !== 'stage.available') fail('AGENT_RUNTIME_OUTBOX_EVENT_UNSUPPORTED');
  },
  workerId = 'agent-runtime-worker-1',
  instanceId = crypto.randomUUID(),
  runtimeVersion = RUNTIME_VERSION,
  leaseSeconds = 120,
  heartbeatSeconds = 30,
  pollMilliseconds = 1000,
  outboxLeaseSeconds = 30,
  recoveryBatch = 25,
  outboxBatch = 25,
  targetRunId = null,
  metadata = {},
  logger = false,
} = {}) {
  if (!repository) fail('AGENT_RUNTIME_REPOSITORY_REQUIRED');
  const routes = normalizeHandlers(handlers);
  integer(leaseSeconds, 15, 3600, 'AGENT_RUNTIME_LEASE_SECONDS_INVALID');
  integer(heartbeatSeconds, 5, 1200, 'AGENT_RUNTIME_HEARTBEAT_SECONDS_INVALID');
  if (heartbeatSeconds * 2 >= leaseSeconds) fail('AGENT_RUNTIME_HEARTBEAT_INTERVAL_UNSAFE');
  integer(pollMilliseconds, 50, 60000, 'AGENT_RUNTIME_POLL_INVALID');
  integer(outboxLeaseSeconds, 5, 600, 'AGENT_RUNTIME_OUTBOX_LEASE_INVALID');
  integer(recoveryBatch, 1, 200, 'AGENT_RUNTIME_RECOVERY_BATCH_INVALID');
  integer(outboxBatch, 1, 200, 'AGENT_RUNTIME_OUTBOX_BATCH_INVALID');
  if (targetRunId !== null && (typeof targetRunId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(targetRunId))) {
    fail('AGENT_RUNTIME_TARGET_RUN_INVALID');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 4096) {
    fail('AGENT_RUNTIME_WORKER_METADATA_INVALID');
  }

  let registered = false;
  let running = false;
  let stopping = false;
  let loopPromise = null;
  let wakeController = new AbortController();

  const register = async () => {
    if (registered) return;
    await repository.registerWorker({
      workerId, instanceId, runtimeVersion, capabilities: [...routes.keys()],
      metadata: { ...structuredClone(metadata), pid: process.pid, platform: process.platform },
      staleAfterSeconds: Math.max(leaseSeconds * 2, 30),
    });
    registered = true;
  };

  const dispatchOutbox = async () => {
    let delivered = 0;
    let failed = 0;
    for (let index = 0; index < outboxBatch; index += 1) {
      const message = await repository.claimNextOutbox(workerId, outboxLeaseSeconds);
      if (!message) break;
      try {
        await onOutbox(structuredClone(message));
        await repository.deliverOutbox({ outboxId: message.id, leaseToken: message.leaseToken });
        delivered += 1;
      } catch (error) {
        const retryable = error?.retryable !== false;
        await repository.failOutbox({
          outboxId: message.id, leaseToken: message.leaseToken,
          errorCode: String(error?.code ?? 'AGENT_OUTBOX_DISPATCH_FAILED').slice(0, 120),
          errorMessage: String(error?.message ?? error).slice(0, 500), retryable,
          backoffSeconds: Math.min(300, 2 ** Math.max(0, message.attempts - 1)),
        });
        failed += 1;
      }
    }
    return { delivered, failed };
  };

  const execute = async claimed => {
    await repository.heartbeatWorker({ workerId, instanceId, status: 'busy', currentStageId: claimed.id });
    const stage = await repository.startStage({ stageId: claimed.id, workerId, leaseToken: claimed.leaseToken });
    const context = await repository.loadStageExecutionContext({ stageId: stage.id, workerId, leaseToken: stage.leaseToken });
    const route = `${context.run.workflowKey}:${stage.stageKey}`;
    const handler = routes.get(route);
    if (!handler) fail('AGENT_RUNTIME_HANDLER_NOT_REGISTERED');
    const controller = new AbortController();
    let heartbeatTimer = null;
    let timeoutTimer = null;
    let leaseReject;
    const leaseFailure = new Promise((_, reject) => { leaseReject = reject; });
    const scheduleHeartbeat = () => {
      heartbeatTimer = setTimeout(async () => {
        try {
          await repository.renewStageLease({ stageId: stage.id, workerId, leaseToken: stage.leaseToken, leaseSeconds });
          await repository.heartbeatWorker({ workerId, instanceId, status: 'busy', currentStageId: stage.id });
          scheduleHeartbeat();
        } catch (error) {
          controller.abort(error);
          leaseReject(new AgentRuntimeWorkerError('AGENT_RUNTIME_LEASE_LOST', { cause: error }));
        }
      }, heartbeatSeconds * 1000);
      heartbeatTimer.unref?.();
    };
    const timeout = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        const error = new AgentRuntimeWorkerError('AGENT_STAGE_TIMEOUT', { retryable: true });
        controller.abort(error);
        reject(error);
      }, stage.timeoutSeconds * 1000);
      timeoutTimer.unref?.();
    });
    scheduleHeartbeat();
    try {
      const result = normalizeResult(await Promise.race([
        Promise.resolve().then(() => handler(structuredClone(context), {
          signal: controller.signal, repository, workerId, instanceId, leaseToken: stage.leaseToken,
        })),
        timeout,
        leaseFailure,
      ]));
      const completed = await repository.completeStage({
        stageId: stage.id, workerId, leaseToken: stage.leaseToken,
        outputRef: result.outputRef, runOutput: result.runOutput,
      });
      return { status: 'completed', stage: completed.stage, run: completed.run, unlocked: completed.unlocked };
    } catch (error) {
      if (error?.code === 'AGENT_RUNTIME_LEASE_LOST') return { status: 'lease-lost', stageId: stage.id, error };
      const details = errorDetails(error, stage);
      try {
        const failure = await repository.failStage({ stageId: stage.id, workerId, leaseToken: stage.leaseToken, ...details });
        return { status: failure.retryScheduled ? 'retry-scheduled' : failure.stage.status, stage: failure.stage, error };
      } catch (failureError) {
        if (failureError?.code === 'AGENT_RUNTIME_LEASE_LOST') return { status: 'lease-lost', stageId: stage.id, error };
        throw failureError;
      }
    } finally {
      clearTimeout(heartbeatTimer);
      clearTimeout(timeoutTimer);
      controller.abort();
      await repository.heartbeatWorker({ workerId, instanceId, status: stopping ? 'stopping' : 'idle', currentStageId: null }).catch(() => {});
    }
  };

  const runOnce = async () => {
    if (running) fail('AGENT_RUNTIME_WORKER_REENTRANT');
    if (stopping) return { status: 'stopping' };
    running = true;
    try {
      await register();
      const isolated = targetRunId !== null;
      const [stageRecovery, outboxRecovery] = isolated
        ? [{ examined: 0, requeued: 0, failed: 0, uncertain: 0 },
          { examined: 0, requeued: 0, failed: 0 }]
        : await Promise.all([
          repository.recoverExpiredStages({ workerId, limit: recoveryBatch }),
          repository.recoverExpiredOutbox({ limit: recoveryBatch }),
        ]);
      const outbox = isolated ? { delivered: 0, failed: 0 } : await dispatchOutbox();
      const claimed = await repository.claimNextStage(workerId, leaseSeconds, [...routes.keys()], targetRunId);
      if (!claimed) {
        await repository.heartbeatWorker({ workerId, instanceId, status: 'idle', currentStageId: null });
        return { status: 'idle', recovery: { stages: stageRecovery, outbox: outboxRecovery }, outbox };
      }
      return { ...(await execute(claimed)), recovery: { stages: stageRecovery, outbox: outboxRecovery }, outbox };
    } finally {
      running = false;
    }
  };

  const start = () => {
    if (loopPromise) return loopPromise;
    stopping = false;
    loopPromise = (async () => {
      while (!stopping) {
        try {
          const result = await runOnce();
          if (result.status !== 'idle') logger?.info?.({ service: 'agent-runtime-worker', workerId, status: result.status });
        } catch (error) {
          logger?.error?.({ service: 'agent-runtime-worker', workerId, code: error?.code ?? 'AGENT_RUNTIME_WORKER_FAILED', message: String(error?.message ?? error) });
        }
        if (!stopping) {
          try { await delay(pollMilliseconds, undefined, { signal: wakeController.signal }); } catch {}
          wakeController = new AbortController();
        }
      }
    })();
    return loopPromise;
  };

  const stop = async () => {
    stopping = true;
    wakeController.abort();
    if (registered) await repository.heartbeatWorker({ workerId, instanceId, status: 'stopping', currentStageId: null }).catch(() => {});
    await loopPromise;
    if (registered) await repository.stopWorker({ workerId, instanceId }).catch(() => {});
    loopPromise = null;
  };

  return { workerId, instanceId, routes: [...routes.keys()], runOnce, start, stop };
}

