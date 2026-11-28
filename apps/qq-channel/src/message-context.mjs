import { createHash } from 'node:crypto';
import { parseInbound, reject } from './config.mjs';
import { nativeMessageId } from '../../api/src/agent-channel-message-contracts.mjs';
import { interactionUuid } from '../../api/src/agent-interaction-contracts.mjs';
import { stableHash } from '../../api/src/researcher-qa-protocol/stable-json.mjs';

export function parseInboundWithContext(config, event) {
  if (!Array.isArray(event?.message) || event.message.length > 32) return null;
  const replies = event.message.filter(part => part?.type === 'reply');
  if (replies.length > 1 || event.message.some(part => !['text', 'at', 'reply'].includes(part?.type))) return null;
  const reply = replies[0]?.data;
  if (reply && (Object.keys(reply).some(key => key !== 'id') || !nativeMessageId(String(reply.id)))) return null;
  if (replies.length && !reply) return null;
  const input = parseInbound(config, { ...event, message: event.message.filter(part => part.type !== 'reply') });
  if (!input) return null;
  const mentions = [...new Set(event.message.filter(part => part.type === 'at').map(part => String(part.data?.qq)))];
  if (mentions.some(id => !/^[1-9][0-9]{4,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) return null;
  return { ...input, channelSource: { schemaVersion: 'qq-message-source-v2', botId: config.botId, groupId: config.groupId,
    userId: input.userId, messageId: input.messageId, mentions, replyMessageId: reply ? String(reply.id) : null } };
}

// Only metadata is appended to the existing immutable event journal. The
// accepted input and metadata share the existing admission transaction.
export function createQQMessageContextAdapter({ agentId, clock = () => new Date(), maxAgeSeconds = 600 }) {
  if (!interactionUuid(agentId) || typeof clock !== 'function' || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 600) reject('QQ_CONTEXT_CONFIG_INVALID');
  async function event(c, channelId, messageId, type) {
    const rows = (await c.query('SELECT details FROM mooyu_qq.events WHERE channel_id=$1 AND message_id=$2 AND event_type=$3 ORDER BY id LIMIT 2', [channelId, messageId, type])).rows;
    if (rows.length > 1) reject('QQ_CONTEXT_JOURNAL_AMBIGUOUS');
    return rows[0]?.details ?? null;
  }
  return Object.freeze({ parseInbound: parseInboundWithContext,
    async record(c, input, config) {
      if (!input.channelSource || input.channelSource.groupId !== config.groupId) reject('QQ_CONTEXT_SOURCE_REQUIRED');
      await c.query(`INSERT INTO mooyu_qq.events(channel_id,message_id,event_type,details) VALUES($1,$2,'message-context-v2',$3)`,
        [config.channelId, input.messageId, { schemaVersion: 'qq-accepted-context-v2', source: input.channelSource }]);
    },
    async isContextMessage(c, row) { return Boolean(await event(c, row.channel_id, row.message_id, 'message-context-v2')); },
    async linkedInteraction(c,row){return (await c.query('SELECT interaction_id FROM mooyu_qq.agent_links WHERE channel_id=$1 AND message_id=$2',[row.channel_id,row.message_id])).rows[0]?.interaction_id??null;},
    async prepare(c, row, config, requestId) {
      const accepted = await event(c, row.channel_id, row.message_id, 'message-context-v2');
      if (!accepted) return null;
      if (row.channel_id !== config.channelId || row.origin_group_id !== config.groupId || row.user_id !== accepted.source.userId
        || accepted.source.groupId !== config.groupId || accepted.source.messageId !== row.message_id || accepted.source.botId !== config.botId) reject('QQ_CONTEXT_SCOPE_CHANGED');
      const existing = await event(c, row.channel_id, row.message_id, 'message-context-submission-v2');
      const binding = { requestId, agentId, sourceSha256: stableHash(accepted.source), inputSha256: createHash('sha256').update(row.input_text).digest('hex') };
      if (existing) {
        if (stableHash(existing.binding) !== stableHash(binding) || stableHash(existing.prepared) !== existing.preparedSha256) reject('QQ_CONTEXT_SUBMISSION_CHANGED');
        return { schemaVersion: 'agent-channel-message-v2', requestId, message: row.input_text, ...existing.prepared };
      }
      let replyTo = null, referenceResolution = null;
      const source = accepted.source;
      if (source.replyMessageId !== null) {
        const targetId = source.replyMessageId;
        // Read identifiers and delivery state only. Foreign plaintext is never
        // loaded. Native bot replies require an acknowledged remote message ID.
        const targets = (await c.query(`SELECT m.message_id,m.user_id,m.origin_group_id,m.created_at,m.status,m.error_code,
            m.remote_message_id,l.interaction_id,l.task_id,d.source_message_id,
            EXISTS(SELECT 1 FROM mooyu_qq.agent_image_pages p WHERE p.channel_id=m.channel_id AND p.message_id=m.message_id) AS image
          FROM mooyu_qq.messages m LEFT JOIN mooyu_qq.agent_deliveries d ON d.channel_id=m.channel_id AND d.message_id=m.message_id
          LEFT JOIN mooyu_qq.agent_links l ON l.channel_id=m.channel_id AND l.message_id=COALESCE(d.source_message_id,m.message_id)
          WHERE m.channel_id=$1 AND m.origin_group_id=$2 AND
            ((m.message_id=$3 AND m.input_text<>'') OR (m.remote_message_id=$3 AND m.status='delivered'))
          ORDER BY m.created_at,m.message_id LIMIT 3`, [config.channelId, config.groupId, targetId])).rows;
        const resolution = (state, reason) => ({ state, reason, nativeMessageId: targetId });
        referenceResolution = resolution('missing', 'native-source-unavailable');
        if (targets.length === 1) {
          const target = targets[0], outbound = target.remote_message_id === targetId && target.status === 'delivered';
          const age = new Date(clock()).getTime() - new Date(target.created_at).getTime();
          if (target.user_id !== row.user_id) referenceResolution = resolution('forbidden', 'participant-scope-mismatch');
          else if (!Number.isFinite(age) || age < 0 || age > maxAgeSeconds * 1000) referenceResolution = resolution('expired', 'native-source-age-limit');
          else if (target.image || !interactionUuid(target.interaction_id) || (outbound && target.error_code && !target.source_message_id)) referenceResolution = resolution('missing', 'native-source-not-mappable');
          else {
            const task = outbound && target.source_message_id ? target.task_id : null;
            if (!(outbound && target.source_message_id) || interactionUuid(task)) {
              replyTo = { agentId, channel: 'qq', actorRef: row.user_id, conversationRef: [config.botId, config.groupId, row.user_id].join(':'),
                reference: { kind: 'conversation', interactionId: target.interaction_id, part: outbound ? task ? 'task-reply' : 'reply' : 'request', ...(task ? { taskId: task } : {}) } };
              referenceResolution = resolution('resolved', 'native-source-mapped');
              const visible=(await c.query(`SELECT input_text,reply FROM mooyu_qq.messages WHERE channel_id=$1 AND message_id=$2 AND user_id=$3 AND origin_group_id=$4`,
                [config.channelId,target.message_id,row.user_id,config.groupId])).rows[0];
              if(!visible || typeof (outbound?visible.reply:visible.input_text)!=='string')reject('QQ_CONTEXT_SOURCE_CHANGED');
              referenceResolution.sourceValueSha256=stableHash(outbound?visible.reply:visible.input_text);
            }
          }
        }
      }
      const prepared = { replyTo, source, referenceResolution };
      await c.query(`INSERT INTO mooyu_qq.events(channel_id,message_id,event_type,details) VALUES($1,$2,'message-context-submission-v2',$3)`,
        [row.channel_id, row.message_id, { binding, prepared, preparedSha256: stableHash(prepared) }]);
      return { schemaVersion: 'agent-channel-message-v2', requestId, message: row.input_text, ...prepared };
    },
  });
}
