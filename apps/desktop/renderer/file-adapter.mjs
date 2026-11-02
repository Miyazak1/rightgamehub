export function createDesktopFileExporter(bridge) {
  return { async download(file, { descriptor, verify = async () => {}, signal } = {}) {
    const id = crypto.randomUUID(), cancelled = () => Object.assign(new Error('保存已取消。'), { code: 'FILE_EXPORT_CANCELLED' });
    if (signal?.aborted) throw cancelled();
    await verify(); if (signal?.aborted) throw cancelled();
    const abort = () => { bridge.cancel(id).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await bridge.save({ id, file, descriptor: { workId: descriptor?.workId, releaseId: descriptor?.releaseId, channel: descriptor?.channel ?? 'production' } });
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
      if (signal?.aborted) throw cancelled(); return result.value;
    } finally { signal?.removeEventListener('abort', abort); }
  } };
}
