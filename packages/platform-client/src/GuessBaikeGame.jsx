import React, { useEffect, useMemo, useRef, useState } from 'react';
import puzzleBank from './guess-baike-puzzles.json';
import { countGuessOccurrences, isGuessTitleSolved, isVisibleGuessPunctuation, normalizeGuessCharacter, uniqueGuessCharacters } from './guess-baike-policy.mjs';
import { workLeaderboardPath } from './work-leaderboards.mjs';
import { useI18n } from './I18n.jsx';

const puzzles = puzzleBank.puzzles;

const normalize = value => value.replace(/[\s·・—–\-_，。！？（）()]/g, '').toLowerCase();
const secondsLabel = (seconds,t) => seconds < 60 ? t('guess.time.seconds',{seconds}) : t('guess.time.minutes',{minutes:Math.floor(seconds / 60),seconds:String(seconds % 60).padStart(2, '0')});
const GUESS_BAIKE_SHARE_URL = 'https://mooyu.fun/play/gamehub-guess-baike';
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

function saveGame(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Embedded and privacy-restricted hosts may disable localStorage. The game
    // must remain playable even when this optional local resume cache is absent.
  }
}

const localDaily = () => {
  const dailyIndex = Math.abs(Math.floor((Date.now() - Date.UTC(2026, 8, 28)) / 86400000)) % puzzles.length;
  return { date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), puzzle: puzzles[dailyIndex] };
};

