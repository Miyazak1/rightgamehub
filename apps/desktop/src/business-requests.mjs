import { randomUUID } from 'node:crypto';

const error = (code, status) => Object.assign(new Error(code), { code, status });
export function createBusinessRequests({ run, timeoutMs = 20000, concurrency = 4, maxPending = 32 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('DESKTOP_BUSINESS_QUEUE_CONFIG_INVALID');
  const pending = new Map(), queue = []; let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const item = queue.shift();
      if (item.finished) continue;
      item.started = true; active++;
      Promise.resolve().then(() => { item.controller.signal.throwIfAborted(); return run(item); })
        .then(value => item.finish(null, value), failure => item.finish(failure));
    }
  };
  return {
    submit(request, epoch, sessionSignal) {
      const id = request.requestId ?? randomUUID();
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || pending.has(id)) return Promise.reject(error('DESKTOP_BUSINESS_REQUEST_INVALID', 400));
      if (pending.size >= maxPending) return Promise.reject(error('DESKTOP_BUSINESS_BUSY', 429));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const item = { id, request, epoch, sessionSignal, controller, started: false, finished: false };
        const onAbort = () => item.finish(controller.signal.reason);
        const timer = setTimeout(() => controller.abort(error('REQUEST_TIMEOUT', 408)), timeoutMs);
        item.finish = (failure, value) => {
          if (item.finished) return;
          item.finished = true; clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
          pending.delete(id);
          const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1);
          if (item.started) active--;
          failure ? reject(failure) : resolve(value);
          queueMicrotask(pump);
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        pending.set(id, item); queue.push(item); queueMicrotask(pump);
      });
    },
    cancel(id) {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw error('DESKTOP_BUSINESS_REQUEST_INVALID', 400);
      const item = pending.get(id);
      if (item) item.controller.abort(error('REQUEST_CANCELLED', 499));
      return { cancelled: !!item };
    },
    abortAll(exceptId) { for (const item of [...pending.values()]) if (item.id !== exceptId) item.controller.abort(error('REQUEST_CANCELLED', 499)); },
  };
}
