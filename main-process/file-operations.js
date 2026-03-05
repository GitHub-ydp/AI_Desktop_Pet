/**
 * 文件快捷操作处理器
 * 主进程模块 - 处理文件的快捷操作
 */

const fs = require('fs');
const path = require('path');
const { shell, clipboard, dialog, app } = require('electron');

class FileOperationsManager {
  constructor() {
    this.mainWindow = null;
    this.storage = null;
    // 支持预览的文本文件扩展名
    this.textExtensions = [
      '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx',
      '.html', '.css', '.scss', '.less', '.xml', '.yaml', '.yml',
      '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
      '.go', '.rs', '.rb', '.php', '.swift', '.kt',
      '.sh', '.bat', '.ps1', '.cmd',
      '.sql', '.vue', '.svelte',
      '.log', '.ini', '.conf', '.cfg', '.env',
      '.markdown', '.rst', '.toml'
    ];
    // 支持预览的图片扩展名
    this.imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
    // 最大预览文件大小 (1MB)
    this.maxPreviewSize = 1024 * 1024;
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * 设置存储实例
   */
  setStorage(storage) {
    this.storage = storage;
  }

  /**
   * 注册 IPC 处理器
   */
  registerIPCHandlers(ipcMain) {
    // 获取文件信息
    ipcMain.handle('file:get-info', async (event, filePath) => {
      try {
        return await this.getFileInfo(filePath);
      } catch (error) {
        console.error('[FileOps] get-info error:', error);
        return { error: error.message };
      }
    });

    // 复制文件路径到剪贴板
    ipcMain.handle('file:copy-path', async (event, filePath) => {
      try {
        clipboard.writeText(filePath);
        return { success: true };
      } catch (error) {
        console.error('[FileOps] copy-path error:', error);
        return { error: error.message };
      }
    });

    // 复制文件内容到剪贴板（文本文件）
    ipcMain.handle('file:copy-content', async (event, filePath) => {
      try {
        const content = await this.readFileContent(filePath);
        if (content.error) {
          return content;
        }
        clipboard.writeText(content.text);
        return { success: true, size: content.size };
      } catch (error) {
        console.error('[FileOps] copy-content error:', error);
        return { error: error.message };
      }
    });

    // 在资源管理器中显示
    ipcMain.handle('file:show-in-folder', async (event, filePath) => {
      try {
        shell.showItemInFolder(filePath);
        return { success: true };
      } catch (error) {
        console.error('[FileOps] show-in-folder error:', error);
        return { error: error.message };
      }
    });

    // 移动到回收站
    ipcMain.handle('file:move-to-trash', async (event, filePath) => {
      try {
        // 使用 shell.trashItem (Electron 9+)
        const result = await shell.trashItem(filePath);
        return { success: true };
      } catch (error) {
        console.error('[FileOps] move-to-trash error:', error);
        return { error: error.message };
      }
    });

    // 重命名文件
    ipcMain.handle('file:rename', async (event, oldPath, newName) => {
      try {
        const dir = path.dirname(oldPath);
        const newPath = path.join(dir, newName);

        // 检查目标是否已存在
        if (fs.existsSync(newPath)) {
          return { error: '目标文件名已存在' };
        }

        fs.renameSync(oldPath, newPath);
        return { success: true, newPath };
      } catch (error) {
        console.error('[FileOps] rename error:', error);
        return { error: error.message };
      }
    });

    // 获取文件内容预览
    ipcMain.handle('file:get-preview', async (event, filePath) => {
      try {
        return await this.getFilePreview(filePath);
      } catch (error) {
        console.error('[FileOps] get-preview error:', error);
        return { error: error.message };
      }
    });

    // 获取可用操作列表（根据文件类型）
    ipcMain.handle('file:get-available-actions', async (event, filePath) => {
      try {
        return await this.getAvailableActions(filePath);
      } catch (error) {
        console.error('[FileOps] get-available-actions error:', error);
        return { error: error.message };
      }
    });

    console.log('[FileOps] IPC handlers registered');
  }

  /**
   * 获取文件基本信息
   */
  async getFileInfo(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return { error: '文件不存在' };
    }

    try {
      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const basename = path.basename(filePath);
      const dirname = path.dirname(filePath);

      return {
        path: filePath,
        name: basename,
        directory: dirname,
        extension: ext,
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        accessedAt: stats.atime,
        isTextFile: this.textExtensions.includes(ext),
        isImageFile: this.imageExtensions.includes(ext)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * 读取文件内容
   */
  async readFileContent(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return { error: '文件不存在' };
    }

    try {
      const stats = fs.statSync(filePath);

      // 检查文件大小
      if (stats.size > this.maxPreviewSize) {
        return { error: `文件太大 (${this.formatFileSize(stats.size)})，超过限制 ${this.formatFileSize(this.maxPreviewSize)}` };
      }

      // 检查是否为文本文件
      const ext = path.extname(filePath).toLowerCase();
      if (!this.textExtensions.includes(ext)) {
        return { error: '不支持此文件类型的预览' };
      }

      const buffer = fs.readFileSync(filePath);

      // 尝试检测编码
      let text;
      try {
        text = buffer.toString('utf-8');
      } catch (e) {
        return { error: '无法解析文件内容（可能不是文本文件）' };
      }

      return {
        text,
        size: stats.size,
        lines: text.split('\n').length
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * 获取文件预览
   */
  async getFilePreview(filePath) {
    const info = await this.getFileInfo(filePath);
    if (info.error) {
      return info;
    }

    // 图片文件返回 base64
    if (info.isImageFile) {
      try {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        const mimeType = this.getMimeType(info.extension);
        return {
          type: 'image',
          dataUrl: `data:${mimeType};base64,${base64}`,
          ...info
        };
      } catch (error) {
        return { error: error.message };
      }
    }

    // 文本文件返回内容
    if (info.isTextFile) {
      const content = await this.readFileContent(filePath);
      if (content.error) {
        return content;
      }
      return {
        type: 'text',
        content: content.text,
        lines: content.lines,
        ...info
      };
    }

    // 目录返回文件列表
    if (info.isDirectory) {
      try {
        const files = fs.readdirSync(filePath).slice(0, 50); // 最多50个
        return {
          type: 'directory',
          files: files.map(name => {
            const fullPath = path.join(filePath, name);
            try {
              const stat = fs.statSync(fullPath);
              return {
                name,
                isDirectory: stat.isDirectory(),
                size: stat.size
              };
            } catch {
              return { name, error: true };
            }
          }),
          ...info
        };
      } catch (error) {
        return { error: error.message };
      }
    }

    // 其他文件只返回基本信息
    return {
      type: 'binary',
      ...info
    };
  }

  /**
   * 获取可用操作列表
   */
  async getAvailableActions(filePath) {
    const info = await this.getFileInfo(filePath);
    if (info.error) {
      return [];
    }

    const actions = [
      { id: 'copy-path', label: '复制路径', icon: '📋' },
      { id: 'show-in-folder', label: '在文件夹中显示', icon: '📁' }
    ];

    if (info.isFile) {
      if (info.isTextFile) {
        actions.push({ id: 'copy-content', label: '复制内容', icon: '📄' });
        actions.push({ id: 'preview', label: '预览', icon: '👁️' });
      }
      if (info.isImageFile) {
        actions.push({ id: 'preview', label: '预览图片', icon: '🖼️' });
      }
      actions.push({ id: 'rename', label: '重命名', icon: '✏️' });
      actions.push({ id: 'move-to-trash', label: '删除到回收站', icon: '🗑️', danger: true });
    }

    if (info.isDirectory) {
      actions.push({ id: 'preview', label: '查看内容', icon: '📂' });
    }

    return actions;
  }

  /**
   * 格式化文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 获取 MIME 类型
   */
  getMimeType(ext) {
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * 通知主窗口
   */
  notifyMainWebContents(channel, data) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

// 导出单例
module.exports = new FileOperationsManager();
