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
