import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../packages/platform-client/src/I18n.jsx';
import { PlayerNavigation } from '../../../packages/platform-client/src/PlatformNavigation.jsx';

const chrome = globalThis.mooyuDesktop.chrome;
export function DesktopLeading({ themeMode }) {
  const { locale } = useI18n(), en = locale === 'en';
  const [state, setState] = useState({ canGoBack: false, canGoForward: false });
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const apply = value => { if (live) { setState(value); document.documentElement.toggleAttribute('data-desktop-fullscreen', value.fullScreen); } };
    const off = chrome.onState(apply);
    chrome.state().then(apply).catch(() => { if (live) setError(en ? 'Window controls unavailable' : '窗口操作暂不可用'); });
    return () => { live = false; off(); };
  }, []);
  useEffect(() => { chrome.theme(themeMode).catch(() => {}); }, [themeMode]);
  const action = value => { setError(''); chrome.action(value).catch(() => setError(en ? 'Window action failed' : '窗口操作未完成')); };
  return <div className="desktop-history" aria-label={en ? 'Page history' : '页面历史'}>
    <button type="button" data-desktop-back aria-label={en ? 'Back' : '返回'} title={en ? 'Back (Alt+Left)' : '返回（Alt+左箭头）'} disabled={!state.canGoBack} onClick={() => action('back')}>←</button>
    <button type="button" data-desktop-forward aria-label={en ? 'Forward' : '前进'} title={en ? 'Forward (Alt+Right)' : '前进（Alt+右箭头）'} disabled={!state.canGoForward} onClick={() => action('forward')}>→</button>
    {error && <span className="desktop-chrome-error" role="status">{error}</span>}
  </div>;
}

export function DesktopActions({ go, route, environment }) {
  const { locale } = useI18n(), en = locale === 'en';
  const accountTest = environment?.accountConfigured;
  const remoteTest = accountTest && environment.accountEnvironment === 'isolated-test';
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const root = useRef(null), trigger = useRef(null), menu = useRef(null), info = useRef(null);
  const visibleItems = () => [...(menu.current?.querySelectorAll('button') ?? [])].filter(item => item.getClientRects().length);
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    visibleItems()[0]?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const action = value => { close(true); setError(''); chrome.action(value).catch(() => setError(en ? 'Window action failed' : '窗口操作未完成')); };
  const menuKeys = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { if (event.key === 'Tab') close(); return; }
    event.preventDefault(); const items = visibleItems(), index = items.indexOf(document.activeElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const about = () => { close(); info.current.showModal(); };
  return <>
    <button type="button" data-desktop-preview className="desktop-preview-tag" onClick={about}
      title={remoteTest ? `${en ? 'Isolated account test' : '隔离账号测试'} · ${environment.accountApiOrigin}` : accountTest ? (en ? 'Account connected to local test API' : '账号已连接本地隔离测试 API') : (en ? 'Local preview · no server connection' : '本地开发预览 · 未连接服务器')}><i aria-hidden="true"/><span>{remoteTest ? (en ? 'Isolated test' : '隔离测试') : accountTest ? (en ? 'Local test' : '本地测试') : (en ? 'Local preview' : '本地预览')}</span></button>
    <div ref={root} className="desktop-menu">
      <button ref={trigger} type="button" className="icon-button" data-desktop-menu aria-label={en ? 'Desktop menu' : '桌面菜单'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>⋯</button>
      {open && <div ref={menu} className="desktop-menu__panel" role="menu" aria-label={en ? 'Desktop menu' : '桌面菜单'} onKeyDown={menuKeys}>
        <PlayerNavigation menu route={route} go={path => { close(true); go(path); }}/>
        <button role="menuitem" onClick={() => { close(true); go('/install'); }}>{en ? 'Integrations and Agents' : '集成与 Agent'}</button>
        <button role="menuitem" onClick={() => action('reload')}>{en ? 'Reload page' : '重新加载页面'}<kbd>Ctrl+R</kbd></button>
        <button role="menuitem" onClick={() => action('toggle-fullscreen')}>{en ? 'Toggle full screen' : '切换应用全屏'}<kbd>F11</kbd></button>
        <button role="menuitem" onClick={about}>{en ? 'About this preview' : '关于本地预览'}</button>
        <div className="desktop-menu__note">{en ? 'Closing the window exits this preview.' : '关闭窗口即退出当前预览。'}</div>
        <button role="menuitem" onClick={() => action('quit')}>{en ? 'Quit MOOYU' : '退出墨鱼工坊'}<kbd>Ctrl+Q</kbd></button>
      </div>}
    </div>
    <dialog ref={info} className="desktop-info" onClick={event => { if (event.target === info.current) info.current.close(); }}>
      <h2>{en ? 'MOOYU desktop preview' : '墨鱼工坊桌面开发预览'}</h2>
      <p>{remoteTest ? (en ? 'Account is configured for an isolated HTTPS test API. Other pages still use local samples; publishing and background execution are not connected.' : '账号配置为独立 HTTPS 测试 API。其他页面仍使用本地样本，发布与后台执行尚未接通。') : accountTest ? (en ? 'Account uses a local isolated test API. Other pages still use local samples; publishing and background execution are not connected.' : '账号连接本地隔离测试 API。其他页面仍使用本地样本，发布与后台执行尚未接通。') : (en ? 'Local samples only. Account, server features, publishing and background execution are not connected.' : '当前只使用本地样本。账号、服务器业务、发布与后台执行尚未接通。')}</p>
      {remoteTest && <p data-desktop-test-origin>{environment.accountApiOrigin}</p>}
      <p>{en ? 'Closing this window exits the preview. Window size and position are restored next time. Local documents follow each tool’s existing save rules.' : '关闭窗口会退出预览，窗口尺寸和位置将在下次启动时恢复。本地文档仍按各工具已有的保存规则处理。'}</p>
      <button className="button button--primary" autoFocus onClick={() => info.current.close()}>{en ? 'Done' : '知道了'}</button>
    </dialog>
    {error && <span className="desktop-chrome-error" role="status">{error}</span>}
  </>;
}
