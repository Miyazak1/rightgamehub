const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const harness = require('./support/researcher-qa-db.cjs');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = () => crypto.randomUUID();
const publicationAction = Object.freeze({ actionKey: 'publish', actionKind: 'domain-write',
  capabilityKey: 'blog.article.publish', contractVersion: 1, riskLevel: 'L3' });

const workflow = Object.freeze({
  schemaVersion: 'agent-workflow-v1', workflowKey: 'blog.project.single', workflowVersion: 2147483000,
  inputSchema: 'blog-publication-fault-input-v1', outputSchema: 'blog-publication-fault-output-v1',
  requiredCapabilities: [{ key: 'blog.article.publish', version: 1 }],
  defaultBudget: { providerCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
  stages: [{ key: 'publish', kind: 'domain-write', dependsOn: [], maxAttempts: 1, timeoutSeconds: 60,
    capability: { key: 'blog.article.publish', version: 1 }, idempotencyMode: 'queryable' }],
});

test('Foundation publication commit boundaries recover exactly once on PostgreSQL',
  { skip: !harness.enabled }, async t => {
    const { admin } = await harness.setup();
    t.after(async () => { await admin.end(); });
    const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
    const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
    const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
    const { PostgresAgentBlogFoundationPublicationRepository } = await harness.load(
      'agent-blog-foundation-publication-repository.mjs');
    const { createAgentBlogFoundationPublicationGateway } = await harness.load(
      'agent-blog-foundation-publication.mjs');
    const withoutEditorialMemory = options => new PostgresAgentBlogFoundationPublicationRepository(admin, {
      ...options, editorialMemoryRecorder: async () => ({ eventCount: 0 }),
    });

    const operatorId = uuid();
    await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Publication fault operator','admin')",
      [operatorId]);
    const account = await createAgentAccountService({
      repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true,
    }).provision({ userId: operatorId }, {
      provisionKey: `publication-fault-${crypto.randomBytes(8).toString('hex')}`,
      displayName: 'Publication fault Agent',
      handle: `publication-fault-${crypto.randomBytes(6).toString('hex')}`,
      badgeLabel: 'AI 助手', operatorLabel: 'Publication fault operator',
      capabilities: ['blog:auto-publish'], metadata: {},
    });
    const runtime = new PostgresAgentRuntimeRepository(admin);
    const registered = await runtime.registerWorkflow({ actorUserId: operatorId, manifest: workflow });
    if (registered.status === 'draft') await runtime.activateWorkflow(workflow.workflowKey, workflow.workflowVersion);
    await admin.query(`UPDATE agent_blog_publication_owners SET
        active_publisher='foundation',generation=generation+1,
        reason='隔离数据库发布故障注入验收',updated_by_user_id=$2,
        switched_at=GREATEST(clock_timestamp(),switched_at+interval '1 microsecond'),
        updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
      WHERE agent_user_id=$1 AND active_publisher='legacy'`, [account.agentUserId, operatorId]);

    async function draftRun(label) {
      const run = await runtime.createRun({
        agentUserId: account.agentUserId, workflowKey: workflow.workflowKey,
        workflowVersion: workflow.workflowVersion, triggerKind: 'system',
        idempotencyKey: `publication-fault-${label}-${uuid()}`, input: {}, config: {},
      });
      const claimed = await runtime.claimNextStage(`publication-fault-${label}`, 60,
        [`${workflow.workflowKey}:publish`], run.id);
      const stage = await runtime.startStage({ stageId: claimed.id, workerId: claimed.leasedBy,
        leaseToken: claimed.leaseToken });
      const articleId = uuid();
      const revisionId = uuid();
      const draftActionId = uuid();
      const compositionId = uuid();
      const verificationId = uuid();
      const sourceArtifactId = uuid();
      const contentSha256 = sha(`publication-content-${label}`);
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO agent_run_actions(
            id,run_id,stage_id,action_key,action_kind,capability_key,contract_version,risk_level,
            status,idempotency_key,request_json,request_sha256,response_ref_json,response_sha256,
            provider_request_id,reservation_ref,policy_decision_json,sent_at,acknowledged_at,finished_at
          ) VALUES($1,$2,$3,'persist-draft','domain-write','blog.article.draft',1,'L2','succeeded',
            $4,'{}',$5,'{}',$6,$7,$8,'{}',now(),now(),now())`,
        [draftActionId, run.id, stage.id, `persist-draft-${label}-${run.id}`, sha(`request-${label}`),
          contentSha256, `database:blog-draft:${articleId}`, `database:blog-draft:${articleId}`]);
        await client.query(`INSERT INTO blog_articles(
            id,author_user_id,slug,locale,publication_state,working_revision_id
          ) VALUES($1,$2,$3,'zh-CN','draft',$4)`,
        [articleId, account.agentUserId, `fault-${label}-${crypto.randomBytes(6).toString('hex')}`, revisionId]);
        await client.query(`INSERT INTO blog_article_revisions(
            id,article_id,author_user_id,title,summary,blocks,citations,content_hash,revision_state
          ) VALUES($1,$2,$3,$4,$5,$6,'[]',$7,'working')`,
        [revisionId, articleId, account.agentUserId, `发布故障注入 ${label}`,
          '这是一篇只存在于隔离数据库中的发布事务故障注入文章。',
          JSON.stringify([{ type: 'paragraph', text: '隔离测试正文' }]), contentSha256]);
        await client.query(`INSERT INTO agent_runtime_stage_artifacts(
            id,run_id,stage_id,artifact_key,artifact_kind,schema_key,schema_version,media_type,
            content_json,content_sha256,size_bytes,source_tool_artifact_ids
          ) VALUES($1,$2,$3,'blog.composition','validated-output','blog.article.normalized',1,
            'application/json','{}',$4,2,$5)`,
        [compositionId, run.id, stage.id, sha(`composition-${label}`), [sourceArtifactId]]);
        await client.query(`INSERT INTO agent_runtime_stage_artifacts(
            id,run_id,stage_id,artifact_key,artifact_kind,schema_key,schema_version,media_type,
            content_json,content_sha256,size_bytes,source_stage_artifact_ids
          ) VALUES($1,$2,$3,'blog.verification','verification','blog.article.verification',1,
            'application/json','{}',$4,2,$5)`,
        [verificationId, run.id, stage.id, sha(`verification-${label}`), [compositionId]]);
        await client.query(`INSERT INTO agent_blog_foundation_drafts(
            run_id,agent_user_id,action_id,article_id,revision_id,source_artifact_ids,
            content_sha256,verification_artifact_id,composition_artifact_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [run.id, account.agentUserId, draftActionId, articleId, revisionId, [sourceArtifactId],
          contentSha256, verificationId, compositionId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return { agentUserId: account.agentUserId, runId: run.id, stageId: stage.id,
        workerId: stage.leasedBy, leaseToken: stage.leaseToken,
        idempotencyKey: `publish-${label}-${run.id}`, articleId, revisionId, contentSha256 };
    }

    const policyService = { decide: async input => ({ schemaVersion: 'agent-policy-decision-v1',
      decision: 'allow', reasonCodes: [], agentUserId: input.resource.owner }) };
    const decisionFor = input => ({ schemaVersion: 'agent-policy-decision-v1', decision: 'allow',
      reasonCodes: [], agentUserId: input.agentUserId });
    const preparePublication = async input => {
      const prepared = await runtime.createAction({
        runId: input.runId, stageId: input.stageId, action: publicationAction,
        idempotencyKey: input.idempotencyKey,
        request: { schemaVersion: 'blog-foundation-publication-request-v1',
          articleId: input.articleId, revisionId: input.revisionId,
          contentSha256: input.contentSha256 },
        policyDecision: decisionFor(input),
      });
      await runtime.transitionAction({ actionId: prepared.id, from: 'prepared', to: 'authorized' });
      return prepared.id;
    };
    const before = await draftRun('before');
    const beforeGateway = createAgentBlogFoundationPublicationGateway({ runtimeRepository: runtime,
      publicationRepository: withoutEditorialMemory({
        boundaryProbe: async event => {
          if (event.boundary === 'before-commit') throw Object.assign(new Error('injected before commit'), {
            code: 'INJECTED_BEFORE_COMMIT',
          });
        },
      }), policyService });
    await assert.rejects(beforeGateway.publish(before), error => error.code === 'INJECTED_BEFORE_COMMIT');
    assert.deepEqual((await admin.query(`SELECT article.publication_state,revision.revision_state,
        action.status AS action_status,
        (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE run_id=$1) AS receipts,
        (SELECT count(*)::int FROM blog_article_events WHERE article_id=$2 AND action='published') AS events
      FROM blog_articles article JOIN blog_article_revisions revision ON revision.id=$3
      JOIN agent_run_actions action ON action.run_id=$1 AND action.action_key='publish'
      WHERE article.id=$2`, [before.runId, before.articleId, before.revisionId])).rows[0],
    { publication_state: 'draft', revision_state: 'working', action_status: 'failed', receipts: 0, events: 0 });

    const after = await draftRun('after');
    const afterGateway = createAgentBlogFoundationPublicationGateway({ runtimeRepository: runtime,
      publicationRepository: withoutEditorialMemory({
        boundaryProbe: async event => {
          if (event.boundary === 'after-commit') throw Object.assign(new Error('injected response loss'), {
            code: 'INJECTED_AFTER_COMMIT',
          });
        },
      }), policyService });
    const recovered = await afterGateway.publish(after);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.reconciled, true);
    const replayed = await afterGateway.publish(after);
    assert.equal(replayed.status, 'succeeded');
    assert.equal(replayed.replayed, true);
    assert.deepEqual((await admin.query(`SELECT article.publication_state,revision.revision_state,
        action.status AS action_status,
        (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE run_id=$1) AS receipts,
        (SELECT count(*)::int FROM blog_article_events WHERE article_id=$2 AND action='published') AS events
      FROM blog_articles article JOIN blog_article_revisions revision ON revision.id=$3
      JOIN agent_run_actions action ON action.run_id=$1 AND action.action_key='publish'
      WHERE article.id=$2`, [after.runId, after.articleId, after.revisionId])).rows[0],
    { publication_state: 'published', revision_state: 'published', action_status: 'succeeded', receipts: 1, events: 1 });

    const concurrent = await draftRun('concurrent');
    const concurrentActionId = await preparePublication(concurrent);
    const concurrentRequest = { actionId: concurrentActionId,
      workerId: concurrent.workerId, leaseToken: concurrent.leaseToken,
      articleId: concurrent.articleId, revisionId: concurrent.revisionId,
      contentSha256: concurrent.contentSha256 };
    const concurrentResults = await Promise.all([
      withoutEditorialMemory().publish(concurrentRequest),
      withoutEditorialMemory().publish(concurrentRequest),
    ]);
    assert.deepEqual(concurrentResults.map(item => item.existing).sort(), [false, true]);
    assert.deepEqual((await admin.query(`SELECT
        (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE run_id=$1) AS receipts,
        (SELECT count(*)::int FROM blog_article_events WHERE article_id=$2 AND action='published') AS events,
        (SELECT count(*)::int FROM agent_run_actions WHERE id=$3 AND status='succeeded') AS succeeded_actions`,
    [concurrent.runId, concurrent.articleId, concurrentActionId])).rows[0],
    { receipts: 1, events: 1, succeeded_actions: 1 });

    const crashed = await draftRun('crashed');
    const crashedActionId = await preparePublication(crashed);
    const childPath = path.join(__dirname, 'support', 'agent-blog-publication-crash-child.mjs');
    const child = spawnSync(process.execPath, [childPath, crashedActionId, crashed.workerId,
      crashed.leaseToken, crashed.articleId, crashed.revisionId, crashed.contentSha256], {
      cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(child.status, 91, `${child.stderr}\n${child.stdout}`);
    const crashReceipt = (await admin.query(`SELECT publication.*,article.publication_state
      FROM agent_blog_foundation_publications publication
      JOIN blog_articles article ON article.id=publication.article_id
      WHERE publication.action_id=$1`, [crashedActionId])).rows[0];
    assert.equal(crashReceipt.publication_state, 'published');
    const crashReplay = await createAgentBlogFoundationPublicationGateway({
      runtimeRepository: runtime,
      publicationRepository: withoutEditorialMemory(),
      policyService,
    }).publish(crashed);
    assert.equal(crashReplay.status, 'succeeded');
    assert.equal(crashReplay.replayed, true);
    assert.deepEqual((await admin.query(`SELECT
        (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE run_id=$1) AS receipts,
        (SELECT count(*)::int FROM blog_article_events WHERE article_id=$2 AND action='published') AS events,
        (SELECT count(*)::int FROM agent_run_actions WHERE id=$3 AND status='succeeded') AS succeeded_actions`,
    [crashed.runId, crashed.articleId, crashedActionId])).rows[0],
    { receipts: 1, events: 1, succeeded_actions: 1 });

    const expired = await draftRun('lease-expired');
    await admin.query("UPDATE agent_run_stages SET lease_until=now()-interval '1 second' WHERE id=$1",
      [expired.stageId]);
    await assert.rejects(createAgentBlogFoundationPublicationGateway({
      runtimeRepository: runtime,
      publicationRepository: withoutEditorialMemory(),
      policyService,
    }).publish(expired), error => error.code === 'AGENT_RUNTIME_LEASE_LOST');
    assert.deepEqual((await admin.query(`SELECT article.publication_state,revision.revision_state,
        action.status AS action_status,
        (SELECT count(*)::int FROM agent_blog_foundation_publications WHERE run_id=$1) AS receipts,
        (SELECT count(*)::int FROM blog_article_events WHERE article_id=$2 AND action='published') AS events
      FROM blog_articles article JOIN blog_article_revisions revision ON revision.id=$3
      JOIN agent_run_actions action ON action.run_id=$1 AND action.action_key='publish'
      WHERE article.id=$2`, [expired.runId, expired.articleId, expired.revisionId])).rows[0],
    { publication_state: 'draft', revision_state: 'working', action_status: 'authorized',
      receipts: 0, events: 0 });
    const stageRecovery = await runtime.recoverExpiredStages({ baseBackoffSeconds: 0 });
    assert.equal(stageRecovery.failed, 1);
    assert.deepEqual((await admin.query(`SELECT run.status AS run_status,stage.status AS stage_status,
        action.status AS action_status FROM agent_runs run
      JOIN agent_run_stages stage ON stage.run_id=run.id
      JOIN agent_run_actions action ON action.stage_id=stage.id AND action.action_key='publish'
      WHERE run.id=$1`, [expired.runId])).rows[0],
    { run_status: 'failed', stage_status: 'failed', action_status: 'cancelled' });
  });
