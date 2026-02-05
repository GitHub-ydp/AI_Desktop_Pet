// 宠物动画状态机
// 管理宠物的各种动画状态和过渡

class PetAnimationController {
  constructor() {
    // 所有可用的动画状态
    this.states = ['idle', 'happy', 'thinking', 'sleeping', 'dragging', 'clicked', 'talking', 'sad'];
    
    // 当前状态
    this.currentState = 'idle';
    
    // 上一个状态（用于恢复）
    this.previousState = 'idle';
    
    // 宠物元素
    this.petWrapper = null;
    this.petEmoji = null;
    this.decorationLayer = null;
    
    // 状态持续时间计时器
    this.stateTimer = null;
    
    // 动画队列（用于链式动画）
    this.animationQueue = [];
    this.isPlayingQueue = false;
    
    // 表情映射系统（根据宠物类型和心情）
    this.expressionMaps = {
      '🐱': {
        happy: '😺',
        normal: '🐱',
        sad: '😿',
        sleeping: '😴',
        thinking: '🙀',
        talking: '😸',
        excited: '😻'
      },
      '🐶': {
        happy: '🐕',
        normal: '🐶',
        sad: '🐕‍🦺',
        sleeping: '💤',
        thinking: '🐶',
        talking: '🐩',
        excited: '🦮'
      },
      '🐰': {
        happy: '🐇',
        normal: '🐰',
        sad: '🐰',
        sleeping: '💤',
        thinking: '🐰',
        talking: '🐇',
        excited: '🐰'
      },
      '🦊': {
        happy: '🦊',
        normal: '🦊',
        sad: '🦊',
        sleeping: '💤',
        thinking: '🦊',
        talking: '🦊',
        excited: '🦊'
      },
      '🐻': {
        happy: '🐻',
        normal: '🐻',
        sad: '🐻‍❄️',
        sleeping: '💤',
        thinking: '🐻',
        talking: '🐻',
        excited: '🐻'
      }
    };
    
    // 表情变体（增加多样性，随机选择）
    this.expressionVariants = {
      '🐱': {
        happy: ['😺', '😸', '😹'],
        normal: ['🐱', '😼', '🐈'],
        idle: ['🐱', '😺', '😸']
      },
      '🐶': {
        happy: ['🐕', '🐶', '🦮'],
        normal: ['🐶', '🐕', '🐩'],
        idle: ['🐶', '🐕']
      },
      '🐰': {
        happy: ['🐇', '🐰'],
        normal: ['🐰', '🐇'],
        idle: ['🐰', '🐇']
      },
      '🦊': {
        happy: ['🦊'],
        normal: ['🦊'],
        idle: ['🦊']
      },
      '🐻': {
        happy: ['🐻'],
        normal: ['🐻', '🐻‍❄️'],
        idle: ['🐻']
      }
    };
    
    // 当前基础表情（宠物类型）
    this.baseExpression = '🐱';
    
    // 当前心情表情
    this.currentExpression = 'normal';
    
    // Lottie 控制器引用
    this.lottieController = null;
    
    // 使用 Lottie 还是 Emoji
    this.useLottie = false;
    
    // 强制禁用 Lottie（修复黄色方块问题）
    this.forceEmojiMode = true;
    
    console.log('[Animation] 动画控制器已创建');
  }
  
  // 初始化（在 DOM 加载后调用）
  initialize() {
    this.petWrapper = document.getElementById('petWrapper');
    this.petEmoji = document.getElementById('petEmoji');
    const petLottie = document.getElementById('petLottie');

    if (!this.petWrapper || !this.petEmoji) {
      console.error('[Animation] 错误：找不到宠物元素！');
      return false;
    }

    if (!petLottie) {
      console.error('[Animation] 错误：找不到 petLottie 容器！');
      return false;
    }

    // 检查是否强制使用 Emoji
    if (this.forceEmojiMode) {
      console.log('[Animation] 强制使用 Emoji 模式');
      this.useLottie = false;
      this.petEmoji.style.display = 'block';
      if (petLottie) petLottie.style.display = 'none';
      this.createDecorationLayer();
      this.setState('idle');
      return true;
    }

    // 检查 Lottie 库是否加载
    if (typeof lottie === 'undefined' && typeof bodymovin === 'undefined') {
      console.warn('[Animation] Lottie 库未加载，使用 Emoji 备用方案');
      this.useLottie = false;
      this.petEmoji.style.display = 'block';
      petLottie.style.display = 'none';
      this.createDecorationLayer();
      this.setState('idle');
      console.log('[Animation] 动画系统初始化完成（Emoji 模式）');
      return true;
    }

    // 初始化 Lottie 控制器
    if (window.LottieController) {
      this.lottieController = window.LottieController;
      const lottieInitialized = this.lottieController.initialize('petLottie');

      if (lottieInitialized && this.lottieController.isEnabled()) {
        console.log('[Animation] Lottie 动画系统已启用');
        this.useLottie = true;

        // 隐藏 emoji，显示 Lottie
        this.petEmoji.style.display = 'none';
        petLottie.style.display = 'block';
        petLottie.classList.add('lottie-active');

        // 加载初始宠物动画
        this.lottieController.loadPet(this.baseExpression, 'idle').then((success) => {
          if (success) {
            console.log('[Animation] Lottie 动画加载成功');
          } else {
            console.warn('[Animation] Lottie 动画加载失败，切换到 Emoji');
            this.switchToEmoji();
          }
        }).catch((error) => {
          console.error('[Animation] Lottie 动画加载异常，切换到 Emoji:', error);
          this.switchToEmoji();
        });
      } else {
        console.log('[Animation] Lottie 初始化失败，使用 Emoji 备用方案');
        this.useLottie = false;
        this.petEmoji.style.display = 'block';
        petLottie.style.display = 'none';
      }
    } else {
      console.log('[Animation] Lottie 控制器未找到，使用 Emoji');
      this.useLottie = false;
      this.petEmoji.style.display = 'block';
      petLottie.style.display = 'none';
    }

    // 创建装饰层
    this.createDecorationLayer();

    // 设置初始状态
    this.setState('idle');

    console.log('[Animation] 动画系统初始化完成');
    return true;
  }

