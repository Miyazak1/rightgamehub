import React, { useEffect, useMemo, useRef, useState } from 'react';
import puzzleBank from './guess-baike-puzzles.json';
import { countGuessOccurrences, isGuessTitleSolved, isVisibleGuessPunctuation, normalizeGuessCharacter, uniqueGuessCharacters } from './guess-baike-policy.mjs';

const puzzles = puzzleBank.puzzles;

const normalize = value => value.replace(/[\s·・—–\-_，。！？（）()]/g, '').toLowerCase();
const secondsLabel = seconds => seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
const GUESS_BAIKE_SHARE_URL = 'https://mooyu.fun/#/play/gamehub-guess-baike';
const fireworkPieces = Array.from({ length: 24 }, (_, index) => {
  const ray = index % 12;
  const angle = ray * Math.PI / 6;
  const radius = 38 + (ray % 3) * 9;
  return {
    '--origin': index < 12 ? '24%' : '76%',
    '--spark-x': `${Math.cos(angle) * radius}px`,
    '--spark-y': `${Math.sin(angle) * radius}px`,
    '--spark-delay': `${index < 12 ? ray * 12 : 90 + ray * 12}ms`,
  };
});

function MaskedText({ text, guessed, recent, solved, title = false }) {
  return <span className={title ? 'guess-title-tiles' : 'guess-copy'}>{Array.from(text).map((char, index) => {
    if (char === '\n') return <br key={index}/>;
    if (isVisibleGuessPunctuation(char)) return <span className="guess-punctuation" key={index}>{char}</span>;
    const key = normalizeGuessCharacter(char);
    const visible = solved || (key !== null && guessed.has(key));
    return <span className={`guess-glyph ${visible ? 'is-open' : 'is-hidden'} ${key !== null && recent.has(key) ? 'is-new' : ''}`} style={{ '--glyph-delay': `${(index % 17) * 22}ms` }} key={`${index}-${char}`}>{visible ? char : ''}</span>;
  })}</span>;
}

function loadGame(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved && Array.isArray(saved.guessed) ? saved : null;
  } catch { return null; }
}

const localDaily = () => {
  const dailyIndex = Math.abs(Math.floor((Date.now() - Date.UTC(2026, 8, 28)) / 86400000)) % puzzles.length;
  return { date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), puzzle: puzzles[dailyIndex] };
};

