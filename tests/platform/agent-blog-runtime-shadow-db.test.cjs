const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('passive blog shadow projection is durable, replay-safe, and side-effect free', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentBlogRuntimeShadowRepository, createAgentBlogRuntimeShadowProjector } = await harness.load('agent-blog-runtime-shadow.mjs');
  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Shadow operator','admin')", [operatorId]);
  const accounts = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true });
  const account = await accounts.provision({ userId: operatorId }, {
    provisionKey: `shadow-${crypto.randomUUID()}`, displayName: 'Shadow Agent',
    handle: `shadow-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手', operatorLabel: 'Shadow test',
    capabilities: ['blog:auto-publish'], metadata: {},
  });
  const profileId = (await admin.query('SELECT active_profile_id FROM agent_behavior_profile_assignments WHERE agent_user_id=$1', [account.agentUserId])).rows[0].active_profile_id;
  const legacyRunId = crypto.randomUUID();
  await admin.query(`INSERT INTO agent_blog_runs(
      id,agent_user_id,requested_by_user_id,trigger_kind,status,model,topic_scope,behavior_profile_id
    ) VALUES($1,$2,$3,'manual','queued','deepseek-flash',$4,$5)`,
  [legacyRunId, account.agentUserId, operatorId, '有趣、有用且证据完整的开源人工智能项目', profileId]);

  const repository = new PostgresAgentBlogRuntimeShadowRepository(admin);
  const projector = createAgentBlogRuntimeShadowProjector({ repository });
  assert.equal((await projector.projectRun(legacyRunId)).changed, true);
  assert.equal((await projector.projectRun(legacyRunId)).changed, false);
  assert.deepEqual((await admin.query(`SELECT projection_mode,runtime_run_id,provider_owner,publish_owner,
      source_status,mapped_run_status,mapped_stage_status,parity_status
    FROM agent_blog_runtime_shadow_projections WHERE legacy_run_id=$1`, [legacyRunId])).rows[0], {
    projection_mode: 'passive', runtime_run_id: null, provider_owner: 'legacy', publish_owner: 'legacy',
    source_status: 'queued', mapped_run_status: 'queued', mapped_stage_status: 'queued', parity_status: 'exact',
  });
  assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_blog_runtime_shadow_events WHERE legacy_run_id=$1', [legacyRunId])).rows[0].n), 1);
  assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1', [account.agentUserId])).rows[0].n), 0);
  assert.equal(Number((await admin.query(`SELECT count(*)::int AS n FROM agent_provider_calls call
    JOIN agent_run_actions action ON action.id=call.action_id
    JOIN agent_runs run ON run.id=action.run_id WHERE run.agent_user_id=$1`, [account.agentUserId])).rows[0].n), 0);

  await admin.query("UPDATE agent_blog_runs SET status='generating',started_at=now(),updated_at=now() WHERE id=$1", [legacyRunId]);
  await projector.projectRun(legacyRunId);
  await admin.query("UPDATE agent_blog_runs SET status='rejected',reason_codes=ARRAY['MODEL_REVIEW_REJECTED'],finished_at=now(),updated_at=now() WHERE id=$1", [legacyRunId]);
  await projector.projectRun(legacyRunId);
  assert.deepEqual((await admin.query(`SELECT source_status,mapped_run_status,mapped_stage_status,parity_status
    FROM agent_blog_runtime_shadow_projections WHERE legacy_run_id=$1`, [legacyRunId])).rows[0], {
    source_status: 'rejected', mapped_run_status: 'rejected', mapped_stage_status: 'failed', parity_status: 'exact',
  });
  assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_blog_runtime_shadow_events WHERE legacy_run_id=$1', [legacyRunId])).rows[0].n), 3);
  await assert.rejects(admin.query('DELETE FROM agent_blog_runtime_shadow_events WHERE legacy_run_id=$1', [legacyRunId]), /append-only/u);
});
