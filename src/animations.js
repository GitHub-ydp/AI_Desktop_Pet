// 宠物动画状态机
// 管理宠物的各种动画状态和过渡

class PetAnimationController {
  constructor() {
    // 所有可用的动画状态
    this.states = ['idle', 'happy', 'thinking', 'sleeping', 'dragging', 'clicked', 'talking', 'sad', 'exercising', 'playing'];
    
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
    this.forceEmojiMode = false;

    // 手动状态锁定（用户通过菜单手动切换状态时启用）
    this.manualStateLock = false;
    // 手动锁定的目标状态
    this.manualLockedState = null;

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

        // 显示 Lottie，隐藏 emoji
        this.petEmoji.style.display = 'none';
        const petLottie = document.getElementById('petLottie');
        if (petLottie) {
          petLottie.style.display = 'block';
          petLottie.classList.add('lottie-active');
        }

        // 加载初始宠物动画
        console.log('[Animation] 开始加载初始宠物动画...');
        this.lottieController.loadPet(this.baseExpression, 'idle').then((success) => {
          if (success) {
            console.log('[Animation] ✅ Lottie 初始加载成功！');
          } else {
            console.warn('[Animation] ⚠️ Lottie 返回 false，切换到 Emoji');
            this.switchToEmoji();
          }
        }).catch((error) => {
          console.error('[Animation] ❌ Lottie 加载异常，切换到 Emoji:', error);
          this.switchToEmoji();
        });
      } else {
        console.log('[Animation] Lottie 初始化失败，使用 Emoji 备用方案');
        this.useLottie = false;
        this.petEmoji.style.display = 'block';
        const petLottie = document.getElementById('petLottie');
        if (petLottie) petLottie.style.display = 'none';
      }
    } else {
      console.log('[Animation] Lottie 控制器未找到，使用 Emoji');
      this.useLottie = false;
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
  }

  // 切换到 Lottie 模式
  switchToLottie() {
    if (!this.lottieController || !this.lottieController.isEnabled()) {
      console.warn('[Animation] Lottie 不可用，无法切换');
      return;
    }

    this.useLottie = true;

    const petLottie = document.getElementById('petLottie');
    if (petLottie) {
      petLottie.style.display = 'block';
      petLottie.classList.add('lottie-active');
    }

    // 隐藏 emoji
    this.petEmoji.style.display = 'none';

    console.log('[Animation] 切换到 Lottie 模式');
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

    // 手动锁定时，阻止自动系统覆盖手动状态
    if (this.manualStateLock && newState !== this.manualLockedState) {
      console.log(`[Animation] 手动锁定中，拒绝切换到 ${newState}（锁定: ${this.manualLockedState}）`);
      return false;
    }

    if (this.currentState === newState) {
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

    // 清除之前的计时器
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }

    // 如果启用了 Lottie，切换 Lottie 动画
    if (this.useLottie && this.lottieController) {
      // 传递当前的宠物类型
      this.lottieController.playState(newState, this.baseExpression).then((success) => {
        if (!success) {
          console.warn('[Animation] Lottie 动画播放失败，切换到 Emoji');
          this.switchToEmoji();
        }
      }).catch((error) => {
        console.error('[Animation] Lottie 动画播放失败，切换到 Emoji:', error);
        this.switchToEmoji();
      });
    }

    // 注意：状态持续时间现在由 LottieController 统一管理
    // 不在这里重复设置，避免双重定时器

    return true;
  }

  // 根据心情和上下文自动决定下一个状态
  autoDecideNextState(mood, lastInteractionTime) {
    if (!window.AnimationConfig) {
      console.warn('[Animation] AnimationConfig 未加载，保持当前状态');
      return;
    }

    const decision = window.AnimationConfig.decideNextState(
      this.currentState,
      mood,
      lastInteractionTime,
      {
        baseExpression: this.baseExpression
      }
    );

    console.log(`[Animation] 自动状态决策: ${decision.reason} -> ${decision.state}`);

    if (decision.state !== this.currentState) {
      this.setState(decision.state);
    }
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

    // 通过 SkinRegistry 检查该皮肤是否支持 Lottie
    const skinHasLottie = window.SkinRegistry
      ? window.SkinRegistry.hasLottieSupport(petEmoji)
      : false;

    if (skinHasLottie) {
      // 该皮肤支持 Lottie
      if (this.lottieController) {
        this.lottieController.setBaseExpression(petEmoji);

        // 如果当前不在 Lottie 模式且非强制 Emoji，切换到 Lottie
        if (!this.useLottie && !this.forceEmojiMode && this.lottieController.isEnabled()) {
          console.log(`[Animation] 皮肤 ${petEmoji} 支持 Lottie，切换到 Lottie 模式`);
          this.switchToLottie();
          this.lottieController.loadPet(petEmoji, this.currentState || 'idle');
        }
      }
    } else {
      // 该皮肤不支持 Lottie，切换到 Emoji 模式
      if (this.useLottie) {
        console.log(`[Animation] 皮肤 ${petEmoji} 不支持 Lottie，切换到 Emoji 模式`);
        this.switchToEmoji();
      }
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

  // 启动自动状态检查（每30秒检查一次是否需要切换状态）
  startAutoStateCheck(moodGetter, lastInteractionGetter) {
    if (this.stateCheckInterval) {
      clearInterval(this.stateCheckInterval);
    }

    console.log('[Animation] 启动自动状态检查');

    this.stateCheckInterval = setInterval(() => {
      // 手动锁定时跳过自动检查
      if (this.manualStateLock) return;

      // 只在 idle 状态下自动切换（避免打扰用户正在观看的动画）
      if (this.currentState === 'idle') {
        const mood = moodGetter ? moodGetter() : 80;
        const lastInteraction = lastInteractionGetter ? lastInteractionGetter() : Date.now();

        this.autoDecideNextState(mood, lastInteraction);
      }
    }, 30000); // 每30秒检查一次
  }

  // 停止自动状态检查
  stopAutoStateCheck() {
    if (this.stateCheckInterval) {
      clearInterval(this.stateCheckInterval);
      this.stateCheckInterval = null;
      console.log('[Animation] 停止自动状态检查');
    }
  }

  // 手动设置状态（由用户菜单触发，锁定状态不被自动系统覆盖）
  setManualState(state) {
    if (!this.states.includes(state)) {
      console.warn(`[Animation] 未知状态: ${state}`);
      return false;
    }

    console.log(`[Animation] 手动切换状态: ${state}，启用锁定`);
    this.manualStateLock = true;
    this.manualLockedState = state;

    // 强制切换（先临时解锁让 setState 通过）
    const prevLock = this.manualStateLock;
    this.manualStateLock = false;
    this.setState(state);
    this.manualStateLock = prevLock;
    this.manualLockedState = state;

    // 通知 LottieController 进入手动模式（强制循环）
    if (this.useLottie && this.lottieController) {
      this.lottieController.setManualMode(true);
    }

    return true;
  }

  // 解除手动状态锁定（由用户交互触发）
  unlockManualState() {
    if (!this.manualStateLock) return;

    console.log(`[Animation] 解除手动状态锁定，从 ${this.manualLockedState} 恢复到 idle`);
    this.manualStateLock = false;
    this.manualLockedState = null;

    // 通知 LottieController 退出手动模式
    if (this.useLottie && this.lottieController) {
      this.lottieController.setManualMode(false);
    }

    // 恢复到 idle
    this.setState('idle');
  }

  // 检查是否处于手动锁定状态
  isManualLocked() {
    return this.manualStateLock;
  }
}

// 创建全局实例
window.PetAnimations = new PetAnimationController();

console.log('[Animation] 动画模块已加载');
