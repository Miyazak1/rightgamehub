const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('private canary bootstrap is idempotent and writes control-plane records only', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
  const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
  const { createAgentBlogPrivateCanaryBootstrap,
    PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository } =
    await harness.load('agent-blog-private-canary-bootstrap.mjs');
  const { DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG } =
    await harness.load('agent-blog-public-runtime-bootstrap.mjs');

  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Canary operator','admin')", [operatorId]);
  const account = await createAgentAccountService({
    repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true,
  }).provision({ userId: operatorId }, {
    provisionKey: `canary-bootstrap-${crypto.randomUUID()}`,
    displayName: 'Canary Agent', handle: `canary-${crypto.randomBytes(5).toString('hex')}`,
    badgeLabel: 'AI 助手', operatorLabel: 'Canary operator',
    capabilities: ['blog:auto-publish'], metadata: {},
  });
  const config = {
    schemaVersion: 'agent-blog-private-canary-config-v1', enabled: true, publishEnabled: false,
    agentUserId: account.agentUserId, provider: 'deepseek', modelId: 'deepseek-flash',
  };
  const providerRepository = new PostgresAgentProviderGatewayRepository(admin);
  const create = () => createAgentBlogPrivateCanaryBootstrap({
    config,
    identityRepository: new PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository(admin),
    runtimeRepository: new PostgresAgentRuntimeRepository(admin),
    toolRepository: new PostgresAgentToolGatewayRepository(admin),
    providerRepository,
  }).run();
  const first = await create();
  const second = await create();
  assert.equal(first.model.existing, false);
  assert.equal(second.model.existing, true);
  assert.equal(second.workflows.every(item => item.status === 'active'), true);
  const publicFirst = await providerRepository.registerModel(DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG);
  const publicSecond = await providerRepository.registerModel(DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG);
  assert.equal(publicFirst.catalogVersion, 2);
  assert.equal(publicFirst.existing, false);
  assert.equal(publicSecond.existing, true);

  const counts = (await admin.query(`SELECT
    (SELECT count(*)::int FROM agent_workflow_definitions WHERE status='active'
      AND (workflow_key,workflow_version) IN (
        ('blog.project.discovery-shadow',3),('blog.project.single.draft-shadow',2))) AS workflows,
    (SELECT count(*)::int FROM agent_tool_contracts WHERE status='active'
      AND (tool_key,contract_version) IN (
        ('research.github.repository.search',1),('research.github.repository.read',1),
        ('research.github.repository.materials.read',1),('research.paper.arxiv.read',2))) AS tools,
    (SELECT count(*)::int FROM agent_provider_models WHERE provider='deepseek'
      AND model_id='deepseek-flash' AND catalog_version=1 AND status='active'
      AND supports_json_schema=true AND 'structured-generation'=ANY(task_classes)) AS private_models,
    (SELECT count(*)::int FROM agent_provider_models WHERE provider='deepseek'
      AND model_id='deepseek-flash' AND catalog_version=2 AND status='active'
      AND config_json->>'admissionScope'='agent-blog-public-runtime') AS public_models,
    (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1) AS runs,
    (SELECT count(*)::int FROM agent_provider_calls call
      JOIN agent_run_actions action ON action.id=call.action_id
      JOIN agent_runs run ON run.id=action.run_id WHERE run.agent_user_id=$1) AS provider_calls,
    (SELECT count(*)::int FROM blog_articles WHERE author_user_id=$1) AS articles`,
  [account.agentUserId])).rows[0];
  assert.deepEqual(counts, { workflows: 2, tools: 4, private_models: 1, public_models: 1,
    runs: 0, provider_calls: 0, articles: 0 });
});
