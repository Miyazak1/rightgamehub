import { UPSTREAM_COMMIT, stateSnapshot, readDocument, adrError } from './state.mjs';

/** S1: coalesced memory snapshots only, never a claim of durable offline storage. */
export function createAdrSaveAdapter({cloudSave, onStatus = () => {}, onReplace = () => {},
  clock = Date.now, id = () => crypto.randomUUID(), schedule = setTimeout, cancel = clearTimeout,
  intervalMs = 60000, debounceMs = 750} = {}) {
  const resource = {namespace:'default', slot:'autosave'};
  let loaded = false, closed = false, current = null, confirmed = null, latest = null;
  let operation = null, busy = null, failure = null, candidate = null, timer = null, lastAck = -Infinity, replacement = null;
  const report = (state, extra = {}) => onStatus({state, ...extra});
  const stopTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const assertOpen = () => { if (closed) throw adrError('BRIDGE_CLOSED', '账号或连接已经改变，请重新打开游戏。'); };
  function plan() {
    stopTimer();
    if (closed || !loaded || failure || busy || latest === confirmed) return;
    timer = schedule(() => { timer = null; saveNow().catch(() => {}); }, Math.max(debounceMs, lastAck + intervalMs - clock()));
  }
  function queue(state) {
    assertOpen();
    if (!loaded || replacement) return;
    const text = stateSnapshot(state);
    if (text === latest) return;
    latest = text;
    if (!failure) report('pending');
    // A continuous stream of game ticks must not postpone the deadline forever.
    if (timer === null) plan();
  }
  async function saveNow({retry = false} = {}) {
    assertOpen(); stopTimer();
    if (!loaded) throw adrError('ADR_NOT_LOADED', '请先读取云端存档。');
    if (busy) return busy;
    if (failure && (!retry || failure.code === 'SAVE_CONFLICT')) throw failure;
    if (!operation && latest === confirmed) { report(current ? 'cloud' : 'ready', {revision:current?.revision}); return current; }
    operation ??= {
      snapshot:latest,
      input:{...resource, ...(current ? {expectedEtag:current.etag} : {createOnly:true}),
        idempotencyKey:id(), schemaVersion:1, data:{schemaVersion:1, upstreamVersion:'1.4',
          upstreamCommit:UPSTREAM_COMMIT, savedAt:new Date(clock()).toISOString(), state:JSON.parse(latest)}}
    };
    const sent = operation;
    report('syncing');
    busy = (async () => {
      try {
        const result = await Promise.resolve().then(() => cloudSave.write(sent.input));
        assertOpen();
        current = result; confirmed = sent.snapshot; operation = null; failure = null; lastAck = clock();
        report(latest === confirmed ? 'cloud' : 'pending', {revision:result.revision, historyDegraded:result.historyDegraded});
        if (replacement) {
          const action = replacement; replacement = null;
          onReplace(JSON.parse(confirmed), action.reload);
        }
        return result;
      } catch (error) {
        failure = error;
        report(error.code === 'SAVE_CONFLICT' ? 'conflict' : error.retryable ? 'unconfirmed' : 'blocked', {code:error.code, message:error.message});
        throw error;
      } finally { busy = null; plan(); }
    })();
    return busy;
  }
  return Object.freeze({
    async load() {
      assertOpen();
      if (loaded) throw adrError('ADR_ALREADY_LOADED', 'Game is already loaded.');
      report('loading');
      try {
        const read = await cloudSave.read(resource); assertOpen();
        const state = read && !read.deleted ? readDocument(read.data) : stateSnapshot({version:1.3});
        current = read; confirmed = latest = state; loaded = true; report('ready');
        return JSON.parse(state);
      } catch (error) { report('blocked', {code:error.code, message:error.message}); throw error; }
    },
    queue, saveNow,
    retry:() => saveNow({retry:true}),
    async compare() {
      assertOpen();
      if (failure?.code !== 'SAVE_CONFLICT' || busy) throw adrError('ADR_NO_CONFLICT', '当前没有可处理的冲突。');
      const read = await cloudSave.read(resource); assertOpen();
      const text = read && !read.deleted ? readDocument(read.data) : stateSnapshot({version:1.3});
      candidate = {read, text};
      return {local:JSON.parse(latest), cloud:JSON.parse(text), revision:read?.revision ?? null, deleted:read?.deleted ?? false};
    },
    keepLocal() {
      assertOpen();
      if (!candidate || failure?.code !== 'SAVE_CONFLICT') throw adrError('ADR_COMPARE_REQUIRED', '请先读取冲突双方的进度。');
      current = candidate.read; confirmed = candidate.text; candidate = null; operation = null; failure = null;
      // Recheck CAS against the version the player actually inspected.
      return saveNow();
    },
    useCloud() {
      assertOpen();
      if (!candidate || failure?.code !== 'SAVE_CONFLICT') throw adrError('ADR_COMPARE_REQUIRED', '请先读取冲突双方的进度。');
      stopTimer(); closed = true;
      onReplace(JSON.parse(candidate.text), true);
    },
    replace(state, {reload = true} = {}) {
      assertOpen();
      const text = stateSnapshot(state);
      if (busy || operation || failure || latest !== confirmed) throw adrError('ADR_PENDING_OPERATION', '请先保存或处理当前未确认的进度，再导入或重开。');
      latest = text; replacement = {reload};
      // An identical import is a no-op but still needs the requested UI reload.
      if (latest === confirmed) { replacement = null; onReplace(JSON.parse(text), reload); return Promise.resolve(current); }
      return saveNow();
    },
    exportState:() => latest === null ? null : JSON.parse(latest),
    getStatus:() => ({loaded, closed, pending:latest !== confirmed, inFlight:Boolean(operation), code:failure?.code ?? null}),
    close() { closed = true; stopTimer(); report('blocked', {code:'BRIDGE_CLOSED', message:'连接已关闭，本页进度不会提交给其他账号。'}); },
  });
}
