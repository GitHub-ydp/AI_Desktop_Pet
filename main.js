const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const MemoryMainProcess = require('./main-process/memory');
const { createChatRequestId, withTimeout } = require('./src/chat-ipc-utils');
const { getBubbleWindowBoundsFromMain } = require('./src/bubble-window-utils');

// 加载环境变量（从 .env 文件）
require('dotenv').config();
console.log('[Main Process] dotenv loaded');
console.log('[Main Process] DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? `FOUND (${process.env.DEEPSEEK_API_KEY.length} chars)` : 'NOT FOUND');

let mainWindow = null;
let tray = null;
let memorySystem = null;
let toolSystem = null;
let childWindows = new Map(); // 管理所有子窗口
let lastSmallBounds = null; // 记录小窗口位置，避免缩放漂移
let menuWindow = null;
let bubbleWindow = null;
const pendingChatRequests = new Map();

// 窗口尺寸常量
const WINDOW_SIZES = {
  small: { width: 150, height: 150 },  // 只显示宠物
  medium: { width: 300, height: 300 }   // 显示菜单时
};
const MENU_WINDOW_SIZE = { width: 300, height: 300 };
const BUBBLE_WINDOW_SIZE = { width: 260, height: 110 };

// 创建主窗口（只显示宠物本体）
function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_SIZES.small.width,   // 默认小尺寸
    height: WINDOW_SIZES.small.height,
    x: 100,
    y: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  lastSmallBounds = { x: 100, y: 100, width: WINDOW_SIZES.small.width, height: WINDOW_SIZES.small.height };

  // 监听渲染进程错误
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.once('ready-to-show', () => {
    // 确保窗口可见
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    console.log('Window shown and focused');
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('move', () => {
    if (menuWindow && menuWindow.isVisible()) {
      const bounds = getMenuWindowBounds();
      menuWindow.setBounds(bounds, false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getMenuWindowBounds() {
  if (!mainWindow) {
    return { x: 100, y: 100, width: MENU_WINDOW_SIZE.width, height: MENU_WINDOW_SIZE.height };
  }
  const bounds = mainWindow.getBounds();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: Math.round(centerX - MENU_WINDOW_SIZE.width / 2),
    y: Math.round(centerY - MENU_WINDOW_SIZE.height / 2 + 10),
    width: MENU_WINDOW_SIZE.width,
    height: MENU_WINDOW_SIZE.height
  };
}

function createMenuWindow() {
  menuWindow = new BrowserWindow({
    width: MENU_WINDOW_SIZE.width,
    height: MENU_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  menuWindow.loadFile('windows/menu-window.html');

  menuWindow.on('blur', () => {
    closeMenuWindow();
  });

  menuWindow.on('closed', () => {
    menuWindow = null;
  });
}

function getBubbleWindowBounds() {
  if (!mainWindow) {
    return { x: 0, y: 0, width: BUBBLE_WINDOW_SIZE.width, height: BUBBLE_WINDOW_SIZE.height };
  }
  const bounds = mainWindow.getBounds();
  return getBubbleWindowBoundsFromMain(bounds, BUBBLE_WINDOW_SIZE, { x: 0, y: -60 });
}

function createBubbleWindow() {
  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WINDOW_SIZE.width,
    height: BUBBLE_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  bubbleWindow.loadFile('windows/bubble-window.html');
  bubbleWindow.setIgnoreMouseEvents(true, { forward: true });

  bubbleWindow.on('closed', () => {
    bubbleWindow = null;
  });
}

function showBubbleWindow(message, duration) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    createBubbleWindow();
  }
  const bounds = getBubbleWindowBounds();
  bubbleWindow.setBounds(bounds, false);
  bubbleWindow.showInactive();
  bubbleWindow.webContents.send('bubble:show', { message, duration });
}

function hideBubbleWindow() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  bubbleWindow.hide();
}

function openMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed()) {
    createMenuWindow();
  }
  const bounds = getMenuWindowBounds();
  menuWindow.setBounds(bounds, false);
  menuWindow.show();
  menuWindow.focus();
  menuWindow.webContents.send('menu:command', { type: 'open' });
}

function closeMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed()) return;
  menuWindow.webContents.send('menu:command', { type: 'close' });
  menuWindow.hide();
}

function toggleMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed() || !menuWindow.isVisible()) {
    openMenuWindow();
    return true;
  }
  closeMenuWindow();
  return false;
}

