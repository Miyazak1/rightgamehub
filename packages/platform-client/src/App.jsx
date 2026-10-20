import {COMMUNITY_ENABLED,visiblePlatformRoute} from './community-availability.mjs';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { applyThemeTokens, createBrowserHostAdapter } from '@gamehub/host-contract';
import { createApiClient } from '@gamehub/platform-api-client';
import { promptFileExport } from './file-export-prompt.mjs';
import { GameSharePage } from './GameSharePage.jsx';
import { PlayerCore } from '@gamehub/player-core';
import { demoUploads, demoWorks } from './demo.mjs';
import pixelCoverAtlas from './assets/game-covers-pixel-v1-optimized.png';
import avatarAtlas from './assets/avatar-atlas-pixel-v1.png';
import GuessBaikeGame from './GuessBaikeGame.jsx';
import { formatBytes, isUploadTerminalState, uploadDisplay } from './upload-display.mjs';
import { UploadStatusNote, UploadTimeline } from './UploadStatus.jsx';
import { createWebGameHost } from './web-game-host.mjs';
import CloudSaveStatus from './CloudSaveStatus.jsx';
import SaveManager from './SaveManager.jsx';
import CommunityPage from './CommunityPage.jsx';
import { CommunityShell } from './CommunityShell.jsx';
import CommunityProjects from './CommunityProjects.jsx';
import CommunityEvents from './CommunityEvents.jsx';
import CommunityParties from './CommunityParties.jsx';
import CommunityHome from './CommunityHome.jsx';
import CommunityParticipation from './CommunityParticipation.jsx';
import DiscoverPage from './DiscoverPage.jsx';
import LearningPage from './LearningPage.jsx';
import {OfficialToolHost,ToolsPage} from './ToolsPage.jsx';
import WorkLeaderboard from './WorkLeaderboard.jsx';
import CompetitionDeveloperCenter from './CompetitionDeveloperCenter.jsx';
import CreatorAiTaskPage from './CreatorAiTaskPage.jsx';
import WorkEditPage from './WorkEditPage.jsx';
import DevelopmentLogPage from './DevelopmentLogPage.jsx';
import {DiscoveryCampaignAdmin,DiscoveryCampaignPage} from './DiscoveryCampaigns.jsx';
import GrowthContentStudio from './GrowthContentStudio.jsx';
import AuthorOutreachQueue from './AuthorOutreachQueue.jsx';
import { AccountMenu, CreatorWorkspace, PlayerNavigation } from './PlatformNavigation.jsx';
import WorkMetadataFields from './WorkMetadataFields.jsx';
import { workMetadataForm, workMetadataPayload } from './work-metadata.mjs';
import { workLeaderboardPath } from './work-leaderboards.mjs';
import { browserPathForRoute, embeddedBrowserPathForRoute, consumePublicWorkHandoff, navigateBrowserRoute, readBrowserRoute } from './public-work-route.mjs';
import { resolveAuthClientKind } from './auth-client-kind.mjs';

export { createBrowserHostAdapter };
import { attributedWorkUrl, captureWorkAttribution, getWorkAttribution } from './analytics-attribution.mjs';
import { enqueueAnalytics } from './analytics-delivery.mjs';
const decodeRouteValue = value => { try { return decodeURIComponent(value||''); } catch { return value||''; } };

import { playerRuntimeOptions } from './player-runtime-options.mjs';
import MultiplayerDeveloperCenter from './MultiplayerDeveloperCenter.jsx';
import MultiplayerRuleSubmissionPage from './MultiplayerRuleSubmissionPage.jsx';
import MultiplayerRuleReviewQueue from './MultiplayerRuleReviewQueue.jsx';
import { ContributionCenterPage, CreateContributionTaskForm, CreatorContributionTasks } from './ContributionCenter.jsx';
import { I18nProvider, LanguageSwitch, useI18n } from './I18n.jsx';

const icons = {
  discover: '✦', library: '▣', social: '✣', creator: '◇', account: '○', search: '⌕', play: '▶', back: '←', upload: '↑', check: '✓', dot: '•', spark: '✦', settings: '⚙', close: '×', file: '▤', globe: '◎', pause: 'Ⅱ', stop: '■', refresh: '↻',
};

const hostIdentities = {
  browser: { id: 'browser', label: 'Web', short: 'WEB' },
  'mcp-app': { id: 'mcp-app', label: 'MCP App', short: 'MCP' },
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
  return ({ discover: 'discover', learn: 'learning', tools: 'tools', library: 'library', social: 'social', community: 'social', contribute: 'social', creator: 'creator', admin: 'admin', works: 'work', play: 'play', account: 'auth', install: 'settings', u: 'profile' })[head] ?? 'unknown';
};
const emitAnalytics = (api, hostKind, event, demo = false) => {
  if (demo || !api?.trackAnalytics) return;
  const identity = analyticsIdentity();
  if (!identity.anonymousId || !identity.sessionId) return;
  const attribution = event.workId ? getWorkAttribution(event.workId) : {};
  void enqueueAnalytics(api, [{ ...identity, hostKind: hostKind || 'unknown', occurredAt: new Date().toISOString(), ...attribution, ...event }]);
};

function resolveHostIdentity(capabilities = {}) {
  const id = String(capabilities.host || 'browser').toLowerCase();
  return hostIdentities[id] ?? { id, label: capabilities.host || 'Agent', short: id.slice(0, 3).toUpperCase() };
}

function useRoute(mode) {
  const [path, setPath] = useState(() => visiblePlatformRoute(readBrowserRoute(mode, location)));
  useEffect(() => {
    if (mode === 'memory') return undefined;
    const onNavigation = () => {
      consumePublicWorkHandoff(location, history);
      const incoming=readBrowserRoute(mode, location),next=visiblePlatformRoute(incoming);
      if(next!==incoming)history.replaceState(history.state??null,'',mode==='embedded'?embeddedBrowserPathForRoute(next,location):browserPathForRoute(next,location));
      setPath(next);
    };
    onNavigation();
    addEventListener('hashchange', onNavigation);
    addEventListener('popstate', onNavigation);
    return () => { removeEventListener('hashchange', onNavigation); removeEventListener('popstate', onNavigation); };
  }, [mode]);
  useEffect(() => { globalThis.scrollTo?.({ top: 0, left: 0, behavior: 'instant' }); }, [path]);
  const go = next => navigateBrowserRoute(mode, visiblePlatformRoute(next), location, history, setPath);
  return [path, go];
}

function Button({ children, kind = 'primary', icon, className = '', ...props }) {
  return <button className={`button button--${kind} ${className}`} {...props}>{icon && <span aria-hidden="true">{icon}</span>}<span>{children}</span></button>;
}

function DownloadLink({ children, href, fileName, onClick }) {
  return <a className="button button--primary" href={href} download={fileName || undefined} onClick={onClick}><span aria-hidden="true">↓</span><span>{children}</span></a>;
}

function Logo() {
  const { t } = useI18n();
  return <div className="logo" aria-label={t('brand.aria')}><span className="logo__mark" aria-hidden="true"><svg viewBox="0 0 24 24" shapeRendering="crispEdges"><path className="mooyu-mark__body" d="M9 3h6v2h2v2h2v2h2v6h-2v2h-3v-4h-2v5h-4v-5H8v4H5v-2H3V9h2V7h2V5h2V3Z"/><path className="mooyu-mark__eye" d="M8 9h3v3H8zm6 0h3v3h-3z"/><path className="mooyu-mark__pupil" d="M9 10h1v1H9zm6 0h1v1h-1z"/></svg></span><span>{t('brand.primary')}<span>{t('brand.accent')}</span></span></div>;
}

function GitHubLogo() {
  return <svg className="github-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.2c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.04 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.29-5.28-1.29-5.28-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.9 10.9 0 0 1 12 5.94c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.78 1.07.78 2.16v3.21c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>;
}

function ShareIcon() {
  return <svg className="gamehub-action-icon gamehub-share-icon" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges"><path d="M5 7 11 4M5 9l6 3" fill="none" stroke="currentColor" strokeWidth="1.5"/><path fill="currentColor" d="M1 6h5v5H1zm10-5h4v5h-4zm0 9h4v5h-4z"/><path fill="var(--gh-raised)" d="M3 8h1v1H3zm10-5h1v1h-1zm0 9h1v1h-1z"/></svg>;
}

function LinkIcon() {
  return <svg className="gamehub-action-icon" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges"><path d="M6 5H4a3 3 0 0 0 0 6h3M10 5h2a3 3 0 0 1 0 6H9M5 8h6" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

function ImageIcon() {
  return <svg className="gamehub-action-icon" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges"><path fill="currentColor" d="M1 2h14v12H1zm2 2v7l3-3 2 2 2-3 3 4V4z"/><path fill="var(--gh-raised)" d="M10 5h2v2h-2z"/></svg>;
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

function Header({ route, go, themeMode, setThemeMode, canChangeTheme, hostIdentity, accountProfile, accountStatus, api }) {
  const { t } = useI18n();
  const creator = route === '/creator' || route.startsWith('/creator/');
  return <header className="header">
    <button className="brand-button" onClick={() => go('/discover')}><Logo /></button>
    {creator ? <span className="header__workspace-label">{t('navigation.creatorSpace')}</span> : <PlayerNavigation route={route} go={go}/>}
    <div className="header__tools">
      <button className="header-agent-cta" aria-current={route === '/install' ? 'page' : undefined} onClick={() => go('/install')}>{t('navigation.addAgent')}</button>
      <div className="host-chip" aria-label={t('navigation.hostCurrent',{host:hostIdentity.label})} title={t('navigation.hostTheme',{host:hostIdentity.label})}><span className="host-mark" aria-hidden="true">{hostIdentity.short}</span><span>{hostIdentity.label}</span></div>
      <LanguageSwitch />
      <button className="icon-button" disabled={!canChangeTheme} onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : themeMode === 'light' ? 'high-contrast' : 'dark')} aria-label={t(canChangeTheme?'navigation.themeSwitch':'navigation.themeFollowing',{theme:themeMode})} title={canChangeTheme?t('navigation.switchTheme'):t('navigation.hostTheme',{host:hostIdentity.label})}>{themeMode === 'light' ? '☼' : themeMode === 'high-contrast' ? '◐' : '☾'}</button>
      <AccountMenu route={route} go={go} profile={accountProfile} status={accountStatus} avatar={<AvatarView avatar={accountProfile?.avatar} api={api} alt=""/>}/>
    </div>
  </header>;
}

function Art({ work, large = false }) {
  const {t}=useI18n();
  if (work.id === GUESS_BAIKE_WORK_ID || work.art === 'baike') return <div className={`art art--baike ${large ? 'art--large' : ''}`}><div className="baike-cover"><span className="baike-cover__book"><i/><i/><i/><b>百</b></span><span className="baike-cover__copy"><small>MOOYU.FUN ORIGINAL</small><strong>{t('guess.name')}</strong><em>{t('guess.coverTagline')}</em></span></div><span className="art__pixel-corner" aria-hidden="true" /></div>;
  if (work.coverUrl) return <div className={`art art--cover ${large ? 'art--large' : ''}`}><img src={work.coverUrl} alt=""/><span className="art__pixel-corner" aria-hidden="true" /></div>;
  if(!work.art)return <div className={`art art--placeholder ${large?'art--large':''}`}><span className="art__placeholder-mark" aria-hidden="true">✦</span><span className="art__placeholder-label">MOOYU.FUN</span></div>;
  const [x,y]=({violet:[0,0],cyan:[256,0],lime:[0,256],orange:[256,256]})[work.art]||[0,0];
  return <div className={`art art--${work.art} ${large ? 'art--large' : ''}`}><svg className="art__atlas" viewBox={`${x} ${y} 256 256`} preserveAspectRatio="xMidYMid slice" aria-hidden="true"><image href={pixelCoverAtlas} width="512" height="512"/></svg><span className="art__pixel-corner" aria-hidden="true" /></div>;
}

const workHasWebRelease = work => work.id === GUESS_BAIKE_WORK_ID || work.targets?.some(target => target.targetKey === 'web' && target.currentReleaseId);
const workHasWindowsRelease = work => work.targets?.some(target => target.targetKey === 'windows-x64' && target.currentReleaseId);
const workActionPath = work => workHasWebRelease(work) ? `/play/${work.id}` : `/works/${work.id}`;
const workPlatformLabel = (work,t) => workHasWebRelease(work) ? 'Web' : workHasWindowsRelease(work) ? 'Windows' : t('discover.details');

function WorkCard({ work, go, featured = false }) {
  const { t, number } = useI18n();
  return <article className={`work-card ${featured ? 'work-card--featured' : ''}`}>
    <button className="card-open" onClick={() => go(`/works/${work.id}`)} aria-label={t('discover.view',{title:work.title})}><Art work={work} large={featured} /></button>
    <div className="work-card__body"><div><span className="eyebrow">{work.tag ?? t(work.kind === 'game' ? 'discover.game' : work.kind === 'courseware' ? 'discover.courseware' : 'discover.creative')}</span><h3>{work.title}</h3>{work.creatorHandle && <button className="creator-profile-link" onClick={() => go(`/u/${work.creatorHandle}`)}>by {work.creatorDisplayName ?? t('common.communityAuthor')}</button>}</div><p>{work.description}</p><div className="card-meta"><span>{icons.globe} {workPlatformLabel(work,t)}</span><span>{icons.play} {work.plays ?? (work.playCount?t('detail.plays',{count:Number(work.playCount),formatted:number(work.playCount)}):t('common.newWork'))}</span></div></div>
    <button className="round-play" onClick={() => go(workActionPath(work))} aria-label={t(workHasWebRelease(work)?'discover.startAria':'discover.windowsAria',{title:work.title})}>{icons.play}</button>
  </article>;
}

const workTag = (work,t) => work.tags?.[0] ?? work.tag ?? t(work.kind === 'game' ? 'discover.game' : work.kind === 'tool' ? 'discover.tool' : work.kind === 'courseware' ? 'discover.courseware' : 'discover.creative');
function QuietWorkRow({ work, go }) {
  const { t } = useI18n();
  return <article className="quiet-work-row">
    <button className="quiet-work-row__main" onClick={() => go(`/works/${work.id}`)} aria-label={t('discover.view',{title:work.title})}>
      <Art work={work} />
      <span className="quiet-work-row__copy"><strong>{work.title}</strong><small>{workTag(work,t)} · {t('discover.minutesMeta',{count:work.estimatedMinutes??3})} · {work.creatorDisplayName ?? t('common.communityAuthor')}</small></span>
    </button>
    <button className="quiet-play" onClick={() => go(workActionPath(work))} aria-label={t(workHasWebRelease(work)?'discover.startAria':'discover.windowsAria',{title:work.title})}>{icons.play}</button>
  </article>;
}

function LoadingCards() {
  const { t } = useI18n();
  return <div className="work-grid" aria-label={t('common.loadingWorks')}>{[1,2,3,4].map(x => <div className="skeleton-card" key={x}><span /><i /><i /></div>)}</div>;
}

function StatePanel({ title, body, action, onAction }) { return <div className="state-panel"><span>{icons.spark}</span><h3>{title}</h3><p>{body}</p>{action && <Button kind="secondary" onClick={onAction}>{action}</Button>}</div>; }

function WorkProvenance({work,claim,accountProfile,onClaim,go}) {
  const { t } = useI18n();
  if(!claim)return null;
  const labels={
    publisher:t(claim.ingestionMethod==='platform'?'provenance.publisher.platform':claim.ingestionMethod==='github_import'?'provenance.publisher.github':'provenance.publisher.upload'),
    unclaimed:t('provenance.status.unclaimed'),pending:t('provenance.status.pending'),verified:t('provenance.status.verified'),disputed:t('provenance.status.disputed'),suspended:t('provenance.status.suspended'),rejected:t('provenance.status.rejected'),cancelled:t('provenance.status.cancelled'),revoked:t('provenance.status.revoked'),
  };
  const sourceText=work.repositoryUrl?(work.openSource?t('provenance.openLicense',{license:work.licenseSpdx}):work.licenseSpdx?t('provenance.pendingLicense',{license:work.licenseSpdx}):t('provenance.noLicense')):claim.attributionKind==='community_catalog'?t('provenance.catalogOnly'):t('provenance.noRepository');
  const commitUrl=work.repositoryUrl&&work.sourceCommitSha?work.repositoryUrl.replace(/\/$/,'')+'/commit/'+work.sourceCommitSha:null;
  return <><div className="source-link work-provenance"><div>{work.repositoryUrl?<a href={work.repositoryUrl} target="_blank" rel="noreferrer">{t('provenance.viewRepository')} ↗</a>:<strong>{t('provenance.heading')}</strong>}<small>{sourceText}</small>{commitUrl&&<a className="work-provenance__commit" href={commitUrl} target="_blank" rel="noreferrer" title={work.sourceCommitSha}>{t('provenance.pinnedCommit',{sha:work.sourceCommitSha.slice(0,7)})} ↗</a>}</div><div className={`claim-state is-${claim.status}`}><strong>{labels[claim.status]||t('provenance.status.unknown')}</strong>{claim.status==='verified'&&claim.claimantDisplayName&&<small>{claim.claimantDisplayName}</small>}{claim.eligible&&claim.status==='unclaimed'&&<button type="button" onClick={()=>accountProfile?onClaim():go('/account')}>{t('provenance.claimAction')}</button>}</div></div>{work.remixSource&&<aside className="work-remix-source"><span>REMIX SOURCE</span><button type="button" disabled={!work.remixSource.available} onClick={()=>go(`/works/${work.remixSource.workId}`)}>{t('provenance.remixOf',{title:work.remixSource.title||t('provenance.sourceWork')})} →</button><p>{work.remixNote}</p><small>{work.remixSource.licenseSpdx}{work.remixSource.creatorDisplayName?` · ${t('provenance.originalCreator',{name:work.remixSource.creatorDisplayName})}`:''}{!work.remixSource.available?` · ${t('provenance.sourceUnavailable')}`:''}</small></aside>}</>;
}

function WorkRemixes({items,go}) {
  const { t } = useI18n();
  if(!items.length)return null;
  return <section className="work-remixes"><div className="section-heading"><div><span className="kicker">COMMUNITY REMIXES</span><h2>{t('remix.title')}</h2><p>{t('remix.lead')}</p></div></div><div className="work-remixes__grid">{items.map(item=><button type="button" key={item.id} onClick={()=>go(`/works/${item.id}`)}><Art work={item}/><span><strong>{item.title}</strong><small>{item.creatorDisplayName} · {item.licenseSpdx||t('remix.sourceRecorded')}</small><p>{item.description}</p></span></button>)}</div></section>;
}

const developmentKindLabels = { update: 'timeline.kind.update', release_notes: 'timeline.kind.releaseNotes', milestone: 'timeline.kind.milestone' };
function WorkTimeline({items,go}) {
  const { t, date } = useI18n();
  if(!items.length)return null;
  return <section className="work-development"><div className="section-heading"><div><span className="kicker">DEVELOPMENT TIMELINE</span><h2>{t('timeline.title')}</h2><p>{t('timeline.lead')}</p></div></div><ol className="work-development__list">{items.map(item=><li key={`${item.type}:${item.id}`}><span className="work-development__marker" aria-hidden="true">{item.type==='contribution_completed'?'✓':'·'}</span><article><header><div><span>{item.type==='contribution_completed'?t('timeline.communityContribution'):t(developmentKindLabels[item.entryKind]||'timeline.developmentRecord')}</span><h3>{item.title}</h3></div><time>{date(item.occurredAt,{dateStyle:'medium'})}</time></header><p>{item.body}</p><footer><span>{item.type==='contribution_completed'?t('timeline.contributionCompleted',{name:item.contributorDisplayName}):t('timeline.publishedBy',{name:item.authorDisplayName})}</span>{item.release&&<small>{t('timeline.linkedRelease',{label:item.release.label,target:item.release.targetKey})}{item.release.available?'':` · ${t('timeline.disabled')}`}</small>}{COMMUNITY_ENABLED&&item.contributionTaskId&&<button type="button" className="text-button" onClick={()=>go(`/contribute/${item.contributionTaskId}`)}>{t('timeline.viewTask')} →</button>}</footer></article></li>)}</ol></section>;
}

