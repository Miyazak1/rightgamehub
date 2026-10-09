import React, { useEffect, useRef, useState } from 'react';
import { demoWorks } from './demo.mjs';
import { creatorAiTaskKinds, initialAiTaskForm, createCreatorAiTask, currentPublishedReleases, formatCreatorAiTask } from './creator-ai-task.mjs';

function TaskEditor({ kind, work, releases, demo, go }) {
  const [form, setForm] = useState(() => initialAiTaskForm(kind));
  const [output, setOutput] = useState(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const promptRef = useRef(null), jsonRef = useRef(null);
  const published = currentPublishedReleases(work, releases);
  const update = event => { setForm(current => ({ ...current, [event.target.name]: event.target.value })); setOutput(null); setError(''); setCopyStatus(''); };
  const generate = event => {
    event.preventDefault(); setError(''); setCopyStatus('');
    try { const task = createCreatorAiTask({ kind, work, releases, form, demo }); setOutput({ task, prompt: formatCreatorAiTask(task), json: JSON.stringify(task, null, 2) }); }
    catch (caught) { setOutput(null); setError(caught.message); }
  };
  const copy = async (value, ref) => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(value); setCopyStatus('已复制，可粘贴到正在编写这个游戏的 AI 会话。');
    } catch { ref.current?.focus(); ref.current?.select(); setCopyStatus('无法自动复制，已选中文本，请按 Ctrl+C（Mac 使用 ⌘C）。'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([output.json + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gamehub-ai-${kind}-task.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <section className="creator-ai-context" aria-label="作品上下文"><div><span>当前作品</span><strong>{work.title}</strong><p>{work.description || '尚未填写作品简介'}</p></div><div><span>当前发布版本</span>{published.length ? published.map(release => <strong key={release.id}>{release.targetKey} · {release.label || '已发布版本（见任务包 ID）'}</strong>) : <strong>尚无公开发布版本</strong>}<small>自动带入作品资料；AI 仍需检查你本地的游戏源码。</small></div></section>
    <div className="creator-ai-layout">
      <form className="panel creator-ai-form" onSubmit={generate}>
        <span className="kicker">01 · 描述需求</span><h2>{kind === 'multiplayer' ? '希望玩家怎样一起玩？' : '想让玩家比什么？'}</h2>
        {kind === 'multiplayer' ? <>
          <label>每局玩家人数<select aria-label="每局玩家人数" name="players" value={form.players} onChange={update}>{Array.from({ length: 7 }, (_, i) => i + 2).map(n => <option key={n} value={n}>{n} 人</option>)}</select></label>
          <label>联机玩法<textarea name="gameplay" required minLength="10" maxLength="1200" value={form.gameplay} onChange={update} placeholder="例如：两个人轮流移动棋子，先到终点获胜；希望能邀请朋友加入。"/></label>
          <label>哪些信息只允许自己看到？<textarea name="privateInformation" maxLength="600" value={form.privateInformation} onChange={update} placeholder="可选，例如自己的手牌；没有秘密信息可填写“全部公开”。"/></label>
          <p className="creator-ai-note">AI 会先判断现有联机能力是否适合玩法。新规则仍需平台审核后才能上线。</p>
        </> : <>
          <label>排名指标<input name="metric" required maxLength="40" value={form.metric} onChange={update} placeholder="例如：得分、通关用时、步数"/></label>
          <div className="creator-ai-fields"><label>怎样排在前面<select aria-label="怎样排在前面" name="direction" value={form.direction} onChange={update}><option value="desc">越大越好</option><option value="asc">越小越好</option></select></label><label>榜单周期<select aria-label="榜单周期" name="period" value={form.period} onChange={update}><option value="all-time">总榜</option><option value="daily">每日榜（北京时间）</option></select></label></div>
          <label>什么时候计分，怎么算？<textarea name="scoring" required minLength="10" maxLength="1200" value={form.scoring} onChange={update} placeholder="例如：成功通关后记录总用时，暂停时间不计入；用时相同先提交者在前。"/></label>
          <p className="creator-ai-note">首阶段接入休闲榜，由游戏提交成绩。AI 会检查现有规则，避免新旧成绩混排。</p>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" type="submit">生成 AI 任务</button>
      </form>
      <aside className="panel creator-ai-handoff"><span className="kicker">02 · 交给你的 AI</span><h2>在游戏项目中继续</h2><ol><li>生成任务后，复制到正在编写这个游戏的 AI 会话。</li><li>让 AI 检查代码、修改、测试，并生成可上传的游戏包。</li><li>检查改动和测试结果，确认后再上传、发布。</li></ol><p>此页面只生成说明，不会调用 AI、修改项目或开始上传。</p><button className="text-button" type="button" onClick={() => go(creatorAiTaskKinds[kind].technicalRoute)}>高级：技术文档与官方模板 →</button></aside>
    </div>
    {output && <section className="panel creator-ai-output" aria-label="生成的 AI 任务"><div className="creator-ai-output-head"><div><span className="kicker">任务已准备好</span><h2>复制到 AI 会话</h2></div><button className="button button--primary" type="button" onClick={() => copy(output.prompt, promptRef)}>复制中文任务说明</button></div><textarea ref={promptRef} aria-label="中文 AI 任务说明" readOnly value={output.prompt}/><p role="status">{copyStatus || '包含当前作品、发布版本、接入要求、测试与打包步骤。上传和发布分别需要你确认。'}</p><details><summary>给 AI 或工具使用的 JSON 任务包</summary><div className="creator-ai-output-actions"><button className="button button--secondary" type="button" onClick={() => copy(output.json, jsonRef)}>复制 JSON</button><button className="button button--secondary" type="button" onClick={download}>下载 JSON 任务包</button></div><textarea ref={jsonRef} aria-label="JSON 任务包" readOnly value={output.json}/></details></section>}
  </>;
}

export default function CreatorAiTaskPage({ api, demo = false, go, kind, initialWorkId = '' }) {
  const [list, setList] = useState({ status: 'loading', works: [] });
  const [selectedId, setSelectedId] = useState(initialWorkId);
  const [context, setContext] = useState({ workId: '', status: 'loading', releases: [] });
  const [reload, setReload] = useState(0), [retry, setRetry] = useState(0);
  const info = creatorAiTaskKinds[kind];
  useEffect(() => {
    let active = true; setList({ status: 'loading', works: [] });
    (demo ? Promise.resolve({ data: demoWorks.slice(1, 3) }) : api.listCreatorWorks()).then(({ data }) => {
      if (!active) return;
      setList({ status: 'ready', works: data });
      setSelectedId(current => current || (data.length === 1 ? data[0].id : ''));
    }).catch(caught => { if (active) setList({ status: caught.status === 401 ? 'auth' : caught.status === 403 ? 'forbidden' : 'error', works: [] }); });
    return () => { active = false; };
  }, [api, demo, reload]);
  const work = list.works.find(item => item.id === selectedId);
  useEffect(() => {
    if (!work) return undefined;
    let active = true; setContext({ workId: work.id, status: 'loading', releases: [] });
    (demo ? Promise.resolve({ data: (work.targets || []).filter(target => target.currentReleaseId).map(target => ({ id: target.currentReleaseId, targetKey: target.targetKey, label: '1.0.0（演示）', packageType: 'web_zip' })) }) : api.listWorkReleases(work.id)).then(({ data }) => {
      if (active) setContext({ workId: work.id, status: 'ready', releases: data });
    }).catch(caught => { if (active) setContext({ workId: work.id, status: caught.status === 401 ? 'auth' : 'error', releases: [] }); });
    return () => { active = false; };
  }, [api, demo, work, retry]);
  return <main className="page creator-ai-page"><button className="back-link" onClick={() => go('/creator')}>← 返回创作中心</button><header className="creator-ai-heading"><span className="kicker">CREATOR STUDIO · AI</span><h1>{info.title}</h1><p>{info.description}</p>{demo && <small>演示模式：任务包仅包含示例作品，不代表你的项目。</small>}</header>
    {list.status === 'loading' ? <p role="status">正在读取你的作品…</p> : list.status === 'auth' ? <section className="panel creator-ai-empty"><h2>登录后选择你的作品</h2><p>任务说明会带入当前账号的作品和版本信息。</p><button className="button button--primary" onClick={() => go('/account')}>前往登录</button></section> : list.status === 'forbidden' ? <section className="panel creator-ai-empty"><h2>需要创作者权限</h2><button className="button button--primary" onClick={() => go('/creator')}>返回创作中心申请</button></section> : list.status === 'error' ? <section className="panel creator-ai-empty"><p role="alert">作品暂时无法读取。</p><button className="button button--secondary" onClick={() => setReload(value => value + 1)}>重试读取作品</button></section> : !list.works.length ? <section className="panel creator-ai-empty"><h2>先创建一个作品</h2><p>有了作品资料，就能为它生成准确的接入任务。</p><button className="button button--primary" onClick={() => go('/creator/works/new')}>新建作品</button><button className="text-button" onClick={() => go('/creator/import')}>从 GitHub 导入</button></section> : <>
      <label className="creator-ai-work-select">选择作品<select aria-label="选择作品" value={selectedId} onChange={event => { setSelectedId(event.target.value); setContext({ workId: '', status: 'loading', releases: [] }); }}><option value="">请选择要改造的作品</option>{list.works.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      {selectedId && !work ? <p role="alert">当前账号无法访问此作品，请重新选择。</p> : work && (context.workId !== work.id || context.status === 'loading') ? <p role="status">正在读取当前作品的版本…</p> : work && context.status === 'auth' ? <p role="alert">登录已失效。<button className="text-button" onClick={() => go('/account')}>重新登录</button></p> : work && context.status === 'error' ? <p role="alert">版本信息暂时无法读取。<button className="text-button" onClick={() => setRetry(value => value + 1)}>重试读取版本</button></p> : work ? <TaskEditor key={`${kind}:${work.id}:${work.revision}`} kind={kind} work={work} releases={context.releases} demo={demo} go={go}/> : <p className="creator-ai-note">选好作品后，填写玩法或计分需求即可生成任务。</p>}
    </>}
    <footer className="creator-ai-footer"><button className="text-button" onClick={() => go(info.technicalRoute)}>技术文档与官方模板 ↗</button></footer>
  </main>;
}
