import { createRuntime } from './runtime.mjs';

const runtime = createRuntime();
try {
  await runtime.migrations.apply();
  const result = await runtime.validationWorker.runOnce();
  process.stdout.write(`${JSON.stringify({ processed: Boolean(result), result })}\n`);
} finally { await runtime.app.close(); }