// 记录显示器信息到数据库
function recordDisplayProfiles(reason = 'unknown') {
  if (!screen) return;
  if (!memorySystem || typeof memorySystem.saveDisplayProfiles !== 'function') {
    console.log('[Display] Memory system not ready, skip recording');
    return;
  }

  const displays = screen.getAllDisplays();
  const activeDisplay = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const activeId = activeDisplay ? String(activeDisplay.id) : null;

  const profiles = displays.map(display => ({
    displayId: String(display.id),
    label: display.label || null,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
    bounds: display.bounds,
    workArea: display.workArea,
    size: display.size,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation || 0,
    internal: display.internal ? 1 : 0,
    touchSupport: display.touchSupport || 'unknown',
    monochrome: display.monochrome ? 1 : 0,
    dpi: Number.isFinite(display.scaleFactor) ? Math.round(display.scaleFactor * 96) : null,
    sizeMm: null,
    reason
  }));

  try {
    memorySystem.saveDisplayProfiles(profiles, activeId);
    console.log(`[Display] Profiles recorded (${profiles.length}) reason=${reason}`);
  } catch (error) {
    console.error('[Display] Failed to record profiles:', error.message);
  }
}

// 创建系统托盘
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    tray = new Tray(iconPath);
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示宠物',
      click: () => {
        if (mainWindow) mainWindow.show();
      }
    },
    {
      label: '隐藏宠物',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AI Desktop Pet');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

// 设置开机自启
function setAutoLaunch() {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false,
    name: 'AI Desktop Pet'
  });
}

// 应用启动
app.whenReady().then(async () => {
  console.log('App is ready, creating window...');
  createWindow();
  console.log('Creating tray...');
  createTray();
  console.log('Setting auto launch...');
  setAutoLaunch();

  // 初始化记忆系统
  console.log('Initializing memory system...');
  try {
    memorySystem = new MemoryMainProcess({
      apiKey: process.env.DEEPSEEK_API_KEY || ''
    });
    await memorySystem.initialize();
    // 注册 IPC handlers
    memorySystem.registerIPCHandlers(ipcMain);
    // 设置主窗口用于提醒通知
    memorySystem.setMainWindow(mainWindow);
    console.log('Memory system initialized successfully');
    recordDisplayProfiles('startup');
  } catch (error) {
    console.error('Failed to initialize memory system:', error);
  }

  // 初始化工具系统
  console.log('Initializing tool system...');
  try {
    const { initializeTools, getToolSystem } = await import('./main-process/tools/index.js');
    await initializeTools();
    toolSystem = getToolSystem();
    console.log('Tool system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize tool system:', error);
  }

  // 注册开发者工具快捷键
  console.log('Registering developer tools shortcuts...');
  try {
    // Ctrl+Shift+I: 打开/关闭开发者工具
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
    });

    // Ctrl+R: 刷新页面
    globalShortcut.register('CommandOrControl+R', () => {
      if (mainWindow) {
        mainWindow.webContents.reload();
      }
    });

    console.log('✅ 开发者工具快捷键已注册');
    console.log('   Ctrl+Shift+I: 打开/关闭开发者工具');
    console.log('   Ctrl+R: 刷新页面');
  } catch (error) {
    console.error('Failed to register shortcuts:', error);
  }

  console.log('App initialization complete');

  // 监听显示器变化并记录
  if (screen) {
    screen.on('display-added', () => recordDisplayProfiles('display-added'));
    screen.on('display-removed', () => recordDisplayProfiles('display-removed'));
    screen.on('display-metrics-changed', () => recordDisplayProfiles('display-metrics-changed'));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 在 Windows 和 Linux 上，不要在窗口关闭时退出应用
  // 因为我们有系统托盘图标
  if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  // 关闭记忆系统
  if (memorySystem) {
    memorySystem.close();
  }
});

