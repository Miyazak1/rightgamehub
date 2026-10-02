import React, { useEffect, useState } from 'react';

const statusLabels = { draft: '草稿', open: '等待领取', claimed: '进行中', submitted: '等待验收', completed: '已完成', closed: '已关闭' };
const difficultyLabels = { starter: '适合第一次贡献', intermediate: '需要一些经验', advanced: '进阶任务' };
const demoIdentity = { id: 'demo-user', handle: 'miyazaki1', displayName: '休息玩家' };
const demoTasks = [{
  id: 'demo-task', workId: 'demo-work', workTitle: '像素迷阵', feedbackId: 'demo-feedback',
  title: '补充移动端触控提示', description: '为首次在手机打开游戏的玩家补充清晰的触控提示，并确认横竖屏都能正常阅读。',
  difficulty: 'starter', skills: ['HTML', 'CSS'], status: 'open', repositoryUrl: 'https://github.com/example/pixel-maze', issueUrl: null,
  submissionUrl: null, submissionNote: '', author: { id: 'demo-author', handle: 'pixel-author', displayName: '像素作者' }, claimant: null,
  publishedAt: new Date().toISOString(), claimedAt: null, submittedAt: null, completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}];

function ActionButton({ secondary = false, children, ...props }) {
  return <button type={props.onClick ? 'button' : 'submit'} className={`button button--${secondary ? 'secondary' : 'primary'}`} {...props}><span>{children}</span></button>;
}

function ExternalLink({ href, children }) {
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children} ↗</a> : null;
}

