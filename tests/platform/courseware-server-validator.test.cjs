const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = relative => pathToFileURL(path.join(root, relative)).href;

test('server Web validator independently revalidates a packaged interactive courseware project', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mooyu-courseware-server-'));
  t.after(() => fs.rm(temporary, { recursive:true,force:true }));
  const project = path.join(temporary, 'project');
  await fs.cp(path.join(root, 'templates/courseware/concept-explorer'), project, { recursive:true });
  const [{ packageCoursewareProject },{ validateWebZip }] = await Promise.all([
    import(moduleUrl('packages/creator-tools/src/index.mjs')),
    import(moduleUrl('apps/api/src/web-zip-validator.mjs')),
  ]);
  const artifact = path.join(temporary, 'lesson.zip');
  const packaged = await packageCoursewareProject(project, { outputPath:artifact });
  const report = await validateWebZip(artifact, path.join(temporary, 'validated'));
  assert.equal(report.entry, 'dist/index.html');
  assert.equal(report.courseware.format, 'mooyu.courseware');
  assert.equal(report.courseware.schemaVersion, 1);
  assert.equal(report.courseware.projectDigest, packaged.projectDigest);
  assert.deepEqual(report.courseware.subjects, ['mathematics','algebra']);
  assert.match(report.courseware.projectDigest, /^[a-f0-9]{64}$/u);
  assert.equal(report.courseware.summary.errors, 0);
  assert.deepEqual(report.approvedCapabilities, []);
});

test('server Web validator rejects courseware whose structured contract was changed after local packaging', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mooyu-courseware-server-invalid-'));
  t.after(() => fs.rm(temporary, { recursive:true,force:true }));
  const project = path.join(temporary, 'project');
  await fs.cp(path.join(root, 'templates/courseware/causal-simulation'), project, { recursive:true });
  const courseFile = path.join(project, 'courseware/course.json');
  const course = JSON.parse(await fs.readFile(courseFile, 'utf8'));
  course.objectives.push({ id:'uncovered-objective',text:{ 'zh-CN':'未覆盖目标',en:'Uncovered objective' } });
  await fs.writeFile(courseFile, `${JSON.stringify(course, null, 2)}\n`);
  const { packageCoursewareProject } = await import(moduleUrl('packages/creator-tools/src/courseware-toolkit.mjs'));
  const { validateWebZip } = await import(moduleUrl('apps/api/src/web-zip-validator.mjs'));
  const artifact = path.join(temporary, 'tampered.zip');
  await packageCoursewareProject(project, { outputPath:artifact,inspect:async () => ({ ok:true,projectDigest:'sha256:' + '0'.repeat(64),summary:{errors:0,warnings:0,info:0},findings:[] }) });
  await assert.rejects(validateWebZip(artifact, path.join(temporary, 'validated')), { code:'COURSEWARE_OBJECTIVE_UNCOVERED' });
});
