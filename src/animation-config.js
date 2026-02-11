// 动画配置文件
// 通过 SkinRegistry 获取动画配置，管理状态触发规则

/**
 * 状态触发规则
 */
const triggerRules = {
  // 心情很高时 (>85)
  mood_high: {
    condition: (mood) => mood > 85,
    targetStates: ['happy', 'playing'],
    cooldown: 30000 // 30秒冷却
  },

  // 心情非常高时 (>95)
  mood_very_high: {
    condition: (mood) => mood > 95,
    targetStates: ['exercising', 'playing'],
    cooldown: 45000 // 45秒冷却
  },

  // 心情低时 (<30)
  mood_low: {
    condition: (mood) => mood < 30,
    targetStates: ['sad'],
    cooldown: 60000 // 1分钟冷却
  },

  // 长时间不活动 (5分钟)
  inactive_long: {
    condition: (lastInteraction) => {
      const now = Date.now();
      return (now - lastInteraction) > 5 * 60 * 1000;
    },
    targetStates: ['sleeping'],
    cooldown: 180000 // 3分钟冷却
  },

  // 被长时间忽略 (10分钟)
  ignored_long: {
    condition: (lastInteraction) => {
      const now = Date.now();
      return (now - lastInteraction) > 10 * 60 * 1000;
    },
    targetStates: ['sad'],
    cooldown: 120000 // 2分钟冷却
  },

  // 随机玩耍 (每2-5分钟)
  random_play: {
    condition: () => Math.random() < 0.01, // 每次检查有1%概率触发
    targetStates: ['playing', 'happy'],
    cooldown: 120000 // 2分钟冷却
  },

  // 用户互动
  user_interaction: {
    condition: () => true, // 由外部事件触发
    targetStates: ['happy', 'clicked'],
    cooldown: 5000 // 5秒冷却
  },

  // 运动时间 (整点或半点)
  exercise_time: {
    condition: () => {
      const now = new Date();
      const minutes = now.getMinutes();
      return minutes === 0 || minutes === 30;
    },
    targetStates: ['exercising'],
    cooldown: 3600000 // 1小时冷却
  },

  // 夜间时间 (22:00 - 6:00)
  night_time: {
    condition: () => {
      const now = new Date();
      const hour = now.getHours();
      return hour >= 22 || hour < 6;
    },
    targetStates: ['sleeping'],
    cooldown: 3600000 // 1小时检查一次
  }
};

/**
 * 获取宠物类型的动画配置（委托给 SkinRegistry）
 */
function getAnimationConfig(petType) {
  if (window.SkinRegistry) {
    return window.SkinRegistry.getAnimationConfigForSkin(petType);
  }
  // SkinRegistry 未加载时返回空配置
  console.warn('[AnimationConfig] SkinRegistry 未加载');
  return {};
}

/**
 * 根据当前状态和心情决定下一个状态
 */
function decideNextState(currentState, mood, lastInteractionTime, context = {}) {
  const config = getAnimationConfig(window.PetAnimations?.baseExpression || '🐱');
  const currentConfig = config[currentState] || config.idle || {};

  // 检查是否需要睡觉（夜间或长时间不活动）
  const now = Date.now();
  const inactiveTime = now - (lastInteractionTime || now);

  if (inactiveTime > 5 * 60 * 1000) { // 5分钟不活动
    return { state: 'sleeping', reason: 'inactive_long' };
  }

  const hour = new Date().getHours();
  if (hour >= 22 || hour < 6) { // 夜间
    return { state: 'sleeping', reason: 'night_time' };
  }

  // 根据心情决定状态
  if (mood > 95 && currentState !== 'exercising') {
    return { state: 'exercising', reason: 'mood_very_high' };
  }

  if (mood > 85 && currentState === 'idle') {
    return { state: Math.random() < 0.5 ? 'happy' : 'playing', reason: 'mood_high' };
  }

  if (mood < 30 && currentState !== 'sad') {
    return { state: 'sad', reason: 'mood_low' };
  }

  // 随机触发特殊状态（低概率）
  if (currentState === 'idle' && Math.random() < 0.05) { // 5% 概率
    const specialStates = ['playing', 'exercising'];
    const randomState = specialStates[Math.floor(Math.random() * specialStates.length)];
    return { state: randomState, reason: 'random' };
  }

  // 默认保持当前状态或返回 idle
  if (currentState !== 'idle' && currentConfig.duration) {
    // 如果当前状态有持续时间，播放完成后返回 idle
    return { state: 'idle', reason: 'duration_complete' };
  }

  return { state: currentState, reason: 'maintain' };
}

/**
 * 获取状态对应的动画文件（委托给 SkinRegistry）
 */
function getAnimationFile(state, petType) {
  if (window.SkinRegistry) {
    const animInfo = window.SkinRegistry.getAnimationForState(petType, state);
    if (animInfo) {
      return animInfo.file;
    }
  }
  // 降级：返回默认文件
  return 'happy_cat.json';
}

/**
 * 获取状态的持续时间
 */
function getStateDuration(state, petType) {
  const config = getAnimationConfig(petType);
  const stateConfig = config[state] || config.idle || {};
  return stateConfig.duration || null;
}

/**
 * 检查是否应该触发状态切换
 */
function shouldTriggerTransition(triggerType, context = {}) {
  const rule = triggerRules[triggerType];
  if (!rule) return false;

  // 检查条件
  if (rule.condition && !rule.condition(context)) {
    return false;
  }

  // 检查冷却时间
  const cooldownKey = `trigger_${triggerType}`;
  const lastTrigger = localStorage.getItem(cooldownKey);
  if (lastTrigger) {
    const elapsed = Date.now() - parseInt(lastTrigger);
    if (elapsed < rule.cooldown) {
      return false;
    }
  }

  // 记录触发时间
  localStorage.setItem(cooldownKey, Date.now().toString());
  return true;
}

// 导出
window.AnimationConfig = {
  getAnimationConfig,
  decideNextState,
  getAnimationFile,
  getStateDuration,
  shouldTriggerTransition,
  triggerRules
};

console.log('[AnimationConfig] 动画配置模块已加载');
