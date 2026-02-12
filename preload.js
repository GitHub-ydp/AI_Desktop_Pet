const { contextBridge, ipcRenderer } = require('electron');

// 暴露Electron API到渲染进程
contextBridge.exposeInMainWorld('electron', {
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAPIKey: () => ipcRenderer.invoke('get-api-key'),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  onWindowMove: (callback) => {
    ipcRenderer.on('window-move', callback);
  },
  
  // 窗口大小调整（可选锚点）
  resizeWindow: (size, anchor) => ipcRenderer.invoke('resize-window', size, anchor),
  
  // 子窗口管理
  createChildWindow: (options) => ipcRenderer.invoke('create-child-window', options),
  closeChildWindow: (id) => ipcRenderer.invoke('close-child-window', id),
  sendToChildWindow: (id, channel, data) => ipcRenderer.invoke('send-to-child-window', id, channel, data),
  onChildWindowMessage: (callback) => {
    ipcRenderer.on('child-window-message', callback);
  },
  // 菜单窗口管理
  openMenuWindow: () => ipcRenderer.invoke('menu:open'),
  closeMenuWindow: () => ipcRenderer.invoke('menu:close'),
  toggleMenuWindow: () => ipcRenderer.invoke('menu:toggle'),
  isMenuWindowOpen: () => ipcRenderer.invoke('menu:is-open'),
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu:command', callback);
  },
  // 聊天窗口通信
  sendChatMessage: (message) => ipcRenderer.invoke('chat:send', message),
  onChatSend: (callback) => {
    ipcRenderer.on('chat:send', callback);
  },
  sendChatResponse: (requestId, payload) => ipcRenderer.send('chat:response', requestId, payload),
  // 设置窗口通信
  sendSettingsChange: (payload) => ipcRenderer.send('settings:change', payload),
  onSettingsChange: (callback) => {
    ipcRenderer.on('settings:change', callback);
  },
  // 宠物状态切换通信（菜单窗口 -> 主窗口）
  sendPetState: (payload) => ipcRenderer.send('pet:state', payload),
  onPetState: (callback) => {
    ipcRenderer.on('pet:state', callback);
  },
  // 气泡窗口通信
  showBubble: (message, duration) => ipcRenderer.invoke('bubble:show', message, duration),
  hideBubble: () => ipcRenderer.invoke('bubble:hide'),
  onBubbleShow: (callback) => {
    ipcRenderer.on('bubble:show', callback);
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
    ipcRenderer.invoke('memory:migrate-localstorage', data),

  // 记忆系统升级 API
  getEmbeddingStatus: () =>
    ipcRenderer.invoke('memory:embedding-status'),

  flushFacts: () =>
    ipcRenderer.invoke('memory:flush-facts'),

  getLayeredContext: (query, options) =>
    ipcRenderer.invoke('memory:get-layered-context', query, options)
});

// 暴露提醒系统 API 到渲染进程
contextBridge.exposeInMainWorld('PetReminder', {
  // 创建提醒
  create: (data) => ipcRenderer.invoke('reminder:create', data),

  // 获取提醒列表
  getAll: (options) => ipcRenderer.invoke('reminder:get-all', options),

  // 获取待处理提醒
  getPending: () => ipcRenderer.invoke('reminder:get-pending'),

  // 取消提醒
  cancel: (id) => ipcRenderer.invoke('reminder:cancel', id),

  // 删除提醒
  delete: (id) => ipcRenderer.invoke('reminder:delete', id),

  // 获取用户时间偏好
  getPreference: (keyword) => ipcRenderer.invoke('reminder:get-preference', keyword),

  // 分析用户习惯
  analyzeHabits: () => ipcRenderer.invoke('reminder:analyze-habits'),

  // 获取提醒历史
  getHistory: (options) => ipcRenderer.invoke('reminder:get-history', options),

  // 监听提醒触发事件
  onReminderTriggered: (callback) => {
    ipcRenderer.on('reminder:triggered', callback);
  },

  // 监听过期提醒事件
  onOverdue: (callback) => {
    ipcRenderer.on('reminder:overdue', callback);
  },

  // 移除监听
  offReminderTriggered: (callback) => {
    ipcRenderer.off('reminder:triggered', callback);
  },

  offOverdue: (callback) => {
    ipcRenderer.off('reminder:overdue', callback);
  }
});

