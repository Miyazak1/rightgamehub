import React, { useEffect, useRef, useState } from 'react';
import { demoWorks } from './demo.mjs';
import WorkMetadataFields from './WorkMetadataFields.jsx';
import { workMetadataForm, workMetadataPayload } from './work-metadata.mjs';
import { useI18n } from './I18n.jsx';

function WorkEditor({ work, api, demo, go, onSaved }) {
  const {t}=useI18n();
  const [baseline, setBaseline] = useState(work), [form, setForm] = useState(() => workMetadataForm(work));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const [remixOptions, setRemixOptions] = useState(() => work.remixSource ? [{ id: work.remixSource.workId, title: work.remixSource.title || t('creator.edit.currentSource'), licenseSpdx: work.remixSource.licenseSpdx || t('creator.edit.verified') }] : []);
  const pending = useRef(null), active = useRef(true), saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { let live=true;(demo?Promise.resolve({data:demoWorks.filter(item=>item.remixable&&item.id!==work.id)}):api.listWorks({limit:50,remixable:true})).then(({data})=>{if(!live)return;const current=work.remixSource&&!data.some(item=>item.id===work.remixSource.workId)?[{id:work.remixSource.workId,title:work.remixSource.title||t('creator.edit.currentSource'),licenseSpdx:work.remixSource.licenseSpdx||t('creator.edit.verified')}]:[];setRemixOptions([...current,...data.filter(item=>item.id!==work.id)]);}).catch(()=>{});return()=>{live=false;};},[api,demo,work.id,work.remixSource,t]);
  const update = event => { setForm(current => ({ ...current, [event.target.name]: event.target.value })); pending.current = null; if (!conflict) setError(''); };
  const save = async event => {
    event.preventDefault(); if (saving.current || conflict) return;
    try {
      const body = workMetadataPayload(form, { t }), signature = JSON.stringify([baseline.revision, body]);
      if (pending.current?.signature !== signature) pending.current = { signature, key: globalThis.crypto?.randomUUID?.() ?? `work-${Date.now()}-${Math.random().toString(16).slice(2)}` };
      saving.current = true; setBusy(true); setError('');
      const updated = demo ? { ...baseline, ...body, revision: String(Number(baseline.revision) + 1) } : (await api.updateWork(baseline.id, baseline.revision, body, { headers: { 'Idempotency-Key': pending.current.key } })).data;
      if (active.current) onSaved(updated);
    } catch (caught) {
      if (!active.current) return;
      if (caught.status === 412 || caught.code === 'REVISION_CONFLICT') { setConflict(true); setError(t('creator.edit.conflict')); }
      else setError(caught.status === 401 ? t('creator.edit.authExpired') : caught.status === 403 ? t('creator.edit.forbidden') : caught.status === 404 ? t('creator.edit.missing') : caught.message || t('creator.edit.saveFailed'));
    } finally { saving.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => {
    if (saving.current) return; saving.current = true; setBusy(true);
    try {
      const latest = demo ? baseline : (await api.listCreatorWorks()).data.find(item => item.id === baseline.id);
      if (!latest) throw new Error(t('creator.edit.missing'));
      if (active.current) { setBaseline(latest); setForm(workMetadataForm(latest)); pending.current = null; setConflict(false); setError(''); }
    } catch { if (active.current) setError(t('creator.edit.reloadFailed')); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  };
  return <><button className="back-link" disabled={busy} onClick={() => go('/creator')}>← {t('creator.backCenter')}</button><form className="panel new-work-form work-edit-form" onSubmit={save}><span className="kicker">EDIT WORK</span><h1>{t('creator.edit.title')}</h1><p>{t('creator.edit.revision',{value:baseline.revision})}</p>{baseline.state === 'published' && baseline.visibility === 'public' ? <aside className="work-edit-notice"><strong>{t('creator.edit.publicImmediate')}</strong><p>{t('creator.edit.publicImmediateBody')}</p></aside> : <p>{t('creator.edit.privateBody')}</p>}{demo && <p>{t('creator.edit.demo')}</p>}<fieldset className="work-edit-fields" disabled={busy}><WorkMetadataFields form={form} onChange={update} kind={baseline.kind} remixOptions={remixOptions} remixLocked={baseline.state==='published'&&Boolean(baseline.remixSource)}/></fieldset>{error && <div className="form-error" role="alert"><p>{error}</p>{conflict && <><p>{t('creator.edit.reloadWarning')}</p><button className="button button--secondary" type="button" disabled={busy} onClick={reload}>{t('creator.edit.reload')}</button></>}</div>}<div className="dialog-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={() => go('/creator')}>{t('creator.cancel')}</button><button className="button button--primary" type="submit" disabled={busy || conflict}>{t(busy?'creator.edit.processing':'creator.edit.save')}</button></div></form></>;
}

export default function WorkEditPage({ workId, api, demo, go, onSaved, savedWork }) {
  const {t}=useI18n();
  const [state, setState] = useState({ status: 'loading', work: null }), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setState({ status: 'loading', work: null });
    (demo ? Promise.resolve({ data: demoWorks.map(work => savedWork?.id === work.id ? { ...work, ...savedWork } : work) }) : api.listCreatorWorks()).then(({ data }) => {
      if (!active) return; const work = data.find(item => item.id === workId); setState({ status: work ? 'ready' : 'missing', work });
    }).catch(caught => { if (active) setState({ status: caught.status === 401 ? 'auth' : caught.status === 403 ? 'forbidden' : 'error', work: null }); });
    return () => { active = false; };
  }, [workId, api, demo, retry]);
  return <main className="page narrow-page">{state.status === 'ready' ? <WorkEditor key={workId} work={state.work} api={api} demo={demo} go={go} onSaved={onSaved}/> : <section className="panel work-edit-empty"><h1>{t('creator.edit.title')}</h1>{state.status === 'loading' ? <p role="status">{t('creator.edit.loading')}</p> : <><p role="alert">{state.status === 'auth' ? t('creator.edit.signInFirst') : state.status === 'missing' || state.status === 'forbidden' ? t('creator.edit.notAccessible') : t('creator.edit.loadFailed')}</p>{state.status === 'auth' ? <button className="button button--primary" onClick={() => go('/account')}>{t('creator.signInAction')}</button> : state.status === 'error' ? <button className="button button--secondary" onClick={() => setRetry(value => value + 1)}>{t('creator.edit.retry')}</button> : null}<button className="text-button" onClick={() => go('/creator')}>{t('creator.backCenter')}</button></>}</section>}</main>;
}
