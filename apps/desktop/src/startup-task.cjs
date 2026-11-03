// Start expensive initialization only when needed, and fence every waiter when
// the application closes. A late result must never re-enable a retired bridge.
exports.createStartupTask = function(start, onState = () => {}, {timeoutMs = 15000} = {}) {
  let pending, disposed = false, cancel;
  return {
    run() {
      if (disposed) return Promise.reject(Object.assign(Error('DESKTOP_STARTUP_CLOSED'), { code: 'DESKTOP_STARTUP_CLOSED' }));
      if (!pending) {
        onState('started');
        pending = new Promise((resolve, reject) => {
          let finished = false;
          const finish = (state, value) => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (!disposed) onState(state);
            state === 'ready' ? resolve(value) : reject(value);
          };
          const timer = setTimeout(() => finish('failed', Object.assign(Error('DESKTOP_STARTUP_TIMEOUT'), { code: 'DESKTOP_STARTUP_TIMEOUT' })), timeoutMs);
          cancel = () => finish('closed', Object.assign(Error('DESKTOP_STARTUP_CLOSED'), { code: 'DESKTOP_STARTUP_CLOSED' }));
          Promise.resolve().then(() => { if (!disposed) return start(); }).then(value => finish('ready', value), error => finish('failed', error));
        });
      }
      return pending;
    },
    dispose() { if (!disposed) { disposed = true; cancel?.(); } },
  };
};
