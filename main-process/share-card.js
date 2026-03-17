// 分享卡片生成器
// 使用普通窗口定位到屏幕外（非离屏渲染），规避 Electron offscreen 黑帧问题
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
          alwaysOnTop: false,
          backgroundColor: '#04131f',
          paintWhenInitiallyHidden: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
          }
        });

        const cleanup = () => {
          if (this.pendingWindow === win) this.pendingWindow = null;
        };

        this.pendingWindow = win;

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
          const MAX_WAIT = 4000;
          const startTime = Date.now();

          const checkReady = setInterval(async () => {
            try {
              if (win.isDestroyed()) throw new Error('window destroyed');

              const elapsed = Date.now() - startTime;
              const timeout = elapsed >= MAX_WAIT;
              const isPageReady = await win.webContents.executeJavaScript(
                'window.__shareCardReady === true'
              ).catch(() => false);

              if (!isPageReady && !timeout) return;

              clearInterval(checkReady);

              const image = await win.webContents.capturePage();
              if (!image || image.isEmpty()) throw new Error('captured image is empty');

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
              clearInterval(checkReady);
              managedDestroy = true;
              if (!win.isDestroyed()) win.destroy();
              cleanup();
              settle(() => reject(error));
            }
          }, 100);
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
