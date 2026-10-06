import React, { useEffect, useMemo, useRef, useState } from 'react';
import { applyThemeTokens, createBrowserHostAdapter } from '@gamehub/host-contract';
import { createApiClient } from '@gamehub/platform-api-client';
import { PlayerCore } from '@gamehub/player-core';
import { demoUploads, demoWorks } from './demo.mjs';
import pixelCoverAtlas from './assets/game-covers-pixel-v1-optimized.png';
import avatarAtlas from './assets/avatar-atlas-pixel-v1.png';
import GuessBaikeGame from './GuessBaikeGame.jsx';
import { formatBytes, uploadErrorMessage } from './upload-display.mjs';
import { createWebGameHost } from './web-game-host.mjs';
import CloudSaveStatus from './CloudSaveStatus.jsx';
import SaveManager from './SaveManager.jsx';
import { playerRuntimeOptions } from './player-runtime-options.mjs';
import MultiplayerDeveloperCenter from './MultiplayerDeveloperCenter.jsx';
import MultiplayerRuleSubmissionPage from './MultiplayerRuleSubmissionPage.jsx';
import MultiplayerRuleReviewQueue from './MultiplayerRuleReviewQueue.jsx';
import { ContributionCenterPage, CreateContributionTaskForm, CreatorContributionTasks } from './ContributionCenter.jsx';

const icons = {
  discover: '✦', library: '▣', social: '✣', creator: '◇', account: '○', search: '⌕', play: '▶', back: '←', upload: '↑', check: '✓', dot: '•', spark: '✦', settings: '⚙', close: '×', file: '▤', globe: '◎', pause: 'Ⅱ', stop: '■', refresh: '↻',
};

const hostIdentities = {
  browser: { id: 'browser', label: 'Web 预览', short: 'WEB' },
  codex: { id: 'codex', label: 'Codex', short: 'CX' },
  cursor: { id: 'cursor', label: 'Cursor', short: 'CU' },
  harness: { id: 'harness', label: 'Harness', short: 'DSH' },
  vscode: { id: 'vscode', label: 'VS Code', short: 'VS' },
};
const avatarPresets = [
  { key: 'cat', label: '星际猫' }, { key: 'robot', label: '信号机器人' }, { key: 'sprout', label: '萌芽史莱姆' },
  { key: 'fox', label: '飞行狐狸' }, { key: 'ghost', label: '街机幽灵' }, { key: 'wizard', label: '月光法师' },
];
const GUESS_BAIKE_WORK_ID = 'gamehub-guess-baike';
const PUBLIC_GAMEHUB_URL = 'https://mooyu.fun';
const demoAccountProfile = { id: 'demo-user', profileHandle: 'miyazaki1', displayName: '休息玩家', role: 'user', canPublish: true, createdAt: '2026-09-28T00:00:00.000Z', avatar: { kind: 'preset', presetKey: 'cat', url: null, staticUrl: null, mediaType: null, animated: false }, linkedAccounts: [{ provider: 'github', label: 'GitHub', linkedAt: '2026-09-28T00:00:00.000Z' }] };

const analyticsId = (storage, key) => {
  try { const current = storage?.getItem(key); if (current) return current; const next = globalThis.crypto?.randomUUID?.(); if (next) storage?.setItem(key, next); return next; } catch { return null; }
};
const analyticsIdentity = () => ({
  anonymousId: analyticsId(globalThis.localStorage, 'gamehub.analytics.anonymous') ?? globalThis.crypto?.randomUUID?.(),
  sessionId: analyticsId(globalThis.sessionStorage, 'gamehub.analytics.session') ?? globalThis.crypto?.randomUUID?.(),
});
const routeCategory = route => {
  const head = String(route || '').split('/').filter(Boolean)[0];
  return ({ discover: 'discover', library: 'library', social: 'social', creator: 'creator', admin: 'admin', works: 'work', play: 'play', account: 'auth', install: 'settings', u: 'profile' })[head] ?? 'unknown';
};
const emitAnalytics = (api, hostKind, event, demo = false) => {
  if (demo || !api?.trackAnalytics) return;
  const identity = analyticsIdentity();
  if (!identity.anonymousId || !identity.sessionId) return;
  api.trackAnalytics([{ ...identity, hostKind: hostKind || 'unknown', occurredAt: new Date().toISOString(), ...event }]).catch(() => {});
};

function resolveHostIdentity(capabilities = {}) {
  const id = String(capabilities.host || 'browser').toLowerCase();
  return hostIdentities[id] ?? { id, label: capabilities.host || '未知宿主', short: id.slice(0, 3).toUpperCase() };
}

const uploadSteps = [
  ['created', '已创建'], ['receiving', '正在上传'], ['uploaded', '上传完成'], ['queued', '等待检查'], ['validating', '正在校验'], ['scanning', '安全规则检查'], ['succeeded', '可发布'], ['published', '已发布'],
];
const processingStates = new Set(['queued', 'validating', 'scanning']);

function useRoute(mode) {
  const [path, setPath] = useState(() => mode === 'hash' ? location.hash.slice(1) || '/discover' : '/discover');
  useEffect(() => {
    if (mode !== 'hash') return undefined;
    const onHash = () => setPath(location.hash.slice(1) || '/discover');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [mode]);
  useEffect(() => { globalThis.scrollTo?.({ top: 0, left: 0, behavior: 'instant' }); }, [path]);
  const go = next => { if (mode === 'hash') location.hash = next; else setPath(next); };
  return [path, go];
}

function Button({ children, kind = 'primary', icon, className = '', ...props }) {
  return <button className={`button button--${kind} ${className}`} {...props}>{icon && <span aria-hidden="true">{icon}</span>}<span>{children}</span></button>;
}

function DownloadLink({ children, href, fileName, onClick }) {
  return <a className="button button--primary" href={href} download={fileName || undefined} onClick={onClick}><span aria-hidden="true">↓</span><span>{children}</span></a>;
}

function Logo() {
  return <div className="logo" aria-label="GameHub"><span className="logo__mark"><i /><i /><i /></span><span>GAME<span>HUB</span></span></div>;
}

function GitHubLogo() {
  return <svg className="github-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.2c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.04 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.29-5.28-1.29-5.28-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.9 10.9 0 0 1 12 5.94c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.78 1.07.78 2.16v3.21c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => { const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'); if (!query) return undefined; const change = event => setReduced(event.matches); query.addEventListener?.('change', change); return () => query.removeEventListener?.('change', change); }, []);
  return reduced;
}

function AvatarView({ avatar, api, alt = '', className = '' }) {
  const reducedMotion = useReducedMotion();
  if (avatar?.kind === 'upload') return <img className={`avatar-image ${className}`} src={avatar.previewUrl || api?.avatarUrl?.(avatar, reducedMotion && avatar.staticUrl ? 'static' : 'animated')} alt={alt}/>;
  return <span className={`avatar-sprite avatar-sprite--${avatar?.presetKey || 'cat'} ${className}`} style={{ backgroundImage: `url(${avatarAtlas})` }} role={alt ? 'img' : undefined} aria-label={alt || undefined}/>;
}

function Header({ route, go, themeMode, setThemeMode, canChangeTheme, hostIdentity, accountProfile, api }) {
  return <header className="header">
    <button className="brand-button" onClick={() => go('/discover')}><Logo /></button>
    <nav className="desktop-nav" aria-label="主导航">
      <NavItem active={route.startsWith('/discover') || route.startsWith('/works/')} onClick={() => go('/discover')} icon={icons.discover}>发现</NavItem>
      <NavItem active={route === '/library'} onClick={() => go('/library')} icon={icons.library}>游戏库</NavItem>
      <NavItem active={route === '/social'} onClick={() => go('/social')} icon={icons.social}>休息室</NavItem>
      <NavItem active={route === '/contribute'} onClick={() => go('/contribute')} icon="↗">共建</NavItem>
      <NavItem active={route.startsWith('/creator')} onClick={() => go('/creator')} icon={icons.creator}>创作中心</NavItem>
      <NavItem active={route === '/install'} onClick={() => go('/install')} icon="＋">添加到 Agent</NavItem>
      {accountProfile?.role === 'admin' && <NavItem active={route.startsWith('/admin')} onClick={() => go('/admin')} icon="!">治理</NavItem>}
    </nav>
    <div className="header__tools">
      <div className="host-chip" aria-label={`当前宿主：${hostIdentity.label}`} title={`界面主题跟随 ${hostIdentity.label}`}><span className="host-mark" aria-hidden="true">{hostIdentity.short}</span><span>{hostIdentity.label}</span></div>
      <button className="icon-button" disabled={!canChangeTheme} onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : themeMode === 'light' ? 'high-contrast' : 'dark')} aria-label={canChangeTheme ? `当前${themeMode}主题，点击切换` : `当前${themeMode}主题，跟随宿主`} title={canChangeTheme ? '切换主题' : `主题跟随 ${hostIdentity.label}`}>{themeMode === 'light' ? '☼' : themeMode === 'high-contrast' ? '◐' : '☾'}</button>
      <button className="avatar" onClick={() => go('/account')} aria-label="账号">{accountProfile ? <AvatarView avatar={accountProfile.avatar} api={api} alt=""/> : 'R'}</button>
    </div>
  </header>;
}

function NavItem({ active, icon, children, ...props }) { return <button className={`nav-item ${active ? 'is-active' : ''}`} {...props}><span aria-hidden="true">{icon}</span>{children}</button>; }

function MobileNav({ route, go }) {
  return <nav className="mobile-nav" aria-label="侧栏导航">
    <NavItem active={route.startsWith('/discover') || route.startsWith('/works/')} onClick={() => go('/discover')} icon={icons.discover}>游玩</NavItem>
    <NavItem active={route === '/library'} onClick={() => go('/library')} icon={icons.library}>游戏库</NavItem>
    <NavItem active={route === '/social'} onClick={() => go('/social')} icon={icons.social}>休息室</NavItem>
    <NavItem active={route === '/contribute'} onClick={() => go('/contribute')} icon="↗">共建</NavItem>
    <NavItem active={route.startsWith('/creator')} onClick={() => go('/creator')} icon={icons.creator}>创作</NavItem>
    <NavItem active={route === '/install'} onClick={() => go('/install')} icon="＋">安装</NavItem>
  </nav>;
}

function Art({ work, large = false }) {
  if (work.id === GUESS_BAIKE_WORK_ID || work.art === 'baike') return <div className={`art art--baike ${large ? 'art--large' : ''}`}><div className="baike-cover"><span className="baike-cover__book"><i/><i/><i/><b>百</b></span><span className="baike-cover__copy"><small>GAMEHUB ORIGINAL</small><strong>猜百科</strong><em>逐字揭开 · 推理标题</em></span></div><span className="art__pixel-corner" aria-hidden="true" /></div>;
  if (work.coverUrl) return <div className={`art art--cover ${large ? 'art--large' : ''}`}><img src={work.coverUrl} alt=""/><span className="art__pixel-corner" aria-hidden="true" /></div>;
  return <div className={`art art--${work.art ?? 'violet'} ${large ? 'art--large' : ''}`}><div className="art__pixel" style={{ backgroundImage: `url(${pixelCoverAtlas})` }} /><span className="art__pixel-corner" aria-hidden="true" /></div>;
}

const workHasWebRelease = work => work.id === GUESS_BAIKE_WORK_ID || work.targets?.some(target => target.targetKey === 'web' && target.currentReleaseId);
const workHasWindowsRelease = work => work.targets?.some(target => target.targetKey === 'windows-x64' && target.currentReleaseId);
const workActionPath = work => workHasWebRelease(work) ? `/play/${work.id}` : `/works/${work.id}`;
const workPlatformLabel = work => workHasWebRelease(work) ? 'Web' : workHasWindowsRelease(work) ? 'Windows' : '详情';

function WorkCard({ work, go, featured = false }) {
  return <article className={`work-card ${featured ? 'work-card--featured' : ''}`}>
    <button className="card-open" onClick={() => go(`/works/${work.id}`)} aria-label={`查看 ${work.title}`}><Art work={work} large={featured} /></button>
    <div className="work-card__body"><div><span className="eyebrow">{work.tag ?? (work.kind === 'game' ? '游戏' : '创意')}</span><h3>{work.title}</h3>{work.creatorHandle && <button className="creator-profile-link" onClick={() => go(`/u/${work.creatorHandle}`)}>by {work.creatorDisplayName ?? '社区作者'}</button>}</div><p>{work.description}</p><div className="card-meta"><span>{icons.globe} {workPlatformLabel(work)}</span><span>{icons.play} {work.plays ?? '新作'}</span></div></div>
    <button className="round-play" onClick={() => go(workActionPath(work))} aria-label={`${workHasWebRelease(work) ? '开始玩' : '查看 Windows 启动方式'} ${work.title}`}>{icons.play}</button>
  </article>;
}

const workTag = work => work.tags?.[0] ?? work.tag ?? (work.kind === 'game' ? '游戏' : work.kind === 'tool' ? '工具' : '互动');
const workPlays = work => work.plays ?? (work.playCount ? `${work.playCount.toLocaleString('zh-CN')} 次` : '新作');
const workHeat = work => Number(work.playCount ?? 0) + Number(work.saveCount ?? 0) * 4;

function QuietWorkRow({ work, go }) {
  return <article className="quiet-work-row">
    <button className="quiet-work-row__main" onClick={() => go(`/works/${work.id}`)} aria-label={`查看 ${work.title}`}>
      <Art work={work} />
      <span className="quiet-work-row__copy"><strong>{work.title}</strong><small>{workTag(work)} · {work.estimatedMinutes ?? 3} 分钟 · {work.creatorDisplayName ?? '社区作者'}</small></span>
    </button>
    <button className="quiet-play" onClick={() => go(workActionPath(work))} aria-label={`${workHasWebRelease(work) ? '开始玩' : '查看 Windows 启动方式'} ${work.title}`}>{icons.play}</button>
  </article>;
}

function DailyPick({ work, go, index }) {
  return <article className="daily-pick">
    <button className="daily-pick__open" onClick={() => go(`/works/${work.id}`)} aria-label={`查看今日推荐 ${work.title}`}>
      <Art work={work} />
      <span className="daily-pick__number" aria-hidden="true">0{index + 1}</span>
    </button>
    <div className="daily-pick__body">
      <div><span>{workTag(work)}</span><small>约 {work.estimatedMinutes ?? 3} 分钟</small></div>
      <strong>{work.title}</strong>
      <button onClick={() => go(workActionPath(work))} aria-label={`${workHasWebRelease(work) ? '开始玩' : '查看 Windows 启动方式'} ${work.title}`}>{icons.play}<span>{workHasWebRelease(work) ? '开始' : 'Windows'}</span></button>
    </div>
  </article>;
}

function CommunityProject({ work, go }) {
  return <article className="community-project">
    <button className="community-project__art" onClick={() => go(`/works/${work.id}`)} aria-label={`查看社区项目 ${work.title}`}><Art work={work}/></button>
    <div className="community-project__copy">
      <div className="project-badges"><span>{workTag(work)}</span>{work.agentLabel && <span>{work.agentLabel}</span>}{work.repositoryUrl && <span>OPEN SOURCE</span>}</div>
      <button onClick={() => go(`/works/${work.id}`)}><strong>{work.title}</strong><small>by {work.creatorDisplayName ?? '社区作者'}</small></button>{work.creatorHandle && <button className="creator-profile-link" onClick={() => go(`/u/${work.creatorHandle}`)}>查看作者主页 →</button>}
      <p>{work.description}</p>
      <div><span>{work.estimatedMinutes ?? 3} MIN</span><span>{workPlays(work)}</span><button onClick={() => go(workActionPath(work))}>{icons.play} {workHasWebRelease(work) ? '玩一下' : 'Windows 版'}</button></div>
    </div>
  </article>;
}

function LoadingCards() { return <div className="work-grid" aria-label="正在载入作品">{[1,2,3,4].map(x => <div className="skeleton-card" key={x}><span /><i /><i /></div>)}</div>; }

