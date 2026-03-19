const { contextBridge, ipcRenderer } = require('electron');
const taskEventListenerMap = new WeakMap();
const pendingAgentStreams = new Map();

ipcRenderer.on('agent:stream-port', (event, data) => {
  if (!data || !data.streamId) return;
  const pending = pendingAgentStreams.get(data.streamId);
  if (!pending) return;
  pendingAgentStreams.delete(data.streamId);

  const port = event.ports && event.ports[0];
  if (!port) {
    pending.reject(new Error('Agent stream port was not transferred'));
    return;
  }

  pending.resolve(port);
});

// 暴露Electron API到渲染进程
contextBridge.exposeInMainWorld('electron', {
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  minimizeCurrentWindow: () => ipcRenderer.invoke('window:minimize-current'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
  clearAuthToken: () => ipcRenderer.invoke('clear-auth-token'),
  openAuthWindow: () => ipcRenderer.invoke('open-auth-window'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  getPythonConfig: () => ipcRenderer.invoke('workflow:get-python-config'),
  choosePythonInterpreter: () => ipcRenderer.invoke('workflow:choose-python-interpreter'),
  savePythonInterpreter: (pythonPath) => ipcRenderer.invoke('workflow:set-python-interpreter', pythonPath),
  resetPythonInterpreter: () => ipcRenderer.invoke('workflow:reset-python-interpreter'),
  getWeatherDefaultCity: () => ipcRenderer.invoke('weather:get-default-city'),
  saveWeatherDefaultCity: (city) => ipcRenderer.invoke('weather:set-default-city', city),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  listLottieJsonFiles: (folder) => ipcRenderer.sendSync('lottie:list-json-files-sync', folder),
  onWindowMove: (callback) => {
    ipcRenderer.on('window-move', callback);
  },
  
  // 窗口大小调整（可选锚点）
  resizeWindow: (size, anchor) => ipcRenderer.invoke('resize-window', size, anchor),
  
  // 子窗口管理
  createChildWindow: (options) => ipcRenderer.invoke('create-child-window', options),
  closeChildWindow: (id) => ipcRenderer.invoke('close-child-window', id),
  sendToChildWindow: (id, channel, data) => ipcRenderer.invoke('send-to-child-window', id, channel, data),
  onChildWindowState: (callback) => ipcRenderer.on('child-window-state', callback),
  hideToPetTray: () => ipcRenderer.send('hide-to-pet-tray'),
  showFromTray: () => ipcRenderer.send('show-from-tray'),
  onChildWindowMessage: (callback) => {
    ipcRenderer.on('child-window-message', callback);
  },
  getPetProfile: () => ipcRenderer.invoke('memory:get-user-profile'),
  getMemoryStats: () => ipcRenderer.invoke('memory:get-stats'),
  getMemoryFacts: () => ipcRenderer.invoke('memory:get-facts'),
  deleteMemoryFact: (id) => ipcRenderer.invoke('memory:delete-fact', id),
  clearMemoryProfile: () => ipcRenderer.invoke('memory:clear-user-profile'),
  searchConversations: (keyword, options) =>
    ipcRenderer.invoke('memory:search', keyword, options || {}),
  // 菜单窗口管理
  openMenuWindow: () => ipcRenderer.invoke('menu:open'),
  closeMenuWindow: () => ipcRenderer.invoke('menu:close'),
  toggleMenuWindow: () => ipcRenderer.invoke('menu:toggle'),
  isMenuWindowOpen: () => ipcRenderer.invoke('menu:is-open'),
  onMenuWindowState: (callback) => {
    ipcRenderer.on('menu:state', callback);
  },
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu:command', callback);
  },
  // 聊天窗口通信
  sendChatMessage: (message) => ipcRenderer.invoke('chat:send', message),
  onChatSend: (callback) => {
    ipcRenderer.on('chat:send', callback);
  },
  // 主窗口处理完聊天后回传结果给主进程
  sendChatResponse: (requestId, data) => ipcRenderer.send(`chat:response:${requestId}`, data),
  // 设置窗口通信
  sendSettingsChange: (payload) => ipcRenderer.send('settings:change', payload),
  onSettingsChange: (callback) => {
    ipcRenderer.on('settings:change', callback);
  },
  // 宠物状态切换通信（菜单窗口 -> 主窗口）
  sendPetState: (payload) => ipcRenderer.send('pet:state', payload),
  sendPetStateUpdate: (payload) => ipcRenderer.send('pet:state-updated', payload),
  onPetState: (callback) => {
    ipcRenderer.on('pet:state', callback);
  },
  // 气泡窗口通信
  showBubble: (message, duration, options) => ipcRenderer.invoke(
    'bubble:show',
    (message && typeof message === 'object')
      ? message
      : { message, duration, ...(options || {}) }
  ),
  hideBubble: () => ipcRenderer.invoke('bubble:hide'),
  onBubbleShow: (callback) => {
    ipcRenderer.on('bubble:show', callback);
  },
  showIntimacyWidget: (payload) => ipcRenderer.invoke('intimacy-widget:show', payload || {}),
  hideIntimacyWidget: () => ipcRenderer.invoke('intimacy-widget:hide'),
  onIntimacyWidgetShow: (callback) => {
    ipcRenderer.on('intimacy-widget:show', callback);
  },
  onIntimacyWidgetHide: (callback) => {
    ipcRenderer.on('intimacy-widget:hide', callback);
  },
  showTooltip: (payload) => ipcRenderer.invoke('tooltip:show', payload || {}),
  hideTooltip: () => ipcRenderer.invoke('tooltip:hide'),
  onTooltipShow: (callback) => {
    ipcRenderer.on('tooltip:show', (event, payload) => callback(payload));
  }
});

// 暴露记忆系统 API 到渲染进程
contextBridge.exposeInMainWorld('PetAgent', {
  isReady: () => ipcRenderer.invoke('agent:is-ready'),
  startSession: (payload) => ipcRenderer.invoke('agent:start-session', payload),
  send: (payload) => ipcRenderer.invoke('agent:send', payload),
  getState: (payload) => ipcRenderer.invoke('agent:get-state', payload),
  approve: (payload) => ipcRenderer.invoke('agent:approve', payload),
  cancel: (payload) => ipcRenderer.invoke('agent:cancel', payload),
  injectMessage: (runId, text) => ipcRenderer.invoke('agent:inject-message', { runId, text }),
  wait: (payload) => ipcRenderer.invoke('agent:wait', payload),
  openStream: async (payload, onEvent) => {
    const clientStreamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const portPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingAgentStreams.delete(clientStreamId);
        reject(new Error('agent_stream_timeout'));
      }, 5000);

      pendingAgentStreams.set(clientStreamId, {
        resolve: (streamPort) => {
          clearTimeout(timeoutId);
          resolve(streamPort);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    });

    let meta;
    try {
      meta = await ipcRenderer.invoke('agent:open-stream', {
        ...(payload || {}),
        streamId: clientStreamId
      });
    } catch (error) {
      pendingAgentStreams.delete(clientStreamId);
      throw error;
    }

    if (!meta || meta.error || !meta.streamId) {
      pendingAgentStreams.delete(clientStreamId);
      throw new Error(meta?.error || 'agent_open_stream_failed');
    }

    const port = await portPromise;

    port.onmessage = (streamEvent) => {
      if (typeof onEvent === 'function') {
        onEvent(streamEvent.data);
      }
    };
    if (typeof port.start === 'function') {
      port.start();
    }

    return {
      ...meta,
      close: () => {
        try {
          port.close();
        } catch {
          // Ignore close errors from already-closed ports.
        }
      }
    };
  }
});

