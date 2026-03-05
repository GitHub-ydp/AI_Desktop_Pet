// Lottie 动画控制器
// 管理宠物的 Lottie 动画加载、播放和切换
// 通过 SkinRegistry 获取皮肤配置和动画路径

class LottieController {
  constructor() {
    // Lottie 动画实例
    this.animation = null;

    // 当前皮肤 ID
    this.currentSkinId = 'cat';

    // 当前动画状态
    this.currentState = 'idle';

    // 动画容器
    this.container = null;

    // 是否启用 Lottie（如果加载失败，回退到 emoji）
    this.enabled = false;

    // 当前基础表情（宠物 emoji）
    this.baseExpression = '🐱';

    // 动画缓存（避免重复加载）
    this.animationCache = new Map();

    // 当前加载的动画路径
    this.currentAnimationPath = null;

    // 是否正在加载动画
    this.isLoading = false;

    // 超时定时器
    this.timeoutTimer = null;

    // 状态计时器（用于最小显示时间）
    this.stateTimer = null;

    // 过渡动画持续时间
    this.transitionDuration = 300;

    // 手动模式（由 PetAnimations 控制，强制循环播放）
    this.manualMode = false;

    console.log('[LottieController] Lottie 控制器已创建');
  }

  // 获取状态配置（通过 SkinRegistry）
  getStateConfig(state) {
    if (!window.SkinRegistry) {
      return null;
    }

    const animInfo = window.SkinRegistry.getAnimationForState(this.baseExpression, state);
    if (!animInfo) return null;

    // 返回兼容旧接口的配置对象
    return {
      loop: animInfo.loop,
      onComplete: animInfo.onComplete,
      minDisplayTime: animInfo.minDisplayTime,
      duration: animInfo.duration,
      priority: animInfo.priority
    };
  }

  // 设置手动模式（强制循环播放，禁用自动回弹）
  setManualMode(enabled) {
    this.manualMode = enabled;
    console.log(`[LottieController] 手动模式: ${enabled ? '启用' : '禁用'}`);

    // 启用手动模式且当前动画存在，强制设为循环
    if (enabled && this.animation) {
      this.animation.loop = true;
    }
  }

  // 获取是否循环播放
  shouldLoop(state) {
    // 手动模式下强制循环
    if (this.manualMode) return true;

    const stateConfig = this.getStateConfig(state);
    if (stateConfig && stateConfig.loop !== undefined) {
      return stateConfig.loop;
    }
    // 默认循环
    return true;
  }

  // 初始化
  initialize(containerId = 'petLottie') {
    // 检查 Lottie 库是否加载
    this.lottieLib = window.lottie || window.bodymovin;
    if (!this.lottieLib) {
      console.error('[LottieController] Lottie 库未加载！');
      this.enabled = false;
      return false;
    }

    // 获取容器
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('[LottieController] 找不到 Lottie 容器！');
      this.enabled = false;
      return false;
    }

