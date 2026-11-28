import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { interactionUuid } from './agent-interaction-contracts.mjs';

export class AgentMemoryReadOnlyError extends Error {
  constructor(code, statusCode = 400) { super(code); this.code = code; this.statusCode = statusCode; this.retryable = false; }
}
export const memoryFail = (code, status = 400) => { throw new AgentMemoryReadOnlyError(code, status); };
export const memoryExact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
export const memoryKinds = Object.freeze(['conversation', 'research', 'editorial']);
const subjects = ['project', 'comparison', 'topic', 'claim', 'scenario'];

export function normalizeMemoryReference(value, kind) {
  if (!memoryKinds.includes(kind) || !memoryExact(value, ['kind', 'interactionId', 'part', 'taskId', 'bindingId', 'evidenceId', 'subjectKind', 'subjectKey', 'eventId']) || value.kind !== kind) memoryFail('AGENT_MEMORY_REFERENCE_INVALID');
  if (kind === 'conversation') {
    if (!memoryExact(value, ['kind', 'interactionId', 'part', 'taskId']) || !interactionUuid(value.interactionId)
      || !['request', 'reply', 'task-reply'].includes(value.part)
      || (value.part === 'task-reply' ? !interactionUuid(value.taskId) : value.taskId !== undefined)) memoryFail('AGENT_MEMORY_REFERENCE_INVALID');
  } else if (kind === 'research') {
    if (!memoryExact(value, ['kind', 'bindingId', 'evidenceId']) || !interactionUuid(value.bindingId) || !interactionUuid(value.evidenceId)) memoryFail('AGENT_MEMORY_REFERENCE_INVALID');
  } else if (!memoryExact(value, ['kind', 'subjectKind', 'subjectKey', 'eventId']) || !subjects.includes(value.subjectKind)
    || typeof value.subjectKey !== 'string' || value.subjectKey.length < 3 || value.subjectKey.length > 512
    || value.subjectKey.includes('\0') || !interactionUuid(value.eventId)) memoryFail('AGENT_MEMORY_REFERENCE_INVALID');
  return structuredClone(value);
}

export function normalizeMemoryRead(input) {
  if (!memoryExact(input, ['kind', 'limit', 'reference', 'use']) || !memoryKinds.includes(input.kind)) memoryFail('AGENT_MEMORY_INPUT_INVALID');
  const max = input.kind === 'conversation' ? 4 : input.kind === 'editorial' ? 200 : 50;
  const limit = input.limit ?? (input.kind === 'research' ? 20 : max);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max || (input.kind === 'conversation' && limit !== 4)) memoryFail('AGENT_MEMORY_INPUT_INVALID');
  const use = input.use ?? 'analysis';
  if (input.kind !== 'research' ? input.use !== undefined : !['analysis', 'citation', 'comparison', 'notification'].includes(use)) memoryFail('AGENT_MEMORY_INPUT_INVALID');
  return { kind: input.kind, limit, use, reference: input.reference === undefined ? null : normalizeMemoryReference(input.reference, input.kind) };
}

export function memoryRecord({ kind, reference, scope, content, provenance, capturedAt, observation }) {
  return { schemaVersion: 'agent-memory-readonly-record-v1', kind, reference, scope, content,
    provenance, capturedAt, contentSha256: stableHash(content), observation };
}
export const memoryIso = value => {
  if (value === null || value === undefined) memoryFail('AGENT_MEMORY_SOURCE_INVALID', 503);
  const date = new Date(value); if (!Number.isFinite(date.getTime())) memoryFail('AGENT_MEMORY_SOURCE_INVALID', 503); return date.toISOString();
};
export function freezeMemory(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeMemory); Object.freeze(value); }
  return value;
}
