import React,{useEffect,useState} from 'react';
import {EventCard} from './CommunityEvents.jsx';
import {PartyCard} from './CommunityParties.jsx';
import {useI18n} from './I18n.jsx';
import CommunityIcon from './CommunityIcon.jsx';

const demo={happening:[],projects:[]};

export default function CommunityHome({api,demo:demoMode,go,accountProfile,AvatarView,children}){
  const {t}=useI18n();
  const [state,setState]=useState({status:'loading',data:null});
  useEffect(()=>{let live=true;setState({status:'loading',data:null});Promise.resolve(demoMode?demo:api.communityOverview().then(result=>result.data)).then(data=>live&&setState({status:'ready',data})).catch(error=>live&&setState({status:'error',data:null,error}));return()=>{live=false;};},[api,demoMode,accountProfile?.id]);
  const data=state.data||demo;
  const openTasks=data.projects.reduce((total,project)=>total+Number(project.openTaskCount||0),0);
  const openProject=project=>go(`/community/projects/${project.id}`);
  return <section className="community-dashboard">
    <header className="community-dashboard__intro">
      <div className="community-dashboard__intro-copy"><span className="kicker">TOGETHER, NOW</span><h2>{t('community.homeTitle')}</h2><p>{t('community.homeLead')}</p></div>
      <div className="community-dashboard__pulse" aria-label={t('community.overview')}><button onClick={()=>go('/community/events')}><strong>{data.happening.length}</strong><span>{t('community.happeningCount')}</span><small>{t('community.happeningAction')}</small></button><button onClick={()=>go('/community/projects')}><strong>{openTasks}</strong><span>{t('community.openTasks')}</span><small>{t('community.openTasksAction')}</small></button><button onClick={()=>go('/community/feed')}><strong><CommunityIcon name="feed"/></strong><span>{t('community.latest')}</span><small>{t('community.latestAction')}</small></button></div>
      <aside>{accountProfile?<><span>{t('community.myNext')}</span><strong>{t('community.myNextLead')}</strong><button onClick={()=>go('/community/me')}>{t('community.openInbox')}</button></>:<><span>{t('community.guestBrowse')}</span><strong>{t('community.guestLead')}</strong><button onClick={()=>go('/account')}>{t('community.signIn')}</button></>}</aside>
    </header>

    <section className="community-dashboard__section is-projects">
      <div className="community-dashboard__heading"><div><span className="kicker">OPEN COLLABORATION</span><h2>{t('community.projectsTitle')}</h2></div><button onClick={()=>go('/community/projects')}>{t('community.viewAll')}<CommunityIcon name="arrowRight"/></button></div>
      {data.projects.length?<div className="community-dashboard__projects">{data.projects.map(project=><button type="button" key={project.id} aria-label={t('community.openProjectAria',{title:project.title})} onClick={()=>openProject(project)}><span className="community-dashboard__project-status">{t(project.status==='recruiting'?'community.projectRecruiting':'community.projectActive')}</span><span className="community-dashboard__project-arrow"><CommunityIcon name="arrowUpRight"/></span><strong>{project.title}</strong><p>{project.summary}</p><small>{t('community.projectMeta',{members:project.memberCount,tasks:project.openTaskCount})}</small><span className="community-dashboard__project-action">{t('community.openProjectAction')}<CommunityIcon name="arrowRight"/></span></button>)}</div>:<div className="community-dashboard__empty is-small"><span><CommunityIcon name="projects"/></span><div><strong>{t('community.noProjects')}</strong><p>{t('community.noProjectsLead')}</p></div><button onClick={()=>go('/community/projects')}>{t('community.goProjects')}</button></div>}
    </section>

    <section className="community-dashboard__section is-feed">
      <div className="community-dashboard__heading"><div><span className="kicker">LATEST STORIES</span><h2>{t('community.latest')}</h2></div><button onClick={()=>go('/community/feed')}>{t('community.enterFeed')}</button></div>
      {children}
    </section>

    {state.status==='loading'?<section className="community-dashboard__quiet"><i className="community-activity-skeleton"/></section>:data.happening.length?<section className="community-dashboard__section is-happening"><div className="community-dashboard__heading"><div><span className="kicker">HAPPENING SOON</span><h2>{t('community.happening')}</h2></div><button onClick={()=>go('/community/events')}>{t('community.viewAll')}<CommunityIcon name="arrowRight"/></button></div><div className="community-dashboard__happening">{data.happening.slice(0,3).map(item=>item.kind==='event'?<EventCard key={`event-${item.id}`} event={item} go={go}/>:<PartyCard key={`party-${item.id}`} party={item} go={go} api={api} AvatarView={AvatarView}/>)}</div></section>:<section className="community-dashboard__quiet"><span><CommunityIcon name="events"/></span><div><strong>{t('community.noHappening')}</strong><p>{t('community.noHappeningCompact')}</p></div><button onClick={()=>go('/community/events/new')}>{t('community.organize')}<CommunityIcon name="arrowRight"/></button></section>}
  </section>;
}
