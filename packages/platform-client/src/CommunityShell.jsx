import React,{useEffect,useRef,useState} from 'react';
import {mount} from 'ascii.rest';
import * as earthrise from 'ascii.rest/pieces/earthrise';
import {useI18n} from './I18n.jsx';
import CommunityIcon from './CommunityIcon.jsx';

const sections=[
  ['/community','community.nav.home','home',route=>route==='/community'],
  ['/community/feed','community.nav.feed','feed',route=>route.startsWith('/community/feed')||/^\/community\/(game|ai|computing|posts|author)(\/|$)/.test(route)||route==='/social'],
  ['/community/projects','community.nav.projects','projects',route=>route.startsWith('/community/projects')||route.startsWith('/contribute')],
  ['/community/events','community.nav.events','events',route=>route.startsWith('/community/events')],
  ['/community/parties','community.nav.parties','parties',route=>route.startsWith('/community/parties')],
  ['/community/me','community.nav.mine','mine',route=>route.startsWith('/community/me')||route==='/community/mine'||route==='/community/bookmarks'],
];

function CommunityAsciiEarthrise() {
  const visual=useRef(null);
  useEffect(()=>mount(visual.current,earthrise,{fps:8}),[]);
  return <canvas ref={visual}/>;
}

export function CommunityShell({route,go,children}) {
  const {t}=useI18n();
  const launch=useRef(null),trigger=useRef(null),menu=useRef(null);
  const [launchOpen,setLaunchOpen]=useState(false);
  const overview=route==='/community';
  useEffect(()=>{setLaunchOpen(false);},[route]);
  useEffect(()=>{
    if(!launchOpen)return;
    const outside=event=>{if(!launch.current?.contains(event.target))setLaunchOpen(false);};
    const keyboard=event=>{if(event.key==='Escape'){setLaunchOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',keyboard);
    requestAnimationFrame(()=>menu.current?.querySelector('[role="menuitem"]')?.focus());
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};
  },[launchOpen]);
  const open=path=>{setLaunchOpen(false);go(path);};
  return <main className={`page community-hub-page${overview?' is-overview':''}`}>
    {overview&&<header className="community-hub-hero">
      <div className="community-hub-hero__copy"><span className="kicker">MOOYU.FUN COMMUNITY</span><h1>{t('community.title')}<span aria-hidden="true">✦</span></h1><p>{t('community.heroLead')}</p></div>
      <div className="community-hub-hero__ascii" aria-hidden="true"><CommunityAsciiEarthrise/></div>
    </header>}
    <div className="community-hub-toolbar">
      <nav className="community-hub-nav" aria-label={t('community.navigation')}>{sections.map(([path,label,icon,matches])=><button key={path} type="button" className={matches(route)?'is-active':''} aria-current={matches(route)?'page':undefined} onClick={()=>go(path)}><CommunityIcon name={icon}/>{t(label)}</button>)}</nav>
      <div className="community-launch" ref={launch}>
        <button ref={trigger} type="button" className="community-launch__trigger" aria-haspopup="menu" aria-expanded={launchOpen} aria-controls="community-launch-menu" onClick={()=>setLaunchOpen(value=>!value)}><CommunityIcon name="plus"/><span>{t('community.launch')}</span></button>
        {launchOpen&&<><button type="button" className="community-launch__backdrop" aria-label={t('community.launchClose')} onClick={()=>setLaunchOpen(false)}/><div id="community-launch-menu" className="community-launch__menu" role="menu" aria-label={t('community.launchMenu')} ref={menu}>
          <header className="community-launch__menu-head"><div><strong>{t('community.launchTitle')}</strong><small>{t('community.launchLead')}</small></div><button type="button" aria-label={t('community.launchClose')} onClick={()=>{setLaunchOpen(false);trigger.current?.focus();}}><CommunityIcon name="close"/></button></header>
          <button role="menuitem" type="button" onClick={()=>open('/community/feed/new')}><span><CommunityIcon name="edit"/></span><strong>{t('community.launchPost')}</strong><small>{t('community.launchPostLead')}</small></button>
          <button role="menuitem" type="button" onClick={()=>open('/community/projects/new')}><span><CommunityIcon name="projects"/></span><strong>{t('community.launchProject')}</strong><small>{t('community.launchProjectLead')}</small></button>
          <button role="menuitem" type="button" onClick={()=>open('/community/events/new')}><span><CommunityIcon name="events"/></span><strong>{t('community.launchEvent')}</strong><small>{t('community.launchEventLead')}</small></button>
          <button role="menuitem" type="button" onClick={()=>open('/community/parties/new')}><span><CommunityIcon name="parties"/></span><strong>{t('community.launchParty')}</strong><small>{t('community.launchPartyLead')}</small></button>
        </div></>}
      </div>
    </div>
    <div className="community-hub-body">{children}</div>
  </main>;
}
