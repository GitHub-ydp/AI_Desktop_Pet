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

const { desktopCapturer, nativeImage, dialog, shell } = require('electron');
const fs = require('fs').promises;
const crypto = require('crypto');

let screenshotCaptureWindow = null;
const pinWindows = new Map(); // 管理贴图窗口，最多 5 个
const MAX_PIN_WINDOWS = 5;

// 启动截图捕获（由快捷键或菜单触发）
// 新流程：先全屏截图获取 dataURL → 发送给覆盖窗口显示为背景
async function startScreenshotCapture() {
  console.log('[Screenshot] Starting screenshot capture...');

  // 如果截图窗口已存在，先关闭它
  if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
    screenshotCaptureWindow.close();
    screenshotCaptureWindow = null;
  }

  // 隐藏主窗口和所有子窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.hide();
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.hide();
  }

  // 等待窗口完全隐藏
  await new Promise(resolve => setTimeout(resolve, 150));

  // 获取所有显示器信息
  const displays = screen.getAllDisplays();

  // 计算虚拟屏幕的总边界（DIP 坐标）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  console.log('[Screenshot] Virtual screen bounds:', { minX, minY, totalWidth, totalHeight });
  console.log('[Screenshot] Displays:', displays.length);

  // 创建全屏透明覆盖窗口（安全模式）
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
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  screenshotCaptureWindow.loadFile('windows/screenshot-capture.html');

  screenshotCaptureWindow.on('closed', () => {
    screenshotCaptureWindow = null;
  });
}

// 获取全屏截图（主进程在此完成 desktopCapturer 调用）
// 返回每个显示器的 dataURL + 显示器信息，供覆盖窗口作为静态背景
async function getScreenCapture() {
  const displays = screen.getAllDisplays();
  const displayCaptures = [];

  for (const display of displays) {
    // 使用物理像素尺寸获取高质量截图
    const physicalWidth = Math.round(display.bounds.width * display.scaleFactor);
    const physicalHeight = Math.round(display.bounds.height * display.scaleFactor);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: physicalWidth,
        height: physicalHeight
      }
    });

    // 使用 display_id 匹配正确的屏幕源
    const source = sources.find(s =>
      s.display_id === String(display.id)
    ) || sources[0];

    if (source) {
      displayCaptures.push({
        displayId: String(display.id),
        dataURL: source.thumbnail.toDataURL(),
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        physicalWidth,
        physicalHeight
      });
    }
  }

  return {
    displays: displayCaptures,
    virtualBounds: {
      x: Math.min(...displays.map(d => d.bounds.x)),
      y: Math.min(...displays.map(d => d.bounds.y)),
      width: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)) - Math.min(...displays.map(d => d.bounds.x)),
      height: Math.max(...displays.map(d => d.bounds.y + d.bounds.height)) - Math.min(...displays.map(d => d.bounds.y))
    }
  };
}

