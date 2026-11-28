import { normalizeInteractionOrigin, interactionUuid } from './agent-interaction-contracts.mjs';
import { agentMessageEnvelope } from './agent-message-envelope.mjs';
import { memoryExact, memoryFail, memoryIso, freezeMemory } from './agent-memory-readonly-contracts.mjs';
import { withAgentMemoryReadOnly } from './agent-memory-readonly-transaction.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const bytes = value => Buffer.byteLength(JSON.stringify(value));
const same = (a, b) => stableHash(a) === stableHash(b);
const defaults = Object.freeze({ maxHistoryBytes: 24000, maxQuoteBytes: 4000, maxContextBytes: 64000,
  maxPromptBytes: 160000, quoteMaxAgeSeconds: 600 });

export function createAgentContextService({ pool, interactionService, memoryService, repository, clock = () => new Date(), policy = {} }) {
  if (memoryService?.agentId !== interactionService?.agentId || !interactionUuid(interactionService?.agentId)
    || !pool?.connect || !repository?.history || typeof clock !== 'function' || !memoryExact(policy, Object.keys(defaults))) memoryFail('AGENT_CONTEXT_CONFIG_REQUIRED', 503);
  const limits = Object.freeze({ ...defaults, ...policy }), agentId = interactionService.agentId;
  for (const key of Object.keys(defaults)) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > defaults[key]) memoryFail('AGENT_CONTEXT_POLICY_INVALID');
  async function assemble(rawAccess) {
    if (!memoryExact(rawAccess, ['origin', 'interactionId']) || !interactionUuid(rawAccess.interactionId)) memoryFail('AGENT_CONTEXT_ACCESS_INVALID');
    const access = structuredClone(rawAccess), origin = normalizeInteractionOrigin(access.origin);
    await interactionService.authorize(origin);
    const row = await withAgentMemoryReadOnly(pool, async db => (await db.query(`SELECT * FROM agent_interactions
      WHERE id=$1 AND agent_user_id=$2 AND channel=$3 AND actor_ref=$4 AND conversation_ref=$5 AND kind='message'`,
    [access.interactionId, agentId, origin.channel, origin.actorRef, origin.conversationRef])).rows[0]);
    if (!row) memoryFail('AGENT_MEMORY_NOT_FOUND', 404);
    const message = agentMessageEnvelope(agentId, row), snapshot = await memoryService.read(access, { kind: 'conversation' });
    const capturedAt = memoryIso(clock()), records = snapshot.records;
    // Whole turns only: never leave an assistant answer without its question.
    const groups = [];
    for (const record of records) {
      if (record.reference.part === 'request') groups.push([]);
      if (!groups.length) memoryFail('AGENT_CONTEXT_SOURCE_INVALID', 503);
      groups.at(-1).push(record);
    }
    const project = groups => groups.flat().map(record => ({ role: record.content.role, content: record.content.text,
      ...(record.content.role === 'assistant' ? { requestId: record.provenance.recordId } : {}) }));
    const retained = [...groups]; let omittedTurns = 0;
    while (bytes(project(retained)) > limits.maxHistoryBytes && retained.length) { retained.shift(); omittedTurns++; }
    const history = project(retained), selected = retained.flat();
    let quote = { state: 'missing', reason: 'no-reference', reference: null };
    if(message.referenceResolution && message.referenceResolution.state !== 'resolved') quote={state:message.referenceResolution.state,reason:message.referenceResolution.reason,reference:null};
    if (message.replyTo) {
      const target = message.replyTo;
      quote = { state: 'forbidden', reason: 'scope-mismatch', reference: null };
      if (same(message.scope, { agentId: target.agentId, channel: target.channel, actorRef: target.actorRef, conversationRef: target.conversationRef })) {
        const record = records.find(record => same(record.reference, target.reference));
        quote = { state: 'missing', reason: 'outside-authorized-four-turn-window', reference: target.reference };
        if (record) {
          const age = Date.parse(capturedAt) - Date.parse(record.provenance.createdAt);
          if(message.referenceResolution?.sourceValueSha256 && message.referenceResolution.sourceValueSha256!==stableHash(record.content.text))quote={state:'missing',reason:'native-source-text-mismatch',reference:target.reference};
          else if (age < 0 || age > limits.quoteMaxAgeSeconds * 1000) quote = { state: 'expired', reason: 'quote-context-age-limit', reference: target.reference };
          else if (bytes(record.content) > limits.maxQuoteBytes) quote = { state: 'missing', reason: 'quote-context-byte-limit', reference: target.reference };
          else quote = { state: 'resolved', reference: record.reference, content: record.content, provenance: record.provenance,
            contentSha256: record.contentSha256, authority: 'data-only' };
        }
      }
    }
    const sources = selected.map(({ reference, contentSha256, provenance }) => ({ reference, contentSha256, provenance }));
    const compatibility = { message: row.input_json.message, context: row.input_json.context ?? null, history };
    const value = { schemaVersion: 'agent-context-projection-v2', agentId, interactionId: row.id, message, quote, sources, compatibility,
      limits, capturedAt, omittedTurns, historyBytes: bytes(history), deliveryReceiptsResolved: false };
    value.sourceFingerprint = stableHash({ message, sources, quote });
    if (bytes(value) > limits.maxContextBytes) memoryFail('AGENT_CONTEXT_BUDGET_EXCEEDED', 413);
    await interactionService.authorize(origin);
    return freezeMemory(value);
  }
  return Object.freeze({ agentId, assemble, async revalidate(access, projection) {
    const current = await assemble(access);
    if (projection?.schemaVersion !== 'agent-context-projection-v2' || projection.agentId !== agentId
      || stableHash({ message: projection.message, sources: projection.sources, quote: projection.quote }) !== projection.sourceFingerprint
      || projection.interactionId !== access.interactionId || current.sourceFingerprint !== projection.sourceFingerprint
      || !same(current.compatibility, projection.compatibility) || !same(current.limits, projection.limits)) memoryFail('AGENT_CONTEXT_SOURCE_CHANGED', 409);
    return current;
  }, async shadow(access) {
    const context = await assemble(access);
    const row = { id: access.interactionId, agent_user_id: agentId, channel: context.message.scope.channel,
      actor_ref: context.message.scope.actorRef, conversation_ref: context.message.scope.conversationRef, created_at: context.message.createdAt };
    const legacy = await repository.history(row);
    await interactionService.authorize(normalizeInteractionOrigin(access.origin));
    return freezeMemory({ schemaVersion: 'agent-context-shadow-v2', interactionId: access.interactionId,
      equivalent: same(legacy, context.compatibility.history), legacySha256: stableHash(legacy), unifiedSha256: stableHash(context.compatibility.history),
      omittedTurns: context.omittedTurns, quoteState: context.quote.state, comparisonAtomic: false,
      providerCalled: false, messageSent: false, writesIssued: false });
  } });
}
