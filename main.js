const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const MemoryMainProcess = require('./main-process/memory');
const { ScreenshotManager } = require('./main-process/screenshot');
const { createChatRequestId, withTimeout } = require('./src/chat-ipc-utils');
const { getBubbleWindowBoundsFromMain } = require('./src/bubble-window-utils');

// 忽略 stdout/stderr 管道断开错误（npm start 关闭终端后常见，无需弹窗提示）
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') return; });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') return; });

// 加载环境变量（从 .env 文件）
require('dotenv').config();
console.log('[Main Process] dotenv loaded');
console.log('[Main Process] DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? `FOUND (${process.env.DEEPSEEK_API_KEY.length} chars)` : 'NOT FOUND');

let mainWindow = null;
let tray = null;
let memorySystem = null;
let toolSystem = null;
let screenshotSystem = null;
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
const MENU_WINDOW_SIZE = { width: 340, height: 340 };
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
    if (bubbleWindow && bubbleWindow.isVisible()) {
      const bounds = getBubbleWindowBounds();
      bubbleWindow.setBounds(bounds, false);
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
  return getBubbleWindowBoundsFromMain(bounds, BUBBLE_WINDOW_SIZE, { x: 0, y: 8 });
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

  // 初始化截图系统
  console.log('Initializing screenshot system...');
  try {
    const userDataPath = app.getPath('userData');
    screenshotSystem = new ScreenshotManager({
      storage: memorySystem,
      dataPath: userDataPath
    });
    await screenshotSystem.initialize();
    // 注册截图 IPC 处理器
    registerScreenshotIPCHandlers(ipcMain);
    console.log('Screenshot system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize screenshot system:', error);
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

  // 注册截图快捷键
  console.log('Registering screenshot shortcuts...');
  try {
    // Ctrl+Shift+A: 快速截图
    globalShortcut.register('CommandOrControl+Shift+A', () => {
      console.log('[Screenshot] Global shortcut triggered');
      startScreenshotCapture();
    });
    console.log('✅ 截图快捷键已注册');
    console.log('   Ctrl+Shift+A: 快速截图');
  } catch (error) {
    console.error('Failed to register screenshot shortcuts:', error);
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

  // 获取主窗口位置，在旁边打开子窗口（带屏幕边界检测）
  const mainBounds = mainWindow.getBounds();
  const childW = width || 400;
  const childH = height || 500;
  const display = screen.getDisplayMatching(mainBounds);
  const workArea = display.workArea;

  // 优先在右侧，空间不够则在左侧，还不够则居中
  let childX = mainBounds.x + mainBounds.width + 20;
  if (childX + childW > workArea.x + workArea.width) {
    childX = mainBounds.x - childW - 20;
  }
  if (childX < workArea.x) {
    childX = workArea.x + Math.round((workArea.width - childW) / 2);
  }

  // Y 方向：与主窗口顶部对齐，超出底部则上移
  let childY = mainBounds.y;
  if (childY + childH > workArea.y + workArea.height) {
    childY = workArea.y + workArea.height - childH - 20;
  }
  if (childY < workArea.y) {
    childY = workArea.y;
  }

  const childWindow = new BrowserWindow({
    width: childW,
    height: childH,
    x: childX,
    y: childY,
    frame: false,
    transparent: false,
    alwaysOnTop: false,  // 子窗口不置顶
    skipTaskbar: false,
    resizable: false,
    backgroundColor: '#020810',
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
    if (bubbleWindow && bubbleWindow.isVisible()) {
      const bounds = getBubbleWindowBounds();
      bubbleWindow.setBounds(bounds, false);
    }
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

// 菜单窗口宠物状态切换 -> 主窗口
ipcMain.on('pet:state', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('pet:state', payload);
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

// 启动截图（从工具菜单触发）
ipcMain.on('start-screenshot', () => {
  console.log('[Screenshot] Start screenshot requested from tools menu');
  startScreenshotCapture();
});

// 启动全屏截图
ipcMain.on('start-fullscreen-screenshot', () => {
  console.log('[Screenshot] Fullscreen screenshot requested');
  // 暂时使用区域截图，可以扩展为真正的全屏截图
  startScreenshotCapture();
});

// 打开截图文件夹
ipcMain.on('open-screenshots-folder', () => {
  const { shell } = require('electron');
  const path = require('path');
  const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
  shell.openPath(screenshotsDir);
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

// ==================== 截图捕获函数 ====================

// 启动截图捕获（由快捷键或菜单触发）
let screenshotCaptureWindow = null;
let allDisplays = null; // 保存所有显示器信息

function startScreenshotCapture() {
  console.log('[Screenshot] Starting screenshot capture...');

  // 如果截图窗口已存在，先关闭它
  if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
    screenshotCaptureWindow.close();
    screenshotCaptureWindow = null;
  }

  // 隐藏主窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  // 获取所有显示器信息
  const { screen } = require('electron');
  allDisplays = screen.getAllDisplays();

  // 计算虚拟屏幕的总边界
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allDisplays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  console.log('[Screenshot] Virtual screen bounds:', { minX, minY, totalWidth, totalHeight });
  console.log('[Screenshot] Displays:', allDisplays.length);

  // 创建全屏透明捕获窗口（覆盖所有显示器）
  screenshotCaptureWindow = new BrowserWindow({
    width: totalWidth,
    height: totalHeight,
    x: minX,
    y: minY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 加载捕获窗口
  screenshotCaptureWindow.loadFile('windows/screenshot-capture.html');

  // 监听窗口关闭
  screenshotCaptureWindow.on('closed', () => {
    screenshotCaptureWindow = null;
  });

  // 监听选择完成事件
  ipcMain.once('screenshot:selected', async (event, bounds) => {
    console.log('[Screenshot] Region selected:', bounds);
    await handleScreenshotCapture(bounds);
  });

  // 监听取消事件
  ipcMain.once('screenshot:cancelled', () => {
    console.log('[Screenshot] Capture cancelled');
    closeScreenshotCapture();
  });
}

// 处理截图捕获
async function handleScreenshotCapture(bounds) {
  const { desktopCapturer } = require('electron');
  const { screen } = require('electron');

  try {
    console.log('[Screenshot] Selected bounds:', bounds);

    // 关闭捕获窗口
    closeScreenshotCapture();

    // 找到选择区域所在的显示器
    const selectionCenter = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };

    const targetDisplay = screen.getDisplayMatching({
      x: selectionCenter.x,
      y: selectionCenter.y,
      width: bounds.width,
      height: bounds.height
    });

    console.log('[Screenshot] Target display:', targetDisplay);

    // 获取屏幕源（设置高质量 thumbnail）
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'monitor'],
      thumbnailSize: {
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height
      }
    });

    if (sources.length === 0) {
      throw new Error('No screen sources found');
    }

    // 找到对应的屏幕源
    const source = sources.find(s => {
      const sourceId = parseInt(s.id);
      return sourceId === targetDisplay.id;
    }) || sources[0];

    console.log('[Screenshot] Using source:', source.name, 'ID:', source.id);

    const thumbnail = source.thumbnail;
    const { nativeImage } = require('electron');

    // 计算相对于目标显示器的坐标
    const relativeX = bounds.x - targetDisplay.bounds.x;
    const relativeY = bounds.y - targetDisplay.bounds.y;

    console.log('[Screenshot] Relative coordinates:', { relativeX, relativeY });
    console.log('[Screenshot] Thumbnail size:', thumbnail.getSize());
    console.log('[Screenshot] Target display size:', targetDisplay.bounds.width, targetDisplay.bounds.height);

    // 裁剪选区（现在 thumbnail 应该是全分辨率）
    const croppedImage = thumbnail.crop({
      x: Math.floor(relativeX),
      y: Math.floor(relativeY),
      width: Math.floor(bounds.width),
      height: Math.floor(bounds.height)
    });

    console.log('[Screenshot] Cropped image size:', croppedImage.getSize());

    // 保存截图
    const fs = require('fs').promises;
    const path = require('path');
    const crypto = require('crypto');

    const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });

    const filename = `screenshot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
    const filePath = path.join(screenshotsDir, filename);

    const buffer = croppedImage.toPNG();
    await fs.writeFile(filePath, buffer);

    console.log('[Screenshot] Screenshot saved:', filePath);
    console.log('[Screenshot] File size:', buffer.length, 'bytes');

    // 保存到数据库
    if (screenshotSystem) {
      const screenshotId = screenshotSystem.saveScreenshotRecord({
        filePath,
        width: bounds.width,
        height: bounds.height,
        fileSize: buffer.length,
        format: 'png',
        captureMethod: 'region'
      });

      // 打开预览窗口
      openScreenshotPreview(screenshotId, filePath);
    } else {
      console.error('[Screenshot] Screenshot system not initialized');
      showMainWindow();
    }

  } catch (error) {
    console.error('[Screenshot] Failed to capture:', error);
    showMainWindow();
  }
}

// 打开截图预览窗口
function openScreenshotPreview(screenshotId, filePath) {
  const { BrowserWindow } = require('electron');

  // 创建预览窗口
  const previewWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: false,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  previewWindow.loadFile('windows/screenshot-window.html');

  // 窗口加载完成后发送截图数据
  previewWindow.webContents.on('did-finish-load', () => {
    previewWindow.webContents.send('screenshot:load', screenshotId, filePath);
  });

  // 监听关闭请求
  ipcMain.once('close-screenshot-window', () => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.close();
    }
  });

  // 恢复主窗口
  showMainWindow();
}

// 关闭截图捕获窗口
function closeScreenshotCapture() {
  if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
    screenshotCaptureWindow.close();
    screenshotCaptureWindow = null;
  }
  showMainWindow();
}

// 显示主窗口
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

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

// ==================== 截图系统 IPC 处理器 ====================

// 注册截图 IPC 处理器
function registerScreenshotIPCHandlers(ipcMain) {
  // 获取可用的屏幕源
  ipcMain.handle('screenshot:get-sources', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const sources = await screenshotSystem.getSources();
      return { success: true, sources };
    } catch (error) {
      console.error('Failed to get screenshot sources:', error);
      return { success: false, error: error.message };
    }
  });

  // 区域截图
  ipcMain.handle('screenshot:capture-region', async (event, bounds) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // 这里需要通过 desktopCapturer 在渲染进程中捕获，然后传递过来
      // 暂时返回成功，实际捕获在渲染进程中完成
      return { success: true, message: 'Region capture initiated' };
    } catch (error) {
      console.error('Failed to capture region:', error);
      return { success: false, error: error.message };
    }
  });

  // 全屏截图
  ipcMain.handle('screenshot:capture-fullscreen', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // 类似区域截图，在渲染进程中完成实际捕获
      return { success: true, message: 'Fullscreen capture initiated' };
    } catch (error) {
      console.error('Failed to capture fullscreen:', error);
      return { success: false, error: error.message };
    }
  });

  // 复制到剪贴板
  ipcMain.handle('screenshot:copy-to-clipboard', async (event, filePath) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      await screenshotSystem.copyToClipboard(filePath);
      return { success: true };
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取截图历史
  ipcMain.handle('screenshot:get-history', async (event, options = {}) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const history = screenshotSystem.getHistory(options);
      return { success: true, history };
    } catch (error) {
      console.error('Failed to get screenshot history:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取单个截图
  ipcMain.handle('screenshot:get-by-id', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const screenshot = screenshotSystem.getScreenshotById(id);
      return { success: true, screenshot };
    } catch (error) {
      console.error('Failed to get screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // 软删除截图
  ipcMain.handle('screenshot:delete', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      screenshotSystem.deleteScreenshot(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // 永久删除截图
  ipcMain.handle('screenshot:permanently-delete', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      await screenshotSystem.permanentlyDeleteScreenshot(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to permanently delete screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // AI 分析
  ipcMain.handle('screenshot:analyze', async (event, id, prompt) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // 这里需要调用 AI API 进行分析
      // 暂时返回模拟数据
      const result = '分析结果：这是一张截图';
      const analysisId = screenshotSystem.saveAnalysis(id, 'analyze', result, {
        model: 'deepseek',
        prompt
      });
      return { success: true, analysisId, result };
    } catch (error) {
      console.error('Failed to analyze screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // OCR 识别
  ipcMain.handle('screenshot:ocr', async (event, id, lang = 'eng') => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // 这里需要调用 OCR API
      // 暂时返回模拟数据
      const result = 'OCR 识别结果';
      const analysisId = screenshotSystem.saveAnalysis(id, 'ocr', result, {
        model: 'tesseract',
        lang
      });
      return { success: true, analysisId, result };
    } catch (error) {
      console.error('Failed to perform OCR:', error);
      return { success: false, error: error.message };
    }
  });

  // 翻译
  ipcMain.handle('screenshot:translate', async (event, id, targetLang = 'zh') => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // 这里需要调用翻译 API
      // 暂时返回模拟数据
      const result = '翻译结果';
      const analysisId = screenshotSystem.saveAnalysis(id, 'translate', result, {
        model: 'deepseek',
        targetLang
      });
      return { success: true, analysisId, result };
    } catch (error) {
      console.error('Failed to translate screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取分析结果
  ipcMain.handle('screenshot:get-analyses', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const analyses = screenshotSystem.getAnalyses(id);
      return { success: true, analyses };
    } catch (error) {
      console.error('Failed to get analyses:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取统计信息
  ipcMain.handle('screenshot:get-statistics', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const stats = screenshotSystem.getStatistics();
      return { success: true, statistics: stats };
    } catch (error) {
      console.error('Failed to get statistics:', error);
      return { success: false, error: error.message };
    }
  });

  // 清理过期截图
  ipcMain.handle('screenshot:cleanup', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      await screenshotSystem.cleanupOldDeletedScreenshots();
      return { success: true };
    } catch (error) {
      console.error('Failed to cleanup screenshots:', error);
      return { success: false, error: error.message };
    }
  });
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
