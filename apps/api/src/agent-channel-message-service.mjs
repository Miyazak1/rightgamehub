import { normalizeInteractionOrigin, interactionUuid } from './agent-interaction-contracts.mjs';
import { normalizeMemoryReference, memoryExact, memoryFail } from './agent-memory-readonly-contracts.mjs';
import { withAgentMemoryReadOnly } from './agent-memory-readonly-transaction.mjs';
import { normalizeQQMessageSource, normalizeChannelReferenceResolution } from './agent-channel-message-contracts.mjs';
import { createAgentMessageIngressV2 } from './agent-message-envelope.mjs';

export function createAgentChannelMessageService({ repository, interactionService, contextService }) {
  if (contextService?.agentId !== interactionService?.agentId || !interactionUuid(interactionService?.agentId)) memoryFail('AGENT_CHANNEL_CONTEXT_CONFIG_REQUIRED', 503);
  const ingress = createAgentMessageIngressV2({ repository, interactionService }), agentId = interactionService.agentId;
  async function submit(origin, input, metadata = null) {
    const message = await ingress.receive(origin, input, metadata);
    // The route returns the existing durable receipt. It does not execute chat,
    // create a second provider loop, or change the current runtime factory.
    return interactionService.status(origin, message.messageRef);
  }
  return Object.freeze({ agentId,
    async webReceive(actor, input) {
      if (!interactionUuid(actor?.userId) || !memoryExact(input, ['schemaVersion', 'requestId', 'conversationId', 'message', 'context', 'replyTo'])
        || input.schemaVersion !== 'agent-web-message-v2' || !interactionUuid(input.requestId) || !interactionUuid(input.conversationId)) memoryFail('AGENT_WEB_MESSAGE_INVALID');
      const origin = normalizeInteractionOrigin({ channel: 'web', platformUserId: actor.userId, actorRef: actor.userId, conversationRef: input.conversationId, eventRef: input.requestId });
      const replyTo = input.replyTo == null ? null : { agentId, channel: 'web', actorRef: actor.userId, conversationRef: input.conversationId,
        reference: normalizeMemoryReference(input.replyTo, 'conversation') };
      return submit(origin, { schemaVersion: 'agent-message-input-v2', requestId: input.requestId, message: input.message, context: input.context, replyTo },{requiredContextVersion:2});
    },
    async qqReceive(rawOrigin, input) {
      const origin = normalizeInteractionOrigin(rawOrigin);
      if (origin.channel !== 'qq' || !memoryExact(input, ['schemaVersion', 'requestId', 'message', 'replyTo', 'source', 'referenceResolution'])
        || input.schemaVersion !== 'agent-channel-message-v2') memoryFail('AGENT_CHANNEL_MESSAGE_INVALID');
      const source = normalizeQQMessageSource(origin, input.source), replyTo = input.replyTo ?? null;
      const referenceResolution = normalizeChannelReferenceResolution(source, input.referenceResolution, replyTo);
      if (replyTo && (replyTo.agentId !== agentId || replyTo.channel !== 'qq' || replyTo.actorRef !== origin.actorRef
        || replyTo.conversationRef !== origin.conversationRef)) memoryFail('AGENT_CHANNEL_REFERENCE_INVALID');
      return submit(origin, { schemaVersion: 'agent-message-input-v2', requestId: input.requestId, message: input.message, replyTo },
        { channelSource: source, referenceResolution, requiredContextVersion:2 });
    },
    async deliveryCheck(rawOrigin, interactionId) {
      const origin = normalizeInteractionOrigin(rawOrigin), receipt = await interactionService.status(origin, interactionId);
      const row = await repository.get(interactionId);
      if (row?.kind !== 'message' || !row.input_json.messageV2?.channelSource || !['completed', 'failed', 'needs-review'].includes(receipt.state)) memoryFail('AGENT_CHANNEL_DELIVERY_NOT_READY', 409);
      const run = row.run_id ? await withAgentMemoryReadOnly(repository.pool, async db => (await db.query('SELECT workflow_version,input_json FROM agent_runs WHERE id=$1 AND agent_user_id=$2', [row.run_id, agentId])).rows[0]) : null;
      if (!run || run.workflow_version !== 3) memoryFail('AGENT_CHANNEL_CONTEXT_RUN_REQUIRED', 409);
      await contextService.revalidate({ origin, interactionId }, run.input_json.contextV2);
      await interactionService.authorize(origin);
      return receipt;
    },
  });
}
