import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { createAgentRuntimeWorker } from './agent-runtime-worker.mjs';
import { createAgentRuntimePolicyService } from './agent-runtime-policy-service.mjs';
import { PostgresAgentProviderGatewayRepository } from './agent-provider-gateway-repository.mjs';
import { createAgentProviderGateway } from './agent-provider-gateway.mjs';
import { createAgentDeepSeekProviderAdapter } from './agent-deepseek-provider-adapter.mjs';
import { createAgentSecretVault } from './agent-secret-vault.mjs';
import { PostgresAgentRuntimeStageArtifactRepository } from './agent-runtime-stage-artifact-repository.mjs';
import { PAPER_SEMANTIC_RESPONSE_SCHEMAS } from './agent-paper-semantic-contracts.mjs';
import { createPaperSemanticCanary } from './agent-paper-semantic-workflow.mjs';
import { PostgresAgentPaperSemanticRepository,
  createAgentPaperSemanticGateway } from './agent-paper-semantic-repository.mjs';
import { createAgentPaperSemanticHandlers } from './agent-paper-semantic-runtime.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u;

export class AgentPaperSemanticRuntimeBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperSemanticRuntimeBootstrapError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperSemanticRuntimeBootstrapError(code); };
const bool = (value, key) => {
  if (value == null) return false;
  if (!['true', 'false'].includes(value)) fail(`${key}_INVALID`);
  return value === 'true';
};

export const DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG = Object.freeze({
  provider: 'deepseek', modelId: 'deepseek-flash', catalogVersion: 3, status: 'active',
  taskClasses: Object.freeze(['structured-generation', 'paper-semantic-analysis']),
  supportsJsonSchema: true, maxInputTokens: 60_000, maxOutputTokens: 8_192,
  inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 5_000_000,
  config: Object.freeze({ schemaVersion: 'agent-provider-model-config-v1',
    protocol: 'deepseek-chat-completion-v1', admissionScope: 'agent-paper-semantic-private-runtime',
    pricingMode: 'conservative-reservation-ceiling' }),
});

export function loadAgentPaperSemanticRuntimeConfig(env = process.env) {
  const enabled = bool(env.AGENT_PAPER_SEMANTIC_ENABLED, 'AGENT_PAPER_SEMANTIC_ENABLED');
  const agentUserId = (env.AGENT_PAPER_SEMANTIC_AGENT_USER_ID
    ?? env.AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID ?? '').trim() || null;
  if (enabled && (!agentUserId || !UUID.test(agentUserId))) fail('AGENT_PAPER_SEMANTIC_AGENT_REQUIRED');
  const provider = (env.AGENT_PAPER_SEMANTIC_PROVIDER ?? 'deepseek').trim();
  const modelId = (env.AGENT_PAPER_SEMANTIC_MODEL_ID ?? 'deepseek-flash').trim();
  if (provider !== 'deepseek' || !MODEL.test(modelId)) fail('AGENT_PAPER_SEMANTIC_MODEL_INVALID');
  if (enabled && (provider !== DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG.provider
    || modelId !== DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG.modelId)) {
    fail('AGENT_PAPER_SEMANTIC_MODEL_CATALOG_UNSUPPORTED');
  }
  return Object.freeze({ schemaVersion: 'agent-paper-semantic-runtime-config-v1',
    enabled, agentUserId, provider, modelId });
}

async function loadIdentity(pool, agentUserId) {
  const row = (await pool.query(`SELECT account.user_id,account.operator_user_id
    FROM agent_accounts account
    JOIN users agent_user ON agent_user.id=account.user_id
    JOIN users operator_user ON operator_user.id=account.operator_user_id
    WHERE account.user_id=$1 AND account.status='active' AND agent_user.status='active'
      AND agent_user.account_type='agent' AND operator_user.status='active'
      AND operator_user.role='admin'`, [agentUserId])).rows[0];
  if (!row) fail('AGENT_PAPER_SEMANTIC_IDENTITY_NOT_READY');
  return { agentUserId: row.user_id, operatorUserId: row.operator_user_id };
}