contextBridge.exposeInMainWorld('PetMemory', {
  // 初始化
  initialize: () => ipcRenderer.invoke('memory:init'),

  // 对话管理
  addConversation: (role, content, metadata) =>
    ipcRenderer.invoke('memory:add-conversation', role, content, metadata),

  // 搜索
  searchMemories: (query, options) =>
    ipcRenderer.invoke('memory:search', query, options),

  getConversations: (options) =>
    ipcRenderer.invoke('memory:get-conversations', options),

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

  deleteConversation: (id) =>
    ipcRenderer.invoke('memory:delete-conversation', id),

  deleteFact: (id) =>
    ipcRenderer.invoke('memory:delete-fact', id),

  clearUserProfile: () =>
    ipcRenderer.invoke('memory:clear-user-profile'),

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
contextBridge.exposeInMainWorld('PetRitual', {
  manualTrigger: (type) => ipcRenderer.invoke('ritual:manual-trigger', type),
  openCard: (payload) => ipcRenderer.invoke('ritual:open-card', payload),
  onTrigger: (callback) => {
    ipcRenderer.on('ritual:trigger', (event, payload) => callback(payload));
  },
  offTrigger: () => {
    ipcRenderer.removeAllListeners('ritual:trigger');
  }
});

contextBridge.exposeInMainWorld('PetShare', {
  copyCard: (payload) => ipcRenderer.invoke('share:generate', { payload, mode: 'clipboard' }),
  saveCard: (payload) => ipcRenderer.invoke('share:generate', { payload, mode: 'save' })
});

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

  // 全屏截图（触发完整截图流程）
  captureFullScreen: () => ipcRenderer.send('start-screenshot'),

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

  // 翻译截图文字
  translate: (dataURL, targetLang) => ipcRenderer.invoke('screenshot:translate-image', dataURL, targetLang),

  // 监听贴图窗口加载事件（解包 event 对象，只传 dataURL）
  onPinLoad: (callback) => {
    ipcRenderer.on('pin:load', (e, dataURL) => callback(dataURL));
  },

  // 设置贴图窗口透明度（由贴图窗口自身调用）
  setPinOpacity: (opacity) => ipcRenderer.invoke('pin:set-opacity', opacity),

  // 获取系统窗口列表（窗口模式截图）
  getWindowList: () => ipcRenderer.invoke('screenshot:get-windows'),

  // 关闭贴图窗口（由贴图窗口自身调用）
  closePinWindow: () => ipcRenderer.invoke('pin:close')
});

