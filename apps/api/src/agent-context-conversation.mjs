import { AGENT_CONVERSATION_ATTEMPT_WORKFLOW } from './agent-interaction-contracts.mjs';
import { memoryFail } from './agent-memory-readonly-contracts.mjs';

export const AGENT_CONTEXT_CONVERSATION_WORKFLOW = Object.freeze({ ...AGENT_CONVERSATION_ATTEMPT_WORKFLOW,
  workflowVersion: 3, inputSchema: 'agent-conversation-input-v2' });

// A factory option, never an environment toggle or a client-provided field.
export function conversationContextMode(mode = 'legacy', service = null) {
  if (!['legacy', 'shadow', 'unified'].includes(mode) || (mode !== 'legacy' && typeof service?.assemble !== 'function')
    || (mode === 'shadow' && typeof service.shadow !== 'function') || (mode === 'unified' && typeof service.revalidate !== 'function')) memoryFail('AGENT_CONTEXT_MODE_INVALID', 503);
  return mode;
}

export function quotedContextData(projection) {
  if (!projection?.message?.replyTo && !projection?.message?.referenceResolution) return null;
  if (projection.quote?.state !== 'resolved') return { schemaVersion: 'agent-quoted-data-v2', authority: 'data-only',
    state: projection.quote.state, reason: projection.quote.reason, notice: '没有可用引用原文，不能猜测其内容。' };
  const { reference, content, contentSha256 } = projection.quote;
  return { schemaVersion: 'agent-quoted-data-v2', authority: 'data-only', state: 'resolved', reference, content, contentSha256 };
}
