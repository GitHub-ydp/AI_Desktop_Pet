const { contextBridge, ipcRenderer } = require('electron');

// 暴露Electron API到渲染进程
contextBridge.exposeInMainWorld('electron', {
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onWindowMove: (callback) => {
    ipcRenderer.on('window-move', callback);
  }
});
