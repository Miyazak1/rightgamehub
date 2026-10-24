const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const input = {
  apiKey: 'secret', modelId: 'deepseek-fixture', request: { messages: [{ role: 'user', content: '只返回 JSON' }] },
  tokenCeiling: 200, timeoutSeconds: 5, idempotencyKey: 'deepseek-adapter-fixture',
};

test('DeepSeek provider adapter performs one bounded structured request and returns a receipt', async () => {
  const { createAgentDeepSeekProviderAdapter } = await load('agent-deepseek-provider-adapter.mjs');
  let captured;
  const adapter = createAgentDeepSeekProviderAdapter({ fetchImpl: async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, headers: { get: name => name === 'x-ds-request-id' ? 'ds-fixture' : null },
      json: async () => ({ choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  } });
  const result = await adapter(input);
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret');
  assert.equal(captured.body.stream, false);
  assert.deepEqual(captured.body.response_format, { type: 'json_object' });
  assert.equal(result.providerRequestId, 'ds-fixture');
  assert.deepEqual(result.usage, { providerCalls: 1, inputTokens: 10, outputTokens: 5, costMicrousd: 0 });
});

test('DeepSeek provider adapter maps a complete HTTP failure as acknowledged without retrying', async () => {
  const { createAgentDeepSeekProviderAdapter, AgentDeepSeekProviderError } = await load('agent-deepseek-provider-adapter.mjs');
  let requests = 0;
  const adapter = createAgentDeepSeekProviderAdapter({ fetchImpl: async () => {
    requests += 1;
    return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: 'limited' } }) };
  } });
  await assert.rejects(adapter(input), error => error instanceof AgentDeepSeekProviderError
    && error.code === 'AGENT_PROVIDER_RATE_LIMITED' && error.retryable === true
    && error.acknowledged === true && error.providerRequestId.startsWith('deepseek-unreported:'));
  assert.equal(requests, 1);
});
