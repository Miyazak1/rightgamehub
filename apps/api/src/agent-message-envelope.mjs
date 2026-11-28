import { normalizeInteractionInput, normalizeInteractionOrigin, interactionUuid } from './agent-interaction-contracts.mjs';
import { normalizeMemoryReference, memoryExact, memoryFail, memoryIso, freezeMemory } from './agent-memory-readonly-contracts.mjs';
import { normalizeQQMessageSource, normalizeChannelReferenceResolution } from './agent-channel-message-contracts.mjs';

// V2 is a separate internal ingress contract. V1 and practice context keep
// their original strict fields; no browser/QQ route is enabled by this module.
export function normalizeAgentMessageInputV2(value) {
  if (!memoryExact(value, ['schemaVersion', 'requestId', 'message', 'context', 'replyTo']) || value.schemaVersion !== 'agent-message-input-v2') memoryFail('AGENT_MESSAGE_V2_INVALID');
  const input = normalizeInteractionInput({ requestId: value.requestId, message: value.message, context: value.context });
  let replyTo = null;
  if (value.replyTo != null) {
    const ref = value.replyTo;
    if (!memoryExact(ref, ['agentId', 'channel', 'actorRef', 'conversationRef', 'reference']) || !interactionUuid(ref.agentId)
      || !['web', 'qq'].includes(ref.channel) || typeof ref.actorRef !== 'string' || ref.actorRef.length > 128
      || typeof ref.conversationRef !== 'string' || ref.conversationRef.length > 256) memoryFail('AGENT_MESSAGE_REFERENCE_INVALID');
    if (ref.channel === 'web') {
      if (!interactionUuid(ref.actorRef) || !interactionUuid(ref.conversationRef)) memoryFail('AGENT_MESSAGE_REFERENCE_INVALID');
    } else {
      const [botId, groupId] = ref.conversationRef.split(':');
      normalizeInteractionOrigin({ channel: 'qq', actorRef: ref.actorRef, botId, groupId, conversationRef: ref.conversationRef, eventRef: '1' });
    }
    replyTo = { agentId: ref.agentId, channel: ref.channel, actorRef: ref.actorRef, conversationRef: ref.conversationRef,
      reference: normalizeMemoryReference(ref.reference, 'conversation') };
  }
  return { ...input, messageV2: { schemaVersion: 'agent-message-source-v2', replyTo } };
}

export function agentMessageEnvelope(agentId, row) {
  const origin = normalizeInteractionOrigin(row.origin_json);
  if (!interactionUuid(agentId) || row.agent_user_id !== agentId || row.kind !== 'message' || row.channel !== origin.channel
    || row.actor_ref !== origin.actorRef || row.conversation_ref !== origin.conversationRef) memoryFail('AGENT_CONTEXT_SOURCE_INVALID', 503);
  let replyTo = null, channelSource = null, referenceResolution = null;
  if (row.input_json.messageV2 !== undefined) {
    if (!memoryExact(row.input_json.messageV2, ['schemaVersion', 'replyTo', 'channelSource', 'referenceResolution', 'requiredContextVersion']) || row.input_json.messageV2.schemaVersion !== 'agent-message-source-v2'
      || (row.input_json.messageV2.requiredContextVersion !== undefined && row.input_json.messageV2.requiredContextVersion !== 2)) memoryFail('AGENT_MESSAGE_V2_INVALID');
    replyTo = normalizeAgentMessageInputV2({ schemaVersion: 'agent-message-input-v2', requestId: row.input_json.requestId,
      message: row.input_json.message, context: row.input_json.context, replyTo: row.input_json.messageV2.replyTo }).messageV2.replyTo;
    if(row.input_json.messageV2.channelSource !== undefined){
      channelSource=normalizeQQMessageSource(origin,row.input_json.messageV2.channelSource);
      referenceResolution=normalizeChannelReferenceResolution(channelSource,row.input_json.messageV2.referenceResolution,replyTo);
    }else if(row.input_json.messageV2.referenceResolution !== undefined) memoryFail('AGENT_CHANNEL_REFERENCE_INVALID');
  }
  const input = normalizeInteractionInput({ requestId: row.input_json.requestId, message: row.input_json.message, context: row.input_json.context });
  return freezeMemory({ schemaVersion: 'agent-message-envelope-v2', messageRef: row.id,
    sourceRef: { store: 'agent_interactions', recordId: row.id, field: 'input_json.message', inputSha256: row.input_sha256 },
    scope: { agentId, channel: origin.channel, actorRef: origin.actorRef, conversationRef: origin.conversationRef },
    spaceRef: origin.channel === 'qq' ? { kind: 'group', botId: origin.botId, groupId: origin.groupId } : { kind: 'private', actorRef: origin.actorRef },
    threadRef: origin.conversationRef, author: { kind: origin.channel === 'web' ? 'platform-user' : 'qq-user', id: origin.actorRef },
    channelMessageRef: { channel: origin.channel, eventRef: origin.eventRef, direction: 'inbound' },
    createdAt: memoryIso(row.created_at), segments: [{ type: 'text', text: input.message }],
    // Legacy interactions do not retain raw mention segments. Never invent
    // native metadata from a display name or text that happens to contain @.
    mentions: channelSource ? { state: 'verified-channel', items: channelSource.mentions } : { state: 'not-recorded', items: [] },
    replyTo, ...(channelSource ? { channelSource, referenceResolution } : {}), practiceContext: input.context });
}

export function createAgentMessageIngressV2({ repository, interactionService }) {
  return Object.freeze({ async receive(rawOrigin, rawInput, trustedMetadata = null) {
    const origin = normalizeInteractionOrigin(rawOrigin), input = normalizeAgentMessageInputV2(rawInput);
    if (origin.channel === 'qq' && input.context) memoryFail('AGENT_INTERACTION_CONTEXT');
    if (origin.channel === 'web' && origin.eventRef.toLowerCase() !== input.requestId) memoryFail('AGENT_INTERACTION_REQUEST_CONFLICT', 409);
    if(trustedMetadata!==null){
      if(!memoryExact(trustedMetadata,['channelSource','referenceResolution','requiredContextVersion'])||trustedMetadata.requiredContextVersion!==2)memoryFail('AGENT_CHANNEL_SOURCE_INVALID');
      input.messageV2={...input.messageV2,requiredContextVersion:2};
      if(origin.channel==='qq'){
        const channelSource=normalizeQQMessageSource(origin,trustedMetadata.channelSource);
        const referenceResolution=normalizeChannelReferenceResolution(channelSource,trustedMetadata.referenceResolution,input.messageV2.replyTo);
        input.messageV2={...input.messageV2,channelSource,referenceResolution};
      }else if(trustedMetadata.channelSource!==undefined||trustedMetadata.referenceResolution!==undefined)memoryFail('AGENT_CHANNEL_SOURCE_INVALID');
    }
    await interactionService.authorize(origin);
    const row = await repository.accept({ agentId: interactionService.agentId, origin, input });
    return agentMessageEnvelope(interactionService.agentId, row);
  } });
}
