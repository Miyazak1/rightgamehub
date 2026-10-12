const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('community account avatars expose stable preset and uploaded views', async () => {
  const { accountAvatarView, avatarColumns } = await import('../../apps/api/src/account-avatar-view.mjs');

  assert.deepEqual(accountAvatarView({}, 'user-1', 'owner'), {
    kind: 'preset',
    presetKey: 'cat',
    url: null,
    staticUrl: null,
    mediaType: null,
    animated: false,
  });
  assert.deepEqual(accountAvatarView({ owner_avatar_kind: 'preset', owner_preset_key: 'robot' }, 'user-1', 'owner'), {
    kind: 'preset',
    presetKey: 'robot',
    url: null,
    staticUrl: null,
    mediaType: null,
    animated: false,
  });
  assert.deepEqual(accountAvatarView({
    owner_avatar_kind: 'upload',
    owner_avatar_sha256: Buffer.from('0123456789abcdef', 'hex'),
    owner_media_type: 'image/gif',
    owner_avatar_animated: true,
    owner_avatar_poster_key: 'poster-key',
  }, 'user-1', 'owner'), {
    kind: 'upload',
    presetKey: null,
    url: '/v1/avatars/user-1?v=0123456789ab',
    staticUrl: '/v1/avatars/user-1?variant=static&v=0123456789ab',
    mediaType: 'image/gif',
    animated: true,
  });
  assert.match(avatarColumns('ua', 'member'), /ua\.kind AS member_avatar_kind/);
  assert.match(avatarColumns('ua', 'member'), /ua\.poster_key AS member_avatar_poster_key/);
});

test('all community people returned by projects, activities and contribution tasks include avatars', async () => {
  const sources = await Promise.all([
    fs.readFile('apps/api/src/community-project-service.mjs', 'utf8'),
    fs.readFile('apps/api/src/community-activity-service.mjs', 'utf8'),
    fs.readFile('apps/api/src/contribution-task-service.mjs', 'utf8'),
  ]);
  const source = sources.join('\n');

  for (const identity of ['owner', 'member', 'applicant', 'host', 'attendee', 'author', 'claimant']) {
    assert.match(source, new RegExp(`avatar:\\s*accountAvatarView\\([^\\n]+,'${identity}'\\)`), `${identity} must expose an avatar`);
  }
  for (const alias of ['oa', 'ma', 'aa', 'ha', 'ca']) {
    assert.match(source, new RegExp(`LEFT JOIN user_avatars ${alias} ON`), `${alias} must join user_avatars`);
  }
});

test('community nickname surfaces use the shared avatar identity component', async () => {
  const files = [
    'CommunityProjects.jsx',
    'CommunityEvents.jsx',
    'CommunityParties.jsx',
    'ContributionCenter.jsx',
    'CommunityPage.jsx',
  ];
  const sources = await Promise.all(files.map(file => fs.readFile(`packages/platform-client/src/${file}`, 'utf8')));

  for (let index = 0; index < files.length; index += 1) {
    assert.match(sources[index], /CommunityIdentity/, `${files[index]} must render identities with avatars`);
  }
  assert.match(sources[0], /person=\{project\.owner\}/);
  assert.doesNotMatch(sources[0], /person=\{project\.owner\}[^>]*showHandle/);
  assert.match(sources[0], /person=\{member\}/);
  assert.match(sources[0], /person=\{application\.applicant\}/);
  assert.match(sources[1], /person=\{event\.host\}/);
  assert.match(sources[1], /person=\{person\}/);
  assert.match(sources[2], /person=\{party\.host\}/);
  assert.match(sources[2], /person=\{member\}/);
  assert.match(sources[3], /person=\{item\.author\}/);
  assert.match(sources[3], /person=\{item\.claimant\}/);
  assert.match(sources[4], /person=\{post\.author\}/);
});