function WorkShareDialog({work,api,onClose}) {
  const { t, locale } = useI18n();
  const [notice,setNotice]=useState('');
  const url=`${PUBLIC_GAMEHUB_URL}/w/${encodeURIComponent(work.id)}`;
  const copyUrl=attributedWorkUrl(url,'share_copy');
  const systemUrl=attributedWorkUrl(url,'share_system');
  const shareCardUrl=api?.workShareCardUrl?.(work.id,{version:work.revision,locale})??`${PUBLIC_GAMEHUB_URL}/v1/works/${encodeURIComponent(work.id)}/share-card.png?v=${encodeURIComponent(work.revision||'1')}&lang=${encodeURIComponent(locale)}`;
  const shareCardDownloadUrl=api?.workShareCardUrl?.(work.id,{version:work.revision,locale,download:true})??`${shareCardUrl}&download=1`;
  const copy=async()=>{
    try{
      if(!globalThis.navigator?.clipboard?.writeText)throw new Error('clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(copyUrl);
      setNotice(t('share.copied'));
    }catch{globalThis.prompt?.(t('share.copyPrompt'),copyUrl);}
  };
  const share=async()=>{
    if(!globalThis.navigator?.share)return copy();
    try{await globalThis.navigator.share({title:work.title,text:t('share.text',{title:work.title}),url:systemUrl});setNotice(t('share.opened'));}
    catch(error){if(error?.name!=='AbortError')setNotice(t('share.unavailable'));}
  };
  return <div className="modal-backdrop" role="presentation" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><section className="work-share-dialog" role="dialog" aria-modal="true" aria-labelledby="work-share-title"><button type="button" className="modal-close" onClick={onClose} aria-label={t('share.close')}>×</button><span className="kicker">SHARE THIS GAME</span><h2 id="work-share-title">{t('share.title',{title:work.title})}</h2><p>{t('share.lead')}</p><img className="work-share-preview" src={shareCardUrl} alt={t('share.previewAlt',{title:work.title})}/><div className="work-share-url"><LinkIcon/><span>{url}</span></div><div className="work-share-actions"><Button icon={<ShareIcon/>} onClick={share}>{globalThis.navigator?.share?t('share.system'):t('share.copy')}</Button>{globalThis.navigator?.share&&<Button kind="secondary" icon={<LinkIcon/>} onClick={copy}>{t('share.copy')}</Button>}<a className="button button--secondary" href={shareCardDownloadUrl} download={`mooyu-${work.id}-share.png`}><span aria-hidden="true"><ImageIcon/></span><span>{t('share.download')}</span></a></div>{notice&&<p className="work-share-notice" role="status">{notice}</p>}</section></div>;
}

function DetailPage({ workId, api, host, hostKind, demo, go, accountProfile, boardDate, boardPuzzleId, focusBoard }) {
  const { t, number } = useI18n();
  const [state, setState] = useState({ status: 'loading' });
  const [remixes,setRemixes]=useState([]);
  const [timeline,setTimeline]=useState([]);
  const [library, setLibrary] = useState(null); const [libraryBusy, setLibraryBusy] = useState(false);
  const [reporting, setReporting] = useState(false); const [feedbackOpen, setFeedbackOpen] = useState(false); const [claimOpen, setClaimOpen] = useState(false); const [shareOpen,setShareOpen]=useState(false); const [claim, setClaim] = useState(null); const [nativeBusy, setNativeBusy] = useState(false); const [nativeMessage, setNativeMessage] = useState(''); const [nativeDownload, setNativeDownload] = useState({ phase: 'idle', percent: 0 });
  useEffect(() => { let live = true; (async () => { try { const data = demo ? demoWorks.find(w => w.id === workId) : (await api.getWork(workId)).data; if (live) setState(data ? { status: 'ready', data } : { status: 'missing' }); } catch { if (live) setState({ status: 'error' }); } })(); return () => { live = false; }; }, [workId, demo]);
  useEffect(() => { let live = true; if (demo) { setLibrary({ savedAt: null }); return undefined; } api.getLibraryState(workId).then(({ data }) => { if (live) setLibrary(data); }).catch(() => {}); return () => { live = false; }; }, [workId, demo, api]);
  useEffect(() => { let live=true; if(demo){setClaim({workId,ingestionMethod:'zip_upload',attributionKind:'community_catalog',eligible:true,status:'unclaimed'});return undefined;} api.getPublicProjectClaim(workId).then(({data})=>{if(live)setClaim(data);}).catch(()=>{if(live)setClaim(null);}); return()=>{live=false;}; },[workId,demo,api]);
  useEffect(()=>{let live=true;(demo?Promise.resolve({data:[]}):api.listWorkRemixes(workId)).then(({data})=>{if(live)setRemixes(data);}).catch(()=>{if(live)setRemixes([]);});return()=>{live=false;};},[workId,demo,api]);
  useEffect(()=>{let live=true;(demo?Promise.resolve({data:[]}):api.listWorkTimeline(workId)).then(({data})=>{if(live)setTimeline(data);}).catch(()=>{if(live)setTimeline([]);});return()=>{live=false;};},[workId,demo,api]);
  useEffect(() => { if (state.status === 'ready' && hostKind) { captureWorkAttribution(workId); emitAnalytics(api, hostKind, { type: 'work_view', route: 'work', workId }, demo); } }, [state.status, workId, api, hostKind, demo]);
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
  if (state.status !== 'ready') return <main className="page"><StatePanel title={t(state.status === 'missing' ? 'detail.missing' : 'detail.openFailed')} body={t('detail.otherWorks')} action={t('common.backDiscover')} onAction={() => go('/discover')} /></main>;
  const work = state.data; const builtIn = work.id === GUESS_BAIKE_WORK_ID; const web = builtIn ? { currentReleaseId: '' } : work.targets.find(x => x.targetKey === 'web' && x.currentReleaseId); const windows = builtIn ? null : work.targets.find(x => x.targetKey === 'windows-x64' && x.currentReleaseId);
  const managedWindows = Boolean(host?.desktop?.prepareRelease && host?.desktop?.launchRelease);
  const windowsDownloadUrl = windows ? api.releaseDownloadUrl(work.id, windows.currentReleaseId) : null;
  const toggleLibrary = async () => { setLibraryBusy(true); try { const result = demo ? { data: { savedAt: library?.savedAt ? null : new Date().toISOString() } } : library?.savedAt ? await api.removeFromLibrary(work.id) : await api.saveToLibrary(work.id); setLibrary(result.data); } catch (caught) { if (caught.status === 401) go('/account'); } finally { setLibraryBusy(false); } };
  const launchWindows = async () => {
    if (!windows) return;
    const release = { workId: work.id, releaseId: windows.currentReleaseId, fileName: windows.fileName, sizeBytes: windows.sizeBytes, sha256: windows.sha256 };
    if (!managedWindows) return;
    if (nativeDownload.phase === 'ready') {
      setNativeBusy(true); setNativeDownload(current => ({ ...current, phase: 'launching' })); setNativeMessage(t('detail.startingGame'));
      try {
        await host.desktop.launchRelease(release);
        emitAnalytics(api, hostKind, { type: 'game_start', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo);
        setNativeDownload({ phase: 'ready', percent: 100 });
        setNativeMessage(t('detail.gameStarted'));
      } catch (caught) {
        setNativeDownload({ phase: 'ready', percent: 100 });
        setNativeMessage(caught.code ? t('detail.launchFailed') : caught.message || t('detail.launchFailed'));
      } finally { setNativeBusy(false); }
      return;
    }
    setNativeBusy(true); setNativeDownload({ phase: 'downloading', percent: 0 }); setNativeMessage(t('detail.downloadingLocal'));
    emitAnalytics(api, hostKind, { type: 'download_start', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo);
    try {
      await host.desktop.prepareRelease(release, { onProgress: progress => setNativeDownload({ phase: progress?.state || 'downloading', percent: progress?.percent || 0 }) });
      emitAnalytics(api, hostKind, { type: 'download_complete', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo);
      setNativeDownload({ phase: 'ready', percent: 100 });
      setNativeMessage(t('detail.downloadReady'));
    } catch (caught) {
      setNativeDownload(current => ({ ...current, phase: 'failed' }));
      setNativeMessage(caught.code ? t('detail.downloadFailed') : caught.message || t('detail.downloadFailed'));
    } finally { setNativeBusy(false); }
  };

  const creatorName=work.creatorDisplayName??(builtIn?t('common.officialCreator'):t('common.communityAuthor'));
  const playLabel=work.plays??(work.playCount?t('detail.plays',{count:Number(work.playCount),formatted:number(work.playCount)}):t('common.newWork'));
  return <main className="page detail-page"><button className="back-link" onClick={() => go('/discover')}>{icons.back} {t('common.backDiscover')}</button><section className="detail-hero"><Art work={work} large /><div className="detail-copy"><div className="badge-row"><span className="status-badge">{icons.check} {t(builtIn?'detail.official':web?'detail.verifiedWeb':'detail.verifiedWindows')}</span><span>{t(work.kind === 'game'?'discover.game':'detail.interactive')}</span></div><h1>{work.title}</h1><p className="detail-byline">{t('detail.byline',{creator:creatorName,minutes:work.estimatedMinutes??3})}{work.agentLabel?t('detail.coCreated',{agent:work.agentLabel}):''}</p><p className="detail-lead">{work.description}</p>{!!work.tags?.length && <div className="detail-tags">{work.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}<div className="detail-actions">{web && <Button icon={icons.play} onClick={() => go(`/play/${work.id}/${web.currentReleaseId ?? ''}`)}>{t('detail.playNow')}</Button>}{windows && (managedWindows ? <Button icon={nativeDownload.phase === 'ready' ? icons.play : "↓"} disabled={nativeBusy} onClick={launchWindows}>{nativeDownload.phase === 'launching' ? t('detail.launching') : ['checking','downloading','verifying'].includes(nativeDownload.phase) ? t('detail.downloading',{percent:nativeDownload.percent}) : nativeDownload.phase === 'ready' ? t('detail.launch') : t('detail.downloadWindows')}</Button> : <DownloadLink href={windowsDownloadUrl} fileName={windows.fileName} onClick={() => emitAnalytics(api, hostKind, { type: 'download_start', route: 'work', workId: work.id, releaseId: windows.currentReleaseId }, demo)}>{t('detail.downloadWindows')}</DownloadLink>)}<Button kind="secondary" disabled={libraryBusy} onClick={toggleLibrary}>{t(library?.savedAt?'detail.removeLibrary':'detail.addLibrary')}</Button><Button kind="secondary" icon={<ShareIcon/>} aria-label={t('detail.shareAria')} onClick={()=>setShareOpen(true)}>{t('detail.share')}</Button></div>{managedWindows && windows && ['checking','downloading','verifying'].includes(nativeDownload.phase) && <div className="native-download-progress" role="progressbar" aria-label={t('detail.downloadProgress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={nativeDownload.percent}><i style={{ width: `${nativeDownload.percent}%` }}/></div>}<p className="friendly-note">{t(windows&&!web?(managedWindows?'detail.managedNote':'detail.browserNote'):'detail.sandboxNote')}</p>{nativeMessage && <p className="friendly-note" role="status">{nativeMessage}</p>}{!builtIn && <div className="community-actions"><button className="feedback-link" onClick={() => setFeedbackOpen(true)}>{t('detail.feedback')}</button><button className="report-link" onClick={() => setReporting(true)}>{t('detail.report')}</button></div>}</div></section><section className="detail-columns"><div className="panel"><span className="kicker">HOW TO PLAY</span><h2>{t('detail.howToPlay')}</h2><p>{work.instructions || t('detail.noInstructions')}</p><WorkProvenance work={work} claim={claim} accountProfile={accountProfile} onClaim={()=>setClaimOpen(true)} go={go}/></div><div className="panel facts"><span className="kicker">COMPATIBILITY</span><h2>{t('detail.runtimeInfo')}</h2><dl><div><dt>{t('detail.runtime')}</dt><dd>{t(web?'detail.sidebarWeb':'detail.windowsWindow')}</dd></div><div><dt>{t('detail.currentVersion')}</dt><dd>{t('common.revision',{value:work.revision})}</dd></div><div><dt>{t('detail.communityData')}</dt><dd>{playLabel} · {t('detail.saves',{count:work.saveCount??0})}{work.remixCount?t('detail.remixes',{count:work.remixCount}):''}</dd></div><div><dt>{t('detail.dataAccess')}</dt><dd>{t('detail.noProjectAccess')}</dd></div></dl></div></section><WorkTimeline items={timeline} go={go}/><WorkRemixes items={remixes} go={go}/><WorkLeaderboard workId={work.id} api={api} demo={demo} go={go} accountProfile={accountProfile} Avatar={AvatarView} date={boardDate} puzzleId={boardPuzzleId} focusBoard={focusBoard}/>{shareOpen&&<WorkShareDialog work={work} api={api} onClose={()=>setShareOpen(false)}/>} {claimOpen&&<ProjectClaimDialog work={work} api={api} demo={demo} go={go} accountProfile={accountProfile} onSubmitted={data=>{setClaim(current=>({...current,eligible:false,status:data.status}));setClaimOpen(false);}} onClose={()=>setClaimOpen(false)}/>} {feedbackOpen && <FeedbackDialog work={work} api={api} demo={demo} go={go} onClose={() => setFeedbackOpen(false)}/>} {reporting && <ReportDialog work={work} api={api} demo={demo} go={go} onClose={() => setReporting(false)}/>}</main>;
}

function ProjectClaimDialog({work,api,demo,go,accountProfile,onSubmitted,onClose}) {
  const { t } = useI18n();
  const [state,setState]=useState({status:work.repositoryUrl?'loading':'ready',repositories:[]}); const [repositoryKey,setRepositoryKey]=useState(''); const [evidenceType,setEvidenceType]=useState(work.repositoryUrl?'github':'website'); const [evidenceUrl,setEvidenceUrl]=useState(''); const [relationship,setRelationship]=useState('owner'); const [note,setNote]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{if(!work.repositoryUrl)return undefined;let live=true;(async()=>{try{if(demo){const repository={connectionId:'demo',repositoryId:'1',htmlUrl:work.repositoryUrl,owner:'demo',name:'game'};if(live)setState({status:'ready',repositories:[repository]});return;}const connections=(await api.listGitHubSourceConnections()).data.filter(item=>item.status==='active');const groups=await Promise.all(connections.map(connection=>api.listGitHubSourceRepositories(connection.id).then(result=>result.data.map(repository=>({...repository,connectionId:connection.id})))));const normalized=value=>String(value||'').replace(/\.git\/?$/i,'').replace(/\/$/,'').toLowerCase();const repositories=groups.flat().filter(item=>item.visibility==='public'&&item.accessState==='active'&&normalized(item.htmlUrl)===normalized(work.repositoryUrl));if(live)setState({status:'ready',repositories});}catch(caught){if(live)setState({status:'error',repositories:[],message:caught.message});}})();return()=>{live=false;};},[api,demo,work.repositoryUrl]);
  useEffect(()=>{if(!repositoryKey&&state.repositories.length===1)setRepositoryKey(`${state.repositories[0].connectionId}:${state.repositories[0].repositoryId}`);},[state.repositories,repositoryKey]);
  const submit=async event=>{event.preventDefault();setError('');let evidence={evidenceType,relationship,note};if(evidenceType==='github'){const repository=state.repositories.find(item=>`${item.connectionId}:${item.repositoryId}`===repositoryKey);if(!repository){setError(t('claim.error.repository'));return;}evidence={...evidence,connectionId:repository.connectionId,repositoryId:repository.repositoryId};}else{if(!evidenceUrl.trim()){setError(t('claim.error.evidenceUrl'));return;}if(note.trim().length<10){setError(t('claim.error.note'));return;}evidence={...evidence,evidenceUrl:evidenceUrl.trim()};}setBusy(true);try{const data=demo?{status:'pending'}:(await api.createProjectClaim(work.id,evidence)).data;onSubmitted(data);}catch(caught){if(caught.status===401)return go('/account');setError(caught.message||t('claim.error.submit'));}finally{setBusy(false);}};
  const noCreator=!accountProfile?.canPublish;
  return <div className="modal-backdrop" role="presentation" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><form className="report-dialog claim-dialog" role="dialog" aria-modal="true" aria-label={t('claim.dialogAria')} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>×</button><span className="kicker">GAME CLAIM</span><h2>{t('claim.title',{title:work.title})}</h2><p>{t('claim.lead')}</p>{noCreator?<div className="claim-empty"><strong>{t('claim.creatorRequired')}</strong><p>{t('claim.creatorRequiredLead')}</p><Button type="button" onClick={()=>go('/creator')}>{t('claim.goCreator')}</Button></div>:<><label>{t('claim.relationship')}<select value={relationship} onChange={event=>setRelationship(event.target.value)}><option value="owner">{t('claim.relationship.owner')}</option><option value="maintainer">{t('claim.relationship.maintainer')}</option></select></label><label>{t('claim.evidenceType')}<select value={evidenceType} onChange={event=>setEvidenceType(event.target.value)}>{work.repositoryUrl&&<option value="github">{t('claim.evidence.github')}</option>}<option value="website">{t('claim.evidence.website')}</option><option value="storefront">{t('claim.evidence.storefront')}</option><option value="other">{t('claim.evidence.other')}</option></select></label>{evidenceType==='github'?(state.status==='loading'?<p role="status">{t('claim.checkingRepository')}</p>:<><label>{t('claim.repository')}<select required value={repositoryKey} onChange={event=>setRepositoryKey(event.target.value)}><option value="">{t('claim.select')}</option>{state.repositories.map(item=><option key={`${item.connectionId}:${item.repositoryId}`} value={`${item.connectionId}:${item.repositoryId}`}>{item.owner}/{item.name}</option>)}</select></label>{!state.repositories.length&&<p className="claim-help">{t('claim.noRepositoryMatch')}</p>}</>):<label>{t('claim.evidenceUrl')}<input required type="url" maxLength="2048" value={evidenceUrl} onChange={event=>setEvidenceUrl(event.target.value)} placeholder={t('claim.evidenceUrlPlaceholder')}/></label>}<label>{t('claim.note')}{t(evidenceType==='github'?'claim.optional':'claim.minLength')}<textarea required={evidenceType!=='github'} maxLength="1000" value={note} onChange={event=>setNote(event.target.value)} placeholder={t('claim.notePlaceholder')}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={busy}>{t(busy?'claim.submitting':'claim.submit')}</Button></div></>}</form></div>;
}

function FeedbackDialog({ work, api, demo, go, onClose }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ category: 'bug', summary: '', details: '', reproductionSteps: '', environment: '' });
  const [state, setState] = useState('editing'); const [error, setError] = useState('');
  const summaryLength = form.summary.trim().length; const detailsLength = form.details.trim().length;
  const update = (key, value) => { setForm(current => ({ ...current, [key]: value })); setError(''); };
  const submit = async event => {
    event.preventDefault(); setError('');
    if (summaryLength < 5) { setError(t('feedback.error.summary',{count:5-summaryLength})); return; }
    if (detailsLength < 10) { setError(t('feedback.error.details',{count:10-detailsLength})); return; }
    setState('sending');
    try { if (!demo) await api.createCreatorFeedback(work.id, form); setState('sent'); }
    catch (caught) { if (caught.status === 401) return go('/account'); setError(caught.message || t('feedback.error.submit')); setState('editing'); }
  };
  return <div className="modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><form className="report-dialog feedback-dialog" role="dialog" aria-modal="true" aria-label={t('feedback.dialogAria')} onSubmit={submit} noValidate><button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>×</button><span className="kicker">PLAYER FEEDBACK</span>{state === 'sent' ? <><h2>{t('feedback.sentTitle')}</h2><p>{t('feedback.sentLead')}</p><Button type="button" onClick={onClose}>{t('common.done')}</Button></> : <><h2>{t('feedback.title',{title:work.title})}</h2><p>{t('feedback.lead')}</p><div className="feedback-dialog__grid"><label>{t('feedback.category')}<select value={form.category} onChange={event => update('category', event.target.value)}><option value="bug">{t('feedback.category.bug')}</option><option value="idea">{t('feedback.category.idea')}</option><option value="compatibility">{t('feedback.category.compatibility')}</option><option value="other">{t('feedback.category.other')}</option></select></label><label><span className="feedback-field-heading">{t('feedback.summary')} <small className={summaryLength < 5 ? 'is-short' : 'is-ready'}>{t('feedback.minimum',{current:summaryLength,max:160,min:5})}</small></span><input required maxLength="160" value={form.summary} aria-invalid={summaryLength > 0 && summaryLength < 5} onChange={event => update('summary', event.target.value)} placeholder={t('feedback.summaryPlaceholder')}/></label></div><label><span className="feedback-field-heading">{t('feedback.details')} <small className={detailsLength < 10 ? 'is-short' : 'is-ready'}>{t('feedback.minimum',{current:detailsLength,max:2000,min:10})}</small></span><textarea required maxLength="2000" value={form.details} aria-invalid={detailsLength > 0 && detailsLength < 10} onChange={event => update('details', event.target.value)} placeholder={t('feedback.detailsPlaceholder')}/></label><label>{t('feedback.reproduction')}<textarea maxLength="2000" value={form.reproductionSteps} onChange={event => update('reproductionSteps', event.target.value)} placeholder={t('feedback.reproductionPlaceholder')}/></label><label>{t('feedback.environment')}<input maxLength="500" value={form.environment} onChange={event => update('environment', event.target.value)} placeholder={t('feedback.environmentPlaceholder')}/></label><small className="feedback-privacy">{t('feedback.privacy')}</small>{error && <p className="form-error feedback-validation" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={state === 'sending'}>{t(state==='sending'?'feedback.sending':'feedback.send')}</Button></div></>}</form></div>;
}

function ReportDialog({ work, api, demo, go, onClose }) {
  const { t } = useI18n();
  const [category, setCategory] = useState('unsafe'); const [details, setDetails] = useState(''); const [state, setState] = useState('editing'); const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setState('sending'); setError('');
    try { if (!demo) await api.reportWork(work.id, { category, details }); setState('sent'); }
    catch (caught) { if (caught.status === 401) return go('/account'); setError(caught.message || t('report.error.submit')); setState('editing'); }
  };
  return <div className="modal-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><form className="report-dialog" role="dialog" aria-modal="true" aria-label={t('report.dialogAria')} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>×</button><span className="kicker">CONTENT REPORT</span>{state === 'sent' ? <><h2>{t('report.sentTitle')}</h2><p>{t('report.sentLead')}</p><Button type="button" onClick={onClose}>{t('common.done')}</Button></> : <><h2>{t('report.title',{title:work.title})}</h2><p>{t('report.lead')}</p><label>{t('report.category')}<select value={category} onChange={event => setCategory(event.target.value)}><option value="unsafe">{t('report.category.unsafe')}</option><option value="malware">{t('report.category.malware')}</option><option value="harassment">{t('report.category.harassment')}</option><option value="copyright">{t('report.category.copyright')}</option><option value="other">{t('report.category.other')}</option></select></label><label>{t('report.details')}<textarea value={details} maxLength="1000" onChange={event => setDetails(event.target.value)} placeholder={t('report.detailsPlaceholder')}/></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={state === 'sending'}>{t(state==='sending'?'report.sending':'report.submit')}</Button></div></>}</form></div>;
}

function PlayerPage({ workId, releaseId, initialShareCode, challengeCode, initialRoomId, api, host, hostKind, demo, go }) {
  const { t } = useI18n();
  const builtIn = workId === GUESS_BAIKE_WORK_ID;
  const mount = useRef(null); const stage = useRef(null); const menu = useRef(null); const core = useRef(null); const launchDescriptor=useRef(null); const tRef=useRef(t);
  const [state, setState] = useState(builtIn ? 'running' : 'loading'); const [launchError, setLaunchError] = useState('');
  const [saveStatus,setSaveStatus] = useState(null);
  const [saveController,setSaveController]=useState(null);
  const [work,setWork]=useState(()=>builtIn?{}:demo?{}:null);
  const [attempt,setAttempt]=useState(0); const [builtInSession,setBuiltInSession]=useState(0); const [fullscreen,setFullscreen]=useState(false); const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{tRef.current=t;},[t]);
  useEffect(() => { if (!demo) api.recordPlay(workId).catch(() => {}); }, [api, demo, workId]);
  useEffect(() => {
    if (!hostKind) return undefined;
    const started = Date.now(); emitAnalytics(api, hostKind, { type: 'game_start', route: 'play', workId, ...(releaseId ? { releaseId } : {}) }, demo);
    return () => emitAnalytics(api, hostKind, { type: 'game_end', route: 'play', workId, ...(releaseId ? { releaseId } : {}), durationMs: Math.min(600000, Date.now() - started) }, demo);
  }, [api, hostKind, workId, releaseId, demo]);
  useEffect(()=>{const changed=()=>setFullscreen(document.fullscreenElement===stage.current);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  useEffect(()=>{if(!menuOpen)return undefined;const close=event=>{if(event.type==='keydown'&&event.key==='Escape')setMenuOpen(false);else if(event.type==='pointerdown'&&!menu.current?.contains(event.target))setMenuOpen(false);};document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close);};},[menuOpen]);
  useEffect(() => { setSaveStatus(null); setSaveController(null); setLaunchError(''); if (builtIn) { setState('running'); if(!demo)api.getWork(workId).then(({data})=>setWork(data)).catch(()=>{}); return undefined; } core.current = new PlayerCore({ ...playerRuntimeOptions({ host, pageHostname: location.hostname, development: import.meta.env?.DEV === true, defaultRuntimeDomain: import.meta.env?.VITE_RUNTIME_DOMAIN }), createBridge: context => createWebGameHost({ ...context,apiClient: api,workId,initialRoomId,initialShareCode,exportFile:(file,options)=>promptFileExport(host,file,{...options,t:tRef.current}),onCloudSaveStatus: setSaveStatus,
    saveCache:host.saveCache,saveOrigin:host.saveOrigin??location.origin,onLocalSaveController:setSaveController,
    getSaveOwner:async()=>{const tokens=await host.account?.getTokens?.();if(tokens){if(!tokens.profile?.id)throw Object.assign(new Error(tRef.current('player.authRequired')),{code:'AUTH_REQUIRED'});return 'user:'+tokens.profile.id;}return 'anonymous:'+await host.saveCache.anonymousId();},
    getAccountIdentity: async () => {
    const tokens = await host.account?.getTokens?.();
    return tokens ? JSON.stringify([tokens.profile?.id ?? null, tokens.grantId ?? null]) : null;
  } }) }); const off = core.current.onStateChanged(e => { setState(e.state); if (e.state === 'idle' || e.state === 'disposed') setSaveStatus(null); if (e.message) setLaunchError(e.message); }); let active = true; if (demo) { setState('running'); } else { setState('loading'); api.getWork(workId).then(({ data }) => { if (!active) return; setWork(data); if (!workHasWebRelease(data)) { go(`/works/${workId}`); return; } return api.getLaunch(workId, releaseId).then(({ data:descriptor }) => { if (active) { launchDescriptor.current=descriptor; core.current?.mount(mount.current, descriptor); } }); }).catch(caught => { if (active) { setLaunchError(caught.message || tRef.current('player.launchFailedMessage')); setState('error'); } }); } return () => { active = false; off(); core.current?.dispose(); }; }, [workId, releaseId, initialRoomId, initialShareCode, demo, builtIn, host, api, attempt]);
  const returnTo=challengeCode?'/games/guess-baike/community':`/works/${workId}`;
  const pendingSave=['local_pending','syncing','error_retryable','conflict'].includes(saveStatus?.state);
  const leave=()=>{const confirmed=!pendingSave||typeof globalThis.confirm!=='function'||globalThis.confirm(t('player.unsyncedConfirm'));if(confirmed)go(returnTo);};
  const minimize=()=>{setMenuOpen(false);if(builtIn||demo)setState(current=>current==='hidden'?'running':'hidden');else if(state==='hidden')core.current?.resume();else core.current?.hide();};
  const restart=()=>{setMenuOpen(false);setLaunchError('');if(builtIn){setBuiltInSession(value=>value+1);setState('running');return;}if(demo){setState('running');return;}if(launchDescriptor.current&&mount.current){core.current?.mount(mount.current,launchDescriptor.current);return;}setAttempt(value=>value+1);};
  const stop=()=>{setMenuOpen(false);const confirmed=typeof globalThis.confirm!=='function'||globalThis.confirm(t('player.stopConfirm'));if(!confirmed)return;if(builtIn||demo)setState('idle');else core.current?.stop();};
  const toggleFullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.current?.requestFullscreen?.();}catch{setLaunchError(t('player.fullscreenBlocked'));}};
  const statusText=challengeCode?t('player.challenge'):state==='running'?t('player.running'):state==='loading'?t('player.loadingShort'):state==='hidden'?t('player.minimized'):state==='error'?t('player.failedShort'):t('player.stopped');
  const playerTitle=builtIn?t('player.guessTitle'):demo?t('player.demoTitle'):(work?.title||t('player.reading'));
  const playerCreator=builtIn?t('player.officialProduction'):demo?t('player.demoProduction'):(work?.creatorDisplayName||t('player.communityWork'));
  return <main className={`player-page ${builtIn ? 'player-page--guess' : ''}`}>
    <header className="player-bar">
      <div className="player-bar__identity"><button className="player-exit" onClick={leave}>{icons.back}<span>{t('player.exit')}</span></button><div><strong>{playerTitle}</strong><small>{playerCreator}{work?.revision?` · ${t('common.revision',{value:work.revision})}`:''}</small></div></div>
      <div className="player-bar__status"><span className={`live-state live-state--${state}`}><i />{statusText}</span><CloudSaveStatus status={saveStatus}/></div>
      <div className="player-bar__controls"><SaveManager controller={saveController} onRestored={restart}/><button className="player-control" onClick={toggleFullscreen} aria-label={t(fullscreen?'player.exitFullscreen':'player.enterFullscreen')} title={t(fullscreen?'player.exitFullscreen':'player.enterFullscreen')}>{fullscreen?'↙':'↗'}</button>{['running','hidden'].includes(state)&&<button className="player-control" aria-pressed={state==='hidden'} onClick={minimize} title={t(state==='hidden'?'player.resume':'player.minimize')}>{state==='hidden'?icons.play:'—'}</button>}<div className="player-menu" ref={menu}><button className="player-control" aria-expanded={menuOpen} onClick={()=>setMenuOpen(value=>!value)} title={t('player.more')}>•••</button>{menuOpen&&<div role="menu"><button role="menuitem" onClick={()=>{setMenuOpen(false);go(`/works/${workId}`);}}>{t('player.details')}</button><button role="menuitem" onClick={restart}>{t('player.restart')}</button>{state!=='idle'&&<button role="menuitem" className="is-danger" onClick={stop}>{t('player.stop')}</button>}</div>}</div></div>
    </header>
    <section className="player-stage" ref={stage} aria-label={t('player.stage',{title:playerTitle})}>
      <div className="player-frame-host" ref={mount}>{builtIn&&state!=='idle'?<div className="player-built-in" hidden={state==='hidden'}><GuessBaikeGame key={builtInSession} api={api} demo={demo} challengeCode={challengeCode} go={go}/></div>:demo&&state!=='idle'?<div className="demo-game" hidden={state==='hidden'}><div className="demo-planet"/><span className="kicker">DEMO SESSION</span><h1>{t('player.demoTitle')}</h1><p>{t('player.demoControls')}</p><div className="demo-track"><i/><i/><i/></div></div>:null}</div>
      {state==='loading'&&<div className="player-stage-state" role="status"><i className="player-loader"/><strong>{t('player.launchingTitle',{title:playerTitle})}</strong><span>{t('player.validating')}</span></div>}
      {state==='hidden'&&<div className="player-stage-state"><span className="player-state-mark">—</span><strong>{t('player.minimizedTitle')}</strong><span>{t('player.minimizedLead')}</span><button onClick={minimize}>{t('player.resume')}</button></div>}
      {state==='idle'&&<div className="player-stage-state"><span className="player-state-mark">■</span><strong>{t('player.stoppedTitle')}</strong><span>{t('player.stoppedLead')}</span><button onClick={restart}>{t('player.restartGame')}</button></div>}
      {state==='error'&&<div className="player-stage-state player-stage-state--error" role="alert"><span className="player-state-mark">!</span><strong>{t('player.launchFailedTitle')}</strong><span>{launchError||t('player.expired')}</span><div><button onClick={restart}>{t('player.reload')}</button><button onClick={()=>go(returnTo)}>{t('player.backWork')}</button></div></div>}
    </section>
  </main>;
}

function AccountPage({ api, host, demo, go, themeMode, setThemeMode, canChangeTheme, hostIdentity, onProfileChange }) {
  const { t, locale, date } = useI18n();
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
    const demoDevice = { id: '00000000-0000-4000-8000-000000000099', deviceLabel: t('account.demoDevice'), clientKind: hostIdentity.kind || 'harness', authenticatedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), current: true };
    (demo ? Promise.resolve({ data: [demoDevice] }) : api.listDevices()).then(({ data }) => { if (active) setDevices(data); }).catch(caught => { if (active && caught.status !== 401) setError(caught.message || t('account.error.devices')); });
    return () => { active = false; };
  }, [api, demo, phase, hostIdentity.kind, t]);

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
        if (active) setError(caught.message || t('account.error.githubIncomplete'));
      }
    };
    timer = setTimeout(poll, demo ? 900 : Math.max(1, githubChallenge.intervalSeconds || 2) * 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [phase, githubChallenge?.challengeId, demo, api, host, t]);

  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (phase === 'email') {
        if (demo) { setChallengeId('demo'); setPhase('code'); }
        else { const capabilities = await host.getCapabilities(); const { data } = await api.createChallenge({ email, clientKind: resolveAuthClientKind(capabilities), locale }); setChallengeId(data.challengeId); setPhase('code'); }
      } else {
        if (demo) await finishLogin({ accessToken: 'demo-session' });
        else { const { data } = await api.verifyChallenge({ challengeId, code, deviceLabel: t('account.deviceLabel',{host:hostIdentity.label}) }); await finishLogin(data); }
      }
    } catch (caught) { setError(caught.message || t('account.error.login')); }
    finally { setBusy(false); }
  };

  const startGitHub = async () => {
    setBusy(true); setError('');
    const authWindow = demo || host.navigation?.openExternal ? null : globalThis.open?.('about:blank', 'gamehub-github-oauth', 'popup,width=760,height=780');
    try {
      const data = demo
        ? { challengeId: 'demo-github-web', authorizeUrl: null, intervalSeconds: 1 }
        : (await api.startGitHubWeb({ clientKind: resolveAuthClientKind(await host.getCapabilities()), deviceLabel: t('account.deviceLabel',{host:hostIdentity.label}) })).data;
      setGithubChallenge(data); setPhase('github-web');
      if (data.authorizeUrl && host.navigation?.openExternal) { authWindow?.close(); await host.navigation.openExternal(data.authorizeUrl); }
      else if (authWindow && data.authorizeUrl) { authWindow.location.replace(data.authorizeUrl); authWindow.opener = null; }
    } catch (caught) {
      authWindow?.close();
      setError(caught.message || t('account.error.githubWeb'));
    } finally { setBusy(false); }
  };

  const startGitHubDevice = async () => {
    setBusy(true); setError('');
    try {
      const data = demo
        ? { challengeId: 'demo-github-device', userCode: 'GAME-HUB', verificationUri: 'https://github.com/login/device', intervalSeconds: 5 }
        : (await api.startGitHubDevice({ clientKind: resolveAuthClientKind(await host.getCapabilities()), deviceLabel: t('account.deviceLabel',{host:hostIdentity.label}) })).data;
      setGithubChallenge(data); setPhase('github-device');
    } catch (caught) { setError(caught.message || t('account.error.githubDevice')); }
    finally { setBusy(false); }
  };

  const pollGitHubDevice = async () => {
    setBusy(true); setError('');
    try {
      const result = demo ? { status: 'complete', tokens: { accessToken: 'demo-github-device-session' } } : (await api.pollGitHubDevice(githubChallenge.challengeId)).data;
      if (result.status === 'pending') setError(t('account.error.githubPending'));
      else await finishLogin(result.tokens);
    } catch (caught) { setError(caught.message || t('account.error.githubConfirm')); }
    finally { setBusy(false); }
  };

  const saveProfile = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSaved('');
    try {
      const normalized = displayName.trim().replace(/\s+/g, ' ');
      const next = demo ? { ...profile, displayName: normalized } : (await api.updateProfile({ displayName: normalized })).data;
      commitProfile(next); setDisplayName(next.displayName); setSaved(t('account.nameSaved'));
    } catch (caught) { setError(caught.message || t('account.error.name')); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true); setError('');
    try { if (!demo) await api.logout(); }
    catch (caught) { if (caught.status !== 401) setError(caught.message || t('account.error.logout')); }
    finally {
      await host.account?.clearTokens?.(); commitProfile(null); setDisplayName(''); setPhase('email'); setBusy(false);
    }
  };

  const revokeDevice = async grantId => {
    setDeviceBusy(grantId); setError(''); setSaved('');
    try {
      if (!demo) await api.revokeDevice(grantId);
      setDevices(current => current.filter(device => device.id !== grantId)); setSaved(t('account.deviceRevoked'));
    } catch (caught) { setError(caught.message || t('account.error.revokeDevice')); }
    finally { setDeviceBusy(''); }
  };

  const logoutOthers = async () => {
    setDeviceBusy('others'); setError(''); setSaved('');
    try {
      const result = demo ? { data: { revokedCount: Math.max(0, devices.length - 1) } } : await api.logoutOthers();
      setDevices(current => current.filter(device => device.current)); setSaved(result.data.revokedCount ? t('account.otherDevicesRevoked',{count:result.data.revokedCount}) : t('account.noOtherDevices'));
    } catch (caught) { setError(caught.message || t('account.error.logoutOthers')); }
    finally { setDeviceBusy(''); }
  };

  const logoutAll = async () => {
    setDeviceBusy('all'); setError('');
    try { if (!demo) await api.logoutAll(); }
    catch (caught) { if (caught.status !== 401) { setError(caught.message || t('account.error.logoutAll')); setDeviceBusy(''); return; } }
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
      commitProfile(next); setSaved(t('account.avatarUpdated'));
    } catch (caught) { setError(caught.message || t('account.error.avatar')); }
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
    if (!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)) { setError(t('account.error.avatarType')); return; }
    if (file.size > 2 * 1024 * 1024) { setError(t('account.error.avatarSize')); return; }
    setAvatarBusy(true); setError(''); setSaved('');
    try {
      const next = demo ? { ...profile, avatar: { kind: 'upload', presetKey: null, url: null, previewUrl: URL.createObjectURL(file), mediaType: file.type, animated: ['image/gif','image/webp'].includes(file.type) } } : (await api.uploadAvatar(file)).data;
      commitProfile(next); setSaved(t(next.avatar.animated ? 'account.animatedAvatarSaved' : 'account.avatarSaved'));
    } catch (caught) { setError(caught.message || t('account.error.avatarUpload')); }
    finally { setAvatarBusy(false); }
  };

  if (phase === 'loading') return <main className="page narrow-page"><div className="settings-loading"><span className="spinner"/><p>{t('account.loadingDevice')}</p></div></main>;
  if (phase === 'settings' && profile) {
    const linked = new Map((profile.linkedAccounts || []).map(account => [account.provider, account]));
    return <main className="page account-settings-page">
      <button className="back-link" onClick={() => go('/discover')}>{icons.back} {t('common.backDiscover')}</button>
      <header className="settings-heading"><div className="profile-avatar"><AvatarView avatar={profile.avatar} api={api} alt={t('account.currentAvatar')}/></div><div><span className="kicker">PLAYER PROFILE</span><h1>{t('account.personalSettings')}</h1><p>{t('account.settingsLead')}</p>{profile.profileHandle && <Button kind="secondary" onClick={() => go(`/u/${profile.profileHandle}`)}>{t('account.viewPublicProfile')}</Button>}</div></header>
      <div className="settings-layout">
        <section className="settings-main">
          <form className="settings-panel" onSubmit={saveProfile}><div className="settings-panel__head"><div><h2>{t('account.profileTitle')}</h2><p>{t('account.profileLead')}</p></div><span className="pixel-label">PROFILE</span></div><label className="settings-field">{t('account.displayName')}<div className="settings-input-row"><input required minLength="1" maxLength="40" value={displayName} onChange={event => { setDisplayName(event.target.value); setSaved(''); }}/><Button type="submit" disabled={busy || !displayName.trim() || displayName.trim() === profile.displayName}>{t(busy ? 'account.saving' : 'account.save')}</Button></div><small>{Array.from(displayName).length}/40</small></label>{saved && <p className="settings-success" role="status">{icons.check} {saved}</p>}{error && <p className="form-error" role="alert">{error}</p>}</form>
          <section className="settings-panel"><div className="settings-panel__head"><div><h2>{t('account.localSavesTitle')}</h2><p>{t('account.localSavesLead')}</p></div><span className="pixel-label">LOCAL SAVES</span></div></section>
          <section className="settings-panel avatar-settings"><div className="settings-panel__head"><div><h2>{t('account.avatarTitle')}</h2><p>{t('account.avatarLead')}</p></div><span className="pixel-label">AVATAR</span></div><div className="avatar-preset-grid">{avatarPresets.map(item => {const label=t(`account.avatarPreset.${item.key}`);return <button type="button" key={item.key} className={profile.avatar?.kind === 'preset' && profile.avatar.presetKey === item.key ? 'is-active' : ''} onClick={() => choosePreset(item.key)} disabled={avatarBusy} title={label}><AvatarView avatar={{ kind: 'preset', presetKey: item.key }} api={api} alt={label}/>{profile.avatar?.kind === 'preset' && profile.avatar.presetKey === item.key && <b>{icons.check}</b>}</button>;})}</div><div className="avatar-actions"><Button type="button" kind="secondary" onClick={randomizeAvatar} disabled={avatarBusy}>{t('account.randomAvatar')}</Button><Button type="button" onClick={() => avatarInput.current?.click()} disabled={avatarBusy}>{t(avatarBusy ? 'account.processing' : 'account.uploadAvatar')}</Button><input ref={avatarInput} className="avatar-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={uploadAvatar}/></div>{profile.avatar?.kind === 'upload' && <p className="avatar-upload-state"><AvatarView avatar={profile.avatar} api={api} alt={t('account.uploadedAvatar')}/><span><strong>{t('account.customAvatar')}</strong><small>{profile.avatar.animated ? t('account.animatedPlaying') : profile.avatar.mediaType}</small></span></p>}</section>
          <section className="settings-panel"><div className="settings-panel__head"><div><h2>{t('account.appearanceTitle')}</h2><p>{t(canChangeTheme ? 'account.appearanceWebLead' : 'account.appearanceHostLead',{host:hostIdentity.label})}</p></div><span className="pixel-label">DISPLAY</span></div><div className="appearance-options" role="group" aria-label={t('account.appearanceTitle')}>{[['agent',t('account.followHost',{host:hostIdentity.label})],['light',t('account.light')],['dark',t('account.dark')]].map(([value,label]) => <button type="button" key={value} disabled={!canChangeTheme && value !== 'agent'} className={appearance === value || (value !== 'agent' && appearance !== 'agent' && themeMode === value) ? 'is-active' : ''} onClick={() => chooseAppearance(value)}><i className={`theme-swatch theme-swatch--${value}`}/><span><strong>{label}</strong><small>{t(value === 'agent' ? 'account.recommended' : 'account.thisInterface')}</small></span>{(appearance === value) && <b>{icons.check}</b>}</button>)}</div></section>
          <section className="settings-panel"><div className="settings-panel__head"><div><h2>{t('account.signInMethods')}</h2><p>{t('account.signInMethodsLead')}</p></div><span className="pixel-label">SECURITY</span></div><div className="identity-list">{[['github','GitHub'],['email',t('account.emailCode')]].map(([provider,label]) => { const account = linked.get(provider); return <div className="identity-row" key={provider}><span className={`identity-icon identity-icon--${provider}`}>{provider === 'github' ? <GitHubLogo/> : '@'}</span><div><strong>{label}</strong><small>{account?.label || t('account.notLinked')}</small></div><em className={account ? 'is-linked' : ''}>{t(account ? 'account.linked' : 'account.unlinked')}</em></div>; })}</div></section>
          <section className="settings-panel device-settings"><div className="settings-panel__head"><div><h2>{t('account.devicesTitle')}</h2><p>{t('account.devicesLead')}</p></div><span className="pixel-label">SESSIONS</span></div><div className="device-list">{devices.map(device => <div className="device-row" key={device.id}><span className="device-mark">{device.clientKind.slice(0,2).toUpperCase()}</span><div><strong>{device.deviceLabel}</strong><small>{t('account.deviceMeta',{kind:device.clientKind,lastSeen:date(device.lastSeenAt,{dateStyle:'short',timeStyle:'short'}),signedIn:date(device.authenticatedAt,{dateStyle:'short'})})}</small></div>{device.current ? <em>{t('account.currentDevice')}</em> : <button type="button" disabled={!!deviceBusy} onClick={() => revokeDevice(device.id)}>{t(deviceBusy === device.id ? 'account.signingOut' : 'account.signOut')}</button>}</div>)}</div><div className="device-actions"><Button type="button" kind="secondary" disabled={!!deviceBusy || devices.filter(device => !device.current).length === 0} onClick={logoutOthers}>{t(deviceBusy === 'others' ? 'account.processing' : 'account.signOutOthers')}</Button><button type="button" className="danger-button" disabled={!!deviceBusy} onClick={logoutAll}>{t(deviceBusy === 'all' ? 'account.processing' : 'account.signOutAll')}</button></div></section>
        </section>
        <aside className="settings-side"><section className="settings-panel account-summary"><span className="kicker">CURRENT SESSION</span><div className="account-summary__avatar"><AvatarView avatar={profile.avatar} api={api} alt=""/></div><h2>{profile.displayName}</h2><p>{t(profile.canPublish ? 'account.creatorAccount' : 'account.playerAccount')} · {t(profile.role === 'admin' ? 'account.admin' : 'account.member')}</p><dl><div><dt>{t('account.currentHost')}</dt><dd>{hostIdentity.label}</dd></div><div><dt>{t('account.joined')}</dt><dd>{date(profile.createdAt,{dateStyle:'medium'})}</dd></div></dl>{persistence && <small>{persistence}</small>}<Button kind="secondary" onClick={logout} disabled={busy}>{t('account.signOutCurrent')}</Button></section></aside>
      </div>
    </main>;
  }

  const title = t(phase === 'code' ? 'account.codeTitle' : phase === 'github-web' ? 'account.githubWaitTitle' : phase === 'github-device' ? 'account.githubConnectTitle' : 'account.signInTitle');
  const description = phase === 'code' ? t('account.codeSent',{email}) : t(phase === 'github-web' ? 'account.githubWaitLead' : phase === 'github-device' ? 'account.githubDeviceLead' : 'account.signInLead');

  return <main className="page narrow-page"><section className="account-card"><div className="account-art"><Logo /><h1>{t('account.heroLine1')}<br/>{t('account.heroLine2')}</h1><p>{t('account.heroLead')}</p></div><form className="account-form" onSubmit={submit}><span className="kicker">MOOYU.FUN ACCOUNT</span><h2>{title}</h2><p>{description}</p>{phase === 'github-web' ? <><div className="github-device github-web-waiting"><span>SECURE REDIRECT</span><strong>···</strong><small>{t(demo?'account.demoRedirect':'account.completeGithub')}</small></div>{error && <p className="form-error" role="alert">{error}</p>}{githubChallenge?.authorizeUrl && <a className="button button--primary github-open" href={githubChallenge.authorizeUrl} target="_blank" rel="noopener noreferrer"><span>{t('account.reopenGithub')}</span></a>}<button type="button" className="text-button" onClick={startGitHubDevice}>{t('account.useDeviceCode')}</button><button type="button" className="text-button" onClick={() => { setPhase('email'); setGithubChallenge(null); setError(''); }}>{t('account.otherMethod')}</button></> : phase === 'github-device' ? <><div className="github-device"><span>ONE-TIME CODE</span><strong>{githubChallenge?.userCode}</strong><small>{t('account.deviceHint')}</small></div>{error && <p className="form-error" role="alert">{error}</p>}<a className="button button--primary github-open" href={githubChallenge?.verificationUri} target="_blank" rel="noopener noreferrer"><span>{t('account.continueGithub')}</span></a><Button type="button" kind="secondary" disabled={busy} onClick={pollGitHubDevice}>{t(busy?'account.checking':'account.authorized')}</Button><button type="button" className="text-button" onClick={() => { setPhase('email'); setGithubChallenge(null); setError(''); }}>{t('account.otherMethod')}</button></> : <>{phase === 'email' && <><Button type="button" kind="github" className="github-login" icon={<GitHubLogo />} disabled={busy} onClick={startGitHub}>{t('account.githubLogin')}</Button><div className="login-divider"><span>{t('account.orEmail')}</span></div></>}<label>{t(phase === 'code' ? 'account.codeLabel' : 'account.emailLabel')}<input required disabled={busy} value={phase === 'code' ? code : email} onChange={event => phase === 'code' ? setCode(event.target.value.replace(/\D/g, '').slice(0, 6)) : setEmail(event.target.value)} inputMode={phase === 'code' ? 'numeric' : 'email'} maxLength={phase === 'code' ? 6 : undefined} placeholder={phase === 'code' ? '000000' : 'you@example.com'} /></label>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy || (phase === 'code' && code.length !== 6)}>{t(busy?'account.wait':phase === 'code'?'account.verify':'account.sendCode')}</Button>{phase === 'code' && <button type="button" className="text-button" onClick={() => { setPhase('email'); setCode(''); setError(''); }}>{t('account.otherEmail')}</button>}{persistence && <small className="credential-note">{persistence}</small>}</>}</form></section></main>;
}

