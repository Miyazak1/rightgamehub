'use strict';

// These callbacks belong to trusted host adapters, never to uploaded games.
async function openArcade({ preference = 'auto', sidebar, browser }) {
  if (!['auto', 'sidebar', 'browser'].includes(preference)) {
    throw new Error('Unknown display preference');
  }
  let reason = preference === 'browser' ? 'user-selected-browser' : 'sidebar-unavailable';
  if (preference !== 'browser' && sidebar?.supported === true) {
    try {
      const result = await sidebar.open();
      if (result?.ready === true) return { mode: 'sidebar' };
      reason = 'sidebar-not-ready';
    } catch {
      reason = 'sidebar-open-failed';
    }
  }
  if (typeof browser?.open !== 'function') {
    throw new Error('当前宿主没有可用的内置浏览器入口。');
  }
  // Do not report success just because a browser was requested or queued.
  const result = await browser.open();
  if (!['opened', 'queued'].includes(result?.status)) {
    throw new Error('内置浏览器未能打开游戏平台。');
  }
  return { mode: 'browser', status: result.status, reason };
}

module.exports = { openArcade };
