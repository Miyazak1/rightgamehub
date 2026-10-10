(() => {
  const memory = new Map();
  let persistent = null;
  try {
    const storage = window.localStorage;
    const probe = '__orbital_order_storage_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    persistent = storage;
  } catch {}
  window.gamehubSafeStorage = {
    getItem(key) {
      try { return persistent ? persistent.getItem(key) : (memory.has(key) ? memory.get(key) : null); }
      catch { return memory.has(key) ? memory.get(key) : null; }
    },
    setItem(key, value) {
      const normalized = String(value);
      memory.set(key, normalized);
      try { persistent?.setItem(key, normalized); } catch {}
    },
  };
})();