  // 切换到 Emoji 模式
  switchToEmoji() {
    this.useLottie = false;
    const petLottie = document.getElementById('petLottie');
    if (petLottie) {
      petLottie.style.display = 'none';
      petLottie.classList.remove('lottie-active');
    }

    // 强制显示 emoji
    this.petEmoji.style.display = 'block';
    this.petEmoji.style.visibility = 'visible';
    this.petEmoji.style.opacity = '1';
    this.petEmoji.style.fontSize = '80px';
    this.petEmoji.style.lineHeight = '1';

    this.updateExpression();
    console.log('[Animation] 切换到 Emoji 模式，表情:', this.petEmoji.textContent);

    // 销毁 Lottie 实例
    if (this.lottieController) {
      this.lottieController.destroy();
    }
  }

  // 创建装饰层（用于显示粒子、表情等）
  createDecorationLayer() {
    
    // 设置初始状态
    this.setState('idle');
    
    console.log('[Animation] 动画系统初始化完成');
    return true;
  }
  
  // 创建装饰层（用于显示粒子、表情等）
  createDecorationLayer() {
    const existing = document.getElementById('petDecorations');
    if (existing) {
      this.decorationLayer = existing;
      return;
    }
    
    this.decorationLayer = document.createElement('div');
    this.decorationLayer.id = 'petDecorations';
    this.decorationLayer.className = 'pet-decorations';
    this.petWrapper.appendChild(this.decorationLayer);
  }
  
  // 设置动画状态
  setState(newState, duration = null) {
    if (!this.states.includes(newState)) {
      console.warn(`[Animation] 未知状态: ${newState}`);
      return false;
    }
    
    if (this.currentState === newState) {
      console.log(`[Animation] 已经是 ${newState} 状态，跳过`);
      return false;
    }
    
    console.log(`[Animation] 状态切换: ${this.currentState} -> ${newState}`);
    
    // 移除旧状态的类
    this.petWrapper.classList.remove(`pet-${this.currentState}`);
    
    // 保存上一个状态
    this.previousState = this.currentState;
    this.currentState = newState;
    
    // 添加新状态的类
    this.petWrapper.classList.add(`pet-${this.currentState}`);

    // 如果启用了 Lottie，切换 Lottie 动画
    if (this.useLottie && this.lottieController) {
      this.lottieController.playState(newState).then((success) => {
        if (!success) {
          console.warn('[Animation] Lottie 动画播放失败，切换到 Emoji');
          this.switchToEmoji();
        }
      }).catch((error) => {
        console.error('[Animation] Lottie 动画播放失败，切换到 Emoji:', error);
        this.switchToEmoji();
      });
    }
    
    // 清除之前的计时器
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    
    // 如果指定了持续时间，自动恢复到上一个状态
    if (duration && duration > 0) {
      this.stateTimer = setTimeout(() => {
        console.log(`[Animation] 定时恢复状态: ${this.currentState} -> ${this.previousState}`);
        this.setState(this.previousState);
      }, duration);
    }
    
    return true;
  }
  
  // 获取当前状态
  getState() {
    return this.currentState;
  }
  
  // 恢复到上一个状态
  restorePreviousState() {
    this.setState(this.previousState);
  }
  
  // 临时切换状态（自动恢复）
  setTemporaryState(state, duration = 2000) {
    this.setState(state, duration);
  }
  
  // 播放单个动画
  playAnimation(animationName, duration = 1000) {
    return new Promise((resolve) => {
      console.log(`[Animation] 播放动画: ${animationName}, 持续 ${duration}ms`);
      this.setState(animationName);
      
      setTimeout(() => {
        console.log(`[Animation] 动画完成: ${animationName}`);
        resolve();
      }, duration);
    });
  }
  
