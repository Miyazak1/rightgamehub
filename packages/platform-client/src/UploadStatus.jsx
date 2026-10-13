import React from 'react';
import { useI18n } from './I18n.jsx';

export function UploadStatusNote({ display }) {
  return <div className="processing-note"><span className={display.terminal ? 'upload-result-mark is-' + display.tone : 'spinner'} aria-hidden="true">{display.terminal ? (display.state === 'succeeded' ? '✓' : '!') : ''}</span><div><strong>{display.title}</strong><p>{display.description}</p></div></div>;
}

export function UploadTimeline({ display }) {
  const {t}=useI18n();
  return <aside className="panel timeline upload-timeline" aria-label={t('creator.upload.progressAria')}><span className="kicker">RELEASE STATUS</span><h2>{t('creator.upload.progress')}</h2><p className={'upload-timeline__result is-' + display.tone} role="status">{display.title}</p><ol>{display.steps.map((step, index) => <li key={step.id} data-upload-step={step.id} className={step.status === 'complete' ? 'is-done' : step.status === 'current' ? 'is-current' : ''} aria-current={step.status === 'current' ? 'step' : undefined} aria-label={`${step.label}, ${step.detail}`}><span aria-hidden="true">{step.status === 'complete' ? '✓' : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol></aside>;
}
