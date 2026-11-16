const { contextBridge, ipcRenderer, webUtils } = require('electron');
if (process.isMainFrame) contextBridge.exposeInMainWorld('mooyuDesktop', Object.freeze({
  links:Object.freeze({openExternal:value=>ipcRenderer.invoke('mooyu:link-open',value)}),
  environment: () => ipcRenderer.invoke('mooyu:preview-environment'),
  updates: Object.freeze({call: action => ipcRenderer.invoke('mooyu:update-call', action),
    onOpen(listener) {
      if (typeof listener !== 'function') throw Error('DESKTOP_LISTENER_INVALID');
      const handler = () => listener(); ipcRenderer.on('mooyu:updates-open', handler);
      return () => ipcRenderer.removeListener('mooyu:updates-open', handler);
    },
    onState(listener) {
      if (typeof listener !== 'function') throw Error('DESKTOP_LISTENER_INVALID');
      const handler = (_event, value) => listener(value); ipcRenderer.on('mooyu:update-state', handler);
      return () => ipcRenderer.removeListener('mooyu:update-state', handler);
    }}),
  files: Object.freeze({ save: input => ipcRenderer.invoke('mooyu:file-save', input), cancel: id => ipcRenderer.invoke('mooyu:file-cancel', id),
    registerUpload: file => ipcRenderer.invoke('mooyu:file-upload-register',webUtils.getPathForFile(file)) }),
  realtime: Object.freeze({
    call: (method, input) => ipcRenderer.invoke('mooyu:realtime-call', method, input),
    onEvent(listener) {
      if (typeof listener !== 'function') throw Error('DESKTOP_LISTENER_INVALID');
      const handler = (_event, value) => listener(value); ipcRenderer.on('mooyu:realtime-event', handler);
      return () => ipcRenderer.removeListener('mooyu:realtime-event', handler);
    },
  }),
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
if(process.isMainFrame)window.addEventListener('click',event=>{
  if(!event.isTrusted||event.defaultPrevented||event.button!==0)return;
  const anchor=event.composedPath().find(node=>node?.tagName==='A');
  if(!anchor||anchor.hasAttribute('download'))return;
  try{const url=new URL(anchor.href);if(!['http:','https:'].includes(url.protocol))return;
    event.preventDefault();void ipcRenderer.invoke('mooyu:link-open',url.href).catch(()=>{});
  }catch{}
});
