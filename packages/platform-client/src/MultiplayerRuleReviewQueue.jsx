import React, { useEffect, useState } from 'react';

const stateLabels = { submitted: '待接单',in_review: '审核中',changes_requested: '需修改',approved_for_build: '已进入受控构建',rejected: '未通过' };

export default function MultiplayerRuleReviewQueue({ api,demo }) {
  const demoItems = [{ id: 'demo-rules',workTitle: '秘密冲刺',ownerDisplayName: '示例作者',modeName: '双人对战',modeKey: 'duel',rulesetVersion: '1.0.0',state: 'submitted',sourceFileName: 'secret-race-source.zip',sourceSha256: 'a'.repeat(64),doctorSummary: { errors: 0,warnings: 1,info: 10 },submittedAt: new Date().toISOString() }];
  const [items,setItems] = useState([]); const [notes,setNotes] = useState({}); const [busy,setBusy] = useState(''); const [error,setError] = useState('');
  const load = async () => { try { setItems(demo ? demoItems : (await api.listAdminMultiplayerRuleSubmissions()).data); } catch (caught) { setError(caught.message || '规则审核队列读取失败。'); } };
  useEffect(() => { load(); }, [api,demo]);
  const act = async (item,action) => {
    const note = notes[item.id]?.trim() ?? '';
    if (action !== 'start' && !note) return setError('作出审核结论前必须填写说明。');
    setBusy(item.id); setError('');
    try {
      if (!demo) await api.reviewAdminMultiplayerRuleSubmission(item.id,{ action,...(note ? { note } : {}) });
      await load();
    } catch (caught) { setError(caught.message || '审核状态没有更新。'); }
    finally { setBusy(''); }
  };
  const download = async item => {
    setBusy(item.id); setError('');
    try {
      if (demo) return;
      const { data } = await api.downloadAdminMultiplayerRulePackage(item.id);
      const url = URL.createObjectURL(data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.sourceFileName; anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url),0);
    } catch (caught) { setError(caught.message || '源码包下载失败。'); }
    finally { setBusy(''); }
  };
  return <section className="admin-queue rule-review-queue"><div className="puzzle-ops__head"><div><span className="kicker">TRUSTED RULES REVIEW</span><h2>联网规则审核</h2><p>这里仅审查进入隔离区的源码和证据；“批准构建”不会自动签名、部署或注册模式。</p></div><span>{items.length} 份排队</span></div>{error && <p className="form-error" role="alert">{error}</p>}{items.length ? items.map(item => <article className="report-card rule-review-card" key={item.id}><div className="report-card__head"><div><span>{item.workTitle} · {item.ownerDisplayName}</span><h3>{item.modeName} / {item.rulesetVersion}</h3></div><span className={`rule-state rule-state--${item.state}`}>{stateLabels[item.state] ?? item.state}</span></div><dl><div><dt>identity</dt><dd>{item.modeKey}</dd></div><div><dt>Doctor</dt><dd>{item.doctorSummary?.errors ?? '—'} error / {item.doctorSummary?.warnings ?? '—'} warning</dd></div><div><dt>源码摘要</dt><dd><code>{item.sourceSha256?.slice(0,16)}…</code></dd></div></dl><button className="text-button" disabled={busy === item.id} onClick={() => download(item)}>下载隔离源码包</button>{item.state === 'submitted' ? <div className="dialog-actions"><button className="button button--primary" disabled={busy === item.id} onClick={() => act(item,'start')}>开始审核</button></div> : <><label>审核说明<textarea maxLength="2000" value={notes[item.id] || ''} onChange={event => setNotes(current => ({ ...current,[item.id]: event.target.value }))} placeholder="记录代码审查、确定性、私密信息和构建要求。"/></label><div className="dialog-actions"><button className="button button--secondary" disabled={busy === item.id} onClick={() => act(item,'request_changes')}>要求修改</button><button className="danger-button" disabled={busy === item.id} onClick={() => act(item,'reject')}>拒绝</button><button className="button button--primary" disabled={busy === item.id} onClick={() => act(item,'approve_for_build')}>批准进入受控构建</button></div></>}</article>) : <div className="admin-empty"><span>✓</span><strong>规则审核队列为空</strong><p>新提交会在这里出现；已批准项目进入独立受控构建流程。</p></div>}</section>;
}
