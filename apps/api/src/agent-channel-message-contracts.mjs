import { normalizeInteractionOrigin } from './agent-interaction-contracts.mjs';
import { memoryExact, memoryFail } from './agent-memory-readonly-contracts.mjs';

export const nativeMessageId = value => typeof value === 'string' && /^-?(0|[1-9][0-9]{0,15})$/.test(value)
  && Number.isSafeInteger(Number(value)) && String(Number(value)) === value;

export function normalizeQQMessageSource(originValue, source) {
  const origin = normalizeInteractionOrigin(originValue);
  if (origin.channel !== 'qq' || !memoryExact(source, ['schemaVersion', 'botId', 'groupId', 'userId', 'messageId', 'mentions', 'replyMessageId'])
    || source.schemaVersion !== 'qq-message-source-v2' || source.botId !== origin.botId || source.groupId !== origin.groupId
    || source.userId !== origin.actorRef || source.messageId !== origin.eventRef || !nativeMessageId(source.messageId)
    || !Array.isArray(source.mentions) || source.mentions.length < 1 || source.mentions.length > 32
    || source.mentions.some(id => typeof id !== 'string' || !/^[1-9][0-9]{4,15}$/.test(id) || !Number.isSafeInteger(Number(id)))
    || !source.mentions.includes(origin.botId) || new Set(source.mentions).size !== source.mentions.length
    || (source.replyMessageId !== null && !nativeMessageId(source.replyMessageId))) memoryFail('AGENT_CHANNEL_SOURCE_INVALID');
  return structuredClone(source);
}

export function normalizeChannelReferenceResolution(source, value, replyTo) {
  if (!source?.replyMessageId) {
    if (value != null || replyTo != null) memoryFail('AGENT_CHANNEL_REFERENCE_INVALID');
    return null;
  }
  if (!memoryExact(value, ['state', 'reason', 'nativeMessageId', 'sourceValueSha256']) || !['resolved', 'missing', 'forbidden', 'expired'].includes(value.state)
    || value.nativeMessageId !== source.replyMessageId || typeof value.reason !== 'string' || !/^[a-z][a-z-]{1,80}$/.test(value.reason)
    || (value.state === 'resolved' ? !replyTo || !/^[a-f0-9]{64}$/.test(value.sourceValueSha256 ?? '') : replyTo != null || value.sourceValueSha256 !== undefined)) memoryFail('AGENT_CHANNEL_REFERENCE_INVALID');
  return structuredClone(value);
}
