const { contextBridge, ipcRenderer } = require('electron');

// 暴露Electron API到渲染进程
contextBridge.exposeInMainWorld('electron', {
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAPIKey: () => ipcRenderer.invoke('get-api-key'),
  onWindowMove: (callback) => {
    ipcRenderer.on('window-move', callback);
  }
});

// 暴露记忆系统 API 到渲染进程
contextBridge.exposeInMainWorld('PetMemory', {
  // 初始化
  initialize: () => ipcRenderer.invoke('memory:init'),

  // 对话管理
  addConversation: (role, content, metadata) =>
    ipcRenderer.invoke('memory:add-conversation', role, content, metadata),

  // 搜索
  searchMemories: (query, options) =>
    ipcRenderer.invoke('memory:search', query, options),

  getContext: (query, options) =>
    ipcRenderer.invoke('memory:get-context', query, options),

  // 事实
  getFacts: (options) =>
    ipcRenderer.invoke('memory:get-facts', options),

  getUserProfile: () =>
    ipcRenderer.invoke('memory:get-user-profile'),

  // 统计
  getStats: () =>
    ipcRenderer.invoke('memory:get-stats'),

  // 清理
  clearAll: () =>
    ipcRenderer.invoke('memory:clear-all'),

  // 导入导出
  export: () =>
    ipcRenderer.invoke('memory:export'),

  import: (data) =>
    ipcRenderer.invoke('memory:import', data),

  migrateFromLocalStorage: (data) =>
    ipcRenderer.invoke('memory:migrate-localstorage', data)
});
