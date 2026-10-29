import { BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
  BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { GITHUB_REPOSITORY_SEARCH_TOOL } from './agent-github-repository-search-tool.mjs';
import { GITHUB_REPOSITORY_READ_TOOL } from './agent-github-repository-tool.mjs';
import { GITHUB_REPOSITORY_MATERIALS_TOOL } from './agent-github-repository-materials-tool.mjs';
import { ARXIV_PAPER_READ_TOOL } from './agent-arxiv-paper-tool.mjs';
import { PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW } from './agent-paper-semantic-workflow.mjs';
import { PAPER_RESEARCH_EXECUTION_WORKFLOW } from './agent-paper-research-execution.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentBlogPrivateCanaryBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogPrivateCanaryBootstrapError';
    this.code = code;
  }
}

const fail = code => { throw new AgentBlogPrivateCanaryBootstrapError(code); };

// This is an operator-approved admission envelope, not a claim about the
// provider's current public list price. The deliberately conservative price
// ceilings make reservation accounting fail safe until billing reconciliation
// becomes a separate provider capability.
export const DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG = Object.freeze({
  provider: 'deepseek',
  modelId: 'deepseek-flash',
  catalogVersion: 1,
  status: 'active',
  taskClasses: Object.freeze(['structured-generation', 'paper-semantic-analysis']),
  supportsJsonSchema: true,
  maxInputTokens: 60_000,
  maxOutputTokens: 8_192,
  inputPriceMicrousdPerMillion: 1_000_000,
  outputPriceMicrousdPerMillion: 5_000_000,
  config: Object.freeze({
    schemaVersion: 'agent-provider-model-config-v1',
    protocol: 'deepseek-chat-completion-v1',
    admissionScope: 'agent-blog-private-canary',
    pricingMode: 'conservative-reservation-ceiling',
  }),
});

export class PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_BLOG_PRIVATE_CANARY_DATABASE_REQUIRED');
    this.pool = pool;
  }

  async load(agentUserId) {
    if (typeof agentUserId !== 'string' || !UUID.test(agentUserId)) {
      fail('AGENT_BLOG_PRIVATE_CANARY_AGENT_REQUIRED');
    }
    const row = (await this.pool.query(`SELECT account.user_id,account.operator_user_id
      FROM agent_accounts account
      JOIN users agent_user ON agent_user.id=account.user_id
      JOIN users operator_user ON operator_user.id=account.operator_user_id
      WHERE account.user_id=$1 AND account.status='active' AND agent_user.status='active'
        AND agent_user.account_type='agent' AND operator_user.status='active'
        AND operator_user.role='admin'`, [agentUserId])).rows[0];
    if (!row) fail('AGENT_BLOG_PRIVATE_CANARY_IDENTITY_NOT_READY');
    return { agentUserId: row.user_id, operatorUserId: row.operator_user_id };
  }
}

function catalogFor(config) {
  if (config?.provider !== DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG.provider
    || config?.modelId !== DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG.modelId) {
    fail('AGENT_BLOG_PRIVATE_CANARY_MODEL_CATALOG_UNSUPPORTED');
  }
  return {
    ...DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG,
    taskClasses: [...DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG.taskClasses],
    config: { ...DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG.config },
  };
}

async function registerActiveWorkflow(runtimeRepository, actorUserId, manifest) {
  const registered = await runtimeRepository.registerWorkflow({ actorUserId, manifest, status: 'draft' });
  let status = registered.status;
  if (status === 'draft') {
    const activated = await runtimeRepository.activateWorkflow(manifest.workflowKey, manifest.workflowVersion);
    status = activated.status;
  }
  if (status !== 'active') fail('AGENT_BLOG_PRIVATE_CANARY_WORKFLOW_NOT_ACTIVE');
  return {
    workflowKey: manifest.workflowKey,
    workflowVersion: manifest.workflowVersion,
    manifestSha256: registered.manifestSha256,
    status,
  };
}

export function createAgentBlogPrivateCanaryBootstrap({
  config, identityRepository, runtimeRepository, toolRepository, providerRepository,
} = {}) {
  if (!config || config.schemaVersion !== 'agent-blog-private-canary-config-v1'
    || !identityRepository || !runtimeRepository || !toolRepository || !providerRepository) {
    fail('AGENT_BLOG_PRIVATE_CANARY_BOOTSTRAP_DEPENDENCY_REQUIRED');
  }
  if (!config.enabled) fail('AGENT_BLOG_PRIVATE_CANARY_DISABLED');
  if (config.publishEnabled !== false) fail('AGENT_BLOG_PRIVATE_CANARY_PUBLISH_FORBIDDEN');
  return {
    async run() {
      const catalog = catalogFor(config);
      const identity = await identityRepository.load(config.agentUserId);
      if (identity.agentUserId !== config.agentUserId || !UUID.test(identity.operatorUserId)) {
        fail('AGENT_BLOG_PRIVATE_CANARY_IDENTITY_NOT_READY');
      }
      const tools = [];
      for (const contract of [GITHUB_REPOSITORY_SEARCH_TOOL, GITHUB_REPOSITORY_READ_TOOL,
        GITHUB_REPOSITORY_MATERIALS_TOOL, ARXIV_PAPER_READ_TOOL]) {
        const registered = await toolRepository.registerTool(contract);
        if (registered.status !== 'active') fail('AGENT_BLOG_PRIVATE_CANARY_TOOL_NOT_ACTIVE');
        tools.push({
          toolKey: registered.toolKey,
          contractVersion: registered.contractVersion,
          status: registered.status,
          existing: registered.existing === true,
        });
      }
      const workflows = [];
      for (const manifest of [BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
        BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW, PAPER_SINGLE_SEMANTIC_SHADOW_WORKFLOW,
        PAPER_RESEARCH_EXECUTION_WORKFLOW]) {
        workflows.push(await registerActiveWorkflow(runtimeRepository, identity.operatorUserId, manifest));
      }
      const model = await providerRepository.registerModel(catalog);
      return Object.freeze({
        schemaVersion: 'agent-blog-private-canary-bootstrap-receipt-v1',
        agentUserId: identity.agentUserId,
        operatorUserId: identity.operatorUserId,
        tools,
        workflows,
        model: {
          provider: model.provider,
          modelId: model.modelId,
          catalogVersion: model.catalogVersion,
          existing: model.existing === true,
        },
        runCreated: false,
        providerInvoked: false,
        publicationAttempted: false,
      });
    },
  };
}
