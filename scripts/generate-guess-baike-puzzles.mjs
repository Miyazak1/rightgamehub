import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluateWikipediaIntro, MIN_WIKIPEDIA_INTRO_HAN } from '../packages/platform-client/src/guess-baike-policy.mjs';

const root = new URL('../', import.meta.url);
const seedsUrl = new URL('packages/platform-client/src/guess-baike-seeds.json', root);
const outputUrl = new URL('packages/platform-client/src/guess-baike-puzzles.json', root);
const minimumArg = process.argv.find(argument => argument.startsWith('--minimum-han='));
const minimumHan = minimumArg ? Number(minimumArg.split('=')[1]) : MIN_WIKIPEDIA_INTRO_HAN;

if (!Number.isInteger(minimumHan) || minimumHan < 1) throw new Error('--minimum-han 必须是正整数');

const seeds = JSON.parse(await readFile(seedsUrl, 'utf8'));
const puzzles = [];
const rejected = [];

async function fetchLeads(inputSeeds) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    converttitles: '1',
    redirects: '1',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    variant: 'zh-cn',
    titles: inputSeeds.map(seed => seed.title).join('|'),
  });
  const response = await fetch(`https://zh.wikipedia.org/w/api.php?${params}`, {
    headers: { 'user-agent': 'GameHub Guess Baike/0.1 (local puzzle generator)' },
  });
  if (!response.ok) throw new Error(`Wikipedia API 返回 HTTP ${response.status}，题库未覆盖`);
  const payload = await response.json();
  const titleMap = new Map();
  for (const item of [...(payload.query?.normalized ?? []), ...(payload.query?.converted ?? []), ...(payload.query?.redirects ?? [])]) titleMap.set(item.from, item.to);
  const resolveTitle = input => {
    let current = input;
    const seen = new Set();
    while (titleMap.has(current) && !seen.has(current)) { seen.add(current); current = titleMap.get(current); }
    return current;
  };
  const pages = new Map((payload.query?.pages ?? []).map(page => [page.title, page]));
  return inputSeeds.map(seed => {
    const resolvedTitle = resolveTitle(seed.title);
    const page = pages.get(resolvedTitle);
    if (!page || page.missing) throw new Error(`${seed.title}: 词条不存在或标题转换失败`);
    return [seed, page];
  });
}

for (const [seed, page] of await fetchLeads(seeds)) {
  try {
    const result = evaluateWikipediaIntro(page.extract, minimumHan);
    if (!result.eligible) {
      rejected.push({ title: seed.title, reason: result.reason });
      continue;
    }
    puzzles.push({
      id: `wikipedia-${page.pageid}`,
      title: seed.title,
      aliases: [...new Set([...(seed.aliases ?? []), ...(page.title !== seed.title ? [page.title] : [])])],
      category: seed.category,
      sourceKind: 'wikipedia-lead',
      sourceTitle: page.title,
      sourceUrl: page.canonicalurl ?? page.fullurl,
      sourceRevision: page.lastrevid,
      sourceUpdatedAt: page.touched,
      license: 'CC BY-SA 4.0',
      introHanCount: result.hanCount,
      content: result.content,
    });
    process.stdout.write(`✓ ${seed.title}: ${result.hanCount} 个汉字\n`);
  } catch (error) { rejected.push({ title: seed.title, reason: error.message }); }
}

if (!puzzles.length) throw new Error('没有词条通过完整导言长度检查，未覆盖现有题库');

const bank = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  policy: { section: 'lead', complete: true, minimumHan },
  puzzles,
};
await writeFile(outputUrl, `${JSON.stringify(bank, null, 2)}\n`, 'utf8');

for (const item of rejected) process.stderr.write(`跳过 ${item.title}: ${item.reason}\n`);
console.log(`已写入 ${puzzles.length} 道题：${fileURLToPath(outputUrl)}`);

