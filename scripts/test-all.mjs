import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { tap } from 'node:test/reporters';
import { buildTestInventory } from './support/frozen-test-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const concurrency = Number(process.env.MOOYU_TEST_CONCURRENCY || 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('MOOYU_TEST_CONCURRENCY must be an integer from 1 to 8');
process.chdir(root);
function discover(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? discover(filename) : /\.test\.(?:cjs|mjs)$/u.test(entry.name) ? [filename] : [];
  });
}
const inventory = buildTestInventory(process.argv.length > 2 ? process.argv.slice(2) : discover('tests'));
const reportDir = path.resolve(process.env.MOOYU_TEST_REPORT_DIR || '.runtime/test-all/latest');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'inventory.json'), JSON.stringify(inventory, null, 2));
console.log(`Running ${inventory.files.length} test files; ${inventory.rejectedBaselines.length} immutable rejection contracts run inside their mandatory successor verifiers.`);
const stream = run({
  files: inventory.files.map(file => path.resolve(file)), concurrency, timeout: 180000,
  execArgv: ['--import', new URL('./support/test-process-context.mjs', import.meta.url).href],
});
const failures = []; let passedEvents = 0, summary;
stream.on('test:fail', data => failures.push({ name: data.name, file: data.file, message: data.details?.error?.message }));
stream.on('test:summary', data => { summary = data; });
stream.on('test:pass', () => {
  if (++passedEvents % 250 === 0) {
    const progress = { passedEvents, failures: failures.length };
    fs.writeFileSync(path.join(reportDir, 'progress.json'), JSON.stringify(progress));
    console.log(`Completed ${passedEvents} checks; ${failures.length} unexpected failures.`);
  }
});
const log = fs.createWriteStream(path.join(reportDir, 'results.tap'));
for await (const chunk of stream.compose(tap)) {
  if (!log.write(chunk)) await new Promise(resolve => log.once('drain', resolve));
}
await new Promise(resolve => log.end(resolve));
const result = { files: inventory.files.length, rejectedBaselines: inventory.rejectedBaselines, summary, failures };
fs.writeFileSync(path.join(reportDir, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length ? 1 : 0;
