import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPaperStudyApiFixture } from '../tests/desktop/paper-study-api-fixture.mjs';
import { loadSavedPaperDraft } from '../tests/desktop/paper-study-saved-draft.mjs';
import { stableHash } from '../apps/api/src/researcher-qa-protocol/stable-json.mjs';
import { resolvePaperStudyBuild } from './support/paper-study-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 4 || process.argv[2] !== '--recording') throw Error('PAPER_SAVED_ARGUMENTS');
const recording = await fs.realpath(path.resolve(process.argv[3]));
const recordingsRoot = await fs.realpath(path.join(root, '.runtime/paper-study'));
if (path.dirname(recording) !== recordingsRoot || !/^live-[\w-]+$/.test(path.basename(recording))) throw Error('PAPER_SAVED_RECORDING_OUTSIDE_ISOLATION');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const originalFiles = (await fs.readdir(recording)).filter(name => name.endsWith('.json'));
const originalHashes = Object.fromEntries(await Promise.all(originalFiles.map(async name => [name, digest(await fs.readFile(path.join(recording, name)))])));
const pdf = path.join(root, '.runtime/paper-layout-audit/1706.03762v7.pdf');
const { paper, pdfBytes } = await loadSavedPaperDraft(recording, pdf);
const build = await resolvePaperStudyBuild({ root });
const directory = await fs.mkdtemp(path.join(recordingsRoot, 'resume-'));
const profileRoot = path.join(directory, 'profile'); await fs.mkdir(profileRoot);
const otpFile = path.join(directory, 'otp.txt'), result = path.join(directory, 'window-result.json');
let backend, child, processingAttempts = 0;
const denyProcessing = async () => { processingAttempts++; throw Error('PAPER_SAVED_PROCESSING_FORBIDDEN'); };
const report = { passed: false, directory, recording, modelInvoked: false, modelCalls: 0, productionConnected: false, published: false, manualOutputEdits: false };
try {
  backend = await createPaperStudyApiFixture({ mode: 'isolated-saved-draft', processor: { analyze: denyProcessing, compose: denyProcessing, verify: denyProcessing },
    onMail: code => fs.writeFile(otpFile, code, { mode: 0o600 }) });
  backend.repository.put({ id: paper.id, owner: '31e033b2-13d6-4b81-b214-21b3f25dca60', title: paper.title, filename: paper.filename,
    bytes: pdfBytes, sourceSha256: paper.sourceSha256, pages: structuredClone(paper.pages), pack: structuredClone(paper.analysis),
    draft: structuredClone(paper.draft), status: 'draft-ready', errorCode: null, job: null });
  const evidenceTargets = [...paper.draft.paragraphEvidenceBindings].sort((a,b) => a.blockIndex - b.blockIndex).flatMap(b => b.evidence.map(e => {
    const source = paper.analysis.evidence.find(item => item.id === e.id);
    return { page: source.locator.pages[0], quote: source.quoteText };
  }));
  const config = path.join(directory, 'config.json');
  await fs.writeFile(config, JSON.stringify({ resume: true, accountApiOrigin: backend.origin, otpFile, profileRoot, result, pdf,
    savedBlocks: paper.draft.content.blocks, evidenceTargets, assetRoot: build.assetRoot }));
  const electron = build.electronExecutable;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.DEEPSEEK_API_KEY; delete env.DEEPSEEK_MODEL;
  console.log(JSON.stringify({ directory, recording, draftId: paper.draft.id, modelCalls: 0 }));
  await new Promise((resolve, reject) => {
    child = spawn(electron, [path.join(root, 'tests/desktop/electron-paper-study-acceptance.cjs'), config], { cwd: root, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(Error('PAPER_SAVED_WINDOW_TIMEOUT')); }, 240000);
    child.stdout.on('data', b => { output += b; process.stdout.write(b); }); child.stderr.on('data', b => { output += b; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', async code => { clearTimeout(timer); await fs.writeFile(path.join(directory, 'electron.log'), output); code === 0 ? resolve() : reject(Error('PAPER_SAVED_WINDOW_FAILED')); });
  });
  const window = JSON.parse(await fs.readFile(result));
  const after = backend.service.list({ userId: '31e033b2-13d6-4b81-b214-21b3f25dca60' })[0];
  if (!window.passed || processingAttempts !== 0 || stableHash(after.draft) !== stableHash(paper.draft) || after.id !== paper.id) throw Error('PAPER_SAVED_DRAFT_CHANGED');
  Object.assign(report, { passed: true, window, draftId: paper.draft.id, contentSha256: paper.draft.contentSha256, evidenceLinksChecked: evidenceTargets.length,
    sameDraftPreserved: true, processingAttempts });
} catch (error) {
  report.error = error.message;
} finally {
  await backend?.close(); await fs.rm(otpFile, { force: true });
  for (const name of originalFiles) if (digest(await fs.readFile(path.join(recording, name))) !== originalHashes[name]) throw Error('PAPER_SAVED_ORIGINAL_RECORDING_CHANGED');
  report.originalRecordingUnchanged = true;
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(recordingsRoot, 'saved-latest.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
