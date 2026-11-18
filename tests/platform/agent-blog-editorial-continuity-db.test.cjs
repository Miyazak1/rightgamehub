const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');
const { publicPipelineFixture } = require('./agent-blog-public-pipeline-db.test.cjs');

test('one durable agent publishes continuously, reselects, skips and replays without losing editorial history',
  { skip: !harness.enabled }, async t => {
    const continuity = { round: 0 };
    await publicPipelineFixture(t, { continuity, agentCallLimit: 40, afterPublication: async state => {
      const { admin, account, runner, config, result: first } = state;
      const { BLOG_PROJECT_SINGLE_WORKFLOW } = await harness.load('agent-blog-foundation-workflows.mjs');
      const operator = (await admin.query('SELECT operator_user_id FROM agent_accounts WHERE user_id=$1', [account.agentUserId])).rows[0].operator_user_id;
      const legacy = { ...BLOG_PROJECT_SINGLE_WORKFLOW, workflowVersion:2, outputSchema:'blog-article-output-v1' };
      const registered = await state.runtime.registerWorkflow({actorUserId:operator, manifest:legacy,status:'draft'});
      await state.runtime.activateWorkflow(legacy.workflowKey,legacy.workflowVersion);
      await state.runtime.registerWorkflow({actorUserId:operator,manifest:BLOG_PROJECT_SINGLE_WORKFLOW,status:'draft'});
      assert.equal((await admin.query(`SELECT manifest_sha256 FROM agent_workflow_definitions
        WHERE workflow_key=$1 AND workflow_version=2`,[legacy.workflowKey])).rows[0].manifest_sha256,registered.manifestSha256);
      assert.equal(BLOG_PROJECT_SINGLE_WORKFLOW.workflowVersion,3);
      config.dailyPublicationRunLimit = 4;
      const historyBefore = (await admin.query(`SELECT id,payload_json FROM agent_editorial_memory_events
        WHERE agent_user_id=$1 ORDER BY id`, [account.agentUserId])).rows;
      assert.ok(historyBefore.length > 0);
      const complete = state.runtime.completeStage.bind(state.runtime);
      let unsafeSkipChecked = false;
      state.runtime.completeStage = async input => {
        const stage = (await admin.query('SELECT stage_key,status FROM agent_run_stages WHERE id=$1', [input.stageId])).rows[0];
        if (!unsafeSkipChecked && stage.stage_key === 'select-subject') {
          await assert.rejects(complete({ ...input, runOutput: { type:'blog.publication-skipped', id:crypto.randomUUID() } }),
            error => error.code === 'AGENT_RUN_SKIP_INVALID');
          assert.equal((await admin.query('SELECT status FROM agent_run_stages WHERE id=$1', [input.stageId])).rows[0].status, 'running');
          unsafeSkipChecked = true;
        }
        return complete(input);
      };
      const outcomes = [first];
      for (const round of [1, 2, 3]) {
        continuity.round = round;
        const result = await runner.run({ requestId: crypto.randomUUID() });
        outcomes.push(result);
        assert.equal(result.publication.publicationState, round === 3 ? 'skipped' : 'published');
        const stages = (await admin.query(`SELECT stage_key,status FROM agent_run_stages
          WHERE run_id=$1 ORDER BY ordinal`, [result.publication.runId])).rows;
        if (round === 3) {
          assert.deepEqual(stages.slice(3).map(row => row.status), ['skipped','skipped','skipped','skipped']);
          assert.equal(result.publication.articleId, null);
          assert.equal(result.publicationAttempted, false);
          assert.equal((await admin.query("SELECT count(*)::int AS n FROM agent_run_actions WHERE run_id=$1 AND action_kind='provider'",
            [result.publication.runId])).rows[0].n, 2, 'only the two selection actions may run');
          assert.equal((await admin.query("SELECT count(*)::int AS n FROM agent_run_actions WHERE run_id=$1 AND action_kind='domain-write'",
            [result.publication.runId])).rows[0].n, 0);
        }
      }
      const publications = (await admin.query(`SELECT run_id,article_id FROM agent_blog_foundation_publications
        WHERE agent_user_id=$1`, [account.agentUserId])).rows;
      assert.equal(publications.length, 3);
      assert.equal(new Set(publications.map(row => row.article_id)).size, 3);
      assert.equal(unsafeSkipChecked, true);
      const beforeReplay = state.providerCalls();
      config.dailyPublicationRunLimit = 1;
      for (const result of outcomes) assert.deepEqual(await runner.run({ requestId:result.requestId }), result);
      assert.equal(state.providerCalls(), beforeReplay);
      const { PostgresAgentBlogPublicRequestRepository } = await harness.load('agent-blog-public-request-repository.mjs');
      assert.equal(await new PostgresAgentBlogPublicRequestRepository(admin).findCompleted({
        agentUserId:crypto.randomUUID(),requestId:first.requestId }),null);
      config.dailyPublicationRunLimit = 4;
      for (const old of historyBefore) assert.deepEqual((await admin.query(
        'SELECT id,payload_json FROM agent_editorial_memory_events WHERE id=$1', [old.id])).rows[0], old);
      const { createAgentBlogPublicScheduleController, PostgresAgentBlogPublicScheduleRepository } =
        await harness.load('agent-blog-public-schedule.mjs');
      const repository = new PostgresAgentBlogPublicScheduleRepository(admin);
      await repository.ensureDaily({ agentUserId: account.agentUserId, enabled: true });
      await admin.query(`UPDATE agent_schedules SET next_fire_at=now()-interval '1 second',
        config_json=config_json||'{"consecutiveFailures":1}'::jsonb WHERE agent_user_id=$1`, [account.agentUserId]);
      const controller = createAgentBlogPublicScheduleController({ repository, runtimeConfig: config,
        preflightRepository: { snapshot: async () => assert.fail('runOnce delegates preflight to runner') },
        runner: { run: async () => outcomes[3] } });
      assert.equal((await controller.runOnce()).status, 'succeeded');
      const schedule = (await admin.query('SELECT enabled,config_json,next_fire_at FROM agent_schedules WHERE agent_user_id=$1',
        [account.agentUserId])).rows[0];
      assert.equal(schedule.enabled, true);
      assert.equal(schedule.config_json.consecutiveFailures, 0);
      assert.ok(schedule.next_fire_at);
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM agent_runs
        WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'`, [account.agentUserId])).rows[0].n, 0);
    } });
  });