function CreatorInsights({ state, days, onDays }) {
  const {t}=useI18n();
  const analytics = state.data; const totals = analytics?.totals ?? {}; const daily = analytics?.daily ?? [];
  const sourceLabels = { direct: 'creator.source.direct', share_copy: 'creator.source.share_copy', share_system: 'creator.source.share_system', readme: 'creator.source.readme', campaign: 'creator.source.campaign', external: 'creator.source.external' };
  const maxStarts = Math.max(1, ...daily.map(item => item.starts || 0));
  const dateStep = Math.max(1, Math.ceil((daily.length - 1) / 5));
  const showDate = index => index === 0 || index === daily.length - 1 || (index % dateStep === 0 && index < daily.length - 1 - dateStep / 2);
  const cards = [
    [t('creator.metric.views'), compactNumber(totals.views), t('creator.metric.viewsNote')], [t('creator.metric.starts'), compactNumber(totals.starts), t('creator.metric.startsNote')],
    [t('creator.metric.engagement'), `${totals.engagementRate || 0}%`, t('creator.metric.engagementNote',{count:compactNumber(totals.engagedSessions)})], [t('creator.metric.repeat'), compactNumber(totals.repeatPlayers), t('creator.metric.repeatNote')],
    [t('creator.metric.saves'), compactNumber(totals.saves), t('creator.metric.savesNote')], [t('creator.metric.builds'), `${totals.buildSuccessRate || 0}%`, t('creator.metric.buildsNote',{success:compactNumber(totals.successfulBuilds),total:compactNumber(totals.builds)})],
    [t('creator.metric.referredViews'), compactNumber(totals.referredViews), t('creator.metric.referredViewsNote')], [t('creator.metric.referredStarts'), compactNumber(totals.referredStarts), t('creator.metric.referredStartsNote')],
    [t('creator.metric.referralConversion'), `${totals.referralConversionRate || 0}%`, t('creator.metric.referralConversionNote',{count:compactNumber(totals.referredEngagedSessions)})],
  ];
  return <section className="creator-insights"><div className="creator-insights__head"><div><span className="kicker">CREATOR INSIGHTS</span><h2>{t('creator.insightsTitle')}</h2><p>{t('creator.insightsLead')}</p></div><div className="analytics-range" aria-label={t('creator.insightsRange')}>{[7,30,90].map(value => <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => onDays(value)}>{t('creator.days',{count:value})}</button>)}</div></div>{state.status === 'loading' ? <p className="creator-insights__state">{t('creator.insightsLoading')}</p> : state.status === 'error' ? <p className="creator-insights__state is-error">{t('creator.insightsFailed')}</p> : <><div className="creator-insights__kpis">{cards.map(([label,value,note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div><div className="creator-insights__grid"><div className="creator-insights__trend"><div className="creator-insights__subhead"><h3>{t('creator.playTrend')}</h3><span>{t('creator.shanghaiTimezone')}</span></div><div className="creator-insights__bars" style={{"--trend-count": daily.length || 1,"--trend-gap": daily.length > 30 ? "1px" : "3px"}}>{daily.map((item,index) => <div key={item.day} title={t('creator.trendTitle',{day:item.day,views:item.views,starts:item.starts,engaged:item.engagedSessions})}><span className="creator-insights__plot"><i style={{ height: `${Math.max(4, Math.round(item.starts / maxStarts * 100))}%` }}/></span><small>{showDate(index) ? item.day.slice(5) : ""}</small></div>)}</div></div><div className="creator-insights__works"><div className="creator-insights__subhead"><h3>{t('creator.workPerformance')}</h3><span>{t('creator.workMetrics')}</span></div>{analytics?.works?.length ? <div className="creator-insights__table">{analytics.works.map(item => <div key={item.workId}><strong>{item.title}</strong><span>{compactNumber(item.views)}</span><span>{compactNumber(item.starts)}</span><span>{compactNumber(item.engagedSessions)}</span><span>{compactNumber(item.repeatPlayers)}</span><span>{compactNumber(item.saves)}</span></div>)}</div> : <p>{t('creator.noWorkMetrics')}</p>}</div></div><div className="creator-insights__channels"><div className="creator-insights__subhead"><h3>{t('creator.trafficSources')}</h3><span>{t('creator.channelMetrics')}</span></div>{analytics?.channels?.length ? analytics.channels.map(item=><div className="creator-insights__channel" key={`${item.source}:${item.campaignKey||''}`}><strong>{sourceLabels[item.source]?t(sourceLabels[item.source]):item.source}{item.campaignKey?` · ${item.campaignKey}`:''}</strong><span>{compactNumber(item.views)}</span><span>{compactNumber(item.starts)}</span><span>{compactNumber(item.engagedSessions)}</span><span>{item.conversionRate}%</span></div>):<p>{t('creator.noChannelMetrics')}</p>}</div><p className="creator-insights__note">{t('creator.insightsNote')}</p></>}</section>;
}

const feedbackCategoryLabels = { bug: 'creator.feedback.category.bug', idea: 'creator.feedback.category.idea', compatibility: 'creator.feedback.category.compatibility', other: 'creator.feedback.category.other' };
const feedbackStatusLabels = { new: 'creator.feedback.status.new', reviewed: 'creator.feedback.status.reviewed', archived: 'creator.feedback.status.archived', issue_drafted: 'creator.feedback.status.issueDrafted', issue_linked: 'creator.feedback.status.issueLinked', resolved: 'creator.feedback.status.resolved' };

function CreatorFeedbackInbox({ state, api, demo, onReload, go }) {
  const {t,date}=useI18n();
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [linking, setLinking] = useState(''); const [issueUrl, setIssueUrl] = useState('');
  const transition = async (item, action, extra = {}) => {
    setBusy(`${item.id}:${action}`); setMessage('');
    try { if (!demo) await api.updateCreatorFeedback(item.id, { action, ...extra }); setLinking(''); setIssueUrl(''); await onReload(); }
    catch (caught) { setMessage(caught.message || t('creator.feedback.updateFailed')); }
    finally { setBusy(''); }
  };
  const draftIssue = async item => {
    const popup = globalThis.open?.('', '_blank'); if (popup) popup.opener = null; setBusy(`${item.id}:draft`); setMessage('');
    try {
      const draft = demo ? { createUrl: item.repositoryUrl ? `${item.repositoryUrl}/issues/new` : null, markdown: `# [玩家反馈] ${item.summary}\n\n${item.details}` } : (await api.createCreatorFeedbackIssueDraft(item.id)).data;
      if (draft.createUrl) {
        if (popup) popup.location.href = draft.createUrl; else globalThis.open?.(draft.createUrl, '_blank', 'noopener,noreferrer');
        setMessage(t('creator.feedback.githubOpened'));
      } else {
        popup?.close?.();
        if (globalThis.navigator?.clipboard?.writeText) await globalThis.navigator.clipboard.writeText(draft.markdown); else globalThis.prompt?.(t('creator.feedback.copyMarkdown'), draft.markdown);
        setMessage(t('creator.feedback.markdownCopied'));
      }
      await onReload();
    } catch (caught) { popup?.close?.(); setMessage(caught.message || t('creator.feedback.draftFailed')); }
    finally { setBusy(''); }
  };
  return <section className="creator-feedback"><div className="creator-feedback__head"><div><span className="kicker">PLAYER FEEDBACK</span><h2>{t('creator.feedback.title')}</h2><p>{t('creator.feedback.lead')}</p></div><button type="button" className="text-button" onClick={onReload}>{t('creator.refresh')}</button></div>{message && <p className="creator-feedback__message" role="status">{message}</p>}{state.status === 'loading' ? <p className="creator-feedback__empty">{t('creator.feedback.loading')}</p> : state.status === 'error' ? <p className="creator-feedback__empty is-error">{t('creator.feedback.loadFailed')}</p> : !state.items.length ? <p className="creator-feedback__empty">{t('creator.feedback.empty')}</p> : <div className="creator-feedback__list">{state.items.map(item => <article className={`creator-feedback__item is-${item.status}`} key={item.id}><header><div><span>{item.workTitle}</span><h3>{item.summary}</h3></div><div className="creator-feedback__badges"><em>{t(feedbackCategoryLabels[item.category]||'creator.feedback.category.other')}</em><strong>{t(feedbackStatusLabels[item.status]||'creator.feedback.status.new')}</strong></div></header><p>{item.details}</p>{item.reproductionSteps && <details><summary>{t('creator.feedback.reproduction')}</summary><p>{item.reproductionSteps}</p></details>}{item.environment && <small>{t('creator.feedback.environment',{value:item.environment})}</small>}{item.issueUrl && <a href={item.issueUrl} target="_blank" rel="noopener noreferrer">{t('creator.feedback.viewIssue')}</a>}<div>{COMMUNITY_ENABLED && item.contributionTaskId && <button className="text-button" type="button" onClick={() => go(`/contribute/${item.contributionTaskId}`)}>{t('creator.feedback.viewTask')}</button>}</div><footer><time>{date(item.createdAt,{dateStyle:'short',timeStyle:'short'})}</time><div>{['archived','resolved'].includes(item.status) ? <button type="button" disabled={!!busy} onClick={() => transition(item, 'reopen')}>{t('creator.feedback.reopen')}</button> : <><button type="button" disabled={!!busy} onClick={() => draftIssue(item)}>{t(busy === `${item.id}:draft`?'creator.feedback.generating':'creator.feedback.generateDraft')}</button>{item.status === 'new' && <button type="button" disabled={!!busy} onClick={() => transition(item, 'review')}>{t('creator.feedback.markReviewed')}</button>}<button type="button" disabled={!!busy} onClick={() => transition(item, 'archive')}>{t('creator.feedback.archive')}</button>{item.repositoryUrl && item.status !== 'issue_linked' && <button type="button" disabled={!!busy} onClick={() => { setLinking(item.id); setIssueUrl(''); }}>{t('creator.feedback.linkIssue')}</button>}</>}</div></footer>{linking === item.id && <form className="creator-feedback__link" onSubmit={event => { event.preventDefault(); transition(item, 'link_issue', { issueUrl }); }}><label>{t('creator.feedback.issueUrl')}<input required type="url" value={issueUrl} onChange={event => setIssueUrl(event.target.value)} placeholder={`${item.repositoryUrl}/issues/1`}/></label><Button type="submit" disabled={!!busy}>{t('creator.feedback.saveLink')}</Button><Button type="button" kind="secondary" onClick={() => setLinking('')}>{t('creator.cancel')}</Button></form>}</article>)}</div>}</section>;
}

function ContributionTaskStarter({ feedback, api, demo, onCreated }) {
  const {t}=useI18n();
  const [selected, setSelected] = useState(null);
  const [existing, setExisting] = useState(new Set());
  useEffect(() => { let live = true; (demo ? Promise.resolve({ data: [] }) : api.listCreatorContributionTasks()).then(({ data }) => { if (live) setExisting(new Set(data.map(item => item.feedbackId).filter(Boolean))); }).catch(() => {}); return () => { live = false; }; }, [api, demo]);
  const eligible = feedback.status === 'ready' ? feedback.items.filter(item => ['reviewed','issue_drafted','issue_linked'].includes(item.status) && !item.contributionTaskId && !existing.has(item.id)) : [];
  if (!eligible.length) return null;
  return <section className="contribution-starter"><div><span className="kicker">TURN FEEDBACK INTO ACTION</span><h2>{t('creator.contributionStarter.title')}</h2><p>{t('creator.contributionStarter.lead')}</p></div><div className="contribution-starter__items">{eligible.map(item => <article key={item.id}><span>{item.workTitle}</span><strong>{item.summary}</strong><button type="button" onClick={() => setSelected(item)}>{t('creator.contributionStarter.createDraft')}</button>{selected?.id === item.id && <CreateContributionTaskForm item={item} api={api} demo={demo} onCancel={() => setSelected(null)} onCreated={async () => { setExisting(current => new Set([...current, item.id])); setSelected(null); await onCreated(); }}/>}</article>)}</div></section>;
}

function CreatorDraftShelf({ drafts, go }) {
  const {t,date}=useI18n();
  if (!drafts.length) return null;
  const studioNames = { bingo: 'creator.drafts.studio.bingo',puzzle: 'creator.drafts.studio.puzzle',story: 'creator.drafts.studio.story',world: 'creator.drafts.studio.world' };
  return <section className="creator-draft-shelf"><div><span className="kicker">PRIVATE DRAFTS</span><h2>{t('creator.drafts.title')}</h2><p>{t('creator.drafts.lead')}</p></div><div>{drafts.slice(0,6).map(draft => <button type="button" key={draft.id} onClick={() => go(`/creator/drafts/${draft.id}`)}><span>⇧</span><strong>{draft.title}</strong><small>{studioNames[draft.studio]?t(studioNames[draft.studio]):draft.studio} · {t('common.revision',{value:draft.revision})}</small><time>{date(draft.updatedAt,{dateStyle:'short',timeStyle:'short'})}</time><em>{t('creator.drafts.viewPublish')}</em></button>)}</div></section>;
}

const projectClaimStatusLabels={pending:'creator.claims.status.pending',verified:'creator.claims.status.verified',rejected:'creator.claims.status.rejected',cancelled:'creator.claims.status.cancelled',disputed:'creator.claims.status.disputed',suspended:'creator.claims.status.suspended',revoked:'creator.claims.status.revoked'};
const projectClaimActionLabels={submitted:'提交申请',cancelled:'申请人撤回',verified:'审核通过',rejected:'审核拒绝',disputed:'标记争议',suspended:'暂停认领',restored:'恢复认领',revoked:'撤销认领'};

export function MyProjectClaims({state,api,demo,go,onReload}) {
  const {t,date}=useI18n();
  const [busy,setBusy]=useState('');const [message,setMessage]=useState('');
  const cancel=async claim=>{
    if(!globalThis.confirm?.(t('creator.claims.cancelConfirm',{title:claim.workTitle})))return;
    setBusy(claim.id);setMessage('');
    try{if(!demo)await api.cancelProjectClaim(claim.id);setMessage(t('creator.claims.cancelled'));await onReload();}
    catch(caught){setMessage(caught.message||t('creator.claims.cancelFailed'));}finally{setBusy('');}
  };
  return <section className="creator-claims"><div className="creator-feedback__head"><div><span className="kicker">MY GAME CLAIMS</span><h2>{t('creator.claims.title')}</h2><p>{t('creator.claims.lead')}</p></div><button type="button" className="text-button" onClick={onReload}>{t('creator.refresh')}</button></div>{message&&<p className="creator-feedback__message" role="status">{message}</p>}{state.status==='loading'?<p className="creator-feedback__empty">{t('creator.claims.loading')}</p>:state.status==='error'?<p className="creator-feedback__empty is-error">{t('creator.claims.loadFailed')}</p>:!state.items.length?<p className="creator-feedback__empty">{t('creator.claims.empty')}</p>:<div className="creator-claims__list">{state.items.map(claim=><article key={claim.id} className={`creator-claim is-${claim.status}`}><header><div><span>{t(claim.relationship==='owner'?'creator.claims.owner':'creator.claims.maintainer')} · {claim.evidenceType}</span><h3>{claim.workTitle}</h3></div><strong>{projectClaimStatusLabels[claim.status]?t(projectClaimStatusLabels[claim.status]):claim.status}</strong></header><p>{claim.decisionNote||claim.applicantNote||t('creator.claims.noReviewNote')}</p><footer><time>{t('creator.claims.updated',{value:date(claim.updatedAt,{dateStyle:'short',timeStyle:'short'})})}</time><div><button type="button" onClick={()=>go(`/works/${claim.workId}`)}>{t('creator.claims.viewGame')}</button>{claim.status==='pending'&&<button type="button" disabled={busy===claim.id} onClick={()=>cancel(claim)}>{t(busy===claim.id?'creator.claims.cancelling':'creator.claims.cancel')}</button>}</div></footer></article>)}</div>}</section>;
}

function CreatorPage({ api, demo, go, savedWork, route = '/creator' }) {
  const {t}=useI18n();
  const [state, setState] = useState({ status: 'loading', works: [], drafts: [] });
  const [insights, setInsights] = useState({ status: 'loading', days: 30, data: null });
  const [feedback, setFeedback] = useState({ status: 'loading', items: [] });
  const [claims,setClaims]=useState({status:'loading',items:[]});
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [copiedWorkId, setCopiedWorkId] = useState('');
  const [access, setAccess] = useState(null);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try {
      const [listedWorks,drafts] = demo ? [demoWorks.slice(0, 2).map(work => savedWork?.id === work.id ? { ...work, ...savedWork } : work),[]] : await Promise.all([api.listCreatorWorks().then(result => result.data),api.listCreatorDrafts().then(result => result.data).catch(() => [])]);
      const works = demo ? listedWorks : await Promise.all(listedWorks.map(async work => {
        try { const source = (await api.getWorkSource(work.id)).data; return { ...work, sourceProvider: source.provider }; }
        catch { return work; }
      }));
      setAccess(null); setState({ status: 'ready', works, drafts });
    } catch (error) {
      if (error.status === 401) return setState({ status: 'auth', works: [], drafts: [] });
      if (error.status === 403) {
        try {
          const result = (await api.getCreatorApplication()).data;
          setAccess(result); setState({ status: 'forbidden', works: [], drafts: [] });
        } catch (caught) { setState({ status: caught.status === 401 ? 'auth' : 'error', works: [], drafts: [] }); }
        return;
      }
      setState({ status: 'error', works: [], drafts: [] });
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
  const loadClaims=async()=>{
    setClaims(current=>({...current,status:'loading'}));
    const demoItems=[{id:'demo-claim',workId:demoWorks[0].id,workTitle:demoWorks[0].title,claimantUserId:'demo-user',claimantDisplayName:'演示创作者',claimantHandle:null,relationship:'owner',status:'pending',evidenceType:'website',evidenceUrl:'https://example.com/creator',repositoryId:null,repositoryUrl:null,applicantNote:'这是我的公开作者主页和作品说明。',decisionNote:'',submittedAt:new Date().toISOString(),decidedAt:null,verifiedAt:null,suspendedAt:null,revokedAt:null,updatedAt:new Date().toISOString(),version:'1'}];
    try{setClaims({status:'ready',items:demo?demoItems:(await api.listMyProjectClaims('all',100)).data});}
    catch{setClaims({status:'error',items:[]});}
  };
  useEffect(()=>{loadClaims();},[api,demo]);
  useEffect(() => {
    let active = true; setInsights(current => ({ ...current, status: 'loading' }));
    const demoData = { totals: { views: 864, starts: 327, engagedSessions: 188, engagementRate: 57, repeatPlayers: 46, saves: 73, builds: 8, successfulBuilds: 7, buildSuccessRate: 88, referredViews: 286, referredStarts: 126, referredEngagedSessions: 71, referralConversionRate: 44 }, daily: Array.from({ length: insights.days }, (_, index) => ({ day: new Date(Date.now() - (insights.days-index-1)*86400000).toLocaleDateString('en-CA'), views: 18+index%7*3, starts: 7+index%5*2, engagedSessions: 3+index%4 })), works: demoWorks.slice(0,2).map((work,index) => ({ workId: work.id,title: work.title,state: work.state,views: 500-index*220,starts: 190-index*80,engagedSessions: 110-index*45,repeatPlayers: 28-index*10,saves: 45-index*17,builds: 4,successfulBuilds: index ? 3 : 4,referredViews:180-index*74,referredStarts:80-index*34,referredEngagedSessions:46-index*21 })), channels: [{source:'share_copy',campaignKey:null,visitors:142,views:168,starts:78,engagedSessions:45,conversionRate:46},{source:'readme',campaignKey:null,visitors:91,views:104,starts:40,engagedSessions:23,conversionRate:38},{source:'external',campaignKey:null,visitors:13,views:14,starts:8,engagedSessions:3,conversionRate:57},{source:'direct',campaignKey:null,visitors:401,views:578,starts:201,engagedSessions:117,conversionRate:35}] };
    (demo ? Promise.resolve({ data: demoData }) : api.getCreatorAnalytics(insights.days)).then(({ data }) => { if (active) setInsights(current => ({ ...current, status: 'ready', data })); }).catch(() => { if (active) setInsights(current => ({ ...current, status: 'error', data: null })); });
    return () => { active = false; };
  }, [api, demo, insights.days]);
  const apply = async event => {
    event.preventDefault(); setBusy(true); setApplicationError('');
    try { const result = (await api.applyForCreator(statement)).data; setAccess(result); setStatement(''); }
    catch (caught) { setApplicationError(caught.message || t('creator.applicationFailed')); }
    finally { setBusy(false); }
  };
  if (state.status === 'loading') return <main className="page"><LoadingCards /></main>;
  if (state.status === 'auth') return <main className="page"><StatePanel title={t('creator.signInTitle')} body={t('creator.signInBody')} action={t('creator.signInAction')} onAction={() => go('/account')} /></main>;
  if (state.status === 'forbidden') {
    const application = access?.application;
    if (application?.status === 'pending') return <main className="page"><StatePanel title={t('creator.applicationPending')} body={t('creator.applicationPendingBody')} action={t('creator.recheck')} onAction={load} /></main>;
    return <main className="page narrow-page"><form className="panel new-work-form" onSubmit={apply}><span className="kicker">CREATOR ACCESS</span><h1>{t(application?.status === 'rejected'?'creator.applyAgain':'creator.applyTitle')}</h1><p>{application?.status === 'rejected'?t('creator.previousRejected',{reason:application.reviewNote||t('creator.noReviewReason')}):t('creator.applyLead')}</p><label>{t('creator.applicationStatement')}<textarea required minLength="20" maxLength="1000" value={statement} onChange={event => setStatement(event.target.value)} placeholder={t('creator.applicationPlaceholder')}/></label>{applicationError && <p className="form-error" role="alert">{applicationError}</p>}<Button type="submit" disabled={busy || statement.trim().length < 20}>{t(busy?'creator.submitting':'creator.submitApplication')}</Button></form></main>;
  }
  if (state.status === 'error') return <main className="page"><StatePanel title={t('creator.loadFailedTitle')} body={t('creator.loadFailedBody')} action={t('creator.reconnect')} onAction={load} /></main>;
  const published = state.works.filter(work => work.state === 'published').length;
  const withdrawn = state.works.filter(work => work.state === 'withdrawn').length;
  const overview = route !== '/creator/works';
  const replaceWork = next => setState(current => ({ ...current, works: current.works.map(work => work.id === next.id ? { ...work, ...next, targets: next.targets?.length ? next.targets : work.targets } : work) }));
  const copyBadge = async work => {
    const target = attributedWorkUrl(`${PUBLIC_GAMEHUB_URL}/w/${work.id}`,'readme');
    const markdown = `[![${t('creator.badgeAlt')}](${PUBLIC_GAMEHUB_URL}/v1/works/${work.id}/badge.svg)](${target})`;
    try { if (!globalThis.navigator?.clipboard?.writeText) throw new Error('clipboard unavailable'); await globalThis.navigator.clipboard.writeText(markdown); setCopiedWorkId(work.id); globalThis.setTimeout?.(() => setCopiedWorkId(current => current === work.id ? '' : current), 1800); }
    catch { globalThis.prompt?.(t('creator.copyBadge'), markdown); }
  };
  return <main className="page creator-page">
    {savedWork && <p className="work-edit-success" role="status">{t('creator.savedWork',{title:savedWork.title})}</p>}
    <div className="section-heading"><div><span className="kicker">{overview ? 'CREATOR OVERVIEW' : 'WORK LIBRARY'}</span><h1>{t(overview ? 'creator.overviewTitle' : 'creator.worksTitle')}</h1><p>{t(overview ? 'creator.overviewLead' : 'creator.worksLead')}</p></div><div className="creator-heading-actions">{overview ? <><Button kind="secondary" onClick={() => go('/creator/works')}>{t('creator.manageWorks')}</Button><Button icon="＋" onClick={() => go('/creator/works/new')}>{t('creator.newWork')}</Button></> : <><Button kind="secondary" onClick={() => go('/creator/tools')}>{t('creator.tools')}</Button><Button kind="secondary" onClick={() => go('/creator/import')}>{t('creator.importGithub')}</Button><Button icon="＋" onClick={() => go('/creator/works/new')}>{t('creator.newWork')}</Button></>}</div></div>
    {overview ? <>
      <div className="creator-summary"><div><span>{t('creator.summaryDrafts')}</span><strong>{state.drafts.length}</strong></div><div><span>{t('creator.summaryAll')}</span><strong>{state.works.length}</strong></div><div><span>{t('creator.summaryPublished')}</span><strong>{published}</strong></div><div><span>{t('creator.summaryWithdrawn')}</span><strong>{withdrawn}</strong></div></div>
      <CreatorInsights state={insights} days={insights.days} onDays={days => setInsights(current => ({ ...current, days }))}/>
      <CreatorFeedbackInbox state={feedback} api={api} demo={demo} go={go} onReload={loadFeedback}/>
      <ContributionTaskStarter feedback={feedback} api={api} demo={demo} onCreated={async () => { setTaskRefresh(value => value + 1); await loadFeedback(); }}/>
      <CreatorContributionTasks api={api} demo={demo} go={go} AvatarView={AvatarView} refreshToken={taskRefresh} onChanged={loadFeedback}/>
    </> : <>
      <CreatorDraftShelf drafts={state.drafts} go={go}/>
      <MyProjectClaims state={claims} api={api} demo={demo} go={go} onReload={loadClaims}/>
      {state.works.length ? <section className="creator-list">{state.works.map(work => <CreatorRow work={work} api={api} demo={demo} go={go} onChanged={replaceWork} onCopyBadge={copyBadge} copied={copiedWorkId === work.id} key={work.id}/>)}</section> : <StatePanel title={t('creator.noWorksTitle')} body={t('creator.noWorksBody')} action={t('creator.newWork')} onAction={() => go('/creator/works/new')} />}
      <aside className="creator-tip"><span>{icons.spark}</span><div><strong>{t('creator.publishTip')}</strong><p>{t('creator.publishTipBody')}</p></div></aside>
    </>}
  </main>;
}

const githubVisibilityLabels = { public: 'creator.github.visibility.public', private: 'creator.github.visibility.private', internal: 'creator.github.visibility.internal' };
const githubAccountTypeLabels = { User: 'creator.github.account.user', Organization: 'creator.github.account.organization' };
const githubConnectionStatusLabels = { active: 'creator.github.connection.active', suspended: 'creator.github.connection.suspended', revoked: 'creator.github.connection.revoked' };
const githubLicenseLabels = { missing: 'creator.github.license.missing', unknown: 'creator.github.license.unknown', conflict: 'creator.github.license.conflict' };
const githubLicenseGuidance = {
  missing: { title: 'creator.github.guidance.missingTitle', body: 'creator.github.guidance.missingBody' },
  unknown: { title: 'creator.github.guidance.unknownTitle', body: 'creator.github.guidance.unknownBody' },
  conflict: { title: 'creator.github.guidance.conflictTitle', body: 'creator.github.guidance.conflictBody' }
};
const githubStaticSignalLabels = {
  indexHtml: 'creator.github.signal.indexHtml', packageJson: 'creator.github.signal.packageJson', vite: 'creator.github.signal.vite',
  three: 'creator.github.signal.three', babylon: 'creator.github.signal.babylon', unityWebgl: 'creator.github.signal.unityWebgl'
};

function GitHubImportPage({ api, demo, go, accountProfile, embedded = false }) {
  const {t}=useI18n();
  const [state, setState] = useState({ status: 'loading', connections: [], repositories: [], preview: null });
  const [selectedConnection, setSelectedConnection] = useState('');
  const [selectedRepository, setSelectedRepository] = useState('');
  const [form, setForm] = useState({ title: '', description: '', kind: 'game', attributionKind:accountProfile?.role==='admin'?'community_catalog':'publisher' });
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const loadConnections = async () => {
    setError('');
    try {
      if (demo) return setState({ status: 'ready', connections: [], repositories: [], preview: null });
      const connections = (await api.listGitHubSourceConnections()).data;
      setState(current => ({ ...current, status: 'ready', connections }));
      if (connections.length && !selectedConnection) setSelectedConnection(connections.find(item => item.status === 'active')?.id ?? connections[0].id);
    } catch (caught) { setState(current => ({ ...current, status: caught.status === 401 ? 'auth' : caught.code === 'GITHUB_SOURCE_IMPORT_DISABLED' ? 'disabled' : 'error' })); setError(caught.message || t('creator.github.connectionLoadFailed')); }
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
      go('/creator/import');
      return loadConnections();
    }).catch(caught => {
      setState(current => ({ ...current, status: caught.status === 401 ? 'auth' : 'error' }));
      setError(caught.status === 401 ? t('creator.github.sessionExpired') : caught.message || t('creator.github.callbackFailed'));
    }).finally(() => setBusy(''));
  }, [api, demo, t]);
  useEffect(() => {
    if (!selectedConnection || demo) return;
    setBusy('repositories'); setError(''); setSelectedRepository('');
    api.listGitHubSourceRepositories(selectedConnection).then(({ data }) => setState(current => ({ ...current, repositories: data, preview: null }))).catch(caught => setError(caught.message || t('creator.github.repositoriesFailed'))).finally(() => setBusy(''));
  }, [api, demo, selectedConnection, t]);
  const install = async () => {
    setBusy('install'); setError('');
    const installWindow = embedded ? globalThis.open?.('about:blank', 'gamehub-github-install', 'popup,width=900,height=820') : null;
    try {
      const result = (await api.startGitHubSourceInstall()).data;
      const stateToken = new URL(result.installUrl).searchParams.get('state');
      if (stateToken) globalThis.sessionStorage?.setItem('gamehub.github-app-state', stateToken);
      if (installWindow) { installWindow.location.replace(result.installUrl); installWindow.opener = null; }
      else globalThis.location.assign(result.installUrl);
    } catch (caught) { installWindow?.close(); setError(caught.message || t('creator.github.installFailed')); setBusy(''); }
  };
  const preview = async () => {
    if (!selectedConnection || !selectedRepository) return;
    setBusy('preview'); setError('');
    try {
      const result = (await api.previewGitHubSourceImport({ connectionId: selectedConnection, repositoryId: selectedRepository })).data;
      setState(current => ({ ...current, preview: result }));
      setForm({ title: result.repository.name || '', description: result.repository.description || '', kind: 'game', attributionKind:accountProfile?.role==='admin'?'community_catalog':'publisher' });
    } catch (caught) { setError(caught.message || t('creator.github.previewFailed')); }
    finally { setBusy(''); }
  };
  const createDraft = async event => {
    event.preventDefault(); if (!state.preview) return;
    if (state.preview.workId) return go(`/creator/works/${state.preview.workId}/builds`);
    setBusy('draft'); setError('');
    try { const result = (await api.createGitHubImportedDraft({ importId: state.preview.importId, ...form })).data; go(`/creator/works/${result.work.id}/builds`); }
    catch (caught) { setError(caught.message || t('creator.github.draftFailed')); }
    finally { setBusy(''); }
  };
  const disconnect = async connection => {
    if (!globalThis.confirm?.(t('creator.github.disconnectConfirm',{account:connection.accountLogin}))) return;
    setBusy(`disconnect-${connection.id}`); setError('');
    try { await api.disconnectGitHubSourceConnection(connection.id); setSelectedConnection(''); await loadConnections(); }
    catch (caught) { setError(caught.message || t('creator.github.disconnectFailed')); }
    finally { setBusy(''); }
  };
  if (state.status === 'loading' || busy === 'complete') return <main className="page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page"><StatePanel title={t('creator.github.authTitle')} body={t('creator.github.authBody')} action={t('creator.signInAction')} onAction={() => go('/account')}/></main>;
  if (state.status === 'disabled') return <main className="page"><StatePanel title={t('creator.github.disabledTitle')} body={t('creator.github.disabledBody')} action={t('creator.newWork')} onAction={() => go('/creator/works/new')}/></main>;
  const staticSignals = state.preview ? Object.entries(state.preview.staticSignals).filter(([, value]) => value).map(([key]) => ({ key, label: githubStaticSignalLabels[key] ? t(githubStaticSignalLabels[key]) : key })) : [];
  const licenseStatus = state.preview?.license.status;
  const licenseLabel = state.preview?.license.spdx || (githubLicenseLabels[licenseStatus] ? t(githubLicenseLabels[licenseStatus]) : t('creator.github.license.pending'));
  const licenseGuidance = githubLicenseGuidance[licenseStatus];
  const repositoryUrl = state.preview ? `https://github.com/${encodeURIComponent(state.preview.repository.owner)}/${encodeURIComponent(state.preview.repository.name)}` : '';
  return <main className="page github-import-page">
    <button className="back-link" onClick={() => go('/creator')}>{icons.back} {t('creator.backWorks')}</button>
    <div className="section-heading"><div><span className="kicker">READ-ONLY SOURCE IMPORT</span><h1>{t('creator.github.title')}</h1><p>{t('creator.github.lead')}</p></div><Button kind="github" icon={<GitHubLogo/>} onClick={install} disabled={!!busy}>{t(busy === 'install' ? 'creator.github.redirecting' : 'creator.github.connect')}</Button></div>
    <aside className="github-import-notice"><strong>{t('creator.github.noticeTitle')}</strong><p>{t('creator.github.noticeBody')}</p></aside>
    {error && <p className="form-error" role="alert">{error}</p>}
    {state.connections.length > 0 && <section className="panel github-import-step github-connections"><div className="github-step-heading"><span className="github-step-number">01</span><div><h2>{t('creator.github.chooseConnection')}</h2><p>{t('creator.github.chooseConnectionBody')}</p></div></div><div className="github-connection-list">{state.connections.map(connection => <article className={selectedConnection === connection.id ? 'is-active' : ''} key={connection.id}><button type="button" onClick={() => setSelectedConnection(connection.id)} disabled={connection.status !== 'active'}><span className="github-connection-mark"><GitHubLogo/></span><span className="github-connection-copy"><strong>{connection.accountLogin}</strong><small>{githubAccountTypeLabels[connection.accountType] ? t(githubAccountTypeLabels[connection.accountType]) : connection.accountType} · {t(connection.repositorySelection === 'all' ? 'creator.github.allRepositories' : 'creator.github.selectedRepositories')}</small></span><span className={`github-status is-${connection.status}`}>{githubConnectionStatusLabels[connection.status] ? t(githubConnectionStatusLabels[connection.status]) : connection.status}</span></button><button type="button" className="text-button" disabled={!!busy} onClick={() => disconnect(connection)}>{t('creator.github.disconnect')}</button></article>)}</div></section>}
    {selectedConnection && <section className="panel github-import-step github-repositories"><div className="github-step-heading"><span className="github-step-number">02</span><div><h2>{t('creator.github.chooseRepository')}</h2><p>{t('creator.github.chooseRepositoryBody')}</p></div></div>{busy === 'repositories' ? <p className="github-step-empty">{t('creator.github.syncing')}</p> : state.repositories.length ? <div className="github-repository-picker"><label><span>{t('creator.github.authorizedRepository')}</span><select value={selectedRepository} onChange={event => setSelectedRepository(event.target.value)}><option value="">{t('creator.github.repositoryPlaceholder')}</option>{state.repositories.map(repo => <option value={repo.repositoryId} key={repo.id}>{repo.owner}/{repo.name} · {githubVisibilityLabels[repo.visibility] ? t(githubVisibilityLabels[repo.visibility]) : repo.visibility}</option>)}</select></label><Button type="button" onClick={preview} disabled={!selectedRepository || !!busy}>{t(busy === 'preview' ? 'creator.github.reading' : 'creator.github.preview')}</Button></div> : <p className="github-step-empty">{t('creator.github.noRepositories')}</p>}</section>}
    {state.preview && <form className="panel github-import-step github-preview" onSubmit={createDraft}><div className="github-step-heading github-preview-heading"><span className="github-step-number">03</span><div><h2>{t(state.preview.workId ? 'creator.github.continueDraft' : 'creator.github.confirmSource')}</h2><p className="github-repository-name">{state.preview.repository.owner}/{state.preview.repository.name}</p></div><div className="github-preview-badges">{state.preview.workId && <span className="github-existing-badge">{t('creator.github.existingDraft')}</span>}<span className="github-visibility">{githubVisibilityLabels[state.preview.repository.visibility] ? t(githubVisibilityLabels[state.preview.repository.visibility]) : state.preview.repository.visibility}</span><span className={`github-license is-${state.preview.license.status}`}>{licenseLabel}</span></div></div><dl className="github-preview-facts"><div><dt>{t('creator.github.commit')}</dt><dd><code title={state.preview.commitSha}>{state.preview.commitSha}</code></dd></div><div><dt>{t('creator.github.defaultBranch')}</dt><dd>{state.preview.repository.defaultBranch}</dd></div><div><dt>{t('creator.github.entryDetection')}</dt><dd className="github-signal-list">{staticSignals.length ? staticSignals.map(signal => <span className={signal.key === 'indexHtml' ? 'is-ready' : ''} key={signal.key}>{signal.label}</span>) : <span className="is-warning">{t('creator.github.noEntry')}</span>}</dd></div></dl>{licenseGuidance && <aside className={`github-license-warning is-${licenseStatus}`}><div><strong>{t(licenseGuidance.title)}</strong><span>{t(licenseGuidance.body)}</span></div><ol><li>{t('creator.github.licenseStepOne')}</li><li>{t('creator.github.licenseStepTwo')}</li><li>{t('creator.github.licenseStepThree')}</li></ol><div className="github-license-help-actions"><a className="button button--secondary" href={repositoryUrl} target="_blank" rel="noopener noreferrer">{t('creator.github.openRepository')} ↗</a><Button type="button" onClick={preview} disabled={!!busy}>{t(busy === 'preview' ? 'creator.github.detecting' : 'creator.github.detectAgain')}</Button></div><small>{t('creator.github.licenseDisclaimer')}</small></aside>}{state.preview.readmeExcerpt && <details className="github-readme"><summary>{t('creator.github.readme')}</summary><pre>{state.preview.readmeExcerpt}</pre></details>}{state.preview.workId ? <div className="github-existing-draft"><div><span className="github-existing-draft__mark">↻</span><div><strong>{t('creator.github.duplicateTitle')}</strong><p>{t('creator.github.duplicateBody')}</p></div></div><Button type="button" onClick={() => go(`/creator/works/${state.preview.workId}/builds`)}>{t('creator.github.continueDraft')}</Button></div> : <><div className="github-draft-fields"><label><span>{t('creator.metadata.title')}</span><input required maxLength="120" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))}/></label><label><span>{t('creator.metadata.kind')}</span><select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value }))}><option value="game">{t('creator.metadata.kindGame')}</option><option value="creative">{t('creator.metadata.kindCreative')}</option><option value="tool">{t('creator.metadata.kindTool')}</option></select></label>{accountProfile?.role==='admin'&&<label><span>发布关系</span><select value={form.attributionKind} onChange={event=>setForm(current=>({...current,attributionKind:event.target.value}))}><option value="community_catalog">代为收录，可由原作者认领</option><option value="publisher">我或团队是发布者</option></select></label>}<label className="github-draft-description"><span>{t('creator.metadata.description')}</span><textarea maxLength="4000" placeholder={t('creator.github.descriptionPlaceholder')} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))}/></label></div><div className="github-preview-actions"><div><strong>{t('creator.github.nextBuild')}</strong><small>{t('creator.github.privateDraftBody')}</small></div><Button type="submit" disabled={!!busy}>{t(busy === 'draft' ? 'creator.github.creating' : 'creator.github.createDraft')}</Button></div></>}</form>}
  </main>;
 }

