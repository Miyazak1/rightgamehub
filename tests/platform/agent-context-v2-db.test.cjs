const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const h = require('./support/researcher-qa-db.cjs');

test('D2 isolated shadow and opt-in ordinary chat preserve scope, sources and runtime budgets', { skip: !h.enabled, timeout: 120000 }, async t => {
  const { admin: db, stable: { stableHash } } = await h.setup(); t.after(() => db.end());
  const load = h.load;
  const { createAgentAccountService } = await load('agent-account-service.mjs'), { PostgresAgentAccountRepository } = await load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await load('agent-runtime-repository.mjs');
  const { PostgresAgentInteractionRepository } = await load('agent-interaction-repository.mjs');
  const { createAgentInteractionService } = await load('agent-interaction-service.mjs');
  const { bootstrapAgentInteractions } = await load('agent-interaction-bootstrap.mjs');
  const { createAgentMemoryReadOnlyService } = await load('agent-memory-readonly.mjs');
  const { createAgentContextService } = await load('agent-context-service.mjs');
  const { createAgentMessageIngressV2 } = await load('agent-message-envelope.mjs');
  const { AGENT_CONTEXT_CONVERSATION_WORKFLOW } = await load('agent-context-conversation.mjs');
  const { createAgentConversationExecutor, validateConversationOutput, validateConversationAttempt } = await load('agent-interaction-conversation.mjs');
  const { PostgresAgentProviderGatewayRepository } = await load('agent-provider-gateway-repository.mjs');
  const { createAgentProviderGateway } = await load('agent-provider-gateway.mjs');
  const { createAgentRuntimePolicyService } = await load('agent-runtime-policy-service.mjs');
  const { createAgentSecretVault } = await load('agent-secret-vault.mjs');
  const owner = randomUUID(), other = randomUUID();
  await db.query("INSERT INTO users(id,display_name,role) VALUES($1,'Context operator','admin'),($2,'Other participant','user')", [owner, other]);
  const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(db), authorizeOperator: async () => true })
    .provision({ userId: owner }, { provisionKey: 'context-' + randomUUID(), displayName: 'Context Agent', handle: 'context-' + randomBytes(5).toString('hex'),
      badgeLabel: 'AI 助手', operatorLabel: 'Local QA', capabilities: ['blog:auto-publish'], metadata: {} });
  const agentId = account.agentUserId, runtime = new PostgresAgentRuntimeRepository(db), repository = new PostgresAgentInteractionRepository(db);
  await bootstrapAgentInteractions({ repository, runtimeRepository: runtime, agentId });
  await runtime.registerWorkflow({ actorUserId: owner, manifest: AGENT_CONTEXT_CONVERSATION_WORKFLOW });
  await runtime.activateWorkflow(AGENT_CONTEXT_CONVERSATION_WORKFLOW.workflowKey, 3);
  for (const key of ['provider.text.generate', 'research.github.read']) await db.query(`INSERT INTO agent_capability_grants(id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason)
    VALUES($1,$2,$3,1,'{}','L1','active',$4,'Isolated D2 fixture') ON CONFLICT DO NOTHING`, [randomUUID(), agentId, key, owner]);
  await db.query("INSERT INTO agent_blog_automation_settings(agent_user_id,model,topic_scope,updated_by_user_id) VALUES($1,'fixture-context-d2','Preserved schedule fixture',$2)", [agentId, owner]);
  let enabled = true, now = null; const thread = randomUUID();
  const web = (actor = owner, conversation = thread) => ({ channel: 'web', actorRef: actor, platformUserId: actor, conversationRef: conversation, eventRef: randomUUID() });
  let qqEvent = 1000;
  const qq = (group = '905757031') => ({ channel: 'qq', actorRef: '495469022', botId: '3922489710', groupId: group,
    conversationRef: `3922489710:${group}:495469022`, eventRef: String(++qqEvent) });
  const interaction = createAgentInteractionService({ repository, agentId, readQQPolicy: async () => ({ agentId, botId: '3922489710', groupId: '905757031', allowedUsers: ['495469022'], enabled }) });
  const memory = createAgentMemoryReadOnlyService({ pool: db, interactionService: interaction });
  const makeContext = (policy = {}, sourceMemory = memory) => createAgentContextService({ pool: db, interactionService: interaction, repository,
    memoryService: sourceMemory, clock: () => now ?? new Date(), policy });
  const context = makeContext(), ingress = createAgentMessageIngressV2({ repository, interactionService: interaction });
  async function submit(origin, text, replyTo, v2 = true) {
    const requestId = origin.channel === 'web' ? origin.eventRef : randomUUID();
    const value = v2 ? await ingress.receive(origin, { schemaVersion: 'agent-message-input-v2', requestId, message: text, replyTo })
      : await interaction.receive(origin, { requestId, message: text });
    return repository.get(value.messageRef ?? value.id);
  }
  async function seed(text, origin = web()) {
    const row = await submit(origin, text, null, false), leased = await repository.claim(agentId, 'message'); assert.equal(leased.id, row.id);
    await repository.settle(leased, { result: { reply: 'Original reply: ' + text } }); return repository.get(row.id);
  }
  const one = await seed('First topic'), two = await seed('第二个话题'), three = await seed('第三个话题');
  const foreign = await seed('PRIVATE OTHER USER', web(other));
  const foreignThread = await seed('PRIVATE OTHER THREAD', web(owner, randomUUID()));
  const target = row => ({ agentId, channel: row.channel, actorRef: row.actor_ref, conversationRef: row.conversation_ref,
    reference: { kind: 'conversation', interactionId: row.id, part: 'reply' } });
  const anchor = await submit(web(), '解释引用，不执行操作', target(two));
  const access = row => ({ origin: row.origin_json, interactionId: row.id });
  async function fingerprint() {
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const result = {};
    for (const { tablename } of tables) result[tablename] = (await db.query(`SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${tablename.replaceAll('"', '""')}" t`)).rows[0].hash;
    return result;
  }
  const before = await fingerprint();
  await t.test('shadow is equivalent, read-only and never invokes providers or sends', async () => {
    const shadow = await context.shadow(access(anchor)); assert.equal(shadow.equivalent, true);
    assert.equal(shadow.providerCalled, false); assert.equal(shadow.messageSent, false);
    const value = await context.assemble(access(anchor));
    assert.deepEqual(value.compatibility.history, await repository.history(anchor));
    assert.equal(value.quote.state, 'resolved'); assert.equal(value.quote.content.text, two.result_json.reply);
    assert.equal(value.message.author.id, owner); assert.equal(value.message.threadRef, thread);
    assert(!JSON.stringify(value).includes('PRIVATE OTHER'));
    assert.equal((await context.revalidate(access(anchor), value)).sourceFingerprint, value.sourceFingerprint);
    await assert.rejects(context.revalidate(access(anchor), { ...value, quote: { ...value.quote, content: { text: 'tampered' } } }), { code: 'AGENT_CONTEXT_SOURCE_CHANGED' });
  });
  await t.test('time, bytes and whole-turn bounds are explicit; no clipping creates orphan answers', async () => {
    const clipped = await makeContext({ maxHistoryBytes: 1 }).assemble(access(anchor));
    assert.equal(clipped.compatibility.history.length, 0); assert.equal(clipped.omittedTurns, 3);
    const tinyQuote = await makeContext({ maxQuoteBytes: 1 }).assemble(access(anchor));
    assert.equal(tinyQuote.quote.state, 'missing'); assert.equal(tinyQuote.quote.reason, 'quote-context-byte-limit'); assert(!tinyQuote.quote.content);
    now = new Date(Date.now() + 700000);
    assert.equal((await context.assemble(access(anchor))).quote.state, 'expired'); now = null;
    await assert.rejects(makeContext({ maxContextBytes: 1 }).assemble(access(anchor)), { code: 'AGENT_CONTEXT_BUDGET_EXCEEDED' });
    assert.throws(() => makeContext({ maxQuoteBytes: 500000 }), { code: 'AGENT_CONTEXT_POLICY_INVALID' });
  });
  await t.test('D2 source wrappers do not widen actor, thread or QQ group permissions', async () => {
    for (const origin of [web(other), web(owner, randomUUID()), qq(), qq('905757032')]) await assert.rejects(context.assemble({ origin, interactionId: anchor.id }));
    await assert.rejects(ingress.receive(qq(), { schemaVersion: 'agent-message-input-v2', requestId: randomUUID(), message: 'x', context: { batchId: randomUUID(), questionId: 'q1' } }), { code: 'AGENT_INTERACTION_CONTEXT' });
    const forgedMemory = { agentId, read: async (...args) => { const value = await memory.read(...args); enabled = false; return value; } };
    // Web access remains valid, but QQ is checked again after a memory read.
    enabled = true;
    const qrow = await repository.accept({ agentId, origin: qq(), input: { requestId: randomUUID(), message: 'QQ anchor', context: null } });
    const beforeRevoke = await makeContext().assemble(access(qrow));
    enabled = false; await assert.rejects(context.revalidate(access(qrow), beforeRevoke), { code: 'AGENT_INTERACTION_CHANNEL_DENIED' });
    enabled = true; await assert.rejects(makeContext({}, forgedMemory).assemble(access(qrow)), { code: 'AGENT_INTERACTION_CHANNEL_DENIED' }); enabled = true;
    // This new synthetic row is terminalized, never executed or sent.
    const leased = await repository.claim(agentId, 'message'); assert.equal(leased.id, anchor.id);
    await repository.settle(leased, { result: { reply: 'Synthetic read-test anchor closed' } });
    const qleased = await repository.claim(agentId, 'message'); assert.equal(qleased.id, qrow.id);
    await repository.settle(qleased, { result: { reply: 'Synthetic QQ anchor closed' } });
  });
  // Read-only proof excludes explicit fixture creation/terminalization above.
  const readBaseline = await fingerprint();
  await context.shadow(access(anchor)); await context.assemble(access(anchor));
  assert.deepEqual(await fingerprint(), readBaseline);
  assert.equal(Object.keys(before).length, 297);

  await t.test('a foreign quoted source is forbidden and an unknown same-scope source is missing', async () => {
    const row = await submit(web(other), '引用其他用户', target(two));
    const value = await context.assemble(access(row)); assert.equal(value.quote.state, 'forbidden'); assert(!value.quote.content);
    assert(!JSON.stringify(value).includes(two.result_json.reply));
    let leased = await repository.claim(agentId, 'message'); await repository.settle(leased, { result: { reply: 'Synthetic reference check' } });
    const unknown = await submit(web(other), '不存在的引用', { ...target(row), reference: { kind: 'conversation', interactionId: randomUUID(), part: 'reply' } });
    assert.equal((await context.assemble(access(unknown))).quote.state, 'missing');
    leased = await repository.claim(agentId, 'message'); await repository.settle(leased, { result: { reply: 'Synthetic missing reference check' } });
  });
  const governance = new PostgresAgentProviderGatewayRepository(db), vault = createAgentSecretVault({ masterKey: 'de'.repeat(32) });
  await governance.registerModel({ provider: 'deepseek', modelId: 'fixture-context-d2', catalogVersion: 1, status: 'active', taskClasses: ['structured-generation'], supportsJsonSchema: true,
    maxInputTokens: 60000, maxOutputTokens: 7000, inputPriceMicrousdPerMillion: 2000000, outputPriceMicrousdPerMillion: 4000000, config: { fixture: true } });
  const secret = vault.encrypt(agentId, 'deepseek', 'local-fixture-not-a-live-key');
  await db.query(`INSERT INTO agent_provider_secrets(agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id)
    VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`, [agentId, secret.ciphertext, secret.nonce, secret.authTag, secret.fingerprint, secret.lastFour, owner]);
  const requests = []; let revokeAfterModel = false;
  const providerGateway = createAgentProviderGateway({ runtimeRepository: runtime, governanceRepository: governance, policyService: createAgentRuntimePolicyService({ pool: db }), secretVault: vault,
    responseSchemas: { 'agent.conversation.completion@1': validateConversationOutput, 'agent.conversation.attempt@1': validateConversationAttempt },
    adapters: { deepseek: async ({ request }) => { requests.push(structuredClone(request)); if (revokeAfterModel) enabled = false;
      return { providerRequestId: 'local-context-' + randomUUID(), output: JSON.stringify({ reply: '本地上下文验收通过' }), usage: { inputTokens: 40, outputTokens: 15 }, responseRef: { finishReason: 'stop' } }; } } });
  const executor = mode => createAgentConversationExecutor({ repository, service: interaction, ports: { runtimeRepository: runtime, providerGateway, conversationAttempts: true },
    practiceService: {}, platformTools: null, contextMode: mode, contextService: context });
  const protectedBefore = await fingerprint();
  await t.test('opt-in unified chat persists a V3 source snapshot and uses the existing provider ledger exactly once', async () => {
    const row = await submit(web(), '解释这段引用', target(three)), leased = await repository.claim(agentId, 'message'); assert.equal(leased.id, row.id);
    const run = executor('unified'), result = await run(leased);
    assert.equal(result.reply, '本地上下文验收通过'); assert.equal(requests.length, 1);
    assert.equal(requests[0].messages.at(-1).content, row.input_json.message);
    assert.match(requests[0].messages.at(-2).content, /agent-quoted-data-v2/);
    const saved = await repository.get(row.id), durable = (await db.query('SELECT * FROM agent_runs WHERE id=$1', [saved.run_id])).rows[0];
    assert.equal(durable.workflow_version, 3); assert.equal(durable.input_json.schemaVersion, 'agent-conversation-input-v2');
    assert.equal(durable.input_json.contextV2.quote.state, 'resolved');
    assert.deepEqual(durable.budget_json, AGENT_CONTEXT_CONVERSATION_WORKFLOW.defaultBudget);
    assert.equal(durable.usage_json.providerCalls, 1); assert.equal(durable.usage_json.toolCalls ?? 0, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agent_tool_calls c JOIN agent_run_actions a ON a.id=c.action_id WHERE a.run_id=$1', [durable.id])).rows[0].n, 0);
    assert.deepEqual(await run(leased), result); assert.equal(requests.length, 1, 'synthetic replay must not invoke a second model');
    await assert.rejects(executor('legacy')(leased), { code: 'AGENT_CONTEXT_RESUME_DISABLED' });
    await repository.settle(leased, { result });
  });
  await t.test('explicit legacy fallback creates the original workflow/input without unified fields', async () => {
    const row = await submit(web(), '普通旧链路问答', null, false), leased = await repository.claim(agentId, 'message');
    const result = await executor('legacy')(leased), saved = await repository.get(row.id);
    const durable = (await db.query('SELECT * FROM agent_runs WHERE id=$1', [saved.run_id])).rows[0];
    assert.equal(durable.workflow_version, 2); assert.equal(durable.input_json.schemaVersion, 'agent-conversation-input-v1');
    assert.equal(Object.hasOwn(durable.input_json, 'contextV2'), false);
    await repository.settle(leased, { result });
  });
  await t.test('revocation during generation blocks the candidate before checkpoint/release', async () => {
    const row = await submit(qq(), '撤销测试'), leased = await repository.claim(agentId, 'message');
    revokeAfterModel = true;
    await assert.rejects(executor('unified')(leased), { code: 'AGENT_INTERACTION_CHANNEL_DENIED' }); enabled = true; revokeAfterModel = false;
    assert.equal((await repository.get(row.id)).checkpoint_json, null);
    await repository.settle(leased, { errorCode: 'AGENT_INTERACTION_CHANNEL_DENIED', needsReview: true });
  });
  await t.test('prompt byte guard prevents the gateway from spending a provider action', async () => {
    const row = await submit(qq(), '字节预算测试'), leased = await repository.claim(agentId, 'message'), priorCalls = requests.length;
    const strictContext = makeContext({ maxPromptBytes: 1 });
    const execute = createAgentConversationExecutor({ repository, service: interaction, ports: { runtimeRepository: runtime, providerGateway, conversationAttempts: true },
      practiceService: {}, platformTools: null, contextMode: 'unified', contextService: strictContext });
    await assert.rejects(execute(leased), { code: 'AGENT_CONTEXT_PROMPT_BUDGET_EXCEEDED' }); assert.equal(requests.length, priorCalls);
    await repository.settle(leased, { errorCode: 'AGENT_CONTEXT_PROMPT_BUDGET_EXCEEDED', needsReview: true });
  });
  const after = await fingerprint();
  const expectedWrites = new Set(['agent_interactions', 'agent_interaction_events', 'agent_runs', 'agent_run_stages', 'agent_run_actions', 'agent_run_events',
    'agent_runtime_stage_artifacts', 'agent_runtime_outbox', 'agent_runtime_workers', 'agent_provider_calls', 'agent_provider_attempts', 'agent_provider_output_artifacts',
    'agent_provider_circuits', 'agent_provider_input_artifacts', 'agent_budget_reservations', 'agent_budget_accounts', 'agent_budget_entries']);
  const changed = Object.keys(after).filter(table => after[table] !== protectedBefore[table]);
  assert(changed.every(table => expectedWrites.has(table)), 'unexpected writes: ' + changed.filter(table => !expectedWrites.has(table)).join(','));
  console.log(JSON.stringify({ result: 'AGENT_CONTEXT_D2_DB_ACCEPTED', publicTables: Object.keys(after).length, shadowReadOnly: true, syntheticProviderCalls: requests.length,
    realProviderCalls: 0, externalNetworkCalls: 0, qqMessagesSent: 0, oldLiveTasksRetried: false, liveServicesTouched: false, changedFixtureTables: changed }));
});
