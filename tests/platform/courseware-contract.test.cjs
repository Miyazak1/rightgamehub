const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const templates = ['concept-explorer', 'causal-simulation', 'algorithm-stepper'];

async function temporaryCopy(t, name = 'concept-explorer') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mooyu-courseware-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(root, 'templates/courseware', name), directory, { recursive: true });
  return directory;
}

test('courseware schemas are strict, versioned JSON Schema documents', async () => {
  const schemaRoot = path.join(root, 'packages/contracts/courseware');
  const files = (await fs.readdir(schemaRoot)).filter(file => file.endsWith('.schema.json'));
  assert.deepEqual(files.sort(), [
    'course-v1.schema.json', 'courseware-brief-v1.schema.json', 'courseware-coverage-v1.schema.json', 'curriculum-review-packet-v1.schema.json', 'doctor-report-v1.schema.json', 'embed-descriptor-v1.schema.json',
    'embed-protocol-v1.schema.json', 'embed-protocol-v2.schema.json', 'experience-v1.schema.json', 'journeys-v1.schema.json', 'knowledge-map-fragment-v1.schema.json',
    'knowledge-map-v1.schema.json', 'learning-sdk-v1.schema.json', 'manifest-v1.schema.json', 'module-lock-v1.schema.json', 'module-manifest-v1.schema.json', 'sources-v1.schema.json', 'textbook-baseline-v1.schema.json',
  ]);
  for (const file of files) {
    const schema = JSON.parse(await fs.readFile(path.join(schemaRoot, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^https:\/\/mooyu\.fun\/schemas\/courseware\//u);
  }
  for (const file of ['manifest-v1.schema.json', 'course-v1.schema.json', 'courseware-brief-v1.schema.json', 'courseware-coverage-v1.schema.json', 'curriculum-review-packet-v1.schema.json', 'sources-v1.schema.json', 'journeys-v1.schema.json', 'doctor-report-v1.schema.json', 'embed-descriptor-v1.schema.json', 'embed-protocol-v2.schema.json', 'experience-v1.schema.json', 'module-lock-v1.schema.json', 'module-manifest-v1.schema.json', 'textbook-baseline-v1.schema.json']) {
    assert.equal(JSON.parse(await fs.readFile(path.join(schemaRoot, file), 'utf8')).additionalProperties, false, `${file} must reject unknown root fields`);
  }
});

test('all three reference courseware packages pass the L0 Doctor', async () => {
  const { inspectCoursewareProject, describeCoursewareProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  for (const name of templates) {
    const templateRoot = path.join(root, 'templates/courseware', name);
    const report = await inspectCoursewareProject(templateRoot);
    assert.equal(report.ok, true, `${name}: ${JSON.stringify(report.findings, null, 2)}`);
    assert.match(report.projectDigest, /^[a-f0-9]{64}$/u);
    assert.ok(report.findings.some(item => item.code === 'COURSEWARE_CONTRACT_READY'));
    assert.ok(report.findings.some(item => item.code === 'COURSEWARE_MODULE_GRAPH_READY'));
    const summary = await describeCoursewareProject(templateRoot);
    assert.equal(summary.counts.modules, 6, `${name} must ship its domain, instrument, component, challenge, journey and embed modules`);
    const manifest = JSON.parse(await fs.readFile(path.join(templateRoot, 'mooyu-courseware.json'), 'utf8'));
    assert.equal(manifest.build.profile, 'mooyu-structured-v1');
    assert.equal(manifest.runtime.profile, 'structured-courseware');
    assert.equal(manifest.runtime.moduleLock, 'dist/mooyu-modules.lock.json');
    assert.equal(new Set(manifest.runtime.rootModules).size, 6);
  }
});

test('courseware Doctor rejects unknown fields and broken cross-file references', async t => {
  const { inspectCoursewareProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t);
  const manifestPath = path.join(directory, 'mooyu-courseware.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.unapprovedField = true;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const coursePath = path.join(directory, 'courseware/course.json');
  const course = JSON.parse(await fs.readFile(coursePath, 'utf8'));
  course.scenes[0].evidenceIds = ['missing-claim'];
  await fs.writeFile(coursePath, `${JSON.stringify(course, null, 2)}\n`);
  const report = await inspectCoursewareProject(directory);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_ADDITIONAL_PROPERTY'));
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_EVIDENCE_REFERENCE_INVALID'));
});

test('courseware Doctor rejects uncovered objectives, duplicate IDs and missing entry', async t => {
  const { inspectCoursewareProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t, 'algorithm-stepper');
  const coursePath = path.join(directory, 'courseware/course.json');
  const course = JSON.parse(await fs.readFile(coursePath, 'utf8'));
  course.objectives.push({ ...course.objectives[0], id: 'second-objective' });
  course.checkpoints.push({ ...course.checkpoints[0] });
  await fs.writeFile(coursePath, `${JSON.stringify(course, null, 2)}\n`);
  await fs.rm(path.join(directory, 'dist/index.html'));
  const report = await inspectCoursewareProject(directory);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_OBJECTIVE_UNCOVERED'));
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_ID_DUPLICATE'));
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_ENTRY_MISSING'));
});

test('creator toolkit CLI auto-detects courseware packages', async () => {
  const cli = path.join(root, 'scripts/creator-toolkit-cli.mjs');
  const checked = await exec(process.execPath, [cli, 'doctor', path.join(root, 'templates/courseware/causal-simulation'), '--json'], { cwd: root });
  const report = JSON.parse(checked.stdout);
  assert.equal(report.ok, true, checked.stdout);
  assert.equal(report.validatorVersion, '0.2.0');
  assert.equal(report.reportVersion, 1);
});

test('all three subject references declare real three-mode experiences and reject a slider-only sandbox', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  for (const name of templates) {
    const source = path.join(root, 'templates/courseware', name);
    const summary = await tools.describeCoursewareProject(source);
    assert.equal(summary.ok, true, name);
    assert.equal(summary.counts.modes, 3, `${name} must implement textbook, free and challenge modes`);
    assert.equal(summary.counts.challenges, 1, `${name} must ship a measurable challenge`);
  }

  const directory = await temporaryCopy(t, 'causal-simulation');
  const experiencePath = path.join(directory, 'courseware/experience.json');
  const experience = JSON.parse(await fs.readFile(experiencePath, 'utf8'));
  const sandbox = experience.modes.find(mode => mode.kind === 'free-sandbox');
  sandbox.allowedCommands = sandbox.allowedCommands.filter(command => command !== 'object.add');
  await fs.writeFile(experiencePath, `${JSON.stringify(experience, null, 2)}\n`);
  const report = await tools.inspectCoursewareProject(directory);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_SANDBOX_FREEDOM_INSUFFICIENT'));
});

test('experience capabilities are composable instead of globally requiring every mode and instrument', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t, 'concept-explorer');
  const experiencePath = path.join(directory, 'courseware/experience.json');
  const experience = JSON.parse(await fs.readFile(experiencePath, 'utf8'));
  experience.modes = [experience.modes.find(mode => mode.kind === 'textbook-lab')];
  experience.modes[0].instrumentIds = [];
  delete experience.instruments;
  await fs.writeFile(experiencePath, `${JSON.stringify(experience, null, 2)}\n`);
  const report = await tools.inspectCoursewareProject(directory);
  assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
});

test('courseware Doctor rejects incomplete scenario challenge rules', async t => {
  const { inspectCoursewareProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t, 'causal-simulation');
  const experiencePath = path.join(directory, 'courseware/experience.json');
  const experience = JSON.parse(await fs.readFile(experiencePath, 'utf8'));
  experience.modes.find(mode => mode.kind === 'scenario-challenge').challenge.success = [];
  await fs.writeFile(experiencePath, `${JSON.stringify(experience, null, 2)}\n`);
  const report = await inspectCoursewareProject(directory);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(item => item.code === 'COURSEWARE_CHALLENGE_RULES_INVALID'));
});

test('courseware toolkit initializes without overwrite and exposes a stable inspection summary', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mooyu-courseware-init-'));
  t.after(() => fs.rm(parent, { recursive:true,force:true }));
  const target = path.join(parent, 'lesson');
  const created = await tools.initializeCoursewareProject({ templateRoot:path.join(root, 'templates/courseware/concept-explorer'),targetRoot:target });
  assert.equal(created.action, 'created'); assert.equal(created.id, 'quadratic-shape-explorer');
  await assert.rejects(tools.initializeCoursewareProject({ templateRoot:path.join(root, 'templates/courseware/concept-explorer'),targetRoot:target }), { code:'COURSEWARE_TARGET_EXISTS' });
  const summary = await tools.describeCoursewareProject(target);
  assert.equal(summary.ok, true); assert.equal(summary.counts.objectives, 1); assert.equal(summary.counts.journeys, 2); assert.match(summary.projectDigest, /^[a-f0-9]{64}$/u); assert.equal(summary.projectDigest, summary.report.projectDigest);
});

