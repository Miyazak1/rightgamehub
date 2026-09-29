'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preloads cannot require arbitrary local modules. Keep channel names
// aligned with protocol.cjs and never expose ipcRenderer or an IPC event object.
contextBridge.exposeInMainWorld('gamehubOffscreen', {
  onInput(callback) {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('gamehub:offscreen-input-v1', listener);
    return () => ipcRenderer.removeListener('gamehub:offscreen-input-v1', listener);
  },
  report(message) { ipcRenderer.send('gamehub:offscreen-report-v1', message); },
});
