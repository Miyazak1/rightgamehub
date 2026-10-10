const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

test('Quiz Runner builds as a self-contained GameHub Web ZIP', async () => {
  execFileSync(process.execPath, ['scripts/build-quiz-runner.mjs'], { cwd: root, stdio: 'pipe' });
  const output = path.join(root, '.runtime/quiz-runner-web');
  const [index, play, runner, setup, runtime, playBootstrap, setupBootstrap, styles, manifest, license, lock, report] = await Promise.all([
    fs.readFile(path.join(output, 'index.html'), 'utf8'),
    fs.readFile(path.join(output, 'play.html'), 'utf8'),
    fs.readFile(path.join(output, 'quiz-runner.js'), 'utf8'),
    fs.readFile(path.join(output, 'setup.html'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub-runtime.mjs'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub-play-bootstrap.mjs'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub-setup-bootstrap.mjs'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub-shell.css'), 'utf8'),
    fs.readFile(path.join(output, 'platform.json'), 'utf8'),
    fs.readFile(path.join(output, 'LICENSE.txt'), 'utf8'),
    fs.readFile(path.join(output, 'upstream.lock.json'), 'utf8'),
    fs.readFile(path.join(output, 'build-report.json'), 'utf8'),
  ]);
  assert.match(index, /团队答题赛/);
  assert.match(index, /play\.html\?sample=1/);
  assert.match(index, /setup\.html/);
  assert.match(styles, /@media\(max-width:720px\)/);
  assert.match(play, /gamehub-play-bootstrap\.mjs/);
  assert.match(play, /gamehub-runtime\.css/);
  assert.match(runner, /gamehubSafeStorage\.getItem/);
  assert.doesNotMatch(runner, /\blocalStorage\b/);
  assert.match(runner, /downloadJson\('quiz-snapshot-/);
  assert.match(runner, /quiz-runner-leaderboard/);
  assert.match(runner, /Export results \(JSON\)/);
  assert.match(setup, /保存题包并开始比赛/);
  assert.match(setup, /gamehubStartQuiz\(data\)/);
  assert.doesNotMatch(setup, /downloadBlob\(html, 'QuizRunner\.html'/);
  assert.match(runtime, /client\.localSave\.read/);
  assert.match(runtime, /client\.localSave\.write/);
  assert.match(runtime, /client\.files\.download/);
  assert.match(playBootstrap, /readActiveQuiz/);
  assert.match(playBootstrap, /gamehubSafeStorage/);
  assert.match(setupBootstrap, /writeActiveQuiz/);
  assert.deepEqual(JSON.parse(manifest), { version: 1, entry: 'index.html', capabilities: ['fullscreen','localSave','fileExport'] });
  assert.match(license, /Copyright \(c\) 2026 Yobin Timilsena/);
  assert.equal(JSON.parse(lock).commit, '56eb84028f6c5df849d353a2469d362333651ea6');
  const parsed = JSON.parse(report);
  assert.equal(parsed.upstream.commit, '56eb84028f6c5df849d353a2469d362333651ea6');
  assert.deepEqual(parsed.capabilities.sort(), ['fileExport','fullscreen','localSave']);
  assert.equal(parsed.doctor.errors, 0);
  assert.ok(parsed.files >= 15);
  assert.ok((await fs.stat(path.join(root, 'artifacts/quiz-runner-gamehub-v1.zip'))).size > 100_000);
});

test('vendored Quiz Runner upstream remains healthy', () => {
  execFileSync(process.execPath, ['--test'], { cwd: path.join(root, 'samples/quiz-runner/upstream'), stdio: 'pipe' });
});
