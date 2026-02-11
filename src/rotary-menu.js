// 复古旋转电话拨号菜单控制器
// 模仿老式电话拨号盘的交互和视觉风格

class RotaryMenuController {
  constructor() {
    this.isOpen = false;
    this.menuElement = null;
    this.dialElement = null;
    this.itemElements = [];
    this.currentLevel = 1; // 当前菜单层级
    this.isMenuWindow = !!window.__MENU_WINDOW__;
    
    // 菜单配置
    this.menuItems = [
      {
        id: 'chat',
        icon: '💬',
        label: '对话',
        action: () => window.openChat && window.openChat(),
        angle: 0
      },
      {
        id: 'settings',
        icon: '⚙️',
        label: '设置',
        action: () => window.openSettings && window.openSettings(),
        angle: 60
      },
      {
        id: 'history',
        icon: '📋',
        label: '历史',
        action: () => window.openHistory && window.openHistory(),
        angle: 120
      },
      {
        id: 'theme',
        icon: '🎨',
        label: '主题',
        action: () => window.openTheme && window.openTheme(),
        angle: 180
      },
      {
        id: 'more',
        icon: '➕',
        label: '更多',
        action: () => this.toggleSecondLevel(),
        angle: 240
      },
      {
        id: 'close',
        icon: '❌',
        label: '关闭',
        action: () => this.close(),
        angle: 300
      }
    ];
    
    // 二级菜单配置
    this.secondLevelItems = [
      {
        id: 'tools',
        icon: '🔧',
        label: '工具',
        action: () => this.showToolsMenu(),
        angle: 0
      },
      {
        id: 'debug',
        icon: '🐛',
        label: '调试',
        action: () => this.openDebugConsole(),
        angle: 72
      },
      {
        id: 'about',
        icon: 'ℹ️',
        label: '关于',
        action: () => this.showAbout(),
        angle: 144
      },
      {
        id: 'hide',
        icon: '👁️',
        label: '隐藏',
        action: () => this.hideApp(),
        angle: 216
      },
      {
        id: 'back',
        icon: '◀️',
        label: '返回',
        action: () => this.toggleSecondLevel(),
        angle: 288
      }
    ];
    
    console.log('[RotaryMenu] 旋转拨号菜单控制器已创建');
  }
  
  // 初始化
  initialize() {
    // 查找或创建菜单元素
    this.menuElement = document.getElementById('rotaryMenu');
    
    if (!this.menuElement) {
      console.log('[RotaryMenu] 创建新的菜单元素');
      this.createMenuElement();
    }
    
    // 渲染菜单项
    this.renderMenuItems();
    
    console.log('[RotaryMenu] 旋转拨号菜单初始化完成');
    return true;
  }
  