const sourceBuildLabels = { queued:'creator.build.state.queued',preparing:'creator.build.state.preparing',building:'creator.build.state.building',packaging:'creator.build.state.packaging',validating:'creator.build.state.validating',ready:'creator.build.state.ready',failed:'creator.build.state.failed',superseded:'creator.build.state.superseded' };
const sourceBuildErrorLabels = {
  SOURCE_ARCHIVE_LAYOUT_INVALID:'creator.build.error.layout', SOURCE_ARCHIVE_PATH_INVALID:'creator.build.error.path', SOURCE_ARCHIVE_UNSUPPORTED:'creator.build.error.unsupported', SOURCE_BUILD_LIMIT_EXCEEDED:'creator.build.error.limit', SOURCE_ARCHIVE_TOO_LARGE:'creator.build.error.large', BUILD_PLAN_MISMATCH:'creator.build.error.plan', BUILD_OUTPUT_TYPE_UNSUPPORTED:'creator.build.error.type', BUILD_OUTPUT_PATH_CONFLICT:'creator.build.error.conflict', ENTRY_MISSING:'creator.build.error.entry', GITHUB_SOURCE_ACCESS_LOST:'creator.build.error.access',
};
function SourceBuildPage({ workId, api, demo, go }) {
  const {t}=useI18n();
  const [source,setSource]=useState(null); const [builds,setBuilds]=useState([]); const [releaseLabel,setReleaseLabel]=useState('1.0.0'); const [subdirectory,setSubdirectory]=useState(''); const [busy,setBusy]=useState(''); const [error,setError]=useState('');
  const load=async()=>{ setError(''); try { if(demo){ setSource({ owner:'demo',name:'static-game',commitSha:'a'.repeat(40),status:'active' }); return; } const [sourceResult,buildResult]=await Promise.all([api.getWorkSource(workId),api.listSourceBuilds(workId)]); setSource(sourceResult.data); setBuilds(buildResult.data); } catch(caught){ setError(caught.message||t('creator.build.loadFailed')); } };
  useEffect(()=>{ load(); },[workId, api, demo, t]);
  useEffect(()=>{ if(demo||!builds.some(item=>['queued','preparing','building','packaging','validating'].includes(item.state)))return undefined; const timer=setInterval(()=>load(),1600); return()=>clearInterval(timer); },[api,demo,t,workId,builds.map(item=>`${item.id}:${item.state}`).join('|')]);
  const create=async event=>{ event.preventDefault(); setBusy('create'); setError(''); try { const item=demo?{ id:'demo-build',state:'ready',releaseLabel,commitSha:source.commitSha,createdAt:new Date().toISOString() }:(await api.createSourceBuild(workId,{ templateKey:'static-v1',templateVersion:'1',subdirectory,releaseLabel })).data; setBuilds(current=>[item,...current.filter(build=>build.id!==item.id)]); } catch(caught){ setError(caught.message||t('creator.build.startFailed')); } finally{ setBusy(''); } };
  const publish=async build=>{ setBusy(build.id); setError(''); try { await api.publishSourceBuild(workId,build.id); go('/creator'); } catch(caught){ setError(caught.message||t('creator.build.publishFailed')); } finally{ setBusy(''); } };
  return <main className="page source-build-page"><button className="back-link" onClick={()=>go('/creator')}>{icons.back} {t('creator.backWorks')}</button><div className="source-build-heading"><div><span className="kicker">CONTROLLED SOURCE BUILD</span><h1>{t('creator.build.title')}</h1><p>{t('creator.build.lead')}</p></div><span className="source-build-policy">STATIC-V1</span></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="source-build-layout"><form className="panel source-build-card" onSubmit={create}><div className="source-build-card__heading"><span className="github-step-number">01</span><div><small>{t('creator.build.locked')}</small><h2>{source?`${source.owner}/${source.name}`:t('creator.build.loadingSource')}</h2></div><span className="source-build-access">{t('creator.build.readonly')}</span></div>{source&&<dl className="source-build-facts"><div><dt>{t('creator.build.commit')}</dt><dd><code title={source.commitSha}>{source.commitSha}</code></dd></div><div><dt>{t('creator.build.method')}</dt><dd>{t('creator.build.staticCopy')}</dd></div><div><dt>{t('creator.build.boundary')}</dt><dd>{t('creator.build.offline')}</dd></div></dl>}<div className="source-build-fields"><label><span>{t('creator.upload.releaseLabel')}</span><input required value={releaseLabel} maxLength="64" placeholder={t('creator.build.releasePlaceholder')} onChange={event=>setReleaseLabel(event.target.value)}/><small>{t('creator.build.releaseHint')}</small></label><label><span>{t('creator.build.directory')} <em>{t('creator.build.optional')}</em></span><input value={subdirectory} maxLength="255" placeholder={t('creator.build.directoryPlaceholder')} onChange={event=>setSubdirectory(event.target.value)}/><small>{t('creator.build.directoryHint')}</small></label></div><aside className="source-build-note"><strong>{t('creator.build.what')}</strong><p>{t('creator.build.whatBody')}</p></aside><div className="source-build-actions"><div><strong>{t('creator.build.next')}</strong><small>{t('creator.build.safeFailure')}</small></div><Button type="submit" disabled={!source||!releaseLabel||!!busy}>{t(busy==='create'?'creator.build.queueing':'creator.build.start')}</Button></div><button type="button" className="source-build-manual" onClick={()=>go(`/creator/works/${workId}/upload`)}>{t('creator.build.manual')}</button></form><aside className="panel source-build-history"><div className="source-build-history__heading"><span className="kicker">BUILD HISTORY</span><h2>{t('creator.build.history')}</h2><p>{t('creator.build.historyLead')}</p></div>{builds.length?<ol>{builds.map(build=>{ const failed=build.state==='failed'; const current=['queued','preparing','building','packaging','validating'].includes(build.state); return <li className={`${build.state==='ready'?'is-done':''}${failed?' is-failed':''}${current?' is-current':''}`} key={build.id}><span>{build.state==='ready'?icons.check:failed?'!':'·'}</span><div><strong>{build.releaseLabel}</strong><em>{sourceBuildLabels[build.state]?t(sourceBuildLabels[build.state]):build.state}</em><small><code>{build.commitSha?.slice(0,8)}</code>{build.errorCode&&<><b>{sourceBuildErrorLabels[build.errorCode]?t(sourceBuildErrorLabels[build.errorCode]):t('creator.build.incomplete')}</b><code>{build.errorCode}</code></>}</small>{build.state==='ready'&&<Button type="button" disabled={!!busy} onClick={()=>publish(build)}>{t(busy===build.id?'creator.build.publishing':'creator.build.publish')}</Button>}</div></li>;})}</ol>:<div className="source-build-empty"><span>01</span><strong>{t('creator.build.emptyTitle')}</strong><p>{t('creator.build.emptyBody')}</p></div>}</aside></div></main>;
}

const agentCreatorToolkits = [
  { key: 'bingo', statusKey: 'ready', mark: '▦' },
  { key: 'bitsy', statusKey: 'guided', mark: '◫' },
  { key: 'puzzlescript', statusKey: 'guided', mark: '◆' },
  { key: 'twine', statusKey: 'guided', mark: '↝' },
  { key: 'pixel-assets', statusKey: 'asset', mark: '◇' },
];

function CreatorToolsPage({ go }) {
  const {t}=useI18n();
  const [copied, setCopied] = useState('');
  const copyPrompt = async toolkit => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(t(`creator.tools.tool.${toolkit.key}.prompt`));
      setCopied(toolkit.key);
      globalThis.setTimeout?.(() => setCopied(current => current === toolkit.key ? '' : current), 1800);
    } catch {
      globalThis.prompt?.(t('creator.tools.copyForAgent'), t(`creator.tools.tool.${toolkit.key}.prompt`));
    }
  };
  return <main className="page creation-method-page"><button className="back-link" onClick={() => go('/creator')}>{icons.back} {t('creator.backWorks')}</button>
    <section className="creation-method-hero"><div><span className="kicker">OPTIONAL CREATOR TOOLS</span><h1>{t('creator.tools.title')}</h1><p>{t('creator.tools.lead')}</p></div><span className="creation-method-hero__badge">OPTIONAL · AGENT-READABLE</span></section>
    <div className="agent-toolkit-heading"><div><span className="kicker">TOOL CATALOG</span><h2>{t('creator.tools.choose')}</h2><p>{t('creator.tools.chooseLead')}</p></div><code>gamehub-agent-plugin 0.2.0</code></div>
    <section className="creation-method-grid agent-toolkit-grid" aria-label={t('creator.tools.aria')}>{agentCreatorToolkits.map(toolkit => <article className="agent-toolkit-card" key={toolkit.key}><span className="creation-method-card__mark" aria-hidden="true">{toolkit.mark}</span><div><div className="agent-toolkit-card__meta"><small>{toolkit.key}</small><em className={`is-${toolkit.statusKey}`}>{t(`creator.tools.status.${toolkit.statusKey}`)}</em></div><h2>{t(`creator.tools.tool.${toolkit.key}.title`)}</h2><p>{t(`creator.tools.tool.${toolkit.key}.description`)}</p><dl><div><dt>{t('creator.tools.location')}</dt><dd>{t('creator.tools.local')}</dd></div><div><dt>{t('creator.tools.output')}</dt><dd>{t(`creator.tools.tool.${toolkit.key}.output`)}</dd></div></dl><blockquote>{t(`creator.tools.tool.${toolkit.key}.prompt`)}</blockquote></div><button className="agent-toolkit-copy" type="button" onClick={() => copyPrompt(toolkit)}>{t(copied === toolkit.key ? 'creator.tools.copied' : 'creator.tools.copyTask')}</button></article>)}</section>
    <aside className="creator-tool-note agent-toolkit-boundary"><strong>{t('creator.tools.independent')}</strong><p>{t('creator.tools.independentBody')}</p></aside>
  </main>;
}

function RetiredStudioPage({ go }) {
  const {t}=useI18n();
  return <main className="page narrow-page"><StatePanel title={t('creator.tools.retiredTitle')} body={t('creator.tools.retiredBody')} action={t('creator.tools.retiredAction')} onAction={() => go('/creator/tools')}/></main>;
}

function CreatorDraftReviewPage({ draftId, api, demo, go }) {
  const {t}=useI18n();
  const [state, setState] = useState({ status: 'loading', draft: null, preview: '', error: '' });
  const [releaseLabel, setReleaseLabel] = useState('1.0.0');
  const [build, setBuild] = useState({ phase: 'idle', uploadId: '', message: '' });
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const draft = demo ? { id: draftId, studio: 'bingo', title: t('creator.draftReview.demoTitle'), content: { tableTitle: t('creator.draftReview.demoResult') }, revision: '1' } : (await api.getCreatorDraft(draftId)).data;
        let preview = '';
        try { preview = demo ? `<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;padding:32px}main{border:1px solid #222;padding:24px}</style><main><h1>${t('creator.draftReview.demoTitle')}</h1><p>${t('creator.draftReview.readonlyTitle')}</p></main>` : (await api.previewCreatorDraft(draft.id)).data.html; }
        catch (caught) { if (live) setState({ status: 'error', draft, preview: '', error: caught.message || t('creator.draftReview.previewFailed') }); return; }
        if (live) setState({ status: 'ready', draft, preview, error: '' });
      } catch (caught) {
        if (live) setState({ status: caught.status === 401 ? 'auth' : 'error', draft: null, preview: '', error: caught.message || t('creator.draftReview.loadFailed') });
      }
    };
    load();
    return () => { live = false; };
  }, [api, demo, draftId, t]);
  useEffect(() => {
    if (!build.uploadId || !['queued', 'processing'].includes(build.phase) || demo) return undefined;
    let live = true; let timer;
    const poll = async () => {
      try {
        const upload = (await api.getUpload(build.uploadId)).data;
        if (!live) return;
        if (['failed', 'expired', 'review_required'].includes(upload.state)) setBuild(current => ({ ...current, phase: 'failed', message: upload.errorCode || t('creator.draftReview.validationFailed') }));
        else if (upload.state === 'succeeded') setBuild(current => ({ ...current, phase: upload.publicationOutcome === 'published' ? 'published' : 'ready', message: t(upload.publicationOutcome === 'published' ? 'creator.draftReview.published' : 'creator.draftReview.ready') }));
        else { setBuild(current => ({ ...current, phase: 'processing', message: t('creator.draftReview.validating') })); timer = globalThis.setTimeout(poll, 1800); }
      } catch (caught) { if (live) setBuild(current => ({ ...current, phase: 'failed', message: caught.message || t('creator.draftReview.statusFailed') })); }
    };
    timer = globalThis.setTimeout(poll, 800);
    return () => { live = false; globalThis.clearTimeout(timer); };
  }, [api, build.uploadId, build.phase, demo, t]);
  const startBuild = async () => {
    if (!state.draft || !releaseLabel.trim() || ['building', 'queued', 'processing'].includes(build.phase)) return;
    setBuild({ phase: 'building', uploadId: '', message: t('creator.draftReview.building') });
    try {
      if (demo) { setBuild({ phase: 'published', uploadId: 'demo-upload', message: t('creator.draftReview.demoPublished') }); return; }
      const result = (await api.buildCreatorDraft(state.draft.id, { releaseLabel: releaseLabel.trim() }, state.draft.revision)).data;
      setBuild({ phase: 'queued', uploadId: result.upload.id, message: t('creator.draftReview.queued') });
    } catch (caught) { setBuild({ phase: 'failed', uploadId: '', message: caught.message || t('creator.draftReview.buildFailed') }); }
  };
  if (state.status === 'loading') return <main className="page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page"><StatePanel title={t('creator.draftReview.signInTitle')} body={t('creator.draftReview.signInBody')} action={t('creator.signInAction')} onAction={() => go('/account')}/></main>;
  if (state.status !== 'ready' || !state.draft) return <main className="page"><StatePanel title={t('creator.draftReview.notOpen')} body={state.error || t('creator.draftReview.chooseAgain')} action={t('creator.backCenter')} onAction={() => go('/creator')}/></main>;
  return <main className="page studio-draft-page"><button className="back-link" onClick={() => go('/creator')}>{icons.back} {t('creator.backCenter')}</button><header className="studio-draft-header"><div><span className="kicker">AGENT IMPORT · READ ONLY</span><h1>{state.draft.title}</h1></div><div className="studio-save-state is-saved"><i/>{t('creator.draftReview.snapshot')}<small>{t('common.revision',{value:state.draft.revision})}</small></div></header><aside className="creator-draft-readonly-note"><strong>{t('creator.draftReview.readonlyTitle')}</strong><p>{t('creator.draftReview.readonlyBody')}</p></aside><div className="creator-draft-review-layout"><section className="studio-preview"><div className="studio-preview__head"><div><span className="kicker">SANDBOX PREVIEW</span><h2>{t('creator.draftReview.preview')}</h2><p>{t('creator.draftReview.previewBody')}</p></div><span>REV {state.draft.revision}</span></div><iframe className="studio-preview-frame" title={t('creator.draftReview.previewAria')} sandbox="allow-scripts" srcDoc={state.preview}/></section><aside className="panel creator-draft-release"><span className="kicker">PUBLISH SNAPSHOT</span><h2>{t('creator.draftReview.publishTitle')}</h2><p>{t('creator.draftReview.publishBody')}</p><label>{t('creator.upload.releaseLabel')}<input maxLength="64" value={releaseLabel} onChange={event => setReleaseLabel(event.target.value)}/></label><Button type="button" disabled={!releaseLabel.trim() || ['building', 'queued', 'processing'].includes(build.phase)} onClick={startBuild}>{t(['building', 'queued', 'processing'].includes(build.phase) ? 'creator.draftReview.buildingButton' : 'creator.draftReview.publishButton')}</Button>{build.message && <p className={`studio-build-status is-${build.phase}`} role="status">{build.message}</p>}{['published', 'ready'].includes(build.phase) && <button className="text-button" type="button" onClick={() => go('/creator')}>{t('creator.draftReview.manage')}</button>}</aside></div></main>;
}

