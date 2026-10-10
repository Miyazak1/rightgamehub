import React, { useEffect, useRef, useState } from 'react';

const playerLinks = [
  ['/discover', '发现', '✦', route => route === '/discover' || route.startsWith('/works/')],
  ['/community', '社区', '✣', route => route === '/social' || route.startsWith('/community') || route.startsWith('/contribute')],
  ['/library', '游戏库', '▣', route => route === '/library'],
];

export function PlayerNavigation({ route, go, mobile = false }) {
  return <nav className={mobile ? 'mobile-nav' : 'desktop-nav'} aria-label={mobile ? '侧栏导航' : '主导航'}>
    {playerLinks.map(([path, label, icon, matches]) => <button key={path} className={'nav-item' + (matches(route) ? ' is-active' : '')} aria-current={matches(route) ? 'page' : undefined} onClick={() => go(path)}><span aria-hidden="true">{icon}</span>{label}</button>)}
  </nav>;
}

export function AccountMenu({ route, go, profile, status, avatar }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), panel = useRef(null), initialFocus = useRef('first');
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useEffect(() => setOpen(false), [route, profile?.id, profile?.canPublish, profile?.role]);
  useEffect(() => {
    if (!open) return undefined;
    const items = panel.current?.querySelectorAll('[role="menuitem"]');
    items?.[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  if (!profile) return <button className="account-login" disabled={status === 'loading'} onClick={() => go('/account')}>{status === 'loading' ? '读取账号…' : '登录'}</button>;
  const navigate = path => { close(true); go(path); };
  const openAt = position => { initialFocus.current = position; setOpen(true); };
  const keyboard = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); close(true); return; }
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
  };
  return <div className="account-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="avatar" aria-label="账号菜单" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'account-menu-items' : undefined} onClick={() => { if (open) close(); else openAt('first'); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAt(event.key === 'ArrowUp' ? 'last' : 'first'); } else if (event.key === 'Escape') close(); }}>{avatar}</button>
    {open && <div className="account-menu__panel">
      <div className="account-menu__identity"><strong>{profile.displayName}</strong><span>{profile.role === 'admin' ? '管理员' : '成员'} · {profile.canPublish ? '创作者' : '玩家'}</span></div>
      <div id="account-menu-items" ref={panel} role="menu" aria-label="账号操作" onKeyDown={keyboard}>
        <button role="menuitem" tabIndex={-1} onClick={() => navigate('/account')}>账号与设置</button>
        <button role="menuitem" tabIndex={-1} onClick={() => navigate('/creator')}>{profile.canPublish ? '创作中心' : '申请成为创作者'}</button>
        {profile.role === 'admin' && <button role="menuitem" tabIndex={-1} onClick={() => navigate('/admin')}>治理</button>}
      </div>
    </div>}
  </div>;
}

const workspaceLinks = [
  ['/creator', '我的作品', route => route === '/creator' || /^\/creator\/works\/[^/]+\/(edit|builds)$/.test(route)],
  ['/creator/works/new', '上传发布', route => route === '/creator/works/new' || /^\/creator\/works\/[^/]+\/upload$/.test(route)],
  ['/creator/import', 'GitHub 导入', route => route.startsWith('/creator/import')],
  ['/creator/multiplayer', 'AI 接入联机', route => route.startsWith('/creator/multiplayer') || route.endsWith('/ai/multiplayer')],
  ['/creator/leaderboards', 'AI 接入排行榜', route => route.startsWith('/creator/leaderboards') || route.endsWith('/ai/leaderboards')],
];

export function CreatorWorkspace({ route, go, profile, children }) {
  return <div className="creator-workspace">
    <div className="creator-workspace__head"><div><span className="kicker">CREATOR WORKSPACE</span><strong>{profile?.canPublish ? '创作者工作台' : '创作者申请'}</strong></div><button className="button button--secondary" onClick={() => go('/discover')}>← 返回 GameHub</button></div>
    {profile?.canPublish && <nav className="creator-workspace__nav" aria-label="创作中心导航">{workspaceLinks.map(([path, label, matches]) => <a href={'#' + path} key={path} aria-current={matches(route) ? 'page' : undefined} onClick={event => { event.preventDefault(); go(path); }}>{label}</a>)}</nav>}
    {children}
  </div>;
}
