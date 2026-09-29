import approved from './offscreen-approved.json' with { type: 'json' };

export const OFFSCREEN_MANIFEST = 'gamehub.offscreen.json';
export const OFFSCREEN_PACKAGE_POLICY = 1;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => plain(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const refusal = message => Object.assign(new Error(message), { status: 409 });

export function validateOffscreenManifest(value) {
  if (!keys(value, ['schemaVersion', 'id', 'version', 'title', 'runtime', 'entry', 'viewport', 'input', 'permissions']) ||
      value.schemaVersion !== 1 || value.runtime !== 'electron-offscreen-v1' || value.entry !== 'index.html' ||
      value.input !== 'gamehub-input-v1' || !/^[a-z][a-z0-9.-]{2,79}$/.test(value.id) ||
      !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.version) || typeof value.title !== 'string' ||
      !value.title.trim() || value.title.length > 80 || /[\x00-\x1f\x7f]/.test(value.title) ||
      !keys(value.viewport, ['width', 'height']) || value.viewport.width !== 640 || value.viewport.height !== 360 ||
      !keys(value.permissions, ['network', 'audio']) || value.permissions.network !== false || value.permissions.audio !== false) {
    throw new Error('侧栏适配清单无效：当前只接受 v1、640×360、无联网及声音的 Electron 离屏渲染包。');
  }
  return structuredClone(value);
}

// Recognition is not execution approval. Only the reviewed, platform-owned
// archive and its exact renderer bytes are eligible in this prototype.
export function approvedPackage(sha256) {
  return approved.packages.find(item => item.sha256 === sha256) || null;
}

export function assertApprovedAssets(sha256, game) {
  const item = approvedPackage(sha256);
  if (!item || game?.offscreen?.policy !== OFFSCREEN_PACKAGE_POLICY ||
      game.offscreen.manifest.id !== item.id || game.offscreen.manifest.version !== item.version) {
    throw refusal('此适配包尚未获准运行；本轮只开放自有样本，仍可下载文件。');
  }
  validateOffscreenManifest(game.offscreen.manifest);
  const assets = game.assets;
  if (!plain(assets) || Object.keys(assets).sort().join('\n') !== Object.keys(item.assets).sort().join('\n')) throw refusal('适配包资源清单不匹配。');
  for (const [name, expected] of Object.entries(item.assets)) {
    if (assets[name]?.sha256 !== expected.sha256 || assets[name]?.size !== expected.size) throw refusal('适配包资源摘要不匹配。');
  }
  return item;
}
