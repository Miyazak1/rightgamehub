import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './I18n.jsx';
import { MathContent } from './PracticeMath.tsx';
import './PracticePage.css';
import { usePlatformAssistant, PracticeAssistantActions } from './PlatformAssistant.jsx';
import { practiceAssistantContext } from './assistant-context.mjs';

const label = (value, locale) => value?.[locale] ?? value?.['zh-CN'] ?? value?.en ?? value ?? '';
const statusNames = { queued: ['等待准备', 'Queued'], preparing: ['正在准备', 'Preparing'], ready: ['继续练习', 'Resume'], completed: ['查看复盘', 'Review'], failed: ['准备未完成', 'Preparation failed'] };
const idKey = () => globalThis.crypto.randomUUID();

function Figure({ figure }) {
  if (!figure?.svg) return null;
  return <figure className="practice-figure"><img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(figure.svg)} alt={figure.caption || ''}/>{figure.caption && <figcaption>{figure.caption}</figcaption>}</figure>;
}
function Elapsed({ since }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000))); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [since]);
  return <span className="practice-elapsed">{seconds}s</span>;
}

export default function PracticePage({ api, go, accountProfile, batchId }) {
  const { locale, date } = useI18n();
  const en = locale === 'en', say = (zh, english) => en ? english : zh;
  const [catalog, setCatalog] = useState(null), [catalogError, setCatalogError] = useState('');
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState('');
  const [batch, setBatch] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [batchRefresh, setBatchRefresh] = useState(0);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [subjectId, setSubject] = useState('mathematics'), [stageId, setStage] = useState('');
  const [topicId, setTopic] = useState(''), [difficultyId, setDifficulty] = useState('basic'), [count, setCount] = useState(5);
  const [query, setQuery] = useState(''), [tab, setTab] = useState('history'), [index, setIndex] = useState(0);
  const [language, setLanguage] = useState(en ? 'en' : 'zh'), [confirmSubmit, setConfirmSubmit] = useState(false);
  const gate = useRef(false), launch = useRef(null), attemptStarted = useRef(Date.now()), heading = useRef(null);
  const owner = accountProfile?.id;
  const assistant = usePlatformAssistant();
  const assistantContext = useMemo(() => practiceAssistantContext(batch,index),[batch,index]);
  const registerContext = assistant?.registerContext;
  useEffect(() => { registerContext?.(assistantContext); return () => registerContext?.(null); },[registerContext,assistantContext]);
  useEffect(() => {
    if (!confirmSubmit) return;
    const previous = document.activeElement;
    const modal = document.querySelector('.practice-confirm');
    const keydown = event => {
      if (event.key === 'Escape' && !gate.current) { event.preventDefault(); setConfirmSubmit(false); }
      if (event.key === 'Tab') {
        const buttons = [...modal.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    modal?.addEventListener('keydown', keydown);
    return () => { modal?.removeEventListener('keydown', keydown); previous?.focus?.(); };
  }, [confirmSubmit]);
  const refreshHistory = async () => {
    if (!owner) return;
    try { const { data } = await api.listPracticeHistory(); setHistory(data); setHistoryError(''); }
    catch (caught) { setHistoryError(caught.status === 401 ? say('登录后保存和恢复学习记录。', 'Sign in to save and restore your work.') : caught.message); }
  };
  const loadCatalog = () => {
    setCatalogError('');
    return api.getPracticeCatalog().then(({ data }) => setCatalog(data)).catch(caught => setCatalogError(caught.message));
  };
  useEffect(() => { let alive = true; const abort = new AbortController(); api.getPracticeCatalog({}, { signal: abort.signal }).then(({ data }) => { if (alive) setCatalog(data); }).catch(caught => { if (alive) setCatalogError(caught.message); }); return () => { alive = false; abort.abort(); }; }, [api]);
  useEffect(() => { let alive = true; setHistory(null); setHistoryError(''); if (owner) api.listPracticeHistory().then(({ data }) => { if (alive) setHistory(data); }).catch(caught => { if (alive) setHistoryError(caught.message); }); return () => { alive = false; }; }, [api, owner]);
  useEffect(() => {
    let alive = true, timer; const abort = new AbortController();
    setError(''); setBatch(null); setConfirmSubmit(false);
    if (batchId && owner) {
      const load = async () => {
        try {
          const { data } = await api.getPractice(batchId, { signal: abort.signal });
          if (!alive) return;
          setBatch(data); setError(''); setIndex(data.currentIndex);
          if (['queued', 'preparing'].includes(data.status)) timer = setTimeout(load, 1600);
        } catch (caught) { if (alive) { setError(caught.message); if (!caught.status || caught.status >= 500) timer = setTimeout(load, 6000); } }
      };
      load();
    }
    return () => { alive = false; clearTimeout(timer); abort.abort(); };
  }, [api, batchId, owner, batchRefresh]);
  useEffect(() => { attemptStarted.current = Date.now(); heading.current?.focus(); }, [batchId, index, batch?.status]);
  const run = async action => {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (caught) {
      setError(caught.message || say('操作未完成，请重试。', 'Please try again.'));
      if (batchId && ['PRACTICE_REVISION_CONFLICT','PRACTICE_ANSWER_LOCKED'].includes(caught.code)) { try { const { data } = await api.getPractice(batchId); setBatch(data); setIndex(data.currentIndex); } catch {} }
    } finally { gate.current = false; setBusy(false); }
  };
  const topics = useMemo(() => (catalog?.topics ?? []).filter(t => t.subjectId === subjectId && (!stageId || t.stageIds.includes(stageId))), [catalog, subjectId, stageId]);
  const visibleTopics = topics.filter(t => !query || label(t.title, locale).toLowerCase().includes(query.toLowerCase()));
  const selected = visibleTopics.find(t => t.id === topicId) ?? visibleTopics[0];
  const topicName = id => label(catalog?.topics.find(t => t.id === id)?.title, locale) || say('数学练习', 'Mathematics practice');
  const difficultyName = id => label(catalog?.difficulties.find(t => t.id === id)?.title, locale) || ({basic:say('基础','Basic'),medium:say('中等','Medium'),hard:say('困难','Hard')})[id] || '';
  const total = (history?.topics ?? []).reduce((n, t) => n + t.attempted, 0);
  const correct = (history?.topics ?? []).reduce((n, t) => n + t.correct, 0);
  const start = () => run(async () => {
    if (!owner) return go('/account');
    const config = { subjectId, curriculumId: selected.curriculumId, topicId: selected.id, stageId: stageId || null, difficultyId, count, language };
    const serialized = JSON.stringify(config);
    if (launch.current?.config !== serialized) launch.current = { config: serialized, key: idKey() };
    const { data } = await api.startPractice(config, launch.current.key);
    launch.current = null; go('/learn/practice/' + data.id);
  });
  const change = input => run(async () => {
    const current = batch.items[index];
    const checking = input.action === 'check' && input.answer !== undefined;
    if (checking) setPendingAnswer({ questionId: current.id, answer: input.answer });
    try {
      const { data } = await api.updatePractice(batch.id, { action: 'save', questionId: current.id,
        expectedRevision: batch.revision, elapsedSeconds: Math.min(86400, current.elapsedSeconds + Math.floor((Date.now() - attemptStarted.current) / 1000)), currentIndex: index, ...input });
      attemptStarted.current = Date.now(); setBatch(data); setIndex(data.currentIndex);
      if (data.status === 'completed') { setConfirmSubmit(false); await refreshHistory(); }
    } finally { if (checking) setPendingAnswer(null); }
  });
  const navigateQuestion = next => change({ currentIndex: next });
  const nextBatch = () => run(async () => { const { data } = await api.continuePractice(batch.id, 'next:' + batch.id); go('/learn/practice/' + data.id); });
  const back = <button type="button" className="practice-back" disabled={busy} onClick={() => go(batchId ? '/learn/practice' : '/learn')}>← {batchId ? say('练习中心', 'Practice centre') : say('学习', 'Learning')}</button>;
  const notice = error && <div className="practice-notice is-error" role="alert">{error}<button onClick={() => setError('')}>{say('收起', 'Dismiss')}</button></div>;

  if (batchId) {
    const current = batch?.items[index];
    const pendingSelection = pendingAnswer?.questionId === current?.id ? pendingAnswer?.answer : null;
    return <main className="page practice-page">{back}{notice}
      {!owner ? <section className="practice-empty"><h1>{say('登录后继续练习', 'Sign in to continue')}</h1><button className="practice-primary" onClick={() => go('/account')}>{say('登录墨鱼', 'Sign in')}</button></section>
      : !batch || batch.id !== batchId ? <section className="practice-empty" role="status">{error ? say('暂时无法打开这批练习，请返回练习中心查看记录。', 'Unable to open this batch. Return to the practice centre to view your history.') : say('正在恢复练习…', 'Restoring practice…')}</section>
      : ['queued','preparing'].includes(batch.status) ? <section className="practice-preparing" role="status" aria-live="polite"><div className="practice-orbit" aria-hidden="true"><span>∑</span><i/><i/><i/></div><span className="learning-kicker">MOOYU PRACTICE</span><h1>{say('为你准备这一批练习', 'Preparing your next practice')}</h1><p>{topicName(batch.config.topicId)} · {difficultyName(batch.config.difficultyId)} · {batch.config.count} {say('题', 'questions')}</p><p>{say('正在选题、核验答案并准备图示。准备完成后会自动进入，离开页面也可以稍后继续。', 'Selecting questions, verifying answers and preparing figures. Your practice opens automatically; you can also return later.')}</p><Elapsed since={batch.createdAt}/><div className="practice-loading-track"/></section>
      : batch.status === 'failed' ? <section className="practice-empty"><h1>{say('这批题目还没有准备好', 'This batch could not be prepared')}</h1><p>{batch.errorCode === 'PRACTICE_SUPPLY_EXHAUSTED' ? say('当前范围的未做题不足，可以稍后重试或调整知识点。', 'There are not enough unseen questions in this scope. Retry later or choose another topic.') : say('本次准备未完成，已有练习和作答记录已保留。', 'Preparation did not finish. Your existing work is preserved.')}</p><button disabled={busy} className="practice-primary" onClick={() => run(async () => { await api.retryPractice(batch.id); setBatchRefresh(value => value + 1); })}>{say('重新准备', 'Retry preparation')}</button></section>
      : batch.status === 'completed' ? <>
        <header className="practice-report-hero"><div><span className="learning-kicker">PRACTICE REVIEW</span><h1 ref={heading} tabIndex={-1}>{say('每一道，都有收获', 'Make every question count')}</h1><p>{topicName(batch.config.topicId)} · {difficultyName(batch.config.difficultyId)} · {say('本轮已保存', 'Saved')}</p></div><div className="practice-score"><strong>{batch.correct}<span> / {batch.total}</span></strong><small>{say('答对题数', 'Correct answers')}</small></div></header>
        <div className="practice-review-actions"><button className="practice-primary" disabled={busy} onClick={nextBatch}>{busy ? say('准备中…', 'Preparing…') : say('继续下一批 →', 'Next batch →')}</button><button onClick={() => go('/learn/practice')}>{say('更换练习范围', 'Choose another topic')}</button><span>{say('沿用本轮的知识点、难度和题量，排除已展示题目。', 'Keeps your topic, difficulty and batch size, excluding seen questions.')}</span></div>
        <section className="practice-review-list" aria-label={say('逐题复盘', 'Question review')}>{batch.items.map((q, n) => <details key={q.id} open={!q.correct}><summary><span className={q.correct ? 'practice-correct' : 'practice-incorrect'}>{q.correct ? '✓' : '↻'}</span><strong>{say('第', 'Question ')}{n + 1}{say('题', '')}</strong><span>{q.correct ? say('回答正确', 'Correct') : q.answer ? say('再看一遍', 'Review this') : say('本题未作答', 'Unanswered')}</span></summary><div className="practice-review-content"><MathContent text={q.prompt} formatPlainMath/><Figure figure={q.figure}/><div className="practice-review-options">{q.options.map(o => <div key={o.id} className={o.id === q.correctAnswer ? 'is-correct' : o.id === q.answer ? 'is-wrong' : ''}><b>{o.id}</b><MathContent text={o.text} formatPlainMath/>{o.id === q.correctAnswer ? ' ✓' : ''}</div>)}</div><p>{say('你的选择', 'Your answer')}: {q.answer || '—'} · {say('正确答案', 'Correct answer')}: {q.correctAnswer}</p><div className="practice-explanation"><h3>{say('解题思路', 'Explanation')}</h3><MathContent text={q.explanation || ''} formatPlainMath/></div></div></details>)}</section>
      </> : current ? <>
        <header className="practice-session-head"><div><span className="learning-kicker">FOCUS & PRACTICE</span><h1>{topicName(batch.config.topicId)}</h1><p>{difficultyName(batch.config.difficultyId)} · {batch.answered}/{batch.total} {say('题已作答', 'answered')} · {busy ? pendingSelection ? say('正在判题…', 'Checking…') : say('正在保存…', 'Saving…') : say('已同步', 'Saved')}</p></div><button disabled={busy} onClick={() => setConfirmSubmit(true)}>{say('提交本轮', 'Finish batch')}</button></header>
        <div className="practice-workspace"><aside className="practice-question-map" aria-label={say('题目导航', 'Questions')}><span>{say('本轮练习', 'This batch')}</span><div>{batch.items.map((q, n) => <button key={q.id} disabled={busy} aria-label={say(`第 ${n + 1} 题`, `Question ${n + 1}`)} aria-current={index === n ? 'step' : undefined} className={`${index === n ? 'is-current' : ''} ${q.answer ? 'is-answered' : ''}`} onClick={() => navigateQuestion(n)}>{String(n + 1).padStart(2, '0')}{q.checked && <small>{q.correct ? '✓' : '×'}</small>}</button>)}</div><p>{say('选择即判题并保存，可随时回来继续。', 'Selecting an answer checks and saves it. Return whenever you like.')}</p></aside>
          <section className="practice-question"><div className="practice-question-number"><span>{String(index + 1).padStart(2, '0')}</span><small>{say('单项选择', 'Single choice')}</small></div><h2 ref={heading} tabIndex={-1}><MathContent text={current.prompt} formatPlainMath/></h2><Figure figure={current.figure}/><PracticeAssistantActions context={assistantContext}/><fieldset className="practice-options" disabled={busy || current.checked} aria-busy={Boolean(pendingSelection)}><legend className="sr-only">{say('选择答案', 'Choose an answer')}</legend>{current.options.map(option => <label key={option.id} className={`${(pendingSelection ?? current.answer) === option.id ? 'is-selected' : ''} ${current.checked && option.id === current.correctAnswer ? 'is-correct' : ''} ${current.checked && (pendingSelection ?? current.answer) === option.id && !current.correct ? 'is-wrong' : ''}`}><input type="radio" name={current.id} value={option.id} checked={(pendingSelection ?? current.answer) === option.id} onClick={() => { if (current.answer === option.id && !current.checked) change({ action: 'check', answer: option.id }); }} onChange={() => change({ action: 'check', answer: option.id })}/><b>{option.id}</b><MathContent text={option.text} formatPlainMath/>{current.checked && option.id === current.correctAnswer && <span className="practice-option-result">{say('✓ 正确答案', '✓ Correct answer')}</span>}{current.checked && option.id === current.answer && !current.correct && <span className="practice-option-result">{say('✕ 你的答案', '✕ Your answer')}</span>}{pendingSelection === option.id && <span className="practice-option-result" role="status">{say('判题中…', 'Checking…')}</span>}</label>)}</fieldset>
            {current.checked && <div className={`practice-explanation practice-answer-feedback ${current.correct ? 'is-correct' : 'is-wrong'}`} role="status"><h3>{current.correct ? say('答对了，继续保持', 'Correct. Keep going.') : say(`答错了，正确答案是 ${current.correctAnswer}`, `Incorrect. The correct answer is ${current.correctAnswer}.`)}</h3><p>{say('你的选择', 'Your answer')}: {current.answer} · {say('正确答案', 'Correct answer')}: {current.correctAnswer}</p><h4>{say('解题思路', 'Explanation')}</h4><MathContent text={current.explanation || ''} formatPlainMath/></div>}
            <footer className="practice-question-actions"><button disabled={busy || index === 0} onClick={() => navigateQuestion(index - 1)}>{say('上一题', 'Previous')}</button><button disabled={busy} className={current.checked ? 'practice-primary' : ''} onClick={() => index + 1 < batch.total ? navigateQuestion(index + 1) : setConfirmSubmit(true)}>{index + 1 < batch.total ? say('下一题 →', 'Next →') : say('完成本轮 →', 'Finish →')}</button></footer>
          </section></div>
        {confirmSubmit && <div className="practice-confirm" role="alertdialog" aria-modal="true" aria-labelledby="practice-submit-title"><div><h2 id="practice-submit-title">{say('提交这一轮练习？', 'Finish this batch?')}</h2><p>{batch.answered < batch.total ? say(`还有 ${batch.total - batch.answered} 题未作答，提交后会一起进入复盘。`, `${batch.total - batch.answered} questions remain unanswered. They will appear in your review.`) : say('提交后查看完整解析和本轮结果。', 'View all explanations and your results after submitting.')}</p><div><button disabled={busy} onClick={() => setConfirmSubmit(false)}>{say('继续作答', 'Keep practising')}</button><button autoFocus disabled={busy} className="practice-primary" onClick={() => change({ action: 'submit' })}>{say('提交并复盘', 'Submit and review')}</button></div></div></div>}
      </> : null}</main>;
  }

  return <main className="page practice-page">{back}{notice}<header className="learning-hero practice-hero"><div><span className="learning-kicker">MOOYU.FUN · PRACTICE</span><h1>{say('把理解，练成自己的能力', 'Turn understanding into ability')}</h1><p>{say('选一个知识点，专注完成一小轮。在反馈中找到思路，在下一轮中巩固。', 'Pick a topic and focus on a small batch. Learn from feedback, then build confidence with the next one.')}</p></div><div className="practice-hero-symbol" aria-hidden="true">∑<i>01 / ∞</i></div></header>
    <div className="practice-stats"><div><strong>{total}</strong><span>{say('累计练习', 'Questions completed')}</span></div><div><strong>{total ? Math.round(correct / total * 100) + '%' : '—'}</strong><span>{say('作答正确率', 'Answer accuracy')}</span></div><div><strong>{history?.topics.length ?? 0}</strong><span>{say('已练知识点', 'Topics practised')}</span></div></div>
    <section className="practice-builder"><div className="practice-section-head"><div><span className="learning-kicker">YOUR NEXT SESSION</span><h2>{say('今天，想练什么？', 'What will you practise today?')}</h2></div><span>{say('小步练习 · 即时反馈', 'Small batches · Clear feedback')}</span></div>
      {catalogError ? <div className="practice-notice is-error" role="alert">{catalogError}<button onClick={loadCatalog}>{say('重试', 'Retry')}</button></div> : !catalog ? <p role="status">{say('正在加载练习范围…', 'Loading practice topics…')}</p> : <>
        <div className="practice-subjects" aria-label={say('学科', 'Subject')}>{catalog.subjects.map(s => <button type="button" key={s.id} aria-pressed={subjectId === s.id} onClick={() => { setSubject(s.id); setTopic(''); setQuery(''); setStage(''); }}>{label(s.title, locale)}{s.id !== 'mathematics' && <small>{say('筹备中', 'Coming later')}</small>}</button>)}</div>
        <div className="practice-filters"><label>{say('课程体系', 'Curriculum')}<select value={subjectId === 'mathematics' ? 'csca-math-1.43' : ''} disabled><option value="">{say('暂无可用课程', 'No curriculum available')}</option>{catalog.curricula.filter(c => c.subjectId === subjectId).map(c => <option key={c.id} value={c.id}>{label(c.title, locale)}</option>)}</select></label><label>{say('学段', 'School stage')}<select value={stageId} onChange={e => { setStage(e.target.value); setTopic(''); }}><option value="">{say('全部学段', 'All stages')}</option>{catalog.stages.map(s => <option key={s.id} value={s.id} disabled={!catalog.topics.some(t => t.subjectId === subjectId && t.stageIds.includes(s.id))}>{label(s.title, locale)}{!catalog.topics.some(t => t.subjectId === subjectId && t.stageIds.includes(s.id)) ? say(' · 暂无已标注内容', ' · No mapped content') : ''}</option>)}</select></label><label>{say('查找知识点', 'Find a topic')}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={say('例如：函数、立体几何', 'For example: functions')}/></label></div>
        {visibleTopics.length ? <div className="practice-topics" role="group" aria-label={say('知识点', 'Topic')}>{visibleTopics.map(t => <button key={t.id} type="button" aria-pressed={selected?.id === t.id} onClick={() => setTopic(t.id)}><span>{label(t.title, locale)}</span><small>{t.difficultyIds.length ? t.difficultyIds.map(difficultyName).join(' · ') : say('暂不可用', 'Unavailable')}</small><i aria-hidden="true">{selected?.id === t.id ? '✓' : '↗'}</i></button>)}</div> : <div className="practice-empty"><strong>{query ? say('没有找到这个知识点', 'No matching topics') : say('这一学科正在准备中', 'This subject is being prepared')}</strong><p>{query ? say('试试其他关键词。', 'Try another keyword.') : say('有经过核验的题目后，会在这里开放练习。', 'Practice opens here when verified questions are available.')}</p></div>}
        <div className="practice-settings"><fieldset><legend>{say('练习难度', 'Difficulty')}</legend><div>{catalog.difficulties.map(d => <button type="button" key={d.id} aria-pressed={difficultyId === d.id} disabled={!selected?.difficultyIds.includes(d.id)} onClick={() => setDifficulty(d.id)}>{label(d.title, locale)}</button>)}</div></fieldset><fieldset><legend>{say('每轮题量', 'Batch size')}</legend><div>{[3,5,10].map(n => <button type="button" key={n} aria-pressed={count === n} onClick={() => setCount(n)}>{n} {say('题', 'questions')}</button>)}</div></fieldset><label>{say('题目语言', 'Question language')}<select value={language} onChange={e => setLanguage(e.target.value)}><option value="zh">中文</option><option value="en">English</option></select></label></div>
        <div className="practice-launch"><div><strong>{selected ? topicName(selected.id) : say('先选择可用的知识点', 'Choose an available topic')}</strong><p>{say('当前为 CSCA 数学专项，单项选择题；尚未按各学段课程逐项标注。', 'CSCA mathematics, single-choice questions. School-stage curriculum mapping is not yet available.')}</p></div><button className="practice-primary" disabled={busy || !catalog.ready || !selected?.difficultyIds.includes(difficultyId)} onClick={start}>{busy ? say('正在开始…', 'Starting…') : owner ? say('开始练习 →', 'Start practice →') : say('登录并开始 →', 'Sign in to start →')}</button></div>
        {!catalog.ready && <p className="practice-notice" role="status">{say('练习服务正在准备，暂时无法开始。', 'Practice is temporarily unavailable.')}</p>}
      </>}
    </section>
    <section className="practice-records"><div className="practice-section-head"><div><span className="learning-kicker">YOUR LEARNING TRAIL</span><h2>{say('每次练习，都留得住', 'Keep your learning trail')}</h2></div><div className="practice-tabs"><button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>{say('练习记录', 'History')}</button><button aria-pressed={tab === 'wrong'} onClick={() => setTab('wrong')}>{say('错题回顾', 'Mistakes')}</button></div></div>
      {!owner ? <p className="practice-empty">{say('登录后保存练习进度、复盘和错题。', 'Sign in to save progress, reviews and mistakes.')}</p> : historyError ? <div className="practice-notice" role="alert">{historyError}<button onClick={refreshHistory}>{say('重新加载', 'Reload')}</button></div> : !history ? <p role="status">{say('正在读取记录…', 'Loading your history…')}</p> : tab === 'history' ? history.batches.length ? <div className="practice-history">{history.batches.map(b => <button key={b.id} onClick={() => go('/learn/practice/' + b.id)}><span className="practice-history-symbol">{b.status === 'completed' ? '✓' : '↗'}</span><span><strong>{topicName(b.config.topicId)}</strong><small>{difficultyName(b.config.difficultyId)} · {b.total} {say('题', 'questions')} · {date(b.createdAt, { month: 'short', day: 'numeric' })}</small></span><b>{b.status === 'completed' ? `${b.correct}/${b.total}` : `${b.answered}/${b.total}`}</b><span>{statusNames[b.status]?.[en ? 1 : 0]} →</span></button>)}</div> : <p className="practice-empty">{say('从第一轮开始，积累你的学习足迹。', 'Start your first batch and build a learning trail.')}</p> : history.wrong.length ? <div className="practice-wrong-list">{history.wrong.map((w, n) => <article key={w.batchId + w.question.id}><small>{topicName(w.config.topicId)} · {difficultyName(w.config.difficultyId)}</small><h3><MathContent text={w.question.prompt} formatPlainMath/></h3><details><summary>{say('查看思路', 'Show explanation')}</summary><MathContent text={w.question.explanation || ''} formatPlainMath/></details><button onClick={() => go('/learn/practice/' + w.batchId)}>{say('回到本轮复盘 →', 'Open batch review →')}</button></article>)}</div> : <p className="practice-empty">{say('暂时没有错题。完成练习后，会在这里留下需要巩固的题目。', 'No mistakes yet. Questions to revisit appear here after you finish a batch.')}</p>}
    </section>
  </main>;
}
