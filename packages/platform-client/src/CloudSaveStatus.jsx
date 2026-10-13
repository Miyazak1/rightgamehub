import React from 'react';
import {useI18n} from './I18n.jsx';

export default function CloudSaveStatus({status}) {
  const {t}=useI18n();
  if(!status)return null;
  const reading=status.operation==='read';
  const labels={
    idle:'cloudSave.state.idle',local_only:'cloudSave.state.localOnly',local_pending:'cloudSave.state.localPending',
    syncing:status.operation==='restore'?'cloudSave.state.restoring':status.operation==='delete'?'cloudSave.state.deleting':'cloudSave.state.saving',
    cloud:status.operation==='delete'?'cloudSave.state.deleted':status.operation==='restore'?'cloudSave.state.restored':'cloudSave.state.confirmed',
    conflict:'cloudSave.state.conflict',
    error_retryable:status.durability==='local'?'cloudSave.state.retrying':reading?'cloudSave.state.readFailed':'cloudSave.state.unconfirmed',
    blocked:'cloudSave.state.blocked',
  };
  const notes={
    idle:'cloudSave.note.idle',local_only:'cloudSave.note.localOnly',local_pending:'cloudSave.note.localPending',
    syncing:'cloudSave.note.syncing',
    cloud:status.historyDegraded?'cloudSave.note.historyDegraded':'cloudSave.note.confirmed',
    conflict:'cloudSave.note.conflict',
    error_retryable:status.durability==='local'?'cloudSave.note.retrying':reading?'cloudSave.note.readFailed':'cloudSave.note.unconfirmed',
    blocked:'cloudSave.note.blocked',
  };
  const label=labels[status.state];
  if(!label)return null;
  return <span className={`cloud-save-status cloud-save-status--${status.state}`} role="status" aria-live="polite" title={t(notes[status.state])}>
    <i aria-hidden="true"/><span>{t(label)}</span>
    {status.state==='cloud'&&status.historyDegraded&&<small>{t('cloudSave.historyLimited')}</small>}
  </span>;
}
