// 截图管理模块
// Screenshot Management Module
const { desktopCapturer, clipboard, nativeImage, BrowserWindow } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ScreenshotManager {
  constructor(options = {}) {
    this.storage = options.storage;
    this.dataPath = options.dataPath;
    this.screenshotsDir = path.join(this.dataPath, 'screenshots');
    this.db = null;
  }

  // 初始化截图系统
  async initialize() {
    try {
      // 确保截图目录存在
      await fs.mkdir(this.screenshotsDir, { recursive: true });

      // 初始化数据库连接
      if (this.storage && this.storage.db) {
        this.db = this.storage.db;
        console.log('[Screenshot] Initialized successfully');
      } else {
        console.error('[Screenshot] Storage not available');
      }
    } catch (error) {
      console.error('[Screenshot] Initialization failed:', error);
      throw error;
    }
  }

  // 获取可用的屏幕源
  async getSources() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window', 'monitor']
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        display_id: source.display_id
      }));
    } catch (error) {
      console.error('[Screenshot] Failed to get sources:', error);
      throw error;
    }
  }

  // 保存图片到文件
  async saveImage(image, filename) {
    try {
      const filePath = path.join(this.screenshotsDir, filename);

      // 转换为 PNG 格式
      const buffer = image.toPNG();

      // 写入文件
      await fs.writeFile(filePath, buffer);

      // 获取文件信息
      const stats = await fs.stat(filePath);

      return {
        filePath,
        fileSize: stats.size,
        width: image.getSize().width,
        height: image.getSize().height
      };
    } catch (error) {
      console.error('[Screenshot] Failed to save image:', error);
      throw error;
    }
  }

  // 复制图片到剪贴板
  async copyToClipboard(filePath) {
    try {
      const image = nativeImage.createFromPath(filePath);
      clipboard.writeImage(image);
      return true;
    } catch (error) {
      console.error('[Screenshot] Failed to copy to clipboard:', error);
      throw error;
    }
  }

  // 保存截图记录到数据库
  saveScreenshotRecord(data) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return null;
    }

    try {
      const id = data.id || this.generateId();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO screenshots (
          id, file_path, file_size, width, height, format,
          capture_method, metadata, tags, ocr_text,
          is_deleted, created_at, accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        data.filePath,
        data.fileSize || null,
        data.width || null,
        data.height || null,
        data.format || 'png',
        data.captureMethod || 'region',
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.tags || null,
        data.ocrText || null,
        data.isDeleted || 0,
        data.createdAt || now,
        data.accessedAt || null
      );

      console.log(`[Screenshot] Saved screenshot record: ${id}`);
      return id;
    } catch (error) {
      console.error('[Screenshot] Failed to save record:', error);
      throw error;
    }
  }

  // 获取截图历史记录
  getHistory(options = {}) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return [];
    }

    try {
      const {
        limit = 50,
        offset = 0,
        includeDeleted = false,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;

      const deletedFilter = includeDeleted ? '' : 'WHERE is_deleted = 0';
      const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

      const stmt = this.db.prepare(`
        SELECT * FROM screenshots
        ${deletedFilter}
        ${orderClause}
        LIMIT ? OFFSET ?
      `);

      const records = stmt.all(limit, offset);

      // 解析 JSON 字段
      return records.map(record => ({
        ...record,
        metadata: record.metadata ? JSON.parse(record.metadata) : null,
        isDeleted: Boolean(record.is_deleted)
      }));
    } catch (error) {
      console.error('[Screenshot] Failed to get history:', error);
      throw error;
    }
  }

  // 获取单个截图记录
  getScreenshotById(id) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return null;
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM screenshots WHERE id = ?');
      const record = stmt.get(id);

      if (!record) {
        return null;
      }

      // 更新访问时间
      this.db.prepare('UPDATE screenshots SET accessed_at = ? WHERE id = ?')
        .run(Date.now(), id);

      return {
        ...record,
        metadata: record.metadata ? JSON.parse(record.metadata) : null,
        isDeleted: Boolean(record.is_deleted)
      };
    } catch (error) {
      console.error('[Screenshot] Failed to get screenshot by id:', error);
      throw error;
    }
  }

  // 软删除截图
  deleteScreenshot(id) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return false;
    }

    try {
      const stmt = this.db.prepare(`
        UPDATE screenshots SET is_deleted = 1 WHERE id = ?
      `);
      stmt.run(id);
      console.log(`[Screenshot] Soft deleted screenshot: ${id}`);
      return true;
    } catch (error) {
      console.error('[Screenshot] Failed to delete screenshot:', error);
      throw error;
    }
  }

  // 永久删除截图
  async permanentlyDeleteScreenshot(id) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return false;
    }

    try {
      // 获取截图记录
      const record = this.getScreenshotById(id);
      if (!record) {
        console.warn(`[Screenshot] Screenshot not found: ${id}`);
        return false;
      }

      // 删除文件
      try {
        await fs.unlink(record.file_path);
      } catch (error) {
        console.warn(`[Screenshot] Failed to delete file: ${record.file_path}`, error.message);
      }

      // 删除数据库记录
      const stmt = this.db.prepare('DELETE FROM screenshots WHERE id = ?');
      stmt.run(id);

      // 删除关联的分析记录
      this.db.prepare('DELETE FROM screenshot_analyses WHERE screenshot_id = ?').run(id);

      console.log(`[Screenshot] Permanently deleted screenshot: ${id}`);
      return true;
    } catch (error) {
      console.error('[Screenshot] Failed to permanently delete screenshot:', error);
      throw error;
    }
  }

  // 保存分析结果
  saveAnalysis(screenshotId, type, result, options = {}) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return null;
    }

    try {
      const id = this.generateId();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO screenshot_analyses (
          id, screenshot_id, analysis_type, model, prompt,
          result, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        screenshotId,
        type,
        options.model || null,
        options.prompt || null,
        result,
        options.confidence || null,
        now
      );

      console.log(`[Screenshot] Saved analysis: ${id} (type: ${type})`);
      return id;
    } catch (error) {
      console.error('[Screenshot] Failed to save analysis:', error);
      throw error;
    }
  }

  // 获取截图的分析结果
  getAnalyses(screenshotId) {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM screenshot_analyses
        WHERE screenshot_id = ?
        ORDER BY created_at DESC
      `);

      return stmt.all(screenshotId);
    } catch (error) {
      console.error('[Screenshot] Failed to get analyses:', error);
      throw error;
    }
  }

  // 生成唯一 ID
  generateId() {
    return `screenshot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // 清理过期的已删除截图（超过 30 天）
  async cleanupOldDeletedScreenshots() {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return;
    }

    try {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      // 获取过期的已删除截图
      const stmt = this.db.prepare(`
        SELECT id, file_path FROM screenshots
        WHERE is_deleted = 1 AND created_at < ?
      `);

      const records = stmt.all(thirtyDaysAgo);

      console.log(`[Screenshot] Found ${records.length} old deleted screenshots to clean up`);

      for (const record of records) {
        await this.permanentlyDeleteScreenshot(record.id);
      }

      console.log(`[Screenshot] Cleaned up ${records.length} old deleted screenshots`);
    } catch (error) {
      console.error('[Screenshot] Failed to cleanup old screenshots:', error);
    }
  }

  // 获取统计信息
  getStatistics() {
    if (!this.db) {
      console.error('[Screenshot] Database not available');
      return null;
    }

    try {
      const total = this.db.prepare('SELECT COUNT(*) as count FROM screenshots WHERE is_deleted = 0').get();
      const deleted = this.db.prepare('SELECT COUNT(*) as count FROM screenshots WHERE is_deleted = 1').get();
      const totalSize = this.db.prepare('SELECT SUM(file_size) as size FROM screenshots WHERE is_deleted = 0').get();
      const recentWeek = this.db.prepare(`
        SELECT COUNT(*) as count FROM screenshots
        WHERE is_deleted = 0 AND created_at > ?
      `).get(Date.now() - (7 * 24 * 60 * 60 * 1000));

      return {
        total: total.count,
        deleted: deleted.count,
        totalSize: totalSize.size || 0,
        recentWeek: recentWeek.count
      };
    } catch (error) {
      console.error('[Screenshot] Failed to get statistics:', error);
      return null;
    }
  }
}

module.exports = { ScreenshotManager };