function DiscoverPage({ api, demo, go, hostIdentity }) {
  const [status, setStatus] = useState('loading'); const [works, setWorks] = useState([]); const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  const load = async () => { setStatus('loading'); try { const result = demo ? { data: demoWorks } : await api.listWorks({ limit: 20 }); setWorks(result.data); setStatus(result.data.length ? 'ready' : 'empty'); } catch { setStatus('error'); } };
  useEffect(() => { load(); }, [demo]);
  const shown = works.filter(w => (filter === 'all' || w.kind === filter) && (!query || `${w.title} ${w.description} ${(w.tags ?? []).join(' ')} ${w.creatorDisplayName ?? ''} ${w.agentLabel ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  const dailyPicks = status === 'ready' ? works.slice(0, 3) : [];
  const communityPicks = status === 'ready' ? works.filter(work => work.id !== GUESS_BAIKE_WORK_ID).sort((a, b) => workHeat(b) - workHeat(a) || String(b.firstPublishedAt).localeCompare(String(a.firstPublishedAt))).slice(0, 4) : [];
  const dailyIds = new Set(dailyPicks.map(work => work.id));
  const list = shown.filter(work => query || filter !== 'all' || !dailyIds.has(work.id));
  return <main className="page discover-page">
    <header className="quiet-heading"><div><span className="quiet-presence"><i/>{hostIdentity.label} 里的休息站</span><h1>休息一下？</h1><p>选个轻量游戏，几分钟后继续写代码。</p></div></header>
    {status === 'loading' && <LoadingCards />}
    {status === 'error' && <StatePanel title="暂时无法加载作品" body="网络可能开了个小差。你的本地游戏与上传任务不会受影响。" action="重新连接" onAction={load} />}
    {status === 'empty' && <StatePanel title="这里还很安静" body="第一批作品正在路上。成为第一个发布创意的人吧。" action="发布作品" onAction={() => go('/creator')} />}
    {!!dailyPicks.length && <section className="daily-section" aria-labelledby="daily-title"><div className="daily-section__heading"><div><span>DAILY BREAK</span><h2 id="daily-title">今日摸鱼</h2></div><small>短局 · 静音友好 · 随时停</small></div><div className="daily-grid">{dailyPicks.map((work, index) => <DailyPick work={work} go={go} index={index} key={work.id}/>)}</div></section>}
    {!!communityPicks.length && <section className="community-showcase" aria-labelledby="community-title"><div className="community-showcase__heading"><div><span>MADE WITH AGENTS</span><h2 id="community-title">社区在玩</h2></div><small>真实发布 · 自动按游玩与收藏发现</small></div><div className="community-projects">{communityPicks.map(work => <CommunityProject work={work} go={go} key={work.id}/>)}</div></section>}
    <section id="catalog" className="catalog-section quiet-catalog"><div className="section-heading"><div><h2>换个脑子</h2><p>不离开 {hostIdentity.label}，随开随停。</p></div><label className="search"><span>{icons.search}</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索小游戏" /></label></div>
      <div className="filter-row" role="group" aria-label="作品类型">{[['all','全部'],['game','游戏'],['creative','互动'],['tool','工具']].map(([id,label]) => <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {status === 'ready' && (shown.length ? (list.length ? <div className="quiet-work-list">{list.map(work => <QuietWorkRow work={work} go={go} key={work.id} />)}</div> : <p className="quiet-all-seen">更多轻量作品正在路上。</p>) : <StatePanel title="没有找到匹配作品" body="换一个关键词或类型试试。" action="清除筛选" onAction={() => { setQuery(''); setFilter('all'); }} />)}
    </section>
  </main>;
}

function StatePanel({ title, body, action, onAction }) { return <div className="state-panel"><span>{icons.spark}</span><h3>{title}</h3><p>{body}</p>{action && <Button kind="secondary" onClick={onAction}>{action}</Button>}</div>; }

function DetailPage({ workId, api, host, hostKind, demo, go }) {
  const [state, setState] = useState({ status: 'loading' });
  const [library, setLibrary] = useState(null); const [libraryBusy, setLibraryBusy] = useState(false);
  const [reporting, setReporting] = useState(false); const [feedbackOpen, setFeedbackOpen] = useState(false); const [nativeBusy, setNativeBusy] = useState(false); const [nativeMessage, setNativeMessage] = useState(''); const [nativeDownload, setNativeDownload] = useState({ phase: 'idle', percent: 0 });
  useEffect(() => { let live = true; (async () => { try { const data = demo ? demoWorks.find(w => w.id === workId) : (await api.getWork(workId)).data; if (live) setState(data ? { status: 'ready', data } : { status: 'missing' }); } catch { if (live) setState({ status: 'error' }); } })(); return () => { live = false; }; }, [workId, demo]);
  useEffect(() => { let live = true; if (demo) { setLibrary({ savedAt: null }); return undefined; } api.getLibraryState(workId).then(({ data }) => { if (live) setLibrary(data); }).catch(() => {}); return () => { live = false; }; }, [workId, demo, api]);
  useEffect(() => { if (state.status === 'ready' && hostKind) emitAnalytics(api, hostKind, { type: 'work_view', route: 'work', workId }, demo); }, [state.status, workId, api, hostKind, demo]);
  useEffect(() => {
    if (state.status !== 'ready' || !host?.desktop?.getReleaseStatus) return undefined;
    const target = state.data.targets?.find(item => item.targetKey === 'windows-x64' && item.currentReleaseId);
    if (!target) return undefined;
    const release = { workId: state.data.id, releaseId: target.currentReleaseId, fileName: target.fileName, sizeBytes: target.sizeBytes, sha256: target.sha256 };
    let live = true;
    host.desktop.getReleaseStatus(release).then(status => {
      if (!live) return;
      const progress = status.download;
      if (status.prepared || progress?.state === 'ready') setNativeDownload({ phase: 'ready', percent: 100 });
      else if (progress && ['checking', 'downloading', 'verifying'].includes(progress.state)) setNativeDownload({ phase: progress.state, percent: progress.percent || 0 });
    }).catch(() => {});
    return () => { live = false; };
  }, [state.status, state.data, host]);
  if (state.status === 'loading') return <main className="page"><LoadingCards /></main>;
  if (state.status !== 'ready') return <main className="page"><StatePanel title={state.status === 'missing' ? '作品不存在或已撤下' : '无法打开作品'} body="回到发现页看看其他作品。" action="返回发现" onAction={() => go('/discover')} /></main>;
  const work = state.data; const builtIn = work.id === GUESS_BAIKE_WORK_ID; const web = builtIn ? { currentReleaseId: '' } : work.targets.find(x => x.targetKey === 'web' && x.currentReleaseId); const windows = builtIn ? null : work.targets.find(x => x.targetKey === 'windows-x64' && x.currentReleaseId);
  const managedWindows = Boolean(host?.desktop?.prepareRelease && host?.desktop?.launchRelease);
  const windowsDownloadUrl = windows ? api.releaseDownloadUrl(work.id, windows.currentReleaseId) : null;
  const toggleLibrary = async () => { setLibraryBusy(true); try { const result = demo ? { data: { savedAt: library?.savedAt ? null : new Date().toISOString() } } : library?.savedAt ? await api.removeFromLibrary(work.id) : await api.saveToLibrary(work.id); setLibrary(result.data); } catch (caught) { if (caught.status === 401) go('/account'); } finally { setLibraryBusy(false); } };
  const launchWindows = async () => {
    if (!windows) return;
    const release = { workId: work.id, releaseId: windows.currentReleaseId, fileName: windows.fileName, sizeBytes: windows.sizeBytes, sha256: windows.sha256 };
    if (!managedWindows) return;
    if (nativeDownload.phase === 'ready') {
      setNativeBusy(true); setNativeDownload(current => ({ ...current, phase: 'launching' })); setNativeMessage('正在启动游戏…');
      try {
        await host.desktop.launchRelease(release);
        emitAnalytics(api, hostKind, { type: 'game_start', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo);
        setNativeDownload({ phase: 'ready', percent: 100 });
        setNativeMessage('游戏已启动，请查看独立窗口。');
      } catch (caught) {
        setNativeDownload({ phase: 'ready', percent: 100 });
        setNativeMessage(caught.message || 'Windows 游戏未能启动。');
      } finally { setNativeBusy(false); }
      return;
    }
    setNativeBusy(true); setNativeDownload({ phase: 'downloading', percent: 0 }); setNativeMessage('正在下载到 GameHub 本地游戏库…');
    emitAnalytics(api, hostKind, { type: 'download_start', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo);
    try {
      await host.desktop.prepareRelease(release, { onProgress: progress => setNativeDownload({ phase: progress?.state || 'downloading', percent: progress?.percent || 0 }) });
      emitAnalytics(api, hostKind, { type: 'download_complete', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo);
      setNativeDownload({ phase: 'ready', percent: 100 });
      setNativeMessage('下载和校验已完成，可以启动游戏。');
    } catch (caught) {
      setNativeDownload(current => ({ ...current, phase: 'failed' }));
      setNativeMessage(caught.message || 'Windows 游戏下载失败。');
    } finally { setNativeBusy(false); }
  };

  return <main className="page detail-page"><button className="back-link" onClick={() => go('/discover')}>{icons.back} 返回发现</button><section className="detail-hero"><Art work={work} large /><div className="detail-copy"><div className="badge-row"><span className="status-badge">{icons.check} {builtIn ? 'GameHub 官方游戏' : web ? '已验证 Web 版本' : '已验证 Windows 版本'}</span><span>{work.kind === 'game' ? '游戏' : '互动作品'}</span></div><h1>{work.title}</h1><p className="detail-byline">by {work.creatorDisplayName ?? (builtIn ? 'GameHub' : '社区作者')} · 约 {work.estimatedMinutes ?? 3} 分钟{work.agentLabel ? ` · ${work.agentLabel} 共创` : ''}</p><p className="detail-lead">{work.description}</p>{!!work.tags?.length && <div className="detail-tags">{work.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}<div className="detail-actions">{web && <Button icon={icons.play} onClick={() => go(`/play/${work.id}/${web.currentReleaseId ?? ''}`)}>立即游玩</Button>}{windows && (managedWindows ? <Button icon={nativeDownload.phase === 'ready' ? icons.play : "↓"} disabled={nativeBusy} onClick={launchWindows}>{nativeDownload.phase === 'launching' ? '正在启动…' : ['checking','downloading','verifying'].includes(nativeDownload.phase) ? `下载中 ${nativeDownload.percent}%` : nativeDownload.phase === 'ready' ? '启动游戏' : '下载 Windows 版'}</Button> : <DownloadLink href={windowsDownloadUrl} fileName={windows.fileName} onClick={() => emitAnalytics(api, hostKind, { type: 'download_start', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo)}>下载 Windows 版</DownloadLink>)}<Button kind="secondary" disabled={libraryBusy} onClick={toggleLibrary}>{library?.savedAt ? '移出游戏库' : '加入游戏库'}</Button></div>{managedWindows && windows && ['checking','downloading','verifying'].includes(nativeDownload.phase) && <div className="native-download-progress" role="progressbar" aria-label="Windows 游戏下载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={nativeDownload.percent}><i style={{ width: `${nativeDownload.percent}%` }}/></div>}<p className="friendly-note">{windows && !web ? (managedWindows ? '保存到 GameHub 本地游戏库 · 下载后校验完整性 · 只运行你信任的作品' : '由浏览器下载 Windows 游戏文件 · 下载后请手动运行 · 只运行你信任的作品') : '隔离运行 · 不读取项目文件与宿主凭据'}</p>{nativeMessage && <p className="friendly-note" role="status">{nativeMessage}</p>}{!builtIn && <div className="community-actions"><button className="feedback-link" onClick={() => setFeedbackOpen(true)}>反馈给作者</button><button className="report-link" onClick={() => setReporting(true)}>举报这个作品</button></div>}</div></section><section className="detail-columns"><div className="panel"><span className="kicker">HOW TO PLAY</span><h2>玩法说明</h2><p>{work.instructions || '作者暂未提供额外说明。打开游戏后跟随画面提示即可。'}</p>{work.repositoryUrl && <p className="source-link"><a href={work.repositoryUrl} target="_blank" rel="noreferrer">在 GitHub 查看源码 ↗</a><small>{work.licenseSpdx} 开源许可</small></p>}</div><div className="panel facts"><span className="kicker">COMPATIBILITY</span><h2>运行信息</h2><dl><div><dt>运行方式</dt><dd>{web ? '侧栏 Web' : 'Windows 独立窗口'}</dd></div><div><dt>当前版本</dt><dd>修订 {work.revision}</dd></div><div><dt>社区数据</dt><dd>{workPlays(work)} · {work.saveCount ?? 0} 收藏</dd></div><div><dt>数据权限</dt><dd>无项目文件权限</dd></div></dl></div></section>{feedbackOpen && <FeedbackDialog work={work} api={api} demo={demo} go={go} onClose={() => setFeedbackOpen(false)}/>} {reporting && <ReportDialog work={work} api={api} demo={demo} go={go} onClose={() => setReporting(false)}/>}</main>;
}

function FeedbackDialog({ work, api, demo, go, onClose }) {
  const [form, setForm] = useState({ category: 'bug', summary: '', details: '', reproductionSteps: '', environment: '' });
  const [state, setState] = useState('editing'); const [error, setError] = useState('');
  const summaryLength = form.summary.trim().length; const detailsLength = form.details.trim().length;
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); setError(''); };
  const submit = async event => {
    event.preventDefault(); setError('');
    if (summaryLength < 5) { setError(`一句话标题至少需要 5 个字，还差 ${5 - summaryLength} 个。`); return; }
    if (detailsLength < 10) { setError(`详细说明至少需要 10 个字，还差 ${10 - detailsLength} 个。`); return; }
    setState('sending');
    try { if (!demo) await api.createCreatorFeedback(work.id, form); setState('sent'); }
    catch (caught) { if (caught.status === 401) return go('/account'); setError(caught.message || '反馈暂时无法提交。'); setState('editing'); }
  };
  return <div className="modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><form className="report-dialog feedback-dialog" role="dialog" aria-modal="true" aria-label="反馈给作者" onSubmit={submit} noValidate><button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button><span className="kicker">PLAYER FEEDBACK</span>{state === 'sent' ? <><h2>反馈已送达作者</h2><p>作者可以在创作中心查看，并自行决定是否整理为 GitHub Issue。</p><Button type="button" onClick={onClose}>完成</Button></> : <><h2>反馈给《{work.title}》作者</h2><p>这里用于问题、兼容性和玩法建议；违法或安全问题请使用举报。</p><div className="feedback-dialog__grid"><label>反馈类型<select value={form.category} onChange={event => update('category', event.target.value)}><option value="bug">问题</option><option value="idea">玩法建议</option><option value="compatibility">兼容性</option><option value="other">其他</option></select></label><label><span className="feedback-field-heading">一句话标题 <small className={summaryLength < 5 ? 'is-short' : 'is-ready'}>{summaryLength}/160 · 至少 5 个字</small></span><input required maxLength="160" value={form.summary} aria-invalid={summaryLength > 0 && summaryLength < 5} onChange={event => update('summary', event.target.value)} placeholder="例如：第二关重新开始后无法移动"/></label></div><label><span className="feedback-field-heading">详细说明 <small className={detailsLength < 10 ? 'is-short' : 'is-ready'}>{detailsLength}/2000 · 至少 10 个字</small></span><textarea required maxLength="2000" value={form.details} aria-invalid={detailsLength > 0 && detailsLength < 10} onChange={event => update('details', event.target.value)} placeholder="你遇到了什么？原本期待发生什么？"/></label><label>复现步骤（可选）<textarea maxLength="2000" value={form.reproductionSteps} onChange={event => update('reproductionSteps', event.target.value)} placeholder={'1. 打开游戏\n2. 进入第二关\n3. 点击重新开始'}/></label><label>运行环境（可选）<input maxLength="500" value={form.environment} onChange={event => update('environment', event.target.value)} placeholder="例如：Chrome 129 / Windows 11"/></label><small className="feedback-privacy">请不要填写密码、令牌、真实姓名或本地文件路径。你的账号身份不会展示给作者。</small>{error && <p className="form-error feedback-validation" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={state === 'sending'}>{state === 'sending' ? '提交中…' : '发送给作者'}</Button></div></>}</form></div>;
}

function ReportDialog({ work, api, demo, go, onClose }) {
  const [category, setCategory] = useState('unsafe'); const [details, setDetails] = useState(''); const [state, setState] = useState('editing'); const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setState('sending'); setError('');
    try { if (!demo) await api.reportWork(work.id, { category, details }); setState('sent'); }
    catch (caught) { if (caught.status === 401) return go('/account'); setError(caught.message || '举报暂时无法提交。'); setState('editing'); }
  };
  return <div className="modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><form className="report-dialog" role="dialog" aria-modal="true" aria-label="举报作品" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button><span className="kicker">CONTENT REPORT</span>{state === 'sent' ? <><h2>已收到举报</h2><p>管理员会根据作品当前版本和你提供的信息进行判断。</p><Button type="button" onClick={onClose}>完成</Button></> : <><h2>举报《{work.title}》</h2><p>请选择最接近的问题。举报不会自动下架作品。</p><label>问题类型<select value={category} onChange={event => setCategory(event.target.value)}><option value="unsafe">不安全或越权行为</option><option value="malware">恶意代码或欺骗</option><option value="harassment">骚扰或仇恨内容</option><option value="copyright">版权问题</option><option value="other">其他问题</option></select></label><label>补充说明<textarea value={details} maxLength="1000" onChange={event => setDetails(event.target.value)} placeholder="可选：说明发生了什么，以及如何复现。"/></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={state === 'sending'}>{state === 'sending' ? '提交中…' : '提交举报'}</Button></div></>}</form></div>;
}

function PlayerPage({ workId, releaseId, challengeCode, initialRoomId, api, host, hostKind, demo, go }) {
  const mount = useRef(null); const core = useRef(null); const launchDescriptor=useRef(null); const [state, setState] = useState('loading'); const [launchError, setLaunchError] = useState('');
  const [saveStatus,setSaveStatus] = useState(null);
  const [saveController,setSaveController]=useState(null);
  const builtIn = workId === GUESS_BAIKE_WORK_ID;
  useEffect(() => { if (!demo) api.recordPlay(workId).catch(() => {}); }, [api, demo, workId]);
  useEffect(() => {
    if (!hostKind) return undefined;
    const started = Date.now(); emitAnalytics(api, hostKind, { type: 'game_start', route: 'play', workId, ...(releaseId ? { releaseId } : {}) }, demo);
    return () => emitAnalytics(api, hostKind, { type: 'game_end', route: 'play', workId, ...(releaseId ? { releaseId } : {}), durationMs: Math.min(600000, Date.now() - started) }, demo);
  }, [api, hostKind, workId, releaseId, demo]);
  useEffect(() => { setSaveStatus(null); if (builtIn) { setState('running'); return undefined; } core.current = new PlayerCore({ ...playerRuntimeOptions({ host, pageHostname: location.hostname, development: import.meta.env?.DEV === true, defaultRuntimeDomain: import.meta.env?.VITE_RUNTIME_DOMAIN }), createBridge: context => createWebGameHost({ ...context,apiClient: api,workId,initialRoomId,onCloudSaveStatus: setSaveStatus,
    saveCache:host.saveCache,saveOrigin:host.saveOrigin??location.origin,onLocalSaveController:setSaveController,
    getSaveOwner:async()=>{const tokens=await host.account?.getTokens?.();if(tokens){if(!tokens.profile?.id)throw Object.assign(new Error('请重新登录后读取存档。'),{code:'AUTH_REQUIRED'});return 'user:'+tokens.profile.id;}return 'anonymous:'+await host.saveCache.anonymousId();},
    getAccountIdentity: async () => {
    const tokens = await host.account?.getTokens?.();
    return tokens ? JSON.stringify([tokens.profile?.id ?? null, tokens.grantId ?? null]) : null;
  } }) }); const off = core.current.onStateChanged(e => { setState(e.state); if (e.state === 'idle' || e.state === 'disposed') setSaveStatus(null); if (e.message) setLaunchError(e.message); }); let active = true; if (demo) { setState('running'); } else { api.getWork(workId).then(({ data: work }) => { if (!active) return; if (!workHasWebRelease(work)) { go(`/works/${workId}`); return; } return api.getLaunch(workId, releaseId).then(({ data }) => { if (active) { launchDescriptor.current=data; core.current?.mount(mount.current, data); } }); }).catch(caught => { if (active) { setLaunchError(caught.message || '游戏启动失败。'); setState('error'); } }); } return () => { active = false; off(); core.current?.dispose(); }; }, [workId, releaseId, initialRoomId, demo, builtIn, host, api]);
  return <main className={`player-page ${builtIn ? 'player-page--guess' : ''}`}><div className="player-bar"><button className="back-link" onClick={() => go(challengeCode ? '/social' : `/works/${workId}`)}>{icons.back} 退出游戏</button><span className={`live-state live-state--${state}`}><i />{challengeCode ? '玩家挑战进行中' : builtIn ? 'GameHub 官方出品' : state === 'running' ? '正在运行' : state === 'loading' ? '正在载入' : state === 'error' ? '启动失败' : '已隐藏'}</span><CloudSaveStatus status={saveStatus}/><SaveManager controller={saveController} onRestored={()=>{if(launchDescriptor.current)core.current?.mount(mount.current,launchDescriptor.current);}}/><div>{!builtIn && <><button className="icon-button" onClick={() => state === 'hidden' ? core.current?.resume() : core.current?.hide()} aria-label="隐藏或显示游戏（后台仍会运行）">{icons.pause}</button><button className="icon-button" onClick={() => core.current?.stop()} aria-label="停止">{icons.stop}</button></>}</div></div><div className="player-stage" ref={mount}>{builtIn ? <GuessBaikeGame api={api} demo={demo} challengeCode={challengeCode}/> : demo ? <div className="demo-game"><div className="demo-planet"/><span className="kicker">DEMO SESSION</span><h1>星港漂移</h1><p>↑ ↓ ← → 驾驶 · 空格推进</p><div className="demo-track"><i/><i/><i/></div></div> : null}{state === 'error' && <StatePanel title="游戏没有成功启动" body={launchError || '运行地址可能已经失效。返回详情页后再试一次。'} action="返回详情" onAction={() => go(`/works/${workId}`)} />}</div></main>;
}

function AccountPage({ api, host, demo, go, themeMode, setThemeMode, canChangeTheme, hostIdentity, onProfileChange }) {
  const [phase, setPhase] = useState('loading');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [githubChallenge, setGithubChallenge] = useState(null);
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [saved, setSaved] = useState('');
  const [appearance, setAppearance] = useState('agent');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceBusy, setDeviceBusy] = useState('');
  const [persistence, setPersistence] = useState('');
  const avatarInput = useRef(null);

  const commitProfile = next => { setProfile(next); onProfileChange?.(next); };

  useEffect(() => { host.account?.persistence?.().then(value => setPersistence(value.description)).catch(() => {}); }, [host]);
  useEffect(() => {
    let active = true;
    (async () => {
      if (demo) { commitProfile(demoAccountProfile); setDisplayName(demoAccountProfile.displayName); setPhase('settings'); return; }
      try {
        const { data } = await api.getProfile();
        if (active) { commitProfile(data); setDisplayName(data.displayName); setPhase('settings'); }
      } catch (caught) {
        if (active) { setPhase('email'); if (caught.status && caught.status !== 401) setError(caught.message); }
      }
    })();
    return () => { active = false; };
  }, [api, demo]);
  useEffect(() => {
    if (phase !== 'settings') return undefined;
    let active = true;
    const demoDevice = { id: '00000000-0000-4000-8000-000000000099', deviceLabel: 'GameHub Agent', clientKind: hostIdentity.kind || 'harness', authenticatedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), current: true };
    (demo ? Promise.resolve({ data: [demoDevice] }) : api.listDevices()).then(({ data }) => { if (active) setDevices(data); }).catch(caught => { if (active && caught.status !== 401) setError(caught.message || '登录设备暂时无法读取。'); });
    return () => { active = false; };
  }, [api, demo, phase, hostIdentity.kind]);

  const finishLogin = async tokens => {
    await host.account?.setTokens?.(tokens);
    const next = demo ? demoAccountProfile : (await api.getProfile()).data;
    commitProfile(next); setDisplayName(next.displayName); setPhase('settings');
  };
  useEffect(() => {
    if (phase !== 'github-web' || !githubChallenge?.challengeId) return undefined;
    let active = true; let timer;
    const poll = async () => {
      try {
        const result = demo
          ? { status: 'complete', tokens: { accessToken: 'demo-github-web-session' } }
          : (await api.pollGitHubWeb(githubChallenge.challengeId)).data;
        if (!active) return;
        if (result.status === 'complete') {
          await finishLogin(result.tokens);
        } else timer = setTimeout(poll, Math.max(1, result.retryAfter || githubChallenge.intervalSeconds || 2) * 1000);
      } catch (caught) {
        if (active) setError(caught.message || 'GitHub 登录没有完成，请重新尝试。');
      }
    };
    timer = setTimeout(poll, demo ? 900 : Math.max(1, githubChallenge.intervalSeconds || 2) * 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [phase, githubChallenge?.challengeId, demo, api, host]);

  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (phase === 'email') {
        if (demo) { setChallengeId('demo'); setPhase('code'); }
        else { const capabilities = await host.getCapabilities(); const { data } = await api.createChallenge({ email, clientKind: capabilities.host }); setChallengeId(data.challengeId); setPhase('code'); }
      } else {
        if (demo) await finishLogin({ accessToken: 'demo-session' });
        else { const { data } = await api.verifyChallenge({ challengeId, code, deviceLabel: `GameHub · ${hostIdentity.label}` }); await finishLogin(data); }
      }
    } catch (caught) { setError(caught.message || '登录暂时没有完成，请重试。'); }
    finally { setBusy(false); }
  };

  const startGitHub = async () => {
    setBusy(true); setError('');
    const authWindow = demo || host.navigation?.openExternal ? null : globalThis.open?.('about:blank', 'gamehub-github-oauth', 'popup,width=760,height=780');
    try {
      const data = demo
        ? { challengeId: 'demo-github-web', authorizeUrl: null, intervalSeconds: 1 }
        : (await api.startGitHubWeb({ clientKind: (await host.getCapabilities()).host, deviceLabel: `GameHub · ${hostIdentity.label}` })).data;
      setGithubChallenge(data); setPhase('github-web');
      if (data.authorizeUrl && host.navigation?.openExternal) { authWindow?.close(); await host.navigation.openExternal(data.authorizeUrl); }
      else if (authWindow && data.authorizeUrl) { authWindow.location.replace(data.authorizeUrl); authWindow.opener = null; }
    } catch (caught) {
      authWindow?.close();
      setError(caught.message || 'GitHub 网页登录暂时不可用。');
    } finally { setBusy(false); }
  };

  const startGitHubDevice = async () => {
    setBusy(true); setError('');
    try {
      const data = demo
        ? { challengeId: 'demo-github-device', userCode: 'GAME-HUB', verificationUri: 'https://github.com/login/device', intervalSeconds: 5 }
        : (await api.startGitHubDevice({ clientKind: (await host.getCapabilities()).host, deviceLabel: `GameHub · ${hostIdentity.label}` })).data;
      setGithubChallenge(data); setPhase('github-device');
    } catch (caught) { setError(caught.message || 'GitHub 设备登录暂时不可用。'); }
    finally { setBusy(false); }
  };

  const pollGitHubDevice = async () => {
    setBusy(true); setError('');
    try {
      const result = demo ? { status: 'complete', tokens: { accessToken: 'demo-github-device-session' } } : (await api.pollGitHubDevice(githubChallenge.challengeId)).data;
      if (result.status === 'pending') setError('GitHub 还在等待授权。完成后再检查一次。');
      else await finishLogin(result.tokens);
    } catch (caught) { setError(caught.message || '暂时无法确认 GitHub 授权。'); }
    finally { setBusy(false); }
  };

  const saveProfile = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSaved('');
    try {
      const normalized = displayName.trim().replace(/\s+/g, ' ');
      const next = demo ? { ...profile, displayName: normalized } : (await api.updateProfile({ displayName: normalized })).data;
      commitProfile(next); setDisplayName(next.displayName); setSaved('昵称已保存');
    } catch (caught) { setError(caught.message || '昵称暂时无法保存。'); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true); setError('');
    try { if (!demo) await api.logout(); }
    catch (caught) { if (caught.status !== 401) setError(caught.message || '退出请求没有完成。'); }
    finally {
      await host.account?.clearTokens?.(); commitProfile(null); setDisplayName(''); setPhase('email'); setBusy(false);
    }
  };

  const revokeDevice = async grantId => {
    setDeviceBusy(grantId); setError(''); setSaved('');
    try {
      if (!demo) await api.revokeDevice(grantId);
      setDevices(current => current.filter(device => device.id !== grantId)); setSaved('该设备已退出');
    } catch (caught) { setError(caught.message || '暂时无法退出该设备。'); }
    finally { setDeviceBusy(''); }
  };

  const logoutOthers = async () => {
    setDeviceBusy('others'); setError(''); setSaved('');
    try {
      const result = demo ? { data: { revokedCount: Math.max(0, devices.length - 1) } } : await api.logoutOthers();
      setDevices(current => current.filter(device => device.current)); setSaved(result.data.revokedCount ? `已退出 ${result.data.revokedCount} 个其他设备` : '没有其他已登录设备');
    } catch (caught) { setError(caught.message || '暂时无法退出其他设备。'); }
    finally { setDeviceBusy(''); }
  };

  const logoutAll = async () => {
    setDeviceBusy('all'); setError('');
    try { if (!demo) await api.logoutAll(); }
    catch (caught) { if (caught.status !== 401) { setError(caught.message || '退出全部设备没有完成。'); setDeviceBusy(''); return; } }
    await host.account?.clearTokens?.(); setDevices([]); commitProfile(null); setDisplayName(''); setPhase('email'); setDeviceBusy('');
  };

  const chooseAppearance = value => {
    setAppearance(value);
    if (canChangeTheme) setThemeMode(value === 'agent' ? 'system' : value);
  };

  const choosePreset = async presetKey => {
    setAvatarBusy(true); setError(''); setSaved('');
    try {
      const next = demo ? { ...profile, avatar: { kind: 'preset', presetKey, url: null, mediaType: null, animated: false } } : (await api.selectAvatar(presetKey)).data;
      commitProfile(next); setSaved('头像已更新');
    } catch (caught) { setError(caught.message || '头像暂时无法更新。'); }
    finally { setAvatarBusy(false); }
  };

  const randomizeAvatar = () => {
    const candidates = avatarPresets.filter(item => item.key !== profile?.avatar?.presetKey);
    const values = new Uint32Array(1); globalThis.crypto?.getRandomValues?.(values);
    void choosePreset(candidates[(values[0] || Date.now()) % candidates.length].key);
  };

  const uploadAvatar = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)) { setError('请选择 PNG、JPEG、GIF 或 WebP 图片。'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('头像不能超过 2 MB。'); return; }
    setAvatarBusy(true); setError(''); setSaved('');
    try {
      const next = demo ? { ...profile, avatar: { kind: 'upload', presetKey: null, url: null, previewUrl: URL.createObjectURL(file), mediaType: file.type, animated: ['image/gif','image/webp'].includes(file.type) } } : (await api.uploadAvatar(file)).data;
      commitProfile(next); setSaved(next.avatar.animated ? '动态头像已保存' : '头像已保存');
    } catch (caught) { setError(caught.message || '头像上传没有完成。'); }
    finally { setAvatarBusy(false); }
  };

  if (phase === 'loading') return <main className="page narrow-page"><div className="settings-loading"><span className="spinner"/><p>正在读取当前设备上的账号…</p></div></main>;
  if (phase === 'settings' && profile) {
    const linked = new Map((profile.linkedAccounts || []).map(account => [account.provider, account]));
    return <main className="page account-settings-page">
      <button className="back-link" onClick={() => go('/discover')}>{icons.back} 返回发现</button>
      <header className="settings-heading"><div className="profile-avatar"><AvatarView avatar={profile.avatar} api={api} alt="当前头像"/></div><div><span className="kicker">PLAYER PROFILE</span><h1>个人设置</h1><p>管理 GameHub 资料与这台 Agent 中的登录状态。</p>{profile.profileHandle && <Button kind="secondary" onClick={() => go(`/u/${profile.profileHandle}`)}>查看我的公开主页</Button>}</div></header>
      <div className="settings-layout">
        <section className="settings-main">
          <form className="settings-panel" onSubmit={saveProfile}><div className="settings-panel__head"><div><h2>个人资料</h2><p>这个昵称会显示在你的作品与公开页面中。</p></div><span className="pixel-label">PROFILE</span></div><label className="settings-field">昵称<div className="settings-input-row"><input required minLength="1" maxLength="40" value={displayName} onChange={event => { setDisplayName(event.target.value); setSaved(''); }}/><Button type="submit" disabled={busy || !displayName.trim() || displayName.trim() === profile.displayName}>{busy ? '保存中…' : '保存'}</Button></div><small>{Array.from(displayName).length}/40</small></label>{saved && <p className="settings-success" role="status">{icons.check} {saved}</p>}{error && <p className="form-error" role="alert">{error}</p>}</form>
          <section className="settings-panel avatar-settings"><div className="settings-panel__head"><div><h2>头像</h2><p>PNG、JPEG、GIF 或 WebP；最大 2 MB / 1024×1024。动态头像最多 60 帧、15 秒。</p></div><span className="pixel-label">AVATAR</span></div><div className="avatar-preset-grid">{avatarPresets.map(item => <button type="button" key={item.key} className={profile.avatar?.kind === 'preset' && profile.avatar.presetKey === item.key ? 'is-active' : ''} onClick={() => choosePreset(item.key)} disabled={avatarBusy} title={item.label}><AvatarView avatar={{ kind: 'preset', presetKey: item.key }} api={api} alt={item.label}/>{profile.avatar?.kind === 'preset' && profile.avatar.presetKey === item.key && <b>{icons.check}</b>}</button>)}</div><div className="avatar-actions"><Button type="button" kind="secondary" onClick={randomizeAvatar} disabled={avatarBusy}>随机一个</Button><Button type="button" onClick={() => avatarInput.current?.click()} disabled={avatarBusy}>{avatarBusy ? '处理中…' : '上传头像'}</Button><input ref={avatarInput} className="avatar-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={uploadAvatar}/></div>{profile.avatar?.kind === 'upload' && <p className="avatar-upload-state"><AvatarView avatar={profile.avatar} api={api} alt="已上传头像"/><span><strong>自定义头像</strong><small>{profile.avatar.animated ? '动态图片正在播放' : profile.avatar.mediaType}</small></span></p>}</section>
          <section className="settings-panel"><div className="settings-panel__head"><div><h2>界面外观</h2><p>{canChangeTheme ? '网页预览可单独选择；在 Agent 内默认跟随宿主。' : `颜色与 ${hostIdentity.label} 保持一致，减少界面割裂感。`}</p></div><span className="pixel-label">DISPLAY</span></div><div className="appearance-options" role="group" aria-label="界面外观">{[['agent', `跟随 ${hostIdentity.label}`], ['light', '浅色'], ['dark', '深色']].map(([value,label]) => <button type="button" key={value} disabled={!canChangeTheme && value !== 'agent'} className={appearance === value || (value !== 'agent' && appearance !== 'agent' && themeMode === value) ? 'is-active' : ''} onClick={() => chooseAppearance(value)}><i className={`theme-swatch theme-swatch--${value}`}/><span><strong>{label}</strong><small>{value === 'agent' ? '推荐' : '仅当前界面'}</small></span>{(appearance === value) && <b>{icons.check}</b>}</button>)}</div></section>
          <section className="settings-panel"><div className="settings-panel__head"><div><h2>登录方式</h2><p>用于确认账号身份；GameHub 不会在界面中显示密钥。</p></div><span className="pixel-label">SECURITY</span></div><div className="identity-list">{[['github','GitHub'],['email','邮箱验证码']].map(([provider,label]) => { const account = linked.get(provider); return <div className="identity-row" key={provider}><span className={`identity-icon identity-icon--${provider}`}>{provider === 'github' ? <GitHubLogo/> : '@'}</span><div><strong>{label}</strong><small>{account?.label || '尚未绑定'}</small></div><em className={account ? 'is-linked' : ''}>{account ? '已绑定' : '未绑定'}</em></div>; })}</div></section>
          <section className="settings-panel device-settings"><div className="settings-panel__head"><div><h2>已登录设备</h2><p>撤销后，该设备的访问令牌与刷新令牌都会立即失效。</p></div><span className="pixel-label">SESSIONS</span></div><div className="device-list">{devices.map(device => <div className="device-row" key={device.id}><span className="device-mark">{device.clientKind.slice(0,2).toUpperCase()}</span><div><strong>{device.deviceLabel}</strong><small>{device.clientKind} · 最近活动 {new Date(device.lastSeenAt).toLocaleString('zh-CN')} · 登录于 {new Date(device.authenticatedAt).toLocaleDateString('zh-CN')}</small></div>{device.current ? <em>当前设备</em> : <button type="button" disabled={!!deviceBusy} onClick={() => revokeDevice(device.id)}>{deviceBusy === device.id ? '退出中…' : '退出'}</button>}</div>)}</div><div className="device-actions"><Button type="button" kind="secondary" disabled={!!deviceBusy || devices.filter(device => !device.current).length === 0} onClick={logoutOthers}>{deviceBusy === 'others' ? '处理中…' : '退出其他设备'}</Button><button type="button" className="danger-button" disabled={!!deviceBusy} onClick={logoutAll}>{deviceBusy === 'all' ? '处理中…' : '退出全部设备'}</button></div></section>
        </section>
        <aside className="settings-side"><section className="settings-panel account-summary"><span className="kicker">CURRENT SESSION</span><div className="account-summary__avatar"><AvatarView avatar={profile.avatar} api={api} alt=""/></div><h2>{profile.displayName}</h2><p>{profile.canPublish ? '创作者账号' : '玩家账号'} · {profile.role === 'admin' ? '管理员' : '成员'}</p><dl><div><dt>当前宿主</dt><dd>{hostIdentity.label}</dd></div><div><dt>加入时间</dt><dd>{new Date(profile.createdAt).toLocaleDateString('zh-CN')}</dd></div></dl>{persistence && <small>{persistence}</small>}<Button kind="secondary" onClick={logout} disabled={busy}>退出当前设备</Button></section></aside>
      </div>
    </main>;
  }

  const title = phase === 'code' ? '输入验证码' : phase === 'github-web' ? '等待 GitHub 授权' : phase === 'github-device' ? '连接 GitHub' : '登录或创建账号';
  const description = phase === 'code' ? `验证码已发送到 ${email}` : phase === 'github-web' ? '已在浏览器中打开 GitHub；授权后这里会自动完成登录。' : phase === 'github-device' ? '在 GitHub 输入下方的一次性代码。' : '使用 GitHub，或通过邮箱验证码继续。';

  return <main className="page narrow-page"><section className="account-card"><div className="account-art"><Logo /><h1>把你的游戏库<br/>带到每个 Agent。</h1><p>登录后同步作品、发布进度和最近游玩记录。</p></div><form className="account-form" onSubmit={submit}><span className="kicker">GAMEHUB ACCOUNT</span><h2>{title}</h2><p>{description}</p>{phase === 'github-web' ? <><div className="github-device github-web-waiting"><span>SECURE REDIRECT</span><strong>···</strong><small>{demo ? '演示模式正在模拟安全回调。' : '无需复制验证码，请在 GitHub 页面完成授权。'}</small></div>{error && <p className="form-error" role="alert">{error}</p>}{githubChallenge?.authorizeUrl && <a className="button button--primary github-open" href={githubChallenge.authorizeUrl} target="_blank" rel="noopener noreferrer"><span>重新打开 GitHub ↗</span></a>}<button type="button" className="text-button" onClick={startGitHubDevice}>无法跳转？使用设备码</button><button type="button" className="text-button" onClick={() => { setPhase('email'); setGithubChallenge(null); setError(''); }}>返回其他登录方式</button></> : phase === 'github-device' ? <><div className="github-device"><span>ONE-TIME CODE</span><strong>{githubChallenge?.userCode}</strong><small>兼容模式：在 GitHub 输入此代码完成授权。</small></div>{error && <p className="form-error" role="alert">{error}</p>}<a className="button button--primary github-open" href={githubChallenge?.verificationUri} target="_blank" rel="noopener noreferrer"><span>在 GitHub 中继续 ↗</span></a><Button type="button" kind="secondary" disabled={busy} onClick={pollGitHubDevice}>{busy ? '正在检查…' : '我已完成授权'}</Button><button type="button" className="text-button" onClick={() => { setPhase('email'); setGithubChallenge(null); setError(''); }}>返回其他登录方式</button></> : <>{phase === 'email' && <><Button type="button" kind="github" className="github-login" icon={<GitHubLogo />} disabled={busy} onClick={startGitHub}>使用 GitHub 登录</Button><div className="login-divider"><span>或使用邮箱</span></div></>}<label>{phase === 'code' ? '验证码' : '邮箱地址'}<input required disabled={busy} value={phase === 'code' ? code : email} onChange={event => phase === 'code' ? setCode(event.target.value.replace(/\D/g, '').slice(0, 6)) : setEmail(event.target.value)} inputMode={phase === 'code' ? 'numeric' : 'email'} maxLength={phase === 'code' ? 6 : undefined} placeholder={phase === 'code' ? '000000' : 'you@example.com'} /></label>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy || (phase === 'code' && code.length !== 6)}>{busy ? '请稍候…' : phase === 'code' ? '验证并登录' : '发送验证码'}</Button>{phase === 'code' && <button type="button" className="text-button" onClick={() => { setPhase('email'); setCode(''); setError(''); }}>使用其他邮箱</button>}{persistence && <small className="credential-note">{persistence}</small>}</>}</form></section></main>;
}

function CreatorInsights({ state, days, onDays }) {
  const analytics = state.data; const totals = analytics?.totals ?? {}; const daily = analytics?.daily ?? [];
  const maxStarts = Math.max(1, ...daily.map(item => item.starts || 0));
  const cards = [
    ['作品浏览', compactNumber(totals.views), '详情页访问'], ['开始试玩', compactNumber(totals.starts), '实际启动游戏'],
    ['有效试玩率', `${totals.engagementRate || 0}%`, `${compactNumber(totals.engagedSessions)} 次 ≥30 秒`], ['复访玩家', compactNumber(totals.repeatPlayers), '至少二次启动'],
    ['当前收藏', compactNumber(totals.saves), '仍在玩家库中'], ['构建成功率', `${totals.buildSuccessRate || 0}%`, `${compactNumber(totals.successfulBuilds)} / ${compactNumber(totals.builds)}`],
  ];
  return <section className="creator-insights"><div className="creator-insights__head"><div><span className="kicker">CREATOR INSIGHTS</span><h2>作者数据</h2><p>只统计你名下作品的聚合数据，不展示玩家身份或访问内容。</p></div><div className="analytics-range" aria-label="作者数据统计周期">{[7,30,90].map(value => <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => onDays(value)}>{value} 天</button>)}</div></div>{state.status === 'loading' ? <p className="creator-insights__state">正在汇总作品数据…</p> : state.status === 'error' ? <p className="creator-insights__state is-error">作者数据暂时无法读取；作品管理不受影响。</p> : <><div className="creator-insights__kpis">{cards.map(([label,value,note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div><div className="creator-insights__grid"><div className="creator-insights__trend"><div className="creator-insights__subhead"><h3>试玩趋势</h3><span>上海时区</span></div><div className="creator-insights__bars">{daily.map(item => <div key={item.day} title={`${item.day} · ${item.views} 次浏览 · ${item.starts} 次试玩 · ${item.engagedSessions} 次有效试玩`}><i style={{ height: `${Math.max(4, Math.round(item.starts / maxStarts * 100))}%` }}/><small>{item.day.slice(5)}</small></div>)}</div></div><div className="creator-insights__works"><div className="creator-insights__subhead"><h3>作品表现</h3><span>浏览 / 试玩 / 有效 / 复访 / 收藏</span></div>{analytics?.works?.length ? <div className="creator-insights__table">{analytics.works.map(item => <div key={item.workId}><strong>{item.title}</strong><span>{compactNumber(item.views)}</span><span>{compactNumber(item.starts)}</span><span>{compactNumber(item.engagedSessions)}</span><span>{compactNumber(item.repeatPlayers)}</span><span>{compactNumber(item.saves)}</span></div>)}</div> : <p>发布并获得访问后，这里会出现按作品拆分的数据。</p>}</div></div><p className="creator-insights__note">有效试玩指播放器停留至少 30 秒；复访玩家指同一匿名设备在所选周期内至少启动两次。这些指标不代表通关。</p></>}</section>;
}

const feedbackCategoryLabels = { bug: '问题', idea: '玩法建议', compatibility: '兼容性', other: '其他' };
const feedbackStatusLabels = { new: '新反馈', reviewed: '已查看', archived: '已归档', issue_drafted: 'Issue 草稿已生成', issue_linked: '已关联 Issue' };

function CreatorFeedbackInbox({ state, api, demo, onReload }) {
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [linking, setLinking] = useState(''); const [issueUrl, setIssueUrl] = useState('');
  const transition = async (item, action, extra = {}) => {
    setBusy(`${item.id}:${action}`); setMessage('');
    try { if (!demo) await api.updateCreatorFeedback(item.id, { action, ...extra }); setLinking(''); setIssueUrl(''); await onReload(); }
    catch (caught) { setMessage(caught.message || '反馈状态暂时无法更新。'); }
    finally { setBusy(''); }
  };
  const draftIssue = async item => {
    const popup = globalThis.open?.('', '_blank'); if (popup) popup.opener = null; setBusy(`${item.id}:draft`); setMessage('');
    try {
      const draft = demo ? { createUrl: item.repositoryUrl ? `${item.repositoryUrl}/issues/new` : null, markdown: `# [玩家反馈] ${item.summary}\n\n${item.details}` } : (await api.createCreatorFeedbackIssueDraft(item.id)).data;
      if (draft.createUrl) {
        if (popup) popup.location.href = draft.createUrl; else globalThis.open?.(draft.createUrl, '_blank', 'noopener,noreferrer');
        setMessage('已打开 GitHub 预填页。请检查内容并在 GitHub 手动提交；GameHub 不会自动创建 Issue。');
      } else {
        popup?.close?.();
        if (globalThis.navigator?.clipboard?.writeText) await globalThis.navigator.clipboard.writeText(draft.markdown); else globalThis.prompt?.('复制反馈 Markdown', draft.markdown);
        setMessage('作品没有关联 GitHub 仓库，已复制反馈 Markdown。');
      }
      await onReload();
    } catch (caught) { popup?.close?.(); setMessage(caught.message || 'Issue 草稿暂时无法生成。'); }
    finally { setBusy(''); }
  };
  return <section className="creator-feedback"><div className="creator-feedback__head"><div><span className="kicker">PLAYER FEEDBACK</span><h2>玩家反馈</h2><p>反馈只进入你的收件箱。GitHub Issue 必须由你检查并手动提交。</p></div><button type="button" className="text-button" onClick={onReload}>刷新</button></div>{message && <p className="creator-feedback__message" role="status">{message}</p>}{state.status === 'loading' ? <p className="creator-feedback__empty">正在读取反馈…</p> : state.status === 'error' ? <p className="creator-feedback__empty is-error">反馈收件箱暂时无法读取，作品管理不受影响。</p> : !state.items.length ? <p className="creator-feedback__empty">还没有玩家反馈。作品详情页已提供“反馈给作者”入口。</p> : <div className="creator-feedback__list">{state.items.map(item => <article className={`creator-feedback__item is-${item.status}`} key={item.id}><header><div><span>{item.workTitle}</span><h3>{item.summary}</h3></div><div className="creator-feedback__badges"><em>{feedbackCategoryLabels[item.category]}</em><strong>{feedbackStatusLabels[item.status]}</strong></div></header><p>{item.details}</p>{item.reproductionSteps && <details><summary>复现步骤</summary><p>{item.reproductionSteps}</p></details>}{item.environment && <small>运行环境：{item.environment}</small>}{item.issueUrl && <a href={item.issueUrl} target="_blank" rel="noopener noreferrer">查看关联的 GitHub Issue ↗</a>}<footer><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><div>{item.status === 'archived' ? <button type="button" disabled={!!busy} onClick={() => transition(item, 'reopen')}>重新打开</button> : <><button type="button" disabled={!!busy} onClick={() => draftIssue(item)}>{busy === `${item.id}:draft` ? '生成中…' : '生成 GitHub Issue 草稿'}</button>{item.status === 'new' && <button type="button" disabled={!!busy} onClick={() => transition(item, 'review')}>标记已查看</button>}<button type="button" disabled={!!busy} onClick={() => transition(item, 'archive')}>归档</button>{item.repositoryUrl && item.status !== 'issue_linked' && <button type="button" disabled={!!busy} onClick={() => { setLinking(item.id); setIssueUrl(''); }}>关联已提交 Issue</button>}</>}</div></footer>{linking === item.id && <form className="creator-feedback__link" onSubmit={event => { event.preventDefault(); transition(item, 'link_issue', { issueUrl }); }}><label>该仓库的 GitHub Issue 地址<input required type="url" value={issueUrl} onChange={event => setIssueUrl(event.target.value)} placeholder={`${item.repositoryUrl}/issues/1`}/></label><Button type="submit" disabled={!!busy}>保存关联</Button><Button type="button" kind="secondary" onClick={() => setLinking('')}>取消</Button></form>}</article>)}</div>}</section>;
}

