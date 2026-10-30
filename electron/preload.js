/* Sukot AI Bot — preload: exposes a minimal, safe bridge to the renderer */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  request: (payload) => ipcRenderer.send('ai:request', payload),
  cancel: (id) => ipcRenderer.send('ai:cancel', id),
  onChunk: (cb) => ipcRenderer.on('ai:chunk', (_e, id, text) => cb(id, text)),
  onDone: (cb) => ipcRenderer.on('ai:done', (_e, id, err) => cb(id, err)),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
