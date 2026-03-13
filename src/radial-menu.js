// 径向菜单控制器
// 支持扇形展开、多级菜单、动态配置

class RadialMenuController {
  constructor() {
    this.isOpen = false;
    this.menuElement = null;
    this.itemElements = [];
    this.currentLevel = 1; // 当前菜单层级
    
    // 菜单配置
    this.menuItems = [
      {
        id: 'chat',
        icon: 'chat',
        label: '对话',
        action: () => window.openChat && window.openChat(),
        angle: 0
      },
      {
        id: 'settings',
        icon: 'settings',
        label: '设置',
        action: () => window.openSettings && window.openSettings(),
        angle: 60
      },
      {
        id: 'history',
        icon: 'history',
        label: '历史',
        action: () => window.openHistory && window.openHistory(),
        angle: 120
      },
      {
        id: 'reminder',
        icon: 'reminder',
        label: '提醒',
        action: () => this.showReminderMenu(),
        angle: 180
      },
      {
        id: 'more',
        icon: 'more',
        label: '更多',
        action: () => this.toggleSecondLevel(),
        angle: 240
      },
      {
        id: 'close',
        icon: 'close',
        label: '关闭',
        action: () => this.close(),
        angle: 300
      }
    ];
    
    // 二级菜单配置
    this.secondLevelItems = [
      {
        id: 'screenshot',
        icon: 'screenshot',
        label: '截图',
        action: () => this.startScreenshot(),
        angle: 0
      },
      {
        id: 'tools',
        icon: 'tools',
        label: '工具',
        action: () => this.showToolsMenu(),
        angle: 72
      },
      {
        id: 'debug',
        icon: 'debug',
        label: '调试',
        action: () => this.openDebugConsole(),
        angle: 144
      },
      {
        id: 'hide',
        icon: 'hide',
        label: '隐藏',
        action: () => this.hideApp(),
        angle: 216
      },
      {
        id: 'back',
        icon: 'back',
        label: '返回',
        action: () => this.toggleSecondLevel(),
        angle: 288
      }
    ];
    
    console.log('[RadialMenu] 径向菜单控制器已创建');
  }
  
  // 初始化
  initialize() {
    // 查找或创建菜单元素
    this.menuElement = document.getElementById('radialMenu');
    
    if (!this.menuElement) {
      console.log('[RadialMenu] 创建新的菜单元素');
      this.createMenuElement();
    }
    
    // 渲染菜单项
    this.renderMenuItems();
    
    console.log('[RadialMenu] 径向菜单初始化完成');
    return true;
  }
  
  // 创建菜单DOM元素
  createMenuElement() {
    this.menuElement = document.createElement('div');
    this.menuElement.id = 'radialMenu';
    this.menuElement.className = 'radial-menu';
    this.menuElement.style.display = 'none';
    
    // 添加到宠物容器附近
    const petWrapper = document.getElementById('petWrapper');
    if (petWrapper && petWrapper.parentNode) {
      petWrapper.parentNode.insertBefore(this.menuElement, petWrapper.nextSibling);
    } else {
      document.body.appendChild(this.menuElement);
    }
  }
  
