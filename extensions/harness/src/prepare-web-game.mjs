import { mkdir, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WEB_LIMITS } from './web-policy.mjs';

export async function prepareWebGame({ root, id, archive, totalLimit, signal }) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid game ID');
  const parent = path.resolve(root, 'web');
  const output = path.resolve(parent, `${id}.partial`);
  const final = path.resolve(parent, id);
  if (path.dirname(output) !== parent || path.dirname(final) !== parent) throw new Error('Invalid extraction directory');
  await mkdir(parent, { recursive: true });
  await mkdir(output);
  let committed = false;
  try {
    const result = await new Promise((resolve, reject) => {
      // Fixed parser, minimal environment, bounded heap and wall clock. This is
      // process separation for local testing, not an OS container sandbox.
      const child = spawn(process.execPath, ['--max-old-space-size=192', fileURLToPath(new URL('./zip-worker.mjs', import.meta.url)), archive, output, String(Math.min(totalLimit, WEB_LIMITS.totalBytes))], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {},
      });
      const chunks = [];
      let bytes = 0;
      let stopped;
      const stop = reason => { stopped = reason; child.kill(); };
      const timer = setTimeout(() => stop('网页包检查超时。'), WEB_LIMITS.timeoutMs);
      const abort = () => stop('网页包检查已取消。');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) stop('网页包清单过大。'); else chunks.push(chunk); });
      child.once('error', reject);
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (stopped) { reject(new Error(stopped)); return; }
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (code !== 0 || !parsed.ok) throw new Error(parsed.error || '网页包检查未完成。');
          resolve(parsed.game);
        } catch (error) { reject(error); }
      });
    });
    signal?.throwIfAborted();
    await rename(output, final);
    committed = true;
    return result;
  } finally {
    if (!committed) await rm(output, { recursive: true, force: true });
  }
}
