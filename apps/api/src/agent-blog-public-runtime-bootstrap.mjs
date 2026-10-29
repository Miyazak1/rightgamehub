import { BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
  BLOG_PROJECT_SINGLE_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { GITHUB_REPOSITORY_SEARCH_TOOL } from './agent-github-repository-search-tool.mjs';
import { GITHUB_REPOSITORY_READ_TOOL } from './agent-github-repository-tool.mjs';
import { GITHUB_REPOSITORY_MATERIALS_TOOL } from './agent-github-repository-materials-tool.mjs';
import { ARXIV_PAPER_READ_TOOL } from './agent-arxiv-paper-tool.mjs';
import { PAPER_ANALYSIS_READ_TOOL } from './agent-paper-analysis-tool.mjs';
import { PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW } from './agent-paper-article-workflow.mjs';

export class AgentBlogPublicRuntimeBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogPublicRuntimeBootstrapError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogPublicRuntimeBootstrapError(code); };

export const DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG = Object.freeze({
  provider: 'deepseek', modelId: 'deepseek-flash', catalogVersion: 2, status: 'active',
  taskClasses: Object.freeze(['structured-generation']), supportsJsonSchema: true,
  maxInputTokens: 60_000, maxOutputTokens: 8_192,
  inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 5_000_000,
  config: Object.freeze({ schemaVersion: 'agent-provider-model-config-v1',
    protocol: 'deepseek-chat-completion-v1', admissionScope: 'agent-blog-public-runtime',
    pricingMode: 'conservative-reservation-ceiling' }),
});

function catalogFor(config) {
  if (config?.provider !== DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG.provider
    || config?.modelId !== DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG.modelId) {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_MODEL_CATALOG_UNSUPPORTED');
  }
  return { ...DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG,
    taskClasses: [...DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG.taskClasses],
    config: { ...DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG.config } };
}

async function registerActiveWorkflow(repository, actorUserId, manifest) {
  const registered = await repository.registerWorkflow({ actorUserId, manifest, status: 'draft' });
  const activated = registered.status === 'draft'
    ? await repository.activateWorkflow(manifest.workflowKey, manifest.workflowVersion) : registered;
  if (activated.status !== 'active') fail('AGENT_BLOG_PUBLIC_RUNTIME_WORKFLOW_NOT_ACTIVE');
  return { workflowKey: manifest.workflowKey, workflowVersion: manifest.workflowVersion,
    manifestSha256: registered.manifestSha256, status: activated.status };
}

export function createAgentBlogPublicRuntimeBootstrap({
  config, identityRepository, runtimeRepository, toolRepository, providerRepository,
} = {}) {
  if (!config || config.schemaVersion !== 'agent-blog-public-runtime-config-v1'
    || !identityRepository || !runtimeRepository || !toolRepository || !providerRepository) {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_BOOTSTRAP_DEPENDENCY_REQUIRED');
  }
  if (!config.enabled) fail('AGENT_BLOG_PUBLIC_RUNTIME_DISABLED');
  return {
    async run() {
      const catalog = catalogFor(config);
      const identity = await identityRepository.load(config.agentUserId);
      const tools = [];
      for (const contract of [GITHUB_REPOSITORY_SEARCH_TOOL, GITHUB_REPOSITORY_READ_TOOL,
        GITHUB_REPOSITORY_MATERIALS_TOOL, ARXIV_PAPER_READ_TOOL, PAPER_ANALYSIS_READ_TOOL]) {
        const registered = await toolRepository.registerTool(contract);
        if (registered.status !== 'active') fail('AGENT_BLOG_PUBLIC_RUNTIME_TOOL_NOT_ACTIVE');
        tools.push({ toolKey: registered.toolKey, contractVersion: registered.contractVersion,
          status: registered.status, existing: registered.existing === true });
      }
      const workflows = [];
      for (const manifest of [BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
        BLOG_PROJECT_SINGLE_WORKFLOW, PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW]) {
        workflows.push(await registerActiveWorkflow(runtimeRepository, identity.operatorUserId, manifest));
      }
      const model = await providerRepository.registerModel(catalog);
      return Object.freeze({
        schemaVersion: 'agent-blog-public-runtime-bootstrap-receipt-v1',
        agentUserId: identity.agentUserId, operatorUserId: identity.operatorUserId,
        tools, workflows,
        model: { provider: model.provider, modelId: model.modelId,
          catalogVersion: model.catalogVersion, existing: model.existing === true },
        runCreated: false, providerInvoked: false, publicationAttempted: false,
        ownershipChanged: false, scheduleChanged: false,
      });
    },
  };
}