export default function GuessBaikeGame({ api, demo = false, challengeCode = null }) {
  const [daily, setDaily] = useState(localDaily);
  const resultSaved = useRef(null);
  useEffect(() => { let live = true; if (!api || demo) return undefined; api.getGuessBaikeDaily().then(({ data }) => { if (live) setDaily(data); }).catch(() => {}); return () => { live = false; }; }, [api, demo]);
  const puzzle = daily.puzzle;
  const storageKey = `gamehub:guess-baike:daily:${daily.date}:${puzzle.id}`;
  const restored = useMemo(() => loadGame(storageKey), [storageKey]);
  const [guessed, setGuessed] = useState(() => new Set(restored?.guessed ?? []));
  const [history, setHistory] = useState(() => restored?.history ?? []);
  const [phase, setPhase] = useState(() => restored?.phase ?? 'playing');
  const [hints, setHints] = useState(() => restored?.hints ?? 0);
  const [startedAt, setStartedAt] = useState(() => restored?.startedAt ?? Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [recent, setRecent] = useState(new Set());
  const [copied, setCopied] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [challengeResult, setChallengeResult] = useState(null);
  const inputRef = useRef(null);

  const allText = `${puzzle.title}${puzzle.content}`;
  const allChars = useMemo(() => uniqueGuessCharacters(allText), [allText]);
  const revealed = allChars.filter(char => guessed.has(char)).length;
  const progress = phase === 'won' ? 100 : Math.round(revealed / allChars.length * 100);
  const guessAttempts = history.filter(item => !item.hint).length;

  useEffect(() => {
    const saved = loadGame(storageKey);
    setGuessed(new Set(saved?.guessed ?? []));
    setHistory(saved?.history ?? []);
    setPhase(saved?.phase ?? 'playing');
    setHints(saved?.hints ?? 0);
    setStartedAt(saved?.startedAt ?? Date.now());
    setInput(''); setFeedback(null); setRecent(new Set()); setCopied(false); setShowResult(false); setChallengeResult(null);
  }, [storageKey, challengeCode]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ guessed: [...guessed], history, phase, hints, startedAt }));
  }, [storageKey, guessed, history, phase, hints, startedAt]);

  useEffect(() => {
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    if (phase !== 'playing') return undefined;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, phase]);

  useEffect(() => {
    if (phase !== 'playing' || !isGuessTitleSolved(puzzle.title, guessed)) return;
    setFeedback({ kind: 'win', text: '标题已完整揭开！百科档案已解密。' });
    setPhase('won');
  }, [puzzle.title, guessed, phase]);

  useEffect(() => {
    if (phase !== 'won') { setShowResult(false); return undefined; }
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setShowResult(true), reducedMotion ? 30 : 900);
    return () => clearTimeout(timer);
  }, [phase, puzzle.id]);

  useEffect(() => {
    const saveKey = `${daily.date}:${puzzle.id}:${challengeCode || 'daily'}`;
    if (phase !== 'won' || demo || !api || resultSaved.current === saveKey) return;
    resultSaved.current = saveKey;
    (async () => {
      try {
        await api.saveGuessBaikeResult({ puzzleDate: daily.date, puzzleId: puzzle.id, guessedCount: guessed.size, elapsedSeconds: elapsed, hints });
        if (challengeCode) setChallengeResult((await api.completeGuessBaikeChallenge(challengeCode)).data);
      } catch { if (challengeCode) setChallengeResult({ error: true }); }
    })();
  }, [phase, demo, api, daily.date, puzzle.id, guessed.size, elapsed, hints, challengeCode]);

  useEffect(() => {
    if (!showResult) return undefined;
    const closeOnEscape = event => { if (event.key === 'Escape') setShowResult(false); };
    addEventListener('keydown', closeOnEscape);
    return () => removeEventListener('keydown', closeOnEscape);
  }, [showResult]);

  const pulseReveal = chars => {
    setRecent(new Set(chars));
    setTimeout(() => setRecent(new Set()), 1050);
  };

  const submit = event => {
    event.preventDefault();
    if (phase !== 'playing') return;
    const raw = input.trim();
    if (!raw) return;
    if ([puzzle.title, ...puzzle.aliases].some(answer => normalize(answer) === normalize(raw))) {
      const answerChars = uniqueGuessCharacters(puzzle.title);
      setGuessed(current => new Set([...current, ...answerChars]));
      pulseReveal(answerChars);
      setHistory(current => [{ value: raw, hits: answerChars.length, answer: true }, ...current]);
      setFeedback({ kind: 'win', text: '标题命中！百科档案已解密。' });
      setPhase('won'); setInput('');
      return;
    }
    const chars = uniqueGuessCharacters(raw);
    if (!chars.length) { setFeedback({ kind: 'miss', text: '请输入 1～10 个中文、英文字母或数字。' }); return; }
    const fresh = chars.filter(char => !guessed.has(char));
    if (!fresh.length) { setFeedback({ kind: 'repeat', text: '这些字已经猜过，不会重复计次。' }); setInput(''); return; }
    const next = new Set([...guessed, ...fresh]);
    const hits = countGuessOccurrences(allText, fresh);
    setGuessed(next); setHistory(current => [{ value: fresh.join(''), hits }, ...current]);
    setFeedback({ kind: hits ? 'hit' : 'miss', text: hits ? `命中 ${hits} 处，揭开 ${fresh.length} 个新字。` : '没有出现，但排除也是线索。' });
    if (hits) pulseReveal(fresh);
    setInput('');
  };

  const useHint = () => {
    if (phase !== 'playing' || hints >= 2) return;
    const candidates = uniqueGuessCharacters(puzzle.content).filter(char => !guessed.has(char));
    if (!candidates.length) return;
    const counts = candidates.map(char => [char, countGuessOccurrences(puzzle.content, [char])]);
    counts.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
    const char = counts[Math.min(hints * 2 + 1, counts.length - 1)][0];
    setGuessed(current => new Set([...current, char]));
    setHints(value => value + 1); pulseReveal([char]);
    setHistory(current => [{ value: char, hits: counts.find(item => item[0] === char)[1], hint: true }, ...current]);
    setFeedback({ kind: 'hint', text: `系统为你揭开了“${char}”。` });
  };

  const share = async () => {
    const grid = Array.from(puzzle.title).filter(char => normalizeGuessCharacter(char) !== null).map(char => guessed.has(normalizeGuessCharacter(char)) ? '🟪' : '⬛').join('');
    const text = `猜百科 · 今日挑战\n${grid}\n${guessAttempts} 次猜测 · ${guessed.size} 个字符 · ${secondsLabel(elapsed)} · ${hints} 提示\nGameHub 官方出品\n${GUESS_BAIKE_SHARE_URL}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setFeedback({ kind: 'repeat', text: '暂时无法复制，请手动截图分享。' }); }
  };

  return <section className={`guess-baike ${phase === 'won' ? 'is-won' : ''}`}>
    <div className="guess-pixel-noise" aria-hidden="true"/>
    <header className="guess-header">
      <div className="guess-brand"><span className="guess-brand__seal" aria-hidden="true">百</span><div><strong>猜百科</strong><small>GAMEHUB ORIGINAL 001</small></div></div>
      <div className="guess-meta"><span><b>{guessed.size}</b>个</span><span><b>{progress}%</b>揭开</span><span><b>{secondsLabel(elapsed)}</b></span></div>
    </header>

    <div className="guess-layout">
      <main className="guess-main">
        <div className="guess-level-row"><span>{challengeCode ? `CHALLENGE / ${daily.date.slice(5).replace('-', '/')}` : `DAILY / ${daily.date.slice(5).replace('-', '/')}`}</span><span className="guess-category">{puzzle.category}</span></div>
        {challengeCode && <div className="guess-challenge-banner"><b>VS</b><span>玩家挑战已锁定 · 完成后自动结算</span></div>}
        <section className="guess-title" aria-label="待猜的百科标题">
          <small>TARGET TITLE</small>
          <h1><MaskedText text={puzzle.title} guessed={guessed} recent={recent} solved={phase === 'won'} title/></h1>
          {phase === 'won' && <div className="guess-title__fireworks" aria-hidden="true">{fireworkPieces.map((style, index) => <i style={style} key={index}/>)}</div>}
        </section>

        <section className="guess-document">
          <div className="guess-document__top"><span>WIKI EXCERPT</span><div className="guess-progress"><i style={{ width: `${progress}%` }}/></div><span>{phase === 'won' ? allChars.length : revealed}/{allChars.length}</span></div>
          <article><MaskedText text={puzzle.content} guessed={guessed} recent={recent} solved={phase === 'won'}/></article>
          <footer>正文采用中文维基百科完整导言 · <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>{phase !== 'won' && <a href={puzzle.sourceUrl} target="_blank" rel="noreferrer" title="会剧透答案">来源（剧透）↗</a>}</footer>
        </section>

        <form className={`guess-input-bar ${feedback ? `is-${feedback.kind}` : ''}`} onSubmit={submit}>
          <div className="guess-input-wrap"><span aria-hidden="true">&gt;_</span><input ref={inputRef} value={input} maxLength={10} disabled={phase !== 'playing'} onChange={event => setInput(event.target.value)} placeholder="输入中文、英文或数字，也可直接猜标题" autoComplete="off"/></div>
          <button type="submit" disabled={!input.trim() || phase !== 'playing'}>揭开 <span>↵</span></button>
        </form>
        <div className="guess-feedback" aria-live="polite">{feedback ? <><i/>{feedback.text}</> : '中文、英文字母和数字都可以猜；英文不区分大小写。'}</div>
      </main>

      <aside className="guess-sidebar">
        <section className="guess-side-card guess-help-card"><div><span>ASSIST</span><b>{2 - hints}/2</b></div><h2>卡住了？</h2><p>揭开正文中的一个高价值字，会记录在成绩里。</p><button onClick={useHint} disabled={phase !== 'playing' || hints >= 2}><span aria-hidden="true">✦</span>{hints >= 2 ? '提示已用完' : '给我一点灵感'}</button></section>
        <section className="guess-side-card guess-history"><div><span>GUESS LOG</span><b>{history.length}</b></div>{history.length ? <ol>{history.slice(0, 9).map((item, index) => <li className={item.answer ? 'is-answer' : item.hits ? 'is-hit' : 'is-miss'} key={`${item.value}-${index}`}><span>{item.hint ? '✦ ' : ''}{item.value}</span><em>{item.answer ? '命中标题' : item.hits ? `+${item.hits} 处` : '未出现'}</em></li>)}</ol> : <p>每个新字符只计一次。<br/>英文不区分大小写。</p>}</section>
      </aside>
    </div>

    {showResult && <div className="guess-result" role="dialog" aria-modal="true" aria-label="挑战完成" onClick={event => { if (event.target === event.currentTarget) setShowResult(false); }}>
      <div className="guess-result__panel"><span className="guess-result__badge">档案已解密</span><small>{challengeCode ? 'CHALLENGE COMPLETE' : 'ANSWER FOUND'}</small><h2>{challengeResult && !challengeResult.error ? (challengeResult.outcome === 'win' ? '挑战胜出！' : challengeResult.outcome === 'loss' ? '差一点点' : '势均力敌') : puzzle.title}</h2><p>{guessAttempts} 次猜测 · {guessed.size} 个猜字 · {secondsLabel(elapsed)} · {hints} 次提示</p>{challengeCode && <div className="guess-duel-result">{challengeResult?.error ? '结算暂时未完成，稍后可从挑战记录继续。' : challengeResult ? <><span>我：{challengeResult.participant.hints} 提示 · {challengeResult.participant.guessedCount} 字 · {challengeResult.participant.elapsedSeconds} 秒</span><span>对手：{challengeResult.creator.hints} 提示 · {challengeResult.creator.guessedCount} 字 · {challengeResult.creator.elapsedSeconds} 秒</span></> : '正在结算挑战…'}</div>}<div className="guess-result__actions"><button className="is-primary" onClick={share}>{copied ? '已复制成绩 ✓' : '复制像素成绩'}</button><button onClick={() => setShowResult(false)}>查看全文</button></div><a href={puzzle.sourceUrl} target="_blank" rel="noreferrer">阅读中文维基百科原文 ↗</a></div>
    </div>}
  </section>;
}

export { puzzles };
