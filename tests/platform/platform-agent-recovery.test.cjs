const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const actor = { userId: 'owner' };
const input = message => ({ requestId: randomUUID(), message });

async function wireProvider(outputs, inspect = () => {}) {
  const { createAgentDeepSeekProviderAdapter } = await import('../../apps/api/src/agent-deepseek-provider-adapter.mjs');
  const { createPlatformAssistantProvider } = await import('../../apps/api/src/platform-assistant.mjs');
  let calls = 0;
  const invoke = createAgentDeepSeekProviderAdapter({ fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    inspect(body, calls);
    const next = outputs[calls++];
    assert.ok(next, 'unexpected extra provider request');
    return new Response(JSON.stringify({ choices: [{ message: { content: next.content }, finish_reason: next.finish || 'stop' }] }), { status: 200 });
  } });
  return { provider: createPlatformAssistantProvider({ apiKey: 'fixture', invoke }), calls: () => calls };
}

test('named game discovery survives mixed reply/tool JSON and opens using only the real server receipt', async () => {
  const { createPlatformAssistantService } = await import('../../apps/api/src/platform-assistant.mjs');
  const { createPlatformAgentTools } = await import('../../apps/api/src/platform-agent-tools.mjs');
  const { createAgentCapabilityService } = await import('../../apps/api/src/agent-capability-service.mjs');
  const { createCatalogService } = await import('../../apps/api/src/catalog-service.mjs');
  const catalog = createCatalogService({ repository: { list: async () => [] } });
  const tools = createPlatformAgentTools({ capabilityService: createAgentCapabilityService({ catalogService: catalog }) });
  const wire = await wireProvider([
    { content: JSON.stringify({ reply: '先查找。', toolCall: { name: 'search_capabilities', arguments: { query: '猜百科游戏', kinds: ['game'] } } }) },
    { content: JSON.stringify({ reply: '已经打开了。', toolCall: { name: 'open_capability', arguments: { capabilityId: 'game:gamehub-guess-baike' } } }) },
  ], (body, call) => {
    assert.match(body.messages[0].content, /两种格式互斥/);
    if (call) assert.match(body.messages.at(-1).content, /game:gamehub-guess-baike/);
  });
  const service = createPlatformAssistantService({ tools, provider: wire.provider });
  const request = input('打开猜百科');
  const result = await service.send(actor, request);
  assert.equal(result.results[0].result.capabilities[0].title, '猜百科');
  assert.equal(result.actions[0].route, '/play/gamehub-guess-baike');
  assert.equal(result.reply, '已请求打开：猜百科。');
  assert.equal(wire.calls(), 2, 'navigation must not depend on another model completion');
  assert.equal(await service.send(actor, request), result);
});

test('invalid or truncated model JSON gets one bounded repair before any tools run', async () => {
  const { createPlatformAssistantService } = await import('../../apps/api/src/platform-assistant.mjs');
  let executions = 0;
  const wire = await wireProvider([
    { content: '{"toolCall":', finish: 'length' },
    { content: JSON.stringify({ toolCall: { name: 'open_capability', arguments: { capabilityId: 'game:test' } } }) },
    { content: JSON.stringify({ reply: '请明确要求打开。' }) },
  ], (body, call) => { if (call === 1) { assert.match(body.messages.at(-1).content, /尚未执行/); assert.equal(body.max_tokens, 2400); } });
  const service = createPlatformAssistantService({ tools: { descriptions: [], execute: async () => { executions++; } }, provider: wire.provider });
  const result = await service.send(actor, input('找个游戏，先不要打开'));
  assert.equal(executions, 0);
  assert.equal(result.results[0].error.code, 'AGENT_NAVIGATION_NEEDS_REQUEST');
  assert.deepEqual(result.actions, []);
  const bad = await wireProvider([{ content: '{"reply":"未完成"}', finish: 'length' }, { content: 'oops' }]);
  await assert.rejects(bad.provider({ messages: [{ role: 'user', content: 'test' }], allowTools: true }), { code: 'ASSISTANT_RESPONSE_INVALID' });
  assert.equal(bad.calls(), 2);
});

test('kind suffix matching retains exact titles, strict tags and time constraints without scanning the catalog', async () => {
  const { createAgentCapabilityService } = await import('../../apps/api/src/agent-capability-service.mjs');
  const works = [
    { id: 'short', kind: 'game', title: '数字谜题', tags: ['益智'], estimatedMinutes: 8 },
    { id: 'long', kind: 'game', title: '漫长谜题', tags: ['益智'], estimatedMinutes: 40 },
    { id: 'exact', kind: 'game', title: '益智游戏', tags: ['文字'], estimatedMinutes: 5 },
  ];
  const queries = [];
  const service = createAgentCapabilityService({ catalogService: { list: async ({ q, kind, limit }) => {
    queries.push(q); assert.equal(limit, 50);
    return works.filter(w => w.kind === kind && [w.title, ...w.tags].join(' ').includes(q));
  } } });
  const found = await service.searchCapabilities({ query: '益智游戏', kinds: ['game'], tags: ['益智'], maxEstimatedMinutes: 10 });
  assert.deepEqual(found.capabilities.map(c => c.id), ['game:short']);
  assert.deepEqual(queries, ['益智游戏', '益智']);
  const exact = await service.searchCapabilities({ query: '益智游戏', kinds: ['game'] });
  assert.equal(exact.capabilities[0].id, 'game:exact');
  assert.equal(exact.capabilities.filter(c => c.id === 'game:exact').length, 1);
  assert.deepEqual((await service.searchCapabilities({ query: '不存在的游戏', kinds: ['game'] })).capabilities, []);
});
