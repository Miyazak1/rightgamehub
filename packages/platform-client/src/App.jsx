import React, { useEffect, useMemo, useRef, useState } from 'react';
import { applyThemeTokens, createBrowserHostAdapter } from '@gamehub/host-contract';
import { createApiClient } from '@gamehub/platform-api-client';
import { PlayerCore } from '@gamehub/player-core';
import { demoUploads, demoWorks } from './demo.mjs';
import pixelCoverAtlas from './assets/game-covers-pixel-v1-optimized.png';
import avatarAtlas from './assets/avatar-atlas-pixel-v1.png';
import GuessBaikeGame from './GuessBaikeGame.jsx';

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
const demoAccountProfile = { id: 'demo-user', displayName: '休息玩家', role: 'user', canPublish: true, createdAt: '2026-09-28T00:00:00.000Z', avatar: { kind: 'preset', presetKey: 'cat', url: null, staticUrl: null, mediaType: null, animated: false }, linkedAccounts: [{ provider: 'github', label: 'GitHub', linkedAt: '2026-09-28T00:00:00.000Z' }] };

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
    <NavItem active={route.startsWith('/creator')} onClick={() => go('/creator')} icon={icons.creator}>创作</NavItem>
    <NavItem active={route === '/install'} onClick={() => go('/install')} icon="＋">安装</NavItem>
  </nav>;
}

function Art({ work, large = false }) {
  if (work.id === GUESS_BAIKE_WORK_ID || work.art === 'baike') return <div className={`art art--baike ${large ? 'art--large' : ''}`}><div className="baike-cover"><span className="baike-cover__book"><i/><i/><i/><b>百</b></span><span className="baike-cover__copy"><small>GAMEHUB ORIGINAL</small><strong>猜百科</strong><em>逐字揭开 · 推理标题</em></span></div><span className="art__pixel-corner" aria-hidden="true" /></div>;
  if (work.coverUrl) return <div className={`art art--cover ${large ? 'art--large' : ''}`}><img src={work.coverUrl} alt=""/><span className="art__pixel-corner" aria-hidden="true" /></div>;
  return <div className={`art art--${work.art ?? 'violet'} ${large ? 'art--large' : ''}`}><div className="art__pixel" style={{ backgroundImage: `url(${pixelCoverAtlas})` }} /><span className="art__pixel-corner" aria-hidden="true" /></div>;
}

function WorkCard({ work, go, featured = false }) {
  return <article className={`work-card ${featured ? 'work-card--featured' : ''}`}>
    <button className="card-open" onClick={() => go(`/works/${work.id}`)} aria-label={`查看 ${work.title}`}><Art work={work} large={featured} /></button>
    <div className="work-card__body"><div><span className="eyebrow">{work.tag ?? (work.kind === 'game' ? '游戏' : '创意')}</span><h3>{work.title}</h3></div><p>{work.description}</p><div className="card-meta"><span>{icons.globe} Web</span><span>{icons.play} {work.plays ?? '新作'}</span></div></div>
    <button className="round-play" onClick={() => go(`/play/${work.id}`)} aria-label={`开始玩 ${work.title}`}>{icons.play}</button>
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
    <button className="quiet-play" onClick={() => go(`/play/${work.id}`)} aria-label={`开始玩 ${work.title}`}>{icons.play}</button>
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
      <button onClick={() => go(`/play/${work.id}`)} aria-label={`开始玩 ${work.title}`}>{icons.play}<span>开始</span></button>
    </div>
  </article>;
}

