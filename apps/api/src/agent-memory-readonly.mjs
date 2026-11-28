import { normalizeInteractionOrigin, interactionUuid } from './agent-interaction-contracts.mjs';
import { PostgresAgentInteractionRepository } from './agent-interaction-repository.mjs';
import { memoryExact, memoryFail, normalizeMemoryRead, freezeMemory, memoryIso } from './agent-memory-readonly-contracts.mjs';
import { withAgentMemoryReadOnly } from './agent-memory-readonly-transaction.mjs';
import { readConversationMemory, readResearchMemory, readEditorialMemory } from './agent-memory-readonly-adapters.mjs';

// Internal D1 API. Access is supplied by trusted application code, never model
// tool arguments. No HTTP route, tool registration, workflow or grant is added.
export function createAgentMemoryReadOnlyService({ pool, interactionService, clock = () => new Date() } = {}) {
  if (typeof pool?.connect !== 'function' || !interactionUuid(interactionService?.agentId) || typeof interactionService.authorize !== 'function'
    || typeof clock !== 'function') memoryFail('AGENT_MEMORY_CONFIG_REQUIRED', 503);
  const agentId = interactionService.agentId;
  async function authorize(access, kind) {
    if (kind === 'conversation') {
      if (!memoryExact(access, ['origin', 'interactionId']) || !interactionUuid(access.interactionId)) memoryFail('AGENT_MEMORY_ACCESS_INVALID');
      const origin = normalizeInteractionOrigin(access.origin);
      const result = await interactionService.authorize(origin);
      if (result?.agent?.id !== agentId) memoryFail('AGENT_MEMORY_AGENT_MISMATCH', 403);
      return { origin, interactionId: access.interactionId };
    }
    if (!memoryExact(access, ['actor']) || !memoryExact(access.actor, ['userId', 'profile']) || !interactionUuid(access.actor.userId)) memoryFail('AGENT_MEMORY_ACCESS_INVALID');
    await withAgentMemoryReadOnly(pool, async db => {
      const authority = new PostgresAgentInteractionRepository(db);
      await authority.agent(agentId); await authority.operator(access.actor, agentId);
    });
    return { actor: access.actor };
  }
  async function read(rawAccess, rawRequest) {
    const request = normalizeMemoryRead(rawRequest), access = structuredClone(rawAccess);
    const scope = await authorize(access, request.kind);
    const data = await withAgentMemoryReadOnly(pool, async db => {
      const capturedAt = memoryIso(clock());
      const value = request.kind === 'conversation'
        ? await readConversationMemory(db, agentId, scope.origin, scope.interactionId, request, capturedAt)
        : request.kind === 'research' ? await readResearchMemory(db, agentId, request, capturedAt)
          : await readEditorialMemory(db, agentId, request, capturedAt);
      return { schemaVersion: 'agent-memory-readonly-snapshot-v1', agentId, kind: request.kind, capturedAt,
        consistency: 'repeatable-read-source-snapshot', authorizationRechecked: true,
        deliveryReceiptsResolved: false, ...value };
    });
    await authorize(access, request.kind);
    if (Buffer.byteLength(JSON.stringify(data)) > 16 * 1024 * 1024) memoryFail('AGENT_MEMORY_RESPONSE_TOO_LARGE', 413);
    return freezeMemory(data);
  }
  return Object.freeze({ agentId, read, async explain(access, request) {
    if (!request?.reference) memoryFail('AGENT_MEMORY_REFERENCE_INVALID');
    const value = await read(access, request);
    if (value.records.length !== 1) memoryFail('AGENT_MEMORY_NOT_FOUND', 404);
    const { kind, reference, scope, provenance, capturedAt, contentSha256, observation } = value.records[0];
    return freezeMemory({ kind, reference, scope, provenance, capturedAt, contentSha256, observation });
  } });
}
