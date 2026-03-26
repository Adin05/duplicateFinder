const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('duplicateFinderApi', {
  onLog(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scan:log', listener);
    return () => ipcRenderer.removeListener('scan:log', listener);
  },
  onProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.removeListener('scan:progress', listener);
  },
  pickDirectory() {
    return ipcRenderer.invoke('dialog:pick-directory');
  },
  startScan(payload) {
    return ipcRenderer.invoke('scan:start', payload);
  },
});