// 健康提醒系统 API
contextBridge.exposeInMainWorld('PetHealth', {
  // 获取所有配置
  getAll: () => ipcRenderer.invoke('health:get-all'),

  // 获取单个配置
  getConfig: (type) => ipcRenderer.invoke('health:get-config', type),

  // 更新配置
  updateConfig: (id, updates) => ipcRenderer.invoke('health:update-config', id, updates),

  // 批量更新配置
  batchUpdate: (updates) => ipcRenderer.invoke('health:batch-update', updates),

  // 获取今日统计
  getTodayStats: () => ipcRenderer.invoke('health:get-today-stats'),

  // 获取历史统计
  getStatsHistory: (days) => ipcRenderer.invoke('health:get-stats-history', days),

  // 获取提醒历史
  getHistory: (options) => ipcRenderer.invoke('health:get-history', options),

  // 记录用户响应
  respond: (historyId, action) => ipcRenderer.invoke('health:respond', historyId, action),

  // 延后提醒
  snooze: (reminderId, minutes) => ipcRenderer.invoke('health:snooze', reminderId, minutes),

  // 监听健康提醒触发事件
  onTriggered: (callback) => {
    ipcRenderer.on('health:triggered', (event, data) => callback(data));
  },

  // 移除监听
  offTriggered: (callback) => {
    ipcRenderer.off('health:triggered', callback);
  }
});

