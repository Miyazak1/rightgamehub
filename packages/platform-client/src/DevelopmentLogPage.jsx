import React, { useEffect, useState } from 'react';
import { demoWorks } from './demo.mjs';

const kindLabels = { update: '开发进展', release_notes: '版本说明', milestone: '里程碑' };
const stateLabels = { draft: '草稿', published: '已公开', withdrawn: '已撤回' };
const emptyForm = { entryKind: 'update', title: '', body: '', releaseId: '' };

export default function DevelopmentLogPage({ workId, api, demo, go }) {
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
        entry = { id: editing?.id ?? `demo-${Date.now()}`, workId, ...payload, publicationState: 'draft', version: (editing?.version ?? 0) + 1, release: state.releases.find(item => item.id === payload.releaseId) ?? null, authorDisplayName: '演示作者', publishedAt: null, withdrawnAt: null, createdAt: editing?.createdAt ?? now, updatedAt: now };
      } else if (editing) entry = (await api.updateDevelopmentEntry(editing.id, { action: 'edit', expectedVersion: editing.version, ...payload })).data;
      else entry = (await api.createDevelopmentEntry(workId, payload)).data;
      setState(current => ({ ...current, entries: editing ? current.entries.map(item => item.id === entry.id ? entry : item) : [entry, ...current.entries] }));
      setMessage(editing ? '草稿已更新。' : '草稿已保存，确认内容后再公开。'); reset();
    } catch (error) { setMessage(error.message || '开发日志暂时无法保存。'); }
    finally { setBusy(''); }
  };
  const action = async (entry, name) => {
    if (busy) return;
    if (name === 'withdraw' && !globalThis.confirm?.('撤回这篇开发日志？公开时间线将不再显示它。')) return;
    setBusy(`${entry.id}:${name}`); setMessage('');
    try {
      const next = demo ? { ...entry, publicationState: name === 'publish' ? 'published' : 'withdrawn', publishedAt: entry.publishedAt ?? new Date().toISOString(), withdrawnAt: name === 'withdraw' ? new Date().toISOString() : null, version: entry.version + 1 }
        : (await api.updateDevelopmentEntry(entry.id, { action: name, expectedVersion: entry.version })).data;
      setState(current => ({ ...current, entries: current.entries.map(item => item.id === next.id ? next : item) }));
      setMessage(name === 'publish' ? '开发日志已进入作品公开时间线。' : '开发日志已撤回。');
    } catch (error) { setMessage(error.message || '操作失败，请刷新后重试。'); }
    finally { setBusy(''); }
  };
  const edit = entry => {
    setEditing(entry); setForm({ entryKind: entry.entryKind, title: entry.title, body: entry.body, releaseId: entry.release?.id ?? '' }); setMessage('');
    globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  if (state.status !== 'ready') return <main className="page narrow-page"><button className="back-link" onClick={() => go('/creator')}>← 返回创作中心</button><section className="panel work-edit-empty"><h1>作者开发日志</h1><p role="status">{state.status === 'loading' ? '正在读取日志…' : state.status === 'auth' ? '请重新登录后管理开发日志。' : state.status === 'missing' ? '作品不存在或不属于当前账号。' : '开发日志暂时无法读取。'}</p>{state.status === 'error' && <button className="button button--secondary" onClick={load}>重试</button>}</section></main>;

  return <main className="page narrow-page development-log-page"><button className="back-link" onClick={() => go('/creator')}>← 返回创作中心</button><div className="section-heading"><div><span className="kicker">DEVELOPMENT LOG</span><h1>《{state.work.title}》开发日志</h1><p>记录版本变化与开发决策；公开后会和已验收贡献一起出现在作品时间线。</p></div><button className="text-button" onClick={() => go(`/works/${workId}`)}>查看作品 →</button></div><form className="panel development-log-form" onSubmit={save}><div className="development-log-form__head"><div><h2>{editing ? '编辑日志草稿' : '新建日志草稿'}</h2><p>玩家原始反馈保持私有；只有已经公开的任务及验收成果会进入时间线。</p></div>{editing && <button type="button" className="text-button" onClick={reset}>取消编辑</button>}</div><div className="form-grid"><label>日志类型<select name="entryKind" value={form.entryKind} onChange={update}><option value="update">开发进展</option><option value="release_notes">版本说明</option><option value="milestone">里程碑</option></select></label><label>关联当前版本（可选）<select name="releaseId" value={form.releaseId} onChange={update}><option value="">不关联版本</option>{state.releases.map(release => <option value={release.id} key={release.id}>{release.label} · {release.targetKey}</option>)}</select></label></div><label>标题<input required name="title" minLength="5" maxLength="120" value={form.title} onChange={update} placeholder="例如：1.2 版本加入关卡编辑器"/></label><label>正文<textarea required name="body" minLength="20" maxLength="4000" value={form.body} onChange={update} placeholder="说明这次做了什么、为什么这样改，以及玩家可以看到哪些变化。"/></label><button className="button button--primary" type="submit" disabled={!!busy}>{busy === 'save' ? '保存中…' : editing ? '保存修改' : '保存草稿'}</button></form>{message && <p className="development-log-message" role="status">{message}</p>}<section className="development-log-manager"><div className="section-heading"><div><span className="kicker">LOG ENTRIES</span><h2>日志记录</h2></div><span>{state.entries.length} 条</span></div>{state.entries.length ? <div className="development-log-manager__list">{state.entries.map(entry => <article className={`development-log-card is-${entry.publicationState}`} key={entry.id}><header><div><span>{kindLabels[entry.entryKind]}</span><h3>{entry.title}</h3></div><strong>{stateLabels[entry.publicationState]}</strong></header><p>{entry.body}</p><footer><div>{entry.release && <small>关联版本 {entry.release.label} · {entry.release.targetKey}</small>}<time>{new Date(entry.updatedAt).toLocaleString('zh-CN')}</time></div><div>{entry.publicationState === 'draft' && <><button type="button" disabled={!!busy} onClick={() => edit(entry)}>编辑</button><button type="button" className="button button--primary" disabled={!!busy || state.work.state !== 'published'} onClick={() => action(entry, 'publish')}>公开发布</button></>}{entry.publicationState === 'published' && <button type="button" className="danger-button" disabled={!!busy} onClick={() => action(entry, 'withdraw')}>撤回</button>}</div></footer></article>)}</div> : <div className="creator-feedback__empty">还没有开发日志。先保存一篇草稿，检查后再公开。</div>}</section></main>;
}
