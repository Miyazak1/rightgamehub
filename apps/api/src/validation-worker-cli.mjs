import { createRuntime } from './runtime.mjs';

const runtime = createRuntime({ loadTrustedRules: false });
let stopping = false;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const stop = () => { stopping = true; };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

try {
  while (!stopping) {
    try {
      const result = await runtime.validationWorker.runOnce();
      if (!result) await pause(1000);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ level: 'error', service: 'validation-worker', code: error.code ?? 'VALIDATION_FAILED', message: error.message })}\n`);
      await pause(3000);
    }
  }
} finally {
  await runtime.app.close();
}
