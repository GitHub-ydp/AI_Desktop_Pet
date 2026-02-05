// 线性胶囊菜单控制器
// 替换原有的径向菜单，提供更流畅的水平展开体验

class LinearMenuController {
  constructor() {
    this.isOpen = false;
    this.menuElement = null;
    this.itemElements = [];
    this.currentLevel = 1; // 当前菜单层级
    
    // 菜单配置（保持原有功能）
    this.menuItems = [
      {
        id: 'chat',
        icon: '💬',
        label: '对话',
        action: () => window.openChat && window.openChat()
      },
      {
        id: 'settings',
        icon: '⚙️',
        label: '设置',
        action: () => window.openSettings && window.openSettings()
      },
      {
        id: 'history',
        icon: '📜',
        label: '历史',
        action: () => window.openHistory && window.openHistory()
      },
      {
        id: 'reminder',
        icon: '⏰',
        label: '提醒',
        action: () => this.showReminderMenu()
      },
      {
        id: 'more',
        icon: '➕',
        label: '更多',
        action: () => this.toggleSecondLevel()
      },
      {
        id: 'close',
        icon: '❌',
        label: '关闭',
        action: () => this.close()
      }
    ];
    
    // 二级菜单配置
    this.secondLevelItems = [
      {
        id: 'tools',
        icon: '🔧',
        label: '工具',
        action: () => this.showToolsMenu()
      },
      {
        id: 'debug',
        icon: '🐛',
        label: '调试',
        action: () => this.openDebugConsole()
      },
      {
        id: 'about',
        icon: 'ℹ️',
        label: '关于',
        action: () => this.showAbout()
      },
      {
        id: 'hide',
        icon: '👁️',
        label: '隐藏',
        action: () => this.hideApp()
      },
      {
        id: 'back',
        icon: '◀️',
        label: '返回',
        action: () => this.toggleSecondLevel()
      }
    ];
    
    console.log('[LinearMenu] 线性菜单控制器已创建');
  }
  
  // 初始化
  initialize() {
    // 查找或创建菜单元素
    this.menuElement = document.getElementById('linearMenu');
    
    if (!this.menuElement) {
      console.log('[LinearMenu] 创建新的菜单元素');
      this.createMenuElement();
    }
    
    // 渲染菜单项
    this.renderMenuItems();
    
    console.log('[LinearMenu] 线性菜单初始化完成');
    return true;
  }
  
  // 创建菜单DOM元素
  createMenuElement() {
    this.menuElement = document.createElement('div');
    this.menuElement.id = 'linearMenu';
    this.menuElement.className = 'linear-menu';
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
      itemElement.className = 'linear-menu-item';
      itemElement.dataset.id = item.id;
      itemElement.title = item.label;
      // 设置动画延迟
      itemElement.style.animationDelay = `${index * 0.05}s`;
      
      // 设置图标
      const iconElement = document.createElement('span');
      iconElement.className = 'menu-icon';
      iconElement.textContent = item.icon;
      itemElement.appendChild(iconElement);
      
      // 设置工具提示
      const tooltipElement = document.createElement('span');
      tooltipElement.className = 'menu-tooltip';
      tooltipElement.textContent = item.label;
      itemElement.appendChild(tooltipElement);
      
      // 绑定点击事件
      itemElement.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log(`[LinearMenu] 点击: ${item.label}`);
        if (item.action) {
          item.action();
        }
      });
      
      this.menuElement.appendChild(itemElement);
      this.itemElements.push(itemElement);
    });
  }
  
  // 打开菜单
  open() {
    if (this.isOpen) return;
    
    console.log('[LinearMenu] 打开菜单');
    this.isOpen = true;
    this.currentLevel = 1;
    
    if (this.menuElement) {
      this.menuElement.style.display = 'flex';
      // 强制重绘以触发动画
      this.menuElement.offsetHeight;
      this.menuElement.classList.add('linear-menu-open');
    }
  }
  
  // 关闭菜单
  close() {
    if (!this.isOpen) return;
    
    console.log('[LinearMenu] 关闭菜单');
    this.isOpen = false;
    
    if (this.menuElement) {
      this.menuElement.classList.remove('linear-menu-open');
      
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
    // 菜单项退出动画
    const items = this.menuElement.querySelectorAll('.linear-menu-item');
    items.forEach(item => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(10px)';
    });
    
    setTimeout(() => {
      if (this.currentLevel === 1) {
        console.log('[LinearMenu] 切换到二级菜单');
        this.currentLevel = 2;
        this.renderMenuItems(this.secondLevelItems);
      } else {
        console.log('[LinearMenu] 返回一级菜单');
        this.currentLevel = 1;
        this.renderMenuItems(this.menuItems);
      }
    }, 200);
  }
  
  // ========== 菜单项动作 (复用原有逻辑) ==========
  
  showReminderMenu() {
    console.log('[LinearMenu] 显示提醒菜单（待实现）');
    // alert('提醒功能开发中...');
    if (window.PetReminder) {
      // TODO: 显示提醒列表或创建界面
      window.openChat && window.openChat();
      // 可以预填提醒指令
      setTimeout(() => {
        const input = document.getElementById('chatInput');
        if (input) input.value = '提醒我';
      }, 100);
    }
    this.close();
  }
  
  showToolsMenu() {
    console.log('[LinearMenu] 显示工具菜单');
    // alert('工具功能开发中...');
    this.close();
  }
  
  openDebugConsole() {
    console.log('[LinearMenu] 打开调试控制台');
    if (window.electron && window.electron.openDevTools) {
      window.electron.openDevTools();
    } else {
      console.log('[LinearMenu] DevTools API 不可用');
    }
    this.close();
  }
  
  showAbout() {
    console.log('[LinearMenu] 显示关于信息');
    alert('AI Desktop Pet v1.0\n\n一个可爱的桌面AI宠物\n使用 DeepSeek API');
    this.close();
  }
  
  hideApp() {
    console.log('[LinearMenu] 隐藏应用');
    if (window.electron && window.electron.minimizeWindow) {
      window.electron.minimizeWindow();
    } else {
      console.log('[LinearMenu] Minimize API 不可用');
    }
    this.close();
  }
}

// 创建全局实例
window.PetMenu = new LinearMenuController();

console.log('[LinearMenu] 线性菜单模块已加载');