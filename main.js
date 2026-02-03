const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const MemoryMainProcess = require('./main-process/memory');

let mainWindow = null;
let tray = null;
let memorySystem = null;

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
    console.log('Memory system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize memory system:', error);
  }

  console.log('App initialization complete');

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

// IPC 通信处理
ipcMain.handle('move-window', (event, deltaX, deltaY) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
  }
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
  return process.env.DEEPSEEK_API_KEY || '';
});

// 防止多实例运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}
