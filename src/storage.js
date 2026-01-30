// 本地存储管理模块

const STORAGE_KEYS = {
  PET_DATA: 'pet_data',
  CHAT_HISTORY: 'chat_history',
  SETTINGS: 'settings'
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
    selectedPet: '🐱'
  }
};

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
    return settings ? { ...DEFAULTS.settings, ...JSON.parse(settings) } : { ...DEFAULTS.settings };
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

// 重置所有数据
function resetAllData() {
  try {
    localStorage.removeItem(STORAGE_KEYS.PET_DATA);
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
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
    const decay = Math.floor(hoursSinceLastInteraction / 2) * 10;
    return setMood(petData.mood - decay);
  }

  return petData.mood;
}

// 导出所有功能
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
  resetAllData,
  checkMoodDecay
};