function ContributionTaskStarter({ feedback, api, demo, onCreated }) {
  const [selected, setSelected] = useState(null);
  const [existing, setExisting] = useState(new Set());
  useEffect(() => { let live = true; (demo ? Promise.resolve({ data: [] }) : api.listCreatorContributionTasks()).then(({ data }) => { if (live) setExisting(new Set(data.map(item => item.feedbackId).filter(Boolean))); }).catch(() => {}); return () => { live = false; }; }, [api, demo]);
  const eligible = feedback.status === 'ready' ? feedback.items.filter(item => ['reviewed','issue_drafted','issue_linked'].includes(item.status) && !existing.has(item.id)) : [];
  if (!eligible.length) return null;
  return <section className="contribution-starter"><div><span className="kicker">TURN FEEDBACK INTO ACTION</span><h2>从反馈创建共建任务</h2><p>只会创建私有草稿。补充完成标准后，再由你明确公开给玩家领取。</p></div><div className="contribution-starter__items">{eligible.map(item => <article key={item.id}><span>{item.workTitle}</span><strong>{item.summary}</strong><button type="button" onClick={() => setSelected(item)}>创建任务草稿</button>{selected?.id === item.id && <CreateContributionTaskForm item={item} api={api} demo={demo} onCancel={() => setSelected(null)} onCreated={async () => { setExisting(current => new Set([...current, item.id])); setSelected(null); await onCreated(); }}/>}</article>)}</div></section>;
}

