import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createZipBuffer } from '../apps/api/src/zip-buffer-writer.mjs';
import { validateWebZip } from '../apps/api/src/web-zip-validator.mjs';
import { inspectStaticWebProject } from '../packages/creator-tools/src/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sample = path.join(root, 'samples/quiz-runner');
const upstream = path.join(sample, 'upstream');
const staging = path.join(root, '.runtime/quiz-runner-upstream-build');
const output = path.join(root, '.runtime/quiz-runner-web');
const artifact = path.join(root, 'artifacts/quiz-runner-gamehub-v1.zip');
const expectedCommit = '56eb84028f6c5df849d353a2469d362333651ea6';

await fs.rm(staging, { recursive: true, force: true });
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.dirname(staging), { recursive: true });
await fs.cp(upstream, staging, { recursive: true });
execFileSync(process.execPath, ['src/build.js'], { cwd: staging, stdio: 'pipe' });
execFileSync(process.execPath, ['src/build-setup.js'], { cwd: staging, stdio: 'pipe' });
await fs.mkdir(output, { recursive: true });

const replaceRange = (source, from, to, replacement) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`Could not transform Quiz Runner: ${from} -> ${to}`);
  return source.slice(0, start) + replacement + source.slice(end);
};

const injectChrome = html => html
  .replace('</head>', '<link rel="stylesheet" href="gamehub-runtime.css"></head>')
  .replace('<body>', '<body><a class="gamehub-home-link" href="index.html">← 返回工具首页</a>');

let playHtml = await fs.readFile(path.join(staging, 'dist/QuizRunner.html'), 'utf8');
const scriptStart = playHtml.lastIndexOf('<script>');
const scriptEnd = playHtml.lastIndexOf('</script>');
if (scriptStart < 0 || scriptEnd <= scriptStart) throw new Error('Could not find the built runner script.');
let runner = playHtml.slice(scriptStart + '<script>'.length, scriptEnd).replaceAll('localStorage', 'gamehubSafeStorage');
runner = replaceRange(runner, 'function saveSnapshotToFile() {', 'function loadSnapshotFromFile() {', `async function saveSnapshotToFile() {
  try {
    const payload = {
      schema: 2, title: DATA.event.title, savedAt: new Date().toISOString(),
      event: { title: DATA.event.title, dateLong: DATA.event.dateLong || '', venue: DATA.event.venue || '', penaltyPerTeam: DATA.event.tiebreakerPenaltyPerTeam != null ? DATA.event.tiebreakerPenaltyPerTeam : 3 },
      categories: DATA.categories.map((c) => ({ name: c.name, shortName: c.shortName, colour: c.colour })),
      points: { original: DATA.event.pointsOriginal, passed: DATA.event.pointsPassed }, state
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await gamehubQuizRuntime.downloadJson('quiz-snapshot-' + stamp + '.json', payload);
  } catch (e) { alert('Could not save snapshot: ' + (e.message || e)); }
}
`);
runner = replaceRange(runner, 'function exportLeaderboard() {', '/* ---------- audio', `async function exportLeaderboard() {
  try {
    const rows = leaderboardRows();
    const payload = {
      schema: 1, kind: 'quiz-runner-leaderboard', title: DATA.event.title, exportedAt: new Date().toISOString(),
      categories: DATA.categories.map((category) => category.name),
      standings: rows.map((row, index) => ({ rank: index + 1, team: row.name, byCategory: row.byCat, roundsTotal: row.roundsTotal, tiebreaker: row.tieBreak, total: row.total }))
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await gamehubQuizRuntime.downloadJson('quiz-leaderboard-' + stamp + '.json', payload);
  } catch (e) { alert('Could not export results: ' + (e.message || e)); }
}

/* ---------- audio`);
runner = runner.replace("'Export results (CSV)'", "'Export results (JSON)'");
playHtml = injectChrome(playHtml.slice(0, scriptStart) + '<script type="module" src="gamehub-play-bootstrap.mjs"></script>' + playHtml.slice(scriptEnd + '</script>'.length));
await fs.writeFile(path.join(output, 'play.html'), playHtml);
await fs.writeFile(path.join(output, 'quiz-runner.js'), runner);