const newBingoContent = t => ({
  tableTitle: t('creator.studio.defaultTableTitle'), subtitle: t('creator.studio.defaultSubtitle'),
  columnHeaders: ['period','animation','comics','games','movies'].map(key=>t(`creator.studio.column.${key}`)),
  rowHeaders: ['beforePrimary','primary','middle','high','college','working','recent','classics'].map(key=>t(`creator.studio.row.${key}`)),
  cells: {},
});
const splitStudioLines = value => value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean).slice(0, 30);
const escapeStudioMarkup = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const demoBingoPreview = (content,emptyLabel) => {
  const columns = content.columnHeaders ?? []; const rows = content.rowHeaders ?? [];
  return `<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;margin:0;padding:24px;color:#17191f;background:#f5f5f2}main{background:white;border:1px solid #ccd0d7;padding:24px;overflow:auto}h1{margin:0 0 4px}p{color:#68707e}table{border-collapse:collapse;min-width:680px;width:100%;table-layout:fixed}th,td{border:1px solid #cfd2d8;padding:12px;text-align:center}thead th,tbody th{background:#f4f5f6}button{border:0;background:white;width:100%;min-height:50px}button:focus,button:hover{background:#ff5964;color:white}</style><main><h1>${escapeStudioMarkup(content.tableTitle)}</h1><p>${escapeStudioMarkup(content.subtitle)}</p><table><thead><tr>${columns.map(item => `<th>${escapeStudioMarkup(item)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr><th>${escapeStudioMarkup(row)}</th>${columns.slice(1).map((_item, offset) => `<td><button>${escapeStudioMarkup(content.cells?.[`${rowIndex}:${offset + 1}`] || emptyLabel)}</button></td>`).join('')}</tr>`).join('')}</tbody></table></main>`;
};

function StudioDraftPage({ draftId, studio, api, demo, go }) {
  const {t}=useI18n();
  const supported = studio === 'bingo';
  const [draft, setDraft] = useState(() => draftId ? null : { id: null, studio, schemaVersion: 1, title: t('creator.studio.untitled'), content: newBingoContent(t), revision: '0' });
  const [phase, setPhase] = useState(draftId ? 'loading' : 'new');
  const [saveState, setSaveState] = useState('idle'); const [error, setError] = useState('');
  const [preview, setPreview] = useState({ html: '', revision: '', loading: false, error: '' });
  const [releaseLabel, setReleaseLabel] = useState('1.0.0');
  const [build, setBuild] = useState({ phase: 'idle', uploadId: '', workId: '', message: '' });
  const savedSignature = useRef('');
  useEffect(() => {
    if (!draftId || !supported) return;
    let live = true; setPhase('loading'); setError('');
    (demo ? Promise.resolve({ data: { id: draftId, studio: 'bingo', schemaVersion: 1, title: t('creator.studio.demoTitle'), content: newBingoContent(t), revision: '1' } }) : api.getCreatorDraft(draftId)).then(({ data }) => {
      if (!live) return; savedSignature.current = JSON.stringify({ title: data.title, content: data.content }); setDraft(data); setSaveState('saved'); setPhase('editing');
    }).catch(caught => { if (live) { setError(caught.message || t('creator.studio.error.read')); setPhase(caught.status === 401 ? 'auth' : 'error'); } });
    return () => { live = false; };
  }, [api, demo, draftId, supported, t]);
  useEffect(() => {
    if (!draft?.id || phase !== 'editing') return undefined;
    const signature = JSON.stringify({ title: draft.title, content: draft.content });
    if (signature === savedSignature.current) return undefined;
    setSaveState('pending');
    const timer = globalThis.setTimeout(async () => {
      const payload = { title: draft.title, schemaVersion: draft.schemaVersion, content: draft.content };
      setSaveState('saving'); setError('');
      try {
        const saved = demo ? { ...draft, revision: String(Number(draft.revision) + 1), updatedAt: new Date().toISOString() } : (await api.updateCreatorDraft(draft.id, payload, draft.revision)).data;
        savedSignature.current = signature;
        setDraft(current => current ? { ...current, revision: saved.revision, updatedAt: saved.updatedAt } : current);
        setSaveState('saved');
      } catch (caught) { setSaveState('error'); setError(caught.message || t('creator.studio.error.autosave')); }
    }, 900);
    return () => globalThis.clearTimeout(timer);
  }, [api, demo, draft?.id, draft?.revision, draft?.title, draft?.content, phase, t]);
  const refreshPreview = async () => {
    if (!draft?.id || ['pending', 'saving'].includes(saveState)) return;
    setPreview(current => ({ ...current, loading: true, error: '' }));
    try {
      const data = demo ? { html: demoBingoPreview(draft.content,t('creator.studio.emptyCell')), revision: draft.revision } : (await api.previewCreatorDraft(draft.id)).data;
      setPreview({ html: data.html, revision: data.revision, loading: false, error: '' });
    } catch (caught) { setPreview(current => ({ ...current, loading: false, error: caught.message || t('creator.studio.error.preview') })); }
  };
  useEffect(() => {
    if (!draft?.id || phase !== 'editing' || !['idle', 'saved'].includes(saveState)) return;
    refreshPreview();
  }, [draft?.id, draft?.revision, phase, saveState]);
  useEffect(() => {
    if (!build.uploadId || !['queued', 'processing'].includes(build.phase) || demo) return undefined;
    let live = true; let timer;
    const poll = async () => {
      try {
        const upload = (await api.getUpload(build.uploadId)).data;
        if (!live) return;
        if (upload.state === 'failed' || upload.state === 'expired' || upload.state === 'review_required') setBuild(current => ({ ...current, phase: 'failed', message: upload.errorCode || t('creator.studio.error.validation') }));
        else if (upload.state === 'succeeded') setBuild(current => ({ ...current, phase: upload.publicationOutcome === 'published' ? 'published' : 'ready', message: t(upload.publicationOutcome === 'published' ? 'creator.studio.published' : 'creator.studio.keptDraft') }));
        else { setBuild(current => ({ ...current, phase: 'processing', message: t('creator.studio.validating') })); timer = globalThis.setTimeout(poll, 1800); }
      } catch (caught) { if (live) setBuild(current => ({ ...current, phase: 'failed', message: caught.message || t('creator.studio.error.buildStatus') })); }
    };
    timer = globalThis.setTimeout(poll, 800);
    return () => { live = false; globalThis.clearTimeout(timer); };
  }, [api, build.uploadId, build.phase, demo, t]);
  if (!supported) return <main className="page"><StatePanel title={t('creator.studio.unsupported')} body={t('creator.studio.unsupportedLead')} action={t('creator.studio.backMethods')} onAction={() => go('/creator/works/new')}/></main>;
  if (phase === 'loading') return <main className="page"><LoadingCards/></main>;
  if (phase === 'auth') return <main className="page"><StatePanel title={t('creator.studio.signInTitle')} body={t('creator.studio.signInLead')} action={t('creator.signInAction')} onAction={() => go('/account')}/></main>;
  if (phase === 'error' || !draft) return <main className="page"><StatePanel title={t('creator.studio.notOpen')} body={error || t('creator.studio.chooseAgain')} action={t('creator.backCenter')} onAction={() => go('/creator')}/></main>;
  const updateContent = patch => setDraft(current => ({ ...current, content: { ...current.content, ...patch } }));
  const create = async event => {
    event.preventDefault(); setSaveState('saving'); setError('');
    try {
      const created = demo ? { ...draft, id: globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000001', revision: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : (await api.createCreatorDraft({ studio: 'bingo', schemaVersion: 1, title: draft.title, content: draft.content })).data;
      savedSignature.current = JSON.stringify({ title: created.title, content: created.content }); setDraft(created); setPhase('editing'); setSaveState('saved'); go(`/creator/drafts/${created.id}`);
    } catch (caught) { setSaveState('error'); setError(caught.message || t('creator.studio.error.create')); }
  };
  const columns = draft.content.columnHeaders?.length ? draft.content.columnHeaders : [t('creator.studio.item')];
  const rows = draft.content.rowHeaders ?? [];
  const updateCell = (rowIndex, columnIndex, value) => updateContent({ cells: { ...(draft.content.cells ?? {}), [`${rowIndex}:${columnIndex}`]: value.slice(0, 200) } });
  const startBuild = async () => {
    if (!draft.id || !releaseLabel.trim() || !['idle', 'saved'].includes(saveState)) return;
    setBuild({ phase: 'building', uploadId: '', workId: draft.workId || '', message: t('creator.studio.building') }); setError('');
    try {
      if (demo) { setBuild({ phase: 'published', uploadId: 'demo-upload', workId: 'demo-work', message: t('creator.studio.demoPublished') }); return; }
      const result = (await api.buildCreatorDraft(draft.id, { releaseLabel: releaseLabel.trim() }, draft.revision)).data;
      setDraft(current => current ? { ...current, workId: result.workId } : current);
      setBuild({ phase: 'queued', uploadId: result.upload.id, workId: result.workId, message: t('creator.studio.queued') });
    } catch (caught) { setBuild({ phase: 'failed', uploadId: '', workId: draft.workId || '', message: caught.message || t('creator.studio.error.buildStart') }); }
  };
  const saveLabel = t(phase === 'new' ? 'creator.studio.save.notCreated' : saveState === 'saving' ? 'creator.studio.save.saving' : saveState === 'pending' ? 'creator.studio.save.pending' : saveState === 'error' ? 'creator.studio.save.error' : 'creator.studio.save.saved');
  return <main className="page studio-draft-page"><button className="back-link" onClick={() => go('/creator/works/new')}>{icons.back} {t('creator.backPublish')}</button>
    <header className="studio-draft-header"><div><span className="kicker">BINGO · PUBLISHING DRAFT</span><input aria-label={t('creator.studio.draftName')} maxLength="120" value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}/></div><div className={`studio-save-state is-${saveState}`}><i/>{saveLabel}{draft.id && <small>{t('common.revision',{value:draft.revision})}</small>}</div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="studio-editor-shell" onSubmit={create}><section className="studio-controls"><div><span className="studio-step">01</span><h2>{t('creator.studio.structureTitle')}</h2><p>{t('creator.studio.structureLead')}</p></div><label>{t('creator.studio.tableTitle')}<input required maxLength="120" value={draft.content.tableTitle ?? ''} onChange={event => updateContent({ tableTitle: event.target.value })}/></label><label>{t('creator.studio.subtitle')}<input maxLength="160" value={draft.content.subtitle ?? ''} onChange={event => updateContent({ subtitle: event.target.value })}/></label><label>{t('creator.studio.columnTitles')}<textarea value={(draft.content.columnHeaders ?? []).join('\n')} onChange={event => updateContent({ columnHeaders: splitStudioLines(event.target.value) })}/><small>{t('creator.studio.columnHint')}</small></label><label>{t('creator.studio.rowTitles')}<textarea className="studio-rows-input" value={(draft.content.rowHeaders ?? []).join('\n')} onChange={event => updateContent({ rowHeaders: splitStudioLines(event.target.value) })}/><small>{t('creator.studio.dimensions',{rows:rows.length,columns:columns.length})}</small></label>
      {columns.length > 1 && rows.length > 0 && <div className="studio-cell-editor"><div><span className="studio-step">02</span><h2>{t('creator.studio.cellsTitle')}</h2><p>{t('creator.studio.cellsLead')}</p></div><div className="studio-cell-editor__scroll"><table><thead><tr><th>{columns[0]}</th>{columns.slice(1).map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row}-${rowIndex}`}><th>{row}</th>{columns.slice(1).map((_column, offset) => <td key={offset}><input aria-label={`${row} · ${columns[offset + 1]}`} maxLength="200" placeholder={t('creator.studio.itemPlaceholder')} value={draft.content.cells?.[`${rowIndex}:${offset + 1}`] ?? ''} onChange={event => updateCell(rowIndex, offset + 1, event.target.value)}/></td>)}</tr>)}</tbody></table></div></div>}
      {phase === 'new' ? <Button type="submit" disabled={saveState === 'saving' || !draft.title.trim()}>{t(saveState === 'saving' ? 'creator.studio.creating' : 'creator.studio.createDraft')}</Button> : <section className="studio-build-panel"><div><span className="studio-step">03</span><h2>{t('creator.studio.buildTitle')}</h2><p>{t('creator.studio.buildLead')}</p></div><label>{t('creator.upload.releaseLabel')}<input maxLength="64" value={releaseLabel} onChange={event => setReleaseLabel(event.target.value)}/></label><Button type="button" disabled={!releaseLabel.trim() || !['idle', 'saved'].includes(saveState) || ['building', 'queued', 'processing'].includes(build.phase)} onClick={startBuild}>{t(['building', 'queued', 'processing'].includes(build.phase) ? 'creator.studio.buildingButton' : draft.workId ? 'creator.studio.publishVersion' : 'creator.studio.publishWork')}</Button>{build.message && <p className={`studio-build-status is-${build.phase}`} role="status">{build.message}</p>}{['published', 'ready'].includes(build.phase) && <button className="text-button" type="button" onClick={() => go('/creator')}>{t('creator.studio.manage')} →</button>}<small className="studio-foundation-note">{t('creator.studio.publishNote')}</small></section>}</section>
      <section className="studio-preview"><div className="studio-preview__head"><div><span className="kicker">SANDBOX PREVIEW</span><h2>{t('creator.studio.previewTitle')}</h2><p>{preview.revision ? t('creator.studio.previewRevision',{revision:preview.revision}) : t('creator.studio.previewLead')}</p></div><div><span>{rows.length} × {columns.length}</span>{draft.id && <button type="button" onClick={refreshPreview} disabled={preview.loading || ['pending', 'saving'].includes(saveState)}>{t(preview.loading ? 'creator.studio.generating' : 'creator.studio.refreshPreview')}</button>}</div></div>{preview.error && <p className="form-error">{preview.error}</p>}{preview.html ? <iframe className="studio-preview-frame" title={t('creator.studio.previewAria')} sandbox="allow-scripts" srcDoc={preview.html}/> : <div className="studio-table-wrap"><table><thead><tr>{columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row}-${rowIndex}`}>{columns.map((_, columnIndex) => columnIndex === 0 ? <th scope="row" key={columnIndex}>{row}</th> : <td key={columnIndex}><span/></td>)}</tr>)}</tbody></table></div>}{!rows.length && <p className="studio-preview__empty">{t('creator.studio.previewEmpty')}</p>}</section></form>
  </main>;
}

function NewWorkPage({ api, demo, go, accountProfile }) {
  const {t}=useI18n();
  const [form, setForm] = useState({ title: '', description: '', instructions: '', kind: 'game', estimatedMinutes: '3', tags: '', agentLabel: '', repositoryUrl: '', licenseSpdx: '', remixSourceWorkId: '', remixNote: '',attributionKind:accountProfile?.role==='admin'?'community_catalog':'publisher' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [remixOptions,setRemixOptions]=useState([]);
  useEffect(()=>{let live=true;(demo?Promise.resolve({data:demoWorks.filter(work=>work.remixable)}):api.listWorks({limit:50,remixable:true})).then(({data})=>{if(live)setRemixOptions(data);}).catch(()=>{});return()=>{live=false;};},[api,demo]);
  const submit = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const payload = { ...workMetadataPayload(form, { t }), kind: form.kind,attributionKind:form.attributionKind }; const work = demo ? { id: demoWorks[0].id } : (await api.createWork(payload)).data; go(`/creator/works/${work.id}/upload`); }
    catch (caught) { setError(caught.message || t('creator.new.failed')); }
    finally { setBusy(false); }
  };
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  return <main className="page narrow-page"><button className="back-link" onClick={() => go('/creator')}>{icons.back} {t('creator.backWorks')}</button><form className="panel new-work-form" onSubmit={submit}><span className="kicker">NEW PROJECT</span><h1>{t('creator.new.title')}</h1><p>{t('creator.new.lead')}</p>{accountProfile?.role==='admin'&&<label>发布关系<select name="attributionKind" value={form.attributionKind} onChange={update}><option value="community_catalog">代为收录，可由原作者认领</option><option value="publisher">我或团队是发布者</option></select><small>上传方式不代表作者身份；代为上传的开源游戏请选择“可认领”。</small></label>}<WorkMetadataFields form={form} onChange={update} kind={form.kind} onKindChange={update} remixOptions={remixOptions}/>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{t(busy?'creator.new.creating':'creator.new.createUpload')}</Button></form></main>;
}

function CreatorRow({ work, api, demo, go, onChanged, onCopyBadge, copied }) {
  const {t,date}=useI18n();
  const [history, setHistory] = useState({ open: false, loading: false, items: [], error: '' });
  const [withdrawing, setWithdrawing] = useState(false);
  const [publishing, setPublishing] = useState('');
  const [actionError, setActionError] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);
  const statusKey = work.state === 'published' ? 'published' : work.state === 'withdrawn' ? 'withdrawn' : work.state === 'suspended' ? 'suspended' : 'draft';
  const status = t(`creator.work.state.${statusKey}`);
  const toggleHistory = async () => {
    if (history.open) return setHistory(current => ({ ...current, open: false }));
    setHistory(current => ({ ...current, open: true, loading: !current.items.length, error: '' }));
    if (history.items.length) return;
    try {
      const items = demo ? [{ id: 'demo-release', targetKey: 'web', label: '1.0.0', packageType: 'web_zip', validationState: 'ready', servingState: work.state === 'published' ? 'enabled' : 'disabled', createdAt: new Date().toISOString() }] : (await api.listWorkReleases(work.id)).data;
      setHistory({ open: true, loading: false, items, error: '' });
    } catch (error) { setHistory({ open: true, loading: false, items: [], error: error.message || t('creator.work.historyFailed') }); }
  };
  const withdraw = async () => {
    if (!globalThis.confirm?.(t('creator.work.withdrawConfirm',{title:work.title}))) return;
    setWithdrawing(true); setActionError('');
    try {
      const next = demo ? { ...work, state: 'withdrawn', visibility: 'private', revision: String(Number(work.revision) + 1) } : (await api.withdrawWork(work.id, work.revision)).data;
      onChanged(next);
      setHistory(current => ({ ...current, items: current.items.map(item => ({ ...item, servingState: 'disabled' })) }));
    } catch (error) {
      setActionError(error.message || t('creator.work.withdrawFailed'));
    } finally { setWithdrawing(false); }
  };
  const publishRelease = async release => {
    if (!globalThis.confirm?.(t('creator.work.publishReleaseConfirm',{label:release.label,title:work.title}))) return;
    setPublishing(release.id); setActionError('');
    try {
      const result = demo ? { work:{...work,state:'published',visibility:'public',revision:String(Number(work.revision)+1)},releaseId:release.id } : (await api.publishWorkRelease(work.id,release.id,work.revision)).data;
      onChanged(result.work);
      setHistory(current => ({ ...current,items:current.items.map(item => ({...item,servingState:item.id===result.releaseId?'enabled':item.servingState==='revoked'?'revoked':'disabled'})) }));
    } catch (error) { setActionError(error.message || t('creator.work.publishReleaseFailed')); }
    finally { setPublishing(''); }
  };
  const uploadCover = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return setActionError(t('creator.work.coverInvalid'));
    setCoverBusy(true); setActionError('');
    const preview = URL.createObjectURL(file); setCoverPreview(preview);
    try { if (!demo) onChanged((await api.uploadWorkCover(work.id, file)).data); }
    catch (error) { URL.revokeObjectURL(preview); setCoverPreview(''); setActionError(error.message || t('creator.work.coverFailed')); }
    finally { setCoverBusy(false); }
  };
  return <div className="creator-entry"><article><Art work={{ ...work, coverUrl: coverPreview || work.coverUrl }}/><div className="creator-row__main"><h3>{work.title}</h3><p>{t('creator.work.meta',{revision:work.revision,source:work.sourceProvider === 'github' ? t('creator.work.githubImport') : ''})}</p></div><span className={`status-pill ${statusKey === 'published' ? 'is-success' : ''} ${statusKey === 'withdrawn' ? 'is-muted' : ''}`}>{status}</span><div className="creator-row-actions"><button className="text-button" onClick={() => go(`/creator/works/${work.id}/edit`)}>{t('creator.work.edit')}</button><button className="text-button" onClick={() => go(`/creator/works/${work.id}/development`)}>{t('creator.work.log')}</button><label className="cover-upload"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={coverBusy} onChange={uploadCover}/>{t(coverBusy ? 'creator.work.coverProcessing' : work.coverUrl ? 'creator.work.coverReplace' : 'creator.work.coverUpload')}</label><button className="text-button" onClick={toggleHistory}>{t(history.open ? 'creator.work.hideHistory' : 'creator.work.history')}</button>{work.state === 'published' && <button className="text-button badge-copy" type="button" onClick={() => onCopyBadge(work)}>{t(copied ? 'creator.work.badgeCopied' : 'creator.copyBadge')}</button>}{work.sourceProvider === 'github' && <Button kind="secondary" onClick={() => go(`/creator/works/${work.id}/builds`)}>{t('creator.work.continueBuild')}</Button>}<Button kind="secondary" onClick={() => go(`/creator/works/${work.id}/upload`)}>{t('creator.work.uploadNew')}</Button>{work.state === 'published' && <button className="danger-button" disabled={withdrawing} onClick={withdraw}>{t(withdrawing ? 'creator.work.withdrawing' : 'creator.work.withdraw')}</button>}</div></article><div className="creator-entry-ai"><span>{t('creator.work.extendAi')}</span><button className="text-button" onClick={() => go(`/creator/works/${work.id}/ai/multiplayer`)}>{t('creator.work.addMultiplayer')}</button><button className="text-button" onClick={() => go(`/creator/works/${work.id}/ai/leaderboards`)}>{t('creator.work.addLeaderboard')}</button></div>{actionError && <p className="creator-action-error form-error" role="alert">{actionError}</p>}{history.open && <section className="release-history" aria-live="polite">{history.loading ? <p>{t('creator.work.loadingReleases')}</p> : history.error ? <p className="form-error">{history.error}</p> : history.items.length ? <ol>{history.items.map(item => <li key={item.id}><div><strong>{item.label}</strong><small>{item.targetKey} · {item.packageType === 'web_zip' ? 'Web ZIP' : item.packageType}</small></div><span className={item.servingState === 'enabled' ? 'release-live' : item.validationState === 'ready' ? 'release-ready' : ''}>{t(item.servingState === 'enabled' ? 'creator.work.releasePublic' : item.validationState === 'ready' ? 'creator.work.releaseReady' : 'creator.work.releaseProcessing')}</span>{item.validationState === 'ready' && item.servingState === 'disabled' && <button className="release-publish" type="button" disabled={Boolean(publishing)} onClick={() => publishRelease(item)}>{t(publishing===item.id?'creator.work.publishingRelease':'creator.work.publishRelease')}</button>}<time>{date(item.createdAt,{dateStyle:'short',timeStyle:'short'})}</time></li>)}</ol> : <p>{t('creator.work.noReleases')}</p>}</section>}</div>;
}

function DemoUploadPage({ workId, go }) {
  const {t}=useI18n();
  const [file, setFile] = useState(null); const [upload, setUpload] = useState(demoUploads[0]); const [progress, setProgress] = useState(100);
  const display = uploadDisplay(upload,{t});
  const choose = e => { const next = e.target.files[0]; if (next) { setFile(next); setUpload({ ...upload, state: 'created', publicationOutcome: 'pending', fileName: next.name, declaredBytes: String(next.size), actualBytes: null }); setProgress(0); } };
  const start = () => { setUpload(u => ({ ...u, state: 'receiving' })); let value = 0; const timer = setInterval(() => { value += 10; setProgress(value); if (value >= 100) { clearInterval(timer); setUpload(u => ({ ...u, state: 'validating', actualBytes: u.declaredBytes })); } }, 90); };
  return <main className="page upload-page"><div className="upload-heading"><button className="back-link" onClick={() => go('/creator')}>{icons.back} {t('creator.backWorks')}</button><span className="kicker">NEW RELEASE</span><h1>{t('creator.upload.webTitle')}</h1><p>{t('creator.upload.demoLead')}</p></div><div className="upload-layout"><section className="panel upload-form"><label className="file-drop"><input type="file" accept=".zip,application/zip" onChange={choose}/><span className="file-icon">{icons.file}</span><strong>{file?.name ?? upload.fileName ?? t('creator.upload.chooseWeb')}</strong><small>{file ? `${(file.size / 1048576).toFixed(1)} MB` : t('creator.upload.demoLimit')}</small><em>{t(file ? 'creator.upload.chooseAgain' : 'creator.upload.browse')}</em></label><div className="form-grid"><label>{t('creator.upload.releaseLabel')}<input defaultValue="1.4.0"/></label><label>{t('creator.upload.target')}<select defaultValue="web"><option value="web">{t('creator.upload.webSidebar')}</option></select></label></div><label className="check-row"><input type="checkbox" defaultChecked/><span><strong>{t('creator.upload.autoPublish')}</strong><small>{t('creator.upload.keepCurrent')}</small></span></label>{upload.state === 'created' && <Button icon={icons.upload} onClick={start}>{t('creator.upload.start')}</Button>}{upload.state === 'receiving' && <div className="byte-progress"><div><span>{t('creator.upload.uploading')}</span><strong>{progress}%</strong></div><progress value={progress} max="100"/><button>{t('creator.cancel')}</button></div>}{!['created','receiving'].includes(display.state) && <UploadStatusNote display={display}/>}</section><UploadTimeline display={display}/></div></main>;
}

const sha256 = async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');

function LiveUploadPage({ workId, api, go }) {
  const {t}=useI18n();
  const [file, setFile] = useState(null); const [upload, setUpload] = useState(null); const [progress, setProgress] = useState(0); const [phase, setPhase] = useState('select'); const [error, setError] = useState(''); const [releaseLabel, setReleaseLabel] = useState('1.0.0'); const [targetKey, setTargetKey] = useState('web'); const controller = useRef(null);
  const watch = async (uploadId, signal) => {
    while (!signal.aborted) {
      const { data } = await api.getUpload(uploadId, { signal }); if (signal.aborted) return; setUpload(data);
      if (isUploadTerminalState(data.state)) { sessionStorage.removeItem(`gamehub-upload:${workId}`); setPhase(data.state === 'succeeded' ? 'done' : 'error'); if (data.state !== 'succeeded') setError(uploadDisplay(data,{t}).description); return; }
      await new Promise(resolve => setTimeout(resolve, 1400));
    }
  };
  useEffect(() => {
    setUpload(null); setFile(null); setProgress(0); setError(''); setPhase('select');
    const stop = () => { controller.current?.abort(); controller.current = null; };
    const uploadId = sessionStorage.getItem(`gamehub-upload:${workId}`); if (!uploadId) return stop;
    controller.current = new AbortController(); const signal = controller.current.signal;
    (async () => {
      const { data } = await api.getUpload(uploadId, { signal }); if (signal.aborted) return; setUpload(data); setTargetKey(data.targetKey || 'web');
      if (['created', 'receiving'].includes(data.state)) { setPhase('select'); return; }
      if (data.state === 'uploaded') { setPhase('processing'); await api.completeUpload(uploadId, { signal }); await watch(uploadId, signal); return; }
      if (isUploadTerminalState(data.state)) { sessionStorage.removeItem(`gamehub-upload:${workId}`); setPhase(data.state === 'succeeded' ? 'done' : 'error'); if (data.state !== 'succeeded') setError(uploadDisplay(data,{t}).description); return; }
      setPhase('processing'); await watch(uploadId, signal);
    })().catch(caught => { if (!signal.aborted) { setError(caught.message); setPhase('error'); } });
    return stop;
  }, [workId, api, t]);
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
    } catch (caught) { if (controller.current?.signal === signal && (!signal.aborted || caught.code === 'UPLOAD_CANCELLED')) { setError(caught.message || t('creator.upload.incomplete')); setPhase('error'); } }
  };
  const display = uploadDisplay(upload, { phase,t });
  const displayedBytes = upload?.actualBytes ?? file?.size ?? upload?.declaredBytes;
  return <main className="page upload-page"><div className="upload-heading"><button className="back-link" onClick={() => go('/creator')}>{icons.back} {t('creator.backWorks')}</button><span className="kicker">NEW RELEASE</span><h1>{t('creator.upload.title',{target:targetKey === 'web' ? 'Web' : 'Windows'})}</h1><p>{t(targetKey === 'web' ? 'creator.upload.webLead' : 'creator.upload.windowsLead')}</p></div><div className="upload-layout"><section className="panel upload-form"><label className="file-drop"><input type="file" accept={targetKey === 'web' ? '.zip,application/zip' : '.exe,application/vnd.microsoft.portable-executable,application/octet-stream'} disabled={!['select','error'].includes(phase)} onChange={choose}/><span className="file-icon">{icons.file}</span><strong>{file?.name ?? upload?.fileName ?? t(targetKey === 'web'?'creator.upload.chooseWeb':'creator.upload.chooseExe')}</strong><small>{displayedBytes !== undefined && displayedBytes !== null ? formatBytes(displayedBytes) : t(targetKey === 'web' ? 'creator.upload.webLimit' : 'creator.upload.exeLimit')}</small><em>{t(file ? 'creator.upload.chooseAgain' : 'creator.upload.browse')}</em></label><div className="form-grid"><label>{t('creator.upload.releaseLabel')}<input value={releaseLabel} disabled={phase !== 'select'} onChange={event => setReleaseLabel(event.target.value.slice(0,64))}/></label><label>{t('creator.upload.target')}<select value={targetKey} disabled={phase !== 'select'} onChange={event => { setTargetKey(event.target.value); setFile(null); setUpload(null); setProgress(0); setError(''); }}><option value="web">{t('creator.upload.webSidebar')}</option><option value="windows-x64">{t('creator.upload.windowsStandalone')}</option></select></label></div><label className="check-row"><input type="checkbox" defaultChecked disabled/><span><strong>{t('creator.upload.autoPublish')}</strong><small>{t('creator.upload.keepCurrent')}</small></span></label>{phase === 'select' && <Button icon={icons.upload} disabled={!file || !releaseLabel} onClick={start}>{t('creator.upload.start')}</Button>}{phase === 'hashing' && <div className="processing-note"><span className="spinner"/><div><strong>{t('creator.upload.hashing')}</strong><p>{t('creator.upload.hashingBody')}</p></div></div>}{phase === 'receiving' && <div className="byte-progress"><div><span>{t('creator.upload.uploading')}</span><strong>{progress}%</strong></div><progress value={progress} max="100"/><button onClick={() => controller.current?.abort()}>{t('creator.upload.cancelTransfer')}</button></div>}{['processing','done'].includes(phase) && <UploadStatusNote display={display}/>}{error && <div className="form-error" role="alert">{error}<button onClick={() => setPhase('select')}>{t('creator.upload.chooseAgain')}</button></div>}</section><UploadTimeline display={display}/></div></main>;
}

function UploadPage(props) { return props.demo ? <DemoUploadPage {...props}/> : <LiveUploadPage {...props}/>; }

function LibraryPage({ api, go, demo }) {
  const { t } = useI18n();
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => { let live = true; (async () => { try { const data = demo ? demoWorks.slice(0,2).map((work,index) => ({ work, savedAt: index ? null : new Date().toISOString(), lastPlayedAt: new Date().toISOString(), playCount: 1 })) : (await api.listLibrary()).data; if (live) setState({ status: 'ready', items: data }); } catch (caught) { if (live) setState({ status: caught.status === 401 ? 'auth' : 'error', items: [] }); } })(); return () => { live = false; }; }, [api,demo]);
  const saved = state.items.filter(item => item.savedAt); const recent = state.items.filter(item => item.lastPlayedAt);
  return <main className="page library-page"><div className="section-heading"><div><span className="kicker">YOUR SPACE</span><h1>{t('library.title')}</h1><p>{t('library.lead')}</p></div></div>{state.status === 'loading' ? <LoadingCards/> : state.status === 'auth' ? <StatePanel title={t('library.signInTitle')} body={t('library.signInLead')} action={t('library.signIn')} onAction={() => go('/account')}/> : state.status === 'error' ? <StatePanel title={t('library.failedTitle')} body={t('library.failedLead')}/> : !state.items.length ? <StatePanel title={t('library.emptyTitle')} body={t('library.emptyLead')} action={t('library.discover')} onAction={() => go('/discover')}/> : <>{!!saved.length && <section className="library-section"><h2>{t('library.saved')}</h2><div className="work-grid">{saved.map(item => <WorkCard key={item.workId} work={item.work} go={go}/>)}</div></section>}{!!recent.length && <section className="library-section"><h2>{t('library.recent')}</h2><div className="quiet-work-list">{recent.map(item => <QuietWorkRow key={item.workId} work={item.work} go={go}/>)}</div></section>}</>}</main>;
}

