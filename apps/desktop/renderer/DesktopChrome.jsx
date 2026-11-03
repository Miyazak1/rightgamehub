import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../packages/platform-client/src/I18n.jsx';
import { PlayerNavigation } from '../../../packages/platform-client/src/PlatformNavigation.jsx';
import DesktopUpdates from './DesktopUpdates.jsx';

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
  const production = accountTest && environment.accountEnvironment === 'production';
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const root = useRef(null), trigger = useRef(null), menu = useRef(null), info = useRef(null), updates = useRef(null);
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
      title={production ? `${en ? 'Website services' : '网页版同源服务'} · ${environment.accountApiOrigin}` : remoteTest ? `${en ? 'Isolated account test' : '隔离账号测试'} · ${environment.accountApiOrigin}` : accountTest ? (en ? 'Account connected to local test API' : '账号已连接本地隔离测试 API') : (en ? 'Local preview · no server connection' : '本地开发预览 · 未连接服务器')}><i aria-hidden="true"/><span>{production ? (en ? 'MOOYU' : '正式服务') : remoteTest ? (en ? 'Isolated test' : '隔离测试') : accountTest ? (en ? 'Local test' : '本地测试') : (en ? 'Local preview' : '本地预览')}</span></button>
    <div ref={root} className="desktop-menu">
      <button ref={trigger} type="button" className="icon-button" data-desktop-menu aria-label={en ? 'Desktop menu' : '桌面菜单'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>⋯</button>
      {open && <div ref={menu} className="desktop-menu__panel" role="menu" aria-label={en ? 'Desktop menu' : '桌面菜单'} onKeyDown={menuKeys}>
        <PlayerNavigation menu route={route} go={path => { close(true); go(path); }}/>
        <button role="menuitem" onClick={() => { close(true); go('/install'); }}>{en ? 'Integrations and Agents' : '集成与 Agent'}</button>
        <button role="menuitem" onClick={() => action('reload')}>{en ? 'Reload page' : '重新加载页面'}<kbd>Ctrl+R</kbd></button>
        <button role="menuitem" onClick={() => action('toggle-fullscreen')}>{en ? 'Toggle full screen' : '切换应用全屏'}<kbd>F11</kbd></button>
        <button role="menuitem" onClick={() => { close(); updates.current.open(); }}>{en ? 'Check for updates' : '检查更新'}</button>
        <button role="menuitem" onClick={about}>{en ? 'About this preview' : '关于本地预览'}</button>
        <div className="desktop-menu__note">{en ? 'Closing hides the window to the tray. Use Quit in the tray or Ctrl+Q to exit.' : '关闭窗口收起到托盘，完全退出请使用托盘“退出”或 Ctrl+Q。'}</div>
      </div>}
    </div>
    <dialog ref={info} className="desktop-info" onClick={event => { if (event.target === info.current) info.current.close(); }}>
      <h2>{en ? 'MOOYU desktop preview' : '墨鱼工坊桌面开发预览'}</h2>
      <p>{production ? (en ? 'Uses the website account, catalog and resource services. This device keeps its own encrypted session; server failures never fall back to test content.' : '与网页版共用账号、目录和资源服务。本设备独立保存加密会话，服务器请求失败不会回退到测试内容。') : accountTest ? (en ? 'Account and supported business pages use the same test API. Server content never falls back to local samples. Account-only servers cannot provide business content. Publishing and background execution are not connected.' : '账号与已接通的业务页面使用同一测试 API，服务器内容不会回退到本地样本。仅开放账号接口的服务器无法提供业务内容。发布与后台执行尚未接通。') : (en ? 'Local samples only. Account, server features, publishing and background execution are not connected.' : '当前只使用本地样本。账号、服务器业务、发布与后台执行尚未接通。')}</p>
      {(remoteTest || production) && <p data-desktop-test-origin>{environment.accountApiOrigin}</p>}
      <p>{en ? 'Closing hides the window to the tray. Use Quit in the tray or Ctrl+Q to exit. If the tray is unavailable, closing minimizes to the taskbar. Window size and position are restored next time. Local documents follow each tool’s save rules.' : '关闭窗口直接收起到托盘，托盘“退出”或 Ctrl+Q 完全退出。托盘不可用时会最小化到任务栏。窗口尺寸和位置将在下次启动时恢复，本地文档仍按各工具已有的保存规则处理。'}</p>
      <button className="button button--primary" autoFocus onClick={() => info.current.close()}>{en ? 'Done' : '知道了'}</button>
    </dialog>
    <DesktopUpdates ref={updates} environment={environment}/>
    {error && <span className="desktop-chrome-error" role="status">{error}</span>}
  </>;
}
