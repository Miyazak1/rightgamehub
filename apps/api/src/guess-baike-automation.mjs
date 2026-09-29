import crypto from 'node:crypto';
import { evaluateWikipediaIntro, uniqueGuessCharacters } from '../../../packages/platform-client/src/guess-baike-policy.mjs';

const chinaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0,10); };
const dateOnly = value => value instanceof Date ? chinaDate(value) : String(value).slice(0,10);
const unsuitableTitle = /(?:消歧义|列表|一览|索引|年表|清单|目录|人物表|作品列表)/u;
const categoryRules = [
  ['科技', /(?:科学|技术|计算机|软件|物理|化学|生物|工程|数学|互联网|人工智能)/u],
  ['历史', /(?:历史|王朝|帝国|战争|世纪|古代|考古|政治)/u],
  ['地理', /(?:国家|城市|地区|位于|地理|河流|山脉|岛屿|行政区)/u],
  ['文化', /(?:文学|艺术|电影|音乐|语言|宗教|文化|小说|动画)/u],
  ['体育', /(?:体育|比赛|运动|球员|球队|联赛|奥运)/u],
  ['人物', /(?:出生|逝世|人物|作家|演员|科学家|政治家|运动员)/u],
];
const classify = (title, content) => categoryRules.find(([,pattern]) => pattern.test(`${title}\n${content}`))?.[0] ?? '百科';

export function wikipediaCandidateUrl(batchSize) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'random', grnnamespace: '0', grnfilterredir: 'nonredirects',
    grnlimit: String(batchSize), grnminsize: '2000', prop: 'extracts|info|pageprops', exintro: '1', explaintext: '1',
    exlimit: 'max', inprop: 'url', ppprop: 'disambiguation', redirects: '1', variant: 'zh-cn', maxlag: '5',
  });
  return `https://zh.wikipedia.org/w/api.php?${params}`;
}

