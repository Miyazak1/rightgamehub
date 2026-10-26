const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('candidate discovery Run is read-only, bounded, and produces no article evidence or draft',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
    const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
    const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
    const { createAgentRuntimeWorker } = await harness.load('agent-runtime-worker.mjs');
    const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
    const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
    const { createAgentToolGateway } = await harness.load('agent-tool-gateway.mjs');
    const { GITHUB_REPOSITORY_SEARCH_TOOL, validateGitHubRepositorySearchInput,
      validateGitHubRepositorySearchOutput } = await harness.load('agent-github-repository-search-tool.mjs');
    const { PostgresAgentRuntimeStageArtifactRepository } = await harness.load('agent-runtime-stage-artifact-repository.mjs');
    const { createAgentBlogCandidateDiscoveryHandlers,
      createAgentBlogCandidateDiscoveryCanary } = await harness.load('agent-blog-candidate-discovery.mjs');
    const { createAgentRuntimeReadService } = await harness.load('agent-runtime-read-service.mjs');

    const operatorId = crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Discovery operator','admin')", [operatorId]);
    const accounts = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
      authorizeOperator: async () => true });
    const account = await accounts.provision({ userId: operatorId }, {
      provisionKey: `discovery-${crypto.randomUUID()}`, displayName: '小墨鱼',
      handle: `discovery-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
      operatorLabel: 'Discovery canary', capabilities: ['blog:auto-publish'], metadata: {},
    });
    const runtime = new PostgresAgentRuntimeRepository(admin);
    const canary = createAgentBlogCandidateDiscoveryCanary({ runtimeRepository: runtime, enabled: true });
    const workflow = await canary.register(operatorId);
    const toolRepository = new PostgresAgentToolGatewayRepository(admin);
    await toolRepository.registerTool(GITHUB_REPOSITORY_SEARCH_TOOL);
    const output = {
      schemaVersion: 'github-repository-search-v1',
      query: { text: 'agent tool', sort: 'stars', minStars: 10, pushedAfter: '2026-01-01' },
      source: { canonicalUri: 'https://api.github.com/search/repositories?q=agent+tool',
        fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'a'.repeat(64) },
      candidates: [{ key: 'owner/project', canonicalUrl: 'https://github.com/owner/project',
        owner: 'owner', name: 'project', description: 'A useful tool', stars: 100, forks: 8,
        language: 'TypeScript', topics: ['agent'], licenseSpdx: 'MIT', pushedAt: '2026-10-25T00:00:00.000Z' }],
    };
    const gateway = createAgentToolGateway({ runtimeRepository: runtime, toolRepository,
      policyService: createAgentRuntimePolicyService({ pool: admin }),
      adapters: { 'research.github.repository.search@1': async () => ({
        receiptId: 'github-search:fixture', output,
        responseRef: { canonicalUri: output.source.canonicalUri, contentSha256: output.source.contentSha256 },
        usage: { toolCalls: 1, networkRequests: 1, candidates: 1 },
      }) },
      inputSchemas: { 'github.repository.search.input@1': validateGitHubRepositorySearchInput },
      outputSchemas: { 'github.repository.search.output@1': validateGitHubRepositorySearchOutput },
    });
    const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(admin);
    const handlers = createAgentBlogCandidateDiscoveryHandlers({ toolGateway: gateway, artifactRepository });
    const run = await canary.createRun({ agentUserId: account.agentUserId,
      idempotencyKey: `discovery:${crypto.randomUUID()}`, input: {
        schemaVersion: 'blog-project-discovery-input-v1', topicScope: '寻找开源人工智能工具',
        queries: ['agent tool'], sort: 'stars', minStars: 10, pushedAfter: '2026-01-01',
        maxCandidates: 8, previousRepositoryUrls: [],
      } });
    const worker = createAgentRuntimeWorker({ repository: runtime, handlers,
      workerId: `discovery-${crypto.randomBytes(4).toString('hex')}`, leaseSeconds: 30, heartbeatSeconds: 5 });
    for (let index = 0; index < workflow.stages.length; index += 1) {
      assert.equal((await worker.runOnce()).status, 'completed');
    }
    const stored = (await admin.query('SELECT * FROM agent_runs WHERE id=$1', [run.id])).rows[0];
    assert.equal(stored.status, 'succeeded');
    assert.equal(stored.output_type, 'blog.candidate-set');
    assert.equal(Number((await admin.query(`SELECT count(*)::int AS n FROM agent_run_actions
      WHERE run_id=$1 AND action_kind='tool' AND capability_key='research.github.discover'`, [run.id])).rows[0].n), 1);
    assert.equal(Number((await admin.query(`SELECT count(*)::int AS n FROM agent_provider_calls call
      JOIN agent_run_actions action ON action.id=call.action_id WHERE action.run_id=$1`, [run.id])).rows[0].n), 0);
    assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_blog_foundation_drafts WHERE run_id=$1',
      [run.id])).rows[0].n), 0);
    const artifact = (await admin.query(`SELECT content_json FROM agent_runtime_stage_artifacts
      WHERE id=$1 AND artifact_key='blog.candidate-set'`, [stored.output_id])).rows[0];
    assert.equal(artifact.content_json.candidates[0].key, 'owner/project');
    assert.equal(Object.hasOwn(artifact.content_json.candidates[0], 'readme'), false);
    const timeline = await createAgentRuntimeReadService({ pool: admin, authorizeOperator: async () => true })
      .timeline({ userId: operatorId }, account.agentUserId, run.id);
    assert.equal(timeline.run.outputType, 'blog.candidate-set');
    assert.equal(timeline.toolCalls.length, 1);
    assert.equal(Object.hasOwn(timeline.stageArtifacts[0], 'content'), false);
    await worker.stop();
    await admin.end();
  });