export function createAgentPaperSemanticRuntime({ env = process.env, pool: suppliedPool,
  applicationName = 'gamehub-agent-paper-semantic' } = {}) {
  if (!env.DATABASE_URL && !suppliedPool) throw new Error('DATABASE_URL is required');
  if (!env.AGENT_SECRET_ENCRYPTION_KEY) throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required');
  const config = loadAgentPaperSemanticRuntimeConfig(env);
  if (!config.enabled) fail('AGENT_PAPER_SEMANTIC_DISABLED');
  const ownsPool = !suppliedPool;
  const pool = suppliedPool ?? new pg.Pool({ connectionString: env.DATABASE_URL, max: 3,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    application_name: applicationName,
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
  const runtimeRepository = new PostgresAgentRuntimeRepository(pool);
  const policyService = createAgentRuntimePolicyService({ pool });
  const providerRepository = new PostgresAgentProviderGatewayRepository(pool);
  const providerGateway = createAgentProviderGateway({ runtimeRepository, governanceRepository: providerRepository,
    policyService, secretVault: createAgentSecretVault({ masterKey: env.AGENT_SECRET_ENCRYPTION_KEY }),
    adapters: { deepseek: createAgentDeepSeekProviderAdapter() },
    responseSchemas: PAPER_SEMANTIC_RESPONSE_SCHEMAS });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(pool);
  const repository = new PostgresAgentPaperSemanticRepository(pool);
  const semanticGateway = createAgentPaperSemanticGateway({ runtimeRepository, policyService, repository });
  const handlers = createAgentPaperSemanticHandlers({ repository, providerGateway,
    artifactRepository, semanticGateway });
  const canary = createPaperSemanticCanary({ runtimeRepository, enabled: true });
  return Object.freeze({
    config,
    async bootstrap() {
      const identity = await loadIdentity(pool, config.agentUserId);
      const workflow = await canary.register(identity.operatorUserId);
      const model = await providerRepository.registerModel({
        ...DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG,
        taskClasses: [...DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG.taskClasses],
        config: { ...DEEPSEEK_FLASH_PAPER_SEMANTIC_CATALOG.config },
      });
      return { identity, workflow, model: { provider: model.provider, modelId: model.modelId,
        catalogVersion: model.catalogVersion, existing: model.existing === true } };
    },
    async createRun({ paperVersionId, requestId = crypto.randomUUID() }) {
      if (!UUID.test(paperVersionId ?? '') || !UUID.test(requestId ?? '')) {
        fail('AGENT_PAPER_SEMANTIC_INPUT_INVALID');
      }
      return canary.createRun({ agentUserId: config.agentUserId, triggerKind: 'manual',
        triggerRef: requestId, idempotencyKey: `paper-semantic:${paperVersionId}:${requestId}`,
        input: { schemaVersion: 'paper-semantic-run-input-v1', paperVersionId,
          purpose: 'private-research' },
        config: { model: { provider: config.provider, modelId: config.modelId } } });
    },
    createWorker: runId => createAgentRuntimeWorker({ repository: runtimeRepository, handlers,
      targetRunId: runId, workerId: `agent-paper-semantic-${runId}`.slice(0, 120),
      instanceId: crypto.randomUUID(), leaseSeconds: 180, heartbeatSeconds: 30,
      pollMilliseconds: 1000, recoveryBatch: 1, outboxBatch: 25 }),
    async readRun(runId) {
      if (!UUID.test(runId ?? '')) fail('AGENT_PAPER_SEMANTIC_INPUT_INVALID');
      const row = (await pool.query(`SELECT id,status,output_type,output_id,error_code,error_message
        FROM agent_runs WHERE id=$1 AND agent_user_id=$2`, [runId, config.agentUserId])).rows[0];
      if (!row) fail('AGENT_PAPER_SEMANTIC_RUN_NOT_FOUND');
      return { id: row.id, status: row.status, outputType: row.output_type,
        outputId: row.output_id, errorCode: row.error_code, errorMessage: row.error_message };
    },
    close: async () => { if (ownsPool) await pool.end(); },
  });
}