function CreatorPage({ api, demo, go }) {
  const [state, setState] = useState({ status: 'loading', works: [] });
  const [insights, setInsights] = useState({ status: 'loading', days: 30, data: null });
  const [feedback, setFeedback] = useState({ status: 'loading', items: [] });
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [copiedWorkId, setCopiedWorkId] = useState('');
  const [access, setAccess] = useState(null);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try {
      const listedWorks = demo ? demoWorks.slice(0, 2) : (await api.listCreatorWorks()).data;
      const works = demo ? listedWorks : await Promise.all(listedWorks.map(async work => {
        try { const source = (await api.getWorkSource(work.id)).data; return { ...work, sourceProvider: source.provider }; }
        catch { return work; }
      }));
      setAccess(null); setState({ status: 'ready', works });
    } catch (error) {
      if (error.status === 401) return setState({ status: 'auth', works: [] });
      if (error.status === 403) {
        try {
          const result = (await api.getCreatorApplication()).data;
          setAccess(result); setState({ status: 'forbidden', works: [] });
        } catch (caught) { setState({ status: caught.status === 401 ? 'auth' : 'error', works: [] }); }
        return;
      }
      setState({ status: 'error', works: [] });
    }
  };
  useEffect(() => { load(); }, [demo]);
  const loadFeedback = async () => {
    setFeedback(current => ({ ...current, status: 'loading' }));
    const demoItems = [{ id: 'demo-feedback', workId: demoWorks[0].id, workTitle: demoWorks[0].title, category: 'idea', summary: '希望增加一局结束后的得分分享', details: '完成一局之后如果能生成一张成绩卡，会更方便分享给朋友。', reproductionSteps: '', environment: 'Chrome / Windows', status: 'new', issueUrl: null, repositoryUrl: 'https://github.com/example/game', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    try { setFeedback({ status: 'ready', items: demo ? demoItems : (await api.listCreatorFeedback()).data }); }
    catch (caught) { setFeedback({ status: caught.status === 401 || caught.status === 403 ? 'unavailable' : 'error', items: [] }); }
  };
  useEffect(() => { loadFeedback(); }, [api, demo]);
  useEffect(() => {
    let active = true; setInsights(current => ({ ...current, status: 'loading' }));
    const demoData = { totals: { views: 864, starts: 327, engagedSessions: 188, engagementRate: 57, repeatPlayers: 46, saves: 73, builds: 8, successfulBuilds: 7, buildSuccessRate: 88 }, daily: Array.from({ length: insights.days }, (_, index) => ({ day: new Date(Date.now() - (insights.days-index-1)*86400000).toLocaleDateString('en-CA'), views: 18+index%7*3, starts: 7+index%5*2, engagedSessions: 3+index%4 })), works: demoWorks.slice(0,2).map((work,index) => ({ workId: work.id,title: work.title,state: work.state,views: 500-index*220,starts: 190-index*80,engagedSessions: 110-index*45,repeatPlayers: 28-index*10,saves: 45-index*17,builds: 4,successfulBuilds: index ? 3 : 4 })) };
    (demo ? Promise.resolve({ data: demoData }) : api.getCreatorAnalytics(insights.days)).then(({ data }) => { if (active) setInsights(current => ({ ...current, status: 'ready', data })); }).catch(() => { if (active) setInsights(current => ({ ...current, status: 'error', data: null })); });
    return () => { active = false; };
  }, [api, demo, insights.days]);
  const apply = async event => {
    event.preventDefault(); setBusy(true); setApplicationError('');
    try { const result = (await api.applyForCreator(statement)).data; setAccess(result); setStatement(''); }
    catch (caught) { setApplicationError(caught.message || '申请暂时无法提交。'); }
    finally { setBusy(false); }
  };
  if (state.status === 'loading') return <main className="page"><LoadingCards /></main>;
  if (state.status === 'auth') return <main className="page"><StatePanel title="登录后管理作品" body="作者操作需要当前设备中的 GameHub 账号授权。" action="前往登录" onAction={() => go('/account')} /></main>;
  if (state.status === 'forbidden') {
    const application = access?.application;
    if (application?.status === 'pending') return <main className="page"><StatePanel title="创作者申请审核中" body="管理员审核通过后，当前设备会自动获得创作与发布权限。" action="重新检查" onAction={load} /></main>;
    return <main className="page narrow-page"><form className="panel new-work-form" onSubmit={apply}><span className="kicker">CREATOR ACCESS</span><h1>{application?.status === 'rejected' ? '重新申请创作者权限' : '申请成为创作者'}</h1><p>{application?.status === 'rejected' ? `上次申请未通过：${application.reviewNote || '管理员未填写原因'}` : '说明你准备创作的内容。管理员审核通过后即可创建、上传并发布作品。'}</p><label>申请说明<textarea required minLength="20" maxLength="1000" value={statement} onChange={event => setStatement(event.target.value)} placeholder="例如：我计划制作可在浏览器运行的独立小游戏，并遵守平台内容规范。"/></label>{applicationError && <p className="form-error" role="alert">{applicationError}</p>}<Button type="submit" disabled={busy || statement.trim().length < 20}>{busy ? '正在提交…' : '提交申请'}</Button></form></main>;
  }
  if (state.status === 'error') return <main className="page"><StatePanel title="暂时无法载入创作中心" body="API 或数据库可能还没有准备好。" action="重新连接" onAction={load} /></main>;
  const published = state.works.filter(work => work.state === 'published').length;
  const withdrawn = state.works.filter(work => work.state === 'withdrawn').length;
  const replaceWork = next => setState(current => ({ ...current, works: current.works.map(work => work.id === next.id ? { ...work, ...next, targets: next.targets?.length ? next.targets : work.targets } : work) }));
  const copyBadge = async work => {
    const markdown = `[![在 GameHub 在线体验](${PUBLIC_GAMEHUB_URL}/v1/works/${work.id}/badge.svg)](${PUBLIC_GAMEHUB_URL}/#/works/${work.id})`;
    try { if (!globalThis.navigator?.clipboard?.writeText) throw new Error('clipboard unavailable'); await globalThis.navigator.clipboard.writeText(markdown); setCopiedWorkId(work.id); globalThis.setTimeout?.(() => setCopiedWorkId(current => current === work.id ? '' : current), 1800); }
    catch { globalThis.prompt?.('复制 README 徽章', markdown); }
  };
  return <main className="page creator-page"><div className="section-heading"><div><span className="kicker">CREATOR STUDIO</span><h1>我的作品</h1><p>管理当前版本、历史记录与公开状态。</p></div><div className="creator-heading-actions"><Button kind="secondary" onClick={() => go('/creator/import')}>从 GitHub 导入</Button><Button icon="＋" onClick={() => go('/creator/works/new')}>新建作品</Button></div></div><button className="multiplayer-creator-gateway" onClick={() => go('/creator/multiplayer')}><span>⇄</span><div><strong>开发者中心 / 联网游戏</strong><small>官方模板、接入向导、双人测试、Creator Doctor 与规则审核流程</small></div><em>开始接入 →</em></button><div className="creator-summary"><div><span>全部作品</span><strong>{state.works.length}</strong></div><div><span>已发布</span><strong>{published}</strong></div><div><span>已撤下</span><strong>{withdrawn}</strong></div></div><CreatorInsights state={insights} days={insights.days} onDays={days => setInsights(current => ({ ...current, days }))}/><CreatorFeedbackInbox state={feedback} api={api} demo={demo} onReload={loadFeedback}/><ContributionTaskStarter feedback={feedback} api={api} demo={demo} onCreated={async () => { setTaskRefresh(value => value + 1); await loadFeedback(); }}/><CreatorContributionTasks api={api} demo={demo} refreshToken={taskRefresh}/>{state.works.length ? <section className="creator-list">{state.works.map(work => <CreatorRow work={work} api={api} demo={demo} go={go} onChanged={replaceWork} onCopyBadge={copyBadge} copied={copiedWorkId === work.id} key={work.id}/>)}</section> : <StatePanel title="还没有作品" body="新建作品后即可上传第一个 Web ZIP。" action="新建作品" onAction={() => go('/creator/works/new')} />}<aside className="creator-tip"><span>{icons.spark}</span><div><strong>发布小贴士</strong><p>撤下会立即阻止新的公开访问；历史版本仍保留，上传并通过检查的新版本可以重新发布。</p></div></aside></main>;
}

const githubVisibilityLabels = { public: '公开仓库', private: '私有仓库', internal: '内部仓库' };
const githubAccountTypeLabels = { User: '个人账号', Organization: '组织账号' };
const githubConnectionStatusLabels = { active: '已连接', suspended: '已暂停', revoked: '已断开' };
const githubLicenseLabels = { missing: '未检测到许可证', unknown: '许可证无法识别', conflict: '许可证存在冲突' };
const githubLicenseGuidance = {
  missing: { title: '仓库尚未声明开源许可', body: '如果你是仓库权利人，请在默认分支根目录添加 LICENSE 或 LICENSE.md，并使用 GitHub 可识别的标准许可证模板。' },
  unknown: { title: '许可证文件暂时无法识别', body: '请检查许可证文本是否完整；建议使用 GitHub 的标准许可证模板，并将自定义说明移到 README。' },
  conflict: { title: '仓库包含冲突的许可证信息', body: '请先明确代码与素材分别适用的许可证，并整理仓库中的许可证文件；平台不会替作者判断冲突。' }
};
const githubStaticSignalLabels = {
  indexHtml: '已找到 index.html',
  packageJson: '检测到 package.json',
  vite: '检测到 Vite 配置',
  three: 'Three.js',
  babylon: 'Babylon.js',
  unityWebgl: 'Unity WebGL'
};

function GitHubImportPage({ api, demo, go }) {
  const [state, setState] = useState({ status: 'loading', connections: [], repositories: [], preview: null });
  const [selectedConnection, setSelectedConnection] = useState('');
  const [selectedRepository, setSelectedRepository] = useState('');
  const [form, setForm] = useState({ title: '', description: '', kind: 'game' });
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const loadConnections = async () => {
    setError('');
    try {
      if (demo) return setState({ status: 'ready', connections: [], repositories: [], preview: null });
      const connections = (await api.listGitHubSourceConnections()).data;
      setState(current => ({ ...current, status: 'ready', connections }));
      if (connections.length && !selectedConnection) setSelectedConnection(connections.find(item => item.status === 'active')?.id ?? connections[0].id);
    } catch (caught) { setState(current => ({ ...current, status: caught.status === 401 ? 'auth' : caught.code === 'GITHUB_SOURCE_IMPORT_DISABLED' ? 'disabled' : 'error' })); setError(caught.message || 'GitHub 连接暂时无法读取。'); }
  };
  useEffect(() => {
    const normal = new URLSearchParams(globalThis.location?.search || '');
    const hashQuery = new URLSearchParams((globalThis.location?.hash || '').split('?')[1] || '');
    const installationId = normal.get('installation_id') || hashQuery.get('installation_id');
    const stateToken = normal.get('state') || hashQuery.get('state') || globalThis.sessionStorage?.getItem('gamehub.github-app-state');
    if (!installationId || !stateToken || demo) { loadConnections(); return; }
    setBusy('complete');
    api.completeGitHubSourceInstall({ state: stateToken, installationId }).then(() => {
      globalThis.sessionStorage?.removeItem('gamehub.github-app-state');
      globalThis.history?.replaceState(null, '', `${globalThis.location.pathname}#/creator/import`);
      return loadConnections();
    }).catch(caught => {
      setState(current => ({ ...current, status: caught.status === 401 ? 'auth' : 'error' }));
      setError(caught.status === 401 ? '登录会话已失效，请重新登录后继续完成 GitHub 连接。' : caught.message || 'GitHub 安装回调未完成。');
    }).finally(() => setBusy(''));
  }, [api, demo]);
  useEffect(() => {
    if (!selectedConnection || demo) return;
    setBusy('repositories'); setError(''); setSelectedRepository('');
    api.listGitHubSourceRepositories(selectedConnection).then(({ data }) => setState(current => ({ ...current, repositories: data, preview: null }))).catch(caught => setError(caught.message || '仓库列表读取失败。')).finally(() => setBusy(''));
  }, [api, demo, selectedConnection]);
  const install = async () => {
    setBusy('install'); setError('');
    try {
      const result = (await api.startGitHubSourceInstall()).data;
      const stateToken = new URL(result.installUrl).searchParams.get('state');
      if (stateToken) globalThis.sessionStorage?.setItem('gamehub.github-app-state', stateToken);
      globalThis.location.assign(result.installUrl);
    } catch (caught) { setError(caught.message || 'GitHub App 安装未启动。'); setBusy(''); }
  };
  const preview = async () => {
    if (!selectedConnection || !selectedRepository) return;
    setBusy('preview'); setError('');
    try {
      const result = (await api.previewGitHubSourceImport({ connectionId: selectedConnection, repositoryId: selectedRepository })).data;
      setState(current => ({ ...current, preview: result }));
      setForm({ title: result.repository.name || '', description: result.repository.description || '', kind: 'game' });
    } catch (caught) { setError(caught.message || '仓库预览失败。'); }
    finally { setBusy(''); }
  };
  const createDraft = async event => {
    event.preventDefault(); if (!state.preview) return;
    if (state.preview.workId) return go(`/creator/works/${state.preview.workId}/builds`);
    setBusy('draft'); setError('');
    try { const result = (await api.createGitHubImportedDraft({ importId: state.preview.importId, ...form })).data; go(`/creator/works/${result.work.id}/builds`); }
    catch (caught) { setError(caught.message || '草稿创建失败。'); }
    finally { setBusy(''); }
  };
  const disconnect = async connection => {
    if (!globalThis.confirm?.(`断开 ${connection.accountLogin} 的 GitHub 连接？已创建的草稿会保留来源记录。`)) return;
    setBusy(`disconnect-${connection.id}`); setError('');
    try { await api.disconnectGitHubSourceConnection(connection.id); setSelectedConnection(''); await loadConnections(); }
    catch (caught) { setError(caught.message || '连接未能断开。'); }
    finally { setBusy(''); }
  };
  if (state.status === 'loading' || busy === 'complete') return <main className="page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page"><StatePanel title="登录后连接 GitHub" body="导入仓库需要当前创作者账号授权。" action="前往登录" onAction={() => go('/account')}/></main>;
  if (state.status === 'disabled') return <main className="page"><StatePanel title="GitHub 导入尚未开放" body="管理员还没有配置独立的只读 GitHub App；你仍可手动新建作品并上传 ZIP。" action="新建作品" onAction={() => go('/creator/works/new')}/></main>;
  const staticSignals = state.preview ? Object.entries(state.preview.staticSignals).filter(([, value]) => value).map(([key]) => ({ key, label: githubStaticSignalLabels[key] || key })) : [];
  const licenseStatus = state.preview?.license.status;
  const licenseLabel = state.preview?.license.spdx || githubLicenseLabels[licenseStatus] || '许可证待确认';
  const licenseGuidance = githubLicenseGuidance[licenseStatus];
  const repositoryUrl = state.preview ? `https://github.com/${encodeURIComponent(state.preview.repository.owner)}/${encodeURIComponent(state.preview.repository.name)}` : '';
  return <main className="page github-import-page"><button className="back-link" onClick={() => go('/creator')}>{icons.back} 我的作品</button><div className="section-heading"><div><span className="kicker">READ-ONLY SOURCE IMPORT</span><h1>从 GitHub 建立作品草稿</h1><p>只读取你授权仓库的元数据、README、许可证和固定提交信息，不执行仓库代码。</p></div><Button kind="github" icon={<GitHubLogo/>} onClick={install} disabled={!!busy}>{busy === 'install' ? '正在跳转…' : '连接 GitHub App'}</Button></div>
    <aside className="github-import-notice"><strong>导入不会自动执行或发布仓库代码</strong><p>确认来源后只创建私有草稿。下一步可为纯静态 HTML 仓库发起受控构建；构建器不联网、不安装依赖，产物仍需经过平台校验。私有仓库地址不会出现在公开作品资料中。</p></aside>
    {error && <p className="form-error" role="alert">{error}</p>}
    {state.connections.length > 0 && <section className="panel github-import-step github-connections"><div className="github-step-heading"><span className="github-step-number">01</span><div><h2>选择连接</h2><p>仓库授权可以在 GitHub 中随时收回。</p></div></div><div className="github-connection-list">{state.connections.map(connection => <article className={selectedConnection === connection.id ? 'is-active' : ''} key={connection.id}><button type="button" onClick={() => setSelectedConnection(connection.id)} disabled={connection.status !== 'active'}><span className="github-connection-mark"><GitHubLogo/></span><span className="github-connection-copy"><strong>{connection.accountLogin}</strong><small>{githubAccountTypeLabels[connection.accountType] || connection.accountType} · {connection.repositorySelection === 'all' ? '全部仓库' : '选定仓库'}</small></span><span className={`github-status is-${connection.status}`}>{githubConnectionStatusLabels[connection.status] || connection.status}</span></button><button type="button" className="text-button" disabled={!!busy} onClick={() => disconnect(connection)}>断开</button></article>)}</div></section>}
    {selectedConnection && <section className="panel github-import-step github-repositories"><div className="github-step-heading"><span className="github-step-number">02</span><div><h2>选择仓库</h2><p>最多同步 5 页，单次显示不超过 500 个已授权仓库。</p></div></div>{busy === 'repositories' ? <p className="github-step-empty">正在同步授权仓库…</p> : state.repositories.length ? <div className="github-repository-picker"><label><span>授权仓库</span><select value={selectedRepository} onChange={event => setSelectedRepository(event.target.value)}><option value="">请选择一个仓库</option>{state.repositories.map(repo => <option value={repo.repositoryId} key={repo.id}>{repo.owner}/{repo.name} · {githubVisibilityLabels[repo.visibility] || repo.visibility}</option>)}</select></label><Button type="button" onClick={preview} disabled={!selectedRepository || !!busy}>{busy === 'preview' ? '正在读取…' : '只读预览'}</Button></div> : <p className="github-step-empty">当前安装没有可读取的仓库。请在 GitHub App 设置中授权至少一个仓库。</p>}</section>}
    {state.preview && <form className="panel github-import-step github-preview" onSubmit={createDraft}><div className="github-step-heading github-preview-heading"><span className="github-step-number">03</span><div><h2>{state.preview.workId ? '继续已有草稿' : '确认来源并建稿'}</h2><p className="github-repository-name">{state.preview.repository.owner}/{state.preview.repository.name}</p></div><div className="github-preview-badges">{state.preview.workId && <span className="github-existing-badge">已有草稿</span>}<span className="github-visibility">{githubVisibilityLabels[state.preview.repository.visibility] || state.preview.repository.visibility}</span><span className={`github-license is-${state.preview.license.status}`}>{licenseLabel}</span></div></div><dl className="github-preview-facts"><div><dt>固定提交</dt><dd><code title={state.preview.commitSha}>{state.preview.commitSha}</code></dd></div><div><dt>默认分支</dt><dd>{state.preview.repository.defaultBranch}</dd></div><div><dt>静态入口检测</dt><dd className="github-signal-list">{staticSignals.length ? staticSignals.map(signal => <span className={signal.key === 'indexHtml' ? 'is-ready' : ''} key={signal.key}>{signal.label}</span>) : <span className="is-warning">未识别到常见 Web 入口</span>}</dd></div></dl>{licenseGuidance && <aside className={`github-license-warning is-${licenseStatus}`}><div><strong>{licenseGuidance.title}</strong><span>{licenseGuidance.body}</span></div><ol><li>确认你有权为这个仓库选择或修改许可证。</li><li>在默认分支根目录提交许可证文件。</li><li>回到本页点击“重新检测”。</li></ol><div className="github-license-help-actions"><a className="button button--secondary" href={repositoryUrl} target="_blank" rel="noopener noreferrer">打开 GitHub 仓库 ↗</a><Button type="button" onClick={preview} disabled={!!busy}>{busy === 'preview' ? '正在检测…' : '重新检测'}</Button></div><small>不是仓库权利人？请联系原作者补充许可证，或选择已有明确许可证的项目。当前仍可创建私有草稿和构建，但不能公开发布。</small></aside>}{state.preview.readmeExcerpt && <details className="github-readme"><summary>查看净化后的 README 摘要</summary><pre>{state.preview.readmeExcerpt}</pre></details>}{state.preview.workId ? <div className="github-existing-draft"><div><span className="github-existing-draft__mark">↻</span><div><strong>这个固定提交已经创建过草稿</strong><p>继续进入原草稿，即可查看之前的构建记录并重新发起构建，不会重复创建作品。</p></div></div><Button type="button" onClick={() => go(`/creator/works/${state.preview.workId}/builds`)}>继续已有草稿</Button></div> : <><div className="github-draft-fields"><label><span>作品名称</span><input required maxLength="120" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))}/></label><label><span>作品类型</span><select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value }))}><option value="game">游戏</option><option value="creative">互动作品</option><option value="tool">创意工具</option></select></label><label className="github-draft-description"><span>一句话介绍</span><textarea maxLength="4000" placeholder="简单说明作品的玩法或用途，之后仍可修改。" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))}/></label></div><div className="github-preview-actions"><div><strong>下一步：受控构建</strong><small>先创建仅你可见的草稿，不会立即发布。</small></div><Button type="submit" disabled={!!busy}>{busy === 'draft' ? '正在创建…' : '创建私有草稿并继续'}</Button></div></>}</form>}
   </main>;
 }

const sourceBuildLabels = { queued:'排队中',preparing:'准备源码',building:'隔离构建',packaging:'封装产物',validating:'安全校验',ready:'可发布',failed:'失败',superseded:'已被新提交替代' };
const sourceBuildErrorLabels = {
  SOURCE_ARCHIVE_LAYOUT_INVALID:'GitHub 源码包目录结构无法识别',
  SOURCE_ARCHIVE_PATH_INVALID:'源码包包含不安全的路径',
  SOURCE_ARCHIVE_UNSUPPORTED:'源码包包含不支持的特殊文件',
  SOURCE_BUILD_LIMIT_EXCEEDED:'源码文件数量或体积超过限制',
  SOURCE_ARCHIVE_TOO_LARGE:'源码包体积超过限制',
  BUILD_PLAN_MISMATCH:'该仓库需要依赖安装或构建工具',
  BUILD_OUTPUT_TYPE_UNSUPPORTED:'静态目录包含不支持的文件类型',
  BUILD_OUTPUT_PATH_CONFLICT:'静态目录包含重名或大小写冲突文件',
  ENTRY_MISSING:'所选目录中没有根 index.html',
  GITHUB_SOURCE_ACCESS_LOST:'GitHub 仓库授权已经失效',
};
function SourceBuildPage({ workId, api, demo, go }) {
  const [source,setSource]=useState(null); const [builds,setBuilds]=useState([]); const [releaseLabel,setReleaseLabel]=useState('1.0.0'); const [subdirectory,setSubdirectory]=useState(''); const [busy,setBusy]=useState(''); const [error,setError]=useState('');
  const load=async()=>{ setError(''); try { if(demo){ setSource({ owner:'demo',name:'static-game',commitSha:'a'.repeat(40),status:'active' }); return; } const [sourceResult,buildResult]=await Promise.all([api.getWorkSource(workId),api.listSourceBuilds(workId)]); setSource(sourceResult.data); setBuilds(buildResult.data); } catch(caught){ setError(caught.message||'源码构建信息暂时无法读取。'); } };
  useEffect(()=>{ load(); },[workId]);
  useEffect(()=>{ if(demo||!builds.some(item=>['queued','preparing','building','packaging','validating'].includes(item.state)))return undefined; const timer=setInterval(()=>load(),1600); return()=>clearInterval(timer); },[demo,builds.map(item=>`${item.id}:${item.state}`).join('|')]);
  const create=async event=>{ event.preventDefault(); setBusy('create'); setError(''); try { const item=demo?{ id:'demo-build',state:'ready',releaseLabel,commitSha:source.commitSha,createdAt:new Date().toISOString() }:(await api.createSourceBuild(workId,{ templateKey:'static-v1',templateVersion:'1',subdirectory,releaseLabel })).data; setBuilds(current=>[item,...current.filter(build=>build.id!==item.id)]); } catch(caught){ setError(caught.message||'受控构建未能启动。'); } finally{ setBusy(''); } };
  const publish=async build=>{ setBusy(build.id); setError(''); try { await api.publishSourceBuild(workId,build.id); go('/creator'); } catch(caught){ setError(caught.message||'版本暂时无法发布。'); } finally{ setBusy(''); } };
  return <main className="page source-build-page"><button className="back-link" onClick={()=>go('/creator')}>{icons.back} 我的作品</button><div className="source-build-heading"><div><span className="kicker">CONTROLLED SOURCE BUILD</span><h1>从 GitHub 构建 Web 版本</h1><p>固定到已导入的 commit，在断网、非 root 环境中提取纯静态文件；不会运行 package.json、脚本或自定义命令，也不会安装依赖。</p></div><span className="source-build-policy">STATIC-V1</span></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="source-build-layout"><form className="panel source-build-card" onSubmit={create}><div className="source-build-card__heading"><span className="github-step-number">01</span><div><small>已锁定源码</small><h2>{source?`${source.owner}/${source.name}`:'正在读取来源…'}</h2></div><span className="source-build-access">只读</span></div>{source&&<dl className="source-build-facts"><div><dt>固定提交</dt><dd><code title={source.commitSha}>{source.commitSha}</code></dd></div><div><dt>构建方式</dt><dd>纯静态复制</dd></div><div><dt>安全边界</dt><dd>断网 · 非 root</dd></div></dl>}<div className="source-build-fields"><label><span>版本名称</span><input required value={releaseLabel} maxLength="64" placeholder="例如 1.0.0" onChange={event=>setReleaseLabel(event.target.value)}/><small>用于区分本次生成的 Web 版本。</small></label><label><span>静态站点目录 <em>可选</em></span><input value={subdirectory} maxLength="255" placeholder="根目录可留空；或填写 dist / web" onChange={event=>setSubdirectory(event.target.value)}/><small>填写的目录中必须直接包含 index.html。</small></label></div><aside className="source-build-note"><strong>构建器会做什么</strong><p>只收集浏览器可运行的静态资源，再交给平台 ZIP 校验器。检测到 package.json、构建脚本或不支持的文件时会停止。</p></aside><div className="source-build-actions"><div><strong>下一步：隔离构建与安全校验</strong><small>失败不会影响当前已发布版本。</small></div><Button type="submit" disabled={!source||!releaseLabel||!!busy}>{busy==='create'?'正在排队…':'开始受控构建'}</Button></div><button type="button" className="source-build-manual" onClick={()=>go(`/creator/works/${workId}/upload`)}>当前仓库不适用？改为手动上传 ZIP →</button></form><aside className="panel source-build-history"><div className="source-build-history__heading"><span className="kicker">BUILD HISTORY</span><h2>构建记录</h2><p>状态会自动刷新，无需重复提交。</p></div>{builds.length?<ol>{builds.map(build=>{ const failed=build.state==='failed'; const current=['queued','preparing','building','packaging','validating'].includes(build.state); return <li className={`${build.state==='ready'?'is-done':''}${failed?' is-failed':''}${current?' is-current':''}`} key={build.id}><span>{build.state==='ready'?icons.check:failed?'!':'·'}</span><div><strong>{build.releaseLabel}</strong><em>{sourceBuildLabels[build.state]||build.state}</em><small><code>{build.commitSha?.slice(0,8)}</code>{build.errorCode&&<><b>{sourceBuildErrorLabels[build.errorCode]||'构建未完成'}</b><code>{build.errorCode}</code></>}</small>{build.state==='ready'&&<Button type="button" disabled={!!busy} onClick={()=>publish(build)}>{busy===build.id?'正在发布…':'发布此版本'}</Button>}</div></li>;})}</ol>:<div className="source-build-empty"><span>01</span><strong>等待首次构建</strong><p>提交后会依次显示源码准备、隔离构建、安全校验和发布状态。</p></div>}</aside></div></main>;
}