export async function fetchWikipediaCandidates({ fetchImpl = fetch, batchSize = 20, userAgent, signal } = {}) {
  const agent = String(userAgent || 'GameHub-GuessBaikeBot/0.3 (https://mooyu.fun/; automated daily puzzle) Node.js').trim();
  const response = await fetchImpl(wikipediaCandidateUrl(batchSize), { signal, headers: {
    Accept: 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9', 'User-Agent': agent, 'Api-User-Agent': agent,
  } });
  if (!response.ok) {
    const detail = String(await response.text?.().catch(() => '') || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const error = new Error(`Wikipedia API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    error.code = `WIKIPEDIA_HTTP_${response.status}`; throw error;
  }
  const payload = await response.json();
  if (payload.error) { const error = new Error(payload.error.info || 'Wikipedia API rejected the request'); error.code = `WIKIPEDIA_${String(payload.error.code || 'API_ERROR').toUpperCase()}`; throw error; }
  return payload.query?.pages ?? [];
}

export function evaluateCandidate(page) {
  if (!page || page.missing || page.ns !== 0) return { accepted: false, reason: '不是百科主名字空间条目' };
  if (Object.hasOwn(page.pageprops ?? {}, 'disambiguation') || unsuitableTitle.test(page.title ?? '')) return { accepted: false, reason: '消歧义、列表或索引条目' };
  const titleUnits = uniqueGuessCharacters(page.title ?? '').length;
  if (titleUnits < 2 || titleUnits > 10) return { accepted: false, reason: '标题不适合 2 至 10 字符猜题' };
  const quality = evaluateWikipediaIntro(page.extract);
  if (!quality.eligible) return { accepted: false, reason: quality.reason };
  const revision = page.revisions?.[0]; const revisionId = page.lastrevid ?? revision?.revid; const revisionTime = page.touched ?? revision?.timestamp;
  if (!Number.isInteger(page.pageid) || !Number.isInteger(revisionId) || !revisionTime || !page.canonicalurl) return { accepted: false, reason: '缺少可追溯修订信息' };
  return { accepted: true, puzzle: {
    id: `wikipedia-${page.pageid}`, title: page.title, aliases: [], category: classify(page.title, quality.content),
    sourceKind: 'wikipedia-lead', sourceTitle: page.title, sourceUrl: page.canonicalurl, sourceRevision: revisionId,
    sourceUpdatedAt: revisionTime, license: 'CC BY-SA 4.0', introHanCount: quality.hanCount, content: quality.content,
    status: 'ready', qualityReason: null,
  } };
}

export function createGuessBaikeAutomation({ repository, fetchImpl = fetch, clock = () => new Date(), logger = console, enabled = true, intervalMinutes = 360, batchSize = 20, scheduleDays = 14, userAgent } = {}) {
  let running = false; let timer = null; let firstRun = null;
  const fillSchedule = async now => {
    const fromDate = chinaDate(now); const toDate = addDays(fromDate, scheduleDays - 1);
    const snapshot = await repository.automationSnapshot(fromDate,toDate);
    if (!snapshot.puzzles.length) return 0;
    const scheduled = new Map(snapshot.schedules.map(item => [dateOnly(item.puzzle_date), item.puzzle_id]));
    const recent = snapshot.schedules.map(item => item.puzzle_id).slice(-7); let inserted = 0;
    for (let offset = 0; offset < scheduleDays; offset += 1) {
      const date = addDays(fromDate,offset); if (scheduled.has(date)) { recent.push(scheduled.get(date)); continue; }
      const avoid = new Set(recent.slice(-Math.min(7,Math.max(0,snapshot.puzzles.length - 1))));
      const pool = snapshot.puzzles.filter(item => !avoid.has(item.id));
      const candidates = pool.length ? pool : snapshot.puzzles;
      const seed = Array.from(date).reduce((sum,char) => sum + char.charCodeAt(0),0);
      const puzzle = candidates[seed % candidates.length];
      if (await repository.insertAutomaticSchedule({ date, puzzleId: puzzle.id, now })) { inserted += 1; recent.push(puzzle.id); }
    }
    return inserted;
  };
  const runOnce = async () => {
    if (!enabled || running) return { skipped: true };
    running = true; const id = crypto.randomUUID(); const startedAt = clock(); let fetchedCount = 0; let acceptedCount = 0; let scheduledCount = 0;
    await repository.startAutomationRun({ id, now: startedAt });
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
      let pages; try { pages = await fetchWikipediaCandidates({ fetchImpl,batchSize,userAgent,signal: controller.signal }); } finally { clearTimeout(timeout); }
      fetchedCount = pages.length;
      const puzzles = pages.map(evaluateCandidate).filter(result => result.accepted).map(result => result.puzzle);
      acceptedCount = puzzles.length;
      if (puzzles.length) await repository.seed(puzzles,clock());
      scheduledCount = await fillSchedule(clock());
      await repository.finishAutomationRun({ id,now: clock(),status: 'succeeded',fetchedCount,acceptedCount,scheduledCount });
      return { id,status: 'succeeded',fetchedCount,acceptedCount,scheduledCount };
    } catch (error) {
      try { scheduledCount = await fillSchedule(clock()); } catch (scheduleError) { logger.error?.({ error: scheduleError.message }, 'Guess Baike fallback scheduling failed'); }
      await repository.finishAutomationRun({ id,now: clock(),status: 'failed',fetchedCount,acceptedCount,scheduledCount,errorCode: error.code ?? error.name ?? 'AUTOMATION_FAILED',errorMessage: String(error.message ?? error).slice(0,500) });
      throw error;
    } finally { running = false; }
  };
  const runSafely = () => runOnce().catch(error => logger.error?.({ error: error.message, code: error.code }, 'Guess Baike automation failed; existing schedule remains active'));
  const start = () => { if (!enabled || timer) return; firstRun = setTimeout(runSafely,1000); firstRun.unref?.(); timer = setInterval(runSafely,intervalMinutes * 60_000); timer.unref?.(); };
  const stop = () => { if (firstRun) clearTimeout(firstRun); if (timer) clearInterval(timer); firstRun = null; timer = null; };
  const status = async () => {
    const fromDate = chinaDate(clock()); const row = await repository.automationStatus(fromDate,addDays(fromDate,scheduleDays - 1)); const run = row.run;
    return { enabled, running, intervalMinutes, batchSize, scheduleDays, readyCount: Number(row.ready_count), scheduledCount: Number(row.scheduled_count), lastRun: run ? {
      id: run.id, status: run.status, startedAt: new Date(run.started_at).toISOString(), finishedAt: run.finished_at ? new Date(run.finished_at).toISOString() : null,
      fetchedCount: run.fetched_count, acceptedCount: run.accepted_count, scheduledCount: run.scheduled_count, errorCode: run.error_code, errorMessage: run.error_message,
    } : null };
  };
  return { runOnce,start,stop,status };
}
