const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('public preflight checks the workflows actually installed by bootstrap across upgrades', { skip: !harness.enabled }, async t => {
  const { admin } = await harness.setup();
  t.after(() => admin.end());
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
  const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
  const { createAgentBlogPublicRuntimeBootstrap } = await harness.load('agent-blog-public-runtime-bootstrap.mjs');
  const { PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository } = await harness.load('agent-blog-private-canary-bootstrap.mjs');
  const { loadAgentBlogPublicRuntimeConfig, PostgresAgentBlogPublicRuntimePreflightRepository,
    runAgentBlogPublicRuntimePreflight } = await harness.load('agent-blog-public-runtime-preflight.mjs');
  const { BLOG_PROJECT_SINGLE_WORKFLOW: article, BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW: discovery } =
    await harness.load('agent-blog-foundation-workflows.mjs');
  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Preflight operator','admin')", [operatorId]);
  const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
    authorizeOperator: async () => true }).provision({ userId: operatorId }, {
    provisionKey: 'public-preflight-' + crypto.randomUUID(), displayName: 'Preflight Agent',
    handle: 'preflight-' + crypto.randomBytes(5).toString('hex'), badgeLabel: 'AI 助手',
    operatorLabel: 'Preflight operator', capabilities: ['blog:auto-publish'], metadata: {},
  });
  const config = loadAgentBlogPublicRuntimeConfig({ AGENT_BLOG_PUBLIC_RUNTIME_ENABLED: 'true',
    AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID: account.agentUserId,
    AGENT_GITHUB_RESEARCH_TOKEN: 'synthetic-local-preflight-token' });
  const repository = new PostgresAgentRuntimeRepository(admin);
  const receipt = await createAgentBlogPublicRuntimeBootstrap({ config,
    identityRepository: new PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository(admin),
    runtimeRepository: repository, toolRepository: new PostgresAgentToolGatewayRepository(admin),
    providerRepository: new PostgresAgentProviderGatewayRepository(admin),
  }).run();
  const check = (pool = admin) => runAgentBlogPublicRuntimePreflight({
    repository: new PostgresAgentBlogPublicRuntimePreflightRepository(pool), config });
  const status = (manifest, value, pool = admin) => pool.query(
    'UPDATE agent_workflow_definitions SET status=$3 WHERE workflow_key=$1 AND workflow_version=$2',
    [manifest.workflowKey, manifest.workflowVersion, value]);
  const workflowBlocked = result => result.blockers.includes('AGENT_BLOG_PUBLIC_RUNTIME_WORKFLOWS_NOT_READY');

  await t.test('fresh bootstrap needs no obsolete workflow to pass workflow admission', async () => {
    assert.ok(receipt.workflows.some(w => w.workflowKey === article.workflowKey && w.workflowVersion === article.workflowVersion));
    const result = await check();
    assert.equal(result.observed.workflowCount, 2);
    assert.equal(workflowBlocked(result), false);
  });
  const legacy = { ...structuredClone(article), workflowVersion: 1, inputSchema: 'blog-project-single-input-v1' };
  await repository.registerWorkflow({ actorUserId: operatorId, manifest: legacy, status: 'active' });
  await t.test('coexisting old and current versions count as two required workflows', async () => {
    assert.equal((await check()).observed.workflowCount, 2);
  });
  await t.test('active legacy version cannot hide a retired current publication workflow', async () => {
    const client = await admin.connect();
    await client.query('BEGIN');
    try {
      await status(article, 'retired', client);
      const result = await check(client);
      assert.equal(result.observed.workflowCount, 1);
      assert.equal(workflowBlocked(result), true);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  await t.test('retiring legacy version does not disable current admission', async () => {
    await status(legacy, 'retired');
    assert.equal(workflowBlocked(await check()), false);
  });
  await t.test('paper workflows cannot substitute for missing GitHub discovery workflow', async () => {
    assert.ok(receipt.workflows.some(w => w.workflowKey.startsWith('paper.')));
    await status(discovery, 'retired');
    const result = await check();
    assert.equal(result.observed.workflowCount, 1);
    assert.equal(workflowBlocked(result), true);
  });
  const counts = (await admin.query(`SELECT
    (SELECT count(*)::int FROM agent_runs WHERE agent_user_id=$1) AS runs,
    (SELECT count(*)::int FROM agent_provider_calls call
      JOIN agent_run_actions action ON action.id=call.action_id
      JOIN agent_runs run ON run.id=action.run_id WHERE run.agent_user_id=$1) AS provider_calls,
    (SELECT count(*)::int FROM blog_articles WHERE author_user_id=$1) AS articles`, [account.agentUserId])).rows[0];
  assert.deepEqual(counts, { runs: 0, provider_calls: 0, articles: 0 });
});
