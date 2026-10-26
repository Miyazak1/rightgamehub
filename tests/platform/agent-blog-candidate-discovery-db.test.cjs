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
      createAgentBlogCandidateDiscoveryCanary, createAgentBlogAutonomousCandidateDiscoveryHandlers,
      createAgentBlogAutonomousDiscoveryCanary, BLOG_DISCOVERY_RESPONSE_SCHEMAS } =
      await harness.load('agent-blog-candidate-discovery.mjs');
    const { defaultAgentBehaviorProfile } = await harness.load('agent-behavior-profile.mjs');
    const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
    const { createAgentProviderGateway } = await harness.load('agent-provider-gateway.mjs');
    const { createAgentSecretVault } = await harness.load('agent-secret-vault.mjs');
    const { createAgentRuntimeReadService } = await harness.load('agent-runtime-read-service.mjs');
    const { createAgentBlogCandidateDraftHandoffCanary } =
      await harness.load('agent-blog-candidate-handoff.mjs');
    const { createAgentBlogCanaryObservabilityService } =
      await harness.load('agent-blog-canary-observability.mjs');
    const { loadAgentBlogPrivateCanaryConfig, PostgresAgentBlogPrivateCanaryPreflightRepository,
      runAgentBlogPrivateCanaryPreflight } = await harness.load('agent-blog-private-canary-preflight.mjs');
    const { PostgresAgentBlogCanaryAcceptanceRepository,
      createAgentBlogCanaryAcceptanceService } = await harness.load('agent-blog-canary-acceptance.mjs');

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

    const governance = new PostgresAgentProviderGatewayRepository(admin, {
      agentMonthlyLimits: { providerCalls: 10, inputTokens: 50000, outputTokens: 10000, costMicrousd: 10000000 },
      platformMonthlyLimits: { providerCalls: 100, inputTokens: 500000, outputTokens: 100000, costMicrousd: 100000000 },
    });
    await governance.registerModel({ provider: 'deepseek', modelId: 'fixture-discovery', catalogVersion: 1,
      status: 'active', taskClasses: ['structured-generation'], supportsJsonSchema: true,
      maxInputTokens: 10000, maxOutputTokens: 1200, inputPriceMicrousdPerMillion: 1000000,
      outputPriceMicrousdPerMillion: 2000000, config: { fixture: true } });
    const vault = createAgentSecretVault({ masterKey: 'de'.repeat(32) });
    const encrypted = vault.encrypt(account.agentUserId, 'deepseek', 'fixture-discovery-secret');
    await admin.query(`INSERT INTO agent_provider_secrets(
      agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id
    ) VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`, [account.agentUserId, encrypted.ciphertext,
      encrypted.nonce, encrypted.authTag, encrypted.fingerprint, encrypted.lastFour, operatorId]);
    let providerInvocations = 0;
    const providerGateway = createAgentProviderGateway({ runtimeRepository: runtime,
      governanceRepository: governance, policyService: createAgentRuntimePolicyService({ pool: admin }),
      secretVault: vault, responseSchemas: BLOG_DISCOVERY_RESPONSE_SCHEMAS,
      adapters: { deepseek: async () => {
        providerInvocations += 1;
        return { providerRequestId: `fixture:${crypto.randomUUID()}`, output: {
          queries: ['agent tool'],
          rationale: '选题范围关注可以快速体验的人工智能工具，因此先用普通关键词寻找具有明确用途和可观察结果的项目。',
          interestSignals: ['可以快速体验'],
        }, responseRef: {}, usage: { providerCalls: 1, inputTokens: 200, outputTokens: 80, costMicrousd: 2 } };
      } },
    });
    const autonomousCanary = createAgentBlogAutonomousDiscoveryCanary({ runtimeRepository: runtime, enabled: true });
    const autonomousWorkflow = await autonomousCanary.register(operatorId);
    const autonomousHandlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({
      providerGateway, toolGateway: gateway, artifactRepository,
    });
    const autonomousRun = await autonomousCanary.createRun({ agentUserId: account.agentUserId,
      idempotencyKey: `autonomous-discovery:${crypto.randomUUID()}`,
      config: { model: { provider: 'deepseek', modelId: 'fixture-discovery' } }, input: {
        schemaVersion: 'blog-project-discovery-input-v2', topicScope: '寻找可快速体验的开源人工智能工具',
        searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: '2026-01-01',
          maxCandidates: 8, maxQueries: 3 }, previousRepositoryUrls: [],
        behaviorProfile: defaultAgentBehaviorProfile(),
      } });
    const autonomousWorker = createAgentRuntimeWorker({ repository: runtime, handlers: autonomousHandlers,
      workerId: `autonomous-discovery-${crypto.randomBytes(4).toString('hex')}`,
      leaseSeconds: 30, heartbeatSeconds: 5 });
    for (let index = 0; index < autonomousWorkflow.stages.length; index += 1) {
      const result = await autonomousWorker.runOnce();
      assert.equal(result.status, 'completed', JSON.stringify(result));
    }
    assert.equal(providerInvocations, 1);
    const autonomousStored = (await admin.query('SELECT * FROM agent_runs WHERE id=$1', [autonomousRun.id])).rows[0];
    assert.equal(autonomousStored.status, 'succeeded');
    assert.equal(autonomousStored.output_type, 'blog.candidate-set');
    const lineage = (await admin.query(`SELECT artifact_key,action_id,source_tool_artifact_ids,source_stage_artifact_ids
      FROM agent_runtime_stage_artifacts WHERE run_id=$1 ORDER BY created_at,id`, [autonomousRun.id])).rows;
    const plan = lineage.find(item => item.artifact_key === 'blog.discovery-plan');
    const candidates = lineage.find(item => item.artifact_key === 'blog.candidate-set');
    assert.equal(plan.action_id == null, false);
    assert.deepEqual(plan.source_tool_artifact_ids, []);
    assert.deepEqual(plan.source_stage_artifact_ids, []);
    assert.deepEqual(candidates.source_stage_artifact_ids, [
      (await admin.query(`SELECT id FROM agent_runtime_stage_artifacts
        WHERE run_id=$1 AND artifact_key='blog.discovery-plan'`, [autonomousRun.id])).rows[0].id,
    ]);
    assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_blog_foundation_drafts WHERE run_id=$1',
      [autonomousRun.id])).rows[0].n), 0);
    const handoffCanary = createAgentBlogCandidateDraftHandoffCanary({
      runtimeRepository: runtime, artifactRepository, enabled: true,
    });
    await handoffCanary.register(operatorId);
    const handoffRequest = {
      agentUserId: account.agentUserId,
      discoveryRunId: autonomousRun.id,
      discoveryArtifactId: autonomousStored.output_id,
      idempotencyKey: `candidate-handoff:${crypto.randomUUID()}`,
      behaviorProfile: defaultAgentBehaviorProfile(),
      config: { model: { provider: 'deepseek', modelId: 'fixture-discovery' } },
    };
    const draftRun = await handoffCanary.createDraftRun(handoffRequest);
    assert.equal((await handoffCanary.createDraftRun(handoffRequest)).id, draftRun.id);
    const handoff = (await admin.query('SELECT * FROM agent_run_handoffs WHERE target_run_id=$1',
      [draftRun.id])).rows[0];
    assert.equal(handoff.source_run_id, autonomousRun.id);
    assert.equal(handoff.source_artifact_id, autonomousStored.output_id);
    assert.equal(handoff.source_content_sha256,
      (await artifactRepository.read({ runId: autonomousRun.id,
        artifactId: autonomousStored.output_id })).contentSha256);
    assert.equal((await admin.query('SELECT input_json FROM agent_runs WHERE id=$1', [draftRun.id]))
      .rows[0].input_json.candidateRepositories[0], 'https://github.com/owner/project');
    const targetTimeline = await createAgentRuntimeReadService({ pool: admin,
      authorizeOperator: async () => true }).timeline({ userId: operatorId }, account.agentUserId, draftRun.id);
    assert.equal(targetTimeline.handoffs.incoming.length, 1);
    assert.equal(targetTimeline.handoffs.incoming[0].sourceRunId, autonomousRun.id);
    assert.equal(Object.hasOwn(targetTimeline.handoffs.incoming[0], 'content'), false);
    await assert.rejects(admin.query('UPDATE agent_run_handoffs SET handoff_kind=$2 WHERE id=$1',
      [handoff.id, 'blog.changed']));
    await assert.rejects(runtime.createRun({
      agentUserId: account.agentUserId, workflowKey: 'blog.project.single.draft-shadow', workflowVersion: 1,
      triggerKind: 'system', idempotencyKey: handoffRequest.idempotencyKey,
      input: (await admin.query('SELECT input_json FROM agent_runs WHERE id=$1', [draftRun.id])).rows[0].input_json,
      config: handoffRequest.config,
    }), error => error.code === 'AGENT_RUN_IDEMPOTENCY_CONFLICT');
    const summary = await createAgentBlogCanaryObservabilityService({ pool: admin,
      authorizeOperator: async () => true }).summary({ userId: operatorId }, account.agentUserId);
    assert.equal(summary.discovery.total, 2);
    assert.equal(summary.discovery.succeeded, 2);
    assert.equal(summary.discovery.awaitingHandoff, 1);
    assert.equal(summary.handoffs.total, 1);
    assert.equal(summary.drafts.active, 1);
    assert.equal(summary.drafts.succeeded, 0);
    assert.equal(summary.usage.providerCalls, 1);
    assert.equal(summary.usage.toolCalls, 2);
    await admin.query(`UPDATE agent_run_stages SET status='cancelled',finished_at=now(),
      error_code='TEST_CANARY_CLEANUP',error_message='Unexecuted handoff fixture cleanup.',updated_at=now()
      WHERE run_id=$1 AND status IN ('blocked','queued')`, [draftRun.id]);
    await admin.query(`UPDATE agent_runs SET status='cancelled',finished_at=now(),
      error_code='TEST_CANARY_CLEANUP',error_message='Unexecuted handoff fixture cleanup.',updated_at=now()
      WHERE id=$1 AND status='queued'`, [draftRun.id]);
    const acceptance = createAgentBlogCanaryAcceptanceService({
      repository: new PostgresAgentBlogCanaryAcceptanceRepository(admin),
    });
    const failedReport = await acceptance.attest(account.agentUserId, draftRun.id);
    assert.equal(failedReport.verdict, 'failed');
    assert.equal(failedReport.recommendation, 'stop-and-investigate');
    assert(failedReport.reasonCodes.includes('DRAFT_NOT_SUCCEEDED'));
    assert(failedReport.reasonCodes.includes('DRAFT_NOT_PRIVATE'));
    assert.equal((await acceptance.attest(account.agentUserId, draftRun.id)).existing, true);
    const storedReport = (await admin.query(`SELECT evidence_json FROM agent_blog_canary_acceptance_reports
      WHERE id=$1`, [failedReport.id])).rows[0];
    assert.equal(Object.hasOwn(storedReport.evidence_json, 'content'), false);
    await assert.rejects(admin.query(`UPDATE agent_blog_canary_acceptance_reports
      SET verdict='passed',reason_codes='{}' WHERE id=$1`, [failedReport.id]));
    assert.equal((await acceptance.readiness(account.agentUserId)).automaticScheduleChange, false);
    const preflightConfig = loadAgentBlogPrivateCanaryConfig({
      AGENT_BLOG_PRIVATE_CANARY_ENABLED: 'true',
      AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID: account.agentUserId,
      AGENT_BLOG_PRIVATE_CANARY_MODEL_ID: 'fixture-discovery',
      AGENT_BLOG_PRIVATE_CANARY_DAILY_RUN_LIMIT: '4',
      AGENT_BLOG_PRIVATE_CANARY_MONTHLY_PROVIDER_CALL_LIMIT: '100',
      AGENT_BLOG_PRIVATE_CANARY_MONTHLY_COST_MICROUSD_LIMIT: '100000000',
      AGENT_BLOG_PRIVATE_CANARY_FAILURE_THRESHOLD: '2',
    });
    const preflight = await runAgentBlogPrivateCanaryPreflight({
      repository: new PostgresAgentBlogPrivateCanaryPreflightRepository(admin), config: preflightConfig,
    });
    assert.equal(preflight.ready, false);
    assert.deepEqual(preflight.blockers, ['AGENT_BLOG_PRIVATE_CANARY_AWAITING_HANDOFF']);
    assert.equal(preflight.observed.activeRuns, 0);
    assert.equal(preflight.observed.providerCallsMonth, 1);
    await autonomousWorker.stop();
    await admin.end();
  });
