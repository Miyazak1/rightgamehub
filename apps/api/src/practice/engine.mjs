import { createRequire } from 'node:module';
import { createHash, randomInt } from 'node:crypto';
import { mathTopics } from '../../../../packages/practice-core/src/catalog.mjs';
import { PracticeError } from './error.mjs';

const require = createRequire(import.meta.url);
const runtime = require('../../../../question-engine/math-v143/runtime.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createVerifiedMathEngine({ enabled = true } = {}) {
  let cells, issue;
  const catalog = () => {
    if (!enabled) return [];
    try { return cells ??= runtime.catalog().cells; }
    catch { issue = 'ENGINE_NOT_INSTALLED'; return []; }
  };
  return {
    capabilities() {
      const available = catalog();
      return { ready: available.length > 0, code: enabled ? issue ?? null : 'ENGINE_DISABLED',
        engineVersion: '1.43.0', topics: mathTopics.map(topic => ({ ...topic,
          difficultyIds: topic.difficultyIds.filter(d => available.some(c => c.topicCode === topic.engineTopic && c.difficulty === d && c.scopes.some(s => s.samplingMode === 'parameter-seed' || s.capacity > 0))),
        })) };
    },
    async generate(config) {
      const topic = mathTopics.find(t => t.id === config.topicId);
      const cell = catalog().find(c => c.topicCode === topic?.engineTopic && c.difficulty === config.difficultyId);
      if (!cell) throw new PracticeError('PRACTICE_UNSUPPORTED', 422, '所选范围暂不支持出题。');
      const scopes = cell.scopes.filter(s => s.samplingMode === 'parameter-seed' || s.capacity > 0);
      const scope = scopes[randomInt(scopes.length)];
      const input = { cellId: cell.id, scopeId: scope.id, seed: randomInt(scope.samplingMode === 'finite-stock-index' ? scope.capacity : 2147483647) };
      const output = await runtime.generateVerifiedQuestion(input);
      const r = output.result, c = r?.candidate;
      if (output.applicationVersion !== '1.43.0' || output.providerCalls !== 0 || output.costUsd !== 0
        || output.task.cellId !== input.cellId || output.task.scopeId !== input.scopeId || output.task.seed !== input.seed
        || !r?.passed || !r.gate?.passed || r.admission?.status !== 'eligible_before_history'
        || r.questionArtifact?.cellId !== input.cellId || r.questionArtifact?.scopeId !== input.scopeId
        || !r.questionArtifact.identity?.identityHash || !r.contentHash
        || c?.subject !== 'math' || String(c.questionType).replaceAll('_','-') !== 'single-choice'
        || r.gate.checks.oracle !== true || r.gate.checks.solver !== true
        || Object.entries(r.gate.checks).some(([key, value]) => !['labNovelty', 'mathIdentity'].includes(key) && value !== true)
        || c.options?.length !== 4 || new Set(c.options.map(o => o.id)).size !== 4
        || !c.options.some(o => o.id === c.correctAnswer)) {
        throw new PracticeError('PRACTICE_VERIFICATION_REJECTED', 503, '本次题目未通过核验，请重试。');
      }
      const identityKey = hash([input.scopeId, r.questionArtifact.identity.identityHash]);
      const content = { prompt: c.prompt, options: c.options, correctAnswer: c.correctAnswer,
        explanation: c.explanation, localizations: c.localizations, figures: output.figures };
      return { id: hash([identityKey, r.contentHash]), identityKey, topicId: config.topicId,
        difficultyId: config.difficultyId, ...content, version: hash(content),
        evidence: { engineVersion: output.applicationVersion, task: output.task,
          contentHash: r.contentHash, fingerprint: r.fingerprint, artifact: r.questionArtifact,
          gate: r.gate, admission: r.admission, generationSource: r.generationSource } };
    },
  };
}