export function ContributionCenterPage({ api, demo, go, accountProfile }) {
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(''); const [submissionUrl, setSubmissionUrl] = useState(''); const [submissionNote, setSubmissionNote] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try { setState({ status: 'ready', items: demo ? demoTasks.filter(item => filter === 'all' || item.status === filter) : (await api.listContributionTasks(filter)).data }); }
    catch { setState({ status: 'error', items: [] }); }
  };
  useEffect(() => { load(); }, [api, demo, filter]);
  const act = async (item, action) => {
    setBusy(`${item.id}:${action}`); setMessage('');
    try {
      if (!demo) {
        if (action === 'claim') await api.claimContributionTask(item.id);
        if (action === 'release') await api.releaseContributionTask(item.id);
      }
      setMessage(action === 'claim' ? '任务已领取。完成后请提交公开的 PR、commit 或演示地址。' : '已释放任务，其他玩家现在可以领取。');
      await load();
    } catch (caught) {
      if (caught.status === 401) return go('/account');
      setMessage(caught.message || '任务状态暂时无法更新。');
    } finally { setBusy(''); }
  };
  const submit = async (event, item) => {
    event.preventDefault(); setBusy(`${item.id}:submit`); setMessage('');
    try {
      if (!demo) await api.submitContributionTask(item.id, { url: submissionUrl, note: submissionNote });
      setSubmitting(''); setSubmissionUrl(''); setSubmissionNote(''); setMessage('成果已提交给作者验收。'); await load();
    } catch (caught) { setMessage(caught.message || '成果暂时无法提交。'); }
    finally { setBusy(''); }
  };
  return <main className="page contribution-page">
    <section className="contribution-hero"><div><span className="kicker">COMMUNITY CONTRIBUTIONS</span><h1>从一个小任务开始共建</h1><p>领取作者公开的入门任务，在你自己的分支完成修改，再提交公开成果等待验收。</p></div><aside><strong>边界说明</strong><p>GameHub 不会替你执行仓库代码，也不会自动写入 GitHub。领取不等于获得仓库写权限。</p></aside></section>
    <nav className="contribution-filters" aria-label="贡献任务筛选">{[['all','全部'],['open','可领取'],['claimed','进行中'],['submitted','待验收'],['completed','已完成']].map(([value,label]) => <button type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</nav>
    {message && <p className="contribution-message" role="status">{message}</p>}
    {state.status === 'loading' ? <p className="contribution-state">正在读取共建任务…</p> : state.status === 'error' ? <p className="contribution-state is-error">共建任务暂时无法读取。</p> : !state.items.length ? <p className="contribution-state">这个筛选下还没有任务。</p> : <section className="contribution-grid">{state.items.map(item => {
      const mine = item.claimant?.id === accountProfile?.id || (demo && item.claimant?.id === demoIdentity.id);
      return <article className={`contribution-card is-${item.status}`} key={item.id}><header><div><button type="button" onClick={() => go(`/u/${item.author.handle}`)}>{item.author.displayName}</button><h2>{item.title}</h2><span>{item.workTitle}</span></div><strong>{statusLabels[item.status]}</strong></header><p>{item.description}</p><div className="contribution-tags"><em>{difficultyLabels[item.difficulty]}</em>{item.skills.map(skill => <span key={skill}>{skill}</span>)}</div><div className="contribution-links"><ExternalLink href={item.repositoryUrl}>查看仓库</ExternalLink><ExternalLink href={item.issueUrl}>查看 Issue</ExternalLink><ExternalLink href={item.submissionUrl}>查看成果</ExternalLink></div><footer>{item.status === 'open' && <ActionButton disabled={!!busy} onClick={() => act(item, 'claim')}>{busy ? '处理中…' : '领取任务'}</ActionButton>}{item.status === 'claimed' && mine && <><ActionButton onClick={() => { setSubmitting(item.id); setSubmissionUrl(''); setSubmissionNote(''); }}>提交成果</ActionButton><ActionButton secondary disabled={!!busy} onClick={() => act(item, 'release')}>释放任务</ActionButton></>}{item.status === 'claimed' && !mine && <small>已由 {item.claimant?.displayName || '另一位玩家'} 领取</small>}{item.status === 'submitted' && mine && <small>作者正在验收你的成果</small>}{item.status === 'completed' && <small>贡献者：{item.claimant?.displayName || '社区玩家'} · {new Date(item.completedAt).toLocaleDateString('zh-CN')}</small>}</footer>{submitting === item.id && <form className="contribution-submit" onSubmit={event => submit(event, item)}><label>公开成果地址<input required type="url" value={submissionUrl} onChange={event => setSubmissionUrl(event.target.value)} placeholder="https://github.com/owner/repo/pull/123"/></label><label>给作者的说明<textarea required minLength="5" maxLength="2000" value={submissionNote} onChange={event => setSubmissionNote(event.target.value)} placeholder="说明完成内容、测试方式和仍需注意的问题。"/></label><div><ActionButton disabled={!!busy}>{busy ? '提交中…' : '提交验收'}</ActionButton><ActionButton secondary onClick={() => setSubmitting('')}>取消</ActionButton></div></form>}</article>;
    })}</section>}
  </main>;
}

export function CreatorContributionTasks({ api, demo, refreshToken = 0 }) {
  const [state, setState] = useState({ status: 'loading', items: [] }); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [linking, setLinking] = useState(''); const [issueUrl, setIssueUrl] = useState('');
  const load = async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try { setState({ status: 'ready', items: demo ? [{ ...demoTasks[0], status: 'draft' }] : (await api.listCreatorContributionTasks()).data }); }
    catch (caught) { setState({ status: caught.status === 401 || caught.status === 403 ? 'unavailable' : 'error', items: [] }); }
  };
  useEffect(() => { load(); }, [api, demo, refreshToken]);
  const update = async (item, action, extra = {}) => {
    setBusy(`${item.id}:${action}`); setMessage('');
    try { if (!demo) await api.updateCreatorContributionTask(item.id, { action, ...extra }); setLinking(''); setIssueUrl(''); setMessage({ publish: '任务已公开，玩家现在可以领取。', complete: '贡献已验收并写入贡献者的公开履历。', request_changes: '已退回修改，贡献者可以再次提交。', close: '任务已关闭。', reopen: '任务已重新开放。', link_issue: '已关联 GitHub Issue。' }[action] || '任务已更新。'); await load(); }
    catch (caught) { setMessage(caught.message || '任务暂时无法更新。'); }
    finally { setBusy(''); }
  };
  const draftIssue = async item => {
    const popup = globalThis.open?.('', '_blank'); if (popup) popup.opener = null; setBusy(`${item.id}:issue`); setMessage('');
    try {
      const draft = demo ? { createUrl: `${item.repositoryUrl}/issues/new` } : (await api.createContributionIssueDraft(item.id)).data;
      if (!draft.createUrl) { popup?.close?.(); setMessage('作品没有关联 GitHub 仓库，暂时无法生成 Issue 预填页。'); }
      else { if (popup) popup.location.href = draft.createUrl; else globalThis.open?.(draft.createUrl, '_blank', 'noopener,noreferrer'); setMessage('已打开 GitHub 预填页。仓库需启用 Issues；请检查后手动提交，再回来关联地址。'); }
      await load();
    } catch (caught) { popup?.close?.(); setMessage(caught.message || 'Issue 草稿暂时无法生成。'); }
    finally { setBusy(''); }
  };
  return <section className="creator-contributions"><div className="creator-contributions__head"><div><span className="kicker">CONTRIBUTION TASKS</span><h2>共建任务</h2><p>先保存私有草稿；确认范围后再公开。你仍负责检查并验收每一项成果。</p></div><button type="button" className="text-button" onClick={load}>刷新</button></div>{message && <p className="contribution-message" role="status">{message}</p>}{state.status === 'loading' ? <p className="contribution-state">正在读取任务…</p> : state.status === 'error' ? <p className="contribution-state is-error">共建任务暂时无法读取。</p> : !state.items.length ? <p className="contribution-state">还没有共建任务。可从一条已查看的玩家反馈创建。</p> : <div className="creator-contributions__list">{state.items.map(item => <article key={item.id}><header><div><span>{item.workTitle}</span><h3>{item.title}</h3></div><strong>{statusLabels[item.status]}</strong></header><p>{item.description}</p><div className="contribution-tags"><em>{difficultyLabels[item.difficulty]}</em>{item.skills.map(skill => <span key={skill}>{skill}</span>)}</div>{item.claimant && <p className="creator-contributions__claim">贡献者：{item.claimant.displayName}{item.submissionUrl && <> · <ExternalLink href={item.submissionUrl}>查看提交</ExternalLink></>}</p>}<footer>{item.status === 'draft' && <ActionButton disabled={!!busy} onClick={() => update(item, 'publish')}>公开任务</ActionButton>}{['open','claimed'].includes(item.status) && <><ActionButton secondary disabled={!!busy} onClick={() => draftIssue(item)}>生成 Issue 草稿</ActionButton><ActionButton secondary disabled={!!busy} onClick={() => { setLinking(item.id); setIssueUrl(''); }}>关联 Issue</ActionButton><ActionButton secondary disabled={!!busy} onClick={() => update(item, 'close')}>关闭</ActionButton></>}{item.status === 'submitted' && <><ActionButton disabled={!!busy} onClick={() => update(item, 'complete')}>验收并记入履历</ActionButton><ActionButton secondary disabled={!!busy} onClick={() => update(item, 'request_changes')}>退回修改</ActionButton></>}{item.status === 'closed' && <ActionButton disabled={!!busy} onClick={() => update(item, 'reopen')}>重新开放</ActionButton>}{item.status === 'completed' && <small>已完成 · {new Date(item.completedAt).toLocaleDateString('zh-CN')}</small>}</footer>{linking === item.id && <form className="contribution-link" onSubmit={event => { event.preventDefault(); update(item, 'link_issue', { issueUrl }); }}><label>GitHub Issue 地址<input required type="url" value={issueUrl} onChange={event => setIssueUrl(event.target.value)} placeholder={`${item.repositoryUrl || 'https://github.com/owner/repo'}/issues/1`}/></label><ActionButton>保存关联</ActionButton><ActionButton secondary onClick={() => setLinking('')}>取消</ActionButton></form>}</article>)}</div>}</section>;
}

