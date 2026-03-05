/**
 * 文件拖拽处理器
 * 渲染进程模块 - 处理文件拖拽到宠物上的交互
 */

class FileDropHandler {
  constructor() {
    this.dropOverlay = null;
    this.fileMenu = null;
    this.currentFiles = [];
    this.isEnabled = true;
    this.menuTimeout = null;

    // 拖拽状态回调
    this.onDragEnter = null;
    this.onDragLeave = null;
    this.onFileDrop = null;
    this.onActionComplete = null;

    console.log('[FileDrop] 文件拖拽处理器已创建');
  }

  /**
   * 初始化
   */
  initialize(options = {}) {
    const petWrapper = document.getElementById('petWrapper');
    if (!petWrapper) {
      console.error('[FileDrop] 找不到 petWrapper 元素');
      return false;
    }

    this.onDragEnter = options.onDragEnter || null;
    this.onDragLeave = options.onDragLeave || null;
    this.onFileDrop = options.onFileDrop || null;
    this.onActionComplete = options.onActionComplete || null;

    // 创建拖拽遮罩层
    this.createDropOverlay();

    // 绑定拖拽事件到宠物容器
    this.bindDropEvents(petWrapper);

    // 绑定全局拖拽事件（用于显示遮罩）
    this.bindGlobalDragEvents();

    console.log('[FileDrop] 初始化完成');
    return true;
  }

  /**
   * 创建拖拽遮罩层
   */
  createDropOverlay() {
    // 检查是否已存在
    if (document.getElementById('dropOverlay')) {
      this.dropOverlay = document.getElementById('dropOverlay');
      return;
    }

    this.dropOverlay = document.createElement('div');
    this.dropOverlay.id = 'dropOverlay';
    this.dropOverlay.className = 'drop-overlay';
    this.dropOverlay.innerHTML = `
      <div class="drop-overlay-content">
        <div class="drop-icon">📁</div>
        <div class="drop-text">放开以处理文件</div>
      </div>
    `;

    // 样式
    const style = this.dropOverlay.style;
    style.position = 'fixed';
    style.top = '0';
    style.left = '0';
    style.right = '0';
    style.bottom = '0';
    style.background = 'rgba(0, 255, 240, 0.1)';
    style.border = '3px dashed #00fff0';
    style.borderRadius = '16px';
    style.display = 'none';
    style.justifyContent = 'center';
    style.alignItems = 'center';
    style.zIndex = '9999';
    style.pointerEvents = 'none';
    style.transition = 'all 0.2s ease';

    // 内容样式
    const contentStyle = this.dropOverlay.querySelector('.drop-overlay-content').style;
    contentStyle.textAlign = 'center';
    contentStyle.color = '#00fff0';

    const iconStyle = this.dropOverlay.querySelector('.drop-icon').style;
    iconStyle.fontSize = '48px';
    iconStyle.marginBottom = '10px';

    const textStyle = this.dropOverlay.querySelector('.drop-text').style;
    textStyle.fontSize = '16px';
    textStyle.fontFamily = "'Microsoft YaHei', sans-serif";

    document.body.appendChild(this.dropOverlay);
  }