    // 确保容器有尺寸
    console.log(`[LottieController] 容器尺寸: ${this.container.offsetWidth}x${this.container.offsetHeight}`);
    if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) {
      console.warn('[LottieController] 容器尺寸为 0，设置默认尺寸');
      this.container.style.width = '150px';
      this.container.style.height = '150px';
    }

    this.enabled = true;
    console.log('[LottieController] Lottie 控制器初始化成功');
    return true;
  }

  // 加载宠物动画
  async loadPet(petEmoji, initialState = 'idle') {
    if (!this.enabled) {
      console.log('[LottieController] Lottie 未启用，跳过加载');
      return false;
    }

    // 通过 SkinRegistry 检查是否支持 Lottie
    if (window.SkinRegistry && !window.SkinRegistry.hasLottieSupport(petEmoji)) {
      console.log(`[LottieController] 皮肤 ${petEmoji} 不支持 Lottie`);
      return false;
    }

    // 通过 SkinRegistry 获取 skinId
    if (window.SkinRegistry) {
      this.currentSkinId = window.SkinRegistry.getSkinIdByEmoji(petEmoji);
    }

    console.log(`[LottieController] 加载宠物: ${this.currentSkinId} (${petEmoji})`);
    this.baseExpression = petEmoji;

    // 播放初始状态
    return await this.playState(initialState);
  }

  // 获取动画文件路径（通过 SkinRegistry）
  getAnimationPath(state) {
    if (window.SkinRegistry) {
      const animInfo = window.SkinRegistry.getAnimationForState(this.baseExpression, state);
      if (animInfo) {
        return animInfo.path;
      }
    }

    // 降级：使用默认路径
    console.warn('[LottieController] 无法从 SkinRegistry 获取路径，使用默认');
    return 'lottie/cat/猫坐在枕头上.json';
  }

  // 播放指定状态的动画
  async playState(state, petEmoji = null) {
    if (!this.enabled) {
      return false;
    }

    // 如果提供了宠物 emoji，更新当前皮肤
    if (petEmoji) {
      this.baseExpression = petEmoji;
      if (window.SkinRegistry) {
        this.currentSkinId = window.SkinRegistry.getSkinIdByEmoji(petEmoji);

        // 检查该皮肤是否支持 Lottie
        if (!window.SkinRegistry.hasLottieSupport(petEmoji)) {
          console.log(`[LottieController] 皮肤 ${petEmoji} 不支持 Lottie`);
          return false;
        }
      }
    }

    const animationPath = this.getAnimationPath(state);
    const shouldLoop = this.shouldLoop(state);
    const stateConfig = this.getStateConfig(state);

    console.log(`[LottieController] 播放状态: ${state} (${animationPath}), loop: ${shouldLoop}`);

    // 如果当前状态相同且正在循环播放，不重复加载
    if (this.currentState === state &&
        this.animation &&
        !this.animation.isPaused &&
        this.currentAnimationPath === animationPath &&
        shouldLoop) {
      console.log('[LottieController] 动画已在播放，跳过');
      return true;
    }

    // 如果正在加载，保持当前动画继续播放，返回 true
    if (this.isLoading) {
      console.log(`[LottieController] 正在加载动画 (${this.currentState}), 保持当前状态`);
      return true;
    }

    // 清除之前的状态计时器
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }

    // 标记为正在加载
    this.isLoading = true;

    // 保存旧动画引用，等新动画加载成功后再销毁
    const oldAnimation = this.animation;
    const oldState = this.currentState;

    try {
      // 如果是同一个动画文件，只重置播放位置，不重新加载
      if (this.currentAnimationPath === animationPath && this.animation && this.animation.isLoaded) {
        console.log('[LottieController] 复用已加载的动画，重置播放');

        this.currentState = state;
        this.animation.loop = shouldLoop;

        // 重置到第一帧并播放
        if (typeof this.animation.goToAndPlay === 'function') {
          this.animation.goToAndPlay(0, true);
        } else {
          this.animation.stop();
          this.animation.play();
        }

        this.isLoading = false;
        this.setupStateDuration(state);
        return true;
      }

      // 先更新状态
      this.currentState = state;
      this.currentAnimationPath = animationPath;

      // 创建新动画容器（暂不销毁旧动画）
      const tempContainer = document.createElement('div');
      tempContainer.style.width = '100%';
      tempContainer.style.height = '100%';
      tempContainer.style.display = 'flex';
      tempContainer.style.alignItems = 'center';
      tempContainer.style.justifyContent = 'center';
      // 某些状态图层会超出边界，禁止裁剪避免显示不全
      tempContainer.style.overflow = 'visible';

      // 加载新动画到临时容器
      const newAnimation = this.lottieLib.loadAnimation({
        container: tempContainer,
        renderer: 'svg',
        loop: shouldLoop,
        autoplay: true,
        path: animationPath,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          clearCanvas: true
        }
      });

      // 监听加载完成
      return await new Promise((resolve, reject) => {
        newAnimation.addEventListener('DOMLoaded', () => {
          console.log(`[LottieController] 动画 DOM 加载完成: ${state}`);
          this.isLoading = false;

          // 清除超时定时器
          if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
          }

          // 新动画加载成功，现在才销毁旧动画并替换
          if (oldAnimation) {
            oldAnimation.destroy();
          }
          this.container.innerHTML = '';
          this.container.appendChild(tempContainer);
          this.animation = newAnimation;

          // 调试信息：检查 SVG 内容
          if (this.container && this.container.querySelector('svg')) {
            const svg = this.container.querySelector('svg');
            const shapes = svg.querySelectorAll('path, circle, ellipse, rect, g');
            console.log(`[LottieController] SVG 包含 ${shapes.length} 个元素`);
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.maxWidth = '100%';
            svg.style.maxHeight = '100%';
            svg.style.display = 'block';
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            // 修复 viewBox 问题
            if (!svg.getAttribute('viewBox') && svg.getAttribute('width') && svg.getAttribute('height')) {
              const width = svg.getAttribute('width');
              const height = svg.getAttribute('height');
              svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            }
          }

          // 如果不是循环播放，监听 complete 事件
          if (!shouldLoop) {
            console.log(`[LottieController] 状态 ${state} 为单次播放，监听 complete 事件`);

            // 只监听一次 complete 事件
            newAnimation.addEventListener('complete', () => {
              console.log(`[LottieController] 动画播放完成: ${state}`);

              // 手动模式下不自动切换状态
              if (this.manualMode) {
                console.log(`[LottieController] 手动模式，不自动切换`);
                return;
              }

              // 检查配置中是否有自动切换
              if (stateConfig && stateConfig.onComplete) {
                const nextState = stateConfig.onComplete;
                console.log(`[LottieController] 自动切换到: ${nextState}`);

                // 通知 Animation 控制器
                if (window.PetAnimations && window.PetAnimations.currentState === state) {
                  window.PetAnimations.setState(nextState);
                }
              } else {
                // 默认切换到 idle
                console.log(`[LottieController] 动画完成，切换到 idle`);
                if (window.PetAnimations && window.PetAnimations.currentState === state) {
                  window.PetAnimations.setState('idle');
                }
              }
            }, { once: true });
          }

          // 设置状态持续时间（用于最小显示时间）
          this.setupStateDuration(state);

          resolve(true);
        });

        newAnimation.addEventListener('data_failed', (error) => {
          console.error(`[LottieController] 动画加载失败: ${state}`, error);
          this.isLoading = false;

          // 清除超时定时器
          if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
          }

          // 标记该皮肤 Lottie 不可用
          if (window.SkinRegistry) {
            window.SkinRegistry.markLottieUnavailable(this.baseExpression);
          }

          // 新动画加载失败，保持旧动画继续播放
          this.currentState = oldState;
          console.log('[LottieController] 新动画加载失败，保持旧动画');

          reject(error);
        });

        // 超时处理 - 15 秒超时
        this.timeoutTimer = setTimeout(() => {
          if (this.timeoutTimer) {
            console.error(`[LottieController] 动画加载超时: ${state}`);
            console.error(`[LottieController] 动画路径: ${animationPath}`);
            console.error(`[LottieController] 容器尺寸: ${this.container?.offsetWidth}x${this.container?.offsetHeight}`);
            console.error(`[LottieController] 动画对象: ${newAnimation ? '存在' : '不存在'}`);
            console.error(`[LottieController] isLoaded: ${newAnimation?.isLoaded}`);

            this.isLoading = false;

            // 超时时保持旧动画继续播放
            this.currentState = oldState;
            console.log('[LottieController] 动画加载超时，保持旧动画');

            // 销毁新动画
            if (newAnimation) {
              newAnimation.destroy();
            }

            reject(new Error('Timeout'));
          }
        }, 15000); // 15 秒超时
      });

    } catch (error) {
      console.error(`[LottieController] 加载动画失败:`, error);
      this.isLoading = false;

      // 发生错误时保持旧动画
      this.currentState = oldState;
      console.log('[LottieController] 发生错误，保持旧动画');

      return false;
    }
  }

  // 设置状态持续时间（用于循环播放状态的最小显示时间）
  setupStateDuration(state) {
    const stateConfig = this.getStateConfig(state);
    if (!stateConfig) return;

    const shouldLoop = this.shouldLoop(state);

    // 如果不是循环播放，由 complete 事件处理，不需要设置定时器
    if (!shouldLoop) {
      console.log(`[LottieController] 状态 ${state} 为单次播放，由 complete 事件处理`);
      return;
    }

    // 手动模式下不设置最小显示时间（用户手动选的，不自动切回）
    if (this.manualMode) {
      console.log(`[LottieController] 手动模式，跳过 minDisplayTime`);
      return;
    }

    // 如果有 minDisplayTime，设置最小显示时间
    if (stateConfig.minDisplayTime) {
      console.log(`[LottieController] 设置状态最小显示时间: ${state} - ${stateConfig.minDisplayTime}ms`);

      this.stateTimer = setTimeout(() => {
        console.log(`[LottieController] 状态 ${state} 最小显示时间结束`);

        // 最小显示时间结束后，可以自动切换到 idle
        // 只通知 Animation.js，让 Animation 统一管理状态切换
        if (window.PetAnimations && window.PetAnimations.currentState === state) {
          window.PetAnimations.setState('idle');
        }
      }, stateConfig.minDisplayTime);
    }
  }

  // 过渡到新状态（带淡入淡出效果）
  async transitionTo(state, duration = 300) {
    if (!this.enabled || this.isLoading) {
      return false;
    }

    console.log(`[LottieController] 过渡到: ${state}`);

    // 淡出当前动画
    if (this.container) {
      this.container.style.transition = `opacity ${duration}ms ease-out`;
      this.container.style.opacity = '0';
    }

    // 等待淡出完成
    await new Promise(resolve => setTimeout(resolve, duration));

    // 加载新动画
    const success = await this.playState(state);

    // 淡入新动画
    if (success && this.container) {
      this.container.style.opacity = '1';
    }

    return success;
  }

  // 暂停动画
  pause() {
    if (this.animation) {
      this.animation.pause();
    }
  }

  // 恢复动画
  resume() {
    if (this.animation) {
      this.animation.play();
    }
  }

  // 停止并重置动画
  stop() {
    if (this.animation) {
      this.animation.stop();
    }
  }

  // 设置动画速度
  setSpeed(speed) {
    if (this.animation) {
      this.animation.setSpeed(speed);
    }
  }

  // 销毁动画
  destroy() {
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    if (this.animation) {
      this.animation.destroy();
      this.animation = null;
    }

    this.currentState = null;
    this.currentAnimationPath = null;
    this.isLoading = false;

    console.log('[LottieController] 动画已销毁');
  }

  // 检查是否已启用
  isEnabled() {
    return this.enabled;
  }

  // 获取当前状态
  getState() {
    return this.currentState;
  }

  // 设置基础表情（宠物类型）
  setBaseExpression(petEmoji) {
    this.baseExpression = petEmoji;
    if (window.SkinRegistry) {
      this.currentSkinId = window.SkinRegistry.getSkinIdByEmoji(petEmoji);
    }
  }
}

// 创建全局实例
window.LottieController = new LottieController();

console.log('[LottieController] Lottie 控制器模块已加载');
