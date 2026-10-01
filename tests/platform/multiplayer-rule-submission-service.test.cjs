const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');

const moduleUrl = name => pathToFileURL(path.resolve(__dirname, `../../apps/api/src/${name}`));
const actor = { userId: '00000000-0000-4000-8000-000000000001',scopes: ['upload'],profile: { canPublish: true,role: 'user' } };
const workId = '00000000-0000-4000-8000-000000000002';
const evidence = ({ sha256 = 'a'.repeat(64),bytes = 12,doctorOk = true } = {}) => ({
  modeKey: 'duel',modeName: '双人对战',rulesetVersion: '1.0.0',minPlayers: 2,maxPlayers: 2,modeConfig: { turnSeconds: 60 },
  fileName: 'rules-source.zip',declaredBytes: String(bytes),sha256,
  creatorSubmission: { version: 1,workId,modeKey: 'duel',rulesetVersion: '1.0.0',authority: 'platform_authoritative',players: { min: 2,max: 2 } },
  doctorReport: { version: 1,ok: doctorOk,summary: { errors: doctorOk ? 0 : 1,warnings: 1,info: 10 },findings: [] },
});

test('rule submissions require passing Doctor evidence and matching immutable identity', async () => {
  const { createMultiplayerRuleSubmissionService } = await import(moduleUrl('multiplayer-rule-submission-service.mjs'));
  let created;
  const service = createMultiplayerRuleSubmissionService({
    repository: { replayCreate: async () => null,createIdempotent: async input => { created = input; return { id: input.submissionId,state: 'created' }; } },
    objectStore: {},ids: (() => { let next = 0; return () => `00000000-0000-4000-8000-${String(++next).padStart(12,'0')}`; })(),
  });
  await assert.rejects(() => service.create(actor,workId,evidence({ doctorOk: false }),'rule-submission-key-0001'), error => error.code === 'DOCTOR_REPORT_FAILED');
  await assert.rejects(() => service.create(actor,workId,{ ...evidence(),creatorSubmission: { ...evidence().creatorSubmission,workId: crypto.randomUUID() } },'rule-submission-key-0002'), error => error.code === 'SUBMISSION_IDENTITY_MISMATCH');
  const result = await service.create(actor,workId,evidence(),'rule-submission-key-0003');
  assert.equal(result.state,'created');
  assert.equal(created.workId,workId);
  assert.match(created.objectKey,/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/u);
});

