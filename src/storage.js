// 本地存储管理模块

const STORAGE_KEYS = {
  PET_DATA: 'pet_data',
  CHAT_HISTORY: 'chat_history',
  SETTINGS: 'settings',
  INTIMACY: 'pet_intimacy'
};

const DEFAULT_BUBBLE_STATE_OFFSETS = {
  idle: { x: 0, y: 8 }
};

const DEFAULT_LLM_SCENE_CONFIG = {
  chat: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  agent: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  vision: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  translate: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  ocr: { provider: 'tesseract', model: 'tesseract', apiKeyMode: 'provider-fallback' }
};

// 默认值
const DEFAULTS = {
  pet: {
    emoji: '🐱',
    personality: 'healing',
    mood: 80,
    lastInteraction: Date.now()
  },
  settings: {
    autoSpeak: true,
    selectedPet: '🐱',
    bubbleStateOffsets: DEFAULT_BUBBLE_STATE_OFFSETS,
    bubblePreviewState: 'idle',
    llmSceneConfig: DEFAULT_LLM_SCENE_CONFIG
  }
};

function normalizeBubbleStateOffsets(offsets) {
  if (!offsets || typeof offsets !== 'object') {
    return { ...DEFAULT_BUBBLE_STATE_OFFSETS };
  }

  const normalized = {};
  for (const [state, offset] of Object.entries(offsets)) {
    if (!offset || typeof offset !== 'object') continue;
    const x = Number(offset.x);
    const y = Number(offset.y);
    normalized[state] = {
      x: Number.isFinite(x) ? Math.max(-200, Math.min(200, Math.round(x))) : 0,
      y: Number.isFinite(y) ? Math.max(-200, Math.min(200, Math.round(y))) : 8
    };
  }

  if (!normalized.idle) {
    normalized.idle = { ...DEFAULT_BUBBLE_STATE_OFFSETS.idle };
  }

  return normalized;
}

function normalizeLLMSceneConfig(sceneConfig) {
  const normalized = {};
  const source = sceneConfig && typeof sceneConfig === 'object' ? sceneConfig : {};

  for (const [scene, fallback] of Object.entries(DEFAULT_LLM_SCENE_CONFIG)) {
    const raw = source[scene] && typeof source[scene] === 'object' ? source[scene] : {};
    const provider = typeof raw.provider === 'string' && raw.provider.trim()
      ? raw.provider.trim().toLowerCase()
      : fallback.provider;
    const model = typeof raw.model === 'string' && raw.model.trim()
      ? raw.model.trim()
      : fallback.model;
    const apiKeyMode = raw.apiKeyMode === 'scene' ? 'scene' : 'provider-fallback';
    normalized[scene] = { provider, model, apiKeyMode };
  }

  return normalized;
}

// 获取宠物数据
function getPetData() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PET_DATA);
    if (data) {
      return { ...DEFAULTS.pet, ...JSON.parse(data) };
    }
    return { ...DEFAULTS.pet };
  } catch (error) {
    console.error('Error reading pet data:', error);
    return { ...DEFAULTS.pet };
  }
}

// 保存宠物数据
function savePetData(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.PET_DATA, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Error saving pet data:', error);
    return false;
  }
}

// 更新心情值
function updateMood(delta) {
  const petData = getPetData();
  petData.mood = Math.max(0, Math.min(100, petData.mood + delta));
  petData.lastInteraction = Date.now();
  savePetData(petData);
  return petData.mood;
}

// 获取心情值
function getMood() {
  return getPetData().mood;
}

// 设置心情值
function setMood(value) {
  const petData = getPetData();
  petData.mood = Math.max(0, Math.min(100, value));
  petData.lastInteraction = Date.now();
  savePetData(petData);
  return petData.mood;
}

// 获取对话历史
function getChatHistory() {
  try {
    const history = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    return history ? JSON.parse(history) : [];
  } catch (error) {
    console.error('Error reading chat history:', error);
    return [];
  }
}

// 保存对话历史
function saveChatHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(history));
    return true;
  } catch (error) {
    console.error('Error saving chat history:', error);
    return false;
  }
}

// 添加一条对话记录
function addChatMessage(role, content) {
  const history = getChatHistory();
  history.push({
    role,
    content,
    timestamp: Date.now()
  });

  // 限制历史记录数量（最多保存500条）
  if (history.length > 500) {
    history.splice(0, history.length - 500);
  }

  saveChatHistory(history);
  return history;
}

// 清空对话历史
function clearChatHistory() {
  try {
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    return true;
  } catch (error) {
    console.error('Error clearing chat history:', error);
    return false;
  }
}

