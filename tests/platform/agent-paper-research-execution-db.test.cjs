const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

const crossref = message => new Response(JSON.stringify({ message }), {
  status: 200, headers: { 'content-type': 'application/json' },
});

test('R1.8 execution is idempotent, single-active, cancellable and auditable in PostgreSQL',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    try {
      const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
      const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
      const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
      const { createAgentPaperDiscoveryService } = await harness.load('agent-paper-discovery-service.mjs');
      const { createAgentPaperResearchExecutionService } =
        await harness.load('agent-paper-research-execution.mjs');
      const operatorId = crypto.randomUUID();
      await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'R1.8 operator','admin')",
        [operatorId]);
      const account = await createAgentAccountService({
        repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true,
      }).provision({ userId: operatorId }, {
        provisionKey: `r18-${crypto.randomUUID()}`, displayName: 'R1.8 paper agent',
        handle: `r18-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
        operatorLabel: 'DB test', capabilities: ['blog:auto-publish'], metadata: {},
      });
      const discovery = createAgentPaperDiscoveryService({ pool: admin,
        authorizeOperator: async () => true, fetchImpl: async () => crossref({
          title: ['Recoverable Paper Execution'], author: [{ given: 'Ada', family: 'Example' }],
          issued: { 'date-parts': [[2026]] }, 'container-title': ['Fixture Journal'],
          type: 'journal-article',
        }) });
      const discovered = await discovery.discover({ userId: operatorId }, account.agentUserId, {
        kind: 'doi', doi: '10.5555/r18-execution', requestId: crypto.randomUUID(),
      });
      const queueItemId = discovered.candidates[0].queue.id;
      const service = createAgentPaperResearchExecutionService({ pool: admin,
        runtimeRepository: new PostgresAgentRuntimeRepository(admin), authorizeOperator: async () => true });
      const requestId = crypto.randomUUID();
      const first = await service.start({ userId: operatorId }, account.agentUserId, queueItemId,
        { requestId });
      assert.equal(first.status, 'running');
      assert.equal((await service.start({ userId: operatorId }, account.agentUserId, queueItemId,
        { requestId })).id, first.id);
      await assert.rejects(service.start({ userId: operatorId }, account.agentUserId, queueItemId,
        { requestId: crypto.randomUUID() }), error => error.code === 'PAPER_RESEARCH_EXECUTION_BUSY');
      const cancelled = await service.cancel({ userId: operatorId }, account.agentUserId, first.id,
        'R1.8 database cancellation test');
      assert.equal(cancelled.status, 'cancelled');
      const retried = await service.retry({ userId: operatorId }, account.agentUserId, first.id,
        { requestId: crypto.randomUUID() });
      assert.equal(retried.status, 'running');
      assert.equal(retried.attemptNumber, 2);
      assert.equal((await service.list({ userId: operatorId }, account.agentUserId)).length, 2);
      const event = (await admin.query(`SELECT id FROM agent_paper_research_execution_events
        WHERE execution_id=$1 ORDER BY created_at LIMIT 1`, [first.id])).rows[0];
      await assert.rejects(admin.query(`UPDATE agent_paper_research_execution_events
        SET payload_json='{}' WHERE id=$1`, [event.id]), /immutable/u);
      await assert.rejects(admin.query('DELETE FROM agent_paper_research_executions WHERE id=$1',
        [first.id]), /immutable/u);
    } finally {
      await admin.end();
    }
  });

for (const failureCount of [1, 2, 3]) {
  test(`arXiv acquisition in PostgreSQL: ${failureCount} retryable failure(s) then ${failureCount < 3 ? 'success' : 'bounded exhaustion'}`,
    { skip: !harness.enabled }, async () => {
      const { admin } = await harness.setup();
      try {
        const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
        const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
        const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
        const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
        const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
        const { createAgentToolGateway } = await harness.load('agent-tool-gateway.mjs');
        const { ARXIV_PAPER_READ_TOOL: contract, createArxivPaperReadAdapter,
          validateArxivPaperReadInput, validateArxivPaperReadOutput } = await harness.load('agent-arxiv-paper-tool.mjs');
        const { PostgresAgentResearchEvidenceRepository } = await harness.load('agent-research-evidence-repository.mjs');
        const { createAgentPaperDiscoveryService } = await harness.load('agent-paper-discovery-service.mjs');
        const { createAgentPaperResearchExecutionService, createAgentPaperResearchExecutionHandlers,
          PAPER_RESEARCH_EXECUTION_WORKFLOW: workflow } = await harness.load('agent-paper-research-execution.mjs');
        const { PAPER_SEMANTIC_WORKFLOW_KEY } = await harness.load('agent-paper-semantic-contracts.mjs');
        const operatorId = crypto.randomUUID();
        await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Retry regression','admin')", [operatorId]);
        const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
          authorizeOperator: async () => true }).provision({ userId: operatorId }, {
          provisionKey: `retry-${crypto.randomUUID()}`, displayName: 'Retry regression',
          handle: `retry-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
          operatorLabel: 'isolated test', capabilities: ['blog:auto-publish'], metadata: {},
        });
        const xml = '<feed><entry><id>http://arxiv.org/abs/2601.01234v1</id>' +
          '<title>Isolated Retry Fixture</title><author><name>Ada Example</name></author>' +
          '<published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated>' +
          '<summary>Offline fixture.</summary></entry></feed>';
        const discovery = createAgentPaperDiscoveryService({ pool: admin, authorizeOperator: async () => true,
          fetchImpl: async () => new Response(xml, { status: 200,
            headers: { 'content-type': 'application/atom+xml' } }) });
        const discovered = await discovery.discover({ userId: operatorId }, account.agentUserId,
          { kind: 'arxiv', arxivId: '2601.01234v1', requestId: crypto.randomUUID() });
        const runtime = new PostgresAgentRuntimeRepository(admin);
        // A pre-existing immutable v1 must coexist with the new retry budget in v2.
        const legacy = structuredClone(workflow);
        legacy.workflowVersion = 1;
        legacy.defaultBudget.toolCalls = 1;
        await runtime.registerWorkflow({ actorUserId: operatorId, manifest: legacy });
        if ((await admin.query(`SELECT status FROM agent_workflow_definitions
          WHERE workflow_key=$1 AND workflow_version=1`, [workflow.workflowKey])).rows[0].status === 'draft') {
          await runtime.activateWorkflow(workflow.workflowKey, 1);
        }
        const service = createAgentPaperResearchExecutionService({ pool: admin, runtimeRepository: runtime,
          authorizeOperator: async () => true });
        const execution = await service.start({ userId: operatorId }, account.agentUserId,
          discovered.candidates[0].queue.id, { requestId: crypto.randomUUID() });
        const tools = new PostgresAgentToolGatewayRepository(admin);
        await tools.registerTool(contract);
        let dispatches = 0, metadataRequests = 0, pdfRequests = 0;
        const adapter = createArxivPaperReadAdapter({ contactEmail: 'research@example.com',
          fetchImpl: async url => {
            if (String(url).startsWith('https://export.arxiv.org/')) {
              metadataRequests++;
              return new Response(xml, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
            }
            assert.equal(String(url), 'https://arxiv.org/pdf/2601.01234v1');
            pdfRequests++;
            return new Response(Buffer.from('%PDF-offline-fixture'), { status: 200,
              headers: { 'content-type': 'application/pdf' } });
          },
          pdfLoader: () => ({ promise: Promise.resolve({ numPages: 1,
            getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }),
              getTextContent: async () => ({ items: [{ str: 'A bounded reproducible experiment reports measured evidence.' }] }),
              cleanup() {} }), destroy: async () => {} }), destroy: async () => {} }),
        });
        const gateway = createAgentToolGateway({ runtimeRepository: runtime, toolRepository: tools,
          policyService: createAgentRuntimePolicyService({ pool: admin }),
          adapters: { [`${contract.toolKey}@${contract.contractVersion}`]: async input => {
            dispatches++;
            if (dispatches <= failureCount) throw Object.assign(new Error('offline upstream timeout'),
              { code: 'FIXTURE_ARXIV_TIMEOUT', retryable: true });
            return adapter(input);
          } },
          inputSchemas: { 'paper.arxiv.read.input@1': validateArxivPaperReadInput },
          outputSchemas: { 'paper.arxiv.read.output@2': validateArxivPaperReadOutput },
        });
        const semanticHandlers = Object.fromEntries(['verify-eligibility', 'reconstruct-sections',
          'extract-semantics', 'verify-semantics', 'persist-analysis'].map(key =>
          [`${PAPER_SEMANTIC_WORKFLOW_KEY}:${key}`, async () => { throw Error('UNEXPECTED_SEMANTIC_CALL'); }]));
        const handlers = createAgentPaperResearchExecutionHandlers({ pool: admin, toolGateway: gateway,
          semanticHandlers, evidenceRepository: new PostgresAgentResearchEvidenceRepository(admin) });
        const claim = async () => {
          const stage = await runtime.claimNextStage('retry-regression', 60, Object.keys(handlers), execution.runtimeRunId);
          assert.ok(stage);
          const args = { stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken };
          await runtime.startStage(args);
          return { stage, args, context: await runtime.loadStageExecutionContext(args) };
        };
        const resolve = await claim();
        assert.equal(resolve.stage.stageKey, 'resolve-source');
        const source = await handlers[`${workflow.workflowKey}:resolve-source`](resolve.context, resolve.args);
        await runtime.completeStage({ ...resolve.args, outputRef: source.outputRef });
        const acquire = handlers[`${workflow.workflowKey}:acquire-source`];
        let stageId, successfulVersionId;
        const attempts = Math.min(failureCount + 1, 3);
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const current = await claim();
          assert.equal(current.stage.stageKey, 'acquire-source');
          assert.equal(current.context.stage.attempt, attempt);
          stageId ??= current.stage.id;
          assert.equal(current.stage.id, stageId);
          if (attempt <= failureCount) {
            await assert.rejects(acquire(current.context, current.args),
              error => error.code === 'FIXTURE_ARXIV_TIMEOUT' && error.retryable && !error.uncertain);
            if (attempt === 3) {
              // Even an extra direct gateway invocation cannot exceed the bounded run budget.
              await assert.rejects(gateway.invoke({ runId: execution.runtimeRunId, stageId,
                ...current.args, action: { actionKey: 'budget-probe', actionKind: 'tool',
                  capabilityKey: 'research.paper.read', contractVersion: 2, riskLevel: 'L1' },
                idempotencyKey: 'budget-probe', resource: { type: 'paper.arxiv', owner: 'public', id: '2601.01234v1' },
                tool: { toolKey: contract.toolKey, contractVersion: 2 }, request: { paper: '2601.01234v1' } }),
              error => error.code === 'AGENT_RUN_TOOL_BUDGET_EXCEEDED');
            }
            const failed = await runtime.failStage({ ...current.args, errorCode: 'FIXTURE_ARXIV_TIMEOUT',
              errorMessage: 'offline fixture', retryable: true, backoffSeconds: 0 });
            assert.equal(failed.retryScheduled, attempt < 3);
          } else {
            const acquired = await acquire(current.context, current.args);
            successfulVersionId = acquired.outputRef.paperVersionId;
            assert.ok(successfulVersionId);
            assert.equal(acquired.outputRef.mode, 'acquired-arxiv-open-fulltext');
            assert.ok(acquired.outputRef.evidenceCount > 0);
            // Replay passes through the real gateway and archive with no new tool call or evidence chain.
            const replay = await acquire(current.context, current.args);
            assert.deepEqual(replay, acquired);
            assert.equal(dispatches, attempt);
            await runtime.completeStage({ ...current.args, outputRef: acquired.outputRef });
          }
        }
        const actions = (await admin.query(`SELECT idempotency_key,status FROM agent_run_actions
          WHERE stage_id=$1 AND action_key='acquire-arxiv-open-fulltext' ORDER BY created_at,id`, [stageId])).rows;
        assert.equal(actions.length, attempts);
        for (let i = 0; i < attempts; i++) {
          assert.equal(actions[i].idempotency_key, `paper-research-acquire:${execution.runtimeRunId}:${i + 1}`);
          assert.equal(actions[i].status, i < failureCount ? 'failed' : 'succeeded');
        }
        const run = (await admin.query('SELECT workflow_version,budget_json,usage_json,status FROM agent_runs WHERE id=$1',
          [execution.runtimeRunId])).rows[0];
        assert.equal(run.workflow_version, 3);
        assert.equal(run.budget_json.toolCalls, 3);
        assert.equal(run.budget_json.providerCalls, 1);
        assert.equal(run.usage_json.toolCalls, attempts);
        assert.equal(dispatches, attempts);
        const counts = (await admin.query(`SELECT
          (SELECT count(*)::int FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
            WHERE action.run_id=$1) AS calls,
          (SELECT count(*)::int FROM agent_research_artifact_bindings WHERE run_id=$1) AS archives,
          (SELECT count(*)::int FROM agent_paper_versions version JOIN agent_paper_identities identity
            ON identity.id=version.paper_identity_id WHERE identity.agent_user_id=$2) AS versions,
          (SELECT count(*)::int FROM blog_articles WHERE author_user_id=$2) AS articles`,
        [execution.runtimeRunId, account.agentUserId])).rows[0];
        assert.deepEqual(counts, { calls: attempts, archives: failureCount < 3 ? 1 : 0,
          versions: failureCount < 3 ? 1 : 0, articles: 0 });
        if (failureCount === 3) {
          assert.equal(run.status, 'failed');
          assert.equal(await runtime.claimNextStage('retry-regression', 60, Object.keys(handlers), execution.runtimeRunId), null);
          assert.equal(metadataRequests, 0);
          assert.equal(pdfRequests, 0);
        } else {
          const stored = (await admin.query(`SELECT paper_version_id,access_level FROM agent_paper_research_executions
            WHERE id=$1`, [execution.id])).rows[0];
          assert.equal(stored.paper_version_id, successfulVersionId);
          assert.equal(stored.access_level, 'fulltext-open');
          assert.equal(metadataRequests, 1);
          assert.equal(pdfRequests, 1);
          const unlocked = (await admin.query(`SELECT status FROM agent_run_stages
            WHERE run_id=$1 AND stage_key='verify-eligibility'`, [execution.runtimeRunId])).rows[0];
          assert.equal(unlocked.status, 'queued');
        }
        const old = (await admin.query(`SELECT manifest_json FROM agent_workflow_definitions
          WHERE workflow_key=$1 AND workflow_version=1`, [workflow.workflowKey])).rows[0];
        assert.equal(old.manifest_json.defaultBudget.toolCalls, 1);
      } finally { await admin.end(); }
    });
}
