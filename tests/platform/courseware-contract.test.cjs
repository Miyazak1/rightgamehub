const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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
    'course-v1.schema.json', 'doctor-report-v1.schema.json', 'journeys-v1.schema.json',
    'learning-sdk-v1.schema.json', 'manifest-v1.schema.json', 'sources-v1.schema.json',
  ]);
  for (const file of files) {
    const schema = JSON.parse(await fs.readFile(path.join(schemaRoot, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^https:\/\/mooyu\.fun\/schemas\/courseware\//u);
  }
  for (const file of ['manifest-v1.schema.json', 'course-v1.schema.json', 'sources-v1.schema.json', 'journeys-v1.schema.json', 'doctor-report-v1.schema.json']) {
    assert.equal(JSON.parse(await fs.readFile(path.join(schemaRoot, file), 'utf8')).additionalProperties, false, `${file} must reject unknown root fields`);
  }
});

test('all three reference courseware packages pass the L0 Doctor', async () => {
  const { inspectCoursewareProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  for (const name of templates) {
    const report = await inspectCoursewareProject(path.join(root, 'templates/courseware', name));
    assert.equal(report.ok, true, `${name}: ${JSON.stringify(report.findings, null, 2)}`);
    assert.match(report.projectDigest, /^[a-f0-9]{64}$/u);
    assert.ok(report.findings.some(item => item.code === 'COURSEWARE_CONTRACT_READY'));
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
  assert.equal(report.validatorVersion, '0.1.0');
  assert.equal(report.reportVersion, 1);
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
  assert.equal(summary.ok, true); assert.equal(summary.counts.objectives, 1); assert.equal(summary.counts.journeys, 1); assert.match(summary.projectDigest, /^[a-f0-9]{64}$/u); assert.equal(summary.projectDigest, summary.report.projectDigest);
});

test('courseware build and package are deterministic, non-overwriting managed artifacts', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await temporaryCopy(t, 'causal-simulation');
  const output = path.join(directory, 'outside-build');
  const built = await tools.buildCoursewareProject(directory, { outputDirectory:output });
  assert.equal(built.reused, false); assert.ok(built.files.some(file => file.path === 'dist/index.html'));
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'build-report.json'), 'utf8')).projectDigest, built.projectDigest);
  await assert.rejects(tools.buildCoursewareProject(directory, { outputDirectory:output }), { code:'COURSEWARE_OUTPUT_NOT_EMPTY' });
  const archive = path.join(directory, 'outside-package.zip');
  const first = await tools.packageCoursewareProject(directory, { outputPath:archive });
  const second = await tools.packageCoursewareProject(directory, { outputPath:archive });
  assert.equal(first.reused, false); assert.equal(second.reused, true); assert.equal(first.artifactSha256, second.artifactSha256);
  assert.equal((await fs.readFile(archive)).subarray(0, 2).toString(), 'PK');
  await assert.rejects(tools.packageCoursewareProject(directory, { outputPath:path.join(directory, 'not-a-zip.bin') }), { code:'COURSEWARE_PACKAGE_EXTENSION_INVALID' });
});

test('courseware preview is loopback-only, no-store and serves the verified dist entry', async t => {
  const tools = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const response = { status:null,headers:null,body:null,writeHead(status,headers){ this.status=status; this.headers=headers; },end(body){ this.body=body; } };
  const handler = tools.createCoursewarePreviewHandler(path.join(root, 'templates/courseware/algorithm-stepper'));
  await handler({ url:'/' },response);
  assert.equal(response.status, 200); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.match(response.headers['Content-Security-Policy'], /connect-src 'none'/u); assert.match(response.body.toString(), /data-mooyu-scene="step-through-sort"/u);
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
  assert.equal(JSON.parse(inspected.stdout).counts.checkpoints, 1);
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
