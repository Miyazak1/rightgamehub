const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const rootsFor = root => ({
  quarantine: path.join(root,'quarantine'), validator: path.join(root,'validator'), runtime: path.join(root,'runtime'),
  avatars: path.join(root,'avatars'), covers: path.join(root,'covers'),
});

test('storage capacity gate warns at 70 percent and blocks projected 85 percent without affecting reads', async () => {
  const { createStorageCapacityService } = await import('../../apps/api/src/storage-capacity-service.mjs');
  let used = 710;
  const service = createStorageCapacityService({
    roots: rootsFor(path.join(os.tmpdir(),'gamehub-storage-capacity-test')),
    statFilesystem: async () => ({ totalBytes: 1000,availableBytes: 1000-used,usedBytes: used }),
    measureDirectory: async () => 42,
  });
  const warning = await service.assertCanAccept({ packageType: 'windows_standalone_exe',declaredBytes: 10 });
  assert.equal(warning.level,'warning');
  assert.equal(warning.acceptingUploads,true);
  used = 840;
  await assert.rejects(
    service.assertCanAccept({ packageType: 'windows_standalone_exe',declaredBytes: 20 }),
    error => error.code === 'STORAGE_CAPACITY_EXCEEDED' && error.statusCode === 507 && error.retryable,
  );
  const admin = await service.adminOverview({ profile: { role: 'admin' } });
  assert.equal(admin.level,'warning');
  assert.equal(admin.stores[0].logicalBytes,'42');
  await assert.rejects(() => service.adminOverview({ profile: { role: 'user' } }), error => error.code === 'ADMIN_REQUIRED');
});

test('storage capacity combines reservations for stores on the same filesystem', async () => {
  const { createStorageCapacityService } = await import('../../apps/api/src/storage-capacity-service.mjs');
  const service = createStorageCapacityService({
    roots: rootsFor(path.join(os.tmpdir(),'gamehub-storage-shared-device-test')),
    statFilesystem: async () => ({ deviceId: 'shared-device',totalBytes: 1000,availableBytes: 800,usedBytes: 200 }),
  });
  await assert.rejects(
    service.assertCanAccept({ packageType: 'web_zip',declaredBytes: 10 }),
    error => error.code === 'STORAGE_CAPACITY_EXCEEDED',
  );
});

test('storage capacity fails closed when a volume cannot be measured', async () => {
  const { createStorageCapacityService } = await import('../../apps/api/src/storage-capacity-service.mjs');
  const service = createStorageCapacityService({ roots: rootsFor(path.join(os.tmpdir(),'gamehub-storage-unavailable-test')),statFilesystem: async () => { throw Object.assign(new Error('offline'),{ code: 'EIO' }); } });
  await assert.rejects(service.assertCanAccept({ packageType: 'web_zip',declaredBytes: 100 }), error => error.code === 'STORAGE_CAPACITY_UNAVAILABLE' && error.statusCode === 503);
});

test('storage cleanup removes only old quarantine partials', async t => {
  const { createStorageCapacityService } = await import('../../apps/api/src/storage-capacity-service.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-storage-cleanup-'));
  t.after(() => fs.rm(root,{ recursive: true,force: true }));
  const roots = rootsFor(root);
  const directory = path.join(roots.quarantine,'quarantine','11111111-1111-4111-8111-111111111111');
  await fs.mkdir(directory,{ recursive: true });
  const oldPartial = path.join(directory,'old.zip.partial');
  const newPartial = path.join(directory,'new.zip.partial');
  const committed = path.join(directory,'keep.zip');
  await Promise.all([fs.writeFile(oldPartial,'old'),fs.writeFile(newPartial,'new'),fs.writeFile(committed,'keep')]);
  const now = new Date('2026-09-30T12:00:00Z');
  await fs.utimes(oldPartial,new Date(now.getTime()-3*60*60*1000),new Date(now.getTime()-3*60*60*1000));
  await fs.utimes(newPartial,now,now);
  const service = createStorageCapacityService({ roots,clock: () => now });
  const result = await service.cleanup();
  assert.deepEqual(result,{ at: now.toISOString(),filesRemoved: 1,bytesReclaimed: 3 });
  await assert.rejects(fs.stat(oldPartial),error => error.code === 'ENOENT');
  assert.equal((await fs.readFile(newPartial,'utf8')),'new');
  assert.equal((await fs.readFile(committed,'utf8')),'keep');
});

test('upload creation checks capacity before reservation while idempotent replay bypasses a new gate', async () => {
  const { createUploadService } = await import('../../apps/api/src/upload-service.mjs');
  const actor = { userId: '11111111-1111-4111-8111-111111111111',scopes: ['upload'] };
  const body = { targetKey: 'web',packageType: 'web_zip',declaredBytes: '1024',sha256: 'a'.repeat(64),fileName: 'game.zip',releaseLabel: '1.0.0',autoPublish: true };
  let capacityChecks = 0; let creations = 0; let replay = null; let capacityInput;
  const repository = {
    replayCreate: async () => replay,
    globalCapacityReservations: async () => ({ quarantine: 4096,validator: 8192,runtime: 8192 }),
    createIdempotent: async input => { creations += 1; return { id: input.uploadId }; },
  };
  const service = createUploadService({
    repository,objectStore: {},ids: () => '22222222-2222-4222-8222-222222222222',
    storageCapacityService: { assertCanAccept: async input => { capacityChecks += 1; capacityInput = input; throw Object.assign(new Error('full'),{ code: 'STORAGE_CAPACITY_EXCEEDED' }); } },
  });
  await assert.rejects(service.create(actor,'33333333-3333-4333-8333-333333333333',body,'idempotency-key-0001'),error => error.code === 'STORAGE_CAPACITY_EXCEEDED');
  assert.equal(creations,0);
  assert.deepEqual(capacityInput.existingReservations,{ quarantine: 4096,validator: 8192,runtime: 8192 });
  replay = { id: '44444444-4444-4444-8444-444444444444',state: 'created' };
  assert.equal((await service.create(actor,'33333333-3333-4333-8333-333333333333',body,'idempotency-key-0001')).id,replay.id);
  assert.equal(capacityChecks,1);
});
