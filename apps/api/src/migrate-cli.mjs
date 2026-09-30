import { createRuntime } from './runtime.mjs';

const runtime = createRuntime({ mailer: { async sendVerificationCode() {} },loadTrustedRules: false });
try {
  const result = await runtime.migrations.apply();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await runtime.app.close(); }
