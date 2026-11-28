import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// No downloads, existing-service operations, credentials, or live data access.
// The PostgreSQL and Node containers share only their private network namespace.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out-dir') throw Error('EXPLICIT_OUT_DIR_REQUIRED');
const out = path.resolve(args[1]);
if (fs.existsSync(out)) throw Error('FRESH_OUTPUT_DIRECTORY_REQUIRED');
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(16).toString('hex'), owner = 'agent-memory-readonly-' + token;
const pgImage = 'sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const nodeImage = 'sha256:0bd01de2df9ebae386cd5636f2a2f4282e2250bb917ed88fda90c4ab65a89459';
const database = 'qa_ledger_test_' + token, password = randomBytes(20).toString('hex');
const sources = ['apps/api/src/agent-memory-readonly.mjs', 'apps/api/src/agent-memory-readonly-contracts.mjs',
  'apps/api/src/agent-memory-readonly-adapters.mjs', 'apps/api/src/agent-memory-readonly-transaction.mjs',
  'tests/platform/agent-memory-readonly.test.mjs', 'tests/platform/agent-memory-readonly-db.test.cjs',
  'scripts/verify-agent-memory-readonly-local.mjs'];
const sourceHashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const hashesBefore = sourceHashes();
let created = false;
function docker(argv, timeout = 30000) {
  const result = spawnSync('docker', argv, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw Object.assign(Error('ISOLATED_DOCKER_COMMAND_FAILED'), { detail: result.stderr?.slice(-3000), command: argv[0] });
  return result.stdout.trim();
}
try {
  for (const image of [pgImage, nodeImage]) docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  docker(['run', '--detach', '--name', owner, '--label', 'mooyu.local.memory.owner=' + owner, '--network', 'none', '--memory', '512m',
    '--tmpfs', '/var/lib/postgresql/data:rw', '--env', 'POSTGRES_USER=qa_ledger_test', '--env', 'POSTGRES_DB=' + database, '--env', 'POSTGRES_PASSWORD=' + password, pgImage]);
  created = true;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const probe = spawnSync('docker', ['exec', owner, 'pg_isready', '-U', 'qa_ledger_test', '-d', database], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (probe.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw Error('ISOLATED_POSTGRES_NOT_READY');
  const mounts = ['apps/api/src', 'apps/api/migrations', 'tests', 'scripts', 'packages', 'shared', 'config'].flatMap(relative =>
    ['--mount', `type=bind,source=${path.join(root, relative)},target=/app/${relative},readonly`]);
  const tests = [
    'tests/platform/agent-memory-readonly.test.mjs', 'tests/platform/agent-memory-readonly-db.test.cjs',
    'tests/platform/agent-editorial-memory.test.cjs', 'tests/platform/agent-research-evidence-contract.test.cjs',
    'tests/platform/agent-interaction.test.mjs',
  ];
  const run = spawnSync('docker', ['run', '--rm', '--name', owner + '-tests', '--label', 'mooyu.local.memory.owner=' + owner,
    '--network', 'container:' + owner, '--memory', '1g', '--tmpfs', '/tmp:rw,exec', '--workdir', '/app', ...mounts,
    '--env', 'QA_LEDGER_TEST_ISOLATED=1', '--env', `QA_LEDGER_TEST_URL=postgresql://qa_ledger_test:${password}@127.0.0.1:5432/${database}`,
    '--entrypoint', 'node', nodeImage, '--test', '--test-concurrency=1', ...tests],
  { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(out, 'tests.tap'), run.stdout ?? '');
  fs.writeFileSync(path.join(out, 'tests.stderr.txt'), run.stderr ?? '');
  if (run.error || run.status !== 0) {
    process.stdout.write((run.stdout ?? '').slice(-14000));
    throw Object.assign(Error('LOCAL_MEMORY_ACCEPTANCE_FAILED'), { detail: run.stderr?.slice(-2000) });
  }
  const proofLine = (run.stdout ?? '').split('\n').find(line => line.startsWith('# {"result":"AGENT_MEMORY_READONLY_DB_ACCEPTED"'));
  if (!proofLine || !/^# fail 0$/m.test(run.stdout) || !/^# skipped 0$/m.test(run.stdout)) throw Error('COMPLETE_DATABASE_PROOF_REQUIRED');
  if (JSON.stringify(hashesBefore) !== JSON.stringify(sourceHashes())) throw Error('SOURCE_CHANGED_DURING_ACCEPTANCE');
  const databaseProof = JSON.parse(proofLine.slice(2));
  const acceptance = { schemaVersion: 'agent-memory-local-acceptance-v1', result: 'AGENT_MEMORY_READONLY_LOCAL_ACCEPTED',
    capturedAt: new Date().toISOString(), tests, pgImage, nodeImage, source: root, isolatedDatabase: true,
    sourceSha256: hashesBefore, databaseProof, passedTests: Number(run.stdout.match(/^# pass (\d+)$/m)[1]),
    externalNetwork: false, liveServicesTouched: false, oldTasksRetried: false, paperSystemsActivated: false };
  fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n');
  console.log(JSON.stringify({ result: acceptance.result, passedTests: acceptance.passedTests, publicTablesUnchanged: databaseProof.publicTablesUnchanged, outputDirectory: out }));
} catch (error) {
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ code: error.message, command: error.command ?? null, detail: error.detail ?? null }, null, 2));
  throw error;
} finally {
  if (created) {
    // A timed-out Docker CLI can leave its private test container running.
    // Inspect its exact task label before removing this task's container only.
    const testName = owner + '-tests';
    const probe = spawnSync('docker', ['inspect', testName, '--format', '{{index .Config.Labels "mooyu.local.memory.owner"}}'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (probe.status === 0) {
      if (probe.stdout.trim() !== owner) throw Error('ISOLATED_TEST_CONTAINER_OWNER_MISMATCH');
      docker(['rm', '--force', testName]);
    }
    const label = docker(['inspect', owner, '--format', '{{index .Config.Labels "mooyu.local.memory.owner"}}']);
    if (label !== owner) throw Error('ISOLATED_CONTAINER_OWNER_MISMATCH');
    docker(['rm', '--force', owner]);
  }
}
