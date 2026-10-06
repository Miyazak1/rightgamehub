export const UPSTREAM_COMMIT = '1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function adrError(code, message) { return Object.assign(new Error(message), {code}); }
export function stateSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw adrError('ADR_SAVE_INVALID', '存档必须是状态对象。');
  const stack = [[input, 0]], seen = new Set(); let nodes = 0;
  while (stack.length) {
    const [value, depth, leaving] = stack.pop();
    if (leaving) { seen.delete(value); continue; }
    if (++nodes > 100000 || depth > 60) throw adrError('ADR_SAVE_INVALID', '存档结构过于复杂。');
    if (typeof value === 'number' && !Number.isFinite(value)) throw adrError('ADR_SAVE_INVALID', '存档含无效数值。');
    if (value && typeof value === 'object') {
      if (seen.has(value)) throw adrError('ADR_SAVE_INVALID', '存档含循环对象。');
      seen.add(value); stack.push([value, depth, true]);
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw adrError('ADR_SAVE_INVALID', '存档包含不支持的字段。');
        stack.push([child, depth + 1]);
      }
    } else if (!['string','number','boolean','undefined'].includes(typeof value) && value !== null) {
      throw adrError('ADR_SAVE_INVALID', '存档包含非 JSON 数据。');
    }
  }
  // The page says 1.4, but this pinned upstream still serializes state.version 1.3.
  if (input.version !== undefined && ![1, 1.1, 1.2, 1.3].includes(input.version)) throw adrError('ADR_VERSION_UNSUPPORTED', '存档版本暂不支持。');
  const text = JSON.stringify(input);
  if (new TextEncoder().encode(text).length > 250 * 1024) throw adrError('ADR_SAVE_TOO_LARGE', '存档超过本适配版上限。');
  return text;
}
export function readDocument(document) {
  if (!document || document.schemaVersion !== 1 || document.upstreamVersion !== '1.4'
      || document.upstreamCommit !== UPSTREAM_COMMIT) throw adrError('ADR_VERSION_UNSUPPORTED', '云端存档需要其他版本的游戏，未覆盖原存档。');
  return stateSnapshot(document.state);
}
export function pathParts(path) {
  if (typeof path !== 'string' || !path.length || path.length > 1024) throw adrError('ADR_PATH_INVALID', 'Invalid state path');
  const result = []; let offset = 0;
  const token = /(?:^|\.)([a-zA-Z_$][\w$]*)|\[(?:"([^"\\]*)"|'([^'\\]*)'|([0-9]+))\]/gy;
  while (offset < path.length) {
    token.lastIndex = offset;
    const match = token.exec(path);
    if (!match || match.index !== offset) throw adrError('ADR_PATH_INVALID', 'Invalid state path');
    const key = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (forbidden.has(key)) throw adrError('ADR_PATH_INVALID', 'Unsafe state path');
    result.push(key); offset = token.lastIndex;
  }
  return result;
}
export function getStatePath(state, path) {
  let value = state;
  for (const key of pathParts(path)) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
export function setStatePath(state, path, value) {
  const parts = pathParts(path); let parent = state;
  for (const key of parts.slice(0, -1)) {
    if (!Object.hasOwn(parent, key) || !parent[key] || typeof parent[key] !== 'object') parent[key] = {};
    parent = parent[key];
  }
  parent[parts.at(-1)] = value;
  return parent;
}
export function removeStatePath(state, path) {
  const parts = pathParts(path); let parent = state;
  for (const key of parts.slice(0, -1)) {
    if (!parent || !Object.hasOwn(parent, key)) return;
    parent = parent[key];
  }
  if (parent && typeof parent === 'object') delete parent[parts.at(-1)];
}

export function describeState(state) {
  const game=state?.game??{}, stores=state?.stores??{}, buildings=game.buildings??{};
  return '木头 '+(stores.wood??0)+' · 毛皮 '+(stores.fur??0)+' · 人口 '+(game.population??0)
    +' · 小屋 '+(buildings.hut??0)+' · 陷阱 '+(buildings.trap??0)
    +' · 飞船船体 '+(game.spaceShip?.hull??0)+' · 得分 '+(state?.playStats?.score??0);
}