  // 创建菜单DOM元素
  createMenuElement() {
    this.menuElement = document.createElement('div');
    this.menuElement.id = 'rotaryMenu';
    this.menuElement.className = 'rotary-menu';
    this.menuElement.style.display = 'none';
    
    // 创建拨号盘
    this.dialElement = document.createElement('div');
    this.dialElement.className = 'rotary-dial';
    this.menuElement.appendChild(this.dialElement);
    
    // 中心装饰（已通过CSS隐藏，不再需要创建内容）
    const centerDecoration = document.createElement('div');
    centerDecoration.className = 'dial-center';
    this.dialElement.appendChild(centerDecoration);
    
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
    if (!this.dialElement) return;
    
    const itemsToRender = items || this.menuItems;
    
    // 清除旧的菜单项（保留中心装饰）
    const oldItems = this.dialElement.querySelectorAll('.dial-item');
    oldItems.forEach(item => item.remove());
    
    this.itemElements = [];
    
    itemsToRender.forEach((item, index) => {
      const itemElement = document.createElement('div');
      itemElement.className = 'dial-item';
      itemElement.dataset.id = item.id;
      itemElement.dataset.angle = item.angle;
      itemElement.title = item.label;
      // 设置 staggered 弹入动画所需的 CSS 变量
      itemElement.style.setProperty('--item-index', index);

      // 按钮孔
      const holeElement = document.createElement('div');
      holeElement.className = 'dial-hole';
      
      // 图标
      const iconElement = document.createElement('span');
      iconElement.className = 'dial-icon';
      iconElement.textContent = item.icon;
      holeElement.appendChild(iconElement);
      
      itemElement.appendChild(holeElement);
      
      // 标签（悬停显示）
      const labelElement = document.createElement('span');
      labelElement.className = 'dial-label';
      labelElement.textContent = item.label;
      itemElement.appendChild(labelElement);
      
      // 绑定点击事件
      itemElement.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log(`[RotaryMenu] 点击: ${item.label}`);
        
        // 播放拨号音效（如果有）
        // SoundEffects.playDial(); 
        
        // 简单的点击反馈动画
        itemElement.classList.add('clicked');
        setTimeout(() => itemElement.classList.remove('clicked'), 200);
        
        if (item.action) {
          // 稍微延迟执行，让动画先播放
          setTimeout(() => item.action(), 150);
        }
      });
      
      this.dialElement.appendChild(itemElement);
      this.itemElements.push(itemElement);
    });
    
    // 计算并应用位置
    this.updateItemPositions();
  }
  
  // 更新菜单项位置
  updateItemPositions() {
    const radius = 115; // 菜单尺寸变大后，增加半径
    
    this.itemElements.forEach((element) => {
      const angle = parseFloat(element.dataset.angle);
      const radian = (angle - 90) * (Math.PI / 180); // 转换为弧度，-90度使0度指向上方
      
      const x = Math.cos(radian) * radius;
      const y = Math.sin(radian) * radius;
      
      element.style.setProperty('--item-x', `${x}px`);
      element.style.setProperty('--item-y', `${y}px`);
      element.style.transform = `translate(calc(-50% + var(--item-x)), calc(-50% + var(--item-y)))`;
    });
  }

  // 获取宠物中心点的屏幕坐标（DIP）
  getAnchorPoint() {
    const petWrapper = document.getElementById('petWrapper');
    if (!petWrapper) return null;
    const rect = petWrapper.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
    return {
      x: Math.round(window.screenX + rect.left + rect.width / 2),
      y: Math.round(window.screenY + rect.top + rect.height / 2),
      ratio: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1
    };
  }
  
  // 打开菜单
  open() {
    if (this.isOpen) return;
    
    console.log('[RotaryMenu] 打开菜单');
    this.isOpen = true;
    this.currentLevel = 1;
    this.renderMenuItems(); // 确保每次打开都重置为一级菜单

    // 仅主窗口需要扩展尺寸
    if (!this.isMenuWindow && window.electron && window.electron.resizeWindow) {
      window.electron.resizeWindow('medium');
    }
    
    if (this.menuElement) {
      this.menuElement.style.display = 'block';
      // 强制重绘以触发过渡
      this.menuElement.offsetHeight; 
      this.menuElement.classList.add('rotary-menu-open');
      
      // 拨号盘旋转入场
      this.dialElement.classList.add('spinning-in');
    }
  }
  
  // 关闭菜单
  close() {
    if (!this.isOpen) return;
    
    console.log('[RotaryMenu] 关闭菜单');
    this.isOpen = false;
    this.currentLevel = 1; // 关闭时重置层级，防止下次打开显示二级菜单

    if (this.menuElement) {
      this.menuElement.classList.remove('rotary-menu-open');
      this.dialElement.classList.remove('spinning-in');
      this.menuElement.style.display = 'none';
    }

    if (this.isMenuWindow) {
      if (window.electron && window.electron.closeMenuWindow) {
        window.electron.closeMenuWindow();
      }
      return;
    }

    // 立即缩小窗口，避免可见移动过程
    if (window.electron && window.electron.resizeWindow) {
      window.electron.resizeWindow('small');
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
    // 切换动画：先旋转出去
    this.dialElement.classList.add('spinning-out');
    this.dialElement.classList.remove('spinning-in'); // 确保移除入场类
    
    setTimeout(() => {
      // 交换菜单数据
      if (this.currentLevel === 1) {
        console.log('[RotaryMenu] 切换到二级菜单');
        this.currentLevel = 2;
        this.renderMenuItems(this.secondLevelItems);
      } else {
        console.log('[RotaryMenu] 返回一级菜单');
        this.currentLevel = 1;
        this.renderMenuItems(this.menuItems);
      }
      
      // 强制重绘以确保浏览器识别 DOM 变化
      void this.dialElement.offsetWidth;
      
      // 移除出场类，添加入场类
      this.dialElement.classList.remove('spinning-out');
      this.dialElement.classList.add('spinning-in');
      
    }, 300); // 等待出场动画完成 (0.3s)
  }
  
  // ========== 菜单项动作（复用原有逻辑） ==========
  
  showReminderMenu() {
    console.log('[RotaryMenu] 显示提醒菜单');
    this.close();
    // 打开聊天窗口，引导用户说出提醒内容
    if (window.openChat) {
      window.openChat();
    }
    // 稍微延迟显示引导气泡，等聊天窗口打开后再提示
    setTimeout(() => {
      if (window.showBubbleMessage) {
        window.showBubbleMessage('告诉我你需要提醒什么~');
      }
    }, 300);
  }

  showToolsMenu() {
    console.log('[RotaryMenu] 显示工具菜单（开发中）');
    this.close();
    if (window.showBubbleMessage) {
      window.showBubbleMessage('工具功能开发中...');
    }
  }

  openDebugConsole() {
    console.log('[RotaryMenu] 打开调试控制台');
    if (window.electron && window.electron.openDevTools) {
      window.electron.openDevTools();
    } else {
      console.log('[RotaryMenu] DevTools API 不可用');
    }
    this.close();
  }

  showAbout() {
    console.log('[RotaryMenu] 显示关于信息');
    this.close();
    if (window.showBubbleMessage) {
      window.showBubbleMessage('AI Desktop Pet - 你的 AI 桌面伙伴 ✨');
    }
  }
  
  hideApp() {
    console.log('[RotaryMenu] 隐藏应用');
    if (window.electron && window.electron.minimizeWindow) {
      window.electron.minimizeWindow();
    } else {
      console.log('[RotaryMenu] Minimize API 不可用');
    }
    this.close();
  }
}

// 创建全局实例
window.PetMenu = new RotaryMenuController(); // 使用通用的名称 PetMenu

console.log('[RotaryMenu] 旋转拨号菜单模块已加载');