// Lottie 动画控制器
// 管理宠物的 Lottie 动画加载、播放和切换

class LottieController {
  constructor() {
    // Lottie 动画实例
    this.animation = null;
    
    // 当前宠物类型
    this.currentPet = 'cat';
    
    // 当前动画状态
    this.currentState = 'idle';
    
    // 动画容器
    this.container = null;
    
    // 是否启用 Lottie（如果加载失败，回退到 emoji）
    this.enabled = false;
    
    // 动画状态映射到文件名
    this.stateToAnimation = {
      'idle': 'idle.json',
      'happy': 'idle.json',
      'sleeping': 'idle.json',
      'talking': 'idle.json',
      'dragging': 'idle.json',
      'clicked': 'idle.json',
      'thinking': 'idle.json',
      'sad': 'idle.json'
    };
    
    // 宠物类型映射到文件夹名
    // 临时：统一使用新版猫的 Lottie 资源，保证新样式生效
    this.petToFolder = {
      '🐱': 'cat',
      '🐶': 'cat',
      '🐰': 'cat',
      '🦊': 'cat',
      '🐻': 'cat'
    };
    
    // 动画是否循环
    this.loopStates = {
      'idle': true,
      'happy': true,
      'sleeping': true,
      'talking': true,
      'dragging': true,
      'clicked': false,    // 单次播放
      'thinking': true,
      'sad': true
    };
    
    console.log('[LottieController] Lottie 控制器已创建');
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
    
    const petFolder = this.petToFolder[petEmoji];
    if (!petFolder) {
      console.error(`[LottieController] 未知的宠物类型: ${petEmoji}`);
      return false;
    }
    
    console.log(`[LottieController] 加载宠物: ${petFolder}`);
    this.currentPet = petFolder;
    
    // 播放初始状态
    return await this.playState(initialState);
  }
  
  // 播放指定状态的动画
  async playState(state) {
    if (!this.enabled) {
      return false;
    }
    
    // 获取动画文件名
    const animationFile = this.stateToAnimation[state] || 'idle.json';
    const animationPath = `assets/pets/${this.currentPet}/${animationFile}`;
    
    console.log(`[LottieController] 播放状态: ${state} (${animationPath})`);
    
    // 如果当前状态相同，不重复加载
    if (this.currentState === state && this.animation && !this.animation.isPaused) {
      console.log('[LottieController] 动画已在播放，跳过');
      return true;
    }
    
    try {
      // 销毁旧动画
      if (this.animation) {
        this.animation.destroy();
        this.animation = null;
      }
      
      // 清空容器
      this.container.innerHTML = '';
      
      // 加载新动画
      this.animation = this.lottieLib.loadAnimation({
        container: this.container,
        renderer: 'svg',
        loop: this.loopStates[state] !== false,
        autoplay: true,
        path: animationPath
      });
      
      this.currentState = state;
      
      // 监听加载完成
      return await new Promise((resolve, reject) => {
        this.animation.addEventListener('DOMLoaded', () => {
          console.log(`[LottieController] 动画加载成功: ${state}`);

          // 调试信息：检查 SVG 内容
          if (this.container && this.container.querySelector('svg')) {
            const svg = this.container.querySelector('svg');
            const shapes = svg.querySelectorAll('path, circle, ellipse, rect, g');
            console.log(`[LottieController] SVG 包含 ${shapes.length} 个元素`);
            console.log(`[LottieController] SVG 尺寸: ${svg.getAttribute('width')}x${svg.getAttribute('height')}`);
            console.log(`[LottieController] SVG viewBox: ${svg.getAttribute('viewBox')}`);
            console.log(`[LottieController] 容器尺寸: ${this.container.offsetWidth}x${this.container.offsetHeight}`);

            // 修复 viewBox 问题：确保 SVG 正确缩放到容器
            if (!svg.getAttribute('viewBox') && svg.getAttribute('width') && svg.getAttribute('height')) {
              const width = svg.getAttribute('width');
              const height = svg.getAttribute('height');
              svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
              console.log(`[LottieController] ⚠️ 修复缺失的 viewBox: 0 0 ${width} ${height}`);
            }

            // 检查前几个形状元素的颜色
            const fills = svg.querySelectorAll('[fill]');
            if (fills.length > 0) {
              console.log(`[LottieController] 填充颜色数量: ${fills.length}`);
              for (let i = 0; i < Math.min(3, fills.length); i++) {
                console.log(`[LottieController] 填充 ${i+1}: ${fills[i].getAttribute('fill')}`);
              }
            }

            if (shapes.length === 0) {
              console.warn('[LottieController] ⚠️ SVG 中没有找到任何形状元素！');
            }
          }

          resolve(true);
        });

        this.animation.addEventListener('data_failed', (error) => {
          console.error(`[LottieController] 动画加载失败: ${state}`, error);
          this.enabled = false;
          reject(error);
        });

        // 超时处理
        setTimeout(() => {
          if (this.animation && !this.animation.isLoaded) {
            console.error(`[LottieController] 动画加载超时: ${state}`);
            this.enabled = false;
            reject(new Error('Timeout'));
          }
        }, 3000);
      });
      
    } catch (error) {
      console.error(`[LottieController] 加载动画失败:`, error);
      this.enabled = false;
      return false;
    }
  }
  
  // 过渡到新状态（带淡入淡出效果）
  async transitionTo(state, duration = 300) {
    if (!this.enabled) {
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
    if (this.animation) {
      this.animation.destroy();
      this.animation = null;
    }
    this.currentState = null;
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
}

// 创建全局实例
window.LottieController = new LottieController();

console.log('[LottieController] Lottie 控制器模块已加载');
