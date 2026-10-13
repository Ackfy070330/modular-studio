const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  isDesktop: true,
  selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
}));