let setupHtml = await fs.readFile(path.join(staging, 'setup.html'), 'utf8');
setupHtml = replaceRange(setupHtml, 'function doExport() {', 'function downloadBlob(text, filename, mime) {', `async function doExport() {
  const status = document.getElementById('export-status');
  status.innerHTML = '';
  status.appendChild(el('div', { class: 'msg info' }, '正在保存题包…'));
  const outLogos = {
    primary: logos.primary, primaryAlt: logos.primaryAlt || config.event.organiser || '', secondary: logos.secondary, secondaryAlt: logos.secondaryAlt || '',
    titleSponsor: logos.titleSponsor, titleSponsorAlt: logos.titleSponsorAlt || '', collaborators: logos.collaborators.filter((l) => l.src).map((l) => ({ src: l.src, alt: l.alt || '', scale: 1 })),
    supporters: logos.supporters.filter((l) => l.src).map((l) => ({ src: l.src, alt: l.alt || '' })), sponsors: []
  };
  const data = buildData(config, parsedQuestions, images, outLogos);
  try {
    await gamehubStartQuiz(data);
  } catch (err) {
    status.innerHTML = '';
    status.appendChild(el('div', { class: 'msg error' }, err.message || String(err)));
  }
}
`);
setupHtml = replaceRange(setupHtml, 'function downloadBlob(text, filename, mime) {', '/* ============================================================', `function downloadBlob(text, filename, mime) {
  gamehubShowText(filename, text);
}

/* ============================================================
   Wizard chrome`);
setupHtml = injectChrome(setupHtml)
  .replace('</head>', '<script type="module" src="gamehub-setup-bootstrap.mjs"></script></head>')
  .replaceAll('7 · Review & download', '7 · Review & start')
  .replaceAll('Review & download', 'Review & start')
  .replaceAll('Download QuizRunner.html', '保存题包并开始比赛')
  .replaceAll('Fix any red errors before downloading.', 'Fix any red errors before starting.')
  .replace('<title>Quiz Runner Setup</title>', '<title>创建题库 · Quiz Runner</title>');
await fs.writeFile(path.join(output, 'setup.html'), setupHtml);

let resultsHtml = await fs.readFile(path.join(staging, 'results.html'), 'utf8');
resultsHtml = injectChrome(resultsHtml).replace('<title>Quiz Results</title>', '<title>比赛结果 · Quiz Runner</title>');
await fs.writeFile(path.join(output, 'results.html'), resultsHtml);

for (const name of ['index.html','gamehub-shell.css','gamehub-runtime.css','gamehub-runtime.mjs','gamehub-play-bootstrap.mjs','gamehub-setup-bootstrap.mjs','platform.json','LICENSE.txt','README.md','upstream.lock.json']) {
  await fs.copyFile(path.join(sample, name), path.join(output, name));
}
const sdkOutput = path.join(output, 'gamehub-sdk');
await fs.mkdir(sdkOutput, { recursive: true });
for (const entry of await fs.readdir(path.join(root, 'packages/web-game-sdk/src'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) await fs.copyFile(path.join(root, 'packages/web-game-sdk/src', entry.name), path.join(sdkOutput, entry.name));
}

const doctor = await inspectStaticWebProject(output);
if (!doctor.ok) throw new Error(`Local Doctor failed:\n${JSON.stringify(doctor.findings, null, 2)}`);
const files = [];
async function collect(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), relative);
    else files.push({ name: relative, data: await fs.readFile(path.join(directory, entry.name)) });
  }
}
await collect(output);
await fs.mkdir(path.dirname(artifact), { recursive: true });
const archive = createZipBuffer(files);
await fs.writeFile(artifact, archive);
const validationRoot = await fs.mkdtemp(path.join(root, '.runtime/quiz-runner-validation-'));
let validation;
try { validation = await validateWebZip(artifact, path.join(validationRoot, 'expanded')); }
finally { await fs.rm(validationRoot, { recursive: true, force: true }); }
const report = {
  artifact, sha256: crypto.createHash('sha256').update(archive).digest('hex'), bytes: archive.length,
  files: validation.fileCount, entry: validation.entry, capabilities: validation.approvedCapabilities,
  upstream: { repository: 'https://github.com/yobin-tim/quiz-runner', commit: expectedCommit, license: 'MIT', author: 'Yobin Timilsena' },
  doctor: doctor.summary,
};
await fs.writeFile(path.join(output, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
