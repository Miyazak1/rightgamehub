const test = require('node:test');
const assert = require('node:assert/strict');

const workId = '11111111-1111-4111-8111-111111111111';
const releaseId = '22222222-2222-4222-8222-222222222222';
const actor = { userId:'33333333-3333-4333-8333-333333333333',scopes:['works:read','works:write'],profile:{ canPublish:true } };

test('explicit Release publishing requires a current Work ETag and idempotency key', async () => {
  const { createWorkService } = await import('../../apps/api/src/work-service.mjs');
  const repository = { publishReleaseIdempotent:async () => { throw new Error('must not reach repository'); } };
  const service = createWorkService({ repository });
  await assert.rejects(service.publishRelease(actor,workId,releaseId,null,`"work-${workId}-4"`), error => error.code === 'IDEMPOTENCY_KEY_REQUIRED');
  await assert.rejects(service.publishRelease(actor,workId,releaseId,'publish-courseware-release-0001',null), error => error.code === 'PRECONDITION_REQUIRED');
});

test('explicit Release publishing sends the selected validated Release and expected revision to the repository', async () => {
  const { createWorkService } = await import('../../apps/api/src/work-service.mjs');
  let received;
  const repository = { publishReleaseIdempotent:async input => {
    received=input;
    return { work:{ id:workId,revision:5 },releaseId,targetKey:'web' };
  } };
  const service = createWorkService({ repository });
  const result = await service.publishRelease(actor,workId,releaseId,'publish-courseware-release-0001',`"work-${workId}-4"`);
  assert.equal(received.workId,workId); assert.equal(received.releaseId,releaseId); assert.equal(received.expectedRevision,'4');
  assert.equal(received.actor,actor); assert.match(received.requestHash,/^[a-f0-9]{64}$/u);
  assert.equal(result.etag,`"work-${workId}-5"`); assert.equal(result.releaseId,releaseId);
});
