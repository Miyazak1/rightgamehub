const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const deliveryStates = new WeakMap();

const stateFor = api => {
  let state = deliveryStates.get(api);
  if (!state) {
    state = { tail: Promise.resolve(), failures: 0, blockedUntil: 0 };
    deliveryStates.set(api, state);
  }
  return state;
};

export function enqueueAnalytics(api, events, { now = Date.now } = {}) {
  if (!api || typeof api.trackAnalytics !== 'function') return Promise.resolve(false);
  const state = stateFor(api);
  const deliver = async () => {
    if (now() < state.blockedUntil) return false;
    try {
      await api.trackAnalytics(events);
      state.failures = 0;
      state.blockedUntil = 0;
      return true;
    } catch {
      state.failures += 1;
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** Math.min(4, state.failures - 1)));
      state.blockedUntil = now() + delay;
      return false;
    }
  };
  const attempt = state.tail.then(deliver, deliver);
  state.tail = attempt.then(() => undefined, () => undefined);
  return attempt;
}
