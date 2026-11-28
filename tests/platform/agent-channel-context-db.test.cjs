const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createRequire } = require('node:module'), path = require('node:path');
const h = require('./support/researcher-qa-db.cjs');
const pg = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('pg');

test('D2 channel ingress: native fake QQ and authenticated Web traverse the unified runtime without crossing scopes', { skip: !h.enabled, timeout: 120000 }, async t => {
  let app,qqPool,qqDatabase;
  const { admin: db, stable: { stableHash } } = await h.setup();
  t.after(async()=>{await app?.close();await qqPool?.end();if(qqDatabase)await db.query('DROP DATABASE IF EXISTS '+qqDatabase+' WITH (FORCE)');await db.end();});
  const load = h.load;
  const { createAgentAccountService } = await load('agent-account-service.mjs'), { PostgresAgentAccountRepository } = await load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await load('agent-runtime-repository.mjs'), { PostgresAgentInteractionRepository } = await load('agent-interaction-repository.mjs');
  const { createAgentInteractionService } = await load('agent-interaction-service.mjs'), { bootstrapAgentInteractions } = await load('agent-interaction-bootstrap.mjs');
  const { createAgentMemoryReadOnlyService } = await load('agent-memory-readonly.mjs'), { createAgentContextService } = await load('agent-context-service.mjs');
  const { createAgentChannelMessageService } = await load('agent-channel-message-service.mjs'), { registerAgentChannelMessageRoutes } = await load('agent-channel-message-routes.mjs');
  const { registerAgentInteractionRoutes } = await load('agent-interaction-routes.mjs');
  const { AGENT_CONTEXT_CONVERSATION_WORKFLOW } = await load('agent-context-conversation.mjs');
  const { createAgentConversationExecutor, validateConversationOutput, validateConversationAttempt } = await load('agent-interaction-conversation.mjs');
  const { PostgresAgentProviderGatewayRepository } = await load('agent-provider-gateway-repository.mjs'), { createAgentProviderGateway } = await load('agent-provider-gateway.mjs');
  const { createAgentRuntimePolicyService } = await load('agent-runtime-policy-service.mjs'), { createAgentSecretVault } = await load('agent-secret-vault.mjs');
  const { parseConfig } = await import('../../apps/qq-channel/src/config.mjs'), { QQRepository } = await import('../../apps/qq-channel/src/repository.mjs');
  const { QQService } = await import('../../apps/qq-channel/src/service.mjs'), { OneBotGateway } = await import('../../apps/qq-channel/src/onebot.mjs');
  const { createQQMessageContextAdapter } = await import('../../apps/qq-channel/src/message-context.mjs');
  const { QQAgentBridge, createQQAgentClient, createQQContextAgentClient } = await import('../../apps/qq-channel/src/agent-bridge.mjs');
  const owner = randomUUID(), other = randomUUID();
  await db.query("INSERT INTO users(id,display_name,role) VALUES($1,'Channel operator','admin'),($2,'Other Web user','user')", [owner, other]);
  const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(db), authorizeOperator: async () => true })
    .provision({ userId: owner }, { provisionKey: 'channel-' + randomUUID(), displayName: 'Channel Agent', handle: 'channel-' + randomBytes(5).toString('hex'),
      badgeLabel: 'AI 助手', operatorLabel: 'Isolated channel QA', capabilities: ['blog:auto-publish'], metadata: {} });
  const agentId = account.agentUserId, runtime = new PostgresAgentRuntimeRepository(db), repository = new PostgresAgentInteractionRepository(db);
  await bootstrapAgentInteractions({ repository, runtimeRepository: runtime, agentId });
  const workflow=await runtime.registerWorkflow({ actorUserId: owner, manifest: AGENT_CONTEXT_CONVERSATION_WORKFLOW }); if(workflow.status==='draft')await runtime.activateWorkflow(AGENT_CONTEXT_CONVERSATION_WORKFLOW.workflowKey, 3);
  await db.query(`INSERT INTO agent_capability_grants(id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason)
    VALUES($1,$2,'provider.text.generate',1,'{}','L1','active',$3,'Isolated channel QA') ON CONFLICT DO NOTHING`, [randomUUID(), agentId, owner]);
  await db.query("INSERT INTO agent_blog_automation_settings(agent_user_id,model,topic_scope,updated_by_user_id) VALUES($1,'fixture-channel-context','Original plan preserved',$2)", [agentId, owner]);
  let currentConfig = null, centralEnabled = true;
  const interaction = createAgentInteractionService({ repository, agentId, readQQPolicy: async () => ({ agentId, botId: currentConfig.botId, groupId: currentConfig.groupId, allowedUsers: currentConfig.allowedUsers, enabled: centralEnabled }) });
  const memory = createAgentMemoryReadOnlyService({ pool: db, interactionService: interaction });
  const context = createAgentContextService({ pool: db, interactionService: interaction, memoryService: memory, repository });
  const channels = createAgentChannelMessageService({ repository, interactionService: interaction, contextService: context });
  const fastify = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('fastify'); app = fastify();
  const secret = 'ab'.repeat(32);
  const requireAuth = async request => { if (!['owner', 'other'].includes(request.headers['x-fixture-actor'])) throw Object.assign(Error('AUTH_REQUIRED'), { statusCode: 401 }); request.actor = { userId: request.headers['x-fixture-actor'] === 'owner' ? owner : other, profile: { role: 'user' } }; };
  registerAgentInteractionRoutes(app, { service: interaction, requireAuth, channelSecret: secret });
  registerAgentChannelMessageRoutes(app, { service: channels, requireAuth, channelSecret: secret });
  const governance = new PostgresAgentProviderGatewayRepository(db), vault = createAgentSecretVault({ masterKey: 'ef'.repeat(32) });
  await governance.registerModel({ provider: 'deepseek', modelId: 'fixture-channel-context', catalogVersion: 1, status: 'active', taskClasses: ['structured-generation'], supportsJsonSchema: true,
    maxInputTokens: 60000, maxOutputTokens: 7000, inputPriceMicrousdPerMillion: 2000000, outputPriceMicrousdPerMillion: 4000000, config: { fixture: true } });
  const encrypted = vault.encrypt(agentId, 'deepseek', 'offline-fixture-key');
  await db.query(`INSERT INTO agent_provider_secrets(agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id)
    VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`, [agentId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.fingerprint, encrypted.lastFour, owner]);
  const prompts = [];
  const providerGateway = createAgentProviderGateway({ runtimeRepository: runtime, governanceRepository: governance, policyService: createAgentRuntimePolicyService({ pool: db }), secretVault: vault,
    responseSchemas: { 'agent.conversation.completion@1': validateConversationOutput, 'agent.conversation.attempt@1': validateConversationAttempt },
    adapters: { deepseek: async ({ request }) => { prompts.push(structuredClone(request)); return { providerRequestId: 'offline-channel-' + randomUUID(), output: JSON.stringify({ reply: '离线渠道验收回复 ' + prompts.length }), usage: { inputTokens: 40, outputTokens: 15 }, responseRef: { finishReason: 'stop' } }; } } });
  const executor = createAgentConversationExecutor({ repository, service: interaction, ports: { runtimeRepository: runtime, providerGateway, conversationAttempts: true }, practiceService: {}, platformTools: null, contextMode: 'unified', contextService: context });
  qqDatabase = 'mooyu_qq_local_test_' + randomBytes(8).toString('hex'); const qqUrl = new URL(process.env.QA_LEDGER_TEST_URL);
  await db.query('CREATE DATABASE ' + qqDatabase); qqUrl.pathname = '/' + qqDatabase;
  qqPool = new pg.Pool({ connectionString: qqUrl.href, max: 8 }); qqPool.on('error', () => {});
  let fixtureIndex = 0, remoteSequence = 900000;
  async function fixture({groupId='200000001'}={}) {
    const index = ++fixtureIndex, user = String(300000000 + index * 10), second = String(300000001 + index * 10);
    const config = parseConfig({ enabled: true, botId: String(100000000 + index * 10), groupId, allowedUsers: [user, second], dailyCalls: 100, userDailyCalls: 100,
      dailyTokens: 2000000, userMinuteMessages: 10, groupMinuteMessages: 30 }, { QQ_DATABASE_URL: qqUrl.href, QQ_ACCESS_TOKEN: 'offline-channel-token-'.repeat(3) });
    currentConfig = config; centralEnabled = true;
    let time = null, loseResponse = false, uncertain = false;
    const metadata = createQQMessageContextAdapter({ agentId, clock: () => time ?? new Date() });
    const repo = new QQRepository(qqPool, config, { messageContext: metadata }); await repo.initialize(); await repo.enableControl(); await repo.enableAgentBridge();
    const bodies = [];
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body); bodies.push(structuredClone(body));
      const response = await app.inject({ method: 'POST', url: new URL(url).pathname, headers: options.headers, payload: body });
      if (loseResponse && body.operation === 'submit') { loseResponse = false; throw Error('SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT'); }
      return new Response(response.body, { status: response.statusCode });
    };
    const client = createQQAgentClient({ url: 'http://api:3090', secret, agentId, fetchImpl }), contextClient = createQQContextAgentClient({ url: 'http://api:3090', secret, agentId, fetchImpl });
    const bridge = new QQAgentBridge({ repository: repo, client, contextClient }), gateway = new OneBotGateway(config);
    const sends = [];
    // Exercise the existing OneBot serializer/echo ledger using a fake socket,
    // without listening, signing in, creating a gateway client or any network.
    gateway.socket = { readyState: 1, send(payload, callback) {
      const value = JSON.parse(payload), remoteId = String(++remoteSequence); sends.push({ action: value, remoteId, confirmed: !uncertain });
      assert.equal(value.action, 'send_group_msg'); assert.equal(value.params.group_id, Number(config.groupId));
      if (uncertain) { callback(Error('SYNTHETIC_SEND_UNKNOWN')); return; }
      callback(); const pending = gateway.pending.get(value.echo); clearTimeout(pending.timer); gateway.pending.delete(value.echo); pending.resolve(remoteId);
    } };
    const service = new QQService({ config, repository: repo, bridge, gateway, provider: () => assert.fail('standalone QQ model must never run') });
    const event = (id, text = '解释引用', target = null, actor = user) => ({ post_type: 'message', message_type: 'group', self_id: Number(config.botId), group_id: Number(config.groupId), user_id: Number(actor), message_id: id,
      message: [...(target === null ? [] : [{ type: 'reply', data: { id: String(target) } }]), { type: 'at', data: { qq: config.botId } }, { type: 'text', data: { text } }] });
    const row = async id => (await qqPool.query('SELECT * FROM mooyu_qq.messages WHERE channel_id=$1 AND message_id=$2', [config.channelId, String(id)])).rows[0];
    const wake = async () => qqPool.query("UPDATE mooyu_qq.messages SET next_at=now() WHERE channel_id=$1 AND status='queued'", [config.channelId]);
    return { config, user, second, repo, metadata, bridge, service, event, row, wake, sends, bodies,
      shiftTime: value => { time = value; }, loseNextResponse: () => { loseResponse = true; }, uncertain: value => { uncertain = value; } };
  }
  async function executeNext() {
    const row = await repository.claim(agentId, 'message'); assert(row); const result = await executor(row); await repository.settle(row, { result });
    return { row: await repository.get(row.id), result };
  }
  async function ready(f) { await f.service.tick(); const generated = await executeNext(); await f.wake(); await f.service.tick(); return generated; }
  async function round(f, id, text, quote = null, actor) {
    const admission = await f.service.receive(f.event(id, text, quote, actor)); assert.equal(admission.accepted, true);
    const generated = await ready(f); const sent = await f.service.tick(); assert.equal(sent.delivered, true);
    return { ...generated, qq: await f.row(id), outbound: f.sends.at(-1) };
  }
  const source = row => ({ kind: 'conversation', interactionId: row.id, part: 'reply' });
  const protectedBefore = (await db.query(`SELECT
    (SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text)) FROM agent_capability_grants t) AS grants,
    (SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text)) FROM agent_blog_automation_settings t) AS plans,
    (SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text)) FROM agent_channel_participants t) AS participants`)).rows[0];

  await t.test('Web V2 authentication, server-owned scope, quote context, duplicate idempotence and V1 strictness', async () => {
    const thread = randomUUID(), body = (message, replyTo) => ({ schemaVersion: 'agent-web-message-v2', conversationId: thread, requestId: randomUUID(), message, ...(replyTo ? { replyTo } : {}) });
    const unauthorized = await app.inject({ method: 'POST', url: '/v2/me/agent/messages', payload: body('unauthenticated') }); assert.equal(unauthorized.statusCode, 401);
    const first = body('Web source sentinel'), response = await app.inject({ method: 'POST', url: '/v2/me/agent/messages', headers: { 'x-fixture-actor': 'owner' }, payload: first }); assert.equal(response.statusCode, 200);
    const original = await executeNext();
    const second = body('解释 Web 引用', source(original.row));
    const submit = () => app.inject({ method: 'POST', url: '/v2/me/agent/messages', headers: { 'x-fixture-actor': 'owner' }, payload: second });
    const a = (await submit()).json().data, b = (await submit()).json().data; assert.equal(a.id, b.id);
    const result = await executeNext(), contextValue = await context.assemble({ origin: result.row.origin_json, interactionId: result.row.id });
    assert.equal(contextValue.quote.state, 'resolved'); assert.equal(contextValue.quote.content.text, original.result.reply);
    assert.match(prompts.at(-1).messages.at(-2).content, /agent-quoted-data-v2/);
    const forged = await app.inject({ method: 'POST', url: '/v2/me/agent/messages', headers: { 'x-fixture-actor': 'other' }, payload: { ...body('forged'), actorRef: owner } }); assert.equal(forged.statusCode, 400);
    const foreign = await app.inject({ method: 'POST', url: '/v2/me/agent/messages', headers: { 'x-fixture-actor': 'other' }, payload: body('其他用户引用', source(original.row)) }); assert.equal(foreign.statusCode, 200);
    const foreignRow = await repository.get(foreign.json().data.id); assert.equal((await context.assemble({ origin: foreignRow.origin_json, interactionId: foreignRow.id })).quote.state, 'missing'); await executeNext();
    const malformed = await app.inject({ method: 'POST', url: '/v2/me/agent/messages', headers: { 'x-fixture-actor': 'owner' }, payload: { ...body('preview'), replyTo: { ...source(original.row), preview: 'fake' } } }); assert.equal(malformed.statusCode, 400);
  });

  await t.test('native @ + reply reaches V3, verifies visible bot text and returns a native OneBot reply', async () => {
    const f = await fixture(), first = await round(f, 1, 'QQ visible source sentinel');
    const second = await round(f, 2, '解释刚才的回答', first.qq.remote_message_id);
    const value = await context.assemble({ origin: second.row.origin_json, interactionId: second.row.id });
    assert.equal(value.quote.state, 'resolved'); assert.equal(value.quote.content.text, first.result.reply);
    assert.equal(value.message.mentions.state, 'verified-channel'); assert.deepEqual(value.message.mentions.items, [f.config.botId]);
    assert.equal(value.message.channelSource.replyMessageId, first.qq.remote_message_id);
    assert.equal(second.outbound.action.params.message[0].type, 'reply'); assert.equal(second.outbound.action.params.message[0].data.id, '2');
    const third = await round(f, 3, '解释我自己的原消息', '1');
    const incoming = await context.assemble({ origin: third.row.origin_json, interactionId: third.row.id }); assert.equal(incoming.quote.content.text, 'QQ visible source sentinel');
    const audit = (await qqPool.query("SELECT details FROM mooyu_qq.events WHERE channel_id=$1 AND event_type LIKE 'message-context%'", [f.config.channelId])).rows;
    assert(!JSON.stringify(audit).includes('QQ visible source sentinel')); assert.equal(f.sends.length, 3);
    const before = prompts.length; assert.equal((await f.service.receive(f.event(2, '解释刚才的回答', first.qq.remote_message_id))).duplicate, true); await f.service.tick(); assert.equal(prompts.length, before); assert.equal(f.sends.length, 3);
    assert.equal((await f.service.receive(f.event(2, '解释刚才的回答', '1'))).code, 'QQ_MESSAGE_CONFLICT');
    assert.equal((await qqPool.query('SELECT count(*)::int AS n FROM mooyu_qq.attempts WHERE channel_id=$1', [f.config.channelId])).rows[0].n, 0);
  });

  await t.test('unknown and foreign native sources never fetch foreign text or widen group/user authority', async () => {
    const f = await fixture(), own = await round(f, 1, 'Private first caller');
    const otherReply = await round(f, 2, '引用另一个群友的消息', own.qq.remote_message_id, f.second);
    const otherContext = await context.assemble({ origin: otherReply.row.origin_json, interactionId: otherReply.row.id });
    assert.equal(otherContext.quote.state, 'forbidden'); assert(!JSON.stringify(otherContext).includes('Private first caller'));
    const missing = await round(f, 3, '引用不存在的消息', '789456'); assert.equal((await context.assemble({ origin: missing.row.origin_json, interactionId: missing.row.id })).quote.state, 'missing');
    const prior = prompts.length;
    for (const patch of [{ group_id: Number(f.config.groupId) + 1 }, { user_id: 999999991 }, { message: [{ type: 'reply', data: { id: '1' } }, { type: 'text', data: { text: '@小墨鱼 文本冒充' } }] },
      { message: [...f.event(4).message, { type: 'image', data: { url: 'http://private' } }] }]) assert.equal((await f.service.receive({ ...f.event(4), ...patch })).accepted, false);
    assert.equal(prompts.length, prior);
  });

  await t.test('native resolution age and text disagreement remain unavailable rather than invented evidence', async () => {
    const f = await fixture(), first = await round(f, 1, 'Clock source');
    f.shiftTime(new Date(Date.now() + 700000)); const expired = await round(f, 2, '过期引用', first.qq.remote_message_id); f.shiftTime(null);
    assert.equal((await context.assemble({ origin: expired.row.origin_json, interactionId: expired.row.id })).quote.state, 'expired');
    // Adversarial fixture tampering only, never an application update.
    await qqPool.query('UPDATE mooyu_qq.messages SET reply=$3 WHERE channel_id=$1 AND message_id=$2', [f.config.channelId, '1', 'This text disagrees with the immutable central result']);
    const mismatch = await round(f, 3, '不一致引用', first.qq.remote_message_id);
    const check = await context.assemble({ origin: mismatch.row.origin_json, interactionId: mismatch.row.id }); assert.equal(check.quote.state, 'missing'); assert.equal(check.quote.reason, 'native-source-text-mismatch');
  });

  await t.test('native IDs from a different group cannot carry source text into the new group',async()=>{
    const original=await fixture(), first=await round(original,1,'Other-group private sentinel');
    const nextGroup=await fixture({groupId:'200000002'}), quoted=await round(nextGroup,1,'跨群引用',first.qq.remote_message_id);
    const check=await context.assemble({origin:quoted.row.origin_json,interactionId:quoted.row.id});
    assert.equal(check.quote.state,'missing');assert(!JSON.stringify(check).includes('Other-group private sentinel'));
  });

  await t.test('confirmed plain task replies trace through the existing delivery-parent link',async()=>{
    const f=await fixture(), first=await round(f,1,'Synthetic task parent');
    const child=await repository.attachTask(first.row,{kind:'github-search',topic:'Synthetic task source',repositoryUrl:null,publication:'draft'});
    const leased=await repository.claim(agentId,'task');assert.equal(leased.id,child.id);await repository.settle(leased,{result:{reply:'Synthetic completed task quote'}});
    await qqPool.query('UPDATE mooyu_qq.agent_links SET task_id=$3 WHERE channel_id=$1 AND message_id=$2',[f.config.channelId,'1',child.id]);
    assert.equal((await f.service.tick()).delivered,true);
    const taskNative=f.sends.at(-1).remoteId, quoted=await round(f,2,'解释任务结果引用',taskNative);
    const check=await context.assemble({origin:quoted.row.origin_json,interactionId:quoted.row.id});
    assert.equal(check.quote.state,'resolved');assert.equal(check.quote.reference.part,'task-reply');assert.equal(check.quote.reference.taskId,child.id);assert.equal(check.quote.content.text,'Synthetic completed task quote');
    await qqPool.query('UPDATE mooyu_qq.agent_links SET task_id=NULL WHERE channel_id=$1 AND message_id=$2',[f.config.channelId,'1']);
    const broken=await round(f,3,'缺少任务关联的引用',taskNative);
    assert.equal((await context.assemble({origin:broken.row.origin_json,interactionId:broken.row.id})).quote.state,'missing');
  });

  await t.test('lost submit receipt freezes its semantic input and retries transport without duplicate generation', async () => {
    const f = await fixture(), first = await round(f, 1, 'Transport source');
    assert.equal((await f.service.receive(f.event(2, '新消息传输恢复', first.qq.remote_message_id))).accepted, true);
    f.loseNextResponse(); await f.service.tick(); f.shiftTime(new Date(Date.now() + 700000)); await f.wake(); await f.service.tick(); f.shiftTime(null);
    const submissions = f.bodies.filter(body => body.operation === 'submit' && body.origin.eventRef === '2'); assert.equal(submissions.length, 2); assert.deepEqual(submissions[0].input, submissions[1].input);
    const generated = await executeNext(); await f.wake(); await f.service.tick(); assert.equal((await f.service.tick()).delivered, true);
    assert.equal((await qqPool.query("SELECT count(*)::int AS n FROM mooyu_qq.events WHERE channel_id=$1 AND message_id='2' AND event_type='message-context-submission-v2'", [f.config.channelId])).rows[0].n, 1);
    assert.equal(generated.row.attempts, 1); assert.equal(f.sends.length, 2);
  });

  await t.test('revocation after generation suppresses sending without restarting or re-executing anything', async () => {
    const f = await fixture(); assert.equal((await f.service.receive(f.event(1, '生成后撤权'))).accepted, true);
    const generated = await ready(f), prior = prompts.length; assert.equal((await f.row(1)).status, 'ready'); centralEnabled = false;
    assert.equal((await f.service.tick()).messageAccessBlocked, true); assert.equal(f.sends.length, 0); assert.equal((await f.row(1)).status, 'failed');
    assert.equal(prompts.length, prior); assert.equal((await repository.get(generated.row.id)).checkpoint_json.reply, generated.result.reply); centralEnabled = true;
  });

  await t.test('uncertain sends remain retained and their unacknowledged native ID is not a quote source', async () => {
    const f = await fixture(); assert.equal((await f.service.receive(f.event(1, '未知发送'))).accepted, true); await ready(f); f.uncertain(true);
    assert.equal((await f.service.tick()).sendFailed, true); f.uncertain(false); assert.equal((await f.row(1)).status, 'needs-review');
    const unknownId = f.sends[0].remoteId, next = await round(f, 2, '引用未知投递', unknownId);
    assert.equal((await context.assemble({ origin: next.row.origin_json, interactionId: next.row.id })).quote.state, 'missing');
    const calls = prompts.length, sends = f.sends.length; await f.service.tick(); assert.equal(prompts.length, calls); assert.equal(f.sends.length, sends);
    assert.equal((await f.row(1)).status, 'needs-review');
  });

  await t.test('new channel input cannot run on a legacy executor, and V2 HTTP requires its own MAC', async () => {
    const body = { schemaVersion: 'agent-web-message-v2', conversationId: randomUUID(), requestId: randomUUID(), message: '配置不匹配' };
    const response = await app.inject({ method: 'POST', url: '/v2/me/agent/messages', headers: { 'x-fixture-actor': 'owner' }, payload: body }); assert.equal(response.statusCode, 200);
    const row = await repository.claim(agentId, 'message'), prior = prompts.length;
    const old = createAgentConversationExecutor({ repository, service: interaction, ports: { runtimeRepository: runtime, providerGateway }, practiceService: {}, platformTools: null });
    await assert.rejects(old(row), { code: 'AGENT_CHANNEL_CONTEXT_EXECUTOR_REQUIRED' }); assert.equal(prompts.length, prior); await repository.settle(row, { errorCode: 'AGENT_CHANNEL_CONTEXT_EXECUTOR_REQUIRED', needsReview: true });
    const unauthorized = await app.inject({ method: 'POST', url: '/v2/internal/agent/qq/messages', payload: { operation: 'submit' } }); assert.equal(unauthorized.statusCode, 401);
    const { agentChannelSignature } = await load('agent-channel-protocol.mjs'), timestamp = String(Date.now()), requestId = randomUUID(), payload = { agentId, operation: 'submit', origin: { channel: 'qq' } };
    const v1Replay = await app.inject({ method: 'POST', url: '/v2/internal/agent/qq/messages', payload, headers: { 'x-agent-channel-time': timestamp, 'x-agent-channel-request': requestId, 'x-agent-channel-signature': agentChannelSignature(secret, timestamp, requestId, payload) } }); assert.equal(v1Replay.statusCode, 401);
  });
  const protectedAfter = (await db.query(`SELECT
    (SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text)) FROM agent_capability_grants t) AS grants,
    (SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text)) FROM agent_blog_automation_settings t) AS plans,
    (SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text)) FROM agent_channel_participants t) AS participants`)).rows[0];
  assert.deepEqual(protectedAfter, protectedBefore);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM agent_tool_calls c JOIN agent_run_actions a ON a.id=c.action_id WHERE a.run_id IN(SELECT id FROM agent_runs WHERE agent_user_id=$1)', [agentId])).rows[0].n, 0);
  console.log(JSON.stringify({ result: 'AGENT_CHANNEL_CONTEXT_DB_ACCEPTED', syntheticProviderCalls: prompts.length, channelFixtures: fixtureIndex, realProviderCalls: 0,
    realQQLogins: 0, realQQSends: 0, schemaMigrationsAdded: false, nativeRecoveryChanged: false, protectedSettingsUnchanged: true, oldLiveTasksRetried: false, liveServicesTouched: false }));
});