test('rule source upload verifies exact bytes, SHA-256 and ZIP magic without executing content', async t => {
  const { createMultiplayerRuleSubmissionService } = await import(moduleUrl('multiplayer-rule-submission-service.mjs'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-rule-submit-')); t.after(() => fs.rm(root,{ recursive: true,force: true }));
  const body = Buffer.from('PK\x03\x04rules-only');
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  const target = path.join(root,'source.zip');
  let finished; let failed;
  const objectStore = {
    pathFor: () => target,
    async putStream(_key,stream,maxBytes) { const chunks=[]; let bytes=0; for await (const chunk of stream) { bytes += chunk.length; assert.ok(bytes <= maxBytes); chunks.push(chunk); } const value=Buffer.concat(chunks); await fs.writeFile(target,value); return { bytes,sha256: crypto.createHash('sha256').update(value).digest('hex') }; },
    async remove() { await fs.rm(target,{ force: true }); },
  };
  const service = createMultiplayerRuleSubmissionService({
    repository: {
      beginReceive: async () => ({ objectKey: 'quarantine/id/source.zip',declaredBytes: body.length,declaredSha256: digest,ownerUserId: actor.userId }),
      finishReceive: async input => { finished = input; return { state: 'uploaded' }; },
      failReceive: async input => { failed = input; },
    },objectStore,ids: () => crypto.randomUUID(),
  });
  const result = await service.receive(crypto.randomUUID(),`Upload ${'x'.repeat(43)}`,Readable.from(body));
  assert.equal(result.state,'uploaded');
  assert.equal(finished.actualSha256,digest);
  assert.equal(failed,undefined);

  const invalid = Buffer.from('not a zip');
  const invalidDigest = crypto.createHash('sha256').update(invalid).digest('hex');
  const invalidService = createMultiplayerRuleSubmissionService({
    repository: {
      beginReceive: async () => ({ objectKey: 'quarantine/id/source.zip',declaredBytes: invalid.length,declaredSha256: invalidDigest,ownerUserId: actor.userId }),
      finishReceive: async () => assert.fail('invalid ZIP must not finish'),
      failReceive: async input => { failed = input; },
    },objectStore,ids: () => crypto.randomUUID(),
  });
  await assert.rejects(() => invalidService.receive(crypto.randomUUID(),`Upload ${'y'.repeat(43)}`,Readable.from(invalid)), error => error.code === 'RULE_SOURCE_NOT_ZIP');
  assert.equal(failed.errorCode,'RULE_SOURCE_NOT_ZIP');
});

test('rule review keeps creator and administrator capabilities separated', async () => {
  const { createMultiplayerRuleSubmissionService } = await import(moduleUrl('multiplayer-rule-submission-service.mjs'));
  let review;
  const service = createMultiplayerRuleSubmissionService({ repository: { review: async input => { review = input; return { state: 'approved_for_build' }; } },objectStore: {},ruleBuildEnabled: true,ruleBuilderImageDigest: `sha256:${'a'.repeat(64)}`,ids: () => crypto.randomUUID() });
  await assert.rejects(() => service.adminReview(actor,crypto.randomUUID(),{ action: 'approve_for_build',note: 'reviewed' }), error => error.code === 'ADMIN_REQUIRED');
  const admin = { ...actor,profile: { canPublish: true,role: 'admin' } };
  await assert.rejects(() => service.adminReview(admin,crypto.randomUUID(),{ action: 'approve_for_build',note: ' ' }), error => error.code === 'REVIEW_NOTE_REQUIRED');
  const result = await service.adminReview(admin,crypto.randomUUID(),{ action: 'approve_for_build',note: ' deterministic and private views checked ' });
  assert.equal(result.state,'approved_for_build');
  assert.equal(review.note,'deterministic and private views checked');
  assert.match(review.builderImageDigest,/^sha256:[a-f0-9]{64}$/u);
  assert.match(review.buildId,/^[0-9a-f-]{36}$/u);
});

test('rule approval fails closed while the isolated Builder is unavailable', async () => {
  const { createMultiplayerRuleSubmissionService } = await import(moduleUrl('multiplayer-rule-submission-service.mjs'));
  const admin = { ...actor,profile: { canPublish: true,role: 'admin' } };
  const service = createMultiplayerRuleSubmissionService({ repository: { review: async () => assert.fail('review must not be persisted') },objectStore: {} });
  await assert.rejects(() => service.adminReview(admin,crypto.randomUUID(),{ action: 'approve_for_build',note: 'approved' }), error => error.code === 'RULE_BUILDER_UNAVAILABLE');
});

test('built rule download verifies the stored bytes before returning them for offline signing', async t => {
  const { createMultiplayerRuleSubmissionService } = await import(moduleUrl('multiplayer-rule-submission-service.mjs'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-rule-artifact-')); t.after(() => fs.rm(root,{ recursive: true,force: true }));
  const artifact = path.join(root,'adapter.cjs'); const content = Buffer.from('module.exports={};\n'); await fs.writeFile(artifact,content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const repository = { builtPackageForAdmin: async () => ({ objectKey: 'quarantine/build/artifact.bin',fileName: 'duel.cjs',sha256,bytes: String(content.length) }) };
  const objectStore = { pathFor: () => artifact };
  const service = createMultiplayerRuleSubmissionService({ repository,objectStore });
  const admin = { ...actor,profile: { canPublish: true,role: 'admin' } };
  const result = await service.adminBuiltPackage(admin,crypto.randomUUID());
  assert.deepEqual(result.content,content);
  await fs.writeFile(artifact,Buffer.from('tampered'));
  await assert.rejects(() => service.adminBuiltPackage(admin,crypto.randomUUID()),error => error.code === 'RULE_BUILD_ARTIFACT_INTEGRITY_INVALID');
});