const profileLinkKinds = { github: 'profile.link.github', website: 'profile.link.website', portfolio: 'profile.link.portfolio', bilibili: 'profile.link.bilibili', other: 'profile.link.other' };
const collaborationLabels = { not_looking: 'profile.collaboration.notLooking', open_to_collaboration: 'profile.collaboration.open', available_for_hire: 'profile.collaboration.available' };
const profileDraft = profile => ({
  handle: profile.handle, headline: profile.headline, about: profile.about, visibility: profile.visibility,
  libraryVisibility: profile.libraryVisibility, collaborationStatus: profile.collaborationStatus ?? 'not_looking', skills: profile.skills ?? [], skillsText: (profile.skills ?? []).join('，'),
  activityVisibility: profile.activityVisibility ?? 'private', achievementsVisibility: profile.achievementsVisibility ?? 'followers',
  links: profile.links.map(link => ({ ...link })), featuredWorkIds: profile.featuredWorks.map(work => work.id), githubRepositoryIds: profile.githubRepositories.map(repository => repository.id),
});
const demoPublicProfile = handle => ({
  id: 'demo-user', handle: handle || 'miyazaki1', displayName: 'Miyazaki1', headline: '独立游戏创作者，喜欢把小想法做成可以马上玩的作品。',
  about: '我在墨鱼工坊制作适合工作间隙体验的轻量游戏。关注玩法原型、像素视觉和 Agent 协作开发。\n\n这里展示的是我主动公开的资料与作品；私人游戏库和未发布项目不会出现在主页。',
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
  const { t, date } = useI18n();
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
      setEditing(false); setNotice(t('profile.saved')); if (profile.handle !== handle) go(`/u/${profile.handle}`);
    } catch (caught) { setError(caught.message || t('profile.error.save')); }
    finally { setBusy(''); }
  };
  const follow = async () => {
    const profile = state.profile; setBusy('follow'); setError('');
    try {
      if (!demo) await (profile.isFollowing ? api.unfollowUser(profile.id) : api.followUser(profile.id));
      setState(current => ({ ...current, profile: { ...current.profile, isFollowing: !profile.isFollowing, followerCount: Math.max(0, profile.followerCount + (profile.isFollowing ? -1 : 1)) } }));
    } catch (caught) { if (caught.status === 401) go('/account'); else setError(caught.message || t('profile.error.follow')); }
    finally { setBusy(''); }
  };
  const share = async () => {
    const url = `${location.origin}/u/${state.profile.handle}`;
    try { await navigator.clipboard.writeText(url); setNotice(t('profile.linkCopied')); } catch { globalThis.prompt?.(t('profile.copyLink'), url); }
  };
  const updateLink = (index, key, value) => setDraft(current => ({ ...current, links: current.links.map((link, at) => at === index ? { ...link, [key]: value } : link) }));
  const toggleFeatured = workId => setDraft(current => ({ ...current, featuredWorkIds: current.featuredWorkIds.includes(workId) ? current.featuredWorkIds.filter(id => id !== workId) : current.featuredWorkIds.length < 6 ? [...current.featuredWorkIds, workId] : current.featuredWorkIds }));
  const toggleGitHubRepository = repositoryId => setDraft(current => ({ ...current, githubRepositoryIds: current.githubRepositoryIds.includes(repositoryId) ? current.githubRepositoryIds.filter(id => id !== repositoryId) : current.githubRepositoryIds.length < 6 ? [...current.githubRepositoryIds, repositoryId] : current.githubRepositoryIds }));
  if (state.status === 'loading') return <main className="page public-profile-page"><LoadingCards/></main>;
  if (state.status === 'missing') return <main className="page"><StatePanel title={t('profile.missing')} body={t('profile.missingLead')} action={t('common.backDiscover')} onAction={() => go('/discover')}/></main>;
  if (state.status === 'error') return <main className="page"><StatePanel title={t('profile.loadFailed')} body={t('profile.loadFailedLead')} action={t('common.retry')} onAction={load}/></main>;
  const profile = state.profile; const featuredIds = new Set(profile.featuredWorks.map(work => work.id)); const remaining = profile.works.filter(work => !featuredIds.has(work.id));
  return <main className={`page public-profile-page ${editing ? 'is-editing' : 'is-viewing'}`}>
    <button className="back-link" onClick={() => go('/discover')}>{icons.back} {t('common.backDiscover')}</button>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="social-notice" role="status">{notice}</p>}
    {editing && <section className="profile-settings-header"><div><span className="kicker">PROFILE STUDIO</span><h1>{t('profile.settingsTitle')}</h1><p>{t('profile.settingsLead')}</p></div><div><span className="profile-settings-handle">@{profile.handle}</span><Button kind="secondary" onClick={() => setEditing(false)}>{t('profile.backProfile')}</Button></div></section>}
    <section className="public-profile-hero panel"><div className="public-profile-avatar"><AvatarView avatar={profile.avatar} api={api} alt={t('profile.avatarAlt',{name:profile.displayName})}/></div><div className="public-profile-copy"><span className="kicker">{profile.creator ? 'CREATOR PROFILE' : 'PLAYER PROFILE'}</span><h1>{profile.displayName}</h1><p className="public-profile-handle">@{profile.handle}</p><p className="public-profile-headline">{profile.headline || t('profile.noHeadline')}</p><div className={`collaboration-badge collaboration-badge--${profile.collaborationStatus}`}>{t(collaborationLabels[profile.collaborationStatus])}</div>{!!profile.skills.length && <div className="profile-skill-list">{profile.skills.map(skill => <span key={skill}>{skill}</span>)}</div>}<div className="public-profile-meta"><span>{t('profile.followers',{count:profile.followerCount})}</span><span>{t('profile.following',{count:profile.followingCount})}</span><span>{t('profile.publicWorksCount',{count:profile.works.length})}</span></div><div className="public-profile-links">{profile.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"><b>{t(profileLinkKinds[link.kind]||'profile.link.other')}</b>{link.label} ↗</a>)}</div></div><div className="public-profile-actions">{profile.isMe ? <Button onClick={() => setEditing(true)}>{t('profile.edit')}</Button> : <Button disabled={busy === 'follow'} onClick={follow}>{t(profile.isFollowing?'profile.followingButton':'profile.follow')}</Button>}{COMMUNITY_ENABLED&&<Button kind="secondary" onClick={() => go('/community/author/' + profile.id)}>{t('profile.viewShares')}</Button>}<Button kind="secondary" onClick={share}>{t('profile.share')}</Button></div></section>
    {editing && draft && <form className="public-profile-editor panel" onSubmit={save}><div className="settings-panel__head"><div><span className="kicker">PUBLIC IDENTITY</span><h2>{t('profile.editTitle')}</h2><p>{t('profile.editLead')}</p></div><span className="pixel-label">@{draft.handle}</span></div><div className="form-grid"><label>{t('profile.address')}<input required pattern="[a-z][a-z0-9-]{2,31}" maxLength="32" value={draft.handle} onChange={event => setDraft(current => ({ ...current, handle: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}/><small>mooyu.fun/u/{draft.handle || 'your-name'}</small></label><label>{t('profile.visibility')}<select value={draft.visibility} onChange={event => setDraft(current => ({ ...current, visibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label><label>{t('profile.libraryVisibility')}<select value={draft.libraryVisibility} onChange={event => setDraft(current => ({ ...current, libraryVisibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select><small>{t('profile.libraryVisibilityLead')}</small></label></div><label>{t('profile.headline')}<textarea maxLength="160" value={draft.headline} onChange={event => setDraft(current => ({ ...current, headline: event.target.value }))}/><small>{Array.from(draft.headline).length}/160</small></label><label>{t('profile.about')}<textarea className="profile-about-input" maxLength="2000" value={draft.about} onChange={event => setDraft(current => ({ ...current, about: event.target.value }))} placeholder={t('profile.aboutPlaceholder')}/><small>{Array.from(draft.about).length}/2000</small></label><fieldset><legend>{t('profile.externalLinks')}</legend>{draft.links.map((link,index) => <div className="profile-link-editor" key={index}><select value={link.kind} onChange={event => updateLink(index, 'kind', event.target.value)}>{Object.entries(profileLinkKinds).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select><input aria-label={t('profile.linkName')} maxLength="40" value={link.label} onChange={event => updateLink(index, 'label', event.target.value)} placeholder={t('profile.linkNamePlaceholder')}/><input aria-label={t('profile.linkUrl')} type="url" pattern="https://.*" value={link.url} onChange={event => updateLink(index, 'url', event.target.value)} placeholder="https://"/><button type="button" onClick={() => setDraft(current => ({ ...current, links: current.links.filter((_,at) => at !== index) }))}>{t('profile.remove')}</button></div>)}{draft.links.length < 5 && <button className="add-profile-link" type="button" onClick={() => setDraft(current => ({ ...current, links: [...current.links, { kind: 'website', label: '', url: 'https://' }] }))}>＋ {t('profile.addLink')}</button>}</fieldset>{profile.works.length > 0 && <fieldset><legend>{t('profile.featuredPicker')}</legend><div className="featured-work-picker">{profile.works.map(work => <label key={work.id}><input type="checkbox" checked={draft.featuredWorkIds.includes(work.id)} disabled={!draft.featuredWorkIds.includes(work.id) && draft.featuredWorkIds.length >= 6} onChange={() => toggleFeatured(work.id)}/><span><strong>{work.title}</strong><small>{t(work.kind === 'game' ? 'discover.game' : 'discover.creative')} · {t('detail.plays',{count:Number(work.playCount||0),formatted:work.playCount||0})}</small></span></label>)}</div></fieldset>}<div className="dialog-actions"><Button type="button" kind="secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy === 'save'}>{t(busy === 'save' ? 'profile.saving' : 'profile.save')}</Button></div></form>}
    {editing && draft && <section className="public-profile-editor panel"><div className="settings-panel__head"><div><span className="kicker">PROFILE DETAILS</span><h2>{t('profile.detailsTitle')}</h2><p>{t('profile.detailsLead')}</p></div><span className="pixel-label">PHASE 2</span></div><div className="form-grid"><label>{t('profile.collaboration')}<select value={draft.collaborationStatus} onChange={event => setDraft(current => ({ ...current, collaborationStatus: event.target.value }))}>{Object.entries(collaborationLabels).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label><label>{t('profile.activityVisibility')}<select value={draft.activityVisibility} onChange={event => setDraft(current => ({ ...current, activityVisibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label><label>{t('profile.achievementVisibility')}<select value={draft.achievementsVisibility} onChange={event => setDraft(current => ({ ...current, achievementsVisibility: event.target.value }))}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label></div><label>{t('profile.skills')}<input value={draft.skillsText} onChange={event => { const skillsText = event.target.value; setDraft(current => ({ ...current, skillsText, skills: skillsText.split(/[，,]/).map(value => value.trim()).filter(Boolean).slice(0,12) })); }} placeholder={t('profile.skillsPlaceholder')}/><small>{t('profile.skillsLimit',{count:draft.skills.length})}</small></label><div className="dialog-actions"><Button type="button" disabled={busy === 'save'} onClick={() => save()}>{t(busy === 'save' ? 'profile.saving' : 'profile.saveDetails')}</Button></div></section>}
    {editing && profile.creator && <section className="public-profile-editor panel"><div className="settings-panel__head"><div><span className="kicker">VERIFIED GITHUB</span><h2>{t('profile.githubTitle')}</h2><p>{t('profile.githubLead')}</p></div><span className="pixel-label">{draft.githubRepositoryIds.length}/6</span></div>{githubOptionsLoading ? <p>{t('profile.githubLoading')}</p> : githubRepositoryOptions.length ? <div className="featured-work-picker">{githubRepositoryOptions.map(repository => <label key={repository.id}><input type="checkbox" checked={draft.githubRepositoryIds.includes(repository.id)} disabled={!draft.githubRepositoryIds.includes(repository.id) && draft.githubRepositoryIds.length >= 6} onChange={() => toggleGitHubRepository(repository.id)}/><span><strong>{repository.owner}/{repository.name}</strong><small>{t('profile.githubVerified')}</small></span></label>)}</div> : <p>{t('profile.githubEmpty')}</p>}<div className="dialog-actions"><Button type="button" disabled={busy === 'save'} onClick={() => save()}>{t(busy === 'save' ? 'profile.saving' : 'profile.saveGithub')}</Button></div></section>}
    <section className="public-profile-body"><article className="panel public-profile-about"><span className="kicker">ABOUT</span><h2>{t('profile.aboutName',{name:profile.displayName})}</h2><p>{profile.about || t('profile.noAbout')}</p></article><aside className="panel public-profile-summary"><span className="kicker">PROFILE</span><dl><div><dt>{t('profile.identity')}</dt><dd>{t(profile.creator ? 'profile.identity.creator' : 'profile.identity.player')}</dd></div><div><dt>{t('profile.joined')}</dt><dd>{date(profile.joinedAt,{dateStyle:'medium'})}</dd></div><div><dt>{t('profile.collaboration')}</dt><dd>{t(collaborationLabels[profile.collaborationStatus])}</dd></div><div><dt>{t('profile.publicScope')}</dt><dd>{t(socialVisibilityLabels[profile.visibility])}</dd></div></dl></aside></section>
    {profile.achievementsVisible && profile.achievements && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">ACHIEVEMENTS</span><h2>{t('profile.achievementsTitle')}</h2><p>{t('profile.achievementsLead')}</p></div></div><div className="profile-stat-grid"><div><PixelAchievementIcon kind="calendar"/><span className="profile-stat-copy"><strong>{profile.achievements.totalDays}</strong><span>{t('profile.stat.days')}</span></span></div><div><PixelAchievementIcon kind="flame"/><span className="profile-stat-copy"><strong>{profile.achievements.longestStreak}</strong><span>{t('profile.stat.streak')}</span></span></div><div><PixelAchievementIcon kind="trophy"/><span className="profile-stat-copy"><strong>{profile.achievements.challengeWins}</strong><span>{t('profile.stat.wins')}</span></span></div><div><PixelAchievementIcon kind="crown"/><span className="profile-stat-copy"><strong>{profile.achievements.bestDailyRank ? `#${profile.achievements.bestDailyRank}` : '—'}</strong><span>{t('profile.stat.bestRank')}</span></span></div></div>{!!profile.achievements.badges.length && <div className="profile-badge-grid">{profile.achievements.badges.map(badge => <div key={badge.key}><PixelAchievementIcon kind={achievementBadgeIcon(badge.key)}/><strong>{badge.name}</strong><small>{badge.description}</small></div>)}</div>}</section>}
    {profile.activityVisible && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">ACTIVITY</span><h2>{t('profile.activityTitle')}</h2><p>{t('profile.activityLead')}</p></div></div>{profile.activity.length ? <ol className="profile-activity-list">{profile.activity.map((item,index) => <li key={`${item.type}-${item.occurredAt}-${index}`}><span>{t(item.type === 'work_published' ? 'profile.activity.publish' : 'profile.activity.play')}</span><div><strong>{item.title}</strong><time dateTime={item.occurredAt}>{date(item.occurredAt,{dateStyle:'medium'})}</time></div></li>)}</ol> : <p className="quiet-all-seen">{t('profile.activityEmpty')}</p>}</section>}
    {!!profile.contributions?.length && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">OPEN SOURCE CONTRIBUTIONS</span><h2>{t('profile.contributionsTitle')}</h2><p>{t('profile.contributionsLead')}</p></div></div><div className="profile-contribution-grid">{profile.contributions.map(item => <article key={item.taskId}><span>{item.workTitle}</span><h3>{item.title}</h3><time>{date(item.completedAt,{dateStyle:'medium'})}</time><div>{item.issueUrl && <a href={item.issueUrl} target="_blank" rel="noopener noreferrer">Issue ↗</a>}<a href={item.submissionUrl} target="_blank" rel="noopener noreferrer">{t('profile.viewOutcome')} ↗</a></div></article>)}</div></section>}
    {!!profile.githubRepositories.length && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">OPEN SOURCE</span><h2>{t('profile.repositoriesTitle')}</h2><p>{t('profile.repositoriesLead')}</p></div></div><div className="profile-repository-grid">{profile.githubRepositories.map(repository => <a key={repository.id} href={repository.url} target="_blank" rel="noopener noreferrer"><GitHubLogo/><span><strong>{repository.owner}/{repository.name}</strong><small>{t('profile.publicRepository')} ↗</small></span></a>)}</div></section>}
    {!!profile.featuredWorks.length && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">FEATURED WORK</span><h2>{t('profile.featuredTitle')}</h2><p>{t('profile.featuredLead')}</p></div></div><div className="work-grid">{profile.featuredWorks.map(work => <WorkCard key={work.id} work={work} go={go}/>)}</div></section>}
    <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">PUBLIC WORKS</span><h2>{t('profile.publicWorksTitle')}</h2><p>{t('profile.publicWorksLead')}</p></div></div>{remaining.length ? <div className="work-grid">{remaining.map(work => <WorkCard key={work.id} work={work} go={go}/>)}</div> : !profile.works.length ? <StatePanel title={t('profile.noWorks')} body={t('profile.noWorksLead')}/> : <p className="quiet-all-seen">{t('profile.allFeatured')}</p>}</section>
    {profile.libraryVisible && <section className="profile-work-section"><div className="section-heading"><div><span className="kicker">GAME LIBRARY</span><h2>{t('profile.libraryTitle')}</h2><p>{t(profile.isMe ? 'profile.libraryOwnLead' : 'profile.libraryOtherLead',{name:profile.displayName})}</p></div></div>{profile.library.length ? <div className="work-grid">{profile.library.map(work => <WorkCard key={work.id} work={work} go={go}/>)}</div> : <StatePanel title={t('profile.libraryEmpty')} body={t('profile.libraryEmptyLead')}/>}</section>}
  </main>;
}

const reportCategoryLabels = { unsafe: '不安全或越权', malware: '恶意代码或欺骗', harassment: '骚扰或仇恨', copyright: '版权问题', other: '其他问题' };

const socialVisibilityLabels = { public: 'social.visibility.public', followers: 'social.visibility.followers', private: 'social.visibility.private' };
const reactionLabels = { gg: 'GG', spark: '✦', wow: '!!', coffee: '▣' };
const reactionNames = { gg: 'social.reaction.gg', spark: 'social.reaction.spark', wow: 'social.reaction.wow', coffee: 'social.reaction.coffee' };

function SocialPage({ api, go, demo }) {
  const { t, date } = useI18n();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const [scope, setScope] = useState('global');
  const [state, setState] = useState({ status: 'loading', profile: null, board: [], notifications: [], challenges: [], retention: null, preferences: { follow: true, reaction: true, challenge: true } });
  const [bio, setBio] = useState(''); const [visibility, setVisibility] = useState('public');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = async selectedScope => {
    setState(current => ({ ...current, status: 'loading' })); setError('');
    try {
      if (demo) {
        const profile = { id: 'demo-user', handle: 'miyazaki1', displayName: t('social.demo.player'), bio: t('social.demo.bio'), visibility: 'public', avatar: demoAccountProfile.avatar, followerCount: 7, followingCount: 3, isFollowing: false, isMe: true };
        const pal = { ...profile, id: 'demo-pal', handle: 'pixel-pal', displayName: t('social.demo.friend'), isMe: false, isFollowing: true };
        const board = [{ rank: 1, player: pal, guessedCount: 8, elapsedSeconds: 39, hints: 0, reactions: { gg: 3, spark: 2 }, myReaction: 'gg' }, { rank: 2, player: profile, guessedCount: 10, elapsedSeconds: 58, hints: 1, reactions: { coffee: 1 }, myReaction: null }];
        const notifications = [{ id: 'demo-note-1', type: 'reaction', actor: pal, puzzleDate: today, reaction: 'spark', read: false, createdAt: new Date().toISOString() }, { id: 'demo-note-2', type: 'follow', actor: pal, puzzleDate: null, reaction: null, read: true, createdAt: new Date(Date.now() - 3600000).toISOString() }];
        const challenges = [{ code: 'PIXEL-DEMO-1', role: 'participant', status: 'completed', outcome: 'win', opponent: pal, myScore: { hints: 0, guessedCount: 7, elapsedSeconds: 34 }, opponentScore: { hints: 0, guessedCount: 8, elapsedSeconds: 39 } }];
        const retention = { currentStreak: 3, longestStreak: 7, totalDays: 12, completedChallenges: 4, badges: ['first_break','streak_3','streak_7','challenger','duel_winner'].map(key=>({key,name:t(`social.badge.${key}.name`),description:t(`social.badge.${key}.description`),unlocked:true})) };
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
    catch (caught) { setError(caught.message || t('social.error.settings')); }
    finally { setBusy(''); }
  };
  const toggleFollow = async player => {
    setBusy(player.id); setError('');
    try {
      if (!demo) await (player.isFollowing ? api.unfollowUser(player.id) : api.followUser(player.id));
      setState(current => ({ ...current, board: current.board.map(entry => entry.player.id === player.id ? { ...entry, player: { ...entry.player, isFollowing: !player.isFollowing, followerCount: Math.max(0, entry.player.followerCount + (player.isFollowing ? -1 : 1)) } } : entry) }));
    } catch (caught) { setError(caught.message || t('social.error.follow')); }
    finally { setBusy(''); }
  };
  const block = async player => {
    if (!globalThis.confirm?.(t('social.blockConfirm',{name:player.displayName}))) return;
    setBusy(player.id); setError('');
    try { if (!demo) await api.blockUser(player.id); setState(current => ({ ...current, board: current.board.filter(entry => entry.player.id !== player.id) })); }
    catch (caught) { setError(caught.message || t('social.error.block')); }
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
    } catch (caught) { setError(caught.message || t('social.error.reaction')); }
    finally { setBusy(''); }
  };
  const copy = async text => { try { await navigator.clipboard.writeText(text); setNotice(t('social.copied')); } catch { setError(t('social.error.clipboard')); } };
  const copyScore = entry => copy(t('social.scoreCard',{date:today,rank:entry.rank,hints:entry.hints,characters:entry.guessedCount,seconds:entry.elapsedSeconds}));
  const createChallenge = async entry => {
    setBusy('challenge'); setError('');
    try {
      const code = demo ? 'PIXEL-DEMO-1' : (await api.createGuessBaikeChallenge(today)).data.code;
      await copy(`${location.origin}/challenge/${code}`);
      setNotice(t('social.challengeCopied'));
    } catch (caught) { setError(caught.message || t('social.error.challenge')); }
    finally { setBusy(''); }
  };
  const markRead = async () => {
    setBusy('notifications');
    try { if (!demo) await api.markSocialNotificationsRead(); setState(current => ({ ...current, notifications: current.notifications.map(item => ({ ...item, read: true })) })); }
    catch (caught) { setError(caught.message || t('social.error.notifications')); }
    finally { setBusy(''); }
  };
  const togglePreference = async key => {
    const preferences = { ...state.preferences, [key]: !state.preferences[key] };
    setBusy(`preference-${key}`); setError('');
    try { const saved = demo ? preferences : (await api.updateNotificationPreferences(preferences)).data; setState(current => ({ ...current, preferences: saved })); }
    catch (caught) { setError(caught.message || t('social.error.preferences')); }
    finally { setBusy(''); }
  };
  if (state.status === 'loading') return <main className="page social-page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page social-page"><StatePanel title={t('social.signInTitle')} body={t('social.signInLead')} action={t('social.signIn')} onAction={() => go('/account')}/></main>;
  if (state.status === 'error') return <main className="page social-page"><StatePanel title={t('social.loadFailed')} body={t('social.loadFailedLead')} action={t('social.reconnect')} onAction={() => load(scope)}/></main>;
  const unread = state.notifications.filter(item => !item.read).length;
  return <main className="page social-page"><button className="back-link" onClick={()=>go(workLeaderboardPath(GUESS_BAIKE_WORK_ID))}>← {t('social.backLeaderboard')}</button><div className="section-heading"><div><span className="kicker">PLAYER CENTER</span><h1>{t('social.title')}</h1><p>{t('social.lead')}</p></div><span className="social-date">DAILY / {today.slice(5).replace('-', '/')}</span></div>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="social-notice" role="status">{notice}</p>}<div className="social-grid">
    <section className="social-board panel"><div className="social-board__head"><div><span className="kicker">{t('social.gameTitle')}</span><h2>{t('social.todayBoard')}</h2></div><div className="filter-row"><button className={scope === 'global' ? 'is-active' : ''} onClick={() => setScope('global')}>{t('social.scope.global')}</button><button className={scope === 'following' ? 'is-active' : ''} onClick={() => setScope('following')}>{t('social.scope.following')}</button></div></div>{state.board.length ? <ol>{state.board.map(entry => <li className={entry.player.isMe ? 'is-me' : ''} key={entry.player.id}><b className="social-rank">#{entry.rank}</b><AvatarView avatar={entry.player.avatar} api={api} alt=""/><div className="social-player"><strong>{entry.player.displayName}{entry.player.isMe && <em>YOU</em>}</strong><small>{t('social.score',{hints:entry.hints,characters:entry.guessedCount,seconds:entry.elapsedSeconds})}</small></div><div className="social-actions">{entry.player.isMe ? <><button onClick={() => copyScore(entry)}>{t('social.copyScore')}</button><button onClick={() => createChallenge(entry)} disabled={busy === 'challenge'}>{t('social.createChallenge')}</button></> : <><button onClick={() => toggleFollow(entry.player)} disabled={busy === entry.player.id}>{t(entry.player.isFollowing?'social.followingButton':'social.follow')}</button><button className="social-block" onClick={() => block(entry.player)} disabled={busy === entry.player.id}>{t('social.block')}</button></>}</div>{!entry.player.isMe && <div className="social-reactions" aria-label={t('social.reactionAria',{name:entry.player.displayName})}>{Object.entries(reactionLabels).map(([value,label]) => <button title={t(reactionNames[value])} aria-pressed={entry.myReaction === value} className={entry.myReaction === value ? 'is-active' : ''} disabled={busy === `reaction-${entry.player.id}`} onClick={() => react(entry,value)} key={value}><span>{label}</span>{Number(entry.reactions?.[value] || 0) > 0 && <b>{entry.reactions[value]}</b>}</button>)}</div>}</li>)}</ol> : <div className="social-empty"><strong>{t(scope === 'following' ? 'social.emptyFollowing' : 'social.emptyGlobal')}</strong><p>{t('social.emptyLead')}</p></div>}</section>
    <div className="social-side">
      <aside className="social-profile panel"><span className="kicker">MY PLAYER CARD</span><div className="social-profile__identity"><AvatarView avatar={state.profile.avatar} api={api} alt={t('social.myAvatar')}/><div><h2>{state.profile.displayName}</h2><p>{t('social.followMeta',{followers:state.profile.followerCount,following:state.profile.followingCount})}</p></div></div><form onSubmit={saveSettings}><label>{t('social.bio')}<textarea maxLength="160" value={bio} onChange={event => setBio(event.target.value)} placeholder={t('social.bioPlaceholder')}/></label><label>{t('social.whoCanSee')}<select value={visibility} onChange={event => setVisibility(event.target.value)}>{Object.entries(socialVisibilityLabels).map(([value,label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label><small>{t('social.bioPrivacy',{count:Array.from(bio).length})}</small><Button type="submit" disabled={busy === 'settings'}>{t(busy === 'settings' ? 'social.saving' : 'social.saveCard')}</Button></form>{state.retention && <div className="retention-card"><div><span><b>{state.retention.currentStreak}</b> {t('social.days')}</span><small>{t('social.currentStreak')}</small></div><div><span><b>{state.retention.longestStreak}</b> {t('social.days')}</span><small>{t('social.longestStreak')}</small></div><div><span><b>{state.retention.totalDays}</b> {t('social.sessions')}</span><small>{t('social.breakDays')}</small></div><ol>{state.retention.badges.map(item => <li className={item.unlocked ? 'is-unlocked' : ''} title={item.description} key={item.key}><i>{item.unlocked ? '◆' : '◇'}</i><span>{item.name}</span></li>)}</ol></div>}</aside>
      <section className="social-notifications panel"><div><span className="kicker">SIGNALS</span><h2>{t('social.notifications')} {unread > 0 && <em>{unread}</em>}</h2>{unread > 0 && <button onClick={markRead} disabled={busy === 'notifications'}>{t('social.markAllRead')}</button>}</div>{state.notifications.length ? <ol>{state.notifications.slice(0,6).map(item => <li className={item.read ? '' : 'is-unread'} key={item.id}><AvatarView avatar={item.actor.avatar} api={api} alt=""/><p><strong>{item.actor.displayName}</strong>{t(item.type === 'follow' ? 'social.notification.follow' : item.type === 'challenge_complete' ? 'social.notification.challenge' : 'social.notification.reaction',{outcome:t(item.outcome === 'win' ? 'social.outcome.youWon' : item.outcome === 'loss' ? 'social.outcome.opponentWon' : 'social.outcome.draw'),reaction:reactionLabels[item.reaction]})}</p><time>{date(item.createdAt,{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol> : <p className="social-notifications__empty">{t('social.noNotifications')}</p>}<div className="notification-preferences"><small>{t('social.notificationPreferences')}</small>{['follow','reaction','challenge'].map(key => <button className={state.preferences[key] ? 'is-on' : ''} disabled={busy === `preference-${key}`} onClick={() => togglePreference(key)} key={key}><i/>{t(`social.preference.${key}`)}</button>)}</div></section>
      <section className="social-challenges panel"><span className="kicker">CHALLENGE LOG</span><h2>{t('social.challengeLog')}</h2>{state.challenges.length ? <ol>{state.challenges.slice(0,5).map(item => <li key={item.code}><div><strong>{item.opponent?.displayName || t('social.waitingPlayer')}</strong><small>{t(item.role === 'creator' ? 'social.role.created' : 'social.role.accepted')} · {t(item.status === 'completed' ? (item.outcome === 'win' ? 'social.outcome.win' : item.outcome === 'loss' ? 'social.outcome.loss' : 'social.outcome.draw') : item.status === 'expired' ? 'social.status.expired' : 'social.status.inProgress')}</small></div>{item.status === 'pending' && item.role === 'participant' && <button onClick={() => go(`/play/${GUESS_BAIKE_WORK_ID}/challenge/${item.code}`)}>{t('social.continue')}</button>}</li>)}</ol> : <p className="social-notifications__empty">{t('social.noChallenges')}</p>}</section>
    </div>
  </div></main>;
}

function ChallengePage({ api, go, demo, code }) {
  const { t } = useI18n();
  const [state, setState] = useState({ status: 'loading', challenge: null });
  const [accepting, setAccepting] = useState(false); const [acceptError, setAcceptError] = useState('');
  useEffect(() => { let live = true; (async () => { try {
    const challenge = demo ? { code, puzzleDate: new Date().toLocaleDateString('en-CA',{ timeZone: 'Asia/Shanghai' }), expiresAt: new Date(Date.now()+3600000).toISOString(), creator: { displayName: t('social.demo.friend'), avatar: demoAccountProfile.avatar }, score: { hints: 0, guessedCount: 8, elapsedSeconds: 39 } } : (await api.getGuessBaikeChallenge(code)).data;
    if (live) setState({ status: 'ready', challenge });
  } catch (caught) { if (live) setState({ status: caught.status === 401 ? 'auth' : 'error', challenge: null }); } })(); return () => { live = false; }; }, [api,code,demo]);
  if (state.status === 'loading') return <main className="page challenge-page"><LoadingCards/></main>;
  if (state.status === 'auth') return <main className="page challenge-page"><StatePanel title={t('challenge.signInTitle')} body={t('challenge.signInLead')} action={t('social.signIn')} onAction={() => go('/account')}/></main>;
  if (state.status === 'error') return <main className="page challenge-page"><StatePanel title={t('challenge.expired')} body={t('challenge.expiredLead')} action={t('challenge.backLeaderboard')} onAction={() => go('/games/guess-baike/community')}/></main>;
  const item = state.challenge;
  const accept = async () => { setAccepting(true); setAcceptError(''); try { if (!demo) await api.acceptGuessBaikeChallenge(code); go(`/play/${GUESS_BAIKE_WORK_ID}/challenge/${code}`); } catch (caught) { setAcceptError(caught.message || t('challenge.error.accept')); } finally { setAccepting(false); } };
  return <main className="page challenge-page"><section className="challenge-card panel"><span className="kicker">PIXEL CHALLENGE</span><AvatarView avatar={item.creator.avatar} api={api} alt={t('challenge.creatorAlt')}/><p>{t('challenge.invite',{name:item.creator.displayName})}</p><div className="challenge-score"><span>{item.score.hints}<small>{t('challenge.hints')}</small></span><span>{item.score.guessedCount}<small>{t('challenge.characters')}</small></span><span>{item.score.elapsedSeconds}<small>{t('challenge.seconds')}</small></span></div><h1>{t('challenge.title')}</h1><p className="challenge-note">{t('challenge.lead')}</p>{acceptError && <p className="form-error">{acceptError}</p>}<Button icon={icons.play} disabled={accepting || item.status === 'completed'} onClick={accept}>{t(accepting ? 'challenge.accepting' : item.status === 'accepted' && item.acceptedByMe ? 'challenge.continue' : 'challenge.accept')}</Button><button className="back-link" onClick={() => go('/games/guess-baike/community')}>{t('challenge.notNow')}</button></section></main>;
}


const agentInstallTargets = [
  {
    id: 'harness', name: 'DeepSeek Harness', badge: '原生右栏', tone: 'native', state: '官方安装器 · 自动更新',
    summary: '完整的墨鱼工坊客户端内置在 Harness 右栏；首次确认安装后每 6 小时后台校验更新，重启 Harness 生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName harness',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- harness',
    update: '& "$env:LOCALAPPDATA\\GameHub\\agent-update.ps1" -HostName harness',
    prompt: '请帮我把墨鱼工坊安装到 DeepSeek Harness 的 web profile。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查脚本，说明它会从 mooyu.fun 下载并校验构建好的插件 tarball，再调用 dsh plugin --profile web add，然后等待我确认；确认后执行适合当前系统的命令，验证安装结果，并提醒我重启 dsh web。',
  },
  {
    id: 'vscode', name: 'VS Code', badge: '原生侧栏', tone: 'native', state: '官方安装器 · 自动更新',
    summary: '通过 Activity Bar 打开墨鱼工坊，令牌保存在 SecretStorage；扩展自身静默下载并校验新版，重启编辑器生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName code',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- code',
    prompt: '请帮我安装墨鱼工坊的 VS Code 扩展。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查安装脚本，向我说明它会从 mooyu.fun 下载 VSIX、校验 SHA-256 并调用 code --install-extension，然后等待我确认；确认后使用适合当前系统的命令安装，验证扩展已启用，并告诉我如何在 Activity Bar 打开墨鱼工坊。',
  },
  {
    id: 'cursor', name: 'Cursor', badge: '原生侧栏', tone: 'native', state: '官方安装器 · 自动更新',
    summary: '与 VS Code 共用扩展并自动识别 Cursor；扩展自身静默下载并校验新版，重启编辑器生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName cursor',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- cursor',
    prompt: '请帮我安装墨鱼工坊的 Cursor 扩展。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查安装脚本，向我说明它会从 mooyu.fun 下载 VSIX、校验 SHA-256 并调用 cursor --install-extension，然后等待我确认；确认后使用适合当前系统的命令安装，验证扩展已启用，并告诉我如何打开墨鱼工坊侧栏。',
  },
  {
    id: 'windsurf', name: 'Windsurf', badge: '优先内置', tone: 'testing', state: '兼容性验证中',
    summary: '优先复用 VS Code 扩展；若宿主 Webview 或密钥存储不兼容，则安全回退浏览器。',
    prompt: '请检查当前 Windsurf 是否支持安装 VSIX；支持时在获得我的确认后安装墨鱼工坊，否则打开 https://mooyu.fun。',
  },
  {
    id: 'codex', name: 'Codex / ChatGPT', badge: 'Plugin + MCP App', tone: 'native', state: '远程界面 · 自动更新',
    summary: '游戏和交互界面由墨鱼工坊服务器提供，可随平台部署即时更新；本地插件壳每 6 小时校验新版，并在 Codex 重启后激活。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName codex',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- codex',
    update: '& "$env:LOCALAPPDATA\\GameHub\\agent-update.ps1" -HostName codex',
    prompt: '请帮我安装墨鱼工坊的 Codex 插件。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查脚本，说明它会从 mooyu.fun 下载并逐文件校验插件包、添加本地墨鱼工坊 marketplace，并连接只读的 https://mooyu.fun/mcp；游戏和界面仍由墨鱼工坊服务器运行。然后等待我确认；确认后执行适合当前系统的命令。完成后请引导我在 Plugins Directory 的“墨鱼工坊插件”来源中安装 gamehub。',
  },
  {
    id: 'claude', name: 'Claude Code', badge: 'Agent Plugin', tone: 'building', state: '官方技能安装器 · MCP 开发中',
    summary: '官方安装器下载并校验可移植技能，通过 Claude Code marketplace 安装；后台会暂存新版，重启并刷新插件后生效。',
    command: '& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName claude',
    alternate: 'curl -fsSL https://mooyu.fun/install.sh | sh -s -- claude',
    update: '& "$env:LOCALAPPDATA\\GameHub\\agent-update.ps1" -HostName claude',
    prompt: '请帮我安装墨鱼工坊的 Claude Code 插件。只使用官方安装器 https://mooyu.fun/install.ps1（Windows）或 https://mooyu.fun/install.sh（macOS/Linux），不要克隆源码仓库。先下载并检查脚本，说明它会从 mooyu.fun 下载并逐文件校验插件包、添加本地 marketplace 并调用 claude plugin install gamehub@gamehub，然后等待我确认；确认后执行适合当前系统的命令并验证插件已启用。',
  },
  {
    id: 'opencode', name: 'OpenCode / 终端 Agent', badge: 'MCP + 浏览器', tone: 'browser', state: '规划中',
    summary: 'Agent 负责搜索、账号与启动指令，视觉游玩界面由系统浏览器承载。',
    prompt: '请检查当前 Agent 是否支持墨鱼工坊 MCP；若尚未支持，请打开 https://mooyu.fun。',
  },
];

const agentInstallEnglish = {
  harness: {
    badge: 'Native right panel', state: 'Official installer · Automatic updates',
    summary: 'The full MOOYU.FUN client lives in the Harness right panel. After the first approved install, it checks for updates every six hours and activates them after Harness restarts.',
    prompt: 'Install MOOYU.FUN into the DeepSeek Harness web profile. Use only the official installer at https://mooyu.fun/install.ps1 on Windows or https://mooyu.fun/install.sh on macOS/Linux; do not clone the source repository. First download and inspect the script, explain that it downloads and verifies a built plugin tarball from mooyu.fun and then calls dsh plugin --profile web add, and wait for my confirmation. After I confirm, run the command for this system, verify the result, and remind me to restart dsh web.',
  },
  vscode: {
    badge: 'Native sidebar', state: 'Official installer · Automatic updates',
    summary: 'Open MOOYU.FUN from the Activity Bar. Tokens stay in SecretStorage, and the extension silently downloads verified updates that activate after the editor restarts.',
    prompt: 'Install the MOOYU.FUN VS Code extension. Use only the official installer at https://mooyu.fun/install.ps1 on Windows or https://mooyu.fun/install.sh on macOS/Linux; do not clone the source repository. First download and inspect the installer, explain that it downloads a VSIX from mooyu.fun, verifies its SHA-256 digest, and calls code --install-extension, then wait for my confirmation. After I confirm, install it with the command for this system, verify that the extension is enabled, and tell me how to open MOOYU.FUN from the Activity Bar.',
  },
  cursor: {
    badge: 'Native sidebar', state: 'Official installer · Automatic updates',
    summary: 'Uses the same extension as VS Code and detects Cursor automatically. Verified updates download silently and activate after the editor restarts.',
    prompt: 'Install the MOOYU.FUN Cursor extension. Use only the official installer at https://mooyu.fun/install.ps1 on Windows or https://mooyu.fun/install.sh on macOS/Linux; do not clone the source repository. First download and inspect the installer, explain that it downloads a VSIX from mooyu.fun, verifies its SHA-256 digest, and calls cursor --install-extension, then wait for my confirmation. After I confirm, install it with the command for this system, verify that the extension is enabled, and tell me how to open the MOOYU.FUN sidebar.',
  },
  windsurf: {
    badge: 'Embedded first', state: 'Compatibility testing',
    summary: 'Tries the VS Code extension first. If the host webview or secret store is incompatible, it safely falls back to the browser.',
    prompt: 'Check whether this Windsurf installation supports VSIX extensions. If it does, wait for my confirmation before installing MOOYU.FUN. Otherwise, open https://mooyu.fun.',
  },
  codex: {
    badge: 'Plugin + MCP App', state: 'Hosted interface · Automatic updates',
    summary: 'Games and the interactive interface are served by MOOYU.FUN and update with each platform deployment. The local plugin shell checks for updates every six hours and activates them after Codex restarts.',
    prompt: 'Install the MOOYU.FUN Codex plugin. Use only the official installer at https://mooyu.fun/install.ps1 on Windows or https://mooyu.fun/install.sh on macOS/Linux; do not clone the source repository. First download and inspect the script. Explain that it downloads and verifies every file in the plugin bundle, adds the local MOOYU.FUN marketplace, and connects the read-only https://mooyu.fun/mcp endpoint while games and the interface continue to run on MOOYU.FUN servers. Then wait for my confirmation. After I confirm, run the command for this system and guide me to install gamehub from the “MOOYU.FUN Plugins” source in the Plugins Directory.',
  },
  claude: {
    badge: 'Agent plugin', state: 'Official skill installer · MCP in development',
    summary: 'The official installer downloads and verifies a portable skill, then installs it through the Claude Code marketplace. Updates are staged in the background and activate after a restart and plugin refresh.',
    prompt: 'Install the MOOYU.FUN Claude Code plugin. Use only the official installer at https://mooyu.fun/install.ps1 on Windows or https://mooyu.fun/install.sh on macOS/Linux; do not clone the source repository. First download and inspect the script, explain that it downloads and verifies every file in the plugin bundle, adds a local marketplace, and calls claude plugin install gamehub@gamehub, then wait for my confirmation. After I confirm, run the command for this system and verify that the plugin is enabled.',
  },
  opencode: {
    badge: 'MCP + browser', state: 'Planned',
    summary: 'The Agent handles discovery, account actions, and launch commands while the visual play surface stays in the system browser.',
    prompt: 'Check whether this Agent supports the MOOYU.FUN MCP server. If it does not, open https://mooyu.fun.',
  },
};

const installCopy = {
  'zh-CN': {
    copied: '已复制', copyCommand: '复制命令', copy: '复制', mac: 'macOS / Linux', update: '更新命令', promptCopied: '提示词已复制', askAgent: '让 Agent 帮我安装', web: '先用网页版', copyPrompt: '复制下面的内容',
    title: '添加到你的 Agent', lead: '能安全内置就留在 Agent 里；宿主没有稳定界面能力时，再打开浏览器。首次安装需你确认，之后后台下载校验过的稳定版，并在宿主重启后生效。', environment: '当前环境', webState: '使用网页版', principles: '接入原则', native: '原生优先', nativeNote: '右栏、侧栏或 MCP App', permission: '最小权限', permissionNote: '不读取项目与宿主凭据', available: '始终可用', availableNote: '不支持内置时回退网页', recommended: '为当前宿主推荐', choose: '选择你的 Agent', chooseLead: '安装入口会随着各宿主完成验证逐步开放。', before: '安装前会发生什么', security: ['插件安装或执行命令前，应由 Agent 向你请求确认。','墨鱼工坊登录令牌只进入宿主提供的安全存储；游戏 iframe 不可访问。','所有尚未验证的宿主都明确标记，不会伪装成已经可用。','安装器只从 mooyu.fun 下载版本清单和制品，并逐个校验 SHA-256。','Cursor / VS Code 由扩展自身静默更新；其他 Agent 使用当前用户的计划任务或 cron，不需要每次手动执行命令。'],
  },
  en: {
    copied: 'Copied', copyCommand: 'Copy command', copy: 'Copy', mac: 'macOS / Linux', update: 'Update command', promptCopied: 'Prompt copied', askAgent: 'Ask Agent to install', web: 'Use web version', copyPrompt: 'Copy the text below',
    title: 'Add MOOYU.FUN to your Agent', lead: 'Stay inside the Agent when it can host the interface safely; otherwise open the browser. You approve the first installation, then verified stable updates download in the background and activate after the host restarts.', environment: 'Current environment', webState: 'Web version', principles: 'Integration principles', native: 'Native first', nativeNote: 'Right panel, sidebar, or MCP App', permission: 'Least privilege', permissionNote: 'No project files or host credentials', available: 'Always available', availableNote: 'Falls back to the web when embedding is unavailable', recommended: 'Recommended for this host', choose: 'Choose your Agent', chooseLead: 'Install options become available as each host integration completes verification.', before: 'What happens before installation', security: ['Your Agent should ask for confirmation before installing a plugin or running a command.','MOOYU.FUN login tokens only enter the host’s secure storage; game iframes cannot access them.','Unverified hosts are clearly marked and never presented as ready.','The installer downloads manifests and artifacts only from mooyu.fun and verifies every SHA-256 digest.','Cursor and VS Code update silently through the extension. Other Agents use the current user’s scheduled task or cron job, so commands do not need to be rerun manually.'],
  },
};

function AgentInstallCard({ target, copied, onCopy, onOpen, labels }) {
  return <article className="agent-install-card">
    <div className="agent-install-card__head"><div><span className={`agent-install-card__badge is-${target.tone}`}>{target.badge}</span><h3>{target.name}</h3></div><small>{target.state}</small></div>
    <p>{target.summary}</p>
    {target.command && <div className="agent-command"><code>{target.command}</code><button onClick={() => onCopy(target.command, `${target.id}-command`)}>{copied === `${target.id}-command` ? labels.copied : labels.copyCommand}</button></div>}
    {target.alternate && <details><summary>{labels.mac}</summary><div className="agent-command"><code>{target.alternate}</code><button onClick={() => onCopy(target.alternate, `${target.id}-alternate`)}>{copied === `${target.id}-alternate` ? labels.copied : labels.copy}</button></div></details>}
    {target.update && <details><summary>{labels.update}</summary><div className="agent-command"><code>{target.update}</code><button onClick={() => onCopy(target.update, `${target.id}-update`)}>{copied === `${target.id}-update` ? labels.copied : labels.copy}</button></div></details>}
    <div className="agent-install-card__actions"><button onClick={() => onCopy(target.prompt, `${target.id}-prompt`)}>{copied === `${target.id}-prompt` ? labels.promptCopied : (target.actionLabel ?? labels.askAgent)}</button><button onClick={onOpen}>{labels.web}</button></div>
  </article>;
}

function InstallPage({ go, hostIdentity }) {
  const { locale } = useI18n();
  const labels = installCopy[locale] || installCopy['zh-CN'];
  const targets = agentInstallTargets.map(target => locale === 'en' ? { ...target, ...agentInstallEnglish[target.id] } : target);
  const [copied, setCopied] = useState('');
  const copy = async (value, key) => {
    try { await globalThis.navigator?.clipboard?.writeText(value); setCopied(key); globalThis.setTimeout?.(() => setCopied(current => current === key ? '' : current), 1800); }
    catch { globalThis.prompt?.(labels.copyPrompt, value); }
  };
  const detected = targets.find(item => item.id === hostIdentity.id);
  return <main className="page install-page">
    <section className="install-hero">
      <div><span className="kicker">MOOYU.FUN EVERYWHERE</span><h1>{labels.title}</h1><p>{labels.lead}</p></div>
      <div className="install-detected"><span>{labels.environment}</span><strong>{hostIdentity.label}</strong><small>{detected ? `${detected.badge} · ${detected.state}` : labels.webState}</small></div>
    </section>
    <section className="install-principles" aria-label={labels.principles}><div><b>01</b><strong>{labels.native}</strong><span>{labels.nativeNote}</span></div><div><b>02</b><strong>{labels.permission}</strong><span>{labels.permissionNote}</span></div><div><b>03</b><strong>{labels.available}</strong><span>{labels.availableNote}</span></div></section>
    {detected && <section className="install-recommended"><span>{labels.recommended}</span><AgentInstallCard target={detected} copied={copied} onCopy={copy} onOpen={() => go('/discover')} labels={labels}/></section>}
    <section className="install-catalog"><div className="section-heading"><div><h2>{labels.choose}</h2><p>{labels.chooseLead}</p></div></div><div className="agent-install-grid">{targets.filter(item => item.id !== detected?.id).map(target => <AgentInstallCard key={target.id} target={target} copied={copied} onCopy={copy} onOpen={() => go('/discover')} labels={labels}/>)}</div></section>
    <section className="install-security"><div><span className="kicker">BEFORE YOU INSTALL</span><h2>{labels.before}</h2></div><ul>{labels.security.map(item=><li key={item}>{item}</li>)}</ul></section>
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
  const labels = { quarantine: '上传隔离区', validator: '校验工作区', runtime: '运行资产', avatars: '头像', covers: '封面', communityMedia: '社区媒体', communityProcessor: '社区处理区' };
  const filesystems = storage.filesystems?.length ? storage.filesystems : storage.stores.filter(store=>store.available).slice(0,1).map((store,index)=>({id:`filesystem-${index+1}`,storeIds:storage.stores.filter(item=>item.available).map(item=>item.id),totalBytes:store.totalBytes,availableBytes:store.availableBytes,usedBytes:store.usedBytes,usedPercent:store.usedPercent,projectedUsedPercent:store.projectedUsedPercent,reservedBytes:store.reservedBytes,level:store.level}));
  const state = storage.level === 'healthy' ? '容量正常' : storage.level === 'warning' ? '容量预警' : storage.level === 'blocked' ? '已停止新上传' : '容量探测失败';
  return <section className={`storage-health storage-health--${storage.level}`}><div className="storage-health__head"><div><span className="kicker">STORAGE GUARD</span><h2>{state}</h2><p>{storage.acceptingUploads ? `达到 ${storage.thresholds.warnPercent}% 时告警，达到 ${storage.thresholds.blockPercent}% 时自动阻止新上传。` : '现有作品、下载和运行保持可用；恢复安全容量后会自动重新开放上传。'}</p></div><strong>{storage.usedPercent.toFixed(2)}%</strong></div><div className="storage-health__meter" aria-label={`磁盘已使用 ${storage.usedPercent.toFixed(2)}%`}><i style={{ width: `${Math.min(100, storage.usedPercent)}%` }}/><b style={{ left: `${storage.thresholds.warnPercent}%` }}/><b style={{ left: `${storage.thresholds.blockPercent}%` }}/></div><div className="storage-health__filesystems">{filesystems.map((filesystem,index)=><article key={filesystem.id} className={`is-${filesystem.level}`}><span>{filesystems.length===1?'ECS 文件系统':`文件系统 ${index+1}`}</span><strong>{bytes(filesystem.usedBytes)} / {bytes(filesystem.totalBytes)}</strong><small>剩余 {bytes(filesystem.availableBytes)} · {filesystem.usedPercent.toFixed(2)}% 已用</small></article>)}</div><div className="storage-health__stores">{storage.stores.map(store => <article key={store.id} className={`is-${store.level}`}><span>{labels[store.id] || store.id}</span>{store.available ? <><strong>{bytes(store.logicalBytes)}</strong><small>业务目录实际占用</small></> : <><strong>不可用</strong><small>{store.errorCode}</small></>}</article>)}</div><small className="storage-health__note">文件系统容量只展示一次；下方是各业务目录的逻辑文件量，两者不是同一口径。</small><small className="storage-health__cleanup">最近清理：{storage.lastCleanup.at ? `${new Date(storage.lastCleanup.at).toLocaleString('zh-CN')} · ${storage.lastCleanup.filesRemoved} 个残留 · ${bytes(storage.lastCleanup.bytesReclaimed)}` : '等待首次自动清理'}</small></section>;
}

function AdminAnalytics({ analytics, days, onDays }) {
  const totals = analytics?.totals ?? {}; const daily = analytics?.daily ?? [];
  const sourceLabels = { direct: '站内 / 直接访问', share_copy: '复制分享链接', share_system: '系统分享', readme: 'README 徽章', campaign: '发现专题', external: '其他外部访问' };
  const maxViews = Math.max(1, ...daily.map(item => item.pageViews || 0));
  const cards = [
    ['访问用户', compactNumber(totals.visitors), '匿名去重设备'], ['页面浏览', compactNumber(totals.pageViews), '页面类别访问'],
    ['新增注册', compactNumber(totals.newUsers), `累计 ${compactNumber(totals.totalUsers)}`], ['活跃账号', compactNumber(totals.activeAccounts), '登录设备近期活跃'],
    ['游戏启动', compactNumber(totals.gameStarts), `历史游玩 ${compactNumber(totals.recordedPlays)}`], ['下载请求', compactNumber(totals.downloadStarts), `Agent 完成 ${compactNumber(totals.downloadCompletes)}`],
    ['站内时长', hours(totals.siteDurationMs), '前台心跳估算'], ['游戏时长', hours(totals.gameDurationMs), 'Web 会话统计'],
  ];
  return <section className="analytics-board"><div className="analytics-head"><div><span className="kicker">DATA CENTER</span><h2>平台数据中心</h2><p>掌握增长、访问、游玩与分发；统计不读取项目、输入内容或完整网址。</p></div><div className="analytics-range" aria-label="统计周期">{[7,30,90].map(value => <button key={value} className={days === value ? 'is-active' : ''} onClick={() => onDays(value)}>{value} 天</button>)}</div></div><div className="analytics-kpis">{cards.map(([label,value,note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div><div className="analytics-grid"><div className="analytics-trend"><div className="analytics-subhead"><h3>访问趋势</h3><span>上海时区</span></div><div className="analytics-bars">{daily.map(item => <div key={item.day} title={`${item.day} · ${item.pageViews} 次浏览 · ${item.visitors} 位访客`}><i style={{ height: `${Math.max(4, Math.round(item.pageViews / maxViews * 100))}%` }}/><small>{item.day.slice(5)}</small></div>)}</div></div><div className="analytics-hosts"><div className="analytics-subhead"><h3>使用入口</h3><span>去重访客</span></div>{analytics?.hosts?.length ? analytics.hosts.map(item => <div className="analytics-row" key={item.hostKind}><span>{item.hostKind}</span><strong>{compactNumber(item.visitors)}</strong><small>{compactNumber(item.pageViews)} PV</small></div>) : <p>新埋点上线后，这里会显示 Web、Cursor、Harness 等入口。</p>}</div></div><div className="analytics-sources"><div className="analytics-subhead"><h3>传播来源</h3><span>访问 / 试玩 / 有效</span></div>{analytics?.channels?.length?analytics.channels.map(item=><div className="analytics-source-row" key={`${item.source}:${item.campaignKey||''}`}><strong>{sourceLabels[item.source]||item.source}{item.campaignKey?` · ${item.campaignKey}`:''}</strong><span>{compactNumber(item.views)} / {compactNumber(item.starts)} / {compactNumber(item.engagedSessions)}</span><small>{item.conversionRate}%</small></div>):<p>分享链接产生访问后，这里会出现聚合来源。</p>}</div><div className="analytics-works"><div className="analytics-subhead"><h3>热门作品</h3><span>浏览 / 启动 / 下载请求</span></div>{analytics?.works?.length ? <div className="analytics-table">{analytics.works.map((item,index) => <div key={item.workId}><b>{String(index + 1).padStart(2,'0')}</b><strong>{item.title}</strong><span>{compactNumber(item.views)}</span><span>{compactNumber(item.starts)}</span><span>{compactNumber(item.downloads)}</span></div>)}</div> : <p>暂无作品事件；部署后访问和启动会开始累计。</p>}</div><p className="analytics-footnote">浏览器只能确认“开始下载”；Agent 校验并入库后才计入“完成下载”。传播来源只保存渠道和短活动代号，不保存完整来源网址。</p></section>;
}

function AdminProvenanceManager({items,api,demo,onSaved}) {
  const makeDrafts=values=>Object.fromEntries(values.map(item=>[item.workId,{attributionKind:item.attributionKind,repositoryUrl:item.repositoryUrl||'',licenseSpdx:item.licenseSpdx||'',note:''}]));
  const [drafts,setDrafts]=useState(()=>makeDrafts(items));const [busy,setBusy]=useState('');const [message,setMessage]=useState('');const [audit,setAudit]=useState({});
  useEffect(()=>setDrafts(makeDrafts(items)),[items]);
  const update=(workId,key,value)=>setDrafts(current=>({...current,[workId]:{...current[workId],[key]:value}}));
  const loadAudit=async item=>{
    if(audit[item.workId]?.status)return;
    setAudit(current=>({...current,[item.workId]:{status:'loading',items:[]}}));
    try{const data=demo?[]:(await api.listAdminWorkProvenanceEvents(item.workId)).data;setAudit(current=>({...current,[item.workId]:{status:'ready',items:data}}));}
    catch(caught){setAudit(current=>({...current,[item.workId]:{status:'error',items:[],message:caught.message}}));}
  };
  const save=async item=>{
    const draft=drafts[item.workId];if(!draft)return;
    if(Boolean(draft.repositoryUrl.trim())!==Boolean(draft.licenseSpdx.trim()))return setMessage('源码仓库与许可证必须同时填写或同时清空。');
    if(draft.note.trim().length<3)return setMessage('请填写至少 3 个字的修改说明。');
    setBusy(item.workId);setMessage('');
    try{
      const body={attributionKind:draft.attributionKind,repositoryUrl:draft.repositoryUrl.trim()||null,licenseSpdx:draft.licenseSpdx.trim()||null,expectedRevision:item.revision,note:draft.note.trim()};
      const next=demo?{...item,...body,revision:String(Number(item.revision)+1),claimEligible:body.attributionKind==='community_catalog'&&!item.claimStatus}:(await api.updateAdminWorkProvenance(item.workId,body)).data;
      setMessage(`《${item.title}》的来源与发布关系已更新并写入审计记录。`);setAudit(current=>{const copy={...current};delete copy[item.workId];return copy;});onSaved(next);
    }catch(caught){setMessage(caught.message||'来源资料没有更新。');}finally{setBusy('');}
  };
  const ingestionLabels={zip_upload:'ZIP 上传',github_import:'GitHub 导入'};
  const claimLabels={pending:'认领待审',verified:'已经认领',disputed:'认领争议中',suspended:'认领已暂停'};
  return <section className="provenance-operations"><div className="puzzle-ops__head"><div><span className="kicker">GAME PROVENANCE</span><h2>游戏来源与发布关系</h2><p>进入平台的方式来自真实上传记录；这里只修正发布关系和公开开源资料。每次修改都会永久记录。</p></div><span>{items.length} 款游戏</span></div>{message&&<p className="admin-notice" role="status">{message}</p>}<div className="provenance-list">{items.map(item=>{const draft=drafts[item.workId]||{};const locked=Boolean(item.claimStatus),history=audit[item.workId];return <article className="provenance-card" key={item.workId}><header><div><span>{ingestionLabels[item.ingestionMethod]||item.ingestionMethod} · {item.state==='published'?'已发布':'未发布'}</span><h3>{item.title}</h3><small>{item.ownerDisplayName} · 修订 {item.revision}</small></div><em className={item.claimEligible?'is-claimable':''}>{item.claimStatus?claimLabels[item.claimStatus]||item.claimStatus:item.claimEligible?'可认领':'已有发布者'}</em></header><div className="provenance-fields"><label>发布关系<select value={draft.attributionKind||item.attributionKind} disabled={locked} onChange={event=>update(item.workId,'attributionKind',event.target.value)}><option value="community_catalog">平台代收录，可认领</option><option value="publisher">发布者自有</option></select><small>{locked?'已有认领流程，全部来源资料已锁定。':'上传方式不等于作者身份。'}</small></label><label>GitHub 仓库<input type="url" value={draft.repositoryUrl??''} disabled={locked||item.hasImmutableGitHubSource} onChange={event=>update(item.workId,'repositoryUrl',event.target.value)} placeholder="可留空"/><small>{item.hasImmutableGitHubSource?'由固定 GitHub 导入记录确定。':'与许可证同时填写。'}</small></label><label>SPDX 许可证<input value={draft.licenseSpdx??''} disabled={locked||item.hasImmutableGitHubSource} maxLength="40" onChange={event=>update(item.workId,'licenseSpdx',event.target.value)} placeholder="MIT / Apache-2.0"/></label><label className="provenance-note">修改说明<textarea value={draft.note??''} disabled={locked} maxLength="1000" onChange={event=>update(item.workId,'note',event.target.value)} placeholder="说明核验依据或为什么调整发布关系。"/></label></div><div className="provenance-actions"><a href={`/w/${item.workId}`}>查看游戏详情 ↗</a><Button disabled={locked||busy===item.workId} onClick={()=>save(item)}>{busy===item.workId?'保存中…':locked?'先处理认领流程':'保存并记录审计'}</Button></div><details className="governance-audit" onToggle={event=>{if(event.currentTarget.open)loadAudit(item);}}><summary>来源修正历史</summary>{!history||history.status==='loading'?<p>正在读取审计记录…</p>:history.status==='error'?<p>审计记录暂时无法读取。</p>:history.items.length?<ol>{history.items.map(event=><li key={event.id}><div><strong>{event.actorDisplayName}</strong><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></div><p>{event.note}</p><small>{event.beforeState.attributionKind} → {event.afterState.attributionKind}</small></li>)}</ol>:<p>尚未人工修正来源资料。</p>}</details></article>;})}</div></section>;
}

export function AdminClaimManager({claims,api,demo,onChanged}) {
  const [filter,setFilter]=useState('pending'),[notes,setNotes]=useState({}),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[audit,setAudit]=useState({});
  const filters=[['pending','待审'],['verified','已认领'],['disputed','争议'],['suspended','暂停'],['rejected','未通过'],['cancelled','已撤回'],['revoked','已撤销'],['all','全部']];
  const visible=filter==='all'?claims:claims.filter(claim=>claim.status===filter);
  const loadAudit=async claim=>{
    if(audit[claim.id]?.status)return;
    setAudit(current=>({...current,[claim.id]:{status:'loading',items:[]}}));
    try{const data=demo?[]:(await api.listAdminProjectClaimEvents(claim.id)).data;setAudit(current=>({...current,[claim.id]:{status:'ready',items:data}}));}
    catch(caught){setAudit(current=>({...current,[claim.id]:{status:'error',items:[],message:caught.message}}));}
  };
  const actions=claim=>({pending:[['reject','拒绝'],['approve','确认认领']],verified:[['dispute','标记争议'],['suspend','暂停权限'],['revoke','撤销认领']],disputed:[['restore','恢复认领'],['suspend','暂停权限'],['revoke','撤销认领']],suspended:[['restore','恢复认领'],['revoke','撤销认领']]}[claim.status]||[]);
  const decide=async(claim,action)=>{
    const note=(notes[claim.id]||'').trim();if(note.length<3)return setError('请填写至少 3 个字的审核或治理说明。');
    if(['suspend','revoke'].includes(action)&&!globalThis.confirm?.(`${action==='suspend'?'暂停':'撤销'}《${claim.workTitle}》的认领关系？`))return;
    setBusy(claim.id);setError('');setMessage('');
    try{if(!demo)await api.decideProjectClaim(claim.id,{action,note});setMessage(`《${claim.workTitle}》的认领状态已更新。`);setAudit(current=>{const copy={...current};delete copy[claim.id];return copy;});await onChanged();}
    catch(caught){setError(caught.message||'认领状态没有更新。');}finally{setBusy('');}
  };
  return <section className="admin-queue claim-review-queue"><div className="puzzle-ops__head"><div><span className="kicker">GAME CLAIM GOVERNANCE</span><h2>作者与维护者认领</h2><p>审核新申请，并持续处理已经确认的认领关系、争议、暂停和撤销。</p></div><span>{claims.length} 份记录</span></div><div className="claim-status-tabs" role="group" aria-label="认领状态筛选">{filters.map(([value,label])=><button type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)} key={value}>{label} <span>{value==='all'?claims.length:claims.filter(claim=>claim.status===value).length}</span></button>)}</div>{error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="admin-notice" role="status">{message}</p>}{visible.length?visible.map(claim=>{const history=audit[claim.id];return <article className={`report-card claim-governance-card is-${claim.status}`} key={claim.id}><div className="report-card__head"><div><span>{claim.relationship==='owner'?'作者 / 权利人':'维护者'} · {claim.evidenceType}</span><h3>{claim.workTitle}</h3></div><em>{projectClaimStatusLabels[claim.status]||claim.status}</em></div><p><strong>{claim.claimantDisplayName}</strong>{claim.claimantHandle?`（@${claim.claimantHandle}）`:''}</p>{(claim.repositoryUrl||claim.evidenceUrl)&&<a href={claim.repositoryUrl||claim.evidenceUrl} target="_blank" rel="noreferrer">核对公开证明 ↗</a>}{claim.applicantNote&&<p>{claim.applicantNote}</p>}{claim.decisionNote&&<p className="claim-decision-note">最近决定：{claim.decisionNote}</p>}<details className="governance-audit" onToggle={event=>{if(event.currentTarget.open)loadAudit(claim);}}><summary>审核与权限历史</summary>{!history||history.status==='loading'?<p>正在读取审计记录…</p>:history.status==='error'?<p>审计记录暂时无法读取。</p>:history.items.length?<ol>{history.items.map(event=><li key={event.id}><div><strong>{projectClaimActionLabels[event.action]||event.action}</strong><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></div><p>{event.details?.note||event.actorDisplayName}</p></li>)}</ol>:<p>还没有审计事件。</p>}</details>{actions(claim).length>0&&<><label>审核或治理说明<textarea maxLength="2000" value={notes[claim.id]||''} onChange={event=>setNotes(current=>({...current,[claim.id]:event.target.value}))} placeholder="记录身份核验、争议依据或权限变更原因。"/></label><div className="dialog-actions">{actions(claim).map(([action,label])=>action==='revoke'?<button className="danger-button" type="button" disabled={busy===claim.id} onClick={()=>decide(claim,action)} key={action}>{label}</button>:<Button kind={action==='approve'||action==='restore'?undefined:'secondary'} disabled={busy===claim.id} onClick={()=>decide(claim,action)} key={action}>{busy===claim.id?'处理中…':label}</Button>)}</div></>}</article>;}):<div className="admin-empty"><span>✓</span><strong>这个状态没有认领记录</strong><p>可切换其他状态查看完整治理历史。</p></div>}</section>;
}

const adminPanelIds = new Set(['overview','growth','works','governance','official']);
const readAdminPanel = () => {
  const outer = new URLSearchParams(String(globalThis.location?.search || '').replace(/^\?/u,''));
  const embeddedRoute = outer.get('gh_route');
  const embedded = embeddedRoute ? new URLSearchParams(String(embeddedRoute).split('?')[1] || '') : null;
  const value = outer.get('panel') || embedded?.get('panel') || 'overview';
  return adminPanelIds.has(value) ? value : 'overview';
};

function AdminPage({ api, demo, go }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const demoPuzzles = [{ id: 'wikipedia-4723', title: '足球', aliases: ['协会足球','英式足球'], category: '体育', sourceKind: 'wikipedia-lead', sourceTitle: '足球', sourceUrl: 'https://zh.wikipedia.org/wiki/%E8%B6%B3%E7%90%83', sourceRevision: 94245396, sourceUpdatedAt: '2026-09-27T15:22:05Z', license: 'CC BY-SA 4.0', introHanCount: 364, content: '足球主要专指英式足球，官方名为协会足球，是一种世界流行的团体球类运动。', status: 'ready', qualityReason: null, scheduledDates: [today] }];
  const demoAutomation = { enabled: true, running: false, intervalMinutes: 360, batchSize: 20, scheduleDays: 14, readyCount: 18, scheduledCount: 14, lastRun: { status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), fetchedCount: 20, acceptedCount: 7, scheduledCount: 4, errorCode: null, errorMessage: null } };
  const demoAnalytics = { totals: { visitors: 1264, pageViews: 4812, newUsers: 86, totalUsers: 2341, activeAccounts: 734, gameStarts: 1960, recordedPlays: 9204, downloadStarts: 318, downloadCompletes: 241, siteDurationMs: 304560000, gameDurationMs: 196740000 }, daily: Array.from({ length: 7 }, (_, index) => ({ day: new Date(Date.now() - (6-index)*86400000).toLocaleDateString('en-CA'), visitors: 120+index*13, pageViews: 410+index*47, downloads: 20+index*5, gameStarts: 160+index*18, newUsers: 8+index })), hosts: [{ hostKind: 'browser', visitors: 812, pageViews: 3204 }, { hostKind: 'cursor', visitors: 336, pageViews: 1208 }, { hostKind: 'harness', visitors: 116, pageViews: 400 }], channels: [{source:'share_copy',campaignKey:null,visitors:223,views:286,starts:126,engagedSessions:71,conversionRate:44},{source:'readme',campaignKey:null,visitors:141,views:178,starts:69,engagedSessions:38,conversionRate:39},{source:'direct',campaignKey:null,visitors:900,views:1482,starts:742,engagedSessions:386,conversionRate:50}], works: [{ workId: 'gamehub-guess-baike', title: '猜百科', views: 1240, starts: 988, downloads: 0 }, { workId: 'demo-space', title: '宇宙巡航机', views: 706, starts: 462, downloads: 318 }] };
  const demoStorage = { checkedAt: new Date().toISOString(), level: 'healthy', acceptingUploads: true, usedPercent: 31.42, thresholds: { warnPercent: 70, blockPercent: 85 }, stores: ['quarantine','validator','runtime','avatars','covers'].map((id,index) => ({ id, available: true, level: 'healthy', totalBytes: String(80 * 1024 ** 3), availableBytes: String(54 * 1024 ** 3), usedBytes: String(26 * 1024 ** 3), usedPercent: 31.42, projectedUsedPercent: 31.42, reservedBytes: '0', logicalBytes: String((index + 1) * 42 * 1024 ** 2) })), lastCleanup: { at: new Date().toISOString(), filesRemoved: 0, bytesReclaimed: 0 } };
  const demoSourceOverview = { activeConnections: 3, activeRepositories: 7, imports24h: 2, failedWebhooks24h: 0 };
  const demoSourceAudit = [{ id: 'source-audit-demo', actorUserId: null, connectionId: null, importId: null, workId: null, action: 'import.previewed', details: { commitSha: 'a'.repeat(40) }, createdAt: new Date().toISOString() }];
  const demoClaims=[{id:'00000000-0000-4000-8000-000000000020',workId:demoWorks[0].id,workTitle:demoWorks[0].title,claimantUserId:'00000000-0000-4000-8000-000000000021',claimantDisplayName:'开放游戏作者',claimantHandle:'open-game-author',relationship:'owner',status:'pending',evidenceType:'website',evidenceUrl:'https://example.com/open-game',repositoryId:null,repositoryUrl:null,applicantNote:'公开作者主页包含该游戏的发布记录。',decisionNote:'',submittedAt:new Date().toISOString(),decidedAt:null,verifiedAt:null,suspendedAt:null,revokedAt:null,updatedAt:new Date().toISOString(),version:'1'}];
  const demoProvenance = [{workId:demoWorks[0].id,title:demoWorks[0].title,state:'published',visibility:'public',revision:'3',ownerDisplayName:'墨鱼工坊运营',ingestionMethod:'zip_upload',attributionKind:'community_catalog',repositoryUrl:'https://github.com/gamehub/demo-game',licenseSpdx:'MIT',hasImmutableGitHubSource:false,claimStatus:null,claimEligible:true,updatedAt:new Date().toISOString()}];
  const [days, setDays] = useState(7);
  const [panel, setPanel] = useState(readAdminPanel);
  const [accessStatus, setAccessStatus] = useState('loading');
  const [state, setState] = useState({ loaded: {}, loadingPanel: null, panelError: '', reports: [], audit: [], applications: [], claims: [], provenance: [], puzzles: [], automation: null, analytics: null, storage: null, sourceOverview: null, sourceAudit: [] });
  const [notes, setNotes] = useState({}); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const loadPanel = async (target = panel, force = false) => {
    const loadKey = target === 'overview' ? `${target}:${days}` : target;
    if (!force && state.loaded[loadKey]) return;
    setState(current => ({ ...current, loadingPanel: target, panelError: '' }));
    try {
      let next = {};
      if (demo) {
        if (target === 'overview') next = { reports: [], applications: [], claims: demoClaims, automation: demoAutomation, analytics: demoAnalytics, storage: demoStorage, sourceOverview: demoSourceOverview };
        if (target === 'works') next = { claims: demoClaims, provenance: demoProvenance, sourceOverview: demoSourceOverview, sourceAudit: demoSourceAudit };
        if (target === 'governance') next = { reports: [], audit: [], applications: [] };
        if (target === 'official') next = { puzzles: demoPuzzles, automation: demoAutomation };
      } else if (target === 'overview') {
        const [analytics, storage, reports, applications, claims, automation, sourceOverview] = await Promise.all([api.getAdminAnalytics(days), api.getAdminStorage(), api.listReports('open'), api.listCreatorApplications('pending'), api.listAdminProjectClaims('pending',100), api.getGuessBaikeAutomationStatus(), api.getGitHubSourceAdminOverview()]);
        next = { analytics: analytics.data, storage: storage.data, reports: reports.data, applications: applications.data, claims: claims.data, automation: automation.data, sourceOverview: sourceOverview.data };
      } else if (target === 'works') {
        const [claims, provenance, sourceOverview, sourceAudit] = await Promise.all([api.listAdminProjectClaims('all',100), api.listAdminWorkProvenance(100), api.getGitHubSourceAdminOverview(), api.listGitHubSourceAudit()]);
        next = { claims: claims.data, provenance: provenance.data, sourceOverview: sourceOverview.data, sourceAudit: sourceAudit.data };
      } else if (target === 'governance') {
        const [reports, audit, applications] = await Promise.all([api.listReports('open'), api.listModerationAudit(), api.listCreatorApplications('pending')]);
        next = { reports: reports.data, audit: audit.data, applications: applications.data };
      } else if (target === 'official') {
        const [puzzles, automation] = await Promise.all([api.listAdminGuessBaikePuzzles(), api.getGuessBaikeAutomationStatus()]);
        next = { puzzles: puzzles.data, automation: automation.data };
      }
      setState(current => ({ ...current, ...next, loaded: { ...current.loaded, [loadKey]: true }, loadingPanel: current.loadingPanel === target ? null : current.loadingPanel, panelError: '' }));
    } catch (caught) {
      if (caught.status === 401 || caught.status === 403) setAccessStatus('forbidden');
      else setState(current => ({ ...current, loadingPanel: null, panelError: caught.message || '当前栏目暂时无法读取。' }));
    }
  };
  useEffect(() => {
    let live = true;
    if (demo) { setAccessStatus('ready'); return () => { live = false; }; }
    api.getProfile().then(({ data }) => { if (live) setAccessStatus(data.role === 'admin' ? 'ready' : 'forbidden'); }).catch(caught => { if (live) setAccessStatus(caught.status === 401 || caught.status === 403 ? 'forbidden' : 'error'); });
    return () => { live = false; };
  }, [api, demo]);
  useEffect(() => {
    const onNavigation = () => setPanel(readAdminPanel());
    globalThis.addEventListener?.('popstate', onNavigation);
    return () => globalThis.removeEventListener?.('popstate', onNavigation);
  }, []);
  useEffect(() => { if (accessStatus === 'ready') loadPanel(panel); }, [accessStatus, panel, days, api, demo]);
  const selectPanel = target => { if (target === panel) return; setError(''); setNotice(''); setPanel(target); go(`/admin?panel=${target}`); };
  const decide = async (report, action) => {
    const note = (notes[report.id] || '').trim(); if (!note) return setError('请先填写处置说明。');
    if (action === 'suspend' && !globalThis.confirm?.(`暂停《${report.workTitle}》？当前公开版本将立即失效。`)) return;
    setBusy(report.id); setError('');
    try { await api.decideReport(report.id, { action, note }); await loadPanel('governance', true); }
    catch (caught) { setError(caught.message || '处置未完成。'); }
    finally { setBusy(''); }
  };
  const decideCreator = async (application, decision) => {
    const note = (notes[application.id] || '').trim(); if (!note) return setError('请先填写审核说明。');
    setBusy(application.id); setError(''); setNotice('');
    try {
      await api.decideCreatorApplication(application.id, { decision, note });
      setNotice(`${application.displayName} 的创作者申请已${decision === 'approve' ? '通过' : '拒绝'}。`);
      await loadPanel('governance', true);
    } catch (caught) { setError(caught.message || '审核没有完成。'); }
    finally { setBusy(''); }
  };
  const togglePuzzle = async puzzle => {
    const status = puzzle.status === 'ready' ? 'disabled' : 'ready'; setBusy(`puzzle-${puzzle.id}`); setError(''); setNotice('');
    try { if (!demo) await api.updateAdminGuessBaikePuzzle(puzzle.id, status); setNotice(`《${puzzle.title}》已${status === 'ready' ? '启用' : '停用'}。`); await loadPanel('official', true); }
    catch (caught) { setError(caught.message || '题目状态没有更新。'); }
    finally { setBusy(''); }
  };
  if (accessStatus === 'loading') return <main className="page admin-page"><LoadingCards/></main>;
  if (accessStatus === 'forbidden') return <main className="page"><StatePanel title="仅管理员可访问" body="这个页面包含举报内容与处置记录。" action="返回发现" onAction={() => go('/discover')}/></main>;
  if (accessStatus === 'error') return <main className="page"><StatePanel title="管理后台暂时不可用" body="没有执行任何处置，请稍后重试。" action="重新加载" onAction={() => globalThis.location?.reload?.()}/></main>;
  const pendingClaims = state.claims.filter(item => item.status === 'pending').length;
  const governanceCount = state.applications.length + state.reports.length;
  const officialWarning = state.automation?.lastRun?.status === 'failed' || state.puzzles.some(item => item.status === 'disabled');
  const overviewWarning = state.storage?.level && state.storage.level !== 'healthy' || Number(state.sourceOverview?.failedWebhooks24h || 0) > 0;
  const panels = [
    { id: 'overview', label: '概览', eyebrow: 'OVERVIEW', note: '数据与异常', badge: overviewWarning ? '!' : null },
    { id: 'growth', label: '增长运营', eyebrow: 'GROWTH', note: '传播与专题' },
    { id: 'works', label: '作品与来源', eyebrow: 'WORKS', note: '导入、来源、认领', badge: pendingClaims || null },
    { id: 'governance', label: '内容与权限', eyebrow: 'GOVERNANCE', note: '审核与举报', badge: governanceCount || null },
    { id: 'official', label: '官方内容', eyebrow: 'OFFICIAL', note: '题库与供给', badge: officialWarning ? '!' : null },
  ];
  const activePanel = panels.find(item => item.id === panel) || panels[0];
  const panelLoaded = Object.keys(state.loaded).some(key => key === panel || key.startsWith(`${panel}:`));
  const firstLoad = !panelLoaded && !state.panelError;
  return <main className="page admin-page"><div className="section-heading admin-heading"><div><span className="kicker">OPERATIONS DESK</span><h1>平台运营</h1><p>掌握平台增长、内容分发与治理状态。</p></div><span className="admin-count">{governanceCount} 项内容待办 · {pendingClaims} 份认领待审</span></div>
    <nav className="admin-navigation" aria-label="管理后台栏目">{panels.map(item => <button type="button" key={item.id} className={panel === item.id ? 'is-active' : ''} aria-current={panel === item.id ? 'page' : undefined} onClick={() => selectPanel(item.id)}><span>{item.eyebrow}</span><strong>{item.label}</strong><small>{item.note}</small>{item.badge && <em>{item.badge}</em>}</button>)}</nav>
    <div className="admin-panel-heading"><div><span>{activePanel.eyebrow}</span><h2>{activePanel.label}</h2></div>{state.loadingPanel === panel && !firstLoad && <small role="status">正在刷新…</small>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="admin-notice" role="status">{notice}</p>}{state.panelError && <div className="admin-panel-error" role="alert"><span>{state.panelError}</span><button type="button" onClick={() => loadPanel(panel, true)}>重新加载</button></div>}
    {firstLoad ? <LoadingCards/> : <>
    {panel === 'overview' && <><section className="admin-overview-cards" aria-label="管理待办摘要"><button type="button" onClick={() => selectPanel('governance')}><span>内容待办</span><strong>{governanceCount}</strong><small>{state.applications.length} 份创作者申请 · {state.reports.length} 条举报</small></button><button type="button" onClick={() => selectPanel('works')}><span>认领待审</span><strong>{pendingClaims}</strong><small>核验作者与维护者关系</small></button><button type="button" onClick={() => selectPanel('works')} className={Number(state.sourceOverview?.failedWebhooks24h || 0) ? 'is-warning' : ''}><span>来源服务</span><strong>{state.sourceOverview?.failedWebhooks24h || 0}</strong><small>近 24 小时 Webhook 失败</small></button><button type="button" onClick={() => selectPanel('official')} className={state.automation?.lastRun?.status === 'failed' ? 'is-warning' : ''}><span>官方供给</span><strong>{state.automation?.readyCount ?? '—'}</strong><small>{state.automation?.lastRun?.status === 'failed' ? '最近同步失败' : '道题当前可用'}</small></button></section><AdminAnalytics analytics={state.analytics} days={days} onDays={setDays}/><AdminStorage storage={state.storage}/></>}
    {panel === 'growth' && <><GrowthContentStudio api={api} demo={demo} demoWorks={demoWorks}/><DiscoveryCampaignAdmin api={api} demo={demo}/><AuthorOutreachQueue api={api} demo={demo}/></>}
    {panel === 'works' && <>
    {state.sourceOverview && <section className="source-operations"><div className="puzzle-ops__head"><div><span className="kicker">GITHUB SOURCE CONTROL</span><h2>GitHub 只读导入</h2><p>连接、授权仓库、近 24 小时导入与 Webhook 故障；此面板不提供源码执行能力。</p></div><span>{state.sourceOverview.activeConnections} 个活动连接</span></div><div className="source-operation-kpis"><article><span>授权仓库</span><strong>{state.sourceOverview.activeRepositories}</strong></article><article><span>24h 导入</span><strong>{state.sourceOverview.imports24h}</strong></article><article className={state.sourceOverview.failedWebhooks24h ? 'is-warning' : ''}><span>24h Webhook 失败</span><strong>{state.sourceOverview.failedWebhooks24h}</strong></article></div><details><summary>最近来源审计</summary>{state.sourceAudit.length ? <ol>{state.sourceAudit.slice(0,20).map(event => <li key={event.id}><strong>{event.action}</strong><code>{event.details?.commitSha?.slice(0,12) || event.connectionId || '—'}</code><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p>暂无来源事件。</p>}</details></section>}
    <AdminProvenanceManager items={state.provenance} api={api} demo={demo} onSaved={next=>setState(current=>({...current,provenance:current.provenance.map(item=>item.workId===next.workId?next:item)}))}/>
    <AdminClaimManager claims={state.claims} api={api} demo={demo} onChanged={() => loadPanel('works', true)}/></>}
    {panel === 'governance' && <><MultiplayerRuleReviewQueue api={api} demo={demo}/>
    <section className="admin-queue"><div className="puzzle-ops__head"><div><span className="kicker">CREATOR REVIEW</span><h2>创作者申请</h2><p>审核申请说明；通过后申请人的当前登录设备会立即获得创作与发布权限。</p></div><span>{state.applications.length} 份待审</span></div>{state.applications.length ? state.applications.map(application => <article className="report-card" key={application.id}><div className="report-card__head"><div><span>申请账号</span><h3>{application.displayName}</h3></div><time>{new Date(application.createdAt).toLocaleString('zh-CN')}</time></div><p>{application.statement}</p><label>审核说明<textarea maxLength="1000" value={notes[application.id] || ''} onChange={event => setNotes(current => ({ ...current, [application.id]: event.target.value }))} placeholder="说明通过条件或拒绝原因。"/></label><div className="dialog-actions"><Button kind="secondary" disabled={busy === application.id} onClick={() => decideCreator(application, 'reject')}>拒绝</Button><Button disabled={busy === application.id} onClick={() => decideCreator(application, 'approve')}>{busy === application.id ? '处理中…' : '通过申请'}</Button></div></article>) : <div className="admin-empty"><span>✓</span><strong>没有待审核申请</strong><p>新的创作者申请会显示在这里。</p></div>}</section>
    <section className="admin-grid"><div className="admin-queue"><h2>待处理举报</h2>{state.reports.length ? state.reports.map(report => <article className="report-card" key={report.id}><div className="report-card__head"><div><span>{reportCategoryLabels[report.category]}</span><h3>{report.workTitle}</h3></div><time>{new Date(report.createdAt).toLocaleString('zh-CN')}</time></div><p>{report.details || '举报者没有补充说明。'}</p><label>处置说明<textarea maxLength="1000" value={notes[report.id] || ''} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} placeholder="记录判断依据；该内容会进入审计记录。"/></label><div className="dialog-actions"><Button kind="secondary" disabled={busy === report.id} onClick={() => decide(report, 'dismiss')}>驳回举报</Button><button className="danger-button" disabled={busy === report.id} onClick={() => decide(report, 'suspend')}>{busy === report.id ? '处理中…' : '暂停作品'}</button></div></article>) : <div className="admin-empty"><span>✓</span><strong>队列已清空</strong><p>目前没有待处理举报。</p></div>}</div><aside className="audit-panel"><span className="kicker">APPEND-ONLY AUDIT</span><h2>最近处置</h2>{state.audit.length ? <ol>{state.audit.map(event => <li key={event.id}><span className={`audit-action audit-action--${event.action}`}>{event.action === 'suspend' ? '暂停' : '驳回'}</span><strong>{event.workTitle}</strong><p>{event.reason}</p><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p className="audit-empty">还没有管理处置记录。</p>}<small>审计表由数据库触发器禁止更新和删除。</small></aside></section></>}
    {panel === 'official' && <>
    {state.automation && <section className={`automation-health automation-health--${state.automation.lastRun?.status || 'idle'}`}><div className="automation-health__pulse"/><div><span className="kicker">AUTONOMOUS SUPPLY</span><h2>{state.automation.running ? '正在自动补充题库' : state.automation.lastRun?.status === 'failed' ? '最近一次同步失败，库存仍可用' : '全自动内容流水线正常'}</h2><p>每 {Math.round(state.automation.intervalMinutes / 60)} 小时自动抓取、筛选、去重，并补齐未来 {state.automation.scheduleDays} 天。无需人工审核或排期。</p>{state.automation.lastRun?.errorMessage && <small>{state.automation.lastRun.errorCode} · {state.automation.lastRun.errorMessage}</small>}</div><dl><div><dt>可用题</dt><dd>{state.automation.readyCount}</dd></div><div><dt>已排期</dt><dd>{state.automation.scheduledCount}/{state.automation.scheduleDays}</dd></div><div><dt>上次通过</dt><dd>{state.automation.lastRun?.acceptedCount ?? '—'}</dd></div></dl></section>}
    <section className="puzzle-ops"><div className="puzzle-ops__head"><div><span className="kicker">OFFICIAL INVENTORY</span><h2>猜百科自动题库</h2><p>这里用于观察自动产出的结果。日常不需要操作；停用仅用于发现错误内容后的紧急止损。</p></div><span>{state.puzzles.length} 道题</span></div><div className="puzzle-ops__list">{state.puzzles.map(puzzle => <article className={`puzzle-op ${puzzle.status === 'disabled' ? 'is-disabled' : ''}`} key={puzzle.id}><div className="puzzle-op__top"><div><span className="puzzle-op__category">{puzzle.category}</span><h3>{puzzle.title}</h3><small>{puzzle.introHanCount} 汉字 · 修订 {puzzle.sourceRevision}</small></div><span className={`puzzle-status puzzle-status--${puzzle.status}`}>{puzzle.status === 'ready' ? '自动可用' : '已停用'}</span></div>{puzzle.qualityReason && <p className="puzzle-quality">质量检查：{puzzle.qualityReason}</p>}<details><summary>查看完整导言与来源</summary><p>{puzzle.content}</p><a href={puzzle.sourceUrl} target="_blank" rel="noreferrer">查看来源 · {puzzle.license}</a></details><div className="puzzle-op__emergency"><span>{puzzle.scheduledDates.length ? `未来排期 ${puzzle.scheduledDates.length} 天` : '自动轮换库存'}</span><button className="puzzle-toggle" disabled={busy === `puzzle-${puzzle.id}`} onClick={() => togglePuzzle(puzzle)}>{puzzle.status === 'ready' ? '紧急停用' : '纠正后恢复'}</button></div></article>)}</div></section>
    </>}</>}</main>;
}

function PlatformApp({ hostAdapter, apiClient, demo = new URLSearchParams(location.search).has('demo'), routing = 'history' }) {
  const { t } = useI18n();
  const host = useMemo(() => hostAdapter ?? createBrowserHostAdapter(), [hostAdapter]);
  const api = useMemo(() => apiClient ?? createApiClient({
    baseUrl: host.apiBaseUrl ?? '',
    getAccessToken: () => host.account?.getAccessToken?.(),
    getRefreshToken: () => host.account?.getRefreshToken?.(),
    setTokens: tokens => host.account?.setTokens?.(tokens),
    withRefreshLock: (callback, signal) => host.account?.withRefreshLock ? host.account.withRefreshLock(callback, signal) : callback(),
  }), [apiClient, host]);
  const [savedWork, setSavedWork] = useState(null);
  const [accountStatus, setAccountStatus] = useState(demo ? 'ready' : 'loading');
  const [route, go] = useRoute(routing); const [themeMode, setThemeModeState] = useState('dark'); const [hostIdentity, setHostIdentity] = useState(hostIdentities.browser); const [hostReady, setHostReady] = useState(false); const [accountProfile, setAccountProfile] = useState(() => demo ? demoAccountProfile : null); const themeRoot = useRef(null);
  useEffect(() => { let live = true; host.getCapabilities().then(capabilities => { if (live) { setHostIdentity(resolveHostIdentity(capabilities)); setHostReady(true); } }).catch(() => { if (live) setHostReady(true); }); return () => { live = false; }; }, [host]);
  useEffect(() => { let live = true; const apply = theme => { if (!live || !themeRoot.current) return; setThemeModeState(theme.mode); applyThemeTokens(themeRoot.current, theme); }; host.theme.getTheme().then(apply); const off = host.theme.onThemeChanged(apply); return () => { live = false; off(); }; }, [host]);
  useEffect(() => { setSavedWork(null); }, [accountProfile?.id]);
  useEffect(() => {
    if (demo) return undefined;
    let live = true, generation = 0;
    const load = async () => {
      const current = ++generation;
      setAccountStatus('loading');
      let accessToken = null;
      try { accessToken = await host.account?.getAccessToken?.(); } catch {}
      if (!live || current !== generation) return;
      if (!accessToken) {
        setAccountProfile(null);
        setAccountStatus('anonymous');
        return;
      }
      try {
        const { data } = await api.getProfile();
        if (live && current === generation) { setAccountProfile(data); setAccountStatus('ready'); }
      } catch {
        if (live && current === generation) { setAccountProfile(null); setAccountStatus('anonymous'); }
      }
    };
    void load();
    const off = host.account?.onTokensChanged?.(tokens => {
      if (tokens) void load();
      else { generation++; setAccountProfile(null); setAccountStatus('anonymous'); }
    });
    return () => { live = false; off?.(); };
  }, [api, demo, host]);
  useEffect(() => { if (hostReady) emitAnalytics(api, hostIdentity.id, { type: 'page_view', route: routeCategory(route) }, demo); }, [api, hostIdentity.id, hostReady, route, demo]);
  useEffect(() => {
    if (demo || !hostReady) return undefined;
    const timer = setInterval(() => { if (globalThis.document?.visibilityState === 'visible') emitAnalytics(api, hostIdentity.id, { type: 'session_ping', route: routeCategory(route), durationMs: 30000 }, false); }, 30000);
    return () => clearInterval(timer);
  }, [api, hostIdentity.id, hostReady, route, demo]);
  const setThemeMode = mode => host.theme.setPreference?.(mode);
  let content; const parts = route.split('/').filter(Boolean);
  if (parts[0] === 'works' && parts[1]) content = <DetailPage key={parts[1]} workId={parts[1]} api={api} host={host} hostKind={hostReady ? hostIdentity.id : null} demo={demo} go={go} accountProfile={accountProfile} focusBoard={parts[2]==='leaderboard'} boardDate={parts[2]==='leaderboard'?decodeRouteValue(parts[3]):null} boardPuzzleId={parts[2]==='leaderboard'?decodeRouteValue(parts[4])||undefined:undefined}/>;
  else if (parts[0] === 'discover' && parts[1] === 'c' && parts[2]) content = <DiscoveryCampaignPage slug={decodeRouteValue(parts[2])} api={api} go={go} Art={Art}/>;
  else if (parts[0] === 'u' && parts[1]) content = <PublicProfilePage handle={decodeURIComponent(parts[1])} api={api} demo={demo} go={go} onProfileChange={setAccountProfile}/>;
  else if (parts[0] === 's' && parts[1]) content = <GameSharePage key={parts[1]} code={parts[1]} api={api} renderPlayer={share=><PlayerPage workId={share.workId} releaseId={share.releaseId} initialShareCode={share.code} api={api} host={host} hostKind={hostReady ? hostIdentity.id : null} demo={false} go={go}/>}/>;
  else if (parts[0] === 'play' && parts[1]) content = <PlayerPage workId={parts[1]} releaseId={['challenge','share','room'].includes(parts[2]) ? null : parts[2]} challengeCode={parts[2] === 'challenge' ? parts[3] : null} initialRoomId={parts[2] === 'room' ? parts[3] : parts[3] === 'room' ? parts[4] : null} initialShareCode={parts[2] === 'share' ? parts[3] : null} api={api} host={host} hostKind={hostReady ? hostIdentity.id : null} demo={demo} go={go}/>;
  else if (['/saves','/creator/save-health','/admin/saves'].includes(route)) content = <main className="page"><StatePanel title={t('saves.localOnly')} body={t('saves.localOnlyLead')} action={t('saves.backLibrary')} onAction={() => go('/library')}/></main>;
  else if (route === '/account') content = <AccountPage key={accountProfile?.id || 'guest'} api={api} host={host} demo={demo} go={go} themeMode={themeMode} setThemeMode={setThemeMode} canChangeTheme={typeof host.theme.setPreference === 'function'} hostIdentity={hostIdentity} onProfileChange={profile => { setAccountProfile(profile); setAccountStatus(profile ? 'ready' : 'anonymous'); }}/>;

  else if (route.startsWith('/creator/import')) content = <GitHubImportPage api={api} demo={demo} go={go} accountProfile={accountProfile} embedded={hostIdentity.id === 'mcp-app'}/>;
  else if (parts[0] === 'creator' && parts[1] === 'works' && parts[3] === 'edit') content = <WorkEditPage key={`${accountProfile?.id || 'guest'}:${parts[2]}`} workId={decodeRouteValue(parts[2])} api={api} demo={demo} go={go} savedWork={savedWork} onSaved={work => { setSavedWork(work); go('/creator/works'); }}/>;
  else if (parts[0] === 'creator' && parts[1] === 'works' && parts[3] === 'development') content = <DevelopmentLogPage key={`${accountProfile?.id || 'guest'}:${parts[2]}`} workId={decodeRouteValue(parts[2])} api={api} demo={demo} go={go}/>;
  else if (route === '/creator/tools') content = <CreatorToolsPage go={go}/>;
  else if (route === '/creator/works/new') content = <NewWorkPage api={api} demo={demo} go={go} accountProfile={accountProfile}/>;
  else if (route === '/creator/works/manual/new') content = <NewWorkPage api={api} demo={demo} go={go} accountProfile={accountProfile}/>;
  else if (parts[0] === 'creator' && parts[1] === 'studio' && parts[2]) content = <RetiredStudioPage go={go}/>;
  else if (parts[0] === 'creator' && parts[1] === 'drafts' && parts[2]) content = <CreatorDraftReviewPage draftId={parts[2]} api={api} demo={demo} go={go}/>;
  else if (route === '/creator/multiplayer/submit') content = <MultiplayerRuleSubmissionPage api={api} demo={demo} go={go}/>;
  else if (route === '/creator/multiplayer/docs') content = <MultiplayerDeveloperCenter go={go}/>;
  else if (route === '/creator/leaderboards/docs') content = <CompetitionDeveloperCenter go={go}/>;
  else if (parts[0] === 'creator' && parts[1] === 'works' && parts[3] === 'ai' && ['multiplayer','leaderboards'].includes(parts[4])) content = <CreatorAiTaskPage key={`${accountProfile?.id || 'guest'}:${parts[2]}:${parts[4]}`} api={api} demo={demo} go={go} kind={parts[4]} initialWorkId={decodeRouteValue(parts[2])}/>;
  else if (route === '/creator/multiplayer') content = <CreatorAiTaskPage key={`${accountProfile?.id || 'guest'}:multiplayer`} api={api} demo={demo} go={go} kind="multiplayer"/>;
  else if (route === '/creator/leaderboards') content = <CreatorAiTaskPage key={`${accountProfile?.id || 'guest'}:leaderboards`} api={api} demo={demo} go={go} kind="leaderboards"/>;
  else if (parts[0] === 'creator' && parts[2] && parts[3] === 'upload') content = <UploadPage workId={parts[2]} api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'creator' && parts[2] && parts[3] === 'builds') content = <SourceBuildPage workId={parts[2]} api={api} demo={demo} go={go}/>;
  else if (parts[0] === 'creator') content = <CreatorPage api={api} demo={demo} go={go} savedWork={savedWork} route={route}/>;
  else if (parts[0] === 'admin') content = <AdminPage api={api} demo={demo} go={go}/>;
  else if (route === '/install') content = <InstallPage go={go} hostIdentity={hostIdentity}/>;
  else if (route === '/learn') content = <LearningPage api={api} demo={demo} go={go} Art={Art}/>;
  else if (route === '/tools') content = <ToolsPage go={go}/>;
  else if (parts[0] === 'tools' && parts[1]) content = <OfficialToolHost toolId={parts[1]} go={go} api={api} accountProfile={accountProfile}/>;
  else if (route === '/library') content = <LibraryPage api={api} go={go} demo={demo}/>;
  else if (route === '/games/guess-baike/community') content = <DetailPage workId={GUESS_BAIKE_WORK_ID} api={api} host={host} hostKind={hostReady ? hostIdentity.id : null} demo={demo} go={go} accountProfile={accountProfile} focusBoard/>;
  else if (parts[0] === 'community' && parts[1] === 'projects' && parts[2] === 'tasks') content = <CommunityShell route={route} go={go}><ContributionCenterPage api={api} go={go} demo={demo} accountProfile={accountProfile} AvatarView={AvatarView} taskId={parts[3]} embedded/></CommunityShell>;
  else if (parts[0] === 'community' && parts[1] === 'projects') content = <CommunityShell route={route} go={go}><CommunityProjects api={api} go={go} demo={demo} accountProfile={accountProfile} AvatarView={AvatarView} projectId={parts[2]&&parts[2]!=='new'?parts[2]:null} startCreating={parts[2]==='new'}/></CommunityShell>;
  else if (parts[0] === 'community' && parts[1] === 'events') content = <CommunityShell route={route} go={go}><CommunityEvents api={api} go={go} demo={demo} accountProfile={accountProfile} AvatarView={AvatarView} eventId={parts[2]&&parts[2]!=='new'?parts[2]:null} create={parts[2]==='new'}/></CommunityShell>;
  else if (parts[0] === 'community' && parts[1] === 'parties') content = <CommunityShell route={route} go={go}><CommunityParties api={api} go={go} demo={demo} accountProfile={accountProfile} AvatarView={AvatarView} partyId={parts[2]&&parts[2]!=='new'?parts[2]:null} create={parts[2]==='new'}/></CommunityShell>;
  else if (route === '/community/me') content = <CommunityShell route={route} go={go}><CommunityParticipation api={api} go={go} demo={demo} accountProfile={accountProfile}/></CommunityShell>;
  else if (route === '/community') content = <CommunityShell route={route} go={go}><CommunityHome api={api} go={go} demo={demo} accountProfile={accountProfile} AvatarView={AvatarView}><CommunityPage key={accountProfile?.id ?? 'anonymous'} api={api} go={go} route="/community/feed" accountProfile={accountProfile} AvatarView={AvatarView} demo={demo} embedded/></CommunityHome></CommunityShell>;
  else if (route === '/social' || parts[0] === 'community') content = <CommunityPage key={accountProfile?.id ?? 'anonymous'} api={api} go={go} route={route} accountProfile={accountProfile} AvatarView={AvatarView} demo={demo}/>;
  else if (route === '/contribute' || /^\/contribute\/[^/]+$/.test(route)) content = <CommunityShell route={route} go={go}><ContributionCenterPage api={api} go={go} demo={demo} accountProfile={accountProfile} AvatarView={AvatarView} taskId={route.split('/')[2]} embedded/></CommunityShell>;
  else content = <DiscoverPage key={accountProfile?.id||'guest'} api={api} demo={demo} go={go} hostIdentity={hostIdentity} accountProfile={accountProfile} Art={Art}/>;
  const player = parts[0] === 'play' || parts[0] === 's';
  const creator = parts[0] === 'creator';
  return <div ref={themeRoot} className={`app ${player ? 'app--player' : ''}`} data-host={hostIdentity.id}>{!player && <Header route={route} go={go} themeMode={themeMode} setThemeMode={setThemeMode} canChangeTheme={typeof host.theme.setPreference === 'function'} hostIdentity={hostIdentity} accountProfile={accountProfile} accountStatus={accountStatus} api={api}/>} {!player && !creator && <PlayerNavigation route={route} go={go} mobile/>}<div className="ambient" aria-hidden="true"/>{creator ? <CreatorWorkspace route={route} go={go} profile={accountProfile}>{content}</CreatorWorkspace> : content}<div className="notice-region" aria-live="polite"/></div>;
}

export default function App(props) {
  return <I18nProvider><PlatformApp {...props}/></I18nProvider>;
}