// 创建子窗口（用于聊天、设置、历史等）
function createChildWindow(options) {
  const { id, title, width, height, html } = options;
  
  // 如果窗口已存在，聚焦并返回
  if (childWindows.has(id)) {
    const existingWindow = childWindows.get(id);
    if (!existingWindow.isDestroyed()) {
      existingWindow.focus();
      return existingWindow;
    }
    childWindows.delete(id);
  }

  // 获取主窗口位置，在旁边打开子窗口
  const mainBounds = mainWindow.getBounds();
  const childWindow = new BrowserWindow({
    width: width || 400,
    height: height || 500,
    x: mainBounds.x + mainBounds.width + 20,
    y: mainBounds.y,
    frame: false,
    transparent: false,
    alwaysOnTop: false,  // 子窗口不置顶
    skipTaskbar: false,
    resizable: false,
    backgroundColor: '#ffffff',
    parent: mainWindow,  // 设置父窗口
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 加载HTML内容
  childWindow.loadFile(html);

  // 窗口关闭时从Map中移除
  childWindow.on('closed', () => {
    childWindows.delete(id);
  });

  childWindows.set(id, childWindow);
  return childWindow;
}

// IPC 通信处理
ipcMain.handle('move-window', (event, deltaX, deltaY) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
    if (lastSmallBounds) {
      lastSmallBounds = {
        ...lastSmallBounds,
        x: lastSmallBounds.x + deltaX,
        y: lastSmallBounds.y + deltaY
      };
    } else {
      const bounds = mainWindow.getBounds();
      lastSmallBounds = {
        x: bounds.x,
        y: bounds.y,
        width: WINDOW_SIZES.small.width,
        height: WINDOW_SIZES.small.height
      };
    }
  }
});

// 动态调整窗口大小
ipcMain.handle('resize-window', (event, size, anchor) => {
  if (mainWindow) {
    const targetSize = WINDOW_SIZES[size] || WINDOW_SIZES.small;
    let nextBounds = null;

    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      let normalizedAnchor = { x: anchor.x, y: anchor.y };
      const display = screen ? screen.getDisplayMatching({
        x: anchor.x,
        y: anchor.y,
        width: 1,
        height: 1
      }) : null;
      if (display && Number.isFinite(display.scaleFactor)) {
        const ratio = Number.isFinite(anchor.ratio) ? anchor.ratio : display.scaleFactor;
        if (ratio > 0) {
          const scale = display.scaleFactor / ratio;
          normalizedAnchor = {
            x: anchor.x * scale,
            y: anchor.y * scale
          };
        }
      }
      const newX = Math.round(normalizedAnchor.x - targetSize.width / 2);
      const newY = Math.round(normalizedAnchor.y - targetSize.height / 2);
      nextBounds = {
        x: newX,
        y: newY,
        width: targetSize.width,
        height: targetSize.height
      };
    } else if (size === 'medium') {
      const base = mainWindow.getBounds();
      lastSmallBounds = {
        x: base.x,
        y: base.y,
        width: WINDOW_SIZES.small.width,
        height: WINDOW_SIZES.small.height
      };
      const centerX = base.x + base.width / 2;
      const centerY = base.y + base.height / 2;
      const newX = Math.round(centerX - targetSize.width / 2);
      const newY = Math.round(centerY - targetSize.height / 2);
      nextBounds = {
        x: newX,
        y: newY,
        width: targetSize.width,
        height: targetSize.height
      };
    } else {
      if (lastSmallBounds) {
        nextBounds = {
          x: lastSmallBounds.x,
          y: lastSmallBounds.y,
          width: targetSize.width,
          height: targetSize.height
        };
      } else {
        const bounds = mainWindow.getBounds();
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const newX = Math.round(centerX - targetSize.width / 2);
        const newY = Math.round(centerY - targetSize.height / 2);
        nextBounds = {
          x: newX,
          y: newY,
          width: targetSize.width,
          height: targetSize.height
        };
      }
      lastSmallBounds = { ...nextBounds };
    }

    mainWindow.setBounds(nextBounds, false);
    console.log(`[Main Process] Window resized to ${size}: ${nextBounds.width}x${nextBounds.height} at (${nextBounds.x}, ${nextBounds.y})`);
  }
});

// 菜单窗口控制
ipcMain.handle('menu:open', () => {
  openMenuWindow();
  return { isOpen: true };
});

ipcMain.handle('menu:close', () => {
  closeMenuWindow();
  return { isOpen: false };
});

ipcMain.handle('menu:toggle', () => {
  const isOpen = toggleMenuWindow();
  return { isOpen };
});

