// 皮肤注册中心
// 统一管理所有宠物类型的动画配置、路径映射和降级策略

class SkinRegistry {
  constructor() {
    // 所有已注册的皮肤
    this.skins = new Map();

    // emoji → skinId 映射
    this.emojiToSkin = new Map();

    // 动画基础路径
    this.animationBasePath = 'lottie';

    // 注册默认皮肤
    this._registerDefaults();

    console.log('[SkinRegistry] 皮肤注册中心已创建');
  }

  _getCatLottieFiles() {
    const fromBridge = window.electron && typeof window.electron.listLottieJsonFiles === 'function'
      ? window.electron.listLottieJsonFiles('cat')
      : [];

    if (Array.isArray(fromBridge) && fromBridge.length > 0) {
      return fromBridge;
    }

    // 降级默认列表（桥接不可用时）
    return ['举腿.json', '举重.json', '猫坐在枕头上.json', '玩球.json', '睡觉.json', '骑扫帚.json'];
  }

  _buildCatAnimations() {
    const files = this._getCatLottieFiles();
    const uniqueFiles = Array.from(new Set(files.filter(Boolean)));
    const hasFile = (name) => uniqueFiles.includes(name);
    const pickDefault = (...candidates) => candidates.find(hasFile) || uniqueFiles[0] || '猫坐在枕头上.json';
    const defaultIdleFile = pickDefault('猫坐在枕头上.json', '睡觉.json');

    const animations = {};

    // 1) 动态状态：按文件名生成，后续新增 JSON 自动同步到菜单
    uniqueFiles.forEach((file) => {
      const stateName = file.replace(/\.json$/i, '').trim();
      if (!stateName) return;
      animations[stateName] = {
        file,
        loop: true,
        priority: 6,
        transitions: ['idle'],
        description: `动态状态: ${stateName}`
      };
    });

    // 2) 兼容现有英文状态（供自动状态机和交互逻辑使用）
    animations.idle = {
      file: defaultIdleFile,
      loop: true,
      priority: 0,
      transitions: ['happy', 'sleeping', 'playing', 'exercising'],
      description: '待机状态，默认加载猫坐在枕头上'
    };
    animations.happy = {
      file: pickDefault('玩球.json', defaultIdleFile),
      loop: true,
      priority: 10,
      transitions: ['idle'],
      triggers: ['mood_high', 'user_interaction', 'praise'],
      minDisplayTime: 5000,
      description: '开心状态'
    };
    animations.sleeping = {
      file: pickDefault('睡觉.json', '猫坐在枕头上.json', defaultIdleFile),
      loop: true,
      priority: 5,
      transitions: ['idle', 'happy'],
      triggers: ['inactive_long', 'night_time', 'manual'],
      wakeTriggers: ['user_interaction', 'loud_noise'],
      description: '睡觉状态'
    };
    animations.exercising = {
      files: uniqueFiles.filter(f => f === '举重.json' || f === '举腿.json'),
      file: pickDefault('举重.json', '举腿.json', defaultIdleFile),
      loop: false,
      priority: 8,
      transitions: ['idle', 'happy'],
      triggers: ['mood_very_high', 'exercise_time', 'random'],
      onComplete: 'idle',
      description: '锻炼状态'
    };
    animations.playing = {
      file: pickDefault('骑扫帚.json', defaultIdleFile),
      loop: false,
      priority: 7,
      transitions: ['idle', 'happy'],
      triggers: ['random_play', 'mood_high', 'user_interaction'],
      onComplete: 'idle',
      description: '玩耍状态'
    };
    animations.thinking = {
      file: defaultIdleFile,
      loop: true,
      priority: 9,
      transitions: ['idle', 'talking'],
      triggers: ['question_asked', 'processing'],
      minDisplayTime: 2000,
      description: '思考状态'
    };
    animations.talking = {
      file: defaultIdleFile,
      loop: true,
      priority: 10,
      transitions: ['idle', 'thinking'],
      triggers: ['conversation_active'],
      description: '聊天状态'
    };
    animations.dragging = {
      file: defaultIdleFile,
      loop: true,
      priority: 15,
      transitions: ['idle'],
      triggers: ['drag_start'],
      description: '拖拽状态'
    };
    animations.clicked = {
      file: pickDefault('玩球.json', defaultIdleFile),
      loop: false,
      priority: 12,
      transitions: ['happy'],
      triggers: ['click'],
      onComplete: 'happy',
      description: '点击状态'
    };
    animations.sad = {
      file: defaultIdleFile,
      loop: true,
      priority: 8,
      transitions: ['idle'],
      triggers: ['mood_low', 'ignored_long'],
      duration: 5000,
      description: '伤心状态'
    };

    console.log(`[SkinRegistry] 猫皮肤动态加载 JSON: ${uniqueFiles.length} 个`, uniqueFiles);
    return animations;
  }

  // 注册默认皮肤配置
  _registerDefaults() {
    // 猫咪 - 有完整 Lottie 动画
    this.register({
      id: 'cat',
      name: '猫咪',
      emoji: '🐱',
      folder: 'cat',
      hasLottie: true,
      animations: this._buildCatAnimations()
    });

    // 狗狗 - 暂无 Lottie 动画
    this.register({
      id: 'dog',
      name: '狗狗',
      emoji: '🐶',
      folder: 'dog',
      hasLottie: false,
      animations: {}
    });

    // 兔子 - 暂无 Lottie 动画
    this.register({
      id: 'rabbit',
      name: '兔子',
      emoji: '🐰',
      folder: 'rabbit',
      hasLottie: false,
      animations: {}
    });

    // 狐狸 - 暂无 Lottie 动画
    this.register({
      id: 'fox',
      name: '狐狸',
      emoji: '🦊',
      folder: 'fox',
      hasLottie: false,
      animations: {}
    });

    // 熊 - 暂无 Lottie 动画
    this.register({
      id: 'bear',
      name: '熊',
      emoji: '🐻',
      folder: 'bear',
      hasLottie: false,
      animations: {}
    });
  }

