import React from 'react';
import {useI18n} from './I18n.jsx';

const ChangeRadarWorkspace=React.lazy(()=>import('./ChangeRadarTool.jsx'));

export default function ChangeRadarAppPage({api,accountProfile,go}){
  const {t}=useI18n();
  return <main className="page change-radar-app">
    <button className="back-link" onClick={()=>go('/discover')}>← {t('radar.app.back')}</button>
    <header className="change-radar-app__hero">
      <div>
        <span className="kicker">MOOYU · STANDALONE APP</span>
        <h1>{t('radar.app.title')}</h1>
        <p>{t('radar.app.lead')}</p>
      </div>
      <div className="change-radar-app__badges" aria-label={t('radar.app.mode')}>
        <span>{t('radar.app.local')}</span>
        <span>{t('radar.app.orchestration')}</span>
        <span>{t('radar.app.history')}</span>
      </div>
    </header>
    <aside className="change-radar-app__notice">
      <strong>{t('radar.app.consoleTitle')}</strong>
      <p>{t('radar.app.consoleLead')}</p>
    </aside>
    <React.Suspense fallback={<section className="tool-host__slot" data-app-id="change-radar"><strong>{t('tools.loading')}</strong></section>}>
      <ChangeRadarWorkspace api={api} accountProfile={accountProfile} go={go}/>
    </React.Suspense>
  </main>;
}