// 获取设置
function getSettings() {
  try {
    const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!settings) return { ...DEFAULTS.settings };

    const parsed = JSON.parse(settings);
    const merged = { ...DEFAULTS.settings, ...parsed };
    merged.bubbleStateOffsets = normalizeBubbleStateOffsets(parsed.bubbleStateOffsets || DEFAULTS.settings.bubbleStateOffsets);
    if (typeof merged.bubblePreviewState !== 'string' || !merged.bubblePreviewState) {
      merged.bubblePreviewState = 'idle';
    }
    merged.llmSceneConfig = normalizeLLMSceneConfig(parsed.llmSceneConfig);
    return merged;
  } catch (error) {
    console.error('Error reading settings:', error);
    return { ...DEFAULTS.settings };
  }
}

// 保存设置
function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// 更新单个设置项
function updateSetting(key, value) {
  const settings = getSettings();
  settings[key] = value;
  return saveSettings(settings);
}

function getBubbleStateOffsets() {
  return getSettings().bubbleStateOffsets || { ...DEFAULT_BUBBLE_STATE_OFFSETS };
}

function saveBubbleStateOffsets(offsets) {
  const settings = getSettings();
  settings.bubbleStateOffsets = normalizeBubbleStateOffsets(offsets);
  return saveSettings(settings);
}

function getBubblePreviewState() {
  return getSettings().bubblePreviewState || 'idle';
}

function setBubblePreviewState(state) {
  if (!state || typeof state !== 'string') return false;
  const settings = getSettings();
  settings.bubblePreviewState = state;
  return saveSettings(settings);
}

function getLLMSceneConfig() {
  return getSettings().llmSceneConfig || normalizeLLMSceneConfig();
}

function saveLLMSceneConfig(sceneConfig) {
  const settings = getSettings();
  settings.llmSceneConfig = normalizeLLMSceneConfig(sceneConfig);
  return saveSettings(settings);
}

// 重置所有数据
function resetAllData() {
  try {
    localStorage.removeItem(STORAGE_KEYS.PET_DATA);
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    localStorage.removeItem(STORAGE_KEYS.INTIMACY);
    const dynamicKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (typeof key === 'string' && (key.startsWith('chat_points_') || key.startsWith('task_rewarded_'))) {
        dynamicKeys.push(key);
      }
    }
    dynamicKeys.forEach((key) => localStorage.removeItem(key));
    return true;
  } catch (error) {
    console.error('Error resetting data:', error);
    return false;
  }
}

// 检查并更新心情值（定时调用）
function checkMoodDecay() {
  const petData = getPetData();
  const now = Date.now();
  const hoursSinceLastInteraction = (now - petData.lastInteraction) / (1000 * 60 * 60);

  // 每2小时无互动，心情值降低10分
  if (hoursSinceLastInteraction >= 2) {
    // 计算本次应衰减的量（每满2小时衰减10分）
    const decayPeriods = Math.floor(hoursSinceLastInteraction / 2);
    const decay = decayPeriods * 10;
    // 更新 lastInteraction 为已消耗的衰减周期结束时间，避免重复衰减
    petData.lastInteraction = petData.lastInteraction + decayPeriods * 2 * 60 * 60 * 1000;
    petData.mood = Math.max(0, Math.min(100, petData.mood - decay));
    savePetData(petData);
    return petData.mood;
  }

  return petData.mood;
}

// 导出所有功能
// 读取亲密度数据
function getIntimacy() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INTIMACY);
    const defaults = { points: 0, level: 1, lastLoginDate: '', totalDays: 0, lastChatTime: 0 };
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch (error) {
    console.error('Error reading intimacy data:', error);
    return { points: 0, level: 1, lastLoginDate: '', totalDays: 0, lastChatTime: 0 };
  }
}

// 保存亲密度数据
function saveIntimacy(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.INTIMACY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Error saving intimacy data:', error);
    return false;
  }
}

// 增加积分并计算等级，返回最新等级信息
function addPoints(amount) {
  const LEVELS = [0, 100, 300, 600, 1000, 1500];
  const data = getIntimacy();
  const oldLevel = data.level || 1;
  data.points = Math.max(0, (data.points || 0) + amount);

  let newLevel = 1;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (data.points >= LEVELS[i]) {
      newLevel = i + 1;
      break;
    }
  }

  data.level = newLevel;
  saveIntimacy(data);
  return { newPoints: data.points, newLevel, levelUp: newLevel > oldLevel };
}

window.PetStorage = {
  getPetData,
  savePetData,
  updateMood,
  getMood,
  setMood,
  getChatHistory,
  saveChatHistory,
  addChatMessage,
  clearChatHistory,
  getSettings,
  saveSettings,
  updateSetting,
  getBubbleStateOffsets,
  saveBubbleStateOffsets,
  getBubblePreviewState,
  setBubblePreviewState,
  getLLMSceneConfig,
  saveLLMSceneConfig,
  getIntimacy,
  saveIntimacy,
  addPoints,
  resetAllData,
  checkMoodDecay
};
