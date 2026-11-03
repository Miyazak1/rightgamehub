const path = require('node:path');

function createDesktopTray({app, Tray, Menu, assetRoot, getWindow, updates, onCheckUpdates = () => {}, name = '墨鱼工坊'}) {
  let tray = null, quitting = false, disposed = false;
  const available = () => !!tray && !tray.isDestroyed();
  const state = () => ({trayAvailable:available(),closeBehavior:available() ? 'tray' : 'minimize'});
  const restore = () => {
    const window = getWindow();
    if (disposed || !window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  };
  const markQuitting = () => { quitting = true; };
  const quit = () => { if (!disposed) app.quit(); };
  const checkForUpdates = () => {
    if (disposed) return;
    restore(); onCheckUpdates();
    // Showing the panel must not discard a verified installer or interrupt exit.
    // Installation still revalidates the signed feed and cached file.
    if (updates && !['ready', 'installing'].includes(updates.state().status))
      return updates.run('check').catch(() => {});
  };
  try {
    tray = new Tray(path.join(assetRoot, 'desktop-icons/mooyu.ico'));
    tray.setToolTip(name);
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开墨鱼工坊',click:restore},
      {label:'检查更新',click:checkForUpdates},
      {type:'separator'},
      {label:'退出墨鱼工坊',click:quit},
    ]));
    tray.on('click', restore); tray.on('double-click', restore);
  } catch { try { tray?.destroy(); } catch {} tray = null; }
  app.on('before-quit', markQuitting);
  const close = event => {
    if (quitting || disposed) return;
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    event.preventDefault();
    if (available()) window.hide(); else window.minimize();
  };
  const dispose = () => { if (disposed) return; disposed = true; quitting = true; app.removeListener('before-quit', markQuitting); if (available()) tray.destroy(); tray = null; };
  app.once('will-quit', dispose);
  return {state,restore,quit,close,checkForUpdates,cancelQuit(){quitting=false;},markQuitting,dispose};
}
module.exports = {createDesktopTray};