  // 播放动画序列
  async playSequence(animations) {
    if (this.isPlayingQueue) {
      console.warn('[Animation] 动画队列正在播放，跳过');
      return;
    }
    
    this.isPlayingQueue = true;
    console.log(`[Animation] 开始播放动画序列，共 ${animations.length} 个动画`);
    
    for (const anim of animations) {
      await this.playAnimation(anim.name, anim.duration || 1000);
    }
    
    // 恢复到 idle
    this.setState('idle');
    this.isPlayingQueue = false;
    console.log('[Animation] 动画序列播放完成');
  }
  
  // 显示装饰（如粒子、表情符号）
  showDecoration(content, duration = 2000) {
    if (!this.decorationLayer) return;
    
    const decoration = document.createElement('div');
    decoration.className = 'decoration-item';
    decoration.textContent = content;
    this.decorationLayer.appendChild(decoration);
    
    // 自动移除
    setTimeout(() => {
      decoration.classList.add('fade-out');
      setTimeout(() => {
        decoration.remove();
      }, 300);
    }, duration);
  }
  
  // 清除所有装饰
  clearDecorations() {
    if (this.decorationLayer) {
      this.decorationLayer.innerHTML = '';
    }
  }
  
  // 快捷方法：开心
  happy(duration = 2000) {
    this.setTemporaryState('happy', duration);
    this.showDecoration('✨', duration);
  }
  
  // 快捷方法：思考
  thinking() {
    this.setState('thinking');
    this.showDecoration('...', 3000);
  }
  
  // 快捷方法：说话
  talking(duration = 1500) {
    this.setTemporaryState('talking', duration);
  }
  
  // 快捷方法：睡觉
  sleeping() {
    this.setState('sleeping');
    this.showDecoration('💤', 0); // 0 表示不自动消失
  }
  
  // 快捷方法：唤醒
  wakeUp() {
    this.clearDecorations();
    this.setState('idle');
  }
  
  // 快捷方法：被点击
  clicked() {
    this.setTemporaryState('clicked', 300);
  }
  
  // 快捷方法：拖拽中
  dragging() {
    this.setState('dragging');
  }
  
  // 快捷方法：拖拽结束
  stopDragging() {
    this.setState('idle');
  }
  
  // ========== 表情系统 ==========
  
  // 设置基础宠物类型
  setBasePet(petEmoji) {
    this.baseExpression = petEmoji;
    console.log(`[Animation] 设置宠物类型: ${petEmoji}`);

    // 如果启用了 Lottie，加载新宠物
    if (this.useLottie && this.lottieController) {
      this.lottieController.loadPet(petEmoji, this.currentState).then((success) => {
        if (!success) {
          console.warn('[Animation] Lottie 宠物加载失败，切换到 Emoji');
          this.switchToEmoji();
        }
      }).catch((error) => {
        console.error('[Animation] Lottie 宠物加载失败，切换到 Emoji:', error);
        this.switchToEmoji();
      });
    } else {
      this.updateExpression();
    }
  }
  
  // 根据心情更新表情
  updateByMood(mood) {
    let expression = 'normal';
    
    if (mood >= 90) {
      expression = 'excited';
    } else if (mood >= 70) {
      expression = 'happy';
    } else if (mood >= 40) {
      expression = 'normal';
    } else {
      expression = 'sad';
    }
    
    this.setExpression(expression);
  }
  
  // 设置表情
  setExpression(expressionType) {
    if (this.currentExpression === expressionType) return;
    
    this.currentExpression = expressionType;
    console.log(`[Animation] 设置表情: ${expressionType}`);
    this.updateExpression();
  }
  
  // 获取表情（支持随机变体）
  getExpressionEmoji(expressionType) {
    const expressionMap = this.expressionMaps[this.baseExpression];
    if (!expressionMap) {
      return this.baseExpression;
    }
    
    // 尝试从变体中随机选择
    const variants = this.expressionVariants[this.baseExpression];
    if (variants && variants[expressionType] && variants[expressionType].length > 0) {
      const variantList = variants[expressionType];
      return variantList[Math.floor(Math.random() * variantList.length)];
    }
    
    // 否则使用标准映射
    return expressionMap[expressionType] || this.baseExpression;
  }
  
  // 更新 DOM 中的表情
  updateExpression() {
    if (!this.petEmoji) return;
    
    const newEmoji = this.getExpressionEmoji(this.currentExpression);
    
    // 添加切换动画
    this.petEmoji.style.transform = 'scale(0.8)';
    
    setTimeout(() => {
      this.petEmoji.textContent = newEmoji;
      this.petEmoji.style.transform = 'scale(1)';
    }, 100);
  }
  
  // 临时显示特定表情
  showTemporaryExpression(expressionType, duration = 2000) {
    const previousExpression = this.currentExpression;
    this.setExpression(expressionType);
    
    setTimeout(() => {
      this.setExpression(previousExpression);
    }, duration);
  }
}

// 创建全局实例
window.PetAnimations = new PetAnimationController();

console.log('[Animation] 动画模块已加载');