// 任务管理系统 API
contextBridge.exposeInMainWorld('PetTask', {
  // 创建任务
  create: (data) => ipcRenderer.invoke('task:create', data),

  // 获取任务
  get: (id) => ipcRenderer.invoke('task:get', id),

  // 获取任务列表
  getAll: (options) => ipcRenderer.invoke('task:get-all', options),

  // 获取今日任务
  getToday: () => ipcRenderer.invoke('task:get-today'),

  // 获取待处理任务
  getPending: () => ipcRenderer.invoke('task:get-pending'),

  // 更新任务
  update: (id, updates) => ipcRenderer.invoke('task:update', id, updates),

  // 完成任务
  complete: (id) => ipcRenderer.invoke('task:complete', id),

  // 取消任务
  cancel: (id) => ipcRenderer.invoke('task:cancel', id),

  // 删除任务
  delete: (id) => ipcRenderer.invoke('task:delete', id),

  // 获取今日统计
  getTodayStats: () => ipcRenderer.invoke('task:get-today-stats'),

  // 获取任务历史
  getHistory: (taskId) => ipcRenderer.invoke('task:get-history', taskId),

  // 获取日历数据
  getCalendar: (year, month) => ipcRenderer.invoke('task:get-calendar', year, month),

  // 获取宠物提醒消息
  getPetReminder: () => ipcRenderer.invoke('task:get-pet-reminder'),

  // 监听任务事件
  onEvent: (callback) => {
    if (typeof callback !== 'function') return;
    const existing = taskEventListenerMap.get(callback);
    if (existing) {
      ipcRenderer.off('task:event', existing);
    }
    const wrapped = (event, data) => callback(data);
    taskEventListenerMap.set(callback, wrapped);
    ipcRenderer.on('task:event', wrapped);
  },

  // 移除监听
  offEvent: (callback) => {
    const wrapped = taskEventListenerMap.get(callback);
    if (!wrapped) return;
    ipcRenderer.off('task:event', wrapped);
    taskEventListenerMap.delete(callback);
  }
});

// 小组件系统 API
contextBridge.exposeInMainWorld('PetWidget', {
  // 获取所有小组件数据
  getAll: () => ipcRenderer.invoke('widget:get-all'),

  // 刷新所有数据
  refresh: () => ipcRenderer.invoke('widget:refresh'),

  // 天气相关
  getWeather: () => ipcRenderer.invoke('widget:get-weather'),
  setWeatherLocation: (location) => ipcRenderer.invoke('widget:set-weather-location', location),

  // 日历相关
  getCalendar: () => ipcRenderer.invoke('widget:get-calendar'),

  // 待办相关
  getTodo: () => ipcRenderer.invoke('widget:get-todo'),

  // 配置相关
  getConfig: () => ipcRenderer.invoke('widget:get-config'),
  updateConfig: (config) => ipcRenderer.invoke('widget:update-config', config),
  toggle: (widgetId, enabled) => ipcRenderer.invoke('widget:toggle', widgetId, enabled)
});

// 模型路由器 API（意图 → provider+model 路由）
contextBridge.exposeInMainWorld('PetModelRouter', {
  // 根据意图获取路由配置
  getRoute: (intent, sceneConfig) =>
    ipcRenderer.invoke('modelRouter:getRoute', intent, sceneConfig),

  // 获取可用 providers 列表
  getAvailable: () =>
    ipcRenderer.invoke('modelRouter:getAvailable'),

  // 获取降级链
  getFallbackChain: (intent) =>
    ipcRenderer.invoke('modelRouter:getFallbackChain', intent)
});

