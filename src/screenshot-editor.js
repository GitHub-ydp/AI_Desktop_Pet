// 截图编辑预览模块
// Screenshot Editor Module

class ScreenshotEditor {
  constructor() {
    this.currentScreenshot = null;
    this.previewWindow = null;
    this.init();
  }

  // 初始化
  init() {
    // 监听快速截图事件
    if (window.PetScreenshot && window.PetScreenshot.onQuickCapture) {
      window.PetScreenshot.onQuickCapture(() => {
        this.handleQuickCapture();
      });
    }
  }

  // 处理快速截图
  async handleQuickCapture() {
    console.log('[ScreenshotEditor] Quick capture triggered');

    try {
      // 通知主进程开始截图
      // 这里需要通过 IPC 与主进程通信
      // 暂时使用 window.electron
      if (window.electron && window.electron.createChildWindow) {
        // 实际截图逻辑在主进程的 ScreenshotCapture 中处理
        console.log('[ScreenshotEditor] Quick capture event sent');
      }
    } catch (error) {
      console.error('[ScreenshotEditor] Failed to handle quick capture:', error);
    }
  }

  // 加载截图
  loadScreenshot(screenshotId, filePath) {
    this.currentScreenshot = {
      id: screenshotId,
      filePath: filePath
    };

    console.log('[ScreenshotEditor] Screenshot loaded:', screenshotId);
  }

  // 复制到剪贴板
  async copyToClipboard() {
    if (!this.currentScreenshot) {
      console.warn('[ScreenshotEditor] No screenshot to copy');
      return false;
    }

    try {
      const result = await window.PetScreenshot.copyToClipboard(this.currentScreenshot.filePath);
      console.log('[ScreenshotEditor] Copied to clipboard:', result.success);
      return result.success;
    } catch (error) {
      console.error('[ScreenshotEditor] Failed to copy to clipboard:', error);
      return false;
    }
  }

  // 保存到文件
  async saveToFile() {
    if (!this.currentScreenshot) {
      console.warn('[ScreenshotEditor] No screenshot to save');
      return false;
    }

    try {
      // 文件已经保存，显示路径
      console.log('[ScreenshotEditor] Screenshot already saved to:', this.currentScreenshot.filePath);
      return true;
    } catch (error) {
      console.error('[ScreenshotEditor] Failed to save screenshot:', error);
      return false;
    }
  }

  // AI 分析
  async analyzeWithAI() {
    if (!this.currentScreenshot) {
      console.warn('[ScreenshotEditor] No screenshot to analyze');
      return null;
    }

    try {
      const result = await window.PetScreenshot.analyze(
        this.currentScreenshot.id,
        '请详细分析这张截图的内容，包括主要元素、颜色、布局等信息'
      );

      console.log('[ScreenshotEditor] AI analysis completed:', result.success);
      return result;
    } catch (error) {
      console.error('[ScreenshotEditor] Failed to analyze with AI:', error);
      return null;
    }
  }

  // OCR 识别
  async performOCR() {
    if (!this.currentScreenshot) {
      console.warn('[ScreenshotEditor] No screenshot to perform OCR');
      return null;
    }

    try {
      const result = await window.PetScreenshot.ocr(
        this.currentScreenshot.id,
        'chi_sim+eng' // 中英文混合
      );

      console.log('[ScreenshotEditor] OCR completed:', result.success);
      return result;
    } catch (error) {
      console.error('[ScreenshotEditor] Failed to perform OCR:', error);
      return null;
    }
  }

  // 翻译文字
  async translateText() {
    if (!this.currentScreenshot) {
      console.warn('[ScreenshotEditor] No screenshot to translate');
      return null;
    }

    try {
      const result = await window.PetScreenshot.translate(
        this.currentScreenshot.id,
        'zh' // 翻译为中文
      );

      console.log('[ScreenshotEditor] Translation completed:', result.success);
      return result;
    } catch (error) {
      console.error('[ScreenshotEditor] Failed to translate:', error);
      return null;
    }
  }

  // 显示分析结果
  showAnalysisResult(title, content) {
    console.log('[ScreenshotEditor] Analysis result:', title, content);
    // 在预览窗口中显示
    if (this.previewWindow) {
      // 发送结果到预览窗口
    }
  }

  // 显示通知
  showNotification(message, type = 'info') {
    console.log(`[ScreenshotEditor] Notification (${type}):`, message);
    // 可以使用自定义通知组件
  }

  // 设置预览窗口引用
  setPreviewWindow(window) {
    this.previewWindow = window;
  }
}

// 导出为全局对象
if (typeof window !== 'undefined') {
  window.ScreenshotEditor = ScreenshotEditor;
}

// 导出为 Node.js 模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ScreenshotEditor };
}
