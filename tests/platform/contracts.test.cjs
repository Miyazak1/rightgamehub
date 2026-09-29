const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('contract source has strict schemas, unique operations and generated artifacts', async () => {
  const source = await import(pathToFileURL(path.join(root, 'packages/contracts/src/schema.mjs')));
  assert.equal(new Set(source.operations.map(item => item.operationId)).size, source.operations.length);
  for (const [name, schema] of Object.entries(source.schemas)) {
    assert.equal(schema.type, 'object', name);
    assert.equal(schema.additionalProperties, false, name);
  }

  const openapi = JSON.parse(fs.readFileSync(path.join(root, 'packages/contracts/generated/openapi.json'), 'utf8'));
  assert.equal(openapi.openapi, '3.1.0');
  assert.deepEqual(Object.keys(openapi.components.schemas).sort(), Object.keys(source.schemas).sort());
  assert.match(fs.readFileSync(path.join(root, 'packages/contracts/generated/index.d.ts'), 'utf8'), /export type UploadState/);
  assert.deepEqual(openapi.paths['/v1/works/{workId}/launch'].get.security, []);
  assert.ok(openapi.components.schemas.LaunchDescriptor);
});

test('author writes require bearer auth and idempotency where the contract declares it', () => {
  const openapi = JSON.parse(fs.readFileSync(path.join(root, 'packages/contracts/generated/openapi.json'), 'utf8'));
  for (const [route, pathItem] of Object.entries(openapi.paths)) {
    for (const operation of Object.values(pathItem)) {
      const sourceOperation = operation.operationId;
      if (sourceOperation === 'uploadContent') assert.deepEqual(operation.security, [{ uploadGrant: [] }], `${operation.operationId} auth`);
      else if (route.startsWith('/v1/creator/')) assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${operation.operationId} auth`);
      if (['createWork', 'createUpload', 'completeUpload'].includes(sourceOperation)) {
        assert.ok(operation.parameters.some(parameter => parameter.name === 'Idempotency-Key' && parameter.required));
      }
      if (['updateWork', 'withdrawWork'].includes(sourceOperation)) {
        assert.ok(operation.parameters.some(parameter => parameter.name === 'Idempotency-Key' && parameter.required));
        assert.ok(operation.parameters.some(parameter => parameter.name === 'If-Match' && parameter.required));
      }
    }
  }
});

test('work and upload state enums preserve the D0 state contract', async () => {
  const { enums } = await import(pathToFileURL(path.join(root, 'packages/contracts/src/schema.mjs')));
  assert.deepEqual(enums.WorkState, ['draft', 'published', 'withdrawn', 'suspended']);
  assert.deepEqual(enums.UploadState, ['created', 'receiving', 'uploaded', 'queued', 'validating', 'scanning', 'succeeded', 'failed', 'expired', 'review_required']);
  assert.ok(enums.PackageType.includes('windows_installer_exe'));
  assert.ok(enums.PackageType.includes('web_zip'));
});