function NewWorkPage({ api, demo, go }) {
  const [form, setForm] = useState({ title: '', description: '', instructions: '', kind: 'game', estimatedMinutes: '3', tags: '', agentLabel: '', repositoryUrl: '', licenseSpdx: '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const tags = [...new Set(form.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
      if (tags.length > 6 || tags.some(tag => tag.length > 20)) throw new Error('最多填写 6 个标签，每个不超过 20 个字。');
      if ((form.repositoryUrl && !form.licenseSpdx) || (!form.repositoryUrl && form.licenseSpdx)) throw new Error('开源地址和许可证需要同时填写。');
      const payload = { ...form, estimatedMinutes: Number(form.estimatedMinutes), tags, agentLabel: form.agentLabel || null, repositoryUrl: form.repositoryUrl || null, licenseSpdx: form.licenseSpdx || null };
      const work = demo ? { id: demoWorks[0].id } : (await api.createWork(payload)).data; go(`/creator/works/${work.id}/upload`);
    }
    catch (caught) { setError(caught.message || '作品暂时无法创建。'); }
    finally { setBusy(false); }
  };
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  return <main className="page narrow-page"><button className="back-link" onClick={() => go('/creator')}>{icons.back} 我的作品</button><form className="panel new-work-form" onSubmit={submit}><span className="kicker">NEW PROJECT</span><h1>新建作品</h1><p>先建立作品资料，再上传可运行的 Web ZIP。资料会用于社区发现与自动分栏。</p><label>作品名称<input required name="title" maxLength="120" value={form.title} onChange={update} placeholder="例如：星港漂移" /></label><div className="form-grid"><label>作品类型<select name="kind" value={form.kind} onChange={update}><option value="game">游戏</option><option value="creative">互动作品</option><option value="tool">创意工具</option></select></label><label>单局时长<select name="estimatedMinutes" value={form.estimatedMinutes} onChange={update}><option value="1">约 1 分钟</option><option value="3">约 3 分钟</option><option value="5">约 5 分钟</option><option value="10">约 10 分钟</option><option value="15">约 15 分钟</option></select></label></div><label>一句话介绍<textarea required name="description" maxLength="4000" value={form.description} onChange={update} placeholder="告诉玩家这是什么，以及为什么值得打开。" /></label><label>玩法说明<textarea name="instructions" maxLength="4000" value={form.instructions} onChange={update} placeholder="方向键移动，空格互动……" /></label><label>发现标签<input name="tags" value={form.tags} onChange={update} placeholder="解谜，静音友好，像素（最多 6 个）" /></label><label>使用的 Coding Agent<select name="agentLabel" value={form.agentLabel} onChange={update}><option value="">不展示</option><option value="Codex">Codex</option><option value="Cursor">Cursor</option><option value="Claude Code">Claude Code</option><option value="GitHub Copilot">GitHub Copilot</option><option value="其他">其他</option></select></label><fieldset className="open-source-fields"><legend>开源项目（可选）</legend><label>GitHub 仓库<input type="url" name="repositoryUrl" value={form.repositoryUrl} onChange={update} pattern="https://github\.com/[^/\s]+/[^/\s]+/?" placeholder="https://github.com/you/project" /></label><label>开源许可证<input name="licenseSpdx" maxLength="40" value={form.licenseSpdx} onChange={update} placeholder="MIT / Apache-2.0" /></label><small>两项需同时填写。平台只展示链接，不会读取或执行仓库内容。</small></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? '正在创建…' : '创建并上传版本'}</Button></form></main>;
}

function CreatorRow({ work, api, demo, go, onChanged, onCopyBadge, copied }) {
  const [history, setHistory] = useState({ open: false, loading: false, items: [], error: '' });
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);
  const status = work.state === 'published' ? '已发布' : work.state === 'withdrawn' ? '已撤下' : work.state === 'suspended' ? '已暂停' : '草稿';
  const toggleHistory = async () => {
    if (history.open) return setHistory(current => ({ ...current, open: false }));
    setHistory(current => ({ ...current, open: true, loading: !current.items.length, error: '' }));
    if (history.items.length) return;
    try {
      const items = demo ? [{ id: 'demo-release', targetKey: 'web', label: '1.0.0', packageType: 'web_zip', validationState: 'ready', servingState: work.state === 'published' ? 'enabled' : 'disabled', createdAt: new Date().toISOString() }] : (await api.listWorkReleases(work.id)).data;
      setHistory({ open: true, loading: false, items, error: '' });
    } catch (error) { setHistory({ open: true, loading: false, items: [], error: error.message || '版本历史暂时无法读取。' }); }
  };
  const withdraw = async () => {
    if (!globalThis.confirm?.(`撤下《${work.title}》？撤下后玩家将不能再打开当前版本。`)) return;
    setWithdrawing(true); setActionError('');
    try {
      const next = demo ? { ...work, state: 'withdrawn', visibility: 'private', revision: String(Number(work.revision) + 1) } : (await api.withdrawWork(work.id, work.revision)).data;
      onChanged(next);
      setHistory(current => ({ ...current, items: current.items.map(item => ({ ...item, servingState: 'disabled' })) }));
    } catch (error) {
      setActionError(error.message || '作品暂时无法撤下，请刷新后重试。');
    } finally { setWithdrawing(false); }
  };
  const uploadCover = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return setActionError('请选择不超过 5 MB 的 PNG、JPEG 或静态 WebP。');
    setCoverBusy(true); setActionError('');
    const preview = URL.createObjectURL(file); setCoverPreview(preview);
    try { if (!demo) onChanged((await api.uploadWorkCover(work.id, file)).data); }
    catch (error) { URL.revokeObjectURL(preview); setCoverPreview(''); setActionError(error.message || '封面上传失败。'); }
    finally { setCoverBusy(false); }
  };
  return <div className="creator-entry"><article><Art work={{ ...work, coverUrl: coverPreview || work.coverUrl }}/><div className="creator-row__main"><h3>{work.title}</h3><p>Web · 修订 {work.revision}{work.sourceProvider === 'github' ? ' · GitHub 导入' : ''}</p></div><span className={`status-pill ${status === '已发布' ? 'is-success' : ''} ${status === '已撤下' ? 'is-muted' : ''}`}>{status}</span><div className="creator-row-actions"><label className="cover-upload"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={coverBusy} onChange={uploadCover}/>{coverBusy ? '处理中…' : work.coverUrl ? '更换封面' : '上传封面'}</label><button className="text-button" onClick={toggleHistory}>{history.open ? '收起历史' : '版本历史'}</button>{work.state === 'published' && <button className="text-button badge-copy" type="button" onClick={() => onCopyBadge(work)}>{copied ? '徽章已复制 ✓' : '复制 README 徽章'}</button>}{work.sourceProvider === 'github' && <Button kind="secondary" onClick={() => go(`/creator/works/${work.id}/builds`)}>继续构建</Button>}<Button kind="secondary" onClick={() => go(`/creator/works/${work.id}/upload`)}>上传新版</Button>{work.state === 'published' && <button className="danger-button" disabled={withdrawing} onClick={withdraw}>{withdrawing ? '正在撤下…' : '撤下'}</button>}</div></article>{actionError && <p className="creator-action-error form-error" role="alert">{actionError}</p>}{history.open && <section className="release-history" aria-live="polite">{history.loading ? <p>正在读取版本…</p> : history.error ? <p className="form-error">{history.error}</p> : history.items.length ? <ol>{history.items.map(item => <li key={item.id}><div><strong>{item.label}</strong><small>{item.targetKey} · {item.packageType === 'web_zip' ? 'Web ZIP' : item.packageType}</small></div><span className={item.servingState === 'enabled' ? 'release-live' : ''}>{item.servingState === 'enabled' ? '当前公开' : item.validationState === 'ready' ? '已停用' : '处理中'}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p>还没有通过检查的版本。</p>}</section>}</div>;
}

function DemoUploadPage({ workId, go }) {
  const [file, setFile] = useState(null); const [upload, setUpload] = useState(demoUploads[0]); const [progress, setProgress] = useState(100);
  const current = upload.state === 'succeeded' ? 6 : Math.max(0, uploadSteps.findIndex(([id]) => id === upload.state));
  const choose = e => { const next = e.target.files[0]; if (next) { setFile(next); setUpload({ ...upload, state: 'created', fileName: next.name, declaredBytes: String(next.size), actualBytes: null }); setProgress(0); } };
  const start = () => { setUpload(u => ({ ...u, state: 'receiving' })); let value = 0; const timer = setInterval(() => { value += 10; setProgress(value); if (value >= 100) { clearInterval(timer); setUpload(u => ({ ...u, state: 'validating', actualBytes: u.declaredBytes })); } }, 90); };
  return <main className="page upload-page"><div className="upload-heading"><button className="back-link" onClick={() => go('/creator')}>{icons.back} 我的作品</button><span className="kicker">NEW RELEASE</span><h1>上传 Web 版本</h1><p>文件传完后还会经历结构校验与发布。你可以离开本页，任务会继续。</p></div><div className="upload-layout"><section className="panel upload-form"><label className="file-drop"><input type="file" accept=".zip,application/zip" onChange={choose}/><span className="file-icon">{icons.file}</span><strong>{file?.name ?? upload.fileName ?? '选择 Web ZIP'}</strong><small>{file ? `${(file.size / 1048576).toFixed(1)} MB` : 'ZIP · 最大 200 MB'}</small><em>{file ? '重新选择' : '浏览文件'}</em></label><div className="form-grid"><label>版本名称<input defaultValue="1.4.0"/></label><label>目标平台<select defaultValue="web"><option value="web">Web · 侧栏游玩</option></select></label></div><label className="check-row"><input type="checkbox" defaultChecked/><span><strong>校验通过后自动发布</strong><small>若检查失败，当前线上版本保持不变。</small></span></label>{upload.state === 'created' && <Button icon={icons.upload} onClick={start}>开始上传</Button>}{upload.state === 'receiving' && <div className="byte-progress"><div><span>正在上传</span><strong>{progress}%</strong></div><progress value={progress} max="100"/><button>取消</button></div>}{processingStates.has(upload.state) && <div className="processing-note"><span className="spinner"/><div><strong>文件已安全收到</strong><p>现在进行结构校验。收到 100% 字节不等于已经发布。</p></div></div>}</section><aside className="panel timeline"><span className="kicker">RELEASE STATUS</span><h2>处理进度</h2><ol>{uploadSteps.slice(0,7).map(([id,label], i) => <li className={i < current ? 'is-done' : i === current ? 'is-current' : ''} key={id}><span>{i < current ? icons.check : i + 1}</span><div><strong>{label}</strong>{i === current && <small>{processingStates.has(upload.state) ? '通常不到一分钟' : '当前阶段'}</small>}</div></li>)}</ol></aside></div></main>;
}

const sha256 = async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');

function LiveUploadPage({ workId, api, go }) {
  const [file, setFile] = useState(null); const [upload, setUpload] = useState(null); const [progress, setProgress] = useState(0); const [phase, setPhase] = useState('select'); const [error, setError] = useState(''); const [releaseLabel, setReleaseLabel] = useState('1.0.0'); const [targetKey, setTargetKey] = useState('web'); const controller = useRef(null);
  const terminal = new Set(['succeeded', 'failed', 'expired', 'review_required']);
  const watch = async (uploadId, signal) => {
    while (!signal.aborted) {
      const { data } = await api.getUpload(uploadId, { signal }); setUpload(data);
      if (terminal.has(data.state)) { sessionStorage.removeItem(`gamehub-upload:${workId}`); setPhase(data.state === 'succeeded' ? 'done' : 'error'); if (data.state !== 'succeeded') setError(uploadErrorMessage(data.errorCode)); return; }
      await new Promise(resolve => setTimeout(resolve, 1400));
    }
  };
  useEffect(() => {
    const uploadId = sessionStorage.getItem(`gamehub-upload:${workId}`); if (!uploadId) return undefined;
    controller.current = new AbortController(); const signal = controller.current.signal;
    (async () => {
      const { data } = await api.getUpload(uploadId, { signal }); setUpload(data);
      if (['created', 'receiving'].includes(data.state)) { setPhase('select'); return; }
      if (data.state === 'uploaded') { setPhase('processing'); await api.completeUpload(uploadId, { signal }); await watch(uploadId, signal); return; }
      if (terminal.has(data.state)) { sessionStorage.removeItem(`gamehub-upload:${workId}`); setPhase(data.state === 'succeeded' ? 'done' : 'error'); if (data.state !== 'succeeded') setError(uploadErrorMessage(data.errorCode)); return; }
      setPhase('processing'); await watch(uploadId, signal);
    })().catch(caught => { if (caught.code !== 'UPLOAD_CANCELLED') { setError(caught.message); setPhase('error'); } });
    return () => controller.current?.abort();
  }, [workId]);
  const choose = event => { const next = event.target.files?.[0] ?? null; setFile(next); setProgress(0); setError(''); setUpload(current => current && ['created', 'receiving'].includes(current.state) ? current : null); setPhase('select'); };
  const start = async () => {
    if (!file || phase !== 'select') return;
    controller.current = new AbortController(); const signal = controller.current.signal; setError('');
    try {
      setPhase('hashing');
      const digest = await sha256(file);
      let created = upload;
      if (!created || !['created', 'receiving'].includes(created.state)) {
        ({ data: created } = await api.createUpload(workId, { fileName: file.name, declaredBytes: String(file.size), sha256: digest, releaseLabel, autoPublish: true, targetKey, packageType: targetKey === 'web' ? 'web_zip' : 'windows_standalone_exe' }, { signal }));
        setUpload(created); sessionStorage.setItem(`gamehub-upload:${workId}`, created.id);
      }
      const { data: grant } = await api.createUploadGrant(created.id, { signal });
      setPhase('receiving');
      const { data: received } = await api.uploadContent(created.id, file, grant.token, { signal, onProgress: event => setProgress(event.percent) }); setUpload(received);
      setPhase('processing');
      const { data: queued } = await api.completeUpload(created.id, { signal }); setUpload(queued);
      await watch(created.id, signal);
    } catch (caught) { if (!signal.aborted || caught.code === 'UPLOAD_CANCELLED') { setError(caught.message || '上传未完成。'); setPhase('error'); } }
  };
  const state = upload?.state ?? (phase === 'receiving' ? 'receiving' : 'created');
  const current = state === 'succeeded' ? 6 : Math.max(0, uploadSteps.findIndex(([id]) => id === state));
  const displayedBytes = upload?.actualBytes ?? file?.size ?? upload?.declaredBytes;
  return <main className="page upload-page"><div className="upload-heading"><button className="back-link" onClick={() => go('/creator')}>{icons.back} 我的作品</button><span className="kicker">NEW RELEASE</span><h1>上传 {targetKey === 'web' ? 'Web' : 'Windows'} 版本</h1><p>{targetKey === 'web' ? '上传网页导出 ZIP。单 HTML 作品可自动识别入口；多页面作品请在根目录提供 index.html。' : '上传单文件 Windows x64 或 x86 图形界面 EXE；校验后提供下载运行。'}</p></div><div className="upload-layout"><section className="panel upload-form"><label className="file-drop"><input type="file" accept={targetKey === 'web' ? '.zip,application/zip' : '.exe,application/vnd.microsoft.portable-executable,application/octet-stream'} disabled={!['select','error'].includes(phase)} onChange={choose}/><span className="file-icon">{icons.file}</span><strong>{file?.name ?? upload?.fileName ?? '选择 Web ZIP'}</strong><small>{displayedBytes !== undefined && displayedBytes !== null ? formatBytes(displayedBytes) : targetKey === 'web' ? 'ZIP · 最大 100 MB' : 'EXE · 最大 500 MB'}</small><em>{file ? '重新选择' : '浏览文件'}</em></label><div className="form-grid"><label>版本名称<input value={releaseLabel} disabled={phase !== 'select'} onChange={event => setReleaseLabel(event.target.value.slice(0,64))}/></label><label>目标平台<select value={targetKey} disabled={phase !== 'select'} onChange={event => { setTargetKey(event.target.value); setFile(null); setUpload(null); setProgress(0); setError(''); }}><option value="web">Web · 侧栏游玩</option><option value="windows-x64">Windows x64 / x86 · 独立窗口</option></select></label></div><label className="check-row"><input type="checkbox" defaultChecked disabled/><span><strong>校验通过后自动发布</strong><small>失败时保留当前线上版本。</small></span></label>{phase === 'select' && <Button icon={icons.upload} disabled={!file || !releaseLabel} onClick={start}>开始上传</Button>}{phase === 'hashing' && <div className="processing-note"><span className="spinner"/><div><strong>正在计算文件摘要</strong><p>摘要用于确认服务端收到的字节完全一致。</p></div></div>}{phase === 'receiving' && <div className="byte-progress"><div><span>正在上传</span><strong>{progress}%</strong></div><progress value={progress} max="100"/><button onClick={() => controller.current?.abort()}>取消本机传输</button></div>}{['processing','done'].includes(phase) && <div className="processing-note"><span className={phase === 'done' ? 'success-mark' : 'spinner'}>{phase === 'done' ? icons.check : ''}</span><div><strong>{phase === 'done' ? '检查完成' : '文件已安全收到'}</strong><p>{phase === 'done' ? (upload?.publicationOutcome === 'published' ? '新版本已经发布。' : '版本已通过检查并保留为草稿。') : '正在进行结构校验；100% 字节不代表已发布。'}</p></div></div>}{error && <div className="form-error" role="alert">{error}<button onClick={() => setPhase('select')}>重新选择</button></div>}</section><aside className="panel timeline"><span className="kicker">RELEASE STATUS</span><h2>处理进度</h2><ol>{uploadSteps.slice(0,7).map(([id,label], index) => <li className={index < current ? 'is-done' : index === current ? 'is-current' : ''} key={id}><span>{index < current ? icons.check : index + 1}</span><div><strong>{label}</strong>{index === current && <small>{phase === 'error' ? '需要处理' : '当前阶段'}</small>}</div></li>)}</ol></aside></div></main>;
}

function UploadPage(props) { return props.demo ? <DemoUploadPage {...props}/> : <LiveUploadPage {...props}/>; }

function LibraryPage({ api, go, demo }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => { let live = true; (async () => { try { const data = demo ? demoWorks.slice(0,2).map((work,index) => ({ work, savedAt: index ? null : new Date().toISOString(), lastPlayedAt: new Date().toISOString(), playCount: 1 })) : (await api.listLibrary()).data; if (live) setState({ status: 'ready', items: data }); } catch (caught) { if (live) setState({ status: caught.status === 401 ? 'auth' : 'error', items: [] }); } })(); return () => { live = false; }; }, [api,demo]);
  const saved = state.items.filter(item => item.savedAt); const recent = state.items.filter(item => item.lastPlayedAt);
  return <main className="page library-page"><div className="section-heading"><div><span className="kicker">YOUR SPACE</span><h1>游戏库</h1><p>收藏和最近游玩会在登录的 Agent 之间同步。</p></div></div>{state.status === 'loading' ? <LoadingCards/> : state.status === 'auth' ? <StatePanel title="登录后同步游戏库" body="收藏与游玩记录会跟随你的 GameHub 账号。" action="前往登录" onAction={() => go('/account')}/> : state.status === 'error' ? <StatePanel title="暂时无法读取游戏库" body="连接恢复后再试一次，你的已有记录不会丢失。"/> : !state.items.length ? <StatePanel title="游戏库还是空的" body="收藏作品或开始一局，它们就会出现在这里。" action="去发现" onAction={() => go('/discover')}/> : <>{!!saved.length && <section className="library-section"><h2>已收藏</h2><div className="work-grid">{saved.map(item => <WorkCard key={item.workId} work={item.work} go={go}/>)}</div></section>}{!!recent.length && <section className="library-section"><h2>最近游玩</h2><div className="quiet-work-list">{recent.map(item => <QuietWorkRow key={item.workId} work={item.work} go={go}/>)}</div></section>}</>}</main>;
}

const profileLinkKinds = { github: 'GitHub', website: '网站', portfolio: '作品集', bilibili: '哔哩哔哩', other: '其他' };
const collaborationLabels = { not_looking: '暂不寻找合作', open_to_collaboration: '愿意交流合作', available_for_hire: '可接受项目邀约' };
const profileDraft = profile => ({
  handle: profile.handle, headline: profile.headline, about: profile.about, visibility: profile.visibility,
  libraryVisibility: profile.libraryVisibility, collaborationStatus: profile.collaborationStatus ?? 'not_looking', skills: profile.skills ?? [], skillsText: (profile.skills ?? []).join('，'),
  activityVisibility: profile.activityVisibility ?? 'private', achievementsVisibility: profile.achievementsVisibility ?? 'followers',
  links: profile.links.map(link => ({ ...link })), featuredWorkIds: profile.featuredWorks.map(work => work.id), githubRepositoryIds: profile.githubRepositories.map(repository => repository.id),
});
const demoPublicProfile = handle => ({
  id: 'demo-user', handle: handle || 'miyazaki1', displayName: 'Miyazaki1', headline: '独立游戏创作者，喜欢把小想法做成可以马上玩的作品。',
  about: '我在 GameHub 上制作适合工作间隙体验的轻量游戏。关注玩法原型、像素视觉和 Agent 协作开发。\n\n这里展示的是我主动公开的资料与作品；私人游戏库和未发布项目不会出现在主页。',
  visibility: 'public', libraryVisibility: 'public', libraryVisible: true, collaborationStatus: 'open_to_collaboration', skills: ['独立游戏','像素美术','JavaScript','玩法原型'],
  activityVisibility: 'public', activityVisible: true, achievementsVisibility: 'public', achievementsVisible: true, creator: true, role: 'user', joinedAt: '2026-09-28T00:00:00.000Z', avatar: demoAccountProfile.avatar,
  followerCount: 12, followingCount: 5, isFollowing: false, isMe: true,
  links: [{ kind: 'github', label: 'GitHub', url: 'https://github.com/gamehub-labs' }, { kind: 'portfolio', label: '个人作品集', url: 'https://example.com/' }],
  githubRepositories: [{ id: 'demo-repo-1', owner: 'gamehub-labs', name: 'pixel-break', url: 'https://github.com/gamehub-labs/pixel-break' }],
  contributions: [{ taskId: 'demo-task', title: '补充移动端触控提示', workId: demoWorks[1].id, workTitle: demoWorks[1].title, repositoryUrl: 'https://github.com/gamehub-labs/pixel-break', issueUrl: 'https://github.com/gamehub-labs/pixel-break/issues/12', submissionUrl: 'https://github.com/gamehub-labs/pixel-break/pull/18', completedAt: '2026-10-01T10:00:00.000Z' }],
  activity: [{ type: 'work_published', occurredAt: '2026-10-01T08:00:00.000Z', title: '发布了《宇宙巡航机》', workId: demoWorks[1].id }, { type: 'guess_baike_completed', occurredAt: '2026-09-30T08:00:00.000Z', title: '完成猜百科 · 2026-09-30', workId: null }],
  achievements: { totalDays: 12, longestStreak: 7, completedChallenges: 4, challengeWins: 2, bestDailyRank: 1, latestDailyRank: 3, latestRankDate: '2026-09-30', badges: [{ key: 'first_break', name: '初次休息', description: '完成第一局猜百科' }, { key: 'streak_7', name: '七日像素', description: '连续参与 7 天' }] },
  featuredWorks: demoWorks.slice(1, 3), works: demoWorks.slice(1, 4), library: demoWorks.slice(0, 2),
});

