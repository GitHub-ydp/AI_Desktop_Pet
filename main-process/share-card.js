// 分享卡片生成器
// offscreen: true 离屏渲染 + 订阅 paint 事件激活渲染管线
// CommonJS

const { BrowserWindow, clipboard, dialog, app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

class ShareCardManager {
  constructor() {
    this.pendingWindow = null;
  }

  destroyPendingWindow(reason = 'share generation superseded') {
    if (this.pendingWindow && !this.pendingWindow.isDestroyed()) {
      this.pendingWindow.__shareCardAbortReason = reason;
      this.pendingWindow.destroy();
    }
    this.pendingWindow = null;
  }

  // 生成分享卡片
  // payload: { type: 'weekly'|'milestone', data: {...} }
  // mode: 'clipboard' | 'save'
  async generate(payload, mode = 'clipboard') {
    this.destroyPendingWindow();

    return new Promise((resolve, reject) => {
      let settled = false;
      let managedDestroy = false;
      let latestFrame = null; // paint 事件收到的最新帧

      const settle = (handler) => {
        if (settled) return;
        settled = true;
        handler();
      };

      try {
        const encodedPayload = encodeURIComponent(
          JSON.stringify(payload || { type: 'weekly', data: {} })
        );

        const win = new BrowserWindow({
          width: 750,
          height: 420,
          show: false,
          frame: false,
          skipTaskbar: true,
          backgroundColor: '#04131f',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            offscreen: true  // 离屏渲染：不需要窗口可见，GPU 直接渲染到缓冲区
          }
        });

        const cleanup = () => {
          if (this.pendingWindow === win) this.pendingWindow = null;
        };

        this.pendingWindow = win;

        // 关键：订阅 paint 事件才能激活离屏渲染管线
        // 无此订阅时 Electron 不会主动绘制任何帧
        win.webContents.on('paint', (event, dirty, image) => {
          latestFrame = image;
        });

        win.on('closed', () => {
          cleanup();
          if (managedDestroy || settled) return;
          const reason = win.__shareCardAbortReason || 'window destroyed';
          settle(() => reject(new Error(reason)));
        });

        win.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
          managedDestroy = true;
          if (!win.isDestroyed()) win.destroy();
          settle(() => reject(new Error(`Page load failed: ${errorDescription || errorCode}`)));
        });

        win.webContents.once('did-finish-load', () => {
          // 等待 JS / CSS 渲染完成，paint 事件至少触发一次
          // 800ms：数字动画跑完 + 字体渲染 + 背景特效
          setTimeout(async () => {
            try {
              if (win.isDestroyed()) throw new Error('window destroyed');

              // 优先使用 paint 事件收到的最新帧（最可靠）
              // 若没收到帧则回退到 capturePage（理论上不会发生）
              let image = latestFrame;
              if (!image || image.isEmpty()) {
                console.warn('[ShareCard] No paint frame received, falling back to capturePage');
                image = await win.webContents.capturePage();
              }
              if (!image || image.isEmpty()) throw new Error('captured image is empty');

              // 离屏渲染图像尺寸跟随设备 DPI，需缩放回逻辑像素 750×420
              const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
              const finalImage = scaleFactor !== 1
                ? image.resize({ width: 750, height: 420 })
                : image;

              managedDestroy = true;
              if (!win.isDestroyed()) win.destroy();
              cleanup();

              if (mode === 'save') {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const defaultPath = path.join(
                  app.getPath('pictures'),
                  `pet-share-${timestamp}.png`
                );
                const { canceled, filePath } = await dialog.showSaveDialog(null, {
                  defaultPath,
                  filters: [{ name: 'PNG 图片', extensions: ['png'] }]
                });

                if (canceled || !filePath) {
                  settle(() => resolve({ success: false, canceled: true }));
                  return;
                }

                fs.writeFileSync(filePath, finalImage.toPNG());
                settle(() => resolve({ success: true, mode: 'save', filePath }));
                return;
              }

              clipboard.writeImage(finalImage);
              settle(() => resolve({ success: true, mode: 'clipboard' }));
            } catch (error) {
              managedDestroy = true;
              if (!win.isDestroyed()) win.destroy();
              cleanup();
              settle(() => reject(error));
            }
          }, 800);
        });

        win.loadFile(
          path.join(__dirname, '..', 'windows', 'share-card-window.html'),
          { hash: encodedPayload }
        );
      } catch (error) {
        settle(() => reject(error));
      }
    });
  }
}

module.exports = { ShareCardManager };