// 创建贴图窗口（截图固定到桌面）
function createPinWindow(imageDataURL, bounds) {
  // 限制最大贴图窗口数量
  if (pinWindows.size >= MAX_PIN_WINDOWS) {
    // 关闭最早的贴图窗口
    const oldestKey = pinWindows.keys().next().value;
    const oldestWin = pinWindows.get(oldestKey);
    if (oldestWin && !oldestWin.isDestroyed()) {
      oldestWin.close();
    }
    pinWindows.delete(oldestKey);
  }

  const pinId = `pin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const pinWin = new BrowserWindow({
    width: Math.max(bounds.width || 300, 100),
    height: Math.max(bounds.height || 200, 100),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  pinWin.loadFile('windows/pin-window.html');

  pinWin.webContents.on('did-finish-load', () => {
    pinWin.webContents.send('pin:load', imageDataURL);
  });

  pinWin.on('closed', () => {
    pinWindows.delete(pinId);
  });

  pinWindows.set(pinId, pinWin);
  console.log(`[Screenshot] Pin window created: ${pinId} (total: ${pinWindows.size})`);
  return pinId;
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
function registerScreenshotIPCHandlers(ipc) {

  // ---- 新版截图流程 IPC（ScreenshotBridge 使用） ----

  // 获取全屏截图 dataURL + 显示器信息（覆盖窗口加载后调用）
  ipc.handle('screenshot:get-screen-capture', async () => {
    try {
      const data = await getScreenCapture();
      return { success: true, ...data };
    } catch (error) {
      console.error('[Screenshot] Failed to get screen capture:', error);
      return { success: false, error: error.message };
    }
  });

  // 区域选择完成（由覆盖窗口通过 ScreenshotBridge.selectRegion 调用）
  ipc.handle('screenshot:region-selected', async (event, bounds) => {
    try {
      // 输入校验
      if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number'
          || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
        throw new Error('Invalid bounds format');
      }
      if (bounds.width < 1 || bounds.height < 1
          || bounds.width > 10000 || bounds.height > 10000) {
        throw new Error('Bounds out of range');
      }

      console.log('[Screenshot] Region selected:', bounds);
      // 关闭覆盖窗口（不恢复主窗口，因为操作还在继续）
      if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
        screenshotCaptureWindow.close();
        screenshotCaptureWindow = null;
      }
      showMainWindow();
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Region selection failed:', error);
      return { success: false, error: error.message };
    }
  });

  // 取消截图
  ipc.handle('screenshot:capture-cancel', async () => {
    console.log('[Screenshot] Capture cancelled');
    closeScreenshotCapture();
    return { success: true };
  });

  // 从 dataURL 复制图片到剪贴板（无需文件路径）
  ipc.handle('screenshot:copy-data', async (event, dataURL) => {
    try {
      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }
      screenshotSystem.copyDataToClipboard(dataURL);
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Failed to copy data to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // 快速保存到 userData/screenshots/
  ipc.handle('screenshot:save-quick', async (event, dataURL) => {
    try {
      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }
      const result = await screenshotSystem.saveFromDataURL(dataURL);

      // 保存数据库记录
      const screenshotId = screenshotSystem.saveScreenshotRecord({
        filePath: result.filePath,
        fileSize: result.fileSize,
        width: result.width,
        height: result.height,
        format: 'png',
        captureMethod: 'region'
      });

      return { success: true, filePath: result.filePath, screenshotId };
    } catch (error) {
      console.error('[Screenshot] Failed to quick save:', error);
      return { success: false, error: error.message };
    }
  });

  // 另存为（弹出系统文件选择对话框）
  ipc.handle('screenshot:save-as', async (event, dataURL) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '保存截图',
        defaultPath: `screenshot_${Date.now()}.png`,
        filters: [
          { name: 'PNG 图片', extensions: ['png'] },
          { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }
        ]
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      const image = nativeImage.createFromDataURL(dataURL);
      const ext = path.extname(result.filePath).toLowerCase();
      const buffer = (ext === '.jpg' || ext === '.jpeg')
        ? image.toJPEG(90)
        : image.toPNG();

      await fs.writeFile(result.filePath, buffer);
      console.log(`[Screenshot] Saved as: ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      console.error('[Screenshot] Failed to save as:', error);
      return { success: false, error: error.message };
    }
  });

  // 贴图到桌面（创建置顶小窗口）
  ipc.handle('screenshot:pin', async (event, dataURL, bounds) => {
    try {
      const pinId = createPinWindow(dataURL, bounds || { width: 300, height: 200 });
      return { success: true, windowId: pinId };
    } catch (error) {
      console.error('[Screenshot] Failed to create pin window:', error);
      return { success: false, error: error.message };
    }
  });

  // AI 分析截图（暂用 DeepSeek API 文字分析）
  // TODO: 接入视觉模型后替换为真正的图像分析
  ipc.handle('screenshot:analyze-image', async (event, dataURL, prompt) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'API 密钥未配置' };
      }

      // TODO: 当 DeepSeek 支持视觉输入时，直接发送 base64 图片
      // 目前仅返回提示信息
      const result = '暂不支持图像分析。请等待视觉模型接入后使用此功能。';
      return { success: true, result };
    } catch (error) {
      console.error('[Screenshot] Failed to analyze image:', error);
      return { success: false, error: error.message };
    }
  });

  // OCR 文字识别（预留接口）
  // TODO: 接入 tesseract.js 后实现
  ipc.handle('screenshot:ocr-image', async (event, dataURL) => {
    try {
      return {
        success: false,
        error: 'OCR 功能需要安装 tesseract.js。请运行 npm install tesseract.js 后使用。'
      };
    } catch (error) {
      console.error('[Screenshot] Failed to perform OCR:', error);
      return { success: false, error: error.message };
    }
  });

  // 贴图窗口：设置透明度（发送者即贴图窗口本身）
  ipc.handle('pin:set-opacity', (event, opacity) => {
    try {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin && !senderWin.isDestroyed()) {
        const clamped = Math.max(0.3, Math.min(1.0, Number(opacity)));
        senderWin.setOpacity(clamped);
      }
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Failed to set pin opacity:', error);
      return { success: false, error: error.message };
    }
  });

  // 贴图窗口：关闭自身
  ipc.handle('pin:close', (event) => {
    try {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin && !senderWin.isDestroyed()) {
        senderWin.close();
      }
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Failed to close pin window:', error);
      return { success: false, error: error.message };
    }
  });

  // ---- 旧版 PetScreenshot API 兼容 IPC ----

  // 获取可用的屏幕源
  ipc.handle('screenshot:get-sources', async () => {
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
  ipc.handle('screenshot:capture-region', async (event, bounds) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      return { success: true, message: 'Region capture initiated' };
    } catch (error) {
      console.error('Failed to capture region:', error);
      return { success: false, error: error.message };
    }
  });

  // 全屏截图
  ipc.handle('screenshot:capture-fullscreen', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      return { success: true, message: 'Fullscreen capture initiated' };
    } catch (error) {
      console.error('Failed to capture fullscreen:', error);
      return { success: false, error: error.message };
    }
  });

  // 从文件路径复制到剪贴板（带路径校验）
  ipc.handle('screenshot:copy-to-clipboard', async (event, filePath) => {
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

  // 获取截图历史（sortBy/sortOrder 白名单校验在 ScreenshotManager 中完成）
  ipc.handle('screenshot:get-history', async (event, options = {}) => {
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
  ipc.handle('screenshot:get-by-id', async (event, id) => {
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
  ipc.handle('screenshot:delete', async (event, id) => {
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
  ipc.handle('screenshot:permanently-delete', async (event, id) => {
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

  // AI 分析（旧接口 - 按 ID）
  ipc.handle('screenshot:analyze', async (event, id, prompt) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // TODO: 接入实际 AI 分析
      const result = '暂不支持图像分析，请等待视觉模型接入。';
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

  // OCR 识别（旧接口 - 按 ID）
  ipc.handle('screenshot:ocr', async (event, id, lang = 'eng') => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // TODO: 接入 tesseract.js
      const result = 'OCR 功能待安装 tesseract.js 后可用';
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
  ipc.handle('screenshot:translate', async (event, id, targetLang = 'zh') => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      // TODO: 接入实际翻译 API
      const result = '翻译功能待接入';
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
  ipc.handle('screenshot:get-analyses', async (event, id) => {
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
  ipc.handle('screenshot:get-statistics', async () => {
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
  ipc.handle('screenshot:cleanup', async () => {
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
