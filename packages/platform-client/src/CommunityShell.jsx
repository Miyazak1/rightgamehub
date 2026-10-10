import React,{useEffect,useRef,useState} from 'react';

const sections=[
  ['/community','首页','⌂',route=>route==='/community'],
  ['/community/feed','动态','✦',route=>route.startsWith('/community/feed')||/^\/community\/(game|ai|computing|posts|author)(\/|$)/.test(route)||route==='/social'],
  ['/community/projects','一起做','↗',route=>route.startsWith('/community/projects')||route.startsWith('/contribute')],
  ['/community/events','活动','◫',route=>route.startsWith('/community/events')],
  ['/community/parties','游戏组队','◉',route=>route.startsWith('/community/parties')],
  ['/community/me','我的参与','◇',route=>route.startsWith('/community/me')||route==='/community/mine'||route==='/community/bookmarks'],
];

export function CommunityShell({route,go,children}) {
  const launch=useRef(null),trigger=useRef(null),menu=useRef(null);
  const [launchOpen,setLaunchOpen]=useState(false);
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
  return <main className="page community-hub-page">
    <header className="community-hub-hero">
      <div className="community-hub-hero__copy"><span className="kicker">GAMEHUB COMMUNITY</span><h1>社区<span aria-hidden="true">✦</span></h1><p>一起发现、一起做点东西，也一起玩。</p></div>
      <div className="community-hub-hero__scene" aria-hidden="true"><i/><i/><i/><span>＋</span></div>
    </header>
    <div className="community-hub-toolbar">
      <nav className="community-hub-nav" aria-label="社区导航">{sections.map(([path,label,icon,matches])=><button key={path} type="button" className={matches(route)?'is-active':''} aria-current={matches(route)?'page':undefined} onClick={()=>go(path)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
      <div className="community-launch" ref={launch}>
        <button ref={trigger} type="button" className="community-launch__trigger" aria-haspopup="menu" aria-expanded={launchOpen} aria-controls="community-launch-menu" onClick={()=>setLaunchOpen(value=>!value)}>＋ 发起</button>
        {launchOpen&&<><button type="button" className="community-launch__backdrop" aria-label="关闭发起菜单" onClick={()=>setLaunchOpen(false)}/><div id="community-launch-menu" className="community-launch__menu" role="menu" aria-label="发起社区内容" ref={menu}>
          <header className="community-launch__menu-head"><div><strong>发起新的内容</strong><small>选择一种社区参与方式</small></div><button type="button" aria-label="关闭发起菜单" onClick={()=>{setLaunchOpen(false);trigger.current?.focus();}}>×</button></header>
          <button role="menuitem" type="button" onClick={()=>open('/community/feed/new')}><span>✦</span><strong>发布动态</strong><small>分享游戏、AI 或计算机新发现</small></button>
          <button role="menuitem" type="button" onClick={()=>open('/community/projects/new')}><span>↗</span><strong>发起项目</strong><small>设定目标、角色与招募计划</small></button>
          <button role="menuitem" type="button" onClick={()=>open('/community/events/new')}><span>◫</span><strong>组织活动</strong><small>试玩会、聚会、讨论或项目会议</small></button>
          <button role="menuitem" type="button" onClick={()=>open('/community/parties/new')}><span>◉</span><strong>发起游戏组队</strong><small>选择游戏、人数和开局时间</small></button>
        </div></>}
      </div>
    </div>
    <div className="community-hub-body">{children}</div>
  </main>;
}
