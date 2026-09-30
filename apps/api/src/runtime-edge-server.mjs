import { createRuntime } from './runtime.mjs';

const runtime = createRuntime({ loadTrustedRules: false });
runtime.runtimeEdgeApp.addHook('onClose', async () => runtime.database.close());
await runtime.runtimeEdgeApp.listen({ host: runtime.config.host, port: runtime.config.runtimePort });
const shutdown = async signal => { process.stderr.write(`GameHub runtime received ${signal}; shutting down.\n`); await runtime.runtimeEdgeApp.close(); process.exit(0); };
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