export default function GuessBaikeGame({ api, demo = false, challengeCode = null, go }) {
  const {t}=useI18n();
  const [daily, setDaily] = useState(localDaily);
  const [dailyStatus,setDailyStatus] = useState(api&&!demo?'loading':'ready');
  const [scoreSaveStatus,setScoreSaveStatus] = useState('idle'),[saveRetry,setSaveRetry] = useState(0);
  const resultSaved = useRef(null);
  useEffect(() => { let live = true; if (!api || demo) return undefined; api.getGuessBaikeDaily().then(({ data }) => { if (live) {setDaily(data);setDailyStatus('ready');} }).catch(() => {if(live)setDailyStatus('offline');}); return () => { live = false; }; }, [api, demo]);
  const puzzle = daily.puzzle;
  const storageKey = `gamehub:guess-baike:daily:${daily.date}:${puzzle.id}`;
  const [restoredKey,setRestoredKey] = useState(storageKey);
  const restored = useMemo(() => loadGame(storageKey), [storageKey]);
  const [guessed, setGuessed] = useState(() => new Set(restored?.guessed ?? []));
  const [history, setHistory] = useState(() => restored?.history ?? []);
  const [phase, setPhase] = useState(() => restored?.phase ?? 'playing');
  const [hints, setHints] = useState(() => restored?.hints ?? 0);
  const [startedAt, setStartedAt] = useState(() => restored?.startedAt ?? Date.now());
  const [completedElapsed, setCompletedElapsed] = useState(() => Number.isSafeInteger(restored?.completedElapsed) ? restored.completedElapsed : null);
  const [elapsed, setElapsed] = useState(() => Number.isSafeInteger(restored?.completedElapsed) ? restored.completedElapsed : 0);
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
  const resultTimeLabel = phase === 'won' && !Number.isSafeInteger(completedElapsed) ? t('guess.historicalScore') : secondsLabel(elapsed,t);

  useEffect(() => {
    const saved = loadGame(storageKey);
    setGuessed(new Set(saved?.guessed ?? []));
    setHistory(saved?.history ?? []);
    setPhase(saved?.phase ?? 'playing');
    setHints(saved?.hints ?? 0);
    setStartedAt(saved?.startedAt ?? Date.now());
    setCompletedElapsed(Number.isSafeInteger(saved?.completedElapsed) ? saved.completedElapsed : null);
    setElapsed(Number.isSafeInteger(saved?.completedElapsed) ? saved.completedElapsed : 0);
    setInput(''); setFeedback(null); setRecent(new Set()); setCopied(false); setShowResult(false); setChallengeResult(null);setScoreSaveStatus('idle');setRestoredKey(storageKey);
  }, [storageKey, challengeCode]);

  useEffect(() => {
    if(restoredKey!==storageKey)return;
    saveGame(storageKey, { guessed: [...guessed], history, phase, hints, startedAt, completedElapsed });
  }, [storageKey, restoredKey, guessed, history, phase, hints, startedAt, completedElapsed]);

  useEffect(() => {
    if (phase !== 'playing') {
      if (Number.isSafeInteger(completedElapsed)) setElapsed(completedElapsed);
      return undefined;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, phase, completedElapsed]);

  useEffect(() => {
    if (restoredKey!==storageKey || phase !== 'playing' || !isGuessTitleSolved(puzzle.title, guessed)) return;
    setFeedback({ kind: 'win', text: t('guess.feedback.revealed') });
    setCompletedElapsed(current => current ?? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    setPhase('won');
  }, [puzzle.title, guessed, phase, startedAt, restoredKey, storageKey, t]);

  useEffect(() => {
    if (phase !== 'won') { setShowResult(false); return undefined; }
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setShowResult(true), reducedMotion ? 30 : 900);
    return () => clearTimeout(timer);
  }, [phase, puzzle.id]);

  useEffect(() => {
    if (phase !== 'won' || restoredKey!==storageKey) return;
    if(demo){setScoreSaveStatus('demo');return;}
    if(dailyStatus!=='ready'||!api){setScoreSaveStatus(dailyStatus==='loading'?'loading':'offline');return;}
    if(!Number.isSafeInteger(completedElapsed)){setScoreSaveStatus('historical');return;}
    const saveKey = `${daily.date}:${puzzle.id}:${challengeCode || 'daily'}:${saveRetry}`;
    let live=true;setScoreSaveStatus('saving');
    // Reuse the same in-flight mutation during StrictMode's effect replay.
    if(resultSaved.current?.key!==saveKey)resultSaved.current={key:saveKey,promise:(async()=>{
      try{
        await api.saveGuessBaikeResult({puzzleDate:daily.date,puzzleId:puzzle.id,guessedCount:guessed.size,elapsedSeconds:completedElapsed,hints});
        let challenge=null;
        if(challengeCode){try{challenge=(await api.completeGuessBaikeChallenge(challengeCode)).data;}catch{challenge={error:true};}}
        return {status:'saved',challenge};
      }catch(error){return {status:error.status===401?'auth':'error',challenge:challengeCode?{error:true}:null};}
    })()};
    resultSaved.current.promise.then(result=>{if(live){setScoreSaveStatus(result.status);if(result.challenge)setChallengeResult(result.challenge);}});
    return()=>{live=false;};
  }, [phase, demo, api, daily.date, puzzle.id, guessed.size, completedElapsed, hints, challengeCode, saveRetry, dailyStatus, restoredKey, storageKey]);

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
      setFeedback({ kind: 'win', text: t('guess.feedback.answer') });
      setCompletedElapsed(current => current ?? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      setPhase('won'); setInput('');
      return;
    }
    const chars = uniqueGuessCharacters(raw);
    if (!chars.length) { setFeedback({ kind: 'miss', text: t('guess.feedback.invalid') }); return; }
    const fresh = chars.filter(char => !guessed.has(char));
    if (!fresh.length) { setFeedback({ kind: 'repeat', text: t('guess.feedback.repeat') }); setInput(''); return; }
    const next = new Set([...guessed, ...fresh]);
    const hits = countGuessOccurrences(allText, fresh);
    setGuessed(next); setHistory(current => [{ value: fresh.join(''), hits }, ...current]);
    setFeedback({ kind: hits ? 'hit' : 'miss', text: hits ? t('guess.feedback.hit',{hits,count:fresh.length}) : t('guess.feedback.miss') });
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
    setFeedback({ kind: 'hint', text: t('guess.feedback.hint',{char}) });
  };

  const share = async () => {
    const grid = Array.from(puzzle.title).filter(char => normalizeGuessCharacter(char) !== null).map(char => guessed.has(normalizeGuessCharacter(char)) ? '🟪' : '⬛').join('');
    const text = t('guess.shareText',{grid,attempts:guessAttempts,characters:guessed.size,time:resultTimeLabel,hints,url:GUESS_BAIKE_SHARE_URL});
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setFeedback({ kind: 'repeat', text: t('guess.feedback.copyFailed') }); }
  };

  return <section className={`guess-baike ${phase === 'won' ? 'is-won' : ''}`}>
    <div className="guess-pixel-noise" aria-hidden="true"/>
    <header className="guess-header">
      <div className="guess-brand"><span className="guess-brand__seal" aria-hidden="true">百</span><div><strong>{t('guess.name')}</strong><small>MOOYU.FUN ORIGINAL 001</small></div></div>
      <div className="guess-meta"><span>{t('guess.meta.characters',{count:guessed.size})}</span><span>{t('guess.meta.progress',{progress})}</span><span><b>{resultTimeLabel}</b></span></div>
    </header>

    <div className="guess-layout">
      <main className="guess-main">
        <div className="guess-level-row"><span>{challengeCode ? `CHALLENGE / ${daily.date.slice(5).replace('-', '/')}` : `DAILY / ${daily.date.slice(5).replace('-', '/')}`}</span><span className="guess-category">{puzzle.category}</span></div>
        {challengeCode && <div className="guess-challenge-banner"><b>VS</b><span>{t('guess.challengeLocked')}</span></div>}
        <section className="guess-title" aria-label={t('guess.targetAria')}>
          <small>TARGET TITLE</small>
          <h1><MaskedText text={puzzle.title} guessed={guessed} recent={recent} solved={phase === 'won'} title/></h1>
          {phase === 'won' && <div className="guess-title__fireworks" aria-hidden="true">{fireworkPieces.map((style, index) => <i style={style} key={index}/>)}</div>}
        </section>

        <section className="guess-document">
          <div className="guess-document__top"><span>WIKI EXCERPT</span><div className="guess-progress"><i style={{ width: `${progress}%` }}/></div><span>{phase === 'won' ? allChars.length : revealed}/{allChars.length}</span></div>
          <article><MaskedText text={puzzle.content} guessed={guessed} recent={recent} solved={phase === 'won'}/></article>
          <footer>{t('guess.sourceLead')} · <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>{phase !== 'won' && <a href={puzzle.sourceUrl} target="_blank" rel="noreferrer" title={t('guess.spoilerTitle')}>{t('guess.sourceSpoiler')} ↗</a>}</footer>
        </section>

        <form className={`guess-input-bar ${feedback ? `is-${feedback.kind}` : ''}`} onSubmit={submit}>
          <div className="guess-input-wrap"><span aria-hidden="true">&gt;_</span><input ref={inputRef} value={input} maxLength={10} disabled={phase !== 'playing'} onChange={event => setInput(event.target.value)} placeholder={t('guess.inputPlaceholder')} aria-label={t('guess.inputPlaceholder')} autoComplete="off"/></div>
          <button type="submit" disabled={!input.trim() || phase !== 'playing'}>{t('guess.reveal')} <span>↵</span></button>
        </form>
        <div className="guess-feedback" aria-live="polite">{feedback ? <><i/>{feedback.text}</> : phase === 'won' ? t('guess.decoded') : t('guess.instructions')}{phase === 'won' && !showResult && <button className="guess-result-reopen" onClick={() => setShowResult(true)}>{t('guess.viewResult')}</button>}</div>
      </main>

      <aside className="guess-sidebar">
        <section className="guess-side-card guess-help-card"><div><span>ASSIST</span><b>{2 - hints}/2</b></div><h2>{t('guess.helpTitle')}</h2><p>{t('guess.helpLead')}</p><button onClick={useHint} disabled={phase !== 'playing' || hints >= 2}><span aria-hidden="true">✦</span>{t(hints >= 2 ? 'guess.hintsUsed' : 'guess.giveHint')}</button></section>
        <section className="guess-side-card guess-history"><div><span>GUESS LOG</span><b>{history.length}</b></div>{history.length ? <ol>{history.slice(0, 9).map((item, index) => <li className={item.answer ? 'is-answer' : item.hits ? 'is-hit' : 'is-miss'} key={`${item.value}-${index}`}><span>{item.hint ? '✦ ' : ''}{item.value}</span><em>{item.answer ? t('guess.log.answer') : item.hits ? t('guess.log.hits',{hits:item.hits}) : t('guess.log.miss')}</em></li>)}</ol> : <p>{t('guess.log.empty')}<br/>{t('guess.log.caseInsensitive')}</p>}</section>
      </aside>
    </div>

    {showResult && <div className="guess-result" role="dialog" aria-modal="true" aria-label={t('guess.resultAria')} onClick={event => { if (event.target === event.currentTarget) setShowResult(false); }}>
      <div className="guess-result__panel"><span className="guess-result__badge">{t('guess.resultBadge')}</span><small>{challengeCode ? 'CHALLENGE COMPLETE' : 'ANSWER FOUND'}</small><h2>{challengeResult && !challengeResult.error ? t(challengeResult.outcome === 'win' ? 'guess.outcome.win' : challengeResult.outcome === 'loss' ? 'guess.outcome.loss' : 'guess.outcome.draw') : puzzle.title}</h2><p>{t('guess.resultSummary',{attempts:guessAttempts,characters:guessed.size,time:resultTimeLabel,hints})}</p>{challengeCode && <div className="guess-duel-result">{challengeResult?.error ? t('guess.settlementFailed') : challengeResult ? <><span>{t('guess.duelYou',{hints:challengeResult.participant.hints,characters:challengeResult.participant.guessedCount,seconds:challengeResult.participant.elapsedSeconds})}</span><span>{t('guess.duelOpponent',{hints:challengeResult.creator.hints,characters:challengeResult.creator.guessedCount,seconds:challengeResult.creator.elapsedSeconds})}</span></> : t('guess.settling')}</div>}<div className="guess-result__save" role="status">{t(`guess.save.${scoreSaveStatus}`)}{scoreSaveStatus==='error'&&<button onClick={()=>setSaveRetry(value=>value+1)}>{t('guess.retrySave')}</button>}{scoreSaveStatus==='auth'&&go&&<button onClick={()=>go('/account')}>{t('guess.signIn')}</button>}</div><div className="guess-result__actions">{go&&<button className="is-primary" disabled={['idle','loading','saving'].includes(scoreSaveStatus)} onClick={()=>go(workLeaderboardPath('gamehub-guess-baike',daily.date,puzzle.id))}>{t('guess.viewRank')}</button>}<button onClick={share}>{t(copied ? 'guess.copied' : 'guess.copyScore')}</button><button onClick={() => setShowResult(false)}>{t('guess.viewArticle')}</button></div><a href={puzzle.sourceUrl} target="_blank" rel="noreferrer">{t('guess.readOriginal')} ↗</a></div>
    </div>}
  </section>;
}

export { puzzles };
