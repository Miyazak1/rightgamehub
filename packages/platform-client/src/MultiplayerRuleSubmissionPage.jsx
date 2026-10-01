import React, { useState } from 'react';

const workIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stateLabels = { created: '等待上传',receiving: '上传中',uploaded: '待提交',submitted: '等待审核',in_review: '审核中',changes_requested: '需修改',approved_for_build: '已进入受控构建',rejected: '未通过',failed: '上传失败' };
const readJson = async file => {
  if (!file || file.size > 512 * 1024) throw new Error('JSON 报告不能超过 512 KB。');
  try { return JSON.parse(await file.text()); } catch { throw new Error(`${file.name} 不是有效 JSON。`); }
};
const sha256 = async file => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(value => value.toString(16).padStart(2,'0')).join('');

export default function MultiplayerRuleSubmissionPage({ api,demo,go }) {
  const [workId,setWorkId] = useState('');
  const [modeName,setModeName] = useState('双人对战');
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
    if (!workIdPattern.test(workId)) return setError('请先填写有效的作品 UUID。');
    setError('');
    try { setHistory(demo ? [] : (await api.listMultiplayerRuleSubmissions(workId)).data); }
    catch (caught) { setError(caught.message || '提交记录读取失败。'); }
  };
  const start = async () => {
    if (!workIdPattern.test(workId)) return setError('作品 ID 必须是有效 UUID。');
    if (!source || !creatorFile || !doctorFile) return setError('请同时选择源码 ZIP、creator-submission.json 和 Creator Doctor JSON。');
    if (!source.name.toLowerCase().endsWith('.zip') || source.size < 1 || source.size > 20 * 1024 * 1024) return setError('源码包必须是 1 字节至 20 MB 的 ZIP。');
    setError(''); setResult(null);
    try {
      setPhase('checking');
      const [creatorSubmission,doctorReport,digest] = await Promise.all([readJson(creatorFile),readJson(doctorFile),sha256(source)]);
      if (creatorSubmission.workId !== workId) throw new Error('creator-submission.json 的 workId 与当前作品不一致。');
      if (doctorReport.ok !== true || Number(doctorReport.summary?.errors) !== 0) throw new Error('Creator Doctor 报告没有通过，不能提交审核。');
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
    } catch (caught) { setError(caught.message || '规则提交没有完成。'); setPhase('select'); }
  };

  return <main className="page multiplayer-rule-submit-page">
    <button className="back-link" onClick={() => go('/creator/multiplayer')}>← 返回开发者中心</button>
    <div className="section-heading"><div><span className="kicker">TRUSTED RULES INTAKE</span><h1>提交规则审核包</h1><p>源码只进入隔离区；平台审核、受控构建、摘要确认和离线签名完成前，不会在 API 或 Realtime 中执行。</p></div><span className="status-badge">最大 20 MB · ZIP</span></div>
    <div className="rule-submit-layout">
      <section className="panel rule-submit-form">
        <div className="form-grid"><label>作品 ID<input value={workId} onChange={event => setWorkId(event.target.value.trim())} placeholder="作品 UUID" disabled={phase !== 'select'}/></label><label>模式显示名称<input maxLength="80" value={modeName} onChange={event => setModeName(event.target.value)} disabled={phase !== 'select'}/></label></div>
        <label>回合超时（秒）<input type="number" min="10" max="3600" value={turnSeconds} onChange={event => setTurnSeconds(event.target.value)} disabled={phase !== 'select'}/></label>
        <label className="file-drop compact"><input type="file" accept=".zip,application/zip" onChange={event => setSource(event.target.files?.[0] ?? null)} disabled={phase !== 'select'}/><strong>{source?.name ?? '选择源码提交包 ZIP'}</strong><small>包含规则源码、单文件 CJS bundle、测试与说明；不会直接执行。</small></label>
        <div className="rule-evidence-files"><label>creator-submission.json<input type="file" accept="application/json,.json" onChange={event => setCreatorFile(event.target.files?.[0] ?? null)} disabled={phase !== 'select'}/><span>{creatorFile?.name ?? '未选择'}</span></label><label>Creator Doctor JSON<input type="file" accept="application/json,.json" onChange={event => setDoctorFile(event.target.files?.[0] ?? null)} disabled={phase !== 'select'}/><span>{doctorFile?.name ?? '未选择'}</span></label></div>
        {phase === 'select' && <button className="button button--primary" onClick={start}>校验并提交审核</button>}
        {['checking','uploading','submitting'].includes(phase) && <div className="processing-note"><span className="spinner"/><div><strong>{phase === 'checking' ? '正在核对证据和计算 SHA-256' : phase === 'uploading' ? `正在上传 ${progress}%` : '正在锁定提交并进入审核队列'}</strong><p>关闭页面前请等待本阶段完成。</p></div></div>}
        {phase === 'done' && result && <div className="rule-submit-success"><span>✓</span><div><strong>规则包已提交</strong><p>提交号 {result.id} · {stateLabels[result.state] ?? result.state}</p><code>{result.sourceSha256}</code></div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <aside className="panel rule-submit-boundary"><span className="kicker">SECURITY GATE</span><h2>提交不等于上线</h2><ol><li>核对 Doctor 证据与身份</li><li>人工审查规则和私密视图</li><li>隔离、固定工具链构建</li><li>比对 SHA-256 并离线签名</li><li>API/Realtime 同版本只读部署</li><li>管理员注册模式并双账号验收</li></ol><p>作者不能上传签名，也不能让浏览器决定胜负。</p></aside>
    </div>
    <section className="panel rule-submission-history"><div><span className="kicker">SUBMISSION HISTORY</span><h2>该作品的提交记录</h2></div><button className="button button--secondary" onClick={loadHistory}>刷新记录</button>{history.length ? <ol>{history.map(item => <li key={item.id}><div><strong>{item.modeName} · {item.rulesetVersion}</strong><small>{item.modeKey} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small></div><span className={`rule-state rule-state--${item.state}`}>{stateLabels[item.state] ?? item.state}</span>{item.reviewNote && <p>{item.reviewNote}</p>}</li>)}</ol> : <p>填写作品 ID 后可读取历史记录。</p>}</section>
  </main>;
}
