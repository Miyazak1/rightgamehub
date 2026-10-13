import React, { useState } from 'react';
import { useI18n } from './I18n.jsx';

const workIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stateLabels = { created: 'creator.ruleSubmit.state.created',receiving: 'creator.ruleSubmit.state.receiving',uploaded: 'creator.ruleSubmit.state.uploaded',submitted: 'creator.ruleSubmit.state.submitted',in_review: 'creator.ruleSubmit.state.inReview',changes_requested: 'creator.ruleSubmit.state.changes',approved_for_build: 'creator.ruleSubmit.state.approved',rejected: 'creator.ruleSubmit.state.rejected',failed: 'creator.ruleSubmit.state.failed' };
const readJson = async (file,t) => {
  if (!file || file.size > 512 * 1024) throw new Error(t('creator.ruleSubmit.jsonTooLarge'));
  try { return JSON.parse(await file.text()); } catch { throw new Error(t('creator.ruleSubmit.invalidJson',{name:file.name})); }
};
const sha256 = async file => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(value => value.toString(16).padStart(2,'0')).join('');

export default function MultiplayerRuleSubmissionPage({ api,demo,go }) {
  const {t,date}=useI18n();
  const [workId,setWorkId] = useState('');
  const [modeName,setModeName] = useState(()=>t('creator.multiplayer.defaultName'));
  const [turnSeconds,setTurnSeconds] = useState('60');
  const [source,setSource] = useState(null);
  const [creatorFile,setCreatorFile] = useState(null);
  const [doctorFile,setDoctorFile] = useState(null);
  const [phase,setPhase] = useState('select');
  const [progress,setProgress] = useState(0);
  const [result,setResult] = useState(null);
  const [history,setHistory] = useState([]);
  const [error,setError] = useState('');

  const loadHistory = async () => {
    if (!workIdPattern.test(workId)) return setError(t('creator.ruleSubmit.validUuidFirst'));
    setError('');
    try { setHistory(demo ? [] : (await api.listMultiplayerRuleSubmissions(workId)).data); }
    catch (caught) { setError(caught.message || t('creator.ruleSubmit.historyFailed')); }
  };
  const start = async () => {
    if (!workIdPattern.test(workId)) return setError(t('creator.ruleSubmit.uuidRequired'));
    if (!source || !creatorFile || !doctorFile) return setError(t('creator.ruleSubmit.filesRequired'));
    if (!source.name.toLowerCase().endsWith('.zip') || source.size < 1 || source.size > 20 * 1024 * 1024) return setError(t('creator.ruleSubmit.zipInvalid'));
    setError(''); setResult(null);
    try {
      setPhase('checking');
      const [creatorSubmission,doctorReport,digest] = await Promise.all([readJson(creatorFile,t),readJson(doctorFile,t),sha256(source)]);
      if (creatorSubmission.workId !== workId) throw new Error(t('creator.ruleSubmit.workMismatch'));
      if (doctorReport.ok !== true || Number(doctorReport.summary?.errors) !== 0) throw new Error(t('creator.ruleSubmit.doctorFailed'));
      const body = {
        modeKey: creatorSubmission.modeKey,modeName,rulesetVersion: creatorSubmission.rulesetVersion,
        minPlayers: Number(creatorSubmission.players?.min),maxPlayers: Number(creatorSubmission.players?.max),modeConfig: { turnSeconds: Number(turnSeconds) },
        fileName: source.name,declaredBytes: String(source.size),sha256: digest,creatorSubmission,doctorReport,
      };
      if (demo) {
        setProgress(100); setResult({ id: 'demo-submission',state: 'submitted',...body,sourceSha256: digest,createdAt: new Date().toISOString() }); setPhase('done'); return;
      }
      const created = (await api.createMultiplayerRuleSubmission(workId,body)).data;
      const grant = (await api.createMultiplayerRuleUploadGrant(created.id)).data;
      setPhase('uploading');
      await api.uploadMultiplayerRulePackage(created.id,source,grant.token,{ onProgress: value => setProgress(value.percent) });
      setPhase('submitting');
      const submitted = (await api.submitMultiplayerRuleSubmission(created.id)).data;
      setResult(submitted); setPhase('done'); await loadHistory();
    } catch (caught) { setError(caught.message || t('creator.ruleSubmit.failed')); setPhase('select'); }
  };

  return <main className="page multiplayer-rule-submit-page">
    <button className="back-link" onClick={() => go('/creator/multiplayer')}>← {t('creator.ruleSubmit.back')}</button>
    <div className="section-heading"><div><span className="kicker">TRUSTED RULES INTAKE</span><h1>{t('creator.ruleSubmit.title')}</h1><p>{t('creator.ruleSubmit.lead')}</p></div><span className="status-badge">{t('creator.ruleSubmit.limit')}</span></div>
    <div className="rule-submit-layout">
      <section className="panel rule-submit-form">
        <div className="form-grid"><label>{t('creator.ruleSubmit.workId')}<input value={workId} onChange={event => setWorkId(event.target.value.trim())} placeholder={t('creator.ruleSubmit.uuid')} disabled={phase !== 'select'}/></label><label>{t('creator.ruleSubmit.modeName')}<input maxLength="80" value={modeName} onChange={event => setModeName(event.target.value)} disabled={phase !== 'select'}/></label></div>
        <label>{t('creator.multiplayer.turnTimeout')}<input type="number" min="10" max="3600" value={turnSeconds} onChange={event => setTurnSeconds(event.target.value)} disabled={phase !== 'select'}/></label>
        <label className="file-drop compact"><input type="file" accept=".zip,application/zip" onChange={event => setSource(event.target.files?.[0] ?? null)} disabled={phase !== 'select'}/><strong>{source?.name ?? t('creator.ruleSubmit.chooseZip')}</strong><small>{t('creator.ruleSubmit.zipHint')}</small></label>
        <div className="rule-evidence-files"><label>creator-submission.json<input type="file" accept="application/json,.json" onChange={event => setCreatorFile(event.target.files?.[0] ?? null)} disabled={phase !== 'select'}/><span>{creatorFile?.name ?? t('creator.ruleSubmit.notSelected')}</span></label><label>Creator Doctor JSON<input type="file" accept="application/json,.json" onChange={event => setDoctorFile(event.target.files?.[0] ?? null)} disabled={phase !== 'select'}/><span>{doctorFile?.name ?? t('creator.ruleSubmit.notSelected')}</span></label></div>
        {phase === 'select' && <button className="button button--primary" onClick={start}>{t('creator.ruleSubmit.validateSubmit')}</button>}
        {['checking','uploading','submitting'].includes(phase) && <div className="processing-note"><span className="spinner"/><div><strong>{phase === 'checking' ? t('creator.ruleSubmit.checking') : phase === 'uploading' ? t('creator.ruleSubmit.uploading',{progress}) : t('creator.ruleSubmit.submitting')}</strong><p>{t('creator.ruleSubmit.wait')}</p></div></div>}
        {phase === 'done' && result && <div className="rule-submit-success"><span>✓</span><div><strong>{t('creator.ruleSubmit.success')}</strong><p>{t('creator.ruleSubmit.number',{id:result.id,state:t(stateLabels[result.state]||'creator.ruleSubmit.state.submitted')})}</p><code>{result.sourceSha256}</code></div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <aside className="panel rule-submit-boundary"><span className="kicker">SECURITY GATE</span><h2>{t('creator.ruleSubmit.notLive')}</h2><ol><li>{t('creator.ruleSubmit.gate1')}</li><li>{t('creator.ruleSubmit.gate2')}</li><li>{t('creator.ruleSubmit.gate3')}</li><li>{t('creator.ruleSubmit.gate4')}</li><li>{t('creator.ruleSubmit.gate5')}</li><li>{t('creator.ruleSubmit.gate6')}</li></ol><p>{t('creator.ruleSubmit.boundary')}</p></aside>
    </div>
    <section className="panel rule-submission-history"><div><span className="kicker">SUBMISSION HISTORY</span><h2>{t('creator.ruleSubmit.history')}</h2></div><button className="button button--secondary" onClick={loadHistory}>{t('creator.ruleSubmit.refresh')}</button>{history.length ? <ol>{history.map(item => <li key={item.id}><div><strong>{item.modeName} · {item.rulesetVersion}</strong><small>{item.modeKey} · {date(item.createdAt,{dateStyle:'short',timeStyle:'short'})}</small></div><span className={`rule-state rule-state--${item.state}`}>{stateLabels[item.state]?t(stateLabels[item.state]):item.state}</span>{item.reviewNote && <p>{item.reviewNote}</p>}</li>)}</ol> : <p>{t('creator.ruleSubmit.historyHint')}</p>}</section>
  </main>;
}
