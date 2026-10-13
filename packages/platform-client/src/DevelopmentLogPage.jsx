import React, { useEffect, useState } from 'react';
import { demoWorks } from './demo.mjs';
import { useI18n } from './I18n.jsx';

const kindLabels = { update: 'creator.log.kind.update', release_notes: 'creator.log.kind.releaseNotes', milestone: 'creator.log.kind.milestone' };
const stateLabels = { draft: 'creator.log.state.draft', published: 'creator.log.state.published', withdrawn: 'creator.log.state.withdrawn' };
const emptyForm = { entryKind: 'update', title: '', body: '', releaseId: '' };

export default function DevelopmentLogPage({ workId, api, demo, go }) {
  const {t,date}=useI18n();
  const [state, setState] = useState({ status: 'loading', work: null, entries: [], releases: [] });
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try {
      const [{ data: works }, { data: entries }, { data: releases }] = demo
        ? await Promise.all([
          Promise.resolve({ data: demoWorks }), Promise.resolve({ data: [] }),
          Promise.resolve({ data: [{ id: 'demo-release', label: '1.0.0', targetKey: 'web', validationState: 'ready', servingState: 'enabled', createdAt: new Date().toISOString() }] }),
        ])
        : await Promise.all([api.listCreatorWorks(), api.listDevelopmentEntries(workId), api.listWorkReleases(workId)]);
      const work = works.find(item => item.id === workId);
      setState({ status: work ? 'ready' : 'missing', work: work ?? null, entries, releases: releases.filter(item => item.validationState === 'ready' && item.servingState === 'enabled') });
    } catch (error) {
      setState(current => ({ ...current, status: error.status === 401 ? 'auth' : 'error' }));
    }
  };
  useEffect(() => { load(); }, [workId, api, demo]);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const reset = () => { setForm(emptyForm); setEditing(null); };
  const save = async event => {
    event.preventDefault(); if (busy) return;
    setBusy('save'); setMessage('');
    const payload = { ...form, releaseId: form.releaseId || null };
    try {
      let entry;
      if (demo) {
        const now = new Date().toISOString();
        entry = { id: editing?.id ?? `demo-${Date.now()}`, workId, ...payload, publicationState: 'draft', version: (editing?.version ?? 0) + 1, release: state.releases.find(item => item.id === payload.releaseId) ?? null, authorDisplayName: t('creator.log.demoAuthor'), publishedAt: null, withdrawnAt: null, createdAt: editing?.createdAt ?? now, updatedAt: now };
      } else if (editing) entry = (await api.updateDevelopmentEntry(editing.id, { action: 'edit', expectedVersion: editing.version, ...payload })).data;
      else entry = (await api.createDevelopmentEntry(workId, payload)).data;
      setState(current => ({ ...current, entries: editing ? current.entries.map(item => item.id === entry.id ? entry : item) : [entry, ...current.entries] }));
      setMessage(t(editing?'creator.log.updated':'creator.log.saved')); reset();
    } catch (error) { setMessage(error.message || t('creator.log.saveFailed')); }
    finally { setBusy(''); }
  };
  const action = async (entry, name) => {
    if (busy) return;
    if (name === 'withdraw' && !globalThis.confirm?.(t('creator.log.withdrawConfirm'))) return;
    setBusy(`${entry.id}:${name}`); setMessage('');
    try {
      const next = demo ? { ...entry, publicationState: name === 'publish' ? 'published' : 'withdrawn', publishedAt: entry.publishedAt ?? new Date().toISOString(), withdrawnAt: name === 'withdraw' ? new Date().toISOString() : null, version: entry.version + 1 }
        : (await api.updateDevelopmentEntry(entry.id, { action: name, expectedVersion: entry.version })).data;
      setState(current => ({ ...current, entries: current.entries.map(item => item.id === next.id ? next : item) }));
      setMessage(t(name === 'publish'?'creator.log.published':'creator.log.withdrawn'));
    } catch (error) { setMessage(error.message || t('creator.log.actionFailed')); }
    finally { setBusy(''); }
  };
  const edit = entry => {
    setEditing(entry); setForm({ entryKind: entry.entryKind, title: entry.title, body: entry.body, releaseId: entry.release?.id ?? '' }); setMessage('');
    globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  if (state.status !== 'ready') return <main className="page narrow-page"><button className="back-link" onClick={() => go('/creator')}>← {t('creator.backCenter')}</button><section className="panel work-edit-empty"><h1>{t('creator.log.title')}</h1><p role="status">{t(state.status === 'loading' ? 'creator.log.loading' : state.status === 'auth' ? 'creator.log.auth' : state.status === 'missing' ? 'creator.log.missing' : 'creator.log.loadFailed')}</p>{state.status === 'error' && <button className="button button--secondary" onClick={load}>{t('common.retry')}</button>}</section></main>;

  return <main className="page narrow-page development-log-page"><button className="back-link" onClick={() => go('/creator')}>← {t('creator.backCenter')}</button><div className="section-heading"><div><span className="kicker">DEVELOPMENT LOG</span><h1>{t('creator.log.workTitle',{title:state.work.title})}</h1><p>{t('creator.log.lead')}</p></div><button className="text-button" onClick={() => go(`/works/${workId}`)}>{t('creator.log.viewWork')}</button></div><form className="panel development-log-form" onSubmit={save}><div className="development-log-form__head"><div><h2>{t(editing?'creator.log.editDraft':'creator.log.newDraft')}</h2><p>{t('creator.log.privacy')}</p></div>{editing && <button type="button" className="text-button" onClick={reset}>{t('creator.log.cancelEdit')}</button>}</div><div className="form-grid"><label>{t('creator.log.type')}<select name="entryKind" value={form.entryKind} onChange={update}><option value="update">{t('creator.log.kind.update')}</option><option value="release_notes">{t('creator.log.kind.releaseNotes')}</option><option value="milestone">{t('creator.log.kind.milestone')}</option></select></label><label>{t('creator.log.release')}<select name="releaseId" value={form.releaseId} onChange={update}><option value="">{t('creator.log.noRelease')}</option>{state.releases.map(release => <option value={release.id} key={release.id}>{release.label} · {release.targetKey}</option>)}</select></label></div><label>{t('creator.log.entryTitle')}<input required name="title" minLength="5" maxLength="120" value={form.title} onChange={update} placeholder={t('creator.log.titlePlaceholder')}/></label><label>{t('creator.log.body')}<textarea required name="body" minLength="20" maxLength="4000" value={form.body} onChange={update} placeholder={t('creator.log.bodyPlaceholder')}/></label><button className="button button--primary" type="submit" disabled={!!busy}>{t(busy === 'save' ? 'creator.log.saving' : editing ? 'creator.log.saveChanges' : 'creator.log.saveDraft')}</button></form>{message && <p className="development-log-message" role="status">{message}</p>}<section className="development-log-manager"><div className="section-heading"><div><span className="kicker">LOG ENTRIES</span><h2>{t('creator.log.entries')}</h2></div><span>{t('creator.log.count',{count:state.entries.length})}</span></div>{state.entries.length ? <div className="development-log-manager__list">{state.entries.map(entry => <article className={`development-log-card is-${entry.publicationState}`} key={entry.id}><header><div><span>{t(kindLabels[entry.entryKind])}</span><h3>{entry.title}</h3></div><strong>{t(stateLabels[entry.publicationState])}</strong></header><p>{entry.body}</p><footer><div>{entry.release && <small>{t('creator.log.linkedRelease',{label:entry.release.label,target:entry.release.targetKey})}</small>}<time>{date(entry.updatedAt,{dateStyle:'short',timeStyle:'short'})}</time></div><div>{entry.publicationState === 'draft' && <><button type="button" disabled={!!busy} onClick={() => edit(entry)}>{t('creator.log.edit')}</button><button type="button" className="button button--primary" disabled={!!busy || state.work.state !== 'published'} onClick={() => action(entry, 'publish')}>{t('creator.log.publish')}</button></>}{entry.publicationState === 'published' && <button type="button" className="danger-button" disabled={!!busy} onClick={() => action(entry, 'withdraw')}>{t('creator.log.withdraw')}</button>}</div></footer></article>)}</div> : <div className="creator-feedback__empty">{t('creator.log.empty')}</div>}</section></main>;
}