export function CreateContributionTaskForm({ item, api, demo, onCreated, onCancel }) {
  const [title, setTitle] = useState(item.summary); const [description, setDescription] = useState(`${item.details}${item.reproductionSteps ? `\n\n复现/验证：\n${item.reproductionSteps}` : ''}`);
  const [difficulty, setDifficulty] = useState('starter'); const [skillsText, setSkillsText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const skills = [...new Set(skillsText.split(/[，,]/).map(value => value.trim()).filter(Boolean))].slice(0, 8);
      if (!demo) await api.createContributionTaskFromFeedback(item.id, { title, description, difficulty, skills });
      await onCreated();
    } catch (caught) { setError(caught.message || '共建任务草稿暂时无法创建。'); }
    finally { setBusy(false); }
  };
  return <form className="contribution-create" onSubmit={submit}><div className="form-grid"><label>任务标题<input required minLength="5" maxLength="160" value={title} onChange={event => setTitle(event.target.value)}/></label><label>难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="starter">适合第一次贡献</option><option value="intermediate">需要一些经验</option><option value="advanced">进阶任务</option></select></label></div><label>完成标准<textarea required minLength="20" maxLength="4000" value={description} onChange={event => setDescription(event.target.value)}/></label><label>技能标签（最多 8 个）<input value={skillsText} onChange={event => setSkillsText(event.target.value)} placeholder="HTML, CSS, JavaScript"/></label><small>此操作只创建私有草稿；你还需要在“共建任务”区域明确公开。</small>{error && <p className="form-error" role="alert">{error}</p>}<div><ActionButton disabled={busy}>{busy ? '创建中…' : '创建私有任务草稿'}</ActionButton><ActionButton secondary onClick={onCancel}>取消</ActionButton></div></form>;
}
