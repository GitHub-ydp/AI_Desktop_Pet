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
        angle: 72
      },
      {
        id: 'history',
        icon: '📋',
        label: '历史',
        action: () => window.openHistory && window.openHistory(),
        angle: 144
      },
      {
        id: 'more',
        icon: '➕',
        label: '更多',
        action: () => this.toggleSecondLevel(),
        angle: 216
      },
      {
        id: 'close',
        icon: '❌',
        label: '关闭',
        action: () => this.close(),
        angle: 288
      }
    ];
    
    // 二级菜单配置
    this.secondLevelItems = [
      {
        id: 'states',
        icon: '🎭',
        label: '状态',
        action: () => this.showStateMenu(true),
        angle: 0
      },
      {
        id: 'theme',
        icon: '🎨',
        label: '主题',
        action: () => window.openSettings && window.openSettings(),
        angle: 72
      },
      {
        id: 'health',
        icon: '❤️',
        label: '健康',
        action: () => window.openHealthSettings && window.openHealthSettings(),
        angle: 144
      },
      {
        id: 'tasks',
        icon: '✅',
        label: '任务',
        action: () => window.openTasks && window.openTasks(),
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

    // 三级菜单：宠物状态选择（动态构建，基于当前皮肤的可用 Lottie 动画）
    // 状态名 → 显示信息的映射
    this.stateDisplayMap = {
      idle:       { icon: '😌', label: '待机' },
      happy:      { icon: '😆', label: '开心' },
      sleeping:   { icon: '😴', label: '睡觉' },
      exercising: { icon: '💪', label: '锻炼' },
      playing:    { icon: '🧹', label: '玩耍' },
      thinking:   { icon: '🤔', label: '思考' },
      talking:    { icon: '💬', label: '聊天' },
      clicked:    { icon: '👆', label: '点击' },
      sad:        { icon: '😢', label: '伤心' },
      dragging:   { icon: '✋', label: '拖拽' }
    };
    this.stateMenuItems = []; // 将由 buildStateMenuItems() 动态填充

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

    // 创建浮动 tooltip（挂在 rotary-menu 上，不受 dial 的 clip-path 裁切）
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'dial-tooltip';
    this.menuElement.appendChild(this.tooltipElement);

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
      // 不设置 title，避免系统原生 tooltip
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

      // 悬停显示浮动 tooltip（不再创建 dial-label 子元素）
      itemElement.addEventListener('mouseenter', () => {
        this.showTooltip(item.label, parseFloat(item.angle));
      });
      itemElement.addEventListener('mouseleave', () => {
        this.hideTooltip();
      });

      // 绑定点击事件
      itemElement.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log(`[RotaryMenu] 点击: ${item.label}`);

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

    // 仅主窗口需要扩展尺寸，传入 anchor 使窗口以宠物为中心扩展，避免位置跳动
    if (!this.isMenuWindow && window.electron && window.electron.resizeWindow) {
      const anchor = this.getAnchorPoint();
      window.electron.resizeWindow('medium', anchor);
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

    // 立即缩小窗口，传入 anchor 使窗口以宠物为中心收缩，避免位置闪烁
    if (window.electron && window.electron.resizeWindow) {
      const anchor = this.getAnchorPoint();
      window.electron.resizeWindow('small', anchor);
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
        // 从二级或三级都回到一级
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
  
  // 显示浮动 tooltip（挂在 rotary-menu 上，不受 clip-path 裁切）
  showTooltip(label, angleDeg) {
    if (!this.tooltipElement) return;
    const tooltip = this.tooltipElement;
    tooltip.textContent = label;

    // 根据菜单项角度，将 tooltip 推到圆环外侧
    const tooltipRadius = 160; // 比菜单项半径 (115) 更远
    const radian = (angleDeg - 90) * (Math.PI / 180);
    const cx = this.menuElement.offsetWidth / 2;
    const cy = this.menuElement.offsetHeight / 2;
    const tx = cx + Math.cos(radian) * tooltipRadius;
    const ty = cy + Math.sin(radian) * tooltipRadius;

    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
    tooltip.classList.add('dial-tooltip-visible');
  }

  // 隐藏浮动 tooltip
  hideTooltip() {
    if (!this.tooltipElement) return;
    this.tooltipElement.classList.remove('dial-tooltip-visible');
  }

  // ========== 状态选择菜单（三级菜单） ==========

  // 动态构建状态菜单（基于当前皮肤的动画配置，不依赖运行时 hasLottie 标志）
  buildStateMenuItems() {
    const items = [];
    const petEmoji = (window.PetAnimations && window.PetAnimations.baseExpression) || '🐱';

    let statesToShow = [];

    // 优先按目录 JSON 文件名动态生成状态（名称与数量完全同步）
    if (window.electron && typeof window.electron.listLottieJsonFiles === 'function') {
      const files = window.electron.listLottieJsonFiles('cat') || [];
      statesToShow = files
        .filter(name => typeof name === 'string' && name.toLowerCase().endsWith('.json'))
        .map(name => name.replace(/\.json$/i, '').trim())
        .filter(Boolean);
      statesToShow = Array.from(new Set(statesToShow));
      if (statesToShow.length > 0) {
        console.log(`[RotaryMenu] 按目录动态加载状态: ${statesToShow.join(', ')}`);
      }
    }

    // 无 Lottie 配置时，降级为通用 emoji 状态列表
    if (statesToShow.length === 0) {
      console.log('[RotaryMenu] 无 Lottie 配置，使用通用状态列表');
      statesToShow = ['idle', 'happy', 'sleeping', 'thinking', 'sad'];
    }

    const totalItems = statesToShow.length + 1;
    const angleStep = 360 / totalItems;

    statesToShow.forEach((state, index) => {
      const display = this.stateDisplayMap[state] || { icon: '🎬', label: state };
      items.push({
        id: `state-${state}`,
        icon: display.icon,
        label: display.label,
        state: state,
        action: () => this.applyPetState(state),
        angle: index * angleStep
      });
    });

    // 返回按钮
    items.push({
      id: 'state-back',
      icon: '◀️',
      label: '返回',
      action: () => this.showStateMenu(false),
      angle: statesToShow.length * angleStep
    });

    return items;
  }

  // 显示/隐藏状态选择菜单
  showStateMenu(entering) {
    this.dialElement.classList.add('spinning-out');
    this.dialElement.classList.remove('spinning-in');

    setTimeout(() => {
      if (entering) {
        console.log('[RotaryMenu] 进入状态选择菜单');
        this.currentLevel = 3;
        // 动态构建状态菜单
        this.stateMenuItems = this.buildStateMenuItems();
        this.renderMenuItems(this.stateMenuItems);
        // 高亮当前激活状态
        this.highlightActiveState();
      } else {
        console.log('[RotaryMenu] 返回二级菜单');
        this.currentLevel = 2;
        this.renderMenuItems(this.secondLevelItems);
      }

      void this.dialElement.offsetWidth;
      this.dialElement.classList.remove('spinning-out');
      this.dialElement.classList.add('spinning-in');
    }, 300);
  }

  // 高亮当前激活状态
  highlightActiveState() {
    const currentState = window.PetAnimations
      ? window.PetAnimations.currentState
      : 'idle';

    this.itemElements.forEach(el => {
      el.classList.remove('dial-item-active');
      if (el.dataset.id === `state-${currentState}`) {
        el.classList.add('dial-item-active');
      }
    });
  }

  // 应用宠物状态（使用手动锁定，加载对应 Lottie 动画）
  applyPetState(state) {
    console.log(`[RotaryMenu] 手动切换宠物状态: ${state}`);

    if (this.isMenuWindow) {
      // 菜单独立窗口：通过 IPC 通知主窗口切换状态
      if (window.electron && window.electron.sendPetState) {
        window.electron.sendPetState({ state });
      }
    } else if (window.PetAnimations) {
      // 主窗口内联菜单：直接调用
      if (state === 'idle') {
        window.PetAnimations.unlockManualState();
      } else {
        window.PetAnimations.setManualState(state);
      }
    }

    this.close();

    const stateMessages = {
      idle: '回到待机状态~',
      happy: '开心起来了！',
      sleeping: 'Zzz...',
      exercising: '锻炼身体！💪',
      playing: '骑着扫帚飞~🧹',
      thinking: '让我想想...',
      sad: '有点难过...'
    };
    const msg = stateMessages[state] || `切换到 ${state}~`;

    // 菜单窗口通过气泡 IPC 显示消息，主窗口直接调用
    if (this.isMenuWindow) {
      if (window.electron && window.electron.showBubble) {
        window.electron.showBubble(msg, 2000);
      }
    } else if (window.showBubbleMessage) {
      window.showBubbleMessage(msg);
    }
  }

}

// 创建全局实例
window.PetMenu = new RotaryMenuController(); // 使用通用的名称 PetMenu

console.log('[RotaryMenu] 旋转拨号菜单模块已加载');