  /**
   * 绑定宠物元素的拖拽事件
   */
  bindDropEvents(element) {
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });

    element.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showOverlay();
      if (this.onDragEnter) {
        this.onDragEnter();
      }
    });

    element.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 只有离开宠物区域时才隐藏
      const rect = element.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        this.hideOverlay();
        if (this.onDragLeave) {
          this.onDragLeave();
        }
      }
    });

    element.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideOverlay();

      // 获取拖拽的文件
      const files = [];
      const items = e.dataTransfer.items;

      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') {
            const file = items[i].getAsFile();
            if (file && file.path) {
              files.push(file.path);
            }
          }
        }
      }

      // 备用：从 files 获取
      if (files.length === 0 && e.dataTransfer.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i];
          if (file.path) {
            files.push(file.path);
          }
        }
      }

      if (files.length > 0) {
        console.log('[FileDrop] 文件被拖入:', files);
        this.currentFiles = files;
        await this.handleFileDrop(files);
      }
    });
  }

  /**
   * 绑定全局拖拽事件
   */
  bindGlobalDragEvents() {
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        this.hideOverlay();
      }
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.hideOverlay();
    });
  }

  /**
   * 显示拖拽遮罩
   */
  showOverlay() {
    if (this.dropOverlay && this.isEnabled) {
      this.dropOverlay.style.display = 'flex';
    }
  }

  /**
   * 隐藏拖拽遮罩
   */
  hideOverlay() {
    if (this.dropOverlay) {
      this.dropOverlay.style.display = 'none';
    }
  }

  /**
   * 处理文件拖入
   */
  async handleFileDrop(filePaths) {
    // 获取第一个文件的信息
    const firstFile = filePaths[0];

    try {
      const info = await window.PetFile.getFileInfo(firstFile);
      if (info.error) {
        console.error('[FileDrop] 获取文件信息失败:', info.error);
        if (this.onFileDrop) {
          this.onFileDrop({ error: info.error });
        }
        return;
      }

      // 显示文件操作菜单
      await this.showFileMenu(filePaths, info);
    } catch (error) {
      console.error('[FileDrop] 处理文件失败:', error);
      if (this.onFileDrop) {
        this.onFileDrop({ error: error.message });
      }
    }
  }

  /**
   * 显示文件操作菜单
   */
  async showFileMenu(filePaths, fileInfo) {
    // 移除现有菜单
    this.hideFileMenu();

    // 获取可用操作
    const actions = await window.PetFile.getAvailableActions(filePaths[0]);

    // 创建菜单
    this.fileMenu = document.createElement('div');
    this.fileMenu.className = 'file-action-menu';
    this.fileMenu.innerHTML = `
      <div class="file-menu-header">
        <span class="file-icon">${fileInfo.isDirectory ? '📁' : (fileInfo.isImageFile ? '🖼️' : '📄')}</span>
        <span class="file-name" title="${fileInfo.name}">${this.truncateFileName(fileInfo.name, 20)}</span>
        <span class="file-size">${fileInfo.sizeFormatted}</span>
      </div>
      <div class="file-menu-actions">
        ${actions.map(action => `
          <button class="file-action-btn ${action.danger ? 'danger' : ''}" data-action="${action.id}">
            <span class="action-icon">${action.icon}</span>
            <span class="action-label">${action.label}</span>
          </button>
        `).join('')}
      </div>
      ${filePaths.length > 1 ? `<div class="file-menu-footer">共 ${filePaths.length} 个文件</div>` : ''}
      <button class="file-menu-close" onclick="this.parentElement.remove()">X</button>
    `;

    // 样式
    const style = this.fileMenu.style;
    style.position = 'fixed';
    style.top = '50%';
    style.left = '50%';
    style.transform = 'translate(-50%, -50%)';
    style.background = 'rgba(2, 8, 16, 0.95)';
    style.border = '1px solid rgba(0, 255, 240, 0.3)';
    style.borderRadius = '12px';
    style.padding = '16px';
    style.minWidth = '240px';
    style.maxWidth = '320px';
    style.zIndex = '10000';
    style.boxShadow = '0 0 30px rgba(0, 255, 240, 0.2)';
    style.fontFamily = "'Microsoft YaHei', sans-serif";

    // 添加内部样式
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .file-menu-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 12px;
        margin-bottom: 12px;
        border-bottom: 1px solid rgba(0, 255, 240, 0.2);
      }
      .file-icon { font-size: 24px; }
      .file-name {
        flex: 1;
        color: #fff;
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-size {
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
      }
      .file-menu-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .file-action-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: rgba(0, 255, 240, 0.1);
        border: 1px solid rgba(0, 255, 240, 0.3);
        border-radius: 6px;
        color: #00fff0;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .file-action-btn:hover {
        background: rgba(0, 255, 240, 0.2);
        border-color: #00fff0;
      }
      .file-action-btn.danger {
        color: #ff2d78;
        border-color: rgba(255, 45, 120, 0.3);
      }
      .file-action-btn.danger:hover {
        background: rgba(255, 45, 120, 0.2);
        border-color: #ff2d78;
      }
      .action-icon { font-size: 16px; }
      .action-label { flex: 1; text-align: left; }
      .file-menu-footer {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
        text-align: center;
      }
      .file-menu-close {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        background: transparent;
        border: 1px solid rgba(255, 45, 120, 0.5);
        border-radius: 4px;
        color: #ff2d78;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .file-menu-close:hover {
        background: rgba(255, 45, 120, 0.2);
      }
    `;
    this.fileMenu.appendChild(styleEl);

    // 绑定操作按钮事件
    this.fileMenu.querySelectorAll('.file-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.executeAction(action, filePaths);
        this.hideFileMenu();
      });
    });

    document.body.appendChild(this.fileMenu);

    // 点击外部关闭
    setTimeout(() => {
      const closeHandler = (e) => {
        if (this.fileMenu && !this.fileMenu.contains(e.target)) {
          this.hideFileMenu();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);

    // 通知回调
    if (this.onFileDrop) {
      this.onFileDrop({ files: filePaths, info: fileInfo });
    }
  }

  /**
   * 隐藏文件菜单
   */
  hideFileMenu() {
    if (this.fileMenu) {
      this.fileMenu.remove();
      this.fileMenu = null;
    }
  }

  /**
   * 执行文件操作
   */
  async executeAction(action, filePaths) {
    const filePath = filePaths[0]; // 目前只处理第一个文件

    try {
      let result;
      let message;

      switch (action) {
        case 'copy-path':
          result = await window.PetFile.copyPath(filePath);
          message = result.success ? '路径已复制到剪贴板' : `复制失败: ${result.error}`;
          break;

        case 'copy-content':
          result = await window.PetFile.copyContent(filePath);
          message = result.success ? `内容已复制 (${result.size} 字节)` : `复制失败: ${result.error}`;
          break;

        case 'show-in-folder':
          result = await window.PetFile.showInFolder(filePath);
          message = result.success ? '已在文件夹中显示' : `操作失败: ${result.error}`;
          break;

        case 'move-to-trash':
          result = await window.PetFile.moveToTrash(filePath);
          message = result.success ? '已移到回收站' : `删除失败: ${result.error}`;
          break;

        case 'rename':
          // 重命名需要用户输入，暂时显示提示
          message = '重命名功能开发中...';
          break;

        case 'preview':
          const preview = await window.PetFile.getPreview(filePath);
          if (preview.error) {
            message = `预览失败: ${preview.error}`;
          } else {
            this.showPreviewModal(preview);
            message = null; // 预览窗口已显示，不需要额外提示
          }
          break;

        default:
          message = `未知操作: ${action}`;
      }

      if (message && this.onActionComplete) {
        this.onActionComplete({ action, success: !result?.error, message });
      }

    } catch (error) {
      console.error('[FileDrop] 执行操作失败:', error);
      if (this.onActionComplete) {
        this.onActionComplete({ action, success: false, message: error.message });
      }
    }
  }

  /**
   * 显示预览模态框
   */
  showPreviewModal(preview) {
    const modal = document.createElement('div');
    modal.className = 'file-preview-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10001;
    `;

    let content = '';
    if (preview.type === 'image') {
      content = `
        <div style="max-width: 80%; max-height: 80%; text-align: center;">
          <img src="${preview.dataUrl}" style="max-width: 100%; max-height: 70vh; border-radius: 8px;">
          <div style="color: #fff; margin-top: 12px; font-size: 14px;">${preview.name}</div>
        </div>
      `;
    } else if (preview.type === 'text') {
      content = `
        <div style="background: rgba(2, 8, 16, 0.95); border: 1px solid #00fff0; border-radius: 12px; padding: 20px; max-width: 80%; max-height: 80%; overflow: auto;">
          <div style="color: #00fff0; font-size: 14px; margin-bottom: 12px;">${preview.name} (${preview.lines} 行)</div>
          <pre style="color: #e0e0e0; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; max-height: 60vh; overflow: auto;">${this.escapeHtml(preview.content)}</pre>
        </div>
      `;
    } else if (preview.type === 'directory') {
      const fileList = preview.files.map(f =>
        `<div style="color: ${f.isDirectory ? '#00fff0' : '#e0e0e0'}; padding: 4px 0;">
          ${f.isDirectory ? '📁' : '📄'} ${f.name} ${f.size ? `(${this.formatSize(f.size)})` : ''}
        </div>`
      ).join('');
      content = `
        <div style="background: rgba(2, 8, 16, 0.95); border: 1px solid #00fff0; border-radius: 12px; padding: 20px; max-width: 80%; max-height: 80%; overflow: auto;">
          <div style="color: #00fff0; font-size: 14px; margin-bottom: 12px;">📁 ${preview.name}</div>
          <div style="max-height: 60vh; overflow: auto;">${fileList}</div>
        </div>
      `;
    }

    modal.innerHTML = `
      ${content}
      <button style="position: absolute; top: 20px; right: 20px; width: 36px; height: 36px; background: transparent; border: 2px solid #ff2d78; border-radius: 50%; color: #ff2d78; font-size: 18px; cursor: pointer;">X</button>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.tagName === 'BUTTON') {
        modal.remove();
      }
    });

    document.body.appendChild(modal);
  }

  /**
   * 截断文件名
   */
  truncateFileName(name, maxLen) {
    if (name.length <= maxLen) return name;
    const ext = name.slice(name.lastIndexOf('.'));
    const base = name.slice(0, name.lastIndexOf('.'));
    const truncated = base.slice(0, maxLen - ext.length - 3) + '...';
    return truncated + ext;
  }

  /**
   * 转义 HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 格式化大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.hideOverlay();
      this.hideFileMenu();
    }
  }
}

// 创建全局实例
window.FileDropHandler = new FileDropHandler();

console.log('[FileDrop] 文件拖拽处理模块已加载');