test('reference courseware templates expose real bilingual, keyboard and motion-safe acceptance surfaces', async () => {
  for (const name of templates) {
    const templateRoot = path.join(root, 'templates/courseware', name);
    const html = await fs.readFile(path.join(templateRoot, 'dist/index.html'), 'utf8');
    const journeys = JSON.parse(await fs.readFile(path.join(templateRoot, 'tests/journeys.json'), 'utf8'));
    assert.deepEqual(new Set(journeys.journeys.map(journey => journey.locale)), new Set(['zh-CN', 'en']), `${name} must test both locales`);
    assert.match(html, /locale\.set/u, `${name} must respond to host locale commands`);
    assert.match(html, /document\.documentElement\.lang/u, `${name} must expose the active document language`);
    assert.match(html, /event\.source !== parent/u, `${name} must bind commands to its parent window`);
    assert.match(html, /event\.origin !== location\.origin/u, `${name} must reject cross-origin legacy commands`);
    assert.match(html, /:focus-visible/u, `${name} must provide visible keyboard focus`);
    assert.match(html, /prefers-reduced-motion:reduce/u, `${name} must honor reduced-motion preferences`);
    assert.match(html, /touch-action/u, `${name} must preserve deliberate touch interaction`);
    assert.match(html, /class="workbench-nav"/u, `${name} must expose the shared textbook workbench navigation`);
    assert.match(html, /class="workbench-brand"/u, `${name} must use the shared Mooyu courseware brand block`);
    assert.match(html, /class="subject-tag"/u, `${name} must identify its subject inside the shared shell`);
    assert.match(html, /data-app-action="new"/u, `${name} must expose the shared new-experiment action`);
    assert.match(html, /data-app-action="notes"|id="snapshot"/u, `${name} must expose the shared notes action`);
    assert.match(html, /data-app-action="help"/u, `${name} must expose the shared help action`);
    assert.match(html, /id="lang"/u, `${name} must expose the shared language action`);
    assert.match(html, /class="guide-chip"/u, `${name} must expose the shared experience status chip`);
    assert.match(html, /class="tool-shelf"/u, `${name} must expose subject tools instead of a button-only demo`);
    assert.match(html, /class="live-grid"/u, `${name} must expose live readable measurements`);
    assert.match(html, /type="module" src="\.\/_mooyu\/bootstrap\.mjs"/u, `${name} must boot through the verified structured runtime`);
    assert.doesNotMatch(html, /max-width:1180px/u, `${name} must use the full available embed width`);
    assert.match(html, /\.book\{position:relative;width:100%/u, `${name} must align its workbench to the full iframe width`);
    assert.match(html, /html,body\{height:100%;overflow:hidden\}/u, `${name} must provide a desktop single-screen workbench`);
    assert.match(html, /minmax\(0,1fr\)/u, `${name} must let its central workspace consume remaining viewport height`);
  }
  const concept = await fs.readFile(path.join(root, 'templates/courseware/concept-explorer/dist/index.html'), 'utf8');
  assert.match(concept, /data-tool="probe"/u); assert.match(concept, /setPointerCapture/u); assert.match(concept, /demoProgress/u);
  assert.match(concept, /function syncChallengeResult/u, 'dynamic challenge feedback must follow locale changes');
  assert.equal((concept.match(/data-experience-mode=/gu) ?? []).length, 3); assert.match(concept, /id="checkChallenge"/u); assert.match(concept, /hit-target-point/u);
  const causal = await fs.readFile(path.join(root, 'templates/courseware/causal-simulation/dist/index.html'), 'utf8');
  assert.match(causal, /data-tool="trace"/u); assert.match(causal, /id="playhead"/u); assert.match(causal, /liveVelocity/u);
  assert.match(causal, /id="forceHandle"/u); assert.match(causal, /setPointerCapture/u); assert.match(causal, /draggable="true"/u);
  assert.match(causal, /data-mass-action="add"/u); assert.match(causal, /data-mass-action="remove"/u);
  assert.match(causal, /data-force-action="decrease"/u); assert.match(causal, /data-force-action="increase"/u);
  assert.doesNotMatch(causal, /data-focus="force"/u, 'removed force-focus control must not leave a stale initialization binding');
  const deliverySolutions=[]; for(let mass=4;mass<=6;mass+=1){for(let force=1;force<=10;force+=1){const position=.5*(force/mass)*2.5**2;if(position>=6.5&&position<=8.5)deliverySolutions.push({mass,force});}}
  assert.deepEqual(deliverySolutions,[{mass:4,force:9},{mass:4,force:10}], 'delivery challenge must retain integer solutions inside the exposed controls');
  assert.equal((causal.match(/data-experience-mode=/gu) ?? []).length, 3); assert.match(causal, /id="challengeTarget"/u); assert.match(causal, /evaluateChallenge/u);
  assert.match(causal, /removeMassBlock/u); assert.match(causal, /Math\.min\(6/u);
  assert.match(causal, /data-panel="explore"/u); assert.match(causal, /data-panel="model"/u); assert.match(causal, /data-panel="analyse"/u);
  assert.match(causal, /id="chart"/u); assert.match(causal, /selectComparison/u); assert.match(causal, /compareMass/u);
  assert.match(causal, /structuredRuntime\?\.observe\('physics\.newton-cart'\)/u); assert.match(causal, /hasControlledPair/u); assert.match(causal, /compareSame/u); assert.match(causal, /Number\(playhead\.value\)>=1000/u);
  assert.match(causal, /lastChallengeOutcome/u, 'physics challenge feedback must preserve semantic state for translation');
  const algorithm = await fs.readFile(path.join(root, 'templates/courseware/algorithm-stepper/dist/index.html'), 'utf8');
  assert.doesNotMatch(algorithm, /CHEMISTRY LAB/u, 'chemistry must not fork the shared product brand');
  assert.doesNotMatch(causal, /MECHANICS WORKBENCH/u, 'physics must not fork the shared product brand');
  assert.match(algorithm, /class="transport-label"/u, 'chemistry must use the shared simulation transport structure');
  assert.match(algorithm, /\.transport \.primary\{[^}]*background:#7355d9/u, 'chemistry primary transport action must use the shared purple emphasis');
  assert.match(algorithm, /\.answers button\{[^}]*border-radius:8px/u, 'chemistry assessment choices must use the shared rounded button language');
  assert.match(algorithm, /data-tool="compress"/u); assert.match(algorithm, /id="stepProgress"/u); assert.match(algorithm, /quotient\(state/u); assert.match(algorithm, /predict-catalyst/u);
  assert.equal((algorithm.match(/data-experience-mode=/gu) ?? []).length, 3); assert.match(algorithm, /id="addFeed"/u); assert.match(algorithm, /id="removeFeed"/u);
  assert.match(algorithm, /safe-no2-batch/u); assert.match(algorithm, /function saveSnapshot/u);
  assert.match(algorithm, /lastChallengeOutcome/u, 'chemistry challenge feedback must preserve semantic state for translation');
});

test('courseware build and package are deterministic, non-overwriting managed artifacts', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t, 'causal-simulation');
  const output = path.join(directory, 'outside-build');
  const built = await tools.buildCoursewareProject(directory, { outputDirectory:output });
  assert.equal(built.reused, false); assert.ok(built.files.some(file => file.path === 'dist/index.html')); assert.ok(built.files.some(file => file.path === 'courseware/experience.json'));
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'build-report.json'), 'utf8')).projectDigest, built.projectDigest);
  await assert.rejects(tools.buildCoursewareProject(directory, { outputDirectory:output }), { code:'COURSEWARE_OUTPUT_NOT_EMPTY' });
  const archive = path.join(directory, 'outside-package.zip');
  const first = await tools.packageCoursewareProject(directory, { outputPath:archive });
  const second = await tools.packageCoursewareProject(directory, { outputPath:archive });
  assert.equal(first.reused, false); assert.equal(second.reused, true); assert.equal(first.artifactSha256, second.artifactSha256);
  assert.equal((await fs.readFile(archive)).subarray(0, 2).toString(), 'PK');
  await assert.rejects(tools.packageCoursewareProject(directory, { outputPath:path.join(directory, 'not-a-zip.bin') }), { code:'COURSEWARE_PACKAGE_EXTENSION_INVALID' });
});

