import crypto from 'node:crypto';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export class AgentDeepSeekProviderError extends Error {
  constructor(code, { retryable = false, acknowledged = false, providerRequestId = null,
    responseRef = null, usage = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentDeepSeekProviderError';
    this.code = code;
    this.retryable = retryable;
    this.acknowledged = acknowledged;
    this.providerRequestId = providerRequestId;
    this.responseRef = responseRef;
    this.usage = usage;
  }
}

const fail = (code, options) => { throw new AgentDeepSeekProviderError(code, options); };
const fallbackRequestId = key => `deepseek-unreported:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
const boundedMessages = value => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) fail('AGENT_PROVIDER_REQUEST_INVALID');
  return value.map(item => {
    if (!item || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string'
      || item.content.length < 1 || Buffer.byteLength(item.content) > 262144) fail('AGENT_PROVIDER_REQUEST_INVALID');
    return { role: item.role, content: item.content };
  });
};
const normalizedUsage = value => ({
  providerCalls: 1,
  inputTokens: Math.max(0, Number(value?.prompt_tokens) || 0),
  outputTokens: Math.max(0, Number(value?.completion_tokens) || 0),
  costMicrousd: 0,
});

export function createAgentDeepSeekProviderAdapter({ fetchImpl = globalThis.fetch, endpoint = ENDPOINT } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  return async function invoke({ apiKey, modelId, request, tokenCeiling, timeoutSeconds, idempotencyKey }) {
    const messages = boundedMessages(request?.messages);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            model: modelId, messages, thinking: request?.thinking ?? { type: 'disabled' },
            reasoning_effort: request?.reasoningEffort ?? 'none', temperature: request?.temperature ?? 0.3,
            max_tokens: tokenCeiling, response_format: { type: 'json_object' }, stream: false,
          }),
        });
      } catch (error) {
        fail(error?.name === 'AbortError' ? 'AGENT_PROVIDER_TIMEOUT' : 'AGENT_PROVIDER_UNAVAILABLE',
          { retryable: true, acknowledged: false, cause: error });
      }
      const body = await response.json().catch(() => null);
      const providerRequestId = response.headers?.get?.('x-ds-request-id')
        ?? response.headers?.get?.('x-request-id') ?? fallbackRequestId(idempotencyKey);
      const responseRef = {
        protocol: 'deepseek-chat-completion-v1', providerRequestId, httpStatus: response.status,
        finishReason: body?.choices?.[0]?.finish_reason ?? null,
      };
      const callUsage = normalizedUsage(body?.usage);
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'AGENT_PROVIDER_KEY_REJECTED'
          : response.status === 429 ? 'AGENT_PROVIDER_RATE_LIMITED'
            : response.status >= 500 ? 'AGENT_PROVIDER_UNAVAILABLE' : 'AGENT_PROVIDER_REQUEST_REJECTED';
        fail(code, { retryable: response.status === 429 || response.status >= 500,
          acknowledged: true, providerRequestId, responseRef, usage: callUsage });
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 262144) {
        fail('AGENT_PROVIDER_RESPONSE_INVALID', {
          retryable: false, acknowledged: true, providerRequestId, responseRef, usage: callUsage,
        });
      }
      return { providerRequestId, output: content, responseRef, usage: callUsage };
    } finally {
      clearTimeout(timer);
    }
  };
}
