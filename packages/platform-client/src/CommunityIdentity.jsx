import React from 'react';
import avatarAtlas from './assets/avatar-atlas-pixel-v1.png';

function DefaultAvatar({ person, api }) {
  const avatar = person.avatar;
  if (avatar?.kind === 'upload') return <img className="avatar-image" src={avatar.previewUrl || api?.avatarUrl?.(avatar, avatar.staticUrl ? 'static' : 'animated')} alt=""/>;
  if (avatar?.kind === 'preset') return <span className={`avatar-sprite avatar-sprite--${avatar.presetKey || 'cat'}`} style={{ backgroundImage: `url(${avatarAtlas})` }} aria-hidden="true"/>;
  return <span className="community-identity__fallback" aria-hidden="true">{person.displayName?.slice(0, 1) || '?'}</span>;
}

export default function CommunityIdentity({ person, AvatarView, api, go, suffix = '', showHandle = false, className = '' }) {
  if (!person) return null;
  const content = <>
    {AvatarView ? <AvatarView avatar={person.avatar} api={api} alt=""/> : <DefaultAvatar person={person} api={api}/>}
    <span className="community-identity__copy"><strong>{person.displayName}</strong>{showHandle && person.handle && <small>@{person.handle}</small>}</span>
    {suffix && <span className="community-identity__suffix">{suffix}</span>}
  </>;
  const classes = `community-identity${className ? ` ${className}` : ''}`;
  return person.handle && go
    ? <button type="button" className={classes} onClick={() => go(`/u/${person.handle}`)} aria-label={`查看 ${person.displayName} 的主页`}>{content}</button>
    : <span className={classes}>{content}</span>;
}
