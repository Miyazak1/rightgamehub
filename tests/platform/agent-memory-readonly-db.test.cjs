const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const h = require('./support/researcher-qa-db.cjs');
const pg = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('pg');

// Fixture writes are confined to an explicitly isolated database. All reads
// under test use a separate SELECT-only database principal, never this owner.
test('D1 real stores: compatibility, live isolation, lineage and zero persisted changes', { skip: !h.enabled, timeout: 120000 }, async t => {
  const { admin: db, stable: { stableHash } } = await h.setup();
  t.after(() => db.end());
  const load = h.load;
  const { createAgentAccountService } = await load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await load('agent-runtime-repository.mjs');
  const { PostgresAgentInteractionRepository } = await load('agent-interaction-repository.mjs');
  const { createAgentInteractionService } = await load('agent-interaction-service.mjs');
  const { bootstrapAgentInteractions } = await load('agent-interaction-bootstrap.mjs');
  const { createAgentMemoryReadOnlyService } = await load('agent-memory-readonly.mjs');
  const { PostgresAgentEditorialMemoryRepository } = await load('agent-editorial-memory-repository.mjs');
  const { PostgresAgentToolGatewayRepository } = await load('agent-tool-gateway-repository.mjs');
  const { createAgentToolGateway } = await load('agent-tool-gateway.mjs');
  const { createAgentRuntimePolicyService } = await load('agent-runtime-policy-service.mjs');
  const { PostgresAgentResearchEvidenceRepository } = await load('agent-research-evidence-repository.mjs');
  const { GITHUB_REPOSITORY_READ_TOOL, validateGitHubRepositoryReadInput, validateGitHubRepositoryReadOutput } = await load('agent-github-repository-tool.mjs');
  const runtime = new PostgresAgentRuntimeRepository(db), writes = new PostgresAgentInteractionRepository(db);
  const ordinary = randomUUID();
  await db.query("INSERT INTO users(id,display_name) VALUES($1,'Ordinary fixture user')", [ordinary]);
  async function agent() {
    const owner = randomUUID();
    await db.query("INSERT INTO users(id,display_name,role) VALUES($1,'Memory fixture operator','admin')", [owner]);
    const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(db), authorizeOperator: async () => true })
      .provision({ userId: owner }, { provisionKey: 'memory-' + randomUUID(), displayName: 'Memory fixture', handle: 'memory-' + randomBytes(5).toString('hex'),
        badgeLabel: 'AI 助手', operatorLabel: 'Isolated local QA', capabilities: ['blog:auto-publish'], metadata: {} });
    const id = account.agentUserId;
    await bootstrapAgentInteractions({ repository: writes, runtimeRepository: runtime, agentId: id });
    await db.query(`INSERT INTO agent_capability_grants(id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason)
      VALUES($1,$2,'research.github.read',1,'{}','L1','active',$3,'Isolated memory fixture only') ON CONFLICT DO NOTHING`, [randomUUID(), id, owner]);
    return { id, owner, actor: { userId: owner, profile: { role: 'admin' } } };
  }
  const a = await agent(), b = await agent();
  const now = new Date('2026-11-28T04:00:00Z'), conversation = randomUUID();
  const web = (actor = a.owner, thread = conversation) => {
    const requestId = randomUUID();
    return { channel: 'web', actorRef: actor, platformUserId: actor, conversationRef: thread, eventRef: requestId };
  };
  const qq = (user = '495469022', group = '905757031') => ({ channel: 'qq', actorRef: user, botId: '3922489710', groupId: group,
    conversationRef: `3922489710:${group}:${user}`, eventRef: String(10000 + Math.floor(Math.random() * 1000000)) });
  async function message(agentId, origin, text, complete = true, parentId = null, kind = 'message') {
    const row = await writes.accept({ agentId, origin, input: { requestId: randomUUID(), message: text }, kind, parentId });
    if (complete) {
      const leased = await writes.claim(agentId, kind);
      assert.equal(leased.id, row.id);
      await writes.settle(leased, { result: { reply: 'Generated fixture: ' + text } });
    }
    return writes.get(row.id);
  }
  const turns = [];
  for (let i = 0; i < 5; i++) turns.push(await message(a.id, web(), 'own turn ' + i));
  const child = await message(a.id, turns[3].origin_json, 'archived task', true, turns[3].id, 'github-search');
  const otherActor = await message(a.id, web(ordinary), 'foreign actor');
  const otherThread = await message(a.id, web(a.owner, randomUUID()), 'foreign conversation');
  const otherAgent = await message(b.id, web(b.owner), 'foreign agent');
  const qqTurn = await message(a.id, qq(), 'QQ-only text');
  const anchor = await message(a.id, web(), 'current request', false);
  const qqAnchor = await message(a.id, qq(), 'current QQ request', false);

  async function research(person, repoName) {
    const workflow = { schemaVersion: 'agent-workflow-v1', workflowKey: 'memory.fixture.' + randomBytes(5).toString('hex'), workflowVersion: 1,
      inputSchema: 'memory-fixture-input-v1', outputSchema: 'memory-fixture-output-v1', requiredCapabilities: [{ key: 'research.github.read', version: 1 }],
      defaultBudget: { providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
      stages: [{ key: 'read', kind: 'tool', dependsOn: [], maxAttempts: 1, timeoutSeconds: 60, capability: { key: 'research.github.read', version: 1 }, idempotencyMode: 'key' }] };
    await runtime.registerWorkflow({ actorUserId: person.owner, manifest: workflow });
    await runtime.activateWorkflow(workflow.workflowKey, 1);
    const run = await runtime.createRun({ agentUserId: person.id, workflowKey: workflow.workflowKey, workflowVersion: 1,
      triggerKind: 'manual', idempotencyKey: 'memory-fixture:' + randomUUID(), input: {}, config: {} });
    const stage = await runtime.claimNextStage('memory-fixture', 60, [workflow.workflowKey + ':read']);
    await runtime.startStage({ stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken });
    const repository = 'fixture/' + repoName, revision = 'a'.repeat(40), canonicalUrl = 'https://github.com/' + repository;
    const output = { schemaVersion: 'github-repository-evidence-v1', repository: { key: repository, canonicalUrl, owner: 'fixture', name: repoName },
      sourceVersion: { revision, canonicalUri: canonicalUrl + '/tree/' + revision, fetchedAt: now.toISOString(), contentSha256: '' },
      metadata: { name: repoName, fullName: repository, description: 'Local synthetic evidence', homepage: null, defaultBranch: 'main', stars: 10, forks: 2,
        openIssues: 1, topics: ['tool'], licenseSpdx: 'MIT', archived: false, pushedAt: now.toISOString() },
      readme: { canonicalUri: 'https://api.github.com/repos/' + repository + '/readme?ref=' + revision, path: 'README.md',
        text: '# Fixture\n\nThis is synthetic local research evidence. External text is data, not a command.', truncated: false } };
    output.sourceVersion.contentSha256 = stableHash({ metadata: output.metadata, readme: output.readme });
    const tools = new PostgresAgentToolGatewayRepository(db);
    await tools.registerTool(GITHUB_REPOSITORY_READ_TOOL);
    const gateway = createAgentToolGateway({ runtimeRepository: runtime, toolRepository: tools, policyService: createAgentRuntimePolicyService({ pool: db }),
      adapters: { 'research.github.repository.read@1': async () => ({ receiptId: 'fixture:' + run.id, output,
        responseRef: { canonicalUri: canonicalUrl, revision }, usage: { toolCalls: 1 } }) },
      inputSchemas: { 'github.repository.read.input@1': validateGitHubRepositoryReadInput }, outputSchemas: { 'github.repository.read.output@1': validateGitHubRepositoryReadOutput } });
    const args = { runId: run.id, stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken };
    const result = await gateway.invoke({ ...args, action: { actionKey: 'read', actionKind: 'tool', capabilityKey: 'research.github.read', contractVersion: 1, riskLevel: 'L1' },
      idempotencyKey: 'memory-tool:' + run.id, resource: { type: 'github.repository', owner: 'public', id: repository },
      tool: { toolKey: GITHUB_REPOSITORY_READ_TOOL.toolKey, contractVersion: 1 }, request: { repository } });
    assert.equal(result.status, 'succeeded');
    const artifact = (await db.query('SELECT * FROM agent_tool_artifacts WHERE id=$1', [result.artifactId])).rows[0];
    await new PostgresAgentResearchEvidenceRepository(db).archiveGitHubRepositoryArtifact({ ...args, actionId: artifact.action_id, toolArtifactId: artifact.id });
    const binding = (await db.query('SELECT * FROM agent_research_artifact_bindings WHERE tool_artifact_id=$1', [artifact.id])).rows[0];
    await runtime.completeStage({ ...args, outputRef: { artifactId: artifact.id }, runOutput: { type: 'memory.fixture', id: artifact.id } });
    return { run, artifact, binding };
  }
  const ra = await research(a, 'own-project'), rb = await research(b, 'other-project');
  async function editorial(person, research) {
    const article = randomUUID(), revision = randomUUID(), event = randomUUID(), subject = 'project:fixture/' + person.id;
    const payload = { repositoryKey: 'fixture/' + person.id, repositoryUrl: 'https://github.com/fixture/' + person.id, angle: 'fixture angle' };
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO blog_articles(id,author_user_id,slug,locale,working_revision_id) VALUES($1,$2,$3,'zh-CN',$4)", [article, person.id, 'memory-' + randomUUID(), revision]);
      await c.query(`INSERT INTO blog_article_revisions(id,article_id,author_user_id,title,summary,blocks,citations,content_hash,revision_state)
        VALUES($1,$2,$3,'Memory fixture','Local editorial fixture',$4,'[]',$5,'working')`, [revision, article, person.id, JSON.stringify([{ type: 'paragraph', text: 'Fixture only' }]), 'a'.repeat(64)]);
      await c.query(`INSERT INTO agent_editorial_memory_events(id,agent_user_id,event_type,subject_kind,subject_key,run_id,article_id,revision_id,research_source_version_id,payload_json,occurred_at)
        VALUES($1,$2,'project-featured','project',$3,$4,$5,$6,$7,$8,$9)`, [event, person.id, subject, research.run.id, article, revision, research.binding.research_source_version_id, payload, now]);
      await c.query(`INSERT INTO agent_editorial_memory_subjects(agent_user_id,subject_kind,subject_key,first_seen_at,last_seen_at,occurrence_count,editorial_role,permanent_main_exclusion,latest_event_id,latest_revision_id,latest_payload_json)
        VALUES($1,'project',$2,$3,$3,1,'main',true,$4,$5,$6)`, [person.id, subject, now, event, revision, payload]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    return { article, revision, event, subject, payload };
  }
  const ea = await editorial(a, ra), eb = await editorial(b, rb);

  const readName = 'memory_reader_' + randomBytes(6).toString('hex'), password = randomBytes(18).toString('hex');
  await db.query(`CREATE ROLE ${readName} LOGIN PASSWORD '${password}'`);
  await db.query(`GRANT USAGE ON SCHEMA public TO ${readName}`);
  await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${readName}`);
  const readUrl = new URL(process.env.QA_LEDGER_TEST_URL); readUrl.username = readName; readUrl.password = password;
  const pool = new pg.Pool({ connectionString: readUrl.href, max: 4 }); t.after(() => pool.end());
  let policyEnabled = true;
  const interaction = createAgentInteractionService({ repository: new PostgresAgentInteractionRepository(pool), agentId: a.id,
    readQQPolicy: async () => ({ agentId: a.id, botId: '3922489710', groupId: '905757031', allowedUsers: ['495469022'], enabled: policyEnabled }) });
  const memory = createAgentMemoryReadOnlyService({ pool, interactionService: interaction, clock: () => now });
  const access = { origin: anchor.origin_json, interactionId: anchor.id }, op = { actor: a.actor };
  async function fingerprint() {
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const values = [];
    for (const { tablename } of tables) {
      const name = '"' + tablename.replaceAll('"', '""') + '"';
      const result = await db.query(`SELECT count(*)::int AS n,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${name} t`);
      values.push({ table: tablename, ...result.rows[0] });
    }
    return values;
  }
  const before = await fingerprint();
  await t.test('chat reproduces the existing four-turn prompt history and child task, with precise source references', async () => {
    const value = await memory.read(access, { kind: 'conversation' });
    assert.deepEqual(value.compatibility.history, await writes.history(anchor));
    assert.equal(value.records.length, 9);
    assert.equal(value.records[0].content.text, 'own turn 1');
    assert(value.records.some(r => r.reference.taskId === child.id));
    assert(!value.records.some(r => [otherActor.id, otherThread.id, otherAgent.id, qqTurn.id, turns[0].id].includes(r.reference.interactionId)));
    for (const record of value.records) {
      assert.equal(record.contentSha256, stableHash(record.content));
      assert.equal(record.provenance.sourceValueSha256, stableHash(record.content.text));
      const source = await memory.explain(access, { kind: 'conversation', reference: record.reference });
      assert.equal(source.provenance.recordId, record.provenance.recordId); assert.equal(Object.hasOwn(source, 'content'), false);
    }
    assert.equal(value.deliveryReceiptsResolved, false);
    assert(value.records.filter(r => r.content.role === 'assistant').every(r => r.observation === 'generated-result-delivery-not-asserted'));
  });
  await t.test('caller, conversation, channel, agent and live QQ whitelist remain isolated', async () => {
    for (const origin of [web(ordinary), web(a.owner, randomUUID()), qq()]) await assert.rejects(memory.read({ origin, interactionId: anchor.id }, { kind: 'conversation' }), { code: 'AGENT_MEMORY_NOT_FOUND' });
    await assert.rejects(memory.read({ origin: otherAgent.origin_json, interactionId: otherAgent.id }, { kind: 'conversation' }), { code: 'AGENT_MEMORY_NOT_FOUND' });
    const value = await memory.read({ origin: qqAnchor.origin_json, interactionId: qqAnchor.id }, { kind: 'conversation' });
    assert.equal(value.records.length, 2); assert.equal(value.records[0].reference.interactionId, qqTurn.id);
    policyEnabled = false;
    await assert.rejects(memory.read({ origin: qqAnchor.origin_json, interactionId: qqAnchor.id }, { kind: 'conversation' }), { code: 'AGENT_INTERACTION_CHANNEL_DENIED' });
    policyEnabled = true;
    for (const kind of ['research', 'editorial']) {
      for (const actor of [b.actor, { userId: ordinary, profile: { role: 'admin' } }, { ...a.actor, profile: { role: 'user' } }])
        await assert.rejects(memory.read({ actor }, { kind }), { code: 'AGENT_INTERACTION_OPERATOR_REQUIRED' });
      await assert.rejects(memory.read(access, { kind }), { code: 'AGENT_MEMORY_ACCESS_INVALID' });
    }
  });
  await t.test('research resolves immutable evidence back to its real successful tool artifact and source version', async () => {
    const value = await memory.read(op, { kind: 'research' }); assert(value.records.length >= 2);
    assert(value.records.every(r => r.provenance.artifactBindingId === ra.binding.id && r.provenance.runId === ra.run.id));
    for (const record of value.records) {
      const e = (await db.query('SELECT * FROM tool_research_evidence WHERE id=$1', [record.reference.evidenceId])).rows[0];
      assert.equal(record.content.text, e.quote_text); assert.equal(record.provenance.quoteSha256, stableHash(e.quote_text));
      assert.equal(record.provenance.sourceVersionId, ra.binding.research_source_version_id);
      assert.equal(record.provenance.toolArtifactSha256, stableHash(ra.artifact.content_json));
      assert.deepEqual((await memory.explain(op, { kind: 'research', reference: record.reference })).provenance, record.provenance);
    }
    assert.equal((await memory.read(op, { kind: 'research', use: 'notification' })).records.length, 0);
    const foreign = (await db.query('SELECT evidence_id FROM agent_research_evidence_bindings WHERE artifact_binding_id=$1 LIMIT 1', [rb.binding.id])).rows[0];
    await assert.rejects(memory.explain(op, { kind: 'research', reference: { kind: 'research', bindingId: rb.binding.id, evidenceId: foreign.evidence_id } }), { code: 'AGENT_MEMORY_NOT_FOUND' });
  });
  await t.test('editorial snapshot stays byte-equivalent in value to existing selection memory and resolves its origin event', async () => {
    const value = await memory.read(op, { kind: 'editorial' });
    assert.deepEqual(value.compatibility.snapshot, await new PostgresAgentEditorialMemoryRepository(pool, { clock: () => now }).snapshot(a.id));
    assert.equal(value.records.length, 1); assert.equal(value.records[0].provenance.eventId, ea.event);
    assert.equal(value.records[0].provenance.researchSourceVersionId, ra.binding.research_source_version_id);
    assert.equal(value.records[0].provenance.eventPayloadSha256, stableHash(ea.payload));
    assert.equal((await memory.explain(op, { kind: 'editorial', reference: value.records[0].reference })).provenance.articleId, ea.article);
    await assert.rejects(memory.explain(op, { kind: 'editorial', reference: { kind: 'editorial', subjectKind: 'project', subjectKey: eb.subject, eventId: eb.event } }), { code: 'AGENT_MEMORY_NOT_FOUND' });
  });
  await t.test('database role and transactions reject mutations; all persisted public tables remain unchanged', async () => {
    await assert.rejects(pool.query("UPDATE agent_accounts SET status='suspended' WHERE user_id=$1", [a.id]), { code: '42501' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      await assert.rejects(c.query("UPDATE agent_accounts SET status='suspended' WHERE user_id=$1", [a.id]), { code: '25006' });
      await c.query('ROLLBACK');
    } finally { c.release(); }
    assert.deepEqual(await fingerprint(), before);
  });

  // Adversarial fixture changes happen after the no-write fingerprint proof.
  await t.test('source status, live operator revocation and corrupted editorial projection fail closed', async () => {
    await db.query("UPDATE tool_research_sources SET status='muted' WHERE id=$1", [ra.binding.research_source_id]);
    assert.equal((await memory.read(op, { kind: 'research' })).records.length, 0);
    await db.query("UPDATE tool_research_sources SET status='tracked' WHERE id=$1", [ra.binding.research_source_id]);
    await db.query("UPDATE users SET role='user' WHERE id=$1", [a.owner]);
    await assert.rejects(memory.read(op, { kind: 'research' }), { code: 'AGENT_INTERACTION_OPERATOR_REQUIRED' });
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [a.owner]);
    await db.query("UPDATE agent_editorial_memory_subjects SET latest_payload_json='{}' WHERE agent_user_id=$1", [a.id]);
    await assert.rejects(memory.read(op, { kind: 'editorial' }), { code: 'AGENT_MEMORY_PROVENANCE_MISMATCH' });
    await db.query('UPDATE agent_editorial_memory_subjects SET latest_payload_json=$2 WHERE agent_user_id=$1', [a.id, ea.payload]);
  });
  await t.test('a foreign child cannot leak merely through a parent foreign key', async () => {
    const invalid = await message(b.id, web(b.owner), 'MUST NOT LEAK', true, turns[2].id, 'github-search');
    const value = await memory.read(access, { kind: 'conversation' });
    assert(!value.records.some(r => r.provenance.recordId === invalid.id));
    assert(!JSON.stringify(value).includes('MUST NOT LEAK'));
  });
  console.log(JSON.stringify({ result: 'AGENT_MEMORY_READONLY_DB_ACCEPTED', publicTablesUnchanged: before.length,
    realMigrations: true, selectOnlyPrincipal: true, syntheticFixturesOnly: true, providerCalls: 0, networkCalls: 0,
    oldTasksRetried: false, liveServicesTouched: false, paperToolsRegisteredOrInvoked: false }));
});