ipcMain.handle('menu:is-open', () => {
  return !!(menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible());
});

// 气泡窗口控制
ipcMain.handle('bubble:show', (event, message, duration) => {
  showBubbleWindow(message, duration);
  return { success: true };
});

ipcMain.handle('bubble:hide', () => {
  hideBubbleWindow();
  return { success: true };
});

// 聊天 IPC
ipcMain.handle('chat:send', async (event, message) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: '主窗口不可用' };
  }
  const requestId = createChatRequestId();
  const responsePromise = new Promise((resolve) => {
    pendingChatRequests.set(requestId, resolve);
  });
  mainWindow.webContents.send('chat:send', { requestId, message });
  return withTimeout(responsePromise, 30000, () => {
    pendingChatRequests.delete(requestId);
    return { success: false, error: '聊天超时' };
  });
});

ipcMain.on('chat:response', (event, requestId, payload) => {
  if (!pendingChatRequests.has(requestId)) return;
  const resolve = pendingChatRequests.get(requestId);
  pendingChatRequests.delete(requestId);
  resolve(payload);
});

// 设置窗口通知 -> 主窗口
ipcMain.on('settings:change', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('settings:change', payload);
});

// 创建子窗口
ipcMain.handle('create-child-window', (event, options) => {
  try {
    createChildWindow(options);
    return { success: true };
  } catch (error) {
    console.error('Failed to create child window:', error);
    return { success: false, error: error.message };
  }
});

// 关闭子窗口
ipcMain.handle('close-child-window', (event, id) => {
  if (childWindows.has(id)) {
    const window = childWindows.get(id);
    if (!window.isDestroyed()) {
      window.close();
    }
    childWindows.delete(id);
  }
  return { success: true };
});

// 向子窗口发送数据
ipcMain.handle('send-to-child-window', (event, id, channel, data) => {
  if (childWindows.has(id)) {
    const window = childWindows.get(id);
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
      return { success: true };
    }
  }
  return { success: false };
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 安全地获取 API 密钥（从环境变量）
ipcMain.handle('get-api-key', () => {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  console.log('[Main Process] get-api-key called:', apiKey ? `API Key found (${apiKey.length} chars)` : 'NO API KEY FOUND');
  return apiKey;
});

// 打开开发者工具
ipcMain.handle('open-devtools', () => {
  if (mainWindow) {
    mainWindow.webContents.toggleDevTools();
    console.log('[Main Process] DevTools 已切换');
  }
});

// ==================== 工具系统 IPC 处理器 ====================

// 执行工具
ipcMain.handle('tool:execute', async (event, toolName, params, context = {}) => {
  try {
    if (!toolSystem) {
      throw new Error('工具系统未初始化');
    }

    // 添加会话信息到上下文
    const enhancedContext = {
      ...context,
      sessionId: context.sessionId || generateSessionId(),
      personality: context.personality || 'healing'
    };

    const result = await toolSystem.execute(toolName, params, enhancedContext);
    return { success: true, result };
  } catch (error) {
    console.error('Tool execution error:', error);
    return { success: false, error: error.message };
  }
});

// 列出所有工具
ipcMain.handle('tool:list', async () => {
  try {
    if (!toolSystem) {
      return [];
    }
    return toolSystem.listTools();
  } catch (error) {
    console.error('Tool list error:', error);
    return [];
  }
});

// 获取工具执行历史
ipcMain.handle('tool:get-history', async (event, options = {}) => {
  try {
    if (!toolSystem) {
      return [];
    }
    return toolSystem.getHistory(options);
  } catch (error) {
    console.error('Tool history error:', error);
    return [];
  }
});

// 清空工具执行历史
ipcMain.handle('tool:clear-history', async () => {
  try {
    if (!toolSystem) {
      return { success: false };
    }
    toolSystem.clearHistory();
    return { success: true };
  } catch (error) {
    console.error('Tool clear history error:', error);
    return { success: false, error: error.message };
  }
});

// 生成会话 ID
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// 防止多实例运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main Process] Failed to get single instance lock, quitting...');
  app.quit();
} else {
  console.log('[Main Process] Got single instance lock');
  app.on('second-instance', () => {
    console.log('[Main Process] Second instance detected, focusing main window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}