  // 渲染菜单项
  renderMenuItems(items = null) {
    if (!this.menuElement) return;
    
    const itemsToRender = items || this.menuItems;
    this.menuElement.innerHTML = '';
    this.itemElements = [];
    
    itemsToRender.forEach((item, index) => {
      const itemElement = document.createElement('div');
      itemElement.className = 'radial-menu-item';
      itemElement.dataset.id = item.id;
      itemElement.dataset.angle = item.angle;
      itemElement.title = item.label;
      
      // 设置图标
      const iconElement = document.createElement('span');
      iconElement.className = 'menu-icon';
      iconElement.innerHTML = window.SVGIcons && window.SVGIcons[item.icon] ? window.SVGIcons[item.icon] : (window.SVGIcons && window.SVGIcons.default ? window.SVGIcons.default : item.icon);
      itemElement.appendChild(iconElement);
      
      // 设置工具提示
      const tooltipElement = document.createElement('span');
      tooltipElement.className = 'menu-tooltip';
      tooltipElement.textContent = item.label;
      itemElement.appendChild(tooltipElement);
      
      // 绑定点击事件
      itemElement.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log(`[RadialMenu] 点击: ${item.label}`);
        if (item.action) {
          item.action();
        }
      });
      
      this.menuElement.appendChild(itemElement);
      this.itemElements.push(itemElement);
    });
    
    // 计算并应用位置
    this.updateItemPositions();
  }
  
  // 更新菜单项位置
  updateItemPositions() {
    const radius = 90; // 菜单半径（像素）
    
    this.itemElements.forEach((element) => {
      const angle = parseFloat(element.dataset.angle);
      const radian = (angle - 90) * (Math.PI / 180); // 转换为弧度，-90度使0度指向上方
      
      const x = Math.cos(radian) * radius;
      const y = Math.sin(radian) * radius;
      
      element.style.setProperty('--menu-x', `${x}px`);
      element.style.setProperty('--menu-y', `${y}px`);
      element.style.transform = `translate(calc(-50% + var(--menu-x)), calc(-50% + var(--menu-y)))`;
    });
  }
  
  // 打开菜单
  open() {
    if (this.isOpen) return;
    
    console.log('[RadialMenu] 打开菜单');
    this.isOpen = true;
    this.currentLevel = 1;
    this.renderMenuItems(); // 确保每次打开都重置为一级菜单

    if (this.menuElement) {
      this.menuElement.style.display = 'block';
      this.menuElement.classList.add('radial-menu-open');
      
      // 优化入场动画延迟：更自然的交错效果（30ms 间隔）
      this.itemElements.forEach((element, index) => {
        element.style.animationDelay = `${index * 0.03}s`;
      });
    }
  }
  
  // 关闭菜单
  close() {
    if (!this.isOpen) return;
    
    console.log('[RadialMenu] 关闭菜单');
    this.isOpen = false;
    
    if (this.menuElement) {
      this.menuElement.classList.remove('radial-menu-open');
      
      // 延迟隐藏，等待动画完成
      setTimeout(() => {
        if (!this.isOpen && this.menuElement) {
          this.menuElement.style.display = 'none';
        }
      }, 300);
    }
  }
  
  // 切换菜单
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  // 切换二级菜单
  toggleSecondLevel() {
    if (this.currentLevel === 1) {
      console.log('[RadialMenu] 切换到二级菜单');
      this.currentLevel = 2;
      this.renderMenuItems(this.secondLevelItems);
    } else {
      console.log('[RadialMenu] 返回一级菜单');
      this.currentLevel = 1;
      this.renderMenuItems(this.menuItems);
    }
  }
  
  // ========== 菜单项动作 ==========
  
  showReminderMenu() {
    console.log('[RadialMenu] 显示提醒菜单（待实现）');
    alert('提醒功能开发中...');
    this.close();
  }
  
  showToolsMenu() {
    console.log('[RadialMenu] 显示工具菜单');
    this.close();

    // 创建工具选择子窗口
    if (window.electron && window.electron.createChildWindow) {
      window.electron.createChildWindow({
        id: 'tools-menu',
        title: '工具菜单',
        width: 300,
        height: 400,
        html: 'windows/tools-menu.html'
      });
    }
  }
  
  openDebugConsole() {
    console.log('[RadialMenu] 打开调试控制台');
    if (window.electron && window.electron.openDevTools) {
      window.electron.openDevTools();
    } else {
      console.log('[RadialMenu] DevTools API 不可用');
    }
    this.close();
  }
  
  showAbout() {
    console.log('[RadialMenu] 显示关于信息');
    alert('AI Desktop Pet v1.0\n\n一个可爱的桌面AI宠物\n使用 DeepSeek API');
    this.close();
  }
  
  hideApp() {
    console.log('[RadialMenu] 隐藏应用');
    if (window.electron && window.electron.minimizeWindow) {
      window.electron.minimizeWindow();
    } else {
      console.log('[RadialMenu] Minimize API 不可用');
    }
    this.close();
  }

  // 启动截图功能
  startScreenshot() {
    console.log('[RadialMenu] 启动截图');
    this.close();

    // 通过主进程启动截图
    if (window.electron && window.electron.createChildWindow) {
      // 发送 IPC 消息到主进程
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('start-screenshot');
    } else {
      console.error('[RadialMenu] electron API 不可用');
      alert('截图功能启动失败');
    }
  }
  
  // 添加自定义菜单项
  addMenuItem(item) {
    this.menuItems.push(item);
    if (this.isOpen && this.currentLevel === 1) {
      this.renderMenuItems();
    }
  }
  
  // 移除菜单项
  removeMenuItem(id) {
    this.menuItems = this.menuItems.filter(item => item.id !== id);
    if (this.isOpen && this.currentLevel === 1) {
      this.renderMenuItems();
    }
  }
}

// 创建全局实例
window.RadialMenu = new RadialMenuController();

console.log('[RadialMenu] 径向菜单模块已加载');
