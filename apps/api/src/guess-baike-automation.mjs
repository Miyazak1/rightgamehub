import crypto from 'node:crypto';
import { GUESS_BAIKE_SELECTION_POLICY_VERSION, countHan, evaluateGuessBaikeSelection, normalizeWikipediaIntro } from '../../../packages/platform-client/src/guess-baike-policy.mjs';

const chinaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0,10); };
const dateOnly = value => value instanceof Date ? chinaDate(value) : String(value).slice(0,10);
const unsuitableTitle = /(?:消歧义|列表|一览|索引|年表|清单|目录|人物表|作品列表)/u;

export function wikipediaCandidateUrl(batchSize) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'random', grnnamespace: '0', grnfilterredir: 'nonredirects',
    grnlimit: String(batchSize), grnminsize: '2000', prop: 'extracts|info|pageprops|categories|pageviews', exintro: '1', explaintext: '1',
    exlimit: 'max', inprop: 'url', ppprop: 'disambiguation', cllimit: 'max', clshow: '!hidden', pvipdays: '60', redirects: '1', variant: 'zh-cn', maxlag: '5',
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
  const revision = page.revisions?.[0]; const revisionId = page.lastrevid ?? revision?.revid; const revisionTime = page.touched ?? revision?.timestamp;
  if (!Number.isInteger(page.pageid) || !Number.isInteger(revisionId) || !revisionTime || !page.canonicalurl) return { accepted: false, reason: '缺少可追溯修订信息' };
  const categories = (page.categories ?? []).map(item => item?.title).filter(Boolean);
  const content = normalizeWikipediaIntro(page.extract); const hanCount = countHan(content);
  if (!hanCount) return { accepted: false, reason: '条目没有可用的中文导言' };
  const selection = evaluateGuessBaikeSelection({ title: page.title, content, categories, pageviews: page.pageviews });
  const accepted = selection.eligible;
  return { accepted, reason: selection.reason, puzzle: {
    id: `wikipedia-${page.pageid}`, title: page.title, aliases: [], category: selection.category ?? '规则拒绝',
    sourceKind: 'wikipedia-lead', sourceTitle: page.title, sourceUrl: page.canonicalurl, sourceRevision: revisionId,
    sourceUpdatedAt: revisionTime, license: 'CC BY-SA 4.0', introHanCount: selection.hanCount ?? hanCount, content: selection.content ?? content,
    status: accepted ? 'ready' : 'rejected', qualityReason: selection.reason,
    selectionSignals: { policyVersion: GUESS_BAIKE_SELECTION_POLICY_VERSION, ...(selection.signals ?? {}), categories: categories.slice(0, 80), reasonCode: selection.reasonCode },
  } };
}

export function createGuessBaikeAutomation({ repository, fetchImpl = fetch, clock = () => new Date(), logger = console, enabled = true, intervalMinutes = 360, batchSize = 20, scheduleDays = 14, userAgent } = {}) {
  let running = false; let timer = null; let firstRun = null;
  const fillSchedule = async now => {
    const fromDate = chinaDate(now); const toDate = addDays(fromDate, scheduleDays - 1);
    const snapshot = await repository.automationSnapshot(fromDate,toDate);
    if (!snapshot.puzzles.length) return 0;
    const puzzleById = new Map(snapshot.puzzles.map(item => [item.id,item]));
    const scheduled = new Map(snapshot.schedules.map(item => [dateOnly(item.puzzle_date), item]));
    const recent = snapshot.schedules.map(item => ({ id:item.puzzle_id, category:item.category ?? puzzleById.get(item.puzzle_id)?.category })).slice(-7); let inserted = 0;
    for (let offset = 0; offset < scheduleDays; offset += 1) {
      const date = addDays(fromDate,offset); if (scheduled.has(date)) { const item=scheduled.get(date); recent.push({ id:item.puzzle_id,category:item.category ?? puzzleById.get(item.puzzle_id)?.category }); continue; }
      const avoidIds = new Set(recent.slice(-Math.min(7,Math.max(0,snapshot.puzzles.length - 1))).map(item => item.id));
      const avoidCategories = new Set(recent.slice(-2).map(item => item.category).filter(Boolean));
      const balancedPool = snapshot.puzzles.filter(item => !avoidIds.has(item.id) && !avoidCategories.has(item.category));
      const uniquePool = snapshot.puzzles.filter(item => !avoidIds.has(item.id));
      const candidates = balancedPool.length ? balancedPool : uniquePool.length ? uniquePool : snapshot.puzzles;
      const seed = Array.from(date).reduce((sum,char) => sum + char.charCodeAt(0),0);
      const puzzle = candidates[seed % candidates.length];
      if (await repository.insertAutomaticSchedule({ date, puzzleId: puzzle.id, now })) { inserted += 1; recent.push(puzzle); }
    }
    return inserted;
  };
  const runOnce = async () => {
    if (!enabled || running) return { skipped: true };
    running = true; const id = crypto.randomUUID(); const startedAt = clock(); let fetchedCount = 0; let acceptedCount = 0; let scheduledCount = 0;
    try {
      await repository.startAutomationRun({ id, now: startedAt });
      try {
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
        let pages; try { pages = await fetchWikipediaCandidates({ fetchImpl,batchSize,userAgent,signal: controller.signal }); } finally { clearTimeout(timeout); }
        fetchedCount = pages.length;
        const results = pages.map(evaluateCandidate); const puzzles = results.filter(result => result.puzzle).map(result => result.puzzle);
        acceptedCount = results.filter(result => result.accepted).length;
        if (puzzles.length) await repository.seed(puzzles,clock());
        scheduledCount = await fillSchedule(clock());
        await repository.finishAutomationRun({ id,now: clock(),status: 'succeeded',fetchedCount,acceptedCount,scheduledCount });
        return { id,status: 'succeeded',fetchedCount,acceptedCount,scheduledCount };
      } catch (error) {
        try { scheduledCount = await fillSchedule(clock()); } catch (scheduleError) { logger.error?.({ error: scheduleError.message }, 'Guess Baike fallback scheduling failed'); }
        await repository.finishAutomationRun({ id,now: clock(),status: 'failed',fetchedCount,acceptedCount,scheduledCount,errorCode: error.code ?? error.name ?? 'AUTOMATION_FAILED',errorMessage: String(error.message ?? error).slice(0,500) });
        throw error;
      }
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