// 暴露工具系统 API 到渲染进程
contextBridge.exposeInMainWorld('PetTools', {
  // 执行工具
  execute: (toolName, params, context) =>
    ipcRenderer.invoke('tool:execute', toolName, params, context),

  // 列出所有工具
  list: () =>
    ipcRenderer.invoke('tool:list'),

  // 获取工具执行历史
  getHistory: (options) =>
    ipcRenderer.invoke('tool:get-history', options),

  // 清空工具执行历史
  clearHistory: () =>
    ipcRenderer.invoke('tool:clear-history')
});

// 暴露截图系统 API 到渲染进程（向后兼容，保留旧接口）
contextBridge.exposeInMainWorld('PetScreenshot', {
  // 获取可用的屏幕源
  getSources: () => ipcRenderer.invoke('screenshot:get-sources'),

  // 区域截图（实际捕获在渲染进程中完成）
  captureRegion: (bounds) => ipcRenderer.invoke('screenshot:capture-region', bounds),

  // 全屏截图
  captureFullScreen: () => ipcRenderer.invoke('screenshot:capture-fullscreen'),

  // 复制到剪贴板
  copyToClipboard: (filePath) => ipcRenderer.invoke('screenshot:copy-to-clipboard', filePath),

  // 获取历史记录
  getHistory: (options) => ipcRenderer.invoke('screenshot:get-history', options),

  // 获取单个截图
  getById: (id) => ipcRenderer.invoke('screenshot:get-by-id', id),

  // 软删除截图
  delete: (id) => ipcRenderer.invoke('screenshot:delete', id),

  // 永久删除截图
  permanentlyDelete: (id) => ipcRenderer.invoke('screenshot:permanently-delete', id),

  // AI 分析
  analyze: (id, prompt) => ipcRenderer.invoke('screenshot:analyze', id, prompt),

  // OCR 识别
  ocr: (id, lang) => ipcRenderer.invoke('screenshot:ocr', id, lang),

  // 翻译
  translate: (id, targetLang) => ipcRenderer.invoke('screenshot:translate', id, targetLang),

  // 获取分析结果
  getAnalyses: (id) => ipcRenderer.invoke('screenshot:get-analyses', id),

  // 获取统计信息
  getStatistics: () => ipcRenderer.invoke('screenshot:get-statistics'),

  // 清理过期截图
  cleanup: () => ipcRenderer.invoke('screenshot:cleanup'),

  // 监听快速截图事件
  onQuickCapture: (callback) => {
    ipcRenderer.on('screenshot:quick-capture', callback);
  },

  // 移除监听
  offQuickCapture: (callback) => {
    ipcRenderer.off('screenshot:quick-capture', callback);
  }
});

// 截图桥接 API（新版，供 screenshot-capture.html 使用）
// 使用 contextIsolation:true + contextBridge 安全暴露
contextBridge.exposeInMainWorld('ScreenshotBridge', {
  // 获取全屏截图背景（返回 dataURL + 显示器信息）
  getScreenCapture: () => ipcRenderer.invoke('screenshot:get-screen-capture'),

  // 区域选择完成（返回处理结果）
  selectRegion: (bounds) => ipcRenderer.invoke('screenshot:region-selected', bounds),

  // 取消截图
  cancel: () => ipcRenderer.invoke('screenshot:capture-cancel'),

  // 从 dataURL 复制到剪贴板
  copyDataToClipboard: (dataURL) => ipcRenderer.invoke('screenshot:copy-data', dataURL),

  // 快速保存（自动保存到 userData/screenshots/）
  saveQuick: (dataURL) => ipcRenderer.invoke('screenshot:save-quick', dataURL),

  // 另存为（弹出系统对话框）
  saveAs: (dataURL) => ipcRenderer.invoke('screenshot:save-as', dataURL),

  // 贴图到桌面（创建置顶小窗口）
  pinToDesktop: (dataURL, bounds) => ipcRenderer.invoke('screenshot:pin', dataURL, bounds),

  // AI 分析截图
  analyze: (dataURL, prompt) => ipcRenderer.invoke('screenshot:analyze-image', dataURL, prompt),

  // OCR 文字识别
  ocr: (dataURL) => ipcRenderer.invoke('screenshot:ocr-image', dataURL),

  // 监听贴图窗口加载事件（解包 event 对象，只传 dataURL）
  onPinLoad: (callback) => {
    ipcRenderer.on('pin:load', (e, dataURL) => callback(dataURL));
  },

  // 设置贴图窗口透明度（由贴图窗口自身调用）
  setPinOpacity: (opacity) => ipcRenderer.invoke('pin:set-opacity', opacity),

  // 关闭贴图窗口（由贴图窗口自身调用）
  closePinWindow: () => ipcRenderer.invoke('pin:close')
});
