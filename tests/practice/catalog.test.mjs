import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeService, publicPracticeQuestion } from '../../apps/api/src/practice/service.mjs';
import { mathTopics, matchesPracticeFilter } from '../../packages/practice-core/src/catalog.mjs';

test('school stages and future subjects cannot silently broaden CSCA generation', async () => {
  const engine = { capabilities: () => ({ ready: true, topics: mathTopics, engineVersion: '1.43.0' }) };
  const service = createPracticeService({ engine });
  assert.equal(service.catalog({ subjectId: 'physics' }).topics.length, 0);
  assert.equal(service.catalog({ stageId: 'primary' }).topics.length, 0);
  assert.equal(matchesPracticeFilter(mathTopics[0], { stageId: 'upper-secondary' }), false);
  assert.equal(service.catalog().topics.length, 12);
  assert.equal(JSON.stringify(service.catalog()).includes('engineTopic'), false);
  await assert.rejects(service.start({ userId: 'a' }, { subjectId: 'physics' }, 'test-request-001'), { code: 'PRACTICE_UNSUPPORTED' });
});

test('pre-answer projection hides keys, localized solutions, review figures and verification evidence', () => {
  const item = { answer: null, checked: false, elapsedSeconds: 0, question: {
    id: 'q', version: 'v', prompt: 'Question', options: [{ id: 'A', text: '1' }], correctAnswer: 'A', explanation: 'private solution',
    localizations: { en: { prompt: 'English question', options: [{ id: 'A', text: 'one' }], explanation: 'private English solution' } },
    evidence: { secret: true }, figures: { question: { en: { svg: '<svg/>', caption: 'question' } }, review: { en: { svg: '<svg>ANSWER</svg>', caption: 'private' } } },
  } };
  const projected = publicPracticeQuestion(item, 'en');
  assert.equal(projected.prompt, 'English question');
  assert.equal(projected.figure.caption, 'question');
  assert.doesNotMatch(JSON.stringify(projected), /private|ANSWER|correctAnswer|evidence|localizations/);
  const checked = publicPracticeQuestion({ ...item, checked: true, answer: 'A' }, 'en');
  assert.equal(checked.correct, true); assert.equal(checked.explanation, 'private English solution');
  assert.match(checked.figure.svg, /ANSWER/);
});
