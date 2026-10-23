import React, {useEffect, useState} from 'react';
import avatarAtlas from './assets/avatar-atlas-pixel-v1.png';
import xiaomoyuAvatar from './assets/xiaomoyu-avatar-v1.webp';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const change = event => setReduced(event.matches);
    query.addEventListener?.('change', change);
    return () => query.removeEventListener?.('change', change);
  }, []);
  return reduced;
}

export default function AvatarView({avatar, api, alt = '', className = ''}) {
  const reducedMotion = useReducedMotion();
  if (avatar?.kind === 'upload') {
    return <img className={`avatar-image ${className}`} src={avatar.previewUrl || api?.avatarUrl?.(avatar, reducedMotion && avatar.staticUrl ? 'static' : 'animated')} alt={alt}/>;
  }
  if (avatar?.presetKey === 'xiaomoyu') {
    return <img className={`avatar-image avatar-image--xiaomoyu ${className}`} src={xiaomoyuAvatar} alt={alt}/>;
  }
  return <span className={`avatar-sprite avatar-sprite--${avatar?.presetKey || 'cat'} ${className}`} style={{backgroundImage: `url(${avatarAtlas})`}} role={alt ? 'img' : undefined} aria-label={alt || undefined}/>;
}
