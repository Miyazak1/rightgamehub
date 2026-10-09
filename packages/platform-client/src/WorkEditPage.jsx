import React, { useEffect, useRef, useState } from 'react';
import { demoWorks } from './demo.mjs';
import WorkMetadataFields from './WorkMetadataFields.jsx';
import { workMetadataForm, workMetadataPayload } from './work-metadata.mjs';

function WorkEditor({ work, api, demo, go, onSaved }) {
  const [baseline, setBaseline] = useState(work), [form, setForm] = useState(() => workMetadataForm(work));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const pending = useRef(null), active = useRef(true), saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const update = event => { setForm(current => ({ ...current, [event.target.name]: event.target.value })); pending.current = null; if (!conflict) setError(''); };
  const save = async event => {
    event.preventDefault(); if (saving.current || conflict) return;
    try {
      const body = workMetadataPayload(form), signature = JSON.stringify([baseline.revision, body]);
      if (pending.current?.signature !== signature) pending.current = { signature, key: globalThis.crypto?.randomUUID?.() ?? `work-${Date.now()}-${Math.random().toString(16).slice(2)}` };
      saving.current = true; setBusy(true); setError('');
      const updated = demo ? { ...baseline, ...body, revision: String(Number(baseline.revision) + 1) } : (await api.updateWork(baseline.id, baseline.revision, body, { headers: { 'Idempotency-Key': pending.current.key } })).data;
      if (active.current) onSaved(updated);
    } catch (caught) {
      if (!active.current) return;
      if (caught.status === 412 || caught.code === 'REVISION_CONFLICT') { setConflict(true); setError('作品资料已在别处更新。你的输入已保留，请先重新载入最新资料，再重新编辑保存。'); }
      else setError(caught.status === 401 ? '登录已失效，请重新登录后再保存。' : caught.status === 403 ? '当前账号没有修改这件作品的权限。' : caught.status === 404 ? '作品不存在或已不可访问。' : caught.message || '保存失败，请重试。');
    } finally { saving.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => {
    if (saving.current) return; saving.current = true; setBusy(true);
    try {
      const latest = demo ? baseline : (await api.listCreatorWorks()).data.find(item => item.id === baseline.id);
      if (!latest) throw new Error('作品不存在或已不可访问。');
      if (active.current) { setBaseline(latest); setForm(workMetadataForm(latest)); pending.current = null; setConflict(false); setError(''); }
    } catch { if (active.current) setError('重新载入失败，当前输入仍保留。请稍后重试，或确认登录和作品访问权限。'); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  };
  return <><button className="back-link" disabled={busy} onClick={() => go('/creator')}>← 返回创作中心</button><form className="panel new-work-form work-edit-form" onSubmit={save}><span className="kicker">EDIT WORK</span><h1>编辑作品资料</h1><p>资料版本 {baseline.revision} · 作品类型创建后不能修改。</p>{baseline.state === 'published' && baseline.visibility === 'public' ? <aside className="work-edit-notice"><strong>保存后，公开详情立即更新。</strong><p>只更新作品资料，不上传或替换游戏包。当前发布版本、排行榜、存档和游玩地址不受影响。</p></aside> : <p>只修改资料；保存不会发布作品或替换游戏包。</p>}{demo && <p>演示模式：修改仅在本次页面会话中展示。</p>}<fieldset className="work-edit-fields" disabled={busy}><WorkMetadataFields form={form} onChange={update} kind={baseline.kind}/></fieldset>{error && <div className="form-error" role="alert"><p>{error}</p>{conflict && <><p>重新载入会替换当前未保存的输入，可先复制需要保留的内容。</p><button className="button button--secondary" type="button" disabled={busy} onClick={reload}>重新载入最新资料</button></>}</div>}<div className="dialog-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={() => go('/creator')}>取消</button><button className="button button--primary" type="submit" disabled={busy || conflict}>{busy ? '处理中…' : '保存资料'}</button></div></form></>;
}

export default function WorkEditPage({ workId, api, demo, go, onSaved, savedWork }) {
  const [state, setState] = useState({ status: 'loading', work: null }), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setState({ status: 'loading', work: null });
    (demo ? Promise.resolve({ data: demoWorks.map(work => savedWork?.id === work.id ? { ...work, ...savedWork } : work) }) : api.listCreatorWorks()).then(({ data }) => {
      if (!active) return; const work = data.find(item => item.id === workId); setState({ status: work ? 'ready' : 'missing', work });
    }).catch(caught => { if (active) setState({ status: caught.status === 401 ? 'auth' : caught.status === 403 ? 'forbidden' : 'error', work: null }); });
    return () => { active = false; };
  }, [workId, api, demo, retry]);
  return <main className="page narrow-page">{state.status === 'ready' ? <WorkEditor key={workId} work={state.work} api={api} demo={demo} go={go} onSaved={onSaved}/> : <section className="panel work-edit-empty"><h1>编辑作品资料</h1>{state.status === 'loading' ? <p role="status">正在读取作品资料…</p> : <><p role="alert">{state.status === 'auth' ? '请先登录，再编辑你的作品。' : state.status === 'missing' || state.status === 'forbidden' ? '作品不存在，或当前账号没有访问权限。' : '作品资料暂时无法读取。'}</p>{state.status === 'auth' ? <button className="button button--primary" onClick={() => go('/account')}>前往登录</button> : state.status === 'error' ? <button className="button button--secondary" onClick={() => setRetry(value => value + 1)}>重试读取资料</button> : null}<button className="text-button" onClick={() => go('/creator')}>返回创作中心</button></>}</section>}</main>;
}