function PixelAchievementIcon({ kind = 'badge' }) {
  const paths = {
    calendar: 'M3 1h2v2h6V1h2v2h2v12H1V3h2V1zm0 6v6h10V7H3zm2 2h2v2H5V9zm4 0h2v2H9V9z',
    flame: 'M8 1h2v3h2v2h2v6h-2v2H4v-2H2V8h2V5h2V3h2V1zm0 6H6v2H5v3h6V9H9V7H8z',
    trophy: 'M3 2h10v2h2v5h-3v2h-2v2h3v2H3v-2h3v-2H4V9H1V4h2V2zm0 4H2v1h2V6H3zm10 0h-1v1h2V6h-1z',
    crown: 'M1 4h2v2h2V2h2v4h2V3h2v3h2V4h2v8H1V4zm2 5v2h10V9H3zm2 4h6v2H5v-2z',
    spark: 'M7 1h2v4h4v2h2v2h-2v2H9v4H7v-4H3V9H1V7h2V5h4V1z',
    badge: 'M6 1h4v2h3v3h2v4h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3V1zm1 4v2H5v2h2v2h2V9h2V7H9V5H7z',
  };
  return <span className={`pixel-achievement-icon pixel-achievement-icon--${kind}`} aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d={paths[kind] || paths.badge}/></svg></span>;
}

const achievementBadgeIcon = key => key?.includes('streak') ? 'flame' : key === 'duel_winner' ? 'trophy' : key === 'challenger' ? 'spark' : 'badge';