// Skills 系统 API（声明式技能注册 + 执行）
contextBridge.exposeInMainWorld('PetSkills', {
  // 获取可用技能列表
  list: () => ipcRenderer.invoke('skill:list'),

  // 获取技能详细列表（包含已停用技能）
  listDetailed: () => ipcRenderer.invoke('skill:list-detailed'),

  // 获取 function calling tools 数组
  getToolsArray: () => ipcRenderer.invoke('skill:get-tools-array'),

  // 获取系统提示词片段
  getPromptSnippet: () => ipcRenderer.invoke('skill:get-prompt-snippet'),

  // 获取技能存储信息
  getStorageInfo: () => ipcRenderer.invoke('skill:get-storage-info'),

  // 获取技能文档内容
  getDocument: (name) => ipcRenderer.invoke('skill:get-document', name),

  // 获取技能执行历史
  getHistory: () => ipcRenderer.invoke('skill:get-history'),

  // 清空技能执行历史
  clearHistory: () => ipcRenderer.invoke('skill:clear-history'),

  // 获取审批记录
  getApprovalHistory: () => ipcRenderer.invoke('skill:get-approval-history'),

  // 执行技能
  execute: (name, args) => ipcRenderer.invoke('skill:execute', name, args),

  // 设置技能启停
  setEnabled: (name, enabled) => ipcRenderer.invoke('skill:set-enabled', name, enabled),

  // 创建用户自定义技能
  create: (payload) => ipcRenderer.invoke('skill:create', payload),

  // 删除用户自定义技能
  remove: (name) => ipcRenderer.invoke('skill:remove', name),

  // 保存用户技能文档
  saveDocument: (name, content) => ipcRenderer.invoke('skill:save-document', name, content),

  // 重新扫描技能目录
  reload: () => ipcRenderer.invoke('skill:reload'),

  // 响应确认
  respondConfirm: (requestId, approved) => {
    ipcRenderer.send('skill:confirm-response', { requestId, approved });
  }
});

contextBridge.exposeInMainWorld('PetMcp', {
  list: () => ipcRenderer.invoke('mcp:list'),
  getStorageInfo: () => ipcRenderer.invoke('mcp:get-storage-info'),
  create: (payload) => ipcRenderer.invoke('mcp:create', payload),
  update: (id, payload) => ipcRenderer.invoke('mcp:update', id, payload),
  setEnabled: (id, enabled) => ipcRenderer.invoke('mcp:set-enabled', id, enabled),
  remove: (id) => ipcRenderer.invoke('mcp:remove', id),
  start: (id) => ipcRenderer.invoke('mcp:start', id),
  stop: (id) => ipcRenderer.invoke('mcp:stop', id),
  restart: (id) => ipcRenderer.invoke('mcp:restart', id)
});

// 工作流系统 API（Python 工具调用）
contextBridge.exposeInMainWorld('PetWorkflow', {
  execute: (toolName, args) => ipcRenderer.invoke('workflow:execute', toolName, args),
  listTools: () => ipcRenderer.invoke('workflow:list-tools'),
  getDesktopPath: () => ipcRenderer.invoke('workflow:get-desktop-path'),
  abort: (requestId) => ipcRenderer.invoke('workflow:abort', requestId)
});

// 文件操作系统 API
contextBridge.exposeInMainWorld('PetFile', {
  // 获取文件信息
  getFileInfo: (filePath) => ipcRenderer.invoke('file:get-info', filePath),

  // 复制文件路径到剪贴板
  copyPath: (filePath) => ipcRenderer.invoke('file:copy-path', filePath),

  // 复制文件内容到剪贴板
  copyContent: (filePath) => ipcRenderer.invoke('file:copy-content', filePath),

  // 在文件夹中显示
  showInFolder: (filePath) => ipcRenderer.invoke('file:show-in-folder', filePath),

  // 移动到回收站
  moveToTrash: (filePath) => ipcRenderer.invoke('file:move-to-trash', filePath),

  // 重命名文件
  rename: (oldPath, newName) => ipcRenderer.invoke('file:rename', oldPath, newName),

  // 获取文件预览
  getPreview: (filePath) => ipcRenderer.invoke('file:get-preview', filePath),

  // 获取可用操作列表
  getAvailableActions: (filePath) => ipcRenderer.invoke('file:get-available-actions', filePath)
});