test('structured Builder freezes module graph and rejects changed release bytes', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const modules = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/courseware-modules.mjs')));
  const directory = await temporaryCopy(t, 'concept-explorer');
  const moduleDirectory = path.join(directory, 'modules/math-quadratic');
  await fs.mkdir(moduleDirectory, { recursive:true });
  const entry = Buffer.from("export const model = coefficient => ({ coefficient, opening: coefficient < 0 ? 'down' : 'up' });\n");
  await fs.writeFile(path.join(moduleDirectory, 'index.mjs'), entry);
  const moduleManifest = {
    format:'mooyu.courseware-module',schemaVersion:1,id:'math.quadratic',version:'1.0.0',kind:'domain',apiVersion:1,
    entry:'./index.mjs',integrity:`sha256:${crypto.createHash('sha256').update(entry).digest('hex')}`,hotSwap:'paused',stateSchemaVersion:1,
    capabilities:['domain.model'],commands:['coefficient.set'],dependencies:[],
  };
  await fs.writeFile(path.join(moduleDirectory, 'module.json'), `${JSON.stringify(moduleManifest, null, 2)}\n`);
  const manifestPath = path.join(directory, 'mooyu-courseware.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.build.profile = 'mooyu-structured-v1';
  Object.assign(manifest.runtime, { profile:'structured-courseware',modules:['modules/math-quadratic/module.json'],rootModules:['math.quadratic'],moduleLock:'dist/mooyu-modules.lock.json' });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const doctor = await tools.inspectCoursewareProject(directory);
  assert.equal(doctor.ok, true, JSON.stringify(doctor.findings, null, 2));
  assert.ok(doctor.findings.some(item => item.code === 'COURSEWARE_MODULE_GRAPH_READY'));
  const output = path.join(directory, 'structured-build');
  const built = await tools.buildCoursewareProject(directory, { outputDirectory:output });
  assert.equal(built.moduleLock.modules, 1);
  assert.equal(built.moduleLock.path, 'dist/mooyu-modules.lock.json');
  const lock = JSON.parse(await fs.readFile(path.join(output, built.moduleLock.path), 'utf8'));
  assert.deepEqual(lock.roots, ['math.quadratic']);
  assert.equal(lock.modules[0].entry, 'modules/math-quadratic/index.mjs');
  await modules.verifyCoursewareModuleLock(output, manifest, null, { required:true });
  await fs.appendFile(path.join(output, lock.modules[0].entry), '// changed after build\n');
  await assert.rejects(modules.verifyCoursewareModuleLock(output, manifest, null, { required:true }), { code:'COURSEWARE_MODULE_INTEGRITY_MISMATCH' });
});

