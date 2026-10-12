export const avatarColumns = (alias, prefix) => `${alias}.kind AS ${prefix}_avatar_kind,${alias}.preset_key AS ${prefix}_preset_key,${alias}.media_type AS ${prefix}_media_type,${alias}.sha256 AS ${prefix}_avatar_sha256,${alias}.animated AS ${prefix}_avatar_animated,${alias}.poster_body AS ${prefix}_avatar_poster_body,${alias}.poster_key AS ${prefix}_avatar_poster_key`;

export const accountAvatarView = (row, userId, prefix) => {
  if (row[`${prefix}_avatar_kind`] !== 'upload') {
    return { kind: 'preset', presetKey: row[`${prefix}_preset_key`] || 'cat', url: null, staticUrl: null, mediaType: null, animated: false };
  }
  const sha256 = row[`${prefix}_avatar_sha256`];
  const version = sha256 ? Buffer.from(sha256).toString('hex').slice(0, 12) : 'current';
  return {
    kind: 'upload', presetKey: null,
    url: `/v1/avatars/${userId}?v=${version}`,
    staticUrl: (row[`${prefix}_avatar_poster_body`] || row[`${prefix}_avatar_poster_key`]) ? `/v1/avatars/${userId}?variant=static&v=${version}` : null,
    mediaType: row[`${prefix}_media_type`], animated: row[`${prefix}_avatar_animated`] === true,
  };
};