  // 注册皮肤
  register(skinConfig) {
    if (!skinConfig.id || !skinConfig.emoji) {
      console.error('[SkinRegistry] 皮肤配置缺少必要字段 (id, emoji)');
      return false;
    }

    this.skins.set(skinConfig.id, skinConfig);
    this.emojiToSkin.set(skinConfig.emoji, skinConfig.id);

    console.log(`[SkinRegistry] 注册皮肤: ${skinConfig.name} (${skinConfig.emoji})`);
    return true;
  }

  // 通过 emoji 获取 skinId
  getSkinIdByEmoji(emoji) {
    return this.emojiToSkin.get(emoji) || 'cat';
  }

  // 通过 skinId 获取皮肤配置
  getSkin(skinId) {
    return this.skins.get(skinId) || this.skins.get('cat');
  }

  // 通过 emoji 获取皮肤配置
  getSkinByEmoji(emoji) {
    const skinId = this.getSkinIdByEmoji(emoji);
    return this.getSkin(skinId);
  }

  // 检查皮肤是否支持 Lottie
  hasLottieSupport(emojiOrSkinId) {
    const skin = this.skins.has(emojiOrSkinId)
      ? this.skins.get(emojiOrSkinId)
      : this.getSkinByEmoji(emojiOrSkinId);
    return skin ? skin.hasLottie : false;
  }

  // 获取指定状态的动画配置（含降级逻辑）
  getAnimationForState(emojiOrSkinId, state) {
    const skin = this.skins.has(emojiOrSkinId)
      ? this.skins.get(emojiOrSkinId)
      : this.getSkinByEmoji(emojiOrSkinId);

    if (!skin || !skin.hasLottie) {
      return null; // 无 Lottie 支持，调用方应使用 Emoji 模式
    }

    const animations = skin.animations;

    // 优先使用请求的状态
    let animConfig = animations[state];

    // 降级：请求的状态无动画 → 使用 idle
    if (!animConfig) {
      console.log(`[SkinRegistry] 皮肤 ${skin.id} 无 ${state} 动画，降级到 idle`);
      animConfig = animations.idle;
    }

    // idle 也没有 → 该皮肤不支持 Lottie
    if (!animConfig) {
      console.warn(`[SkinRegistry] 皮肤 ${skin.id} 无任何动画配置`);
      return null;
    }

    // 解析动画文件名
    let fileName;
    if (animConfig.files && animConfig.files.length > 0) {
      // 多个动画随机选择
      const index = Math.floor(Math.random() * animConfig.files.length);
      fileName = animConfig.files[index];
    } else {
      fileName = animConfig.file;
    }

    if (!fileName) {
      console.warn(`[SkinRegistry] 皮肤 ${skin.id} 状态 ${state} 无动画文件`);
      return null;
    }

    return {
      path: `${this.animationBasePath}/${skin.folder}/${fileName}`,
      file: fileName,
      folder: skin.folder,
      loop: animConfig.loop !== undefined ? animConfig.loop : true,
      priority: animConfig.priority || 0,
      transitions: animConfig.transitions || [],
      triggers: animConfig.triggers || [],
      onComplete: animConfig.onComplete || null,
      minDisplayTime: animConfig.minDisplayTime || null,
      duration: animConfig.duration || null,
      description: animConfig.description || '',
      // 原始配置引用
      _raw: animConfig
    };
  }

  // 获取指定皮肤的所有状态动画配置（兼容旧 AnimationConfig 接口）
  getAnimationConfigForSkin(emojiOrSkinId) {
    const skin = this.skins.has(emojiOrSkinId)
      ? this.skins.get(emojiOrSkinId)
      : this.getSkinByEmoji(emojiOrSkinId);

    if (!skin || !skin.hasLottie) {
      // 返回空配置
      return {};
    }

    // 转换为旧格式兼容
    const config = {};
    for (const [state, animConfig] of Object.entries(skin.animations)) {
      config[state] = {
        animation: animConfig.file || null,
        animations: animConfig.files || null,
        loop: animConfig.loop !== undefined ? animConfig.loop : true,
        priority: animConfig.priority || 0,
        transitions: animConfig.transitions || [],
        triggers: animConfig.triggers || [],
        onComplete: animConfig.onComplete || null,
        minDisplayTime: animConfig.minDisplayTime || null,
        duration: animConfig.duration || null,
        description: animConfig.description || ''
      };
    }

    return config;
  }

  // 标记皮肤 Lottie 不可用（运行时降级）
  markLottieUnavailable(emojiOrSkinId) {
    const skin = this.skins.has(emojiOrSkinId)
      ? this.skins.get(emojiOrSkinId)
      : this.getSkinByEmoji(emojiOrSkinId);

    if (skin) {
      console.warn(`[SkinRegistry] 标记皮肤 ${skin.id} Lottie 不可用，切换到 Emoji 模式`);
      skin.hasLottie = false;
    }
  }

  // 获取所有已注册的皮肤列表
  getAllSkins() {
    return Array.from(this.skins.values());
  }

  // 获取所有支持 Lottie 的皮肤
  getLottieSkins() {
    return this.getAllSkins().filter(s => s.hasLottie);
  }

  // 获取所有仅 Emoji 的皮肤
  getEmojiOnlySkins() {
    return this.getAllSkins().filter(s => !s.hasLottie);
  }
}

// 创建全局实例
window.SkinRegistry = new SkinRegistry();

console.log('[SkinRegistry] 皮肤注册中心模块已加载');
