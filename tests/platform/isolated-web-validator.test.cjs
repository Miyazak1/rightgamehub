const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { makeZip } = require('../../scripts/zip-fixture.cjs');

const projectRoot = path.resolve(__dirname,'../..');
const servicePath = path.join(projectRoot,'apps/api/src/web-validator-service.mjs');
const runnerUrl = pathToFileURL(path.join(projectRoot,'apps/api/src/web-validation-runner.mjs'));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));

async function waitFor(file,child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`validator service exited early: ${child.exitCode}`);
    try { await fs.stat(file); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await pause(50);
  }
  throw new Error('validator service did not become ready');
}

test('isolated validator mailbox processes only bounded quarantine and validator paths', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-isolated-validator-'));
  const quarantineRoot = path.join(directory,'quarantine-root');
  const validatorRoot = path.join(directory,'validator-root');
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const objectKey = `quarantine/${first}/${second}.zip`;
  const inputPath = path.join(quarantineRoot,...objectKey.split('/'));
  await fs.mkdir(path.dirname(inputPath),{ recursive: true });
  await fs.mkdir(validatorRoot,{ recursive: true });
  await fs.writeFile(inputPath,makeZip([
    { name: 'index.html',data: '<!doctype html><script src="game.js"></script>' },
    { name: 'game.js',data: 'globalThis.ready=true' },
  ]));
  const child = spawn(process.execPath,[servicePath],{
    cwd: projectRoot,
    env: { ...process.env,NODE_ENV: 'test',QUARANTINE_ROOT: quarantineRoot,VALIDATOR_ROOT: validatorRoot },
    stdio: ['ignore','pipe','pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data',chunk => { stderr += chunk.toString('utf8'); });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await Promise.race([once(child,'close'),pause(2_000)]).catch(() => {});
    await fs.rm(directory,{ recursive: true,force: true });
  });
  await waitFor(path.join(validatorRoot,'service.ready'),child);
  const { createWebValidationRunner } = await import(runnerUrl);
  const requestId = '33333333-3333-4333-8333-333333333333';
  const runner = createWebValidationRunner({ mode: 'isolated',validatorRoot,quarantineRoot,ids: () => requestId });
  const outputDirectory = path.join(validatorRoot,'attempt-abcdef','output');
  const report = await runner.run({ inputPath,outputDirectory,onHeartbeat: async () => true });
  assert.equal(report.entry,'index.html');
  assert.equal(report.fileCount,2);
  assert.equal(await fs.readFile(path.join(outputDirectory,'game.js'),'utf8'),'globalThis.ready=true');
  const state = JSON.parse(await fs.readFile(path.join(validatorRoot,'service.state.json'),'utf8'));
  assert.equal(state.status,'ready');
  assert.equal(state.processedTotal,1);
  assert.equal(state.failedTotal,0);
  assert.equal(state.lastErrorCode,null);
  assert.equal(stderr,'');
  await assert.rejects(
    runner.run({ inputPath: path.join(directory,'outside.zip'),outputDirectory,onHeartbeat: async () => true }),
    error => error.code === 'VALIDATOR_INPUT_INVALID',
  );
});

test('production compose constrains the source builder and exposes only a mailbox volume', async () => {
  const compose = await fs.readFile(path.join(projectRoot,'deploy/compose.prod.yml'),'utf8');
  const builder = compose.slice(compose.indexOf('\n  source-builder:'),compose.indexOf('\n  source-worker:'));
  const worker = compose.slice(compose.indexOf('\n  source-worker:'),compose.indexOf('\n  worker:'));
  assert.match(builder,/dockerfile: deploy\/Dockerfile\.builder/u);
  assert.match(builder,/network_mode: none/u);
  assert.match(builder,/read_only: true/u);
  assert.match(builder,/cap_drop: \[ALL\]/u);
  assert.match(builder,/no-new-privileges:true/u);
  assert.match(builder,/pids_limit: 128/u);
  assert.match(builder,/cpus: "2\.0"/u);
  assert.match(builder,/mem_limit: 2g/u);
  assert.doesNotMatch(builder,/quarantine:\/data\/quarantine/u);
  assert.match(worker,/source-build-worker-cli\.mjs/u);
  assert.match(worker,/source-builder:\/data\/builder/u);
  assert.match(worker,/quarantine:\/data\/quarantine(?!:ro)/u);
  assert.match(compose,/SOURCE_BUILDER_EXECUTION_MODE: isolated/u);
});

test('production compose isolates the Rule Builder from secrets and networks', async () => {
  const compose=await fs.readFile(path.join(projectRoot,'deploy/compose.prod.yml'),'utf8');
  const dockerfile=await fs.readFile(path.join(projectRoot,'deploy/Dockerfile.rule-builder'),'utf8');
  const apiDockerfile=await fs.readFile(path.join(projectRoot,'deploy/Dockerfile.api'),'utf8');
  const builder=compose.slice(compose.indexOf('\n  rule-builder:'),compose.indexOf('\n  rule-worker:'));
  const worker=compose.slice(compose.indexOf('\n  rule-worker:'),compose.indexOf('\n  worker:'));
  assert.match(builder,/dockerfile: deploy\/Dockerfile\.rule-builder/u);
  assert.match(builder,/network_mode: none/u);assert.match(builder,/read_only: true/u);assert.match(builder,/cap_drop: \[ALL\]/u);assert.match(builder,/no-new-privileges:true/u);assert.match(builder,/pids_limit: 64/u);
  assert.doesNotMatch(builder,/(DATABASE_URL|REDIS_URL|RULES_TRUSTED_KEYS_JSON|quarantine:\/data\/quarantine)/u);
  assert.match(worker,/multiplayer-rule-build-worker-cli\.mjs/u);assert.match(worker,/rule-builder:\/data\/rule-builder/u);assert.match(worker,/quarantine:\/data\/quarantine(?!:ro)/u);
  assert.doesNotMatch(worker,/(avatars:\/data\/avatars|covers:\/data\/covers|runtime-assets:\/data\/runtime|source-builder:\/data\/builder)/u);
  assert.match(dockerfile,/packages\/creator-tools\/node_modules/u);
  assert.match(apiDockerfile,/COPY packages\/creator-tools\/package\.json packages\/creator-tools\/package\.json/u);
  assert.match(apiDockerfile,/packages\/creator-tools\/node_modules/u);
  assert.match(apiDockerfile,/COPY --chown=node:node packages\/creator-tools \.\/packages\/creator-tools/u);
  assert.match(dockerfile,/USER node/u);
  assert.match(compose,/RULE_BUILDER_EXECUTION_MODE: isolated/u);
});

test('production compose constrains the validator container and keeps it off every network', async () => {
  const compose = await fs.readFile(path.join(projectRoot,'deploy/compose.prod.yml'),'utf8');
  assert.match(compose,/\r?\n  validator:\r?\n/u);
  assert.match(compose,/network_mode: none/u);
  assert.match(compose,/read_only: true/u);
  assert.match(compose,/cap_drop: \[ALL\]/u);
  assert.match(compose,/no-new-privileges:true/u);
  assert.match(compose,/pids_limit: 64/u);
  assert.match(compose,/quarantine:\/data\/quarantine:ro/u);
  assert.match(compose,/VALIDATOR_EXECUTION_MODE: isolated/u);
  assert.match(compose,/dockerfile: deploy\/Dockerfile\.validator/u);
  assert.match(compose,/worker:[\s\S]*?quarantine:\/data\/quarantine:ro/u);
});
