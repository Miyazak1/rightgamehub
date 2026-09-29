const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const processorUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/avatar-processor.mjs'));
const makeGif = (frames, delayCs = 10) => {
  const header = Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61,1,0,1,0,0x80,0,0,0,0,0,0xff,0xff,0xff]);
  const chunks = [header];
  for (let index = 0; index < frames; index += 1) chunks.push(Buffer.from([
    0x21,0xf9,0x04,0x01,delayCs & 0xff,(delayCs >>> 8) & 0xff,0,0,
    0x2c,0,0,0,0,1,0,1,0,0,0x02,0x02,0x44,0x01,0,
  ]));
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
};

test('avatar processor decodes pixels and emits metadata-free WebP derivatives', async () => {
  const { processAvatarImage } = await import(processorUrl);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOosLnzHwAFUAKQJastWQAAAABJRU5ErkJggg==', 'base64');
  const output = await processAvatarImage(png, { mediaType: 'image/png', animated: false });
  assert.equal(output.mediaType, 'image/webp');
  assert.equal(output.posterMediaType, 'image/webp');
  assert.equal(output.animated, false);
  assert.equal(output.frameCount, 1);
  assert.equal(output.body.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(output.posterBody.subarray(0, 4).toString('ascii'), 'RIFF');
});

test('avatar processor preserves bounded animation and creates a static poster', async () => {
  const { processAvatarImage } = await import(processorUrl);
  const output = await processAvatarImage(makeGif(2), { mediaType: 'image/gif', animated: true });
  assert.equal(output.mediaType, 'image/webp');
  assert.equal(output.animated, true);
  assert.equal(output.frameCount, 2);
  assert.equal(output.durationMs, 200);
  assert.equal(output.width, 1);
  assert.equal(output.height, 1);
  assert.equal(output.posterBody.subarray(0, 4).toString('ascii'), 'RIFF');
});

test('avatar processor fails closed on undecodable bytes', async () => {
  const { processAvatarImage, AvatarProcessingError } = await import(processorUrl);
  await assert.rejects(
    processAvatarImage(Buffer.from('not-an-image'), { mediaType: 'image/png', animated: false }),
    error => error instanceof AvatarProcessingError,
  );
});