test('courseware preview is loopback-only, no-store and serves the verified dist entry', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const responseFor = () => ({ status:null,headers:null,body:null,writeHead(status,headers){ this.status=status; this.headers=headers; },end(body){ this.body=body; } });
  const response = responseFor();
  const handler = tools.createCoursewarePreviewHandler(path.join(root, 'templates/courseware/algorithm-stepper'));
  await handler({ url:'/' },response);
  assert.equal(response.status, 200); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.match(response.headers['Content-Security-Policy'], /connect-src 'self'/u); assert.match(response.headers['Content-Security-Policy'], /script-src 'self' blob:/u); assert.match(response.body.toString(), /data-mooyu-scene="control-equilibrium"/u);
  const lockResponse = responseFor(); await handler({ url:'/dist/mooyu-modules.lock.json' },lockResponse);
  assert.equal(lockResponse.status, 200); assert.equal(JSON.parse(lockResponse.body.toString()).modules.length, 6);
  const bootstrapResponse = responseFor(); await handler({ url:'/_mooyu/bootstrap.mjs' },bootstrapResponse);
  assert.equal(bootstrapResponse.status, 200); assert.match(bootstrapResponse.body.toString(), /mooyu:runtime-error/u); assert.match(bootstrapResponse.body.toString(), /dataset\.mooyuRuntime = 'ready'/u);
  const runtimeResponse = responseFor(); await handler({ url:'/_mooyu/runtime/index.mjs' },runtimeResponse);
  assert.equal(runtimeResponse.status, 200); assert.match(runtimeResponse.body.toString(), /browser-loader/u);
  const moduleResponse = responseFor(); await handler({ url:'/modules/domain/index.mjs' },moduleResponse);
  assert.equal(moduleResponse.status, 200); assert.match(moduleResponse.body.toString(), /function composition/u);
  const traversal = { status:null,writeHead(status){ this.status=status; },end(){} }; await handler({ url:'/%2e%2e%2fmooyu-courseware.json' },traversal); assert.equal(traversal.status, 400);
  const preview = await tools.createCoursewarePreviewServer(path.join(root, 'templates/courseware/algorithm-stepper'), { port:0 });
  t.after(() => preview.close());
  assert.match(preview.url, /^http:\/\/127\.0\.0\.1:/u);
  await assert.rejects(tools.createCoursewarePreviewServer(path.join(root, 'templates/courseware/algorithm-stepper'), { host:'0.0.0.0' }), { code:'COURSEWARE_PREVIEW_HOST_INVALID' });
});

