const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  isDesktop: true,
  selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
  updateState: () => ipcRenderer.invoke('desktop:update-state'),
  checkUpdate: () => ipcRenderer.invoke('desktop:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  cancelUpdate: () => ipcRenderer.invoke('desktop:update-cancel'),
  revealUpdate: () => ipcRenderer.invoke('desktop:update-reveal'),
  onUpdate: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('desktop:update-state', listener); return () => ipcRenderer.removeListener('desktop:update-state', listener); },
}));
