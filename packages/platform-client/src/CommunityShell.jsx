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
        <button type="button" disabled><span>◫</span><strong>组织活动</strong><small>将在活动阶段开放</small></button>
        <button type="button" disabled><span>◉</span><strong>发起游戏组队</strong><small>将在组队阶段开放</small></button>
      </div></details>
    </header>
    <nav className="community-hub-nav" aria-label="社区导航">{sections.map(([path,label,icon,matches])=><button key={path} type="button" className={matches(route)?'is-active':''} aria-current={matches(route)?'page':undefined} onClick={()=>go(path)}><span aria-hidden="true">{icon}</span>{label}{['/community/events','/community/parties'].includes(path)&&<small>即将开放</small>}</button>)}</nav>
    <div className="community-hub-body">{children}</div>
  </main>;
}

const futureCopy={
  events:{kicker:'COMMUNITY EVENTS',title:'活动',body:'试玩会、线上聚会、讨论和项目会议会在这里发生。首版将先提供时间、报名、提醒和安全的外部会议入口。',icon:'◫',next:'下一阶段：活动、报名与时区'},
  parties:{kicker:'GAME PARTIES',title:'游戏组队',body:'围绕一个具体游戏，约好时间、人数和模式，满员后进入真实房间或明确的外部组织入口。',icon:'◉',next:'后续阶段：组队、准备与房间衔接'},
};
export function CommunityComingSoon({kind,go}) {
  const copy=futureCopy[kind]||futureCopy.events;
  return <section className="community-future" aria-labelledby={`community-${kind}-title`}><div className="community-future__art" aria-hidden="true"><span>{copy.icon}</span><i/><i/><i/></div><div><span className="kicker">{copy.kicker}</span><h2 id={`community-${kind}-title`}>{copy.title}正在准备</h2><p>{copy.body}</p><div className="community-future__status"><span>设计已完成</span><strong>{copy.next}</strong></div><div className="community-future__actions"><button className="button button--primary" onClick={()=>go('/community/projects')}>先去一起做</button><button className="button button--secondary" onClick={()=>go('/community/feed')}>看看动态</button></div></div></section>;
}