test('courseware journey test fails explicitly when no real browser driver is configured', async () => {
  const { testCoursewareProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  await assert.rejects(testCoursewareProject(path.join(root, 'templates/courseware/concept-explorer'), { browserModule:null }), { code:'COURSEWARE_BROWSER_DRIVER_MISSING' });
  await assert.rejects(testCoursewareProject(path.join(root, 'templates/courseware/concept-explorer'), { browserModule:path.join(root, 'missing-playwright-module') }), { code:'COURSEWARE_BROWSER_DRIVER_INVALID' });
});

test('creator toolkit CLI supports inspect and rejects unknown init templates without writing', async () => {
  const cli = path.join(root, 'scripts/creator-toolkit-cli.mjs');
  const inspected = await exec(process.execPath, [cli, 'inspect', path.join(root, 'templates/courseware/algorithm-stepper'), '--json'], { cwd:root });
  assert.equal(JSON.parse(inspected.stdout).counts.checkpoints, 2);
  await assert.rejects(exec(process.execPath, [cli, 'init', 'unknown-template', path.join(root, '.must-not-exist'), '--json'], { cwd:root }), error => error.code === 1 && /COURSEWARE_TEMPLATE_UNKNOWN/u.test(error.stderr));
  await assert.rejects(fs.stat(path.join(root, '.must-not-exist')), { code:'ENOENT' });
});

test('courseware submission validates privately and requires a separate explicit publish call', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t, 'concept-explorer');
  const workId = '11111111-1111-4111-8111-111111111111';
  const uploadId = '22222222-2222-4222-8222-222222222222';
  const releaseId = '33333333-3333-4333-8333-333333333333';
  let createUploadBody; let uploadedBytes = 0; let publishCalls = 0;
  let remoteUpload = { id:uploadId,state:'queued',publicationOutcome:null,releaseId:null,errorCode:null };
  const apiClient = {
    createWork: async body => { assert.equal(body.kind,'courseware'); return { data:{ id:workId,revision:1 } }; },
    createUpload: async (_workId,body) => { createUploadBody=body; return { data:{ id:uploadId,state:'created' } }; },
    createUploadGrant: async () => ({ data:{ token:'ephemeral-upload-grant' } }),
    uploadContentBytes: async (_uploadId,bytes,token) => { assert.equal(token,'ephemeral-upload-grant'); uploadedBytes=bytes.length; return { data:{ accepted:true } }; },
    completeUpload: async () => ({ data:remoteUpload }),
    getUpload: async () => ({ data:remoteUpload }),
    listCreatorWorks: async () => ({ data:[{ id:workId,revision:7 }] }),
    publishWorkRelease: async (publishedWorkId,publishedReleaseId,revision) => {
      publishCalls += 1; assert.equal(publishedWorkId,workId); assert.equal(publishedReleaseId,releaseId); assert.equal(revision,7);
      return { data:{ work:{ id:workId,revision:8,state:'published' },releaseId,targetKey:'web' } };
    },
  };
  const submitted = await tools.submitCoursewareProject(directory,{ apiClient,platformUrl:'https://mooyu.fun' });
  assert.equal(submitted.workId,workId); assert.equal(submitted.upload.id,uploadId); assert.equal(createUploadBody.autoPublish,false); assert.ok(uploadedBytes>0); assert.equal(publishCalls,0);
  const localState = JSON.parse(await fs.readFile(path.join(directory,'.mooyu/submission.json'),'utf8'));
  assert.equal(localState.workId,workId); assert.equal(localState.uploadId,uploadId); assert.equal(JSON.stringify(localState).includes('ephemeral-upload-grant'),false);

  remoteUpload = { id:uploadId,state:'succeeded',publicationOutcome:'draft',releaseId,errorCode:null };
  const status = await tools.coursewareSubmissionStatus(directory,{ apiClient,platformUrl:'https://mooyu.fun' });
  assert.equal(status.ready,true); assert.equal(publishCalls,0);
  const published = await tools.publishCoursewareSubmission(directory,{ apiClient,platformUrl:'https://mooyu.fun' });
  assert.equal(published.work.state,'published'); assert.equal(publishCalls,1);
});
