const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/public-profile-service.mjs'));
const profileResult = overrides => ({
  profile: {
    id: '00000000-0000-4000-8000-000000000001', profile_handle: 'pixel-maker', display_name: 'Pixel Maker', bio: '做小而完整的游戏',
    profile_about: '喜欢像素与轻量玩法。', social_visibility: 'public', can_publish: true, role: 'user', created_at: new Date('2026-09-01T00:00:00Z'),
    avatar_kind: 'preset', preset_key: 'fox', follower_count: 3, following_count: 2, is_following: false, is_me: true,
    ...overrides,
  },
  links: [{ kind: 'github', label: 'GitHub', url: 'https://github.com/example', position: 0 }], workRows: [],
});

test('public profile supports anonymous reads and keeps the compact social identity separate', async () => {
  const { createPublicProfileService } = await import(moduleUrl);
  const calls = [];
  const service = createPublicProfileService({ repository: { getByHandle: async (viewerId, handle) => { calls.push([viewerId, handle]); return profileResult({ is_me: false }); } } });
  const profile = await service.get(null, 'PIXEL-MAKER');
  assert.equal(profile.handle, 'pixel-maker');
  assert.equal(profile.creator, true);
  assert.equal(profile.links[0].url, 'https://github.com/example');
  assert.deepEqual(calls[0], [null, 'pixel-maker']);
});

test('public profile updates normalize handles and reject unsafe links or invalid featured works', async () => {
  const { createPublicProfileService } = await import(moduleUrl);
  let saved;
  const service = createPublicProfileService({
    repository: { update: async input => { saved = input; return profileResult({ profile_handle: input.handle, bio: input.headline, profile_about: input.about, social_visibility: input.visibility }); } },
    clock: () => new Date('2026-10-01T00:00:00Z'),
  });
  const actor = { userId: '00000000-0000-4000-8000-000000000001' };
  const result = await service.update(actor, { handle: 'Pixel-Maker', headline: '  hello  ', about: '  about  ', visibility: 'followers', links: [{ kind: 'github', label: 'Code', url: 'https://github.com/example' }], featuredWorkIds: [] });
  assert.equal(result.handle, 'pixel-maker');
  assert.equal(saved.headline, 'hello');
  assert.equal(saved.links[0].url, 'https://github.com/example');
  await assert.rejects(service.update(actor, { handle: 'admin', headline: '', about: '', visibility: 'public', links: [], featuredWorkIds: [] }), error => error.code === 'SCHEMA_INVALID');
  await assert.rejects(service.update(actor, { handle: 'valid-name', headline: '', about: '', visibility: 'public', links: [{ kind: 'website', label: 'Local', url: 'https://127.0.0.1/path' }], featuredWorkIds: [] }), error => error.code === 'SCHEMA_INVALID');
});

test('hidden and conflicting profiles fail closed with stable error codes', async () => {
  const { createPublicProfileService } = await import(moduleUrl);
  const hidden = createPublicProfileService({ repository: { getByHandle: async () => null } });
  await assert.rejects(hidden.get(null, 'hidden-user'), error => error.code === 'PROFILE_NOT_FOUND' && error.statusCode === 404);
  const conflict = createPublicProfileService({ repository: { update: async () => ({ error: 'handle_taken' }) } });
  await assert.rejects(conflict.update({ userId: 'u' }, { handle: 'valid-name', headline: '', about: '', visibility: 'public', links: [], featuredWorkIds: [] }), error => error.code === 'HANDLE_TAKEN' && error.statusCode === 409);
});
