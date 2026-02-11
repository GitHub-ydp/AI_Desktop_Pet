// main-process/tools/tools/screenshot.js
// CommonJS version - Screenshot tools

/**
 * 截图工具集合
 * 提供截图捕获、AI分析、OCR识别、翻译等功能
 */
const screenshotTools = {
  /**
   * 截图捕获
   */
  'screenshot.capture': {
    name: '截图捕获',
    description: '执行屏幕截图，支持全屏或区域截图',
    category: 'screenshot',
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['region', 'fullscreen', 'window'],
          description: '截图方式：region=区域选择, fullscreen=全屏, window=当前窗口'
        },
        bounds: {
          type: 'object',
          description: '区域截图时的边界（仅 method=region 时需要）',
          properties: {
            x: { type: 'number', description: 'X 坐标' },
            y: { type: 'number', description: 'Y 坐标' },
            width: { type: 'number', description: '宽度' },
            height: { type: 'number', description: '高度' }
          }
        }
      }
    },
    handler: async (params, context) => {
      const { screenshotSystem } = require('../main-process/screenshot');
      const { desktopCapturer } = require('electron');

      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }

      const method = params.method || 'region';

      try {
        // 获取屏幕源
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window', 'monitor']
        });

        if (sources.length === 0) {
          throw new Error('未找到可用的屏幕源');
        }

        const source = sources[0];
        const thumbnail = source.thumbnail;

        let croppedImage;
        const { nativeImage } = require('electron');

        if (method === 'fullscreen' || method === 'window') {
          // 全屏截图
          croppedImage = thumbnail;
        } else if (method === 'region' && params.bounds) {
          // 区域截图
          const bounds = params.bounds;
          const thumbnailSize = thumbnail.getSize();
          const scaleFactor = thumbnailSize.width / bounds.width;

          croppedImage = thumbnail.crop({
            x: Math.floor(bounds.x * scaleFactor),
            y: Math.floor(bounds.y * scaleFactor),
            width: Math.floor(bounds.width * scaleFactor),
            height: Math.floor(bounds.height * scaleFactor)
          }).resize({
            width: Math.floor(bounds.width),
            height: Math.floor(bounds.height)
          });
        } else {
          throw new Error('无效的截图参数');
        }

        // 保存截图
        const fs = require('fs').promises;
        const path = require('path');
        const crypto = require('crypto');
        const app = require('electron').app;

        const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
        await fs.mkdir(screenshotsDir, { recursive: true });

        const filename = `screenshot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
        const filePath = path.join(screenshotsDir, filename);

        const buffer = croppedImage.toPNG();
        await fs.writeFile(filePath, buffer);

        // 保存到数据库
        const screenshotId = screenshotSystem.saveScreenshotRecord({
          filePath,
          fileSize: buffer.length,
          width: croppedImage.getSize().width,
          height: croppedImage.getSize().height,
          format: 'png',
          captureMethod: method,
          metadata: {
            context: context || {}
          }
        });

        return {
          success: true,
          screenshot_id: screenshotId,
          file_path: filePath,
          width: croppedImage.getSize().width,
          height: croppedImage.getSize().height,
          file_size: buffer.length
        };
      } catch (error) {
        throw new Error(`截图失败: ${error.message}`);
      }
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * AI 分析截图
   */
  'screenshot.analyze': {
    name: 'AI 分析截图',
    description: '使用 AI 分析截图内容，识别主要元素、文字、颜色、布局等',
    category: 'screenshot',
    parameters: {
      type: 'object',
      properties: {
        screenshot_id: {
          type: 'string',
          description: '截图 ID（从 screenshot.capture 返回）'
        },
        prompt: {
          type: 'string',
          description: '自定义分析提示词（可选）',
          default: '请详细分析这张截图的内容，包括主要元素、文字、颜色、布局等信息'
        },
        detail_level: {
          type: 'string',
          enum: ['brief', 'normal', 'detailed'],
          description: '分析详细程度'
        }
      },
      required: ['screenshot_id']
    },
    handler: async (params, context) => {
      const { screenshotSystem } = require('../main-process/screenshot');

      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }

      const screenshot = screenshotSystem.getScreenshotById(params.screenshot_id);
      if (!screenshot) {
        throw new Error('截图不存在');
      }

      // 这里需要调用 AI API 进行分析
      // 暂时返回模拟数据
      const result = `这是一张截图，尺寸为 ${screenshot.width}x${screenshot.height}\n文件路径：${screenshot.file_path}`;

      // 保存分析结果
      const analysisId = screenshotSystem.saveAnalysis(
        params.screenshot_id,
        'analyze',
        result,
        {
          model: 'deepseek-vision',
          prompt: params.prompt,
          detailLevel: params.detail_level || 'normal'
        }
      );

      return {
        success: true,
        analysis_id: analysisId,
        screenshot_id: params.screenshot_id,
        result: result
      };
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * OCR 文字识别
   */
  'screenshot.ocr': {
    name: 'OCR 文字识别',
    description: '提取截图中的文字内容，支持多语言识别',
    category: 'screenshot',
    parameters: {
      type: 'object',
      properties: {
        screenshot_id: {
          type: 'string',
          description: '截图 ID'
        },
        language: {
          type: 'string',
          description: '识别语言（chi_sim=简体中文, eng=英文, chi_sim+eng=中英混合）',
          default: 'chi_sim+eng'
        }
      },
      required: ['screenshot_id']
    },
    handler: async (params, context) => {
      const { screenshotSystem } = require('../main-process/screenshot');

      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }

      const screenshot = screenshotSystem.getScreenshotById(params.screenshot_id);
      if (!screenshot) {
        throw new Error('截图不存在');
      }

      // 这里需要调用 OCR API（如 Tesseract.js 或云端 OCR）
      // 暂时返回模拟数据
      const result = 'OCR 识别结果：\n（此功能需要集成 OCR API）';

      // 保存分析结果
      const analysisId = screenshotSystem.saveAnalysis(
        params.screenshot_id,
        'ocr',
        result,
        {
          model: 'tesseract',
          language: params.language || 'chi_sim+eng'
        }
      );

      return {
        success: true,
        analysis_id: analysisId,
        screenshot_id: params.screenshot_id,
        result: result,
        language: params.language || 'chi_sim+eng'
      };
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * 翻译截图文字
   */
  'screenshot.translate': {
    name: '翻译截图文字',
    description: '提取并翻译截图中的文字内容',
    category: 'screenshot',
    parameters: {
      type: 'object',
      properties: {
        screenshot_id: {
          type: 'string',
          description: '截图 ID'
        },
        target_language: {
          type: 'string',
          description: '目标语言（zh=中文, en=英文, ja=日语等）',
          default: 'zh'
        },
        source_language: {
          type: 'string',
          description: '源语言（可选，不指定则自动检测）'
        }
      },
      required: ['screenshot_id']
    },
    handler: async (params, context) => {
      const { screenshotSystem } = require('../main-process/screenshot');

      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }

      const screenshot = screenshotSystem.getScreenshotById(params.screenshot_id);
      if (!screenshot) {
        throw new Error('截图不存在');
      }

      // 先进行 OCR 识别
      const ocrResult = '（OCR 识别的文字）';

      // 然后调用翻译 API
      // 暂时返回模拟数据
      const result = `翻译结果（目标语言：${params.target_language}）:\n${ocrResult}`;

      // 保存分析结果
      const analysisId = screenshotSystem.saveAnalysis(
        params.screenshot_id,
        'translate',
        result,
        {
          model: 'deepseek-translate',
          targetLanguage: params.target_language,
          sourceLanguage: params.source_language
        }
      );

      return {
        success: true,
        analysis_id: analysisId,
        screenshot_id: params.screenshot_id,
        result: result,
        source_language: params.source_language || 'auto',
        target_language: params.target_language
      };
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * 获取截图历史
   */
  'screenshot.list': {
    name: '获取截图历史',
    description: '获取截图历史记录',
    category: 'screenshot',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回数量限制',
          default: 20
        },
        offset: {
          type: 'number',
          description: '偏移量（用于分页）',
          default: 0
        }
      }
    },
    handler: async (params, context) => {
      const { screenshotSystem } = require('../main-process/screenshot');

      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }

      const history = screenshotSystem.getHistory({
        limit: params.limit || 20,
        offset: params.offset || 0
      });

      return {
        success: true,
        total: history.length,
        screenshots: history
      };
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * 删除截图
   */
  'screenshot.delete': {
    name: '删除截图',
    description: '删除指定的截图（软删除）',
    category: 'screenshot',
    parameters: {
      type: 'object',
      properties: {
        screenshot_id: {
          type: 'string',
          description: '截图 ID'
        },
        permanent: {
          type: 'boolean',
          description: '是否永久删除（默认 false）',
          default: false
        }
      },
      required: ['screenshot_id']
    },
    handler: async (params, context) => {
      const { screenshotSystem } = require('../main-process/screenshot');

      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }

      if (params.permanent) {
        await screenshotSystem.permanentlyDeleteScreenshot(params.screenshot_id);
      } else {
        screenshotSystem.deleteScreenshot(params.screenshot_id);
      }

      return {
        success: true,
        screenshot_id: params.screenshot_id,
        deleted: true,
        permanent: params.permanent || false
      };
    },
    requiresApproval: true,
    safe: true
  }
};

module.exports = { screenshotTools };
