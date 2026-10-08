import { GUESS_BAIKE_WORK_ID, guessBaikeWork } from './built-in-works.mjs';

export class EngagementError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'EngagementError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}

const view = row => ({
  workId: row.work_key,
  savedAt: row.saved_at ? new Date(row.saved_at).toISOString() : null,
  lastPlayedAt: row.last_played_at ? new Date(row.last_played_at).toISOString() : null,
  playCount: Number(row.play_count),
});

export function createEngagementService({ repository, catalogService, clock = () => new Date() }) {
  const getWork = async workKey => {
    if (workKey === GUESS_BAIKE_WORK_ID) return guessBaikeWork;
    try { return await catalogService.get(workKey); } catch { throw new EngagementError('NOT_FOUND', 404, '作品不存在或已经撤下。'); }
  };
  return {
    async list(actor,query={}) {
      const limit=query.limit==null?null:Number(query.limit),recent=query.recent===true;
      if(limit!==null&&(!Number.isInteger(limit)||limit<1||limit>100))throw new EngagementError('SCHEMA_INVALID',400,'limit must be between 1 and 100.');
      const entries = await repository.list(actor.userId,{limit,recent});
      const items = [];
      for (const row of entries) {
        try { items.push({ ...view(row), work: await getWork(row.work_key) }); } catch {}
      }
      return items;
    },
    async get(actor, workKey) { const row = await repository.get(actor.userId, workKey); return row ? view(row) : { workId: workKey, savedAt: null, lastPlayedAt: null, playCount: 0 }; },
    async save(actor, workKey) { await getWork(workKey); return view(await repository.save(actor.userId, workKey, clock())); },
    async unsave(actor, workKey) { const row = await repository.unsave(actor.userId, workKey, clock()); return row ? view(row) : { workId: workKey, savedAt: null, lastPlayedAt: null, playCount: 0 }; },
    async recordPlay(actor, workKey) { await getWork(workKey); return view(await repository.recordPlay(actor.userId, workKey, clock())); },
    async saveGuessResult(actor, input) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.puzzleDate) || !Number.isInteger(input.guessedCount) || !Number.isInteger(input.elapsedSeconds) || !Number.isInteger(input.hints)) throw new EngagementError('SCHEMA_INVALID', 400, '成绩数据无效。');
      await repository.saveGuessResult({ userId: actor.userId, ...input, now: clock() });
      return { saved: true };
    },
  };
}
