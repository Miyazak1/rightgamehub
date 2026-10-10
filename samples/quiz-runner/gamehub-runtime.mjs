import { createGameHubClient } from './gamehub-sdk/index.mjs';

const namespace = 'quiz-runner';
const storageSlot = 'browser-storage';
const activeQuizSlot = 'active-quiz';
const fallbackPrefix = 'gamehub:quiz-runner:';

const clone = value => JSON.parse(JSON.stringify(value));
const idempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`;

function fallbackRead(slot) {
  try { return JSON.parse(globalThis.localStorage.getItem(fallbackPrefix + slot) || 'null'); }
  catch { return null; }
}

function fallbackWrite(slot, data) {
  try { globalThis.localStorage.setItem(fallbackPrefix + slot, JSON.stringify(data)); }
  catch { /* The production iframe intentionally has an opaque origin. */ }
}

function directDownload(filename, data) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { status: 'download_started', filename };
}

export async function createQuizRuntime() {
  let client = null;
  let capabilities = [];
  const rows = new Map();
  if (globalThis.parent && globalThis.parent !== globalThis) {
    try {
      client = createGameHubClient();
      capabilities = await client.connect();
    } catch (error) {
      console.warn('GameHub bridge unavailable; using an in-page fallback.', error);
      client = null;
    }
  }

  async function readSlot(slot) {
    if (!client || !capabilities.includes('localSave')) return fallbackRead(slot);
    const row = await client.localSave.read({ namespace, slot });
    rows.set(slot, row);
    return row?.data ?? null;
  }

  async function writeSlot(slot, data) {
    if (!client || !capabilities.includes('localSave')) {
      fallbackWrite(slot, data);
      return { durability: 'memory' };
    }
    let current = rows.get(slot);
    if (!current) {
      current = await client.localSave.read({ namespace, slot });
      rows.set(slot, current);
    }
    const condition = current?.etag ? { expectedEtag: current.etag } : { createOnly: true };
    const result = await client.localSave.write({ namespace, slot, schemaVersion: 1, data: clone(data), ...condition, idempotencyKey: idempotencyKey() });
    rows.set(slot, result);
    return result;
  }

  async function createStorage(onError = () => {}) {
    const restored = await readSlot(storageSlot).catch(error => { onError(error); return null; });
    const entries = new Map(Object.entries(restored?.entries && typeof restored.entries === 'object' ? restored.entries : {}));
    let pending = null;
    let saving = null;
    const flush = () => {
      if (saving) return saving;
      saving = (async () => {
        while (pending) {
          const payload = pending;
          pending = null;
          try { await writeSlot(storageSlot, payload); }
          catch (error) { onError(error); }
        }
      })().finally(() => { saving = null; if (pending) flush(); });
      return saving;
    };
    const changed = () => { pending = { entries: Object.fromEntries(entries) }; flush(); };
    return Object.freeze({
      get length() { return entries.size; },
      key(index) { return [...entries.keys()][index] ?? null; },
      getItem(key) { return entries.has(String(key)) ? entries.get(String(key)) : null; },
      setItem(key, value) { entries.set(String(key), String(value)); changed(); },
      removeItem(key) { entries.delete(String(key)); changed(); },
      clear() { entries.clear(); changed(); },
      flush: () => flush() ?? Promise.resolve(),
    });
  }

  async function readActiveQuiz() {
    const value = await readSlot(activeQuizSlot);
    return value?.quiz && typeof value.quiz === 'object' ? value.quiz : null;
  }

  async function writeActiveQuiz(quiz) {
    const text = JSON.stringify(quiz);
    if (new TextEncoder().encode(text).byteLength > 900_000) throw new Error('题包超过 900 KiB，请压缩图片或减少内嵌素材后重试。');
    return writeSlot(activeQuizSlot, { quiz: clone(quiz), savedAt: new Date().toISOString() });
  }

  async function downloadJson(filename, value) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (!client || !capabilities.includes('fileExport')) return directDownload(filename, text);
    const bytes = new TextEncoder().encode(text);
    return client.files.download({ filename, mimeType: 'application/json', data: bytes.buffer });
  }

  return Object.freeze({ capabilities: [...capabilities], createStorage, readActiveQuiz, writeActiveQuiz, downloadJson, close: () => client?.close() });
}
