import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from './I18n.jsx';

const playerLinks = [
  ['/discover', 'navigation.discover', '✦', route => route === '/discover' || route.startsWith('/works/')],
  ['/community', 'navigation.community', '✣', route => route === '/social' || route.startsWith('/community') || route.startsWith('/contribute')],
  ['/library', 'navigation.library', '▣', route => route === '/library'],
];

export function PlayerNavigation({ route, go, mobile = false }) {
  const { t } = useI18n();
  return <nav className={mobile ? 'mobile-nav' : 'desktop-nav'} aria-label={t(mobile ? 'navigation.mobile' : 'navigation.main')}>
    {playerLinks.map(([path, label, icon, matches]) => <button key={path} className={'nav-item' + (matches(route) ? ' is-active' : '')} aria-current={matches(route) ? 'page' : undefined} onClick={() => go(path)}><span aria-hidden="true">{icon}</span>{t(label)}</button>)}
  </nav>;
}

export function AccountMenu({ route, go, profile, status, avatar }) {
  const { t } = useI18n();
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
  if (!profile) return <button className="account-login" disabled={status === 'loading'} onClick={() => go('/account')}>{t(status === 'loading' ? 'account.loading' : 'account.login')}</button>;
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
    <button ref={trigger} className="avatar" aria-label={t('account.menu')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'account-menu-items' : undefined} onClick={() => { if (open) close(); else openAt('first'); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAt(event.key === 'ArrowUp' ? 'last' : 'first'); } else if (event.key === 'Escape') close(); }}>{avatar}</button>
    {open && <div className="account-menu__panel">
      <div className="account-menu__identity"><strong>{profile.displayName}</strong><span>{t(profile.role === 'admin' ? 'account.admin' : 'account.member')} · {t(profile.canPublish ? 'account.creator' : 'account.player')}</span></div>
      <div id="account-menu-items" ref={panel} role="menu" aria-label={t('account.actions')} onKeyDown={keyboard}>
        <button role="menuitem" tabIndex={-1} onClick={() => navigate('/account')}>{t('account.settings')}</button>
        <button role="menuitem" tabIndex={-1} onClick={() => navigate('/creator')}>{t(profile.canPublish ? 'account.creatorCenter' : 'account.applyCreator')}</button>
        {profile.role === 'admin' && <button role="menuitem" tabIndex={-1} onClick={() => navigate('/admin')}>{t('account.governance')}</button>}
      </div>
    </div>}
  </div>;
}

const workspaceLinks = [
  ['/creator', 'creator.nav.works', route => route === '/creator' || /^\/creator\/works\/[^/]+\/(edit|builds)$/.test(route)],
  ['/creator/works/new', 'creator.nav.upload', route => route === '/creator/works/new' || /^\/creator\/works\/[^/]+\/upload$/.test(route)],
  ['/creator/import', 'creator.nav.import', route => route.startsWith('/creator/import')],
  ['/creator/multiplayer', 'creator.nav.multiplayer', route => route.startsWith('/creator/multiplayer') || route.endsWith('/ai/multiplayer')],
  ['/creator/leaderboards', 'creator.nav.leaderboards', route => route.startsWith('/creator/leaderboards') || route.endsWith('/ai/leaderboards')],
];

export function CreatorWorkspace({ route, go, profile, children }) {
  const {t}=useI18n();
  return <div className="creator-workspace">
    <div className="creator-workspace__head"><div><span className="kicker">CREATOR WORKSPACE</span><strong>{t(profile?.canPublish?'creator.workspace':'creator.application')}</strong></div><button className="button button--secondary" onClick={() => go('/discover')}>← {t('creator.backPlatform')}</button></div>
    {profile?.canPublish && <nav className="creator-workspace__nav" aria-label={t('creator.navigation')}>{workspaceLinks.map(([path, label, matches]) => <a href={path} key={path} aria-current={matches(route) ? 'page' : undefined} onClick={event => { event.preventDefault(); go(path); }}>{t(label)}</a>)}</nav>}
    {children}
  </div>;
}
