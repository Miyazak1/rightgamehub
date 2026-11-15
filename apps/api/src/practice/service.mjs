import { practiceSubjects, practiceStages, practiceDifficulties, practiceCurricula, matchesPracticeFilter } from '../../../../packages/practice-core/src/catalog.mjs';
import { rejectPractice } from './error.mjs';

export function publicPracticeQuestion(item, language, reveal = false) {
  const q = item.question, localized = q.localizations?.[language];
  const shown = reveal || item.checked;
  const figure = q.figures?.[shown ? 'review' : 'question']?.[language] ?? null;
  return { id: q.id, version: q.version, prompt: localized?.prompt ?? q.prompt,
    options: (localized?.options ?? q.options).map(({ id, text }) => ({ id, text })),
    answer: item.answer, checked: item.checked, elapsedSeconds: item.elapsedSeconds,
    figure: figure ? { svg: figure.svg, caption: figure.caption } : null,
    ...(shown ? { correctAnswer: q.correctAnswer, explanation: localized?.explanation ?? q.explanation,
      correct: item.answer === q.correctAnswer } : {}) };
}
const summary = batch => ({ id: batch.id, previousId: batch.previousId, config: batch.config,
  status: batch.status, createdAt: batch.createdAt, completedAt: batch.completedAt,
  answered: batch.items.filter(i => i.answer !== null).length, total: batch.config.count,
  ...(batch.status === 'completed' ? { correct: batch.items.filter(i => i.answer === i.question.correctAnswer).length } : {}) });
const project = batch => ({ ...summary(batch), revision: batch.revision, currentIndex: batch.currentIndex,
  errorCode: batch.errorCode, items: batch.items.map(item => publicPracticeQuestion(item, batch.config.language, batch.status === 'completed')) });
const checkKey = key => {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9:_-]{8,128}$/.test(key)) rejectPractice('PRACTICE_KEY_REQUIRED', 400, '请为练习请求提供有效编号。');
};

export function createPracticeService({ repository, engine }) {
  const catalog = (filter = {}) => {
    const capability = engine.capabilities();
    const topics = capability.topics.filter(t => matchesPracticeFilter(t, filter)).map(({ engineTopic, ...topic }) => topic);
    return { schemaVersion: 1, subjects: practiceSubjects, stages: practiceStages, difficulties: practiceDifficulties,
      curricula: practiceCurricula.filter(c => !filter.subjectId || c.subjectId === filter.subjectId), topics,
      ready: capability.ready, code: capability.code, engineVersion: capability.engineVersion,
      questionTypes: ['single-choice'], stageMappingReviewed: false,
      capabilities: { generation: capability.ready, independentAssessment: false, stepGrading: false } };
  };
  const own = async (actor, id) => {
    const b = await repository.get(actor.userId, id);
    if (!b) rejectPractice('PRACTICE_NOT_FOUND', 404, '练习不存在。');
    return b;
  };
  return {
    catalog,
    async insights(actor,query) {
      if(!repository?.insights)rejectPractice('LEARNING_DATA_UNAVAILABLE',503,'学习数据暂不可用。');
      const result=await repository.insights(actor.userId,query);
      const titles=new Map(catalog().topics.map(topic=>[topic.id,topic.title]));
      if(result.summary)result.summary.topics=result.summary.topics.map(topic=>({...topic,title:titles.get(topic.topicId)||topic.topicId}));
      if(result.items)result.items=result.items.map(item=>({...item,topicTitle:titles.get(item.config.topicId)||item.config.topicId}));
      return result;
    },
    async start(actor, input, key) {
      checkKey(key);
      const topic = catalog().topics.find(t => t.id === input.topicId);
      if (!topic || input.subjectId !== topic.subjectId || input.curriculumId !== topic.curriculumId
        || !topic.difficultyIds.includes(input.difficultyId)
        || (input.stageId && !topic.stageIds.includes(input.stageId))
        || ![3, 5, 10].includes(input.count) || !['zh', 'en'].includes(input.language)) {
        rejectPractice('PRACTICE_UNSUPPORTED', 422, '当前筛选范围还没有可用题目，请调整选择。');
      }
      const config = { subjectId: topic.subjectId, curriculumId: topic.curriculumId, stageId: input.stageId || null,
        topicId: topic.id, difficultyId: input.difficultyId, count: input.count, language: input.language };
      return project(await repository.create(actor.userId, config, key));
    },
    async get(actor, id) { return project(await own(actor, id)); },
    async history(actor) {
      const [batches, stats] = await Promise.all([repository.history(actor.userId), repository.stats(actor.userId)]);
      return { batches: batches.map(summary), topics: stats.topics,
        wrong: stats.wrong.map(({ batchId, config, item }) => ({ batchId, config, question: publicPracticeQuestion(item, config.language, true) })) };
    },
    async update(actor, id, input) {
      return project(await repository.mutate(actor.userId, id, b => {
        if (b.status === 'completed' && input.action === 'submit') return false;
        if (b.status !== 'ready') rejectPractice('PRACTICE_NOT_READY', 409, '这批练习当前不能修改。');
        const item = b.items.find(i => i.question.id === input.questionId);
        if (input.action !== 'submit' && !item) rejectPractice('PRACTICE_QUESTION_NOT_FOUND', 404, '题目不在当前练习中。');
        if (item?.checked && input.answer !== undefined && input.answer !== item.answer) rejectPractice('PRACTICE_ANSWER_LOCKED', 409, '已核对的答案不能更改。');
        if (item?.checked && input.action === 'check') return false;
        if (input.expectedRevision !== b.revision) rejectPractice('PRACTICE_REVISION_CONFLICT', 409, '练习已在其他页面更新，请重新加载。');
        if (input.action === 'submit') { b.status = 'completed'; return; }
        if (input.answer !== undefined) {
          if (!item.question.options.some(o => o.id === input.answer)) rejectPractice('PRACTICE_ANSWER_INVALID', 400, '请选择有效选项。');
          item.answer = input.answer;
        }
        if (Number.isInteger(input.elapsedSeconds)) item.elapsedSeconds = Math.max(item.elapsedSeconds, Math.min(input.elapsedSeconds, 86400));
        if (Number.isInteger(input.currentIndex) && input.currentIndex >= 0 && input.currentIndex < b.items.length) b.currentIndex = input.currentIndex;
        if (input.action === 'check') {
          if (!item.answer) rejectPractice('PRACTICE_ANSWER_REQUIRED', 400, '请先选择答案。');
          item.checked = true;
        }
      }));
    },
    async continue(actor, id, key) {
      checkKey(key);
      const b = await own(actor, id);
      return project(await repository.create(actor.userId, b.config, key, id));
    },
    async retry(actor, id) {
      return project(await repository.retry(actor.userId, id));
    },
  };
}

