import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateFileExport, capabilityError } from '../../../packages/web-game-sdk/src/sharing-protocol.mjs';
export function createDesktopFileExports({ choosePath, context, verify }) {
  const pending = new Map();
  return {
    cancel(id) { const job = pending.get(id); if (job) job.cancelled = true; },
    cancelAll() { for (const job of pending.values()) job.cancelled = true; },
    async save(input) {
      if (!input || Object.keys(input).some(key => !['id','file','descriptor'].includes(key)) || !/^[a-f0-9-]{36}$/i.test(input.id ?? '') || !input.descriptor ||
          Object.keys(input.descriptor).some(key => !['workId','releaseId','channel'].includes(key)) ||
          ![input.descriptor.workId,input.descriptor.releaseId].every(value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)) ||
          !['production','preview'].includes(input.descriptor.channel)) throw capabilityError('FILE_EXPORT_INVALID','导出请求无效。');
      if (pending.size) throw capabilityError('FILE_EXPORT_BUSY','请先完成当前导出。');
      const file = validateFileExport(input.file), assertAccount = context(input.descriptor), job = { cancelled: false };
      const check = () => { if (job.cancelled) throw capabilityError('FILE_EXPORT_CANCELLED','保存已取消。'); assertAccount(); };
      pending.set(input.id, job); let temporary;
      try {
        await verify(input.descriptor); check();
        const selected = await choosePath(file); check();
        if (!selected || !path.isAbsolute(selected) || path.extname(selected).toLowerCase() !== (file.mimeType === 'image/png' ? '.png' : '.json')) throw capabilityError('FILE_EXPORT_CANCELLED','保存已取消或扩展名不符。');
        await verify(input.descriptor); check();
        const existing = await fs.lstat(selected).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw capabilityError('FILE_EXPORT_FAILED','保存目标不是普通文件。');
        temporary = path.join(path.dirname(selected), '.mooyu-export-' + randomUUID() + '.tmp');
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(new Uint8Array(file.data)); await handle.sync(); } finally { await handle.close(); }
        check(); await fs.rename(temporary, selected); temporary = null;
        // Do not disclose the selected absolute path to the renderer or iframe.
        return { status: 'saved', filename: path.basename(selected) };
      } finally { if (temporary) await fs.unlink(temporary).catch(() => {}); pending.delete(input.id); }
    },
  };
}
