import { createHmac, timingSafeEqual } from 'node:crypto';
import { channelCanonical } from './agent-channel-protocol.mjs';
import { interactionUuid, interactionFail } from './agent-interaction-contracts.mjs';

export const AGENT_CHANNEL_CONTEXT_PATH = '/v2/internal/agent/qq/messages';
export function agentContextChannelSignature(secret, timestamp, requestId, body) {
  return createHmac('sha256', secret).update('mooyu-agent-channel-context-v2\nPOST\n' + AGENT_CHANNEL_CONTEXT_PATH + '\n'
    + timestamp + '\n' + requestId + '\n' + channelCanonical(body)).digest('hex');
}
export function verifyAgentContextChannelSignature(secret, headers, body, now = Date.now()) {
  const timestamp = headers['x-agent-channel-time'], requestId = headers['x-agent-channel-request'], signature = headers['x-agent-channel-signature'];
  if (!/^[a-f0-9]{64}$/i.test(secret ?? '') || !/^\d{13}$/.test(timestamp ?? '') || Math.abs(now - Number(timestamp)) > 30000
    || !interactionUuid(requestId) || !/^[a-f0-9]{64}$/i.test(signature ?? '')) interactionFail('AGENT_CHANNEL_UNAUTHORIZED', 401);
  const expected = agentContextChannelSignature(secret, timestamp, requestId, body);
  if (!timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected))) interactionFail('AGENT_CHANNEL_UNAUTHORIZED', 401);
}
