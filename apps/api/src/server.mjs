import { createRuntime } from './runtime.mjs';

const runtime = createRuntime();
await runtime.guessBaikeService.seedBuiltIns();
await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
runtime.guessBaikeAutomation.start();
const shutdown = async signal => { process.stderr.write(`GameHub API received ${signal}; shutting down.\n`); await runtime.app.close(); process.exit(0); };
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
