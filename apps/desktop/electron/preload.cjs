const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) contextBridge.exposeInMainWorld('mooyuDesktop', Object.freeze({
  environment: () => ipcRenderer.invoke('mooyu:preview-environment'),
  account: Object.freeze({
    call: (method, args) => ipcRenderer.invoke('mooyu:account-call', method, args),
    onChanged(listener) {
      if (typeof listener !== 'function') throw Error('DESKTOP_LISTENER_INVALID');
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('mooyu:account-state', handler);
      return () => ipcRenderer.removeListener('mooyu:account-state', handler);
    },
  }),
  chrome: Object.freeze({
    state: () => ipcRenderer.invoke('mooyu:chrome-state-get'),
    action: value => ipcRenderer.invoke('mooyu:chrome-action', value),
    theme: mode => ipcRenderer.invoke('mooyu:chrome-theme', mode),
    onState(listener) {
      if (typeof listener !== 'function') throw Error('DESKTOP_LISTENER_INVALID');
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('mooyu:chrome-state', handler);
      return () => ipcRenderer.removeListener('mooyu:chrome-state', handler);
    },
  }),
}));
