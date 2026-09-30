import { createRuntime } from './runtime.mjs';

const runtime = createRuntime();
process.stdout.write(`GameHub API loaded ${runtime.rulesRegistry.list().length} trusted rules adapter(s).\n`);
await runtime.guessBaikeService.seedBuiltIns();
await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
runtime.guessBaikeAutomation.start();
await runtime.storageCapacityService.start();
const shutdown = async signal => { process.stderr.write(`GameHub API received ${signal}; shutting down.\n`); await runtime.app.close(); process.exit(0); };
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
