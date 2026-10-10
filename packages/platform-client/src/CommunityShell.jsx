import React,{useEffect,useRef} from 'react';

const sections=[
  ['/community','首页','⌂',route=>route==='/community'],
  ['/community/feed','动态','✦',route=>route.startsWith('/community/feed')||/^\/community\/(game|ai|computing|posts|author)(\/|$)/.test(route)||route==='/social'],
  ['/community/projects','一起做','↗',route=>route.startsWith('/community/projects')||route.startsWith('/contribute')],
  ['/community/events','活动','◫',route=>route.startsWith('/community/events')],
  ['/community/parties','游戏组队','◉',route=>route.startsWith('/community/parties')],
  ['/community/me','我的参与','◇',route=>route.startsWith('/community/me')||route==='/community/mine'||route==='/community/bookmarks'],
];

export function CommunityShell({route,go,children}) {
  const launch=useRef(null);
  useEffect(()=>{if(launch.current)launch.current.open=false;},[route]);
  const open=path=>{if(launch.current)launch.current.open=false;go(path);};
  return <main className="page community-hub-page">
    <header className="community-hub-hero">
      <div className="community-hub-hero__copy"><span className="kicker">GAMEHUB COMMUNITY</span><h1>社区<span aria-hidden="true">✦</span></h1><p>一起发现、一起做点东西，也一起玩。</p></div>
      <div className="community-hub-hero__scene" aria-hidden="true"><i/><i/><i/><span>＋</span></div>
      <details className="community-launch" ref={launch}><summary>＋ 发起</summary><div className="community-launch__menu">
        <button type="button" onClick={()=>open('/community/feed/new')}><span>✦</span><strong>发布动态</strong><small>分享游戏、AI 或计算机新发现</small></button>
        <button type="button" onClick={()=>open('/community/projects')}><span>↗</span><strong>参与共建</strong><small>查看项目与作者公开任务</small></button>
        <button type="button" onClick={()=>open('/community/events/new')}><span>◫</span><strong>组织活动</strong><small>试玩会、聚会、讨论或项目会议</small></button>
        <button type="button" onClick={()=>open('/community/parties/new')}><span>◉</span><strong>发起游戏组队</strong><small>选择游戏、人数和开局时间</small></button>
      </div></details>
    </header>
    <nav className="community-hub-nav" aria-label="社区导航">{sections.map(([path,label,icon,matches])=><button key={path} type="button" className={matches(route)?'is-active':''} aria-current={matches(route)?'page':undefined} onClick={()=>go(path)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
    <div className="community-hub-body">{children}</div>
  </main>;
}
