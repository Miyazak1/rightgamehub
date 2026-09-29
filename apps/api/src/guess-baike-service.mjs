import { readFileSync } from 'node:fs';
import { evaluateWikipediaIntro } from '../../../packages/platform-client/src/guess-baike-policy.mjs';

const puzzleBank = JSON.parse(readFileSync(new URL('../../../packages/platform-client/src/guess-baike-puzzles.json', import.meta.url), 'utf8'));
const chinaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const dateOnly = value => value instanceof Date ? chinaDate(value) : String(value).slice(0, 10);
const puzzleView = row => ({
  id: row.id, title: row.title, aliases: row.aliases, category: row.category, sourceKind: row.source_kind, sourceTitle: row.source_title,
  sourceUrl: row.source_url, sourceRevision: Number(row.source_revision), sourceUpdatedAt: new Date(row.source_updated_at).toISOString(), license: row.license,
  introHanCount: Number(row.intro_han_count), content: row.content,
});

export class GuessBaikeError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'GuessBaikeError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}

export function createGuessBaikeService({ repository, clock = () => new Date() } = {}) {
  const requireAdmin = actor => { if (!actor?.userId || (actor.role ?? actor.profile?.role) !== 'admin') throw new GuessBaikeError('FORBIDDEN', 403, '仅管理员可管理官方题库。'); };
  const service = {
    authorizeAdmin(actor) { requireAdmin(actor); },
    async seedBuiltIns() {
      if (!repository) return;
      const puzzles = puzzleBank.puzzles.map(puzzle => {
        const quality = evaluateWikipediaIntro(puzzle.content);
        const validSource = puzzle.sourceKind === 'wikipedia-lead' && /^https:\/\/zh\.wikipedia\.org\/wiki\//.test(puzzle.sourceUrl) && puzzle.license === 'CC BY-SA 4.0';
        return { ...puzzle, status: quality.eligible && validSource ? 'ready' : 'disabled', qualityReason: quality.reason ?? (validSource ? null : '来源或许可不符合官方题库规则') };
      });
      await repository.seed(puzzles, clock());
    },
    async daily(date = chinaDate(clock())) {
      const row = repository ? await repository.daily(date) : null;
      if (!row) throw new GuessBaikeError('PUZZLE_UNAVAILABLE', 503, '今日题目暂时不可用。');
      return { date, schemaVersion: puzzleBank.schemaVersion, generatedAt: puzzleBank.generatedAt, puzzle: puzzleView(row) };
    },
    async assertPuzzle(date, puzzleId) {
      const daily = await service.daily(date);
      if (daily.puzzle.id !== puzzleId || date !== chinaDate(clock())) throw new GuessBaikeError('PUZZLE_MISMATCH', 409, '成绩与今日发布题目不匹配。');
    },
    async listAdmin(actor) {
      requireAdmin(actor);
      return (await repository.list()).map(row => ({ ...puzzleView(row), status: row.status, qualityReason: row.quality_reason, scheduledDates: row.scheduled_dates.map(dateOnly) }));
    },
    async setStatus(actor, id, status) {
      requireAdmin(actor);
      if (!['ready','disabled'].includes(status)) throw new GuessBaikeError('SCHEMA_INVALID', 400, '题目状态无效。');
      const row = await repository.setStatus(id,status,clock());
      if (!row) throw new GuessBaikeError(status === 'ready' ? 'PUZZLE_NOT_READY' : 'NOT_FOUND', status === 'ready' ? 409 : 404, status === 'ready' ? '题目未通过质量检查，不能启用。' : '题目不存在。');
      return { ...puzzleView(row), status: row.status, qualityReason: row.quality_reason, scheduledDates: [] };
    },
    async schedule(actor, input) {
      requireAdmin(actor);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < chinaDate(clock())) throw new GuessBaikeError('SCHEDULE_DATE_CLOSED', 409, '只能排期今天或未来日期。');
      const row = await repository.schedule({ ...input, userId: actor.userId, now: clock() });
      if (!row) throw new GuessBaikeError('PUZZLE_NOT_READY', 409, '只有通过质量检查且已启用的题目可以排期。');
      return { date: dateOnly(row.puzzle_date), puzzleId: row.puzzle_id };
    },
  };
  return service;
}
