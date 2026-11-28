import { verifyAgentContextChannelSignature, AGENT_CHANNEL_CONTEXT_PATH } from './agent-channel-context-protocol.mjs';
import { interactionUuid } from './agent-interaction-contracts.mjs';
import { memoryExact, memoryFail } from './agent-memory-readonly-contracts.mjs';
import { interactionErrorLabel } from './agent-interaction-routes.mjs';

// Explicit opt-in registration. No existing production registration is changed.
export function registerAgentChannelMessageRoutes(app, { service, requireAuth, channelSecret }) {
  if(typeof requireAuth!=='function'||typeof service?.webReceive!=='function'||!/^[a-f0-9]{64}$/i.test(channelSecret??''))memoryFail('AGENT_CHANNEL_CONTEXT_CONFIG_REQUIRED',503);
  const run = async (reply, action) => {
    reply.header('Cache-Control', 'no-store');
    try { return { data: await action() }; }
    catch (error) {
      const code = /^AGENT_[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'AGENT_INTERACTION_UNAVAILABLE';
      reply.status(error.statusCode ?? 503); return { error: { code, message: interactionErrorLabel(code) } };
    }
  };
  app.post('/v2/me/agent/messages', { preHandler: requireAuth, bodyLimit: 12000 }, async (request, reply) => run(reply, () => service.webReceive(request.actor, request.body)));
  app.post(AGENT_CHANNEL_CONTEXT_PATH, { logLevel: 'silent', bodyLimit: 12000 }, async (request, reply) => run(reply, async () => {
    verifyAgentContextChannelSignature(channelSecret, request.headers, request.body);
    const body = request.body;
    if (!memoryExact(body, ['agentId', 'operation', 'origin', 'input', 'interactionId']) || body.agentId !== service.agentId || body.origin?.channel !== 'qq') memoryFail('AGENT_CHANNEL_INPUT');
    if (body.operation === 'submit') {
      if (body.interactionId !== undefined) memoryFail('AGENT_CHANNEL_INPUT');
      return service.qqReceive(body.origin, body.input);
    }
    if (body.operation !== 'delivery-check' || body.input !== undefined || !interactionUuid(body.interactionId)) memoryFail('AGENT_CHANNEL_INPUT');
    return service.deliveryCheck(body.origin, body.interactionId);
  }));
}
