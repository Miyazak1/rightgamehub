import React from 'react';

export default function CloudSaveStatus({status}) {
  if(!status)return null;
  const reading=status.operation==='read';
  const labels={
    idle:'在线云存档',
    syncing:status.operation==='restore'?'正在恢复存档':status.operation==='delete'?'正在删除存档':'正在保存',
    cloud:status.operation==='delete'?'云端存档已删除':status.operation==='restore'?'云端存档已恢复':'云端保存已确认',
    conflict:'云存档有冲突',
    error_retryable:reading?'存档读取失败':'保存尚未确认',
    blocked:'云存档暂不可用',
  };
  const notes={
    idle:'当前支持在线保存。',
    syncing:'请等待服务端确认。',
    cloud:status.historyDegraded?'本次操作已确认，但历史备份空间不足。':'本次操作已得到服务端确认。',
    conflict:'云端进度已有变化，请重新读取并选择要保留的进度。',
    error_retryable:reading?'请检查网络后重新读取。':'尚未收到保存确认，请保留游戏页面并重试原保存操作。',
    blocked:'当前版本或账号暂时无法访问云存档。',
  };
  const label=labels[status.state];
  if(!label)return null;
  return <span className={`cloud-save-status cloud-save-status--${status.state}`} role="status" aria-live="polite" title={notes[status.state]}>
    <i aria-hidden="true"/><span>{label}</span>
    {status.state==='cloud'&&status.historyDegraded&&<small>历史备份受限</small>}
  </span>;
}
