// 截图捕获模块
// Screenshot Capture Module
const { desktopCapturer, BrowserWindow } = require('electron');

class ScreenshotCapture {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.captureWindow = null;
    this.previewWindow = null;
    this.isCapturing = false;
  }

  // 启动区域截图
  async startRegionCapture() {
    if (this.isCapturing) {
      console.log('[ScreenshotCapture] Already capturing, ignoring request');
      return;
    }

    this.isCapturing = true;

    try {
      // 隐藏主窗口
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.hide();
      }

      // 创建全屏捕获窗口
      await this.createCaptureWindow();

    } catch (error) {
      console.error('[ScreenshotCapture] Failed to start region capture:', error);
      this.isCapturing = false;

      // 恢复主窗口
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
      }
    }
  }

  // 创建全屏捕获窗口
  async createCaptureWindow() {
    // 获取主显示器尺寸
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    // 创建全屏透明窗口
    this.captureWindow = new BrowserWindow({
      width: width,
      height: height,
      x: 0,
      y: 0,
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
        contextIsolation: false,
        enableRemoteModule: false
      }
    });

    // 加载捕获窗口
    this.captureWindow.loadFile('windows/screenshot-capture.html');

    // 监听区域选择完成
    this.captureWindow.webContents.on('did-finish-load', () => {
      console.log('[ScreenshotCapture] Capture window loaded');
    });

    // 监听选择完成事件
    const ipcMain = require('electron').ipcMain;
    this.captureWindow.on('closed', () => {
      this.captureWindow = null;
    });

    // 设置一次性监听器
    ipcMain.once('screenshot:selected', async (event, bounds) => {
      await this.handleRegionSelected(bounds);
    });

    ipcMain.once('screenshot:cancelled', () => {
      this.handleCaptureCancelled();
    });
  }

  // 处理区域选择完成
  async handleRegionSelected(bounds) {
    try {
      console.log('[ScreenshotCapture] Region selected:', bounds);

      // 关闭捕获窗口
      if (this.captureWindow && !this.captureWindow.isDestroyed()) {
        this.captureWindow.close();
        this.captureWindow = null;
      }

      // 执行截图
      await this.captureScreenshot(bounds);

    } catch (error) {
      console.error('[ScreenshotCapture] Failed to handle region selection:', error);
      this.cleanup();
    }
  }

  // 处理取消截图
  handleCaptureCancelled() {
    console.log('[ScreenshotCapture] Capture cancelled');

    // 关闭捕获窗口
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.close();
      this.captureWindow = null;
    }

    // 恢复主窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
    }

    this.isCapturing = false;
  }

  // 执行截图
  async captureScreenshot(bounds) {
    try {
      // 获取屏幕源
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'monitor']
      });

      if (sources.length === 0) {
        throw new Error('No screen sources found');
      }

      // 使用第一个屏幕源（主显示器）
      const source = sources[0];
      const thumbnail = source.thumbnail;

      // 获取缩略图尺寸
      const thumbnailSize = thumbnail.getSize();
      const scaleFactor = thumbnailSize.width / bounds.width;

      // 裁剪选区
      const { nativeImage } = require('electron');
      const croppedImage = thumbnail.crop({
        x: Math.floor(bounds.x * scaleFactor),
        y: Math.floor(bounds.y * scaleFactor),
        width: Math.floor(bounds.width * scaleFactor),
        height: Math.floor(bounds.height * scaleFactor)
      });

      // 调整到实际尺寸
      const scaledImage = croppedImage.resize({
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height)
      });

      // 保存截图
      const fs = require('fs').promises;
      const path = require('path');
      const app = require('electron').app;
      const crypto = require('crypto');

      const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
      await fs.mkdir(screenshotsDir, { recursive: true });

      const filename = `screenshot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
      const filePath = path.join(screenshotsDir, filename);

      // 保存到文件
      const buffer = scaledImage.toPNG();
      await fs.writeFile(filePath, buffer);

      console.log('[ScreenshotCapture] Screenshot saved:', filePath);

      // 保存到数据库（需要通过 IPC 调用主进程）
      const ipcMain = require('electron').ipcMain;
      ipcMain.emit('screenshot:save-to-db', {
        filePath,
        width: bounds.width,
        height: bounds.height,
        fileSize: buffer.length,
        format: 'png',
        captureMethod: 'region'
      });

      // 打开预览窗口
      this.openPreviewWindow(filePath);

    } catch (error) {
      console.error('[ScreenshotCapture] Failed to capture screenshot:', error);
      this.cleanup();
    }
  }

  // 打开预览窗口
  openPreviewWindow(filePath) {
    try {
      // 如果预览窗口已存在，关闭它
      if (this.previewWindow && !this.previewWindow.isDestroyed()) {
        this.previewWindow.close();
      }

      // 创建预览窗口
      this.previewWindow = new BrowserWindow({
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
          enableRemoteModule: false
        }
      });

      // 加载预览窗口
      this.previewWindow.loadFile('windows/screenshot-window.html');

      // 窗口加载完成后发送截图数据
      this.previewWindow.webContents.on('did-finish-load', () => {
        // 这里需要截图 ID，暂时使用文件路径作为 ID
        const screenshotId = path.basename(filePath, '.png');
        this.previewWindow.webContents.send('screenshot:load', screenshotId, filePath);
      });

      // 监听窗口关闭
      this.previewWindow.on('closed', () => {
        this.previewWindow = null;
      });

      // 监听关闭预览窗口请求
      const ipcMain = require('electron').ipcMain;
      ipcMain.once('close-screenshot-window', () => {
        if (this.previewWindow && !this.previewWindow.isDestroyed()) {
          this.previewWindow.close();
        }
      });

      // 恢复主窗口
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
      }

      this.isCapturing = false;

    } catch (error) {
      console.error('[ScreenshotCapture] Failed to open preview window:', error);
      this.cleanup();
    }
  }

  // 清理资源
  cleanup() {
    // 关闭捕获窗口
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.close();
      this.captureWindow = null;
    }

    // 关闭预览窗口
    if (this.previewWindow && !this.previewWindow.isDestroyed()) {
      this.previewWindow.close();
      this.previewWindow = null;
    }

    // 恢复主窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
    }

    this.isCapturing = false;
  }
}

// 导出为 Node.js 模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ScreenshotCapture };
}
