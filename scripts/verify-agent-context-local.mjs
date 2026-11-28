import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== '--out-dir') throw Error('EXPLICIT_OUT_DIR_REQUIRED');
const out = path.resolve(argv[1]); if (fs.existsSync(out)) throw Error('FRESH_OUTPUT_DIRECTORY_REQUIRED');
fs.mkdirSync(out, { recursive: true });
const owner = 'agent-context-d2-' + randomBytes(16).toString('hex'), database = 'qa_ledger_test_' + randomBytes(16).toString('hex'), password = randomBytes(20).toString('hex');
const pgImage = 'sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const nodeImage = 'sha256:0bd01de2df9ebae386cd5636f2a2f4282e2250bb917ed88fda90c4ab65a89459';
const tests = ['tests/platform/agent-context-v2.test.mjs', 'tests/platform/agent-context-v2-db.test.cjs',
  'tests/platform/agent-memory-readonly.test.mjs', 'tests/platform/agent-memory-readonly-db.test.cjs',
  'tests/platform/agent-interaction.test.mjs', 'tests/platform/agent-interaction-db.test.cjs',
  'tests/platform/platform-assistant.test.cjs', 'tests/platform/agent-editorial-memory.test.cjs', 'tests/platform/agent-research-evidence-contract.test.cjs'];
const sources = ['apps/api/src/agent-context-service.mjs', 'apps/api/src/agent-context-conversation.mjs', 'apps/api/src/agent-message-envelope.mjs',
  'apps/api/src/agent-interaction-conversation.mjs', 'apps/api/src/platform-assistant.mjs', 'apps/api/src/agent-memory-readonly.mjs',
  'apps/api/src/agent-memory-readonly-contracts.mjs', 'apps/api/src/agent-memory-readonly-adapters.mjs', 'apps/api/src/agent-memory-readonly-transaction.mjs',
  'scripts/verify-agent-context-local.mjs', ...tests];
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = () => Object.fromEntries(sources.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
const before = hashes(); let created = false;
const docker = args => {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw Object.assign(Error('ISOLATED_DOCKER_COMMAND_FAILED'), { detail: r.stderr?.slice(-2000) });
  return r.stdout.trim();
};
try {
  for (const image of [pgImage, nodeImage]) docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  docker(['run', '--detach', '--name', owner, '--label', 'mooyu.local.context.owner=' + owner, '--network', 'none', '--memory', '512m',
    '--tmpfs', '/var/lib/postgresql/data:rw', '--env', 'POSTGRES_USER=qa_ledger_test', '--env', 'POSTGRES_DB=' + database, '--env', 'POSTGRES_PASSWORD=' + password, pgImage]);
  created = true;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const p = spawnSync('docker', ['exec', owner, 'pg_isready', '-U', 'qa_ledger_test', '-d', database], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (p.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw Error('ISOLATED_DATABASE_NOT_READY');
  const mounts = ['apps/api/src', 'apps/api/migrations', 'apps/qq-channel/src', 'tests', 'scripts', 'packages', 'shared', 'config'].flatMap(relative =>
    ['--mount', `type=bind,source=${path.join(root, relative)},target=/app/${relative},readonly`]);
  const run = spawnSync('docker', ['run', '--rm', '--name', owner + '-tests', '--label', 'mooyu.local.context.owner=' + owner, '--network', 'container:' + owner,
    '--memory', '1g', '--tmpfs', '/tmp:rw,exec', '--workdir', '/app', ...mounts, '--env', 'QA_LEDGER_TEST_ISOLATED=1',
    '--env', `QA_LEDGER_TEST_URL=postgresql://qa_ledger_test:${password}@127.0.0.1:5432/${database}`,
    '--entrypoint', 'node', nodeImage, '--test', '--test-concurrency=1', ...tests],
  { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(out, 'tests.tap'), run.stdout ?? ''); fs.writeFileSync(path.join(out, 'tests.stderr.txt'), run.stderr ?? '');
  if (run.error || run.status !== 0) { process.stdout.write((run.stdout ?? '').slice(-17000)); throw Error('LOCAL_CONTEXT_ACCEPTANCE_FAILED'); }
  const proofs = ['AGENT_CONTEXT_D2_DB_ACCEPTED', 'AGENT_MEMORY_READONLY_DB_ACCEPTED'].map(result => {
    const line = run.stdout.split('\n').find(line => line.startsWith('# {"result":"' + result + '"'));
    if (!line) throw Error('DATABASE_ACCEPTANCE_PROOF_REQUIRED'); return JSON.parse(line.slice(2));
  });
  if (!/^# fail 0$/m.test(run.stdout) || !/^# skipped 0$/m.test(run.stdout) || JSON.stringify(before) !== JSON.stringify(hashes())) throw Error('FINAL_SOURCE_OR_TEST_PROOF_INVALID');
  // Frozen release sources may differ only in the two explicitly opted-in
  // integration modules. All QQ control/runtime/recovery code stays identical.
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/releases/non-paper-source-alignment-20261128.json'), 'utf8'));
  const allowed = new Set(['apps/api/src/agent-interaction-conversation.mjs', 'apps/api/src/platform-assistant.mjs']);
  const delta = [];
  for (const entry of ledger.sourceFiles) {
    const bytes = fs.readFileSync(path.join(root, entry.path));
    const current = sha(entry.normalization === 'lf' ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes);
    if (current !== entry.sha256) { if (!allowed.has(entry.path)) throw Error('UNEXPECTED_FROZEN_SOURCE_CHANGE:' + entry.path); delta.push({ path: entry.path, before: entry.sha256, after: current }); }
  }
  const result = { result: 'AGENT_CONTEXT_D2_LOCAL_ACCEPTED', capturedAt: new Date().toISOString(), sourceSha256: before,
    passedTests: Number(run.stdout.match(/^# pass (\d+)$/m)[1]), proofs, tests, pgImage, nodeImage,
    frozenSourcesChecked: ledger.sourceFiles.length, intentionalIntegrationDelta: delta, liveServicesTouched: false,
    onlineUpdated: false, oldLiveTasksRetried: false, realProviderCalls: 0, paperSystemsActivated: false };
  fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ result: result.result, passedTests: result.passedTests, frozenSourcesChecked: result.frozenSourcesChecked, intentionalIntegrationDelta: delta.map(d => d.path), outputDirectory: out }));
} catch (error) {
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ code: error.message, detail: error.detail ?? null }, null, 2)); throw error;
} finally {
  if (created) {
    for (const name of [owner + '-tests', owner]) {
      const probe = spawnSync('docker', ['inspect', name, '--format', '{{index .Config.Labels "mooyu.local.context.owner"}}'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (probe.status === 0) { if (probe.stdout.trim() !== owner) throw Error('TEST_CONTAINER_OWNER_MISMATCH'); docker(['rm', '--force', name]); }
    }
  }
}
