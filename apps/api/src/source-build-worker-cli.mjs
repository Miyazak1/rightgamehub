import { createRuntime } from './runtime.mjs';

const runtime = createRuntime({ loadTrustedRules: false });
let stopping = false;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const stop = () => { stopping = true; };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  while (!stopping) {
    try {
      const result = await runtime.sourceBuildWorker.runOnce();
      if (!result) await pause(1000);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ level: 'error', service: 'source-build-worker', code: error.code ?? 'SOURCE_BUILD_FAILED', message: error.message })}\n`);
      await pause(3000);
    }
  }
} finally {
  await runtime.app.close();
}