function PublicProfilePage({ handle, api, demo, go, onProfileChange }) {
  const [state, setState] = useState({ status: 'loading', profile: null });
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(null);
  const [githubRepositoryOptions, setGitHubRepositoryOptions] = useState([]); const [githubOptionsLoading, setGitHubOptionsLoading] = useState(false);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' })); setError('');
    try {
      const profile = demo ? demoPublicProfile(handle) : (await api.getPublicUserProfile(handle)).data;
      setState({ status: 'ready', profile });
      setDraft(profileDraft(profile));
    } catch (caught) { setState({ status: caught.status === 404 ? 'missing' : 'error', profile: null }); }
  };
  useEffect(() => { load(); }, [handle, api, demo]);
  useEffect(() => { globalThis.scrollTo?.({ top: 0, behavior: 'smooth' }); }, [editing]);
  useEffect(() => {
    if (!editing || !state.profile?.creator) return;
    if (demo) { setGitHubRepositoryOptions([{ id: 'demo-repo-1', owner: 'gamehub-labs', name: 'pixel-break', htmlUrl: 'https://github.com/gamehub-labs/pixel-break', visibility: 'public' }]); return; }
    let live = true; setGitHubOptionsLoading(true);
    (async () => {
      try {
        const connections = (await api.listGitHubSourceConnections()).data.filter(connection => connection.status === 'active');
        const groups = await Promise.all(connections.map(connection => api.listGitHubSourceRepositories(connection.id).then(result => result.data)));
        if (live) setGitHubRepositoryOptions(groups.flat().filter(repository => repository.visibility === 'public' && repository.accessState === 'active'));
      } catch { if (live) setGitHubRepositoryOptions([]); }
      finally { if (live) setGitHubOptionsLoading(false); }
    })();
    return () => { live = false; };
  }, [editing, state.profile?.creator, api, demo]);
  const save = async event => {
    event?.preventDefault?.(); setBusy('save'); setError(''); setNotice('');
    try {
      const { skillsText: _skillsText, ...payload } = draft;
      const profile = demo ? { ...state.profile, ...payload, links: draft.links, featuredWorks: state.profile.works.filter(work => draft.featuredWorkIds.includes(work.id)) } : (await api.updatePublicUserProfile(payload)).data;
      setState({ status: 'ready', profile }); setDraft(profileDraft(profile));
      onProfileChange?.(current => current ? { ...current, profileHandle: profile.handle } : current);
      setEditing(false); setNotice('个人主页已保存。'); if (profile.handle !== handle) go(`/u/${profile.handle}`);
    } catch (caught) { setError(caught.message || '个人主页没有保存。'); }
    finally { setBusy(''); }
  };
  const follow = async () => {
    const profile = state.profile; setBusy('follow'); setError('');
    try {
      if (!demo) await (profile.isFollowing ? api.unfollowUser(profile.id) : api.followUser(profile.id));
      setState(current => ({ ...current, profile: { ...current.profile, isFollowing: !profile.isFollowing, followerCount: Math.max(0, profile.followerCount + (profile.isFollowing ? -1 : 1)) } }));
    } catch (caught) { if (caught.status === 401) go('/account'); else setError(caught.message || '关注状态没有更新。'); }
    finally { setBusy(''); }
  };
  const share = async () => {
    const url = `${location.origin}${location.pathname}#/u/${state.profile.handle}`;
    try { await navigator.clipboard.writeText(url); setNotice('主页链接已复制。'); } catch { globalThis.prompt?.('复制个人主页链接', url); }
  };
  const updateLink = (index, key, value) => setDraft(current => ({ ...current, links: current.links.map((link, at) => at === index ? { ...link, [key]: value } : link) }));
  const toggleFeatured = workId => setDraft(current => ({ ...current, featuredWorkIds: current.featuredWorkIds.includes(workId) ? current.featuredWorkIds.filter(id => id !== workId) : current.featuredWorkIds.length < 6 ? [...current.featuredWorkIds, workId] : current.featuredWorkIds }));
  const toggleGitHubRepository = repositoryId => setDraft(current => ({ ...current, githubRepositoryIds: current.githubRepositoryIds.includes(repositoryId) ? current.githubRepositoryIds.filter(id => id !== repositoryId) : current.githubRepositoryIds.length < 6 ? [...current.githubRepositoryIds, repositoryId] : current.githubRepositoryIds }));
  if (state.status === 'loading') return <main className="page public-profile-page"><LoadingCards/></main>;
  if (state.status === 'missing') return <main className="page"><StatePanel title="找不到这个个人主页" body="主页可能设为私密、地址已更改，或用户不存在。" action="返回发现" onAction={() => go('/discover')}/></main>;
  if (state.status === 'error') return <main className="page"><StatePanel title="个人主页暂时无法加载" body="连接恢复后再试一次。" action="重新加载" onAction={load}/></main>;
  const profile = state.profile; const featuredIds = new Set(profile.featuredWorks.map(work => work.id)); const remaining = profile.works.filter(work => !featuredIds.has(work.id));
  return <main className={`page public-profile-page ${editing ? 'is-editing' : 'is-viewing'}`}>
    <button className="back-link" onClick={() => go('/discover')}>{icons.back} 返回发现</button>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="social-notice" role="status">{notice}</p>}
    {editing && <section className="profile-settings-header"><div><span className="kicker">PROFILE STUDIO</span><h1>个人主页设置</h1><p>编辑你的公开身份、作品入口与展示边界。保存后再返回主页查看最终效果。</p></div><div><span className="profile-settings-handle">@{profile.handle}</span><Button kind="secondary" onClick={() => setEditing(false)}>返回个人主页</Button></div></section>}
    <section className="public-profile-hero panel"><div className="public-profile-avatar"><AvatarView avatar={profile.avatar} api={api} alt={`${profile.displayName} 的头像`}/></div><div className="public-profile-copy"><span className="kicker">{profile.creator ? 'CREATOR PROFILE' : 'PLAYER PROFILE'}</span><h1>{profile.displayName}</h1><p className="public-profile-handle">@{profile.handle}</p><p className="public-profile-headline">{profile.headline || '这位玩家还没有填写一句介绍。'}</p><div className={`collaboration-badge collaboration-badge--${profile.collaborationStatus}`}>{collaborationLabels[profile.collaborationStatus]}</div>{!!profile.skills.length && <div className="profile-skill-list">{profile.skills.map(skill => <span key={skill}>{skill}</span>)}</div>}<div className="public-profile-meta"><span>{profile.followerCount} 关注者</span><span>正在关注 {profile.followingCount}</span><span>{profile.works.length} 个公开作品</span></div><div className="public-profile-links">{profile.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"><b>{profileLinkKinds[link.kind]}</b>{link.label} ↗</a>)}</div></div><div className="public-profile-actions">{profile.isMe ? <Button onClick={() => setEditing(true)}>编辑主页</Button> : <Button disabled={busy === 'follow'} onClick={follow}>{profile.isFollowing ? '已关注' : '+ 关注'}</Button>}<Button kind="secondary" onClick={share}>分享主页</Button></div></section>
    {editing && draft && <form className="public-profile-editor panel" onSubmit={save}><div className="settings-panel__head"><div><span className="kicker">PUBLIC IDENTITY</span><h2>编辑公开主页</h2><p>只填写希望公开的信息。私人仓库和草稿永远不会展示；游戏库由你单独控制。</p></div><span className="pixel-label">@{draft.handle}</span></div><div className="form-grid"><label>主页地址<input required pattern="[a-z][a-z0-9-]{2,31}" maxLength="32" value={draft.handle} onChange={event => setDraft(current => ({ ...current, handle: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}/><small>mooyu.fun/#/u/{draft.handle || 'your-name'}</small></label><label>主页可见范围<select value={draft.visibility} onChange={event => setDraft(current => ({ ...current, visibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>游戏库可见范围<select value={draft.libraryVisibility} onChange={event => setDraft(current => ({ ...current, libraryVisibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><small>只展示你主动收藏且仍公开可用的作品。</small></label></div><label>一句介绍<textarea maxLength="160" value={draft.headline} onChange={event => setDraft(current => ({ ...current, headline: event.target.value }))}/><small>{Array.from(draft.headline).length}/160</small></label><label>关于我<textarea className="profile-about-input" maxLength="2000" value={draft.about} onChange={event => setDraft(current => ({ ...current, about: event.target.value }))} placeholder="介绍你的方向、经历、擅长领域与正在探索的事情。"/><small>{Array.from(draft.about).length}/2000</small></label><fieldset><legend>外部链接（最多 5 个）</legend>{draft.links.map((link,index) => <div className="profile-link-editor" key={index}><select value={link.kind} onChange={event => updateLink(index, 'kind', event.target.value)}>{Object.entries(profileLinkKinds).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><input aria-label="链接名称" maxLength="40" value={link.label} onChange={event => updateLink(index, 'label', event.target.value)} placeholder="显示名称"/><input aria-label="链接地址" type="url" pattern="https://.*" value={link.url} onChange={event => updateLink(index, 'url', event.target.value)} placeholder="https://"/><button type="button" onClick={() => setDraft(current => ({ ...current, links: current.links.filter((_,at) => at !== index) }))}>移除</button></div>)}{draft.links.length < 5 && <button className="add-profile-link" type="button" onClick={() => setDraft(current => ({ ...current, links: [...current.links, { kind: 'website', label: '', url: 'https://' }] }))}>＋ 添加链接</button>}</fieldset>{profile.works.length > 0 && <fieldset><legend>精选作品（最多 6 个）</legend><div className="featured-work-picker">{profile.works.map(work => <label key={work.id}><input type="checkbox" checked={draft.featuredWorkIds.includes(work.id)} disabled={!draft.featuredWorkIds.includes(work.id) && draft.featuredWorkIds.length >= 6} onChange={() => toggleFeatured(work.id)}/><span><strong>{work.title}</strong><small>{work.kind === 'game' ? '游戏' : '作品'} · {work.playCount} 次游玩</small></span></label>)}</div></fieldset>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={() => setEditing(false)}>取消</Button><Button type="submit" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存公开主页'}</Button></div></form>}
    {editing && draft && <section className="public-profile-editor panel"><div className="settings-panel__head"><div><span className="kicker">PROFILE DETAILS</span><h2>协作、技能与动态</h2><p>动态和成就分别控制可见范围；草稿、私有仓库和登录信息不会成为动态。</p></div><span className="pixel-label">PHASE 2</span></div><div className="form-grid"><label>协作状态<select value={draft.collaborationStatus} onChange={event => setDraft(current => ({ ...current, collaborationStatus: event.target.value }))}>{Object.entries(collaborationLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>公开活动<select value={draft.activityVisibility} onChange={event => setDraft(current => ({ ...current, activityVisibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>成就与排行<select value={draft.achievementsVisibility} onChange={event => setDraft(current => ({ ...current, achievementsVisibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label>技能标签（最多 12 个，以逗号分隔）<input value={draft.skillsText} onChange={event => { const skillsText = event.target.value; setDraft(current => ({ ...current, skillsText, skills: skillsText.split(/[，,]/).map(value => value.trim()).filter(Boolean).slice(0,12) })); }} placeholder="例如：玩法设计、像素美术、TypeScript"/><small>{draft.skills.length}/12；单个标签最多 30 个字符。</small></label><div className="dialog-actions"><Button type="button" disabled={busy === 'save'} onClick={() => save()}>{busy === 'save' ? '保存中…' : '保存二期资料'}</Button></div></section>}
    {editing && profile.creator && <section className="public-profile-editor panel"><div className="settings-panel__head"><div><span className="kicker">VERIFIED GITHUB</span><h2>展示公开仓库</h2><p>只列出你通过 GitHub App 授权、且仓库自身为公开状态的项目；私有仓库永远不会出现在主页。</p></div><span className="pixel-label">{draft.githubRepositoryIds.length}/6</span></div>{githubOptionsLoading ? <p>正在同步 GitHub 公开仓库…</p> : githubRepositoryOptions.length ? <div className="featured-work-picker">{githubRepositoryOptions.map(repository => <label key={repository.id}><input type="checkbox" checked={draft.githubRepositoryIds.includes(repository.id)} disabled={!draft.githubRepositoryIds.includes(repository.id) && draft.githubRepositoryIds.length >= 6} onChange={() => toggleGitHubRepository(repository.id)}/><span><strong>{repository.owner}/{repository.name}</strong><small>已验证公开仓库</small></span></label>)}</div> : <p>尚未发现可展示的公开仓库。请先在创作中心连接 GitHub App 并授权仓库；仅绑定 GitHub 登录不会额外申请仓库读取权限。</p>}<div className="dialog-actions"><Button type="button" disabled={busy === 'save'} onClick={() => save()}>{busy === 'save' ? '保存中…' : '保存 GitHub 展示'}</Button></div></section>}
    <section className="public-profile-body"><article className="panel public-profile-about"><span className="kicker">ABOUT</span><h2>关于 {profile.displayName}</h2><p>{profile.about || '暂时没有更多介绍。'}</p></article><aside className="panel public-profile-summary"><span className="kicker">PROFILE</span><dl><div><dt>身份</dt><dd>{profile.creator ? 'GameHub 创作者' : '玩家'}</dd></div><div><dt>加入时间</dt><dd>{new Date(profile.joinedAt).toLocaleDateString('zh-CN')}</dd></div><div><dt>协作状态</dt><dd>{collaborationLabels[profile.collaborationStatus]}</dd></div><div><dt>公开范围</dt><dd>{socialVisibilityLabels[profile.visibility]}</dd></div></dl></aside></section>
    {profile.achievementsVisible && profile.achievements && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">ACHIEVEMENTS</span><h2>成就与排行</h2><p>根据平台内已完成的公开游戏成绩自动计算。</p></div></div><div className="profile-stat-grid"><div><PixelAchievementIcon kind="calendar"/><span className="profile-stat-copy"><strong>{profile.achievements.totalDays}</strong><span>参与天数</span></span></div><div><PixelAchievementIcon kind="flame"/><span className="profile-stat-copy"><strong>{profile.achievements.longestStreak}</strong><span>最长连续天数</span></span></div><div><PixelAchievementIcon kind="trophy"/><span className="profile-stat-copy"><strong>{profile.achievements.challengeWins}</strong><span>挑战胜场</span></span></div><div><PixelAchievementIcon kind="crown"/><span className="profile-stat-copy"><strong>{profile.achievements.bestDailyRank ? `#${profile.achievements.bestDailyRank}` : '—'}</strong><span>历史最佳日榜</span></span></div></div>{!!profile.achievements.badges.length && <div className="profile-badge-grid">{profile.achievements.badges.map(badge => <div key={badge.key}><PixelAchievementIcon kind={achievementBadgeIcon(badge.key)}/><strong>{badge.name}</strong><small>{badge.description}</small></div>)}</div>}</section>}
    {profile.activityVisible && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">ACTIVITY</span><h2>最近公开活动</h2><p>仅记录公开作品发布和用户选择公开的游戏完成记录。</p></div></div>{profile.activity.length ? <ol className="profile-activity-list">{profile.activity.map((item,index) => <li key={`${item.type}-${item.occurredAt}-${index}`}><span>{item.type === 'work_published' ? '发布' : '游玩'}</span><div><strong>{item.title}</strong><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleDateString('zh-CN')}</time></div></li>)}</ol> : <p className="quiet-all-seen">还没有可展示的公开活动。</p>}</section>}
    {!!profile.contributions?.length && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">OPEN SOURCE CONTRIBUTIONS</span><h2>已完成贡献</h2><p>仅展示经作品作者验收、且带有公开成果地址的贡献。</p></div></div><div className="profile-contribution-grid">{profile.contributions.map(item => <article key={item.taskId}><span>{item.workTitle}</span><h3>{item.title}</h3><time>{new Date(item.completedAt).toLocaleDateString('zh-CN')}</time><div>{item.issueUrl && <a href={item.issueUrl} target="_blank" rel="noopener noreferrer">Issue ↗</a>}<a href={item.submissionUrl} target="_blank" rel="noopener noreferrer">查看成果 ↗</a></div></article>)}</div></section>}
    {!!profile.githubRepositories.length && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">OPEN SOURCE</span><h2>公开 GitHub 仓库</h2><p>由用户从已授权且公开的仓库中主动选择。</p></div></div><div className="profile-repository-grid">{profile.githubRepositories.map(repository => <a key={repository.id} href={repository.url} target="_blank" rel="noopener noreferrer"><GitHubLogo/><span><strong>{repository.owner}/{repository.name}</strong><small>GitHub 公开仓库 ↗</small></span></a>)}</div></section>}
    {!!profile.featuredWorks.length && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">FEATURED WORK</span><h2>精选作品</h2><p>由创作者亲自挑选。</p></div></div><div className="work-grid">{profile.featuredWorks.map(work => <WorkCard key={work.id} work={work} go={go}/>)}</div></section>}
    <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">PUBLIC WORKS</span><h2>公开作品</h2><p>这里只展示已发布并可正常访问的作品。</p></div></div>{remaining.length ? <div className="work-grid">{remaining.map(work => <WorkCard key={work.id} work={work} go={go}/>)}</div> : !profile.works.length ? <StatePanel title="还没有公开作品" body="创作者发布的作品会自动出现在这里。"/> : <p className="quiet-all-seen">全部公开作品都已在精选区展示。</p>}</section>
    {profile.libraryVisible && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">GAME LIBRARY</span><h2>公开游戏库</h2><p>{profile.isMe ? '这是别人能看到的收藏内容。' : `${profile.displayName} 主动公开的收藏。`}</p></div></div>{profile.library.length ? <div className="work-grid">{profile.library.map(work => <WorkCard key={work.id} work={work} go={go}/>)}</div> : <StatePanel title="公开游戏库还是空的" body="收藏公开作品后，它们会显示在这里。"/>}</section>}
  </main>;
}

const reportCategoryLabels = { unsafe: '不安全或越权', malware: '恶意代码或欺骗', harassment: '骚扰或仇恨', copyright: '版权问题', other: '其他问题' };

const socialVisibilityLabels = { public: '所有玩家可见', followers: '仅关注者可见', private: '完全私密' };
const reactionLabels = { gg: 'GG', spark: '✦', wow: '!!', coffee: '▣' };
const reactionNames = { gg: '好局', spark: '精彩', wow: '惊了', coffee: '歇会' };

function SocialPage({ api, go, demo }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const [scope, setScope] = useState('global');
  const [state, setState] = useState({ status: 'loading', profile: null, board: [], notifications: [], challenges: [], retention: null, preferences: { follow: true, reaction: true, challenge: true } });
  const [bio, setBio] = useState(''); const [visibility, setVisibility] = useState('public');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = async selectedScope => {
    setState(current => ({ ...current, status: 'loading' })); setError('');
    try {
      if (demo) {
        const profile = { id: 'demo-user', handle: 'miyazaki1', displayName: '休息玩家', bio: '在 Agent 思考时玩一局。', visibility: 'public', avatar: demoAccountProfile.avatar, followerCount: 7, followingCount: 3, isFollowing: false, isMe: true };
        const pal = { ...profile, id: 'demo-pal', handle: 'pixel-pal', displayName: '像素搭子', isMe: false, isFollowing: true };
        const board = [{ rank: 1, player: pal, guessedCount: 8, elapsedSeconds: 39, hints: 0, reactions: { gg: 3, spark: 2 }, myReaction: 'gg' }, { rank: 2, player: profile, guessedCount: 10, elapsedSeconds: 58, hints: 1, reactions: { coffee: 1 }, myReaction: null }];
        const notifications = [{ id: 'demo-note-1', type: 'reaction', actor: pal, puzzleDate: today, reaction: 'spark', read: false, createdAt: new Date().toISOString() }, { id: 'demo-note-2', type: 'follow', actor: pal, puzzleDate: null, reaction: null, read: true, createdAt: new Date(Date.now() - 3600000).toISOString() }];
        const challenges = [{ code: 'PIXEL-DEMO-1', role: 'participant', status: 'completed', outcome: 'win', opponent: pal, myScore: { hints: 0, guessedCount: 7, elapsedSeconds: 34 }, opponentScore: { hints: 0, guessedCount: 8, elapsedSeconds: 39 } }];
        const retention = { currentStreak: 3, longestStreak: 7, totalDays: 12, completedChallenges: 4, badges: [{ key: 'first_break', name: '初次休息', description: '完成第一局猜百科', unlocked: true }, { key: 'streak_3', name: '三日火花', description: '连续参与 3 天', unlocked: true }, { key: 'streak_7', name: '七日像素', description: '连续参与 7 天', unlocked: true }, { key: 'challenger', name: '挑战者', description: '完成第一场玩家挑战', unlocked: true }, { key: 'duel_winner', name: '胜负手', description: '赢得第一场玩家挑战', unlocked: true }] };
        setState({ status: 'ready', profile, board: selectedScope === 'following' ? board.slice(0, 1) : board, notifications, challenges, retention, preferences: { follow: true, reaction: true, challenge: true } }); setBio(profile.bio); setVisibility(profile.visibility); return;
      }
      const [profileResult, boardResult, notificationResult, challengeResult, retentionResult, preferenceResult] = await Promise.all([api.getSocialProfile(), api.getGuessBaikeLeaderboard(today, selectedScope), api.listSocialNotifications(), api.listGuessBaikeChallenges(), api.getPlayerRetention(), api.getNotificationPreferences()]);
      setState({ status: 'ready', profile: profileResult.data, board: boardResult.data, notifications: notificationResult.data, challenges: challengeResult.data, retention: retentionResult.data, preferences: preferenceResult.data }); setBio(profileResult.data.bio); setVisibility(profileResult.data.visibility);
    } catch (caught) { setState({ status: caught.status === 401 ? 'auth' : 'error', profile: null, board: [], notifications: [], challenges: [], retention: null, preferences: { follow: true, reaction: true, challenge: true } }); }
  };
  useEffect(() => { load(scope); }, [scope]);
  const saveSettings = async event => {
    event.preventDefault(); setBusy('settings'); setError('');
    try { const profile = demo ? { ...state.profile, bio: bio.trim(), visibility } : (await api.updateSocialProfile({ bio: bio.trim(), visibility })).data; setState(current => ({ ...current, profile })); }
    catch (caught) { setError(caught.message || '社交设置没有保存。'); }
    finally { setBusy(''); }
  };
  const toggleFollow = async player => {
    setBusy(player.id); setError('');
    try {
      if (!demo) await (player.isFollowing ? api.unfollowUser(player.id) : api.followUser(player.id));
      setState(current => ({ ...current, board: current.board.map(entry => entry.player.id === player.id ? { ...entry, player: { ...entry.player, isFollowing: !player.isFollowing, followerCount: Math.max(0, entry.player.followerCount + (player.isFollowing ? -1 : 1)) } } : entry) }));
    } catch (caught) { setError(caught.message || '关注状态没有更新。'); }
    finally { setBusy(''); }
  };
  const block = async player => {
    if (!globalThis.confirm?.(`屏蔽 ${player.displayName}？双方将无法查看彼此资料和榜单成绩。`)) return;
    setBusy(player.id); setError('');
    try { if (!demo) await api.blockUser(player.id); setState(current => ({ ...current, board: current.board.filter(entry => entry.player.id !== player.id) })); }
    catch (caught) { setError(caught.message || '暂时无法屏蔽这个玩家。'); }
    finally { setBusy(''); }
  };
  const react = async (entry, reaction) => {
    setBusy(`reaction-${entry.player.id}`); setError('');
    try {
      const removing = entry.myReaction === reaction;
      if (!demo) await (removing ? api.removeGuessBaikeReaction(entry.player.id, today) : api.reactToGuessBaikeResult(entry.player.id, { puzzleDate: today, reaction }));
      setState(current => ({ ...current, board: current.board.map(item => {
        if (item.player.id !== entry.player.id) return item;
        const reactions = { ...item.reactions };
        if (item.myReaction) reactions[item.myReaction] = Math.max(0, Number(reactions[item.myReaction] || 0) - 1);
        if (!removing) reactions[reaction] = Number(reactions[reaction] || 0) + 1;
        return { ...item, reactions, myReaction: removing ? null : reaction };
      }) }));
    } catch (caught) { setError(caught.message || '反应没有送达。'); }
    finally { setBusy(''); }
  };
  const copy = async text => { try { await navigator.clipboard.writeText(text); setNotice('已复制到剪贴板'); } catch { setError('无法访问剪贴板，请稍后重试。'); } };
  const copyScore = entry => copy(`猜百科 · ${today}\n${entry.rank ? `今日 #${entry.rank} · ` : ''}${entry.hints} 提示 · ${entry.guessedCount} 字符 · ${entry.elapsedSeconds} 秒\nGameHub 休息室`);
  const createChallenge = async entry => {
    setBusy('challenge'); setError('');
    try {
      const code = demo ? 'PIXEL-DEMO-1' : (await api.createGuessBaikeChallenge(today)).data.code;
      await copy(`${location.origin}${location.pathname}#/challenge/${code}`);
      setNotice(`挑战链接已复制 · 对手需要完成今日同一道题`);
    } catch (caught) { setError(caught.message || '挑战链接没有生成。'); }
    finally { setBusy(''); }
  };
  const markRead = async () => {
    setBusy('notifications');
    try { if (!demo) await api.markSocialNotificationsRead(); setState(current => ({ ...current, notifications: current.notifications.map(item => ({ ...item, read: true })) })); }
    catch (caught) { setError(caught.message || '通知状态没有更新。'); }
    finally { setBusy(''); }
  };
  const togglePreference = async key => {
    const preferences = { ...state.preferences, [key]: !state.preferences[key] };
    setBusy(`preference-${key}`); setError('');
    try { const saved = demo ? preferences : (await api.updateNotificationPreferences(preferences)).data; setState(current => ({ ...current, preferences: saved })); }
    catch (caught) { setError(caught.message || '通知偏好没有保存。'); }
    finally { setBusy(''); }
  };
  if (state.status === 'loading') return <main className="page social-page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page social-page"><StatePanel title="登录后进入休息室" body="排行榜、关注和隐私设置会跟随你的 GameHub 账号。" action="前往登录" onAction={() => go('/account')}/></main>;
  if (state.status === 'error') return <main className="page social-page"><StatePanel title="休息室暂时没有连上" body="本地服务恢复后再试一次。" action="重新连接" onAction={() => load(scope)}/></main>;
  const unread = state.notifications.filter(item => !item.read).length;
  return <main className="page social-page"><div className="section-heading"><div><span className="kicker">ASYNC BREAK ROOM</span><h1>休息室</h1><p>围绕一局游戏认识玩家，不读取代码，也不展示项目状态。</p></div><span className="social-date">DAILY / {today.slice(5).replace('-', '/')}</span></div>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="social-notice" role="status">{notice}</p>}<div className="social-grid">
    <section className="social-board panel"><div className="social-board__head"><div><span className="kicker">猜百科</span><h2>今日排行榜</h2></div><div className="filter-row"><button className={scope === 'global' ? 'is-active' : ''} onClick={() => setScope('global')}>全站</button><button className={scope === 'following' ? 'is-active' : ''} onClick={() => setScope('following')}>关注</button></div></div>{state.board.length ? <ol>{state.board.map(entry => <li className={entry.player.isMe ? 'is-me' : ''} key={entry.player.id}><b className="social-rank">#{entry.rank}</b><AvatarView avatar={entry.player.avatar} api={api} alt=""/><div className="social-player"><strong>{entry.player.displayName}{entry.player.isMe && <em>YOU</em>}</strong><small>{entry.hints} 提示 · {entry.guessedCount} 字符 · {entry.elapsedSeconds} 秒</small></div><div className="social-actions">{entry.player.isMe ? <><button onClick={() => copyScore(entry)}>复制成绩卡</button><button onClick={() => createChallenge(entry)} disabled={busy === 'challenge'}>发起挑战</button></> : <><button onClick={() => toggleFollow(entry.player)} disabled={busy === entry.player.id}>{entry.player.isFollowing ? '已关注' : '+ 关注'}</button><button className="social-block" onClick={() => block(entry.player)} disabled={busy === entry.player.id}>屏蔽</button></>}</div>{!entry.player.isMe && <div className="social-reactions" aria-label={`回应 ${entry.player.displayName} 的成绩`}>{Object.entries(reactionLabels).map(([value,label]) => <button title={reactionNames[value]} aria-pressed={entry.myReaction === value} className={entry.myReaction === value ? 'is-active' : ''} disabled={busy === `reaction-${entry.player.id}`} onClick={() => react(entry,value)} key={value}><span>{label}</span>{Number(entry.reactions?.[value] || 0) > 0 && <b>{entry.reactions[value]}</b>}</button>)}</div>}</li>)}</ol> : <div className="social-empty"><strong>{scope === 'following' ? '关注榜还没有成绩' : '今天还没有玩家上榜'}</strong><p>完成今日猜百科后，成绩会出现在这里。</p></div>}</section>
    <div className="social-side">
      <aside className="social-profile panel"><span className="kicker">MY PLAYER CARD</span><div className="social-profile__identity"><AvatarView avatar={state.profile.avatar} api={api} alt="我的头像"/><div><h2>{state.profile.displayName}</h2><p>{state.profile.followerCount} 关注者 · 正在关注 {state.profile.followingCount}</p></div></div><form onSubmit={saveSettings}><label>一句介绍<textarea maxLength="160" value={bio} onChange={event => setBio(event.target.value)} placeholder="例如：每天 Agent 思考时来一局。"/></label><label>谁能看到我<select value={visibility} onChange={event => setVisibility(event.target.value)}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><small>{Array.from(bio).length}/160 · 私密资料不会进入公共榜单</small><Button type="submit" disabled={busy === 'settings'}>{busy === 'settings' ? '保存中…' : '保存玩家卡片'}</Button></form>{state.retention && <div className="retention-card"><div><span><b>{state.retention.currentStreak}</b> 天</span><small>当前连续</small></div><div><span><b>{state.retention.longestStreak}</b> 天</span><small>最长记录</small></div><div><span><b>{state.retention.totalDays}</b> 次</span><small>休息日</small></div><ol>{state.retention.badges.map(item => <li className={item.unlocked ? 'is-unlocked' : ''} title={item.description} key={item.key}><i>{item.unlocked ? '◆' : '◇'}</i><span>{item.name}</span></li>)}</ol></div>}</aside>
      <section className="social-notifications panel"><div><span className="kicker">SIGNALS</span><h2>新消息 {unread > 0 && <em>{unread}</em>}</h2>{unread > 0 && <button onClick={markRead} disabled={busy === 'notifications'}>全部已读</button>}</div>{state.notifications.length ? <ol>{state.notifications.slice(0,6).map(item => <li className={item.read ? '' : 'is-unread'} key={item.id}><AvatarView avatar={item.actor.avatar} api={api} alt=""/><p><strong>{item.actor.displayName}</strong>{item.type === 'follow' ? ' 关注了你' : item.type === 'challenge_complete' ? ` 完成了挑战 · ${item.outcome === 'win' ? '你赢了' : item.outcome === 'loss' ? '对方胜出' : '平局'}` : ` 对你的成绩回应了 ${reactionLabels[item.reaction]}`}</p><time>{new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol> : <p className="social-notifications__empty">还没有新信号。</p>}<div className="notification-preferences"><small>通知偏好</small>{[['follow','关注'],['reaction','成绩回应'],['challenge','挑战结果']].map(([key,label]) => <button className={state.preferences[key] ? 'is-on' : ''} disabled={busy === `preference-${key}`} onClick={() => togglePreference(key)} key={key}><i/>{label}</button>)}</div></section>
      <section className="social-challenges panel"><span className="kicker">CHALLENGE LOG</span><h2>挑战记录</h2>{state.challenges.length ? <ol>{state.challenges.slice(0,5).map(item => <li key={item.code}><div><strong>{item.opponent?.displayName || '等待玩家'}</strong><small>{item.role === 'creator' ? '我发起' : '我接受'} · {item.status === 'completed' ? (item.outcome === 'win' ? '胜出' : item.outcome === 'loss' ? '惜败' : '平局') : item.status === 'expired' ? '已过期' : '进行中'}</small></div>{item.status === 'pending' && item.role === 'participant' && <button onClick={() => go(`/play/${GUESS_BAIKE_WORK_ID}/challenge/${item.code}`)}>继续</button>}</li>)}</ol> : <p className="social-notifications__empty">还没有挑战记录。</p>}</section>
    </div>
  </div></main>;
}

function ChallengePage({ api, go, demo, code }) {
  const [state, setState] = useState({ status: 'loading', challenge: null });
  const [accepting, setAccepting] = useState(false); const [acceptError, setAcceptError] = useState('');
  useEffect(() => { let live = true; (async () => { try {
    const challenge = demo ? { code, puzzleDate: new Date().toLocaleDateString('en-CA',{ timeZone: 'Asia/Shanghai' }), expiresAt: new Date(Date.now()+3600000).toISOString(), creator: { displayName: '像素搭子', avatar: demoAccountProfile.avatar }, score: { hints: 0, guessedCount: 8, elapsedSeconds: 39 } } : (await api.getGuessBaikeChallenge(code)).data;
    if (live) setState({ status: 'ready', challenge });
  } catch (caught) { if (live) setState({ status: caught.status === 401 ? 'auth' : 'error', challenge: null }); } })(); return () => { live = false; }; }, [api,code,demo]);
  if (state.status === 'loading') return <main className="page challenge-page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page challenge-page"><StatePanel title="登录后接下挑战" body="挑战成绩会记录在你的 GameHub 账号中。" action="前往登录" onAction={() => go('/account')}/></main>;
  if (state.status === 'error') return <main className="page challenge-page"><StatePanel title="挑战已经失效" body="链接可能已过期，或发起者的玩家卡片不可见。" action="返回休息室" onAction={() => go('/social')}/></main>;
  const item = state.challenge;
  const accept = async () => { setAccepting(true); setAcceptError(''); try { if (!demo) await api.acceptGuessBaikeChallenge(code); go(`/play/${GUESS_BAIKE_WORK_ID}/challenge/${code}`); } catch (caught) { setAcceptError(caught.message || '挑战没有接下。'); } finally { setAccepting(false); } };
  return <main className="page challenge-page"><section className="challenge-card panel"><span className="kicker">PIXEL CHALLENGE</span><AvatarView avatar={item.creator.avatar} api={api} alt="挑战发起者"/><p><strong>{item.creator.displayName}</strong> 向你发起今日猜百科挑战</p><div className="challenge-score"><span>{item.score.hints}<small>提示</small></span><span>{item.score.guessedCount}<small>字符</small></span><span>{item.score.elapsedSeconds}<small>秒</small></span></div><h1>能超过这个成绩吗？</h1><p className="challenge-note">双方挑战同一天、同一道题。先比提示次数，再比猜字数和用时。</p>{acceptError && <p className="form-error">{acceptError}</p>}<Button icon={icons.play} disabled={accepting || item.status === 'completed'} onClick={accept}>{accepting ? '接收中…' : item.status === 'accepted' && item.acceptedByMe ? '继续挑战' : '接受挑战'}</Button><button className="back-link" onClick={() => go('/social')}>暂时不了</button></section></main>;
}


const agentInstallTargets = [
  {
    id: 'harness', name: 'DeepSeek Harness', badge: '原生右栏', tone: 'native', state: '官方安装器 · 自动更新',
    summary: '完整 GameHub 客户端内置在 Harness 右栏；首次确认安装后每 6 小时后台校验更新，重启 Harness 生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName harness',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- harness',
    update: '& "$env:LOCALAPPDATA\\GameHub\\agent-update.ps1" -HostName harness',
    prompt: '请帮我把 GameHub 安装到 DeepSeek Harness 的 web profile。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查脚本，说明它会从 mooyu.fun 下载并校验构建好的插件 tarball，再调用 dsh plugin --profile web add，然后等待我确认；确认后执行适合当前系统的命令，验证安装结果，并提醒我重启 dsh web。',
  },
  {
    id: 'vscode', name: 'VS Code', badge: '原生侧栏', tone: 'native', state: '官方安装器 · 自动更新',
    summary: '通过 Activity Bar 打开 GameHub，令牌保存在 SecretStorage；扩展自身静默下载并校验新版，重启编辑器生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName code',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- code',
    prompt: '请帮我安装 GameHub 的 VS Code 扩展。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查安装脚本，向我说明它会从 mooyu.fun 下载 VSIX、校验 SHA-256 并调用 code --install-extension，然后等待我确认；确认后使用适合当前系统的命令安装，验证扩展已启用，并告诉我如何在 Activity Bar 打开 GameHub。',
  },
  {
    id: 'cursor', name: 'Cursor', badge: '原生侧栏', tone: 'native', state: '官方安装器 · 自动更新',
    summary: '与 VS Code 共用扩展并自动识别 Cursor；扩展自身静默下载并校验新版，重启编辑器生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName cursor',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- cursor',
    prompt: '请帮我安装 GameHub 的 Cursor 扩展。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查安装脚本，向我说明它会从 mooyu.fun 下载 VSIX、校验 SHA-256 并调用 cursor --install-extension，然后等待我确认；确认后使用适合当前系统的命令安装，验证扩展已启用，并告诉我如何打开 GameHub 侧栏。',
  },
  {
    id: 'windsurf', name: 'Windsurf', badge: '优先内置', tone: 'testing', state: '兼容性验证中',
    summary: '优先复用 VS Code 扩展；若宿主 Webview 或密钥存储不兼容，则安全回退浏览器。',
    prompt: '请检查当前 Windsurf 是否支持安装 VSIX；支持时在获得我的确认后安装 GameHub，否则打开 https://mooyu.fun。',
  },
  {
    id: 'codex', name: 'Codex / ChatGPT', badge: 'Plugin + MCP App', tone: 'building', state: '官方技能安装器 · MCP App 开发中',
    summary: '官方安装器添加本地 GameHub marketplace，并注册后台更新；新版本在 Codex 重启后从插件缓存加载。原生 MCP App 上线后再启用内置交互。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName codex',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- codex',
    update: '& "$env:LOCALAPPDATA\\GameHub\\agent-update.ps1" -HostName codex',
    prompt: '请帮我安装 GameHub 的 Codex 插件。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查脚本，说明它会从 mooyu.fun 下载并逐文件校验插件包、添加本地 GameHub marketplace，然后等待我确认；确认后执行适合当前系统的命令。完成后请引导我在 Plugins Directory 的 GameHub Plugins 来源中安装 gamehub。',
  },
  {
    id: 'claude', name: 'Claude Code', badge: 'Agent Plugin', tone: 'building', state: '官方技能安装器 · MCP 开发中',
    summary: '官方安装器下载并校验可移植技能，通过 Claude Code marketplace 安装；后台会暂存新版，重启并刷新插件后生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName claude',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- claude',
    update: '& "$env:LOCALAPPDATA\\GameHub\\agent-update.ps1" -HostName claude',
    prompt: '请帮我安装 GameHub 的 Claude Code 插件。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查脚本，说明它会从 mooyu.fun 下载并逐文件校验插件包、添加本地 marketplace 并调用 claude plugin install gamehub@gamehub，然后等待我确认；确认后执行适合当前系统的命令并验证插件已启用。',
  },
  {
    id: 'opencode', name: 'OpenCode / 终端 Agent', badge: 'MCP + 浏览器', tone: 'browser', state: '规划中',
    summary: 'Agent 负责搜索、账号与启动指令，视觉游玩界面由系统浏览器承载。',
    prompt: '请检查当前 Agent 是否支持 GameHub MCP；若尚未支持，请打开 https://mooyu.fun。',
  },
];

function AgentInstallCard({ target, copied, onCopy, onOpen }) {
  return <article className="agent-install-card">
    <div className="agent-install-card__head"><div><span className={`agent-install-card__badge is-${target.tone}`}>{target.badge}</span><h3>{target.name}</h3></div><small>{target.state}</small></div>
    <p>{target.summary}</p>
    {target.command && <div className="agent-command"><code>{target.command}</code><button onClick={() => onCopy(target.command, `${target.id}-command`)}>{copied === `${target.id}-command` ? '已复制' : '复制命令'}</button></div>}
    {target.alternate && <details><summary>macOS / Linux</summary><div className="agent-command"><code>{target.alternate}</code><button onClick={() => onCopy(target.alternate, `${target.id}-alternate`)}>{copied === `${target.id}-alternate` ? '已复制' : '复制'}</button></div></details>}
    {target.update && <details><summary>更新命令</summary><div className="agent-command"><code>{target.update}</code><button onClick={() => onCopy(target.update, `${target.id}-update`)}>{copied === `${target.id}-update` ? '已复制' : '复制'}</button></div></details>}
    <div className="agent-install-card__actions"><button onClick={() => onCopy(target.prompt, `${target.id}-prompt`)}>{copied === `${target.id}-prompt` ? '提示词已复制' : (target.actionLabel ?? '让 Agent 帮我安装')}</button><button onClick={onOpen}>先用网页版</button></div>
  </article>;
}

function InstallPage({ go, hostIdentity }) {
  const [copied, setCopied] = useState('');
  const copy = async (value, key) => {
    try { await globalThis.navigator?.clipboard?.writeText(value); setCopied(key); globalThis.setTimeout?.(() => setCopied(current => current === key ? '' : current), 1800); }
    catch { globalThis.prompt?.('复制下面的内容', value); }
  };
  const detected = agentInstallTargets.find(item => item.id === hostIdentity.id);
  return <main className="page install-page">
    <section className="install-hero">
      <div><span className="kicker">GAMEHUB EVERYWHERE</span><h1>添加到你的 Agent</h1><p>能安全内置就留在 Agent 里；宿主没有稳定界面能力时，再打开浏览器。首次安装需你确认，之后后台下载校验过的稳定版，并在宿主重启后生效。</p></div>
      <div className="install-detected"><span>当前环境</span><strong>{hostIdentity.label}</strong><small>{detected ? `${detected.badge} · ${detected.state}` : '使用网页版'}</small></div>
    </section>
    <section className="install-principles" aria-label="接入原则"><div><b>01</b><strong>原生优先</strong><span>右栏、侧栏或 MCP App</span></div><div><b>02</b><strong>最小权限</strong><span>不读取项目与宿主凭据</span></div><div><b>03</b><strong>始终可用</strong><span>不支持内置时回退网页</span></div></section>
    {detected && <section className="install-recommended"><span>为当前宿主推荐</span><AgentInstallCard target={detected} copied={copied} onCopy={copy} onOpen={() => go('/discover')}/></section>}
    <section className="install-catalog"><div className="section-heading"><div><h2>选择你的 Agent</h2><p>安装入口会随着各宿主完成验证逐步开放。</p></div></div><div className="agent-install-grid">{agentInstallTargets.filter(item => item.id !== detected?.id).map(target => <AgentInstallCard key={target.id} target={target} copied={copied} onCopy={copy} onOpen={() => go('/discover')}/>)}</div></section>
    <section className="install-security"><div><span className="kicker">BEFORE YOU INSTALL</span><h2>安装前会发生什么</h2></div><ul><li>插件安装或执行命令前，应由 Agent 向你请求确认。</li><li>GameHub 登录令牌只进入宿主提供的安全存储；游戏 iframe 不可访问。</li><li>所有尚未验证的宿主都明确标记，不会伪装成已经可用。</li><li>安装器只从 mooyu.fun 下载版本清单和制品，并逐个校验 SHA-256。</li><li>Cursor / VS Code 由扩展自身静默更新；其他 Agent 使用当前用户的计划任务或 cron，不需要每次手动执行命令。</li></ul></section>
  </main>;
}


const compactNumber = value => new Intl.NumberFormat('zh-CN', { notation: Number(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value || 0));
const hours = milliseconds => `${(Number(milliseconds || 0) / 3_600_000).toFixed(Number(milliseconds || 0) >= 3_600_000 ? 1 : 2)} 小时`;
const bytes = value => {
  const number = Number(value || 0); const units = ['B','KiB','MiB','GiB','TiB']; let size = number; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
};

function AdminStorage({ storage }) {
  if (!storage) return null;
  const labels = { quarantine: '上传隔离区', validator: '校验工作区', runtime: '运行资产', avatars: '头像', covers: '封面' };
  const state = storage.level === 'healthy' ? '容量正常' : storage.level === 'warning' ? '容量预警' : storage.level === 'blocked' ? '已停止新上传' : '容量探测失败';
  return <section className={`storage-health storage-health--${storage.level}`}><div className="storage-health__head"><div><span className="kicker">STORAGE GUARD</span><h2>{state}</h2><p>{storage.acceptingUploads ? `达到 ${storage.thresholds.warnPercent}% 时告警，达到 ${storage.thresholds.blockPercent}% 时自动阻止新上传。` : '现有作品、下载和运行保持可用；恢复安全容量后会自动重新开放上传。'}</p></div><strong>{storage.usedPercent.toFixed(2)}%</strong></div><div className="storage-health__meter" aria-label={`磁盘已使用 ${storage.usedPercent.toFixed(2)}%`}><i style={{ width: `${Math.min(100, storage.usedPercent)}%` }}/><b style={{ left: `${storage.thresholds.warnPercent}%` }}/><b style={{ left: `${storage.thresholds.blockPercent}%` }}/></div><div className="storage-health__stores">{storage.stores.map(store => <article key={store.id} className={`is-${store.level}`}><span>{labels[store.id] || store.id}</span>{store.available ? <><strong>{bytes(store.logicalBytes)}</strong><small>卷可用 {bytes(store.availableBytes)} · {store.usedPercent.toFixed(2)}%</small></> : <><strong>不可用</strong><small>{store.errorCode}</small></>}</article>)}</div><small className="storage-health__cleanup">最近清理：{storage.lastCleanup.at ? `${new Date(storage.lastCleanup.at).toLocaleString('zh-CN')} · ${storage.lastCleanup.filesRemoved} 个残留 · ${bytes(storage.lastCleanup.bytesReclaimed)}` : '等待首次自动清理'}</small></section>;
}

function AdminAnalytics({ analytics, days, onDays }) {
  const totals = analytics?.totals ?? {}; const daily = analytics?.daily ?? [];
  const maxViews = Math.max(1, ...daily.map(item => item.pageViews || 0));
  const cards = [
    ['访问用户', compactNumber(totals.visitors), '匿名去重设备'], ['页面浏览', compactNumber(totals.pageViews), '页面类别访问'],
    ['新增注册', compactNumber(totals.newUsers), `累计 ${compactNumber(totals.totalUsers)}`], ['活跃账号', compactNumber(totals.activeAccounts), '登录设备近期活跃'],
    ['游戏启动', compactNumber(totals.gameStarts), `历史游玩 ${compactNumber(totals.recordedPlays)}`], ['下载请求', compactNumber(totals.downloadStarts), `Agent 完成 ${compactNumber(totals.downloadCompletes)}`],
    ['站内时长', hours(totals.siteDurationMs), '前台心跳估算'], ['游戏时长', hours(totals.gameDurationMs), 'Web 会话统计'],
  ];
  return <section className="analytics-board"><div className="analytics-head"><div><span className="kicker">DATA CENTER</span><h2>平台数据中心</h2><p>掌握增长、访问、游玩与分发；统计不读取项目、输入内容或完整网址。</p></div><div className="analytics-range" aria-label="统计周期">{[7,30,90].map(value => <button key={value} className={days === value ? 'is-active' : ''} onClick={() => onDays(value)}>{value} 天</button>)}</div></div><div className="analytics-kpis">{cards.map(([label,value,note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div><div className="analytics-grid"><div className="analytics-trend"><div className="analytics-subhead"><h3>访问趋势</h3><span>上海时区</span></div><div className="analytics-bars">{daily.map(item => <div key={item.day} title={`${item.day} · ${item.pageViews} 次浏览 · ${item.visitors} 位访客`}><i style={{ height: `${Math.max(4, Math.round(item.pageViews / maxViews * 100))}%` }}/><small>{item.day.slice(5)}</small></div>)}</div></div><div className="analytics-hosts"><div className="analytics-subhead"><h3>使用入口</h3><span>去重访客</span></div>{analytics?.hosts?.length ? analytics.hosts.map(item => <div className="analytics-row" key={item.hostKind}><span>{item.hostKind}</span><strong>{compactNumber(item.visitors)}</strong><small>{compactNumber(item.pageViews)} PV</small></div>) : <p>新埋点上线后，这里会显示 Web、Cursor、Harness 等入口。</p>}</div></div><div className="analytics-works"><div className="analytics-subhead"><h3>热门作品</h3><span>浏览 / 启动 / 下载请求</span></div>{analytics?.works?.length ? <div className="analytics-table">{analytics.works.map((item,index) => <div key={item.workId}><b>{String(index + 1).padStart(2,'0')}</b><strong>{item.title}</strong><span>{compactNumber(item.views)}</span><span>{compactNumber(item.starts)}</span><span>{compactNumber(item.downloads)}</span></div>)}</div> : <p>暂无作品事件；部署后访问和启动会开始累计。</p>}</div><p className="analytics-footnote">浏览器只能确认“开始下载”；Agent 校验并入库后才计入“完成下载”。站内时长来自前台可见状态心跳，Windows 游戏运行时长暂不估算。</p></section>;
}

function AdminPage({ api, demo, go }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const demoPuzzles = [{ id: 'wikipedia-4723', title: '足球', aliases: ['协会足球','英式足球'], category: '体育', sourceKind: 'wikipedia-lead', sourceTitle: '足球', sourceUrl: 'https://zh.wikipedia.org/wiki/%E8%B6%B3%E7%90%83', sourceRevision: 94245396, sourceUpdatedAt: '2026-09-27T15:22:05Z', license: 'CC BY-SA 4.0', introHanCount: 364, content: '足球主要专指英式足球，官方名为协会足球，是一种世界流行的团体球类运动。', status: 'ready', qualityReason: null, scheduledDates: [today] }];
  const demoAutomation = { enabled: true, running: false, intervalMinutes: 360, batchSize: 20, scheduleDays: 14, readyCount: 18, scheduledCount: 14, lastRun: { status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), fetchedCount: 20, acceptedCount: 7, scheduledCount: 4, errorCode: null, errorMessage: null } };
  const demoAnalytics = { totals: { visitors: 1264, pageViews: 4812, newUsers: 86, totalUsers: 2341, activeAccounts: 734, gameStarts: 1960, recordedPlays: 9204, downloadStarts: 318, downloadCompletes: 241, siteDurationMs: 304560000, gameDurationMs: 196740000 }, daily: Array.from({ length: 7 }, (_, index) => ({ day: new Date(Date.now() - (6-index)*86400000).toLocaleDateString('en-CA'), visitors: 120+index*13, pageViews: 410+index*47, downloads: 20+index*5, gameStarts: 160+index*18, newUsers: 8+index })), hosts: [{ hostKind: 'browser', visitors: 812, pageViews: 3204 }, { hostKind: 'cursor', visitors: 336, pageViews: 1208 }, { hostKind: 'harness', visitors: 116, pageViews: 400 }], works: [{ workId: 'gamehub-guess-baike', title: '猜百科', views: 1240, starts: 988, downloads: 0 }, { workId: 'demo-space', title: '宇宙巡航机', views: 706, starts: 462, downloads: 318 }] };
  const demoStorage = { checkedAt: new Date().toISOString(), level: 'healthy', acceptingUploads: true, usedPercent: 31.42, thresholds: { warnPercent: 70, blockPercent: 85 }, stores: ['quarantine','validator','runtime','avatars','covers'].map((id,index) => ({ id, available: true, level: 'healthy', totalBytes: String(80 * 1024 ** 3), availableBytes: String(54 * 1024 ** 3), usedBytes: String(26 * 1024 ** 3), usedPercent: 31.42, projectedUsedPercent: 31.42, reservedBytes: '0', logicalBytes: String((index + 1) * 42 * 1024 ** 2) })), lastCleanup: { at: new Date().toISOString(), filesRemoved: 0, bytesReclaimed: 0 } };
  const demoSourceOverview = { activeConnections: 3, activeRepositories: 7, imports24h: 2, failedWebhooks24h: 0 };
  const demoSourceAudit = [{ id: 'source-audit-demo', actorUserId: null, connectionId: null, importId: null, workId: null, action: 'import.previewed', details: { commitSha: 'a'.repeat(40) }, createdAt: new Date().toISOString() }];
  const [days, setDays] = useState(7);
  const [state, setState] = useState({ status: 'loading', reports: [], audit: [], applications: [], puzzles: [], automation: null, analytics: null, storage: null, sourceOverview: null, sourceAudit: [] });
  const [notes, setNotes] = useState({}); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try {
      if (demo) return setState({ status: 'ready', reports: [], audit: [], applications: [], puzzles: demoPuzzles, automation: demoAutomation, analytics: demoAnalytics, storage: demoStorage, sourceOverview: demoSourceOverview, sourceAudit: demoSourceAudit });
      const profile = (await api.getProfile()).data;
      if (profile.role !== 'admin') return setState({ status: 'forbidden', reports: [], audit: [], applications: [], puzzles: [], automation: null, analytics: null, storage: null });
      const [reports, audit, applications, puzzles, automation, analytics, storage, sourceOverview, sourceAudit] = await Promise.all([api.listReports('open'), api.listModerationAudit(), api.listCreatorApplications('pending'), api.listAdminGuessBaikePuzzles(), api.getGuessBaikeAutomationStatus(), api.getAdminAnalytics(days), api.getAdminStorage(), api.getGitHubSourceAdminOverview(), api.listGitHubSourceAudit()]);
      setState({ status: 'ready', reports: reports.data, audit: audit.data, applications: applications.data, puzzles: puzzles.data, automation: automation.data, analytics: analytics.data, storage: storage.data, sourceOverview: sourceOverview.data, sourceAudit: sourceAudit.data });
    } catch (caught) { setState({ status: caught.status === 401 || caught.status === 403 ? 'forbidden' : 'error', reports: [], audit: [], applications: [], puzzles: [], automation: null, analytics: null, storage: null }); }
  };
  useEffect(() => { load(); }, [api, demo, days]);
  const decide = async (report, action) => {
    const note = (notes[report.id] || '').trim(); if (!note) return setError('请先填写处置说明。');
    if (action === 'suspend' && !globalThis.confirm?.(`暂停《${report.workTitle}》？当前公开版本将立即失效。`)) return;
    setBusy(report.id); setError('');
    try { await api.decideReport(report.id, { action, note }); await load(); }
    catch (caught) { setError(caught.message || '处置未完成。'); }
    finally { setBusy(''); }
  };
  const decideCreator = async (application, decision) => {
    const note = (notes[application.id] || '').trim(); if (!note) return setError('请先填写审核说明。');
    setBusy(application.id); setError(''); setNotice('');
    try {
      await api.decideCreatorApplication(application.id, { decision, note });
      setNotice(`${application.displayName} 的创作者申请已${decision === 'approve' ? '通过' : '拒绝'}。`);
      await load();
    } catch (caught) { setError(caught.message || '审核没有完成。'); }
    finally { setBusy(''); }
  };
  const togglePuzzle = async puzzle => {
    const status = puzzle.status === 'ready' ? 'disabled' : 'ready'; setBusy(`puzzle-${puzzle.id}`); setError(''); setNotice('');
    try { if (!demo) await api.updateAdminGuessBaikePuzzle(puzzle.id, status); setNotice(`《${puzzle.title}》已${status === 'ready' ? '启用' : '停用'}。`); await load(); }
    catch (caught) { setError(caught.message || '题目状态没有更新。'); }
    finally { setBusy(''); }
  };
  if (state.status === 'loading') return <main className="page admin-page"><LoadingCards/></main>;
  if (state.status === 'forbidden') return <main className="page"><StatePanel title="仅管理员可访问" body="这个页面包含举报内容与处置记录。" action="返回发现" onAction={() => go('/discover')}/></main>;
  if (state.status === 'error') return <main className="page"><StatePanel title="治理队列暂时不可用" body="没有执行任何处置，请稍后重试。" action="重新加载" onAction={load}/></main>;
  return <main className="page admin-page"><div className="section-heading"><div><span className="kicker">OPERATIONS DESK</span><h1>平台运营</h1><p>掌握平台增长、内容分发与治理状态。</p></div><span className="admin-count">{state.puzzles.filter(item => item.status === 'ready').length} 道可发布 · {state.applications.length} 份创作者申请 · {state.reports.length} 条举报</span></div>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="admin-notice" role="status">{notice}</p>}
    <AdminAnalytics analytics={state.analytics} days={days} onDays={setDays}/>
    <AdminStorage storage={state.storage}/>
    <MultiplayerRuleReviewQueue api={api} demo={demo}/>
    {state.sourceOverview && <section className="source-operations"><div className="puzzle-ops__head"><div><span className="kicker">GITHUB SOURCE CONTROL</span><h2>GitHub 只读导入</h2><p>连接、授权仓库、近 24 小时导入与 Webhook 故障；此面板不提供源码执行能力。</p></div><span>{state.sourceOverview.activeConnections} 个活动连接</span></div><div className="source-operation-kpis"><article><span>授权仓库</span><strong>{state.sourceOverview.activeRepositories}</strong></article><article><span>24h 导入</span><strong>{state.sourceOverview.imports24h}</strong></article><article className={state.sourceOverview.failedWebhooks24h ? 'is-warning' : ''}><span>24h Webhook 失败</span><strong>{state.sourceOverview.failedWebhooks24h}</strong></article></div><details><summary>最近来源审计</summary>{state.sourceAudit.length ? <ol>{state.sourceAudit.slice(0,20).map(event => <li key={event.id}><strong>{event.action}</strong><code>{event.details?.commitSha?.slice(0,12) || event.connectionId || '—'}</code><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p>暂无来源事件。</p>}</details></section>}
    {state.automation && <section className={`automation-health automation-health--${state.automation.lastRun?.status || 'idle'}`}><div className="automation-health__pulse"/><div><span className="kicker">AUTONOMOUS SUPPLY</span><h2>{state.automation.running ? '正在自动补充题库' : state.automation.lastRun?.status === 'failed' ? '最近一次同步失败，库存仍可用' : '全自动内容流水线正常'}</h2><p>每 {Math.round(state.automation.intervalMinutes / 60)} 小时自动抓取、筛选、去重，并补齐未来 {state.automation.scheduleDays} 天。无需人工审核或排期。</p>{state.automation.lastRun?.errorMessage && <small>{state.automation.lastRun.errorCode} · {state.automation.lastRun.errorMessage}</small>}</div><dl><div><dt>可用题</dt><dd>{state.automation.readyCount}</dd></div><div><dt>已排期</dt><dd>{state.automation.scheduledCount}/{state.automation.scheduleDays}</dd></div><div><dt>上次通过</dt><dd>{state.automation.lastRun?.acceptedCount ?? '—'}</dd></div></dl></section>}
    <section className="admin-queue"><div className="puzzle-ops__head"><div><span className="kicker">CREATOR REVIEW</span><h2>创作者申请</h2><p>审核申请说明；通过后申请人的当前登录设备会立即获得创作与发布权限。</p></div><span>{state.applications.length} 份待审</span></div>{state.applications.length ? state.applications.map(application => <article className="report-card" key={application.id}><div className="report-card__head"><div><span>申请账号</span><h3>{application.displayName}</h3></div><time>{new Date(application.createdAt).toLocaleString('zh-CN')}</time></div><p>{application.statement}</p><label>审核说明<textarea maxLength="1000" value={notes[application.id] || ''} onChange={event => setNotes(current => ({ ...current, [application.id]: event.target.value }))} placeholder="说明通过条件或拒绝原因。"/></label><div className="dialog-actions"><Button kind="secondary" disabled={busy === application.id} onClick={() => decideCreator(application, 'reject')}>拒绝</Button><Button disabled={busy === application.id} onClick={() => decideCreator(application, 'approve')}>{busy === application.id ? '处理中…' : '通过申请'}</Button></div></article>) : <div className="admin-empty"><span>✓</span><strong>没有待审核申请</strong><p>新的创作者申请会显示在这里。</p></div>}</section>
    <section className="puzzle-ops"><div className="puzzle-ops__head"><div><span className="kicker">OFFICIAL INVENTORY</span><h2>猜百科自动题库</h2><p>这里用于观察自动产出的结果。日常不需要操作；停用仅用于发现错误内容后的紧急止损。</p></div><span>{state.puzzles.length} 道题</span></div><div className="puzzle-ops__list">{state.puzzles.map(puzzle => <article className={`puzzle-op ${puzzle.status === 'disabled' ? 'is-disabled' : ''}`} key={puzzle.id}><div className="puzzle-op__top"><div><span className="puzzle-op__category">{puzzle.category}</span><h3>{puzzle.title}</h3><small>{puzzle.introHanCount} 汉字 · 修订 {puzzle.sourceRevision}</small></div><span className={`puzzle-status puzzle-status--${puzzle.status}`}>{puzzle.status === 'ready' ? '自动可用' : '已停用'}</span></div>{puzzle.qualityReason && <p className="puzzle-quality">质量检查：{puzzle.qualityReason}</p>}<details><summary>查看完整导言与来源</summary><p>{puzzle.content}</p><a href={puzzle.sourceUrl} target="_blank" rel="noreferrer">查看来源 · {puzzle.license}</a></details><div className="puzzle-op__emergency"><span>{puzzle.scheduledDates.length ? `未来排期 ${puzzle.scheduledDates.length} 天` : '自动轮换库存'}</span><button className="puzzle-toggle" disabled={busy === `puzzle-${puzzle.id}`} onClick={() => togglePuzzle(puzzle)}>{puzzle.status === 'ready' ? '紧急停用' : '纠正后恢复'}</button></div></article>)}</div></section>
    <section className="admin-grid"><div className="admin-queue"><h2>待处理举报</h2>{state.reports.length ? state.reports.map(report => <article className="report-card" key={report.id}><div className="report-card__head"><div><span>{reportCategoryLabels[report.category]}</span><h3>{report.workTitle}</h3></div><time>{new Date(report.createdAt).toLocaleString('zh-CN')}</time></div><p>{report.details || '举报者没有补充说明。'}</p><label>处置说明<textarea maxLength="1000" value={notes[report.id] || ''} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} placeholder="记录判断依据；该内容会进入审计记录。"/></label><div className="dialog-actions"><Button kind="secondary" disabled={busy === report.id} onClick={() => decide(report, 'dismiss')}>驳回举报</Button><button className="danger-button" disabled={busy === report.id} onClick={() => decide(report, 'suspend')}>{busy === report.id ? '处理中…' : '暂停作品'}</button></div></article>) : <div className="admin-empty"><span>✓</span><strong>队列已清空</strong><p>目前没有待处理举报。</p></div>}</div><aside className="audit-panel"><span className="kicker">APPEND-ONLY AUDIT</span><h2>最近处置</h2>{state.audit.length ? <ol>{state.audit.map(event => <li key={event.id}><span className={`audit-action audit-action--${event.action}`}>{event.action === 'suspend' ? '暂停' : '驳回'}</span><strong>{event.workTitle}</strong><p>{event.reason}</p><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p className="audit-empty">还没有管理处置记录。</p>}<small>审计表由数据库触发器禁止更新和删除。</small></aside></section></main>;
}

export default function App({ hostAdapter, apiClient, demo = new URLSearchParams(location.search).has('demo'), routing = 'hash' }) {
  const host = useMemo(() => hostAdapter ?? createBrowserHostAdapter(), [hostAdapter]);
  const api = useMemo(() => apiClient ?? createApiClient({
    baseUrl: host.apiBaseUrl ?? '',
    getAccessToken: () => host.account?.getAccessToken?.(),
    getRefreshToken: () => host.account?.getRefreshToken?.(),
    setTokens: tokens => host.account?.setTokens?.(tokens),
  }), [apiClient, host]);
  const [route, go] = useRoute(routing); const [themeMode, setThemeModeState] = useState('dark'); const [hostIdentity, setHostIdentity] = useState(hostIdentities.browser); const [hostReady, setHostReady] = useState(false); const [accountProfile, setAccountProfile] = useState(() => demo ? demoAccountProfile : null); const themeRoot = useRef(null);
  useEffect(() => { let live = true; host.getCapabilities().then(capabilities => { if (live) { setHostIdentity(resolveHostIdentity(capabilities)); setHostReady(true); } }).catch(() => { if (live) setHostReady(true); }); return () => { live = false; }; }, [host]);
  useEffect(() => { let live = true; const apply = theme => { if (!live || !themeRoot.current) return; setThemeModeState(theme.mode); applyThemeTokens(themeRoot.current, theme); }; host.theme.getTheme().then(apply); const off = host.theme.onThemeChanged(apply); return () => { live = false; off(); }; }, [host]);
  useEffect(() => { if (demo) return undefined; let live = true; api.getProfile().then(({ data }) => { if (live) setAccountProfile(data); }).catch(() => {}); return () => { live = false; }; }, [api, demo]);
  useEffect(() => { if (hostReady) emitAnalytics(api, hostIdentity.id, { type: 'page_view', route: routeCategory(route) }, demo); }, [api, hostIdentity.id, hostReady, route, demo]);
  useEffect(() => {
    if (demo || !hostReady) return undefined;
    const timer = setInterval(() => { if (globalThis.document?.visibilityState === 'visible') emitAnalytics(api, hostIdentity.id, { type: 'session_ping', route: routeCategory(route), durationMs: 30000 }, false); }, 30000);
    return () => clearInterval(timer);
  }, [api, hostIdentity.id, hostReady, route, demo]);
  const setThemeMode = mode => host.theme.setPreference?.(mode);
  let content; const parts = route.split('/').filter(Boolean);
  if (parts[0] === 'works' && parts[1]) content = <DetailPage workId={parts[1]} api={api} host={host} hostKind={hostReady ? hostIdentity.id : null} demo={demo} go={go}/>;
  else if (parts[0] === 'u' && parts[1]) content = <PublicProfilePage handle={decodeURIComponent(parts[1])} api={api} demo={demo} go={go} onProfileChange={setAccountProfile}/>;
  else if (parts[0] === 'play' && parts[1]) content = <PlayerPage workId={parts[1]} releaseId={parts[2] === 'challenge' ? null : parts[2]} challengeCode={parts[2] === 'challenge' ? parts[3] : null} initialRoomId={parts[3] === 'room' ? parts[4] : null} api={api} host={host} hostKind={hostReady ? hostIdentity.id : null} demo={demo} go={go}/>;
  else if (route === '/account') content = <AccountPage api={api} host={host} demo={demo} go={go} themeMode={themeMode} setThemeMode={setThemeMode} canChangeTheme={typeof host.theme.setPreference === 'function'} hostIdentity={hostIdentity} onProfileChange={setAccountProfile}/>;
  else if (route.startsWith('/creator/import')) content = <GitHubImportPage api={api} demo={demo} go={go}/>;
  else if (route === '/creator/works/new') content = <NewWorkPage api={api} demo={demo} go={go}/>;
  else if (route === '/creator/multiplayer/submit') content = <MultiplayerRuleSubmissionPage api={api} demo={demo} go={go}/>;
  else if (route === '/creator/multiplayer') content = <MultiplayerDeveloperCenter go={go}/>;
  else if (parts[0] === 'creator' && parts[2] && parts[3] === 'upload') content = <UploadPage workId={parts[2]} api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'creator' && parts[2] && parts[3] === 'builds') content = <SourceBuildPage workId={parts[2]} api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'creator') content = <CreatorPage api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'admin') content = <AdminPage api={api} demo={demo} go={go}/>;
  else if (route === '/install') content = <InstallPage go={go} hostIdentity={hostIdentity}/>;
  else if (route === '/library') content = <LibraryPage api={api} go={go} demo={demo}/>;
  else if (route === '/social') content = <SocialPage api={api} go={go} demo={demo}/>;
  else if (route === '/contribute') content = <ContributionCenterPage api={api} go={go} demo={demo} accountProfile={accountProfile}/>;
  else if (parts[0] === 'challenge' && parts[1]) content = <ChallengePage api={api} go={go} demo={demo} code={parts[1]}/>;
  else content = <DiscoverPage api={api} demo={demo} go={go} hostIdentity={hostIdentity}/>;
  const player = parts[0] === 'play';
  return <div ref={themeRoot} className={`app ${player ? 'app--player' : ''}`} data-host={hostIdentity.id}>{!player && <Header route={route} go={go} themeMode={themeMode} setThemeMode={setThemeMode} canChangeTheme={typeof host.theme.setPreference === 'function'} hostIdentity={hostIdentity} accountProfile={accountProfile} api={api}/>} {!player && <MobileNav route={route} go={go}/>}<div className="ambient" aria-hidden="true"/>{content}<div className="notice-region" aria-live="polite"/></div>;
}