function CommunityProject({ work, go }) {
  return <article className="community-project">
    <button className="community-project__art" onClick={() => go(`/works/${work.id}`)} aria-label={`查看社区项目 ${work.title}`}><Art work={work}/></button>
    <div className="community-project__copy">
      <div className="project-badges"><span>{workTag(work)}</span>{work.agentLabel && <span>{work.agentLabel}</span>}{work.repositoryUrl && <span>OPEN SOURCE</span>}</div>
      <button onClick={() => go(`/works/${work.id}`)}><strong>{work.title}</strong><small>by {work.creatorDisplayName ?? '社区作者'}</small></button>
      <p>{work.description}</p>
      <div><span>{work.estimatedMinutes ?? 3} MIN</span><span>{workPlays(work)}</span><button onClick={() => go(`/play/${work.id}`)}>{icons.play} 玩一下</button></div>
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

function DetailPage({ workId, api, demo, go }) {
  const [state, setState] = useState({ status: 'loading' });
  const [library, setLibrary] = useState(null); const [libraryBusy, setLibraryBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  useEffect(() => { let live = true; (async () => { try { const data = demo ? demoWorks.find(w => w.id === workId) : (await api.getWork(workId)).data; if (live) setState(data ? { status: 'ready', data } : { status: 'missing' }); } catch { if (live) setState({ status: 'error' }); } })(); return () => { live = false; }; }, [workId, demo]);
  useEffect(() => { let live = true; if (demo) { setLibrary({ savedAt: null }); return undefined; } api.getLibraryState(workId).then(({ data }) => { if (live) setLibrary(data); }).catch(() => {}); return () => { live = false; }; }, [workId, demo, api]);
  if (state.status === 'loading') return <main className="page"><LoadingCards /></main>;
  if (state.status !== 'ready') return <main className="page"><StatePanel title={state.status === 'missing' ? '作品不存在或已撤下' : '无法打开作品'} body="回到发现页看看其他作品。" action="返回发现" onAction={() => go('/discover')} /></main>;
  const work = state.data; const builtIn = work.id === GUESS_BAIKE_WORK_ID; const web = builtIn ? { currentReleaseId: '' } : work.targets.find(x => x.targetKey === 'web' && x.currentReleaseId);
  const toggleLibrary = async () => { setLibraryBusy(true); try { const result = demo ? { data: { savedAt: library?.savedAt ? null : new Date().toISOString() } } : library?.savedAt ? await api.removeFromLibrary(work.id) : await api.saveToLibrary(work.id); setLibrary(result.data); } catch (caught) { if (caught.status === 401) go('/account'); } finally { setLibraryBusy(false); } };
  return <main className="page detail-page"><button className="back-link" onClick={() => go('/discover')}>{icons.back} 返回发现</button><section className="detail-hero"><Art work={work} large /><div className="detail-copy"><div className="badge-row"><span className="status-badge">{icons.check} {builtIn ? 'GameHub 官方游戏' : '已验证 Web 版本'}</span><span>{work.kind === 'game' ? '游戏' : '互动作品'}</span></div><h1>{work.title}</h1><p className="detail-byline">by {work.creatorDisplayName ?? (builtIn ? 'GameHub' : '社区作者')} · 约 {work.estimatedMinutes ?? 3} 分钟{work.agentLabel ? ` · ${work.agentLabel} 共创` : ''}</p><p className="detail-lead">{work.description}</p>{!!work.tags?.length && <div className="detail-tags">{work.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}<div className="detail-actions"><Button icon={icons.play} disabled={!web} onClick={() => go(`/play/${work.id}/${web?.currentReleaseId ?? ''}`)}>立即游玩</Button><Button kind="secondary" disabled={libraryBusy} onClick={toggleLibrary}>{library?.savedAt ? '移出游戏库' : '加入游戏库'}</Button></div><p className="friendly-note">隔离运行 · 不读取项目文件与宿主凭据</p>{!builtIn && <button className="report-link" onClick={() => setReporting(true)}>举报这个作品</button>}</div></section><section className="detail-columns"><div className="panel"><span className="kicker">HOW TO PLAY</span><h2>玩法说明</h2><p>{work.instructions || '作者暂未提供额外说明。打开游戏后跟随画面提示即可。'}</p>{work.repositoryUrl && <p className="source-link"><a href={work.repositoryUrl} target="_blank" rel="noreferrer">在 GitHub 查看源码 ↗</a><small>{work.licenseSpdx} 开源许可</small></p>}</div><div className="panel facts"><span className="kicker">COMPATIBILITY</span><h2>运行信息</h2><dl><div><dt>运行方式</dt><dd>侧栏 Web</dd></div><div><dt>当前版本</dt><dd>修订 {work.revision}</dd></div><div><dt>社区数据</dt><dd>{workPlays(work)} · {work.saveCount ?? 0} 收藏</dd></div><div><dt>数据权限</dt><dd>无项目文件权限</dd></div></dl></div></section>{reporting && <ReportDialog work={work} api={api} demo={demo} go={go} onClose={() => setReporting(false)}/>}</main>;
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

function PlayerPage({ workId, releaseId, challengeCode, api, demo, go }) {
  const mount = useRef(null); const core = useRef(null); const [state, setState] = useState('loading');
  const builtIn = workId === GUESS_BAIKE_WORK_ID;
  useEffect(() => { if (!demo) api.recordPlay(workId).catch(() => {}); }, [api, demo, workId]);
  useEffect(() => { if (builtIn) { setState('running'); return undefined; } const loopback = ['127.0.0.1', 'localhost'].includes(location.hostname); core.current = new PlayerCore({ runtimeDomain: loopback ? 'localhost' : import.meta.env?.VITE_RUNTIME_DOMAIN ?? 'gamehubusercontent.example', allowLocalhost: loopback || import.meta.env?.DEV === true }); const off = core.current.onStateChanged(e => setState(e.state)); if (demo) { setState('running'); } else { api.getLaunch(workId, releaseId).then(({ data }) => core.current?.mount(mount.current, data)).catch(() => setState('error')); } return () => { off(); core.current?.dispose(); }; }, [workId, releaseId, demo, builtIn]);
  return <main className={`player-page ${builtIn ? 'player-page--guess' : ''}`}><div className="player-bar"><button className="back-link" onClick={() => go(challengeCode ? '/social' : `/works/${workId}`)}>{icons.back} 退出游戏</button><span className={`live-state live-state--${state}`}><i />{challengeCode ? '玩家挑战进行中' : builtIn ? 'GameHub 官方出品' : state === 'running' ? '正在运行' : state === 'loading' ? '正在载入' : state === 'error' ? '启动失败' : '已暂停'}</span><div>{!builtIn && <><button className="icon-button" onClick={() => state === 'hidden' ? core.current?.resume() : core.current?.hide()} aria-label="暂停或恢复">{icons.pause}</button><button className="icon-button" onClick={() => core.current?.stop()} aria-label="停止">{icons.stop}</button></>}</div></div><div className="player-stage" ref={mount}>{builtIn ? <GuessBaikeGame api={api} demo={demo} challengeCode={challengeCode}/> : demo ? <div className="demo-game"><div className="demo-planet"/><span className="kicker">DEMO SESSION</span><h1>星港漂移</h1><p>↑ ↓ ← → 驾驶 · 空格推进</p><div className="demo-track"><i/><i/><i/></div></div> : null}{state === 'error' && <StatePanel title="游戏没有成功启动" body="运行地址可能已经失效。返回详情页后再试一次。" action="返回详情" onAction={() => go(`/works/${workId}`)} />}</div></main>;
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
      <header className="settings-heading"><div className="profile-avatar"><AvatarView avatar={profile.avatar} api={api} alt="当前头像"/></div><div><span className="kicker">PLAYER PROFILE</span><h1>个人设置</h1><p>管理 GameHub 资料与这台 Agent 中的登录状态。</p></div></header>
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

function CreatorPage({ api, demo, go }) {
  const [state, setState] = useState({ status: 'loading', works: [] });
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try { const works = demo ? demoWorks.slice(0, 2) : (await api.listCreatorWorks()).data; setState({ status: 'ready', works }); }
    catch (error) { setState({ status: error.status === 401 || error.status === 403 ? 'auth' : 'error', works: [] }); }
  };
  useEffect(() => { load(); }, [demo]);
  if (state.status === 'loading') return <main className="page"><LoadingCards /></main>;
  if (state.status === 'auth') return <main className="page"><StatePanel title="登录后管理作品" body="作者操作需要当前 Harness 会话中的 GameHub 账号授权。" action="前往登录" onAction={() => go('/account')} /></main>;
  if (state.status === 'error') return <main className="page"><StatePanel title="暂时无法载入创作中心" body="API 或数据库可能还没有准备好。" action="重新连接" onAction={load} /></main>;
  const published = state.works.filter(work => work.state === 'published').length;
  const withdrawn = state.works.filter(work => work.state === 'withdrawn').length;
  const replaceWork = next => setState(current => ({ ...current, works: current.works.map(work => work.id === next.id ? { ...work, ...next, targets: next.targets?.length ? next.targets : work.targets } : work) }));
  return <main className="page creator-page"><div className="section-heading"><div><span className="kicker">CREATOR STUDIO</span><h1>我的作品</h1><p>管理当前版本、历史记录与公开状态。</p></div><Button icon="＋" onClick={() => go('/creator/works/new')}>新建作品</Button></div><div className="creator-summary"><div><span>全部作品</span><strong>{state.works.length}</strong></div><div><span>已发布</span><strong>{published}</strong></div><div><span>已撤下</span><strong>{withdrawn}</strong></div></div>{state.works.length ? <section className="creator-list">{state.works.map(work => <CreatorRow work={work} api={api} demo={demo} go={go} onChanged={replaceWork} key={work.id}/>)}</section> : <StatePanel title="还没有作品" body="新建作品后即可上传第一个 Web ZIP。" action="新建作品" onAction={() => go('/creator/works/new')} />}<aside className="creator-tip"><span>{icons.spark}</span><div><strong>发布小贴士</strong><p>撤下会立即阻止新的公开访问；历史版本仍保留，上传并通过检查的新版本可以重新发布。</p></div></aside></main>;
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

function CreatorRow({ work, api, demo, go, onChanged }) {
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
  return <div className="creator-entry"><article><Art work={{ ...work, coverUrl: coverPreview || work.coverUrl }}/><div className="creator-row__main"><h3>{work.title}</h3><p>Web · 修订 {work.revision}</p></div><span className={`status-pill ${status === '已发布' ? 'is-success' : ''} ${status === '已撤下' ? 'is-muted' : ''}`}>{status}</span><div className="creator-row-actions"><label className="cover-upload"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={coverBusy} onChange={uploadCover}/>{coverBusy ? '处理中…' : work.coverUrl ? '更换封面' : '上传封面'}</label><button className="text-button" onClick={toggleHistory}>{history.open ? '收起历史' : '版本历史'}</button><Button kind="secondary" onClick={() => go(`/creator/works/${work.id}/upload`)}>上传新版</Button>{work.state === 'published' && <button className="danger-button" disabled={withdrawing} onClick={withdraw}>{withdrawing ? '正在撤下…' : '撤下'}</button>}</div></article>{actionError && <p className="creator-action-error form-error" role="alert">{actionError}</p>}{history.open && <section className="release-history" aria-live="polite">{history.loading ? <p>正在读取版本…</p> : history.error ? <p className="form-error">{history.error}</p> : history.items.length ? <ol>{history.items.map(item => <li key={item.id}><div><strong>{item.label}</strong><small>{item.targetKey} · {item.packageType === 'web_zip' ? 'Web ZIP' : item.packageType}</small></div><span className={item.servingState === 'enabled' ? 'release-live' : ''}>{item.servingState === 'enabled' ? '当前公开' : item.validationState === 'ready' ? '已停用' : '处理中'}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p>还没有通过检查的版本。</p>}</section>}</div>;
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
  const [file, setFile] = useState(null); const [upload, setUpload] = useState(null); const [progress, setProgress] = useState(0); const [phase, setPhase] = useState('select'); const [error, setError] = useState(''); const [releaseLabel, setReleaseLabel] = useState('1.0.0'); const controller = useRef(null);
  const terminal = new Set(['succeeded', 'failed', 'expired', 'review_required']);
  const watch = async (uploadId, signal) => {
    while (!signal.aborted) {
      const { data } = await api.getUpload(uploadId, { signal }); setUpload(data);
      if (terminal.has(data.state)) { sessionStorage.removeItem(`gamehub-upload:${workId}`); setPhase(data.state === 'succeeded' ? 'done' : 'error'); if (data.state !== 'succeeded') setError(data.errorCode ? `处理未完成：${data.errorCode}` : '处理未完成，请检查文件后重试。'); return; }
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
      if (terminal.has(data.state)) { sessionStorage.removeItem(`gamehub-upload:${workId}`); setPhase(data.state === 'succeeded' ? 'done' : 'error'); return; }
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
        ({ data: created } = await api.createUpload(workId, { fileName: file.name, declaredBytes: String(file.size), sha256: digest, releaseLabel, autoPublish: true, targetKey: 'web', packageType: 'web_zip' }, { signal }));
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
  return <main className="page upload-page"><div className="upload-heading"><button className="back-link" onClick={() => go('/creator')}>{icons.back} 我的作品</button><span className="kicker">NEW RELEASE</span><h1>上传 Web 版本</h1><p>由 Harness 选择本机文件；传输与后台检查分别显示，关闭面板后可凭任务编号恢复处理状态。</p></div><div className="upload-layout"><section className="panel upload-form"><label className="file-drop"><input type="file" accept=".zip,application/zip" disabled={!['select','error'].includes(phase)} onChange={choose}/><span className="file-icon">{icons.file}</span><strong>{file?.name ?? '选择 Web ZIP'}</strong><small>{file ? `${(file.size / 1048576).toFixed(1)} MB` : 'ZIP · 最大 200 MB'}</small><em>{file ? '重新选择' : '浏览文件'}</em></label><div className="form-grid"><label>版本名称<input value={releaseLabel} disabled={phase !== 'select'} onChange={event => setReleaseLabel(event.target.value.slice(0,64))}/></label><label>目标平台<select defaultValue="web" disabled><option value="web">Web · 侧栏游玩</option></select></label></div><label className="check-row"><input type="checkbox" defaultChecked disabled/><span><strong>校验通过后自动发布</strong><small>失败时保留当前线上版本。</small></span></label>{phase === 'select' && <Button icon={icons.upload} disabled={!file || !releaseLabel} onClick={start}>开始上传</Button>}{phase === 'hashing' && <div className="processing-note"><span className="spinner"/><div><strong>正在计算文件摘要</strong><p>摘要用于确认服务端收到的字节完全一致。</p></div></div>}{phase === 'receiving' && <div className="byte-progress"><div><span>正在上传</span><strong>{progress}%</strong></div><progress value={progress} max="100"/><button onClick={() => controller.current?.abort()}>取消本机传输</button></div>}{['processing','done'].includes(phase) && <div className="processing-note"><span className={phase === 'done' ? 'success-mark' : 'spinner'}>{phase === 'done' ? icons.check : ''}</span><div><strong>{phase === 'done' ? '检查完成' : '文件已安全收到'}</strong><p>{phase === 'done' ? (upload?.publicationOutcome === 'published' ? '新版本已经发布。' : '版本已通过检查并保留为草稿。') : '正在进行结构校验；100% 字节不代表已发布。'}</p></div></div>}{error && <div className="form-error" role="alert">{error}<button onClick={() => setPhase('select')}>重新选择</button></div>}</section><aside className="panel timeline"><span className="kicker">RELEASE STATUS</span><h2>处理进度</h2><ol>{uploadSteps.slice(0,7).map(([id,label], index) => <li className={index < current ? 'is-done' : index === current ? 'is-current' : ''} key={id}><span>{index < current ? icons.check : index + 1}</span><div><strong>{label}</strong>{index === current && <small>{phase === 'error' ? '需要处理' : '当前阶段'}</small>}</div></li>)}</ol></aside></div></main>;
}

function UploadPage(props) { return props.demo ? <DemoUploadPage {...props}/> : <LiveUploadPage {...props}/>; }

function LibraryPage({ api, go, demo }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => { let live = true; (async () => { try { const data = demo ? demoWorks.slice(0,2).map((work,index) => ({ work, savedAt: index ? null : new Date().toISOString(), lastPlayedAt: new Date().toISOString(), playCount: 1 })) : (await api.listLibrary()).data; if (live) setState({ status: 'ready', items: data }); } catch (caught) { if (live) setState({ status: caught.status === 401 ? 'auth' : 'error', items: [] }); } })(); return () => { live = false; }; }, [api,demo]);
  const saved = state.items.filter(item => item.savedAt); const recent = state.items.filter(item => item.lastPlayedAt);
  return <main className="page library-page"><div className="section-heading"><div><span className="kicker">YOUR SPACE</span><h1>游戏库</h1><p>收藏和最近游玩会在登录的 Agent 之间同步。</p></div></div>{state.status === 'loading' ? <LoadingCards/> : state.status === 'auth' ? <StatePanel title="登录后同步游戏库" body="收藏与游玩记录会跟随你的 GameHub 账号。" action="前往登录" onAction={() => go('/account')}/> : state.status === 'error' ? <StatePanel title="暂时无法读取游戏库" body="连接恢复后再试一次，你的已有记录不会丢失。"/> : !state.items.length ? <StatePanel title="游戏库还是空的" body="收藏作品或开始一局，它们就会出现在这里。" action="去发现" onAction={() => go('/discover')}/> : <>{!!saved.length && <section className="library-section"><h2>已收藏</h2><div className="work-grid">{saved.map(item => <WorkCard key={item.workId} work={item.work} go={go}/>)}</div></section>}{!!recent.length && <section className="library-section"><h2>最近游玩</h2><div className="quiet-work-list">{recent.map(item => <QuietWorkRow key={item.workId} work={item.work} go={go}/>)}</div></section>}</>}</main>;
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
        const profile = { id: 'demo-user', displayName: '休息玩家', bio: '在 Agent 思考时玩一局。', visibility: 'public', avatar: demoAccountProfile.avatar, followerCount: 7, followingCount: 3, isFollowing: false, isMe: true };
        const pal = { ...profile, id: 'demo-pal', displayName: '像素搭子', isMe: false, isFollowing: true };
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
    id: 'harness', name: 'DeepSeek Harness', badge: '原生右栏', tone: 'native', state: 'npm 发布准备中',
    summary: '完整 GameHub 客户端内置在 Harness 右栏，登录、发现、游玩和发布都不离开 Agent。',
    command: 'npx @deepseek-ai/dsh plugin --profile web add gamehub-dsh-plugin',
    update: 'npx @deepseek-ai/dsh plugin --profile web update gamehub-dsh-plugin',
    prompt: '请在获得我的确认后，把 gamehub-dsh-plugin 安装到 DeepSeek Harness 的 web profile；安装后检查结果，并提醒我重启 dsh web。',
  },
  {
    id: 'vscode', name: 'VS Code', badge: '原生侧栏', tone: 'native', state: 'VSIX 发布准备中',
    summary: '通过 Activity Bar 打开 GameHub，令牌保存在编辑器 SecretStorage，不读取工作区文件。',
    command: 'code --install-extension gamehub-agent.vsix',
    prompt: '请在获得我的确认后安装 GameHub VSIX，验证扩展已启用，并告诉我如何在 Activity Bar 打开 GameHub。',
  },
  {
    id: 'cursor', name: 'Cursor', badge: '原生侧栏', tone: 'native', state: '复用 VSIX',
    summary: '与 VS Code 共用扩展，运行时自动识别 Cursor，并跟随编辑器主题。',
    command: 'cursor --install-extension gamehub-agent.vsix',
    prompt: '请在获得我的确认后为 Cursor 安装 GameHub VSIX，验证扩展已启用，并告诉我如何打开 GameHub 侧栏。',
  },
  {
    id: 'windsurf', name: 'Windsurf', badge: '优先内置', tone: 'testing', state: '兼容性验证中',
    summary: '优先复用 VS Code 扩展；若宿主 Webview 或密钥存储不兼容，则安全回退浏览器。',
    prompt: '请检查当前 Windsurf 是否支持安装 VSIX；支持时在获得我的确认后安装 GameHub，否则打开 https://mooyu.fun。',
  },
  {
    id: 'codex', name: 'Codex / ChatGPT', badge: 'Plugin + MCP App', tone: 'building', state: '开发中',
    summary: '使用可安装插件连接 GameHub MCP，并以 MCP App 提供原生交互界面；未安装时回退网页版。',
    prompt: '请检查插件目录中是否已有 GameHub。若可用，请先向我说明权限并等待确认后安装；否则打开 https://mooyu.fun。',
  },
  {
    id: 'claude', name: 'Claude Code', badge: 'Agent Plugin', tone: 'building', state: '开发中',
    summary: '共享可移植技能与 MCP 能力；宿主没有可用游戏面板时在浏览器中启动。',
    prompt: '请检查是否可以安装 GameHub Agent Plugin；安装前先向我说明权限并等待确认，否则打开 https://mooyu.fun。',
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
    {target.update && <details><summary>更新命令</summary><div className="agent-command"><code>{target.update}</code><button onClick={() => onCopy(target.update, `${target.id}-update`)}>{copied === `${target.id}-update` ? '已复制' : '复制'}</button></div></details>}
    <div className="agent-install-card__actions"><button onClick={() => onCopy(target.prompt, `${target.id}-prompt`)}>{copied === `${target.id}-prompt` ? '提示词已复制' : '让 Agent 帮我安装'}</button><button onClick={onOpen}>先用网页版</button></div>
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
      <div><span className="kicker">GAMEHUB EVERYWHERE</span><h1>添加到你的 Agent</h1><p>能安全内置就留在 Agent 里；宿主没有稳定界面能力时，再打开浏览器。账号、游戏库和作品数据保持一致。</p></div>
      <div className="install-detected"><span>当前环境</span><strong>{hostIdentity.label}</strong><small>{detected ? `${detected.badge} · ${detected.state}` : '使用网页版'}</small></div>
    </section>
    <section className="install-principles" aria-label="接入原则"><div><b>01</b><strong>原生优先</strong><span>右栏、侧栏或 MCP App</span></div><div><b>02</b><strong>最小权限</strong><span>不读取项目与宿主凭据</span></div><div><b>03</b><strong>始终可用</strong><span>不支持内置时回退网页</span></div></section>
    {detected && <section className="install-recommended"><span>为当前宿主推荐</span><AgentInstallCard target={detected} copied={copied} onCopy={copy} onOpen={() => go('/discover')}/></section>}
    <section className="install-catalog"><div className="section-heading"><div><h2>选择你的 Agent</h2><p>安装入口会随着各宿主完成验证逐步开放。</p></div></div><div className="agent-install-grid">{agentInstallTargets.filter(item => item.id !== detected?.id).map(target => <AgentInstallCard key={target.id} target={target} copied={copied} onCopy={copy} onOpen={() => go('/discover')}/>)}</div></section>
    <section className="install-security"><div><span className="kicker">BEFORE YOU INSTALL</span><h2>安装前会发生什么</h2></div><ul><li>插件安装或执行命令前，应由 Agent 向你请求确认。</li><li>GameHub 登录令牌只进入宿主提供的安全存储；游戏 iframe 不可访问。</li><li>所有尚未验证的宿主都明确标记，不会伪装成已经可用。</li></ul></section>
  </main>;
}


function AdminPage({ api, demo, go }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const demoPuzzles = [{ id: 'wikipedia-4723', title: '足球', aliases: ['协会足球','英式足球'], category: '体育', sourceKind: 'wikipedia-lead', sourceTitle: '足球', sourceUrl: 'https://zh.wikipedia.org/wiki/%E8%B6%B3%E7%90%83', sourceRevision: 94245396, sourceUpdatedAt: '2026-09-27T15:22:05Z', license: 'CC BY-SA 4.0', introHanCount: 364, content: '足球主要专指英式足球，官方名为协会足球，是一种世界流行的团体球类运动。', status: 'ready', qualityReason: null, scheduledDates: [today] }];
  const demoAutomation = { enabled: true, running: false, intervalMinutes: 360, batchSize: 20, scheduleDays: 14, readyCount: 18, scheduledCount: 14, lastRun: { status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), fetchedCount: 20, acceptedCount: 7, scheduledCount: 4, errorCode: null, errorMessage: null } };
  const [state, setState] = useState({ status: 'loading', reports: [], audit: [], puzzles: [], automation: null });
  const [notes, setNotes] = useState({}); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try {
      if (demo) return setState({ status: 'ready', reports: [], audit: [], puzzles: demoPuzzles, automation: demoAutomation });
      const profile = (await api.getProfile()).data;
      if (profile.role !== 'admin') return setState({ status: 'forbidden', reports: [], audit: [], puzzles: [], automation: null });
      const [reports, audit, puzzles, automation] = await Promise.all([api.listReports('open'), api.listModerationAudit(), api.listAdminGuessBaikePuzzles(), api.getGuessBaikeAutomationStatus()]);
      setState({ status: 'ready', reports: reports.data, audit: audit.data, puzzles: puzzles.data, automation: automation.data });
    } catch (caught) { setState({ status: caught.status === 401 || caught.status === 403 ? 'forbidden' : 'error', reports: [], audit: [], puzzles: [], automation: null }); }
  };
  useEffect(() => { load(); }, [api, demo]);
  const decide = async (report, action) => {
    const note = (notes[report.id] || '').trim(); if (!note) return setError('请先填写处置说明。');
    if (action === 'suspend' && !globalThis.confirm?.(`暂停《${report.workTitle}》？当前公开版本将立即失效。`)) return;
    setBusy(report.id); setError('');
    try { await api.decideReport(report.id, { action, note }); await load(); }
    catch (caught) { setError(caught.message || '处置未完成。'); }
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
  return <main className="page admin-page"><div className="section-heading"><div><span className="kicker">OPERATIONS DESK</span><h1>平台运营</h1><p>管理官方日题、内容质量与举报处置。</p></div><span className="admin-count">{state.puzzles.filter(item => item.status === 'ready').length} 道可发布 · {state.reports.length} 条举报</span></div>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="admin-notice" role="status">{notice}</p>}
    {state.automation && <section className={`automation-health automation-health--${state.automation.lastRun?.status || 'idle'}`}><div className="automation-health__pulse"/><div><span className="kicker">AUTONOMOUS SUPPLY</span><h2>{state.automation.running ? '正在自动补充题库' : state.automation.lastRun?.status === 'failed' ? '最近一次同步失败，库存仍可用' : '全自动内容流水线正常'}</h2><p>每 {Math.round(state.automation.intervalMinutes / 60)} 小时自动抓取、筛选、去重，并补齐未来 {state.automation.scheduleDays} 天。无需人工审核或排期。</p>{state.automation.lastRun?.errorMessage && <small>{state.automation.lastRun.errorCode} · {state.automation.lastRun.errorMessage}</small>}</div><dl><div><dt>可用题</dt><dd>{state.automation.readyCount}</dd></div><div><dt>已排期</dt><dd>{state.automation.scheduledCount}/{state.automation.scheduleDays}</dd></div><div><dt>上次通过</dt><dd>{state.automation.lastRun?.acceptedCount ?? '—'}</dd></div></dl></section>}
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
  const [route, go] = useRoute(routing); const [themeMode, setThemeModeState] = useState('dark'); const [hostIdentity, setHostIdentity] = useState(hostIdentities.browser); const [accountProfile, setAccountProfile] = useState(() => demo ? demoAccountProfile : null); const themeRoot = useRef(null);
  useEffect(() => { let live = true; host.getCapabilities().then(capabilities => { if (live) setHostIdentity(resolveHostIdentity(capabilities)); }); return () => { live = false; }; }, [host]);
  useEffect(() => { let live = true; const apply = theme => { if (!live || !themeRoot.current) return; setThemeModeState(theme.mode); applyThemeTokens(themeRoot.current, theme); }; host.theme.getTheme().then(apply); const off = host.theme.onThemeChanged(apply); return () => { live = false; off(); }; }, [host]);
  useEffect(() => { if (demo) return undefined; let live = true; api.getProfile().then(({ data }) => { if (live) setAccountProfile(data); }).catch(() => {}); return () => { live = false; }; }, [api, demo]);
  const setThemeMode = mode => host.theme.setPreference?.(mode);
  let content; const parts = route.split('/').filter(Boolean);
  if (parts[0] === 'works' && parts[1]) content = <DetailPage workId={parts[1]} api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'play' && parts[1]) content = <PlayerPage workId={parts[1]} releaseId={parts[2] === 'challenge' ? null : parts[2]} challengeCode={parts[2] === 'challenge' ? parts[3] : null} api={api} demo={demo} go={go}/>;
  else if (route === '/account') content = <AccountPage api={api} host={host} demo={demo} go={go} themeMode={themeMode} setThemeMode={setThemeMode} canChangeTheme={typeof host.theme.setPreference === 'function'} hostIdentity={hostIdentity} onProfileChange={setAccountProfile}/>;
  else if (route === '/creator/works/new') content = <NewWorkPage api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'creator' && parts[2] && parts[3] === 'upload') content = <UploadPage workId={parts[2]} api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'creator') content = <CreatorPage api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'admin') content = <AdminPage api={api} demo={demo} go={go}/>;
  else if (route === '/install') content = <InstallPage go={go} hostIdentity={hostIdentity}/>;
  else if (route === '/library') content = <LibraryPage api={api} go={go} demo={demo}/>;
  else if (route === '/social') content = <SocialPage api={api} go={go} demo={demo}/>;
  else if (parts[0] === 'challenge' && parts[1]) content = <ChallengePage api={api} go={go} demo={demo} code={parts[1]}/>;
  else content = <DiscoverPage api={api} demo={demo} go={go} hostIdentity={hostIdentity}/>;
  const player = parts[0] === 'play';
  return <div ref={themeRoot} className={`app ${player ? 'app--player' : ''}`} data-host={hostIdentity.id}>{!player && <Header route={route} go={go} themeMode={themeMode} setThemeMode={setThemeMode} canChangeTheme={typeof host.theme.setPreference === 'function'} hostIdentity={hostIdentity} accountProfile={accountProfile} api={api}/>} {!player && <MobileNav route={route} go={go}/>}<div className="ambient" aria-hidden="true"/>{content}<div className="notice-region" aria-live="polite"/></div>;
}
