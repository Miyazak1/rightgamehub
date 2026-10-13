import React, { useEffect, useRef, useState } from 'react';
import { demoWorks } from './demo.mjs';
import { creatorAiTaskKinds, initialAiTaskForm, createCreatorAiTask, currentPublishedReleases, formatCreatorAiTask } from './creator-ai-task.mjs';
import { useI18n } from './I18n.jsx';

function TaskEditor({ kind, work, releases, demo, go }) {
  const {t}=useI18n();
  const [form, setForm] = useState(() => initialAiTaskForm(kind));
  const [output, setOutput] = useState(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const promptRef = useRef(null), jsonRef = useRef(null);
  const published = currentPublishedReleases(work, releases);
  const update = event => { setForm(current => ({ ...current, [event.target.name]: event.target.value })); setOutput(null); setError(''); setCopyStatus(''); };
  const generate = event => {
    event.preventDefault(); setError(''); setCopyStatus('');
    try { const task = createCreatorAiTask({ kind, work, releases, form, demo }); setOutput({ task, prompt: formatCreatorAiTask(task), json: JSON.stringify(task, null, 2) }); }
    catch (caught) { setOutput(null); setError(caught.message); }
  };
  const copy = async (value, ref) => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(value); setCopyStatus(t('creator.ai.copied'));
    } catch { ref.current?.focus(); ref.current?.select(); setCopyStatus(t('creator.ai.copyFallback')); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([output.json + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gamehub-ai-${kind}-task.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <section className="creator-ai-context" aria-label={t('creator.ai.contextAria')}><div><span>{t('creator.ai.currentWork')}</span><strong>{work.title}</strong><p>{work.description || t('creator.ai.noDescription')}</p></div><div><span>{t('creator.ai.currentRelease')}</span>{published.length ? published.map(release => <strong key={release.id}>{release.targetKey} · {release.label || t('creator.ai.publishedRelease')}</strong>) : <strong>{t('creator.ai.noPublishedRelease')}</strong>}<small>{t('creator.ai.contextHint')}</small></div></section>
    <div className="creator-ai-layout">
      <form className="panel creator-ai-form" onSubmit={generate}>
        <span className="kicker">01 · {t('creator.ai.describe')}</span><h2>{t(kind === 'multiplayer' ? 'creator.ai.multiplayerQuestion' : 'creator.ai.leaderboardQuestion')}</h2>
        {kind === 'multiplayer' ? <>
          <label>{t('creator.ai.players')}<select aria-label={t('creator.ai.players')} name="players" value={form.players} onChange={update}>{Array.from({ length: 7 }, (_, i) => i + 2).map(n => <option key={n} value={n}>{t('creator.ai.playerCount',{count:n})}</option>)}</select></label>
          <label>{t('creator.ai.gameplay')}<textarea name="gameplay" required minLength="10" maxLength="1200" value={form.gameplay} onChange={update} placeholder={t('creator.ai.gameplayPlaceholder')}/></label>
          <label>{t('creator.ai.privateInfo')}<textarea name="privateInformation" maxLength="600" value={form.privateInformation} onChange={update} placeholder={t('creator.ai.privateInfoPlaceholder')}/></label>
          <p className="creator-ai-note">{t('creator.ai.multiplayerNote')}</p>
        </> : <>
          <label>{t('creator.ai.metric')}<input name="metric" required maxLength="40" value={form.metric} onChange={update} placeholder={t('creator.ai.metricPlaceholder')}/></label>
          <div className="creator-ai-fields"><label>{t('creator.ai.direction')}<select aria-label={t('creator.ai.direction')} name="direction" value={form.direction} onChange={update}><option value="desc">{t('creator.ai.desc')}</option><option value="asc">{t('creator.ai.asc')}</option></select></label><label>{t('creator.ai.period')}<select aria-label={t('creator.ai.period')} name="period" value={form.period} onChange={update}><option value="all-time">{t('creator.ai.allTime')}</option><option value="daily">{t('creator.ai.daily')}</option></select></label></div>
          <label>{t('creator.ai.scoring')}<textarea name="scoring" required minLength="10" maxLength="1200" value={form.scoring} onChange={update} placeholder={t('creator.ai.scoringPlaceholder')}/></label>
          <p className="creator-ai-note">{t('creator.ai.leaderboardNote')}</p>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" type="submit">{t('creator.ai.generate')}</button>
      </form>
      <aside className="panel creator-ai-handoff"><span className="kicker">02 · {t('creator.ai.handoff')}</span><h2>{t('creator.ai.continueProject')}</h2><ol><li>{t('creator.ai.step1')}</li><li>{t('creator.ai.step2')}</li><li>{t('creator.ai.step3')}</li></ol><p>{t('creator.ai.noAutomaticAction')}</p><button className="text-button" type="button" onClick={() => go(creatorAiTaskKinds[kind].technicalRoute)}>{t('creator.ai.advanced')}</button></aside>
    </div>
    {output && <section className="panel creator-ai-output" aria-label={t('creator.ai.outputAria')}><div className="creator-ai-output-head"><div><span className="kicker">{t('creator.ai.ready')}</span><h2>{t('creator.ai.copyToSession')}</h2></div><button className="button button--primary" type="button" onClick={() => copy(output.prompt, promptRef)}>{t('creator.ai.copyPrompt')}</button></div><textarea ref={promptRef} aria-label={t('creator.ai.promptAria')} readOnly value={output.prompt}/><p role="status">{copyStatus || t('creator.ai.outputHint')}</p><details><summary>{t('creator.ai.jsonSummary')}</summary><div className="creator-ai-output-actions"><button className="button button--secondary" type="button" onClick={() => copy(output.json, jsonRef)}>{t('creator.ai.copyJson')}</button><button className="button button--secondary" type="button" onClick={download}>{t('creator.ai.downloadJson')}</button></div><textarea ref={jsonRef} aria-label={t('creator.ai.jsonAria')} readOnly value={output.json}/></details></section>}
  </>;
}

export default function CreatorAiTaskPage({ api, demo = false, go, kind, initialWorkId = '' }) {
  const {t}=useI18n();
  const [list, setList] = useState({ status: 'loading', works: [] });
  const [selectedId, setSelectedId] = useState(initialWorkId);
  const [context, setContext] = useState({ workId: '', status: 'loading', releases: [] });
  const [reload, setReload] = useState(0), [retry, setRetry] = useState(0);
  const info = creatorAiTaskKinds[kind];
  useEffect(() => {
    let active = true; setList({ status: 'loading', works: [] });
    (demo ? Promise.resolve({ data: demoWorks.slice(1, 3) }) : api.listCreatorWorks()).then(({ data }) => {
      if (!active) return;
      setList({ status: 'ready', works: data });
      setSelectedId(current => current || (data.length === 1 ? data[0].id : ''));
    }).catch(caught => { if (active) setList({ status: caught.status === 401 ? 'auth' : caught.status === 403 ? 'forbidden' : 'error', works: [] }); });
    return () => { active = false; };
  }, [api, demo, reload]);
  const work = list.works.find(item => item.id === selectedId);
  useEffect(() => {
    if (!work) return undefined;
    let active = true; setContext({ workId: work.id, status: 'loading', releases: [] });
    (demo ? Promise.resolve({ data: (work.targets || []).filter(target => target.currentReleaseId).map(target => ({ id: target.currentReleaseId, targetKey: target.targetKey, label: '1.0.0（演示）', packageType: 'web_zip' })) }) : api.listWorkReleases(work.id)).then(({ data }) => {
      if (active) setContext({ workId: work.id, status: 'ready', releases: data });
    }).catch(caught => { if (active) setContext({ workId: work.id, status: caught.status === 401 ? 'auth' : 'error', releases: [] }); });
    return () => { active = false; };
  }, [api, demo, work, retry]);
  return <main className="page creator-ai-page"><button className="back-link" onClick={() => go('/creator')}>← {t('creator.backCenter')}</button><header className="creator-ai-heading"><span className="kicker">CREATOR STUDIO · AI</span><h1>{t(`creator.ai.${kind}.title`)}</h1><p>{t(`creator.ai.${kind}.description`)}</p>{demo && <small>{t('creator.ai.demo')}</small>}</header>
    {list.status === 'loading' ? <p role="status">{t('creator.ai.loadingWorks')}</p> : list.status === 'auth' ? <section className="panel creator-ai-empty"><h2>{t('creator.ai.signInTitle')}</h2><p>{t('creator.ai.signInBody')}</p><button className="button button--primary" onClick={() => go('/account')}>{t('creator.signInAction')}</button></section> : list.status === 'forbidden' ? <section className="panel creator-ai-empty"><h2>{t('creator.ai.permission')}</h2><button className="button button--primary" onClick={() => go('/creator')}>{t('creator.ai.apply')}</button></section> : list.status === 'error' ? <section className="panel creator-ai-empty"><p role="alert">{t('creator.ai.worksFailed')}</p><button className="button button--secondary" onClick={() => setReload(value => value + 1)}>{t('creator.ai.retryWorks')}</button></section> : !list.works.length ? <section className="panel creator-ai-empty"><h2>{t('creator.ai.createFirst')}</h2><p>{t('creator.ai.createFirstBody')}</p><button className="button button--primary" onClick={() => go('/creator/works/new')}>{t('creator.newWork')}</button><button className="text-button" onClick={() => go('/creator/import')}>{t('creator.importGithub')}</button></section> : <>
      <label className="creator-ai-work-select">{t('creator.ai.selectWork')}<select aria-label={t('creator.ai.selectWork')} value={selectedId} onChange={event => { setSelectedId(event.target.value); setContext({ workId: '', status: 'loading', releases: [] }); }}><option value="">{t('creator.ai.chooseWork')}</option>{list.works.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      {selectedId && !work ? <p role="alert">{t('creator.ai.inaccessible')}</p> : work && (context.workId !== work.id || context.status === 'loading') ? <p role="status">{t('creator.ai.loadingReleases')}</p> : work && context.status === 'auth' ? <p role="alert">{t('creator.ai.authExpired')}<button className="text-button" onClick={() => go('/account')}>{t('creator.ai.signInAgain')}</button></p> : work && context.status === 'error' ? <p role="alert">{t('creator.ai.releasesFailed')}<button className="text-button" onClick={() => setRetry(value => value + 1)}>{t('creator.ai.retryReleases')}</button></p> : work ? <TaskEditor key={`${kind}:${work.id}:${work.revision}`} kind={kind} work={work} releases={context.releases} demo={demo} go={go}/> : <p className="creator-ai-note">{t('creator.ai.chooseHint')}</p>}
    </>}
    <footer className="creator-ai-footer"><button className="text-button" onClick={() => go(info.technicalRoute)}>{t('creator.ai.technicalDocs')}</button></footer>
  </main>;
}