export function createPracticeWorker({ repository, engine, logger = console }) {
  let timer, active, stopping = false;
  async function runOnce() {
    if (active || stopping) return false;
    active = (async () => {
      const batch = await repository.claim();
      if (!batch) return false;
      const heartbeat = setInterval(() => repository.renew(batch).catch(error => logger.error?.({ error: error.message }, 'practice lease renewal failed')), 20000);
      heartbeat.unref?.();
      try {
        const questions = await repository.available(batch);
        const identities = new Set(questions.map(q => q.identityKey));
        for (let attempt = 0; questions.length < batch.config.count && attempt < batch.config.count * 8; attempt++) {
          if (stopping) throw new Error('PRACTICE_WORKER_STOPPED');
          let q;
          try { q = await engine.generate(batch.config); }
          catch (error) { if (error.code === 'PRACTICE_VERIFICATION_REJECTED') continue; throw error; }
          if (!identities.has(q.identityKey) && await repository.unseen(batch.userId, q.identityKey)) {
            identities.add(q.identityKey); questions.push(q);
          }
        }
        if (questions.length !== batch.config.count) throw new Error('PRACTICE_SUPPLY_EXHAUSTED');
        await repository.publish(batch, questions);
      } catch (error) {
        logger.error?.({ code: error.code ?? error.message, batchId: batch.id }, 'practice preparation failed');
        const code = error.message === 'PRACTICE_SUPPLY_EXHAUSTED' ? error.message : 'PRACTICE_PREPARATION_FAILED';
        await repository.fail(batch, code);
      } finally { clearInterval(heartbeat); }
      return true;
    })();
    try { return await active; } finally { active = null; }
  }
  return { runOnce,
    start() { if (timer) return; stopping = false; timer = setInterval(() => runOnce().catch(error => logger.error?.({ error: error.message }, 'practice worker failed')), 1500); timer.unref?.(); },
    async stop() { stopping = true; clearInterval(timer); timer = null; await active; },
  };
}
