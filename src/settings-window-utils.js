function getSettingsSnapshot(storage) {
  const petData = storage.getPetData ? storage.getPetData() : {};
  const settings = storage.getSettings ? storage.getSettings() : {};
  const llmSceneConfig = settings.llmSceneConfig || {
    chat: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
    agent: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
    vision: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
    translate: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
    ocr: { provider: 'tesseract', model: 'tesseract', apiKeyMode: 'provider-fallback' }
  };
  return {
    pet: petData.emoji || '🐱',
    personality: petData.personality || 'healing',
    mood: Number.isFinite(petData.mood) ? petData.mood : 80,
    autoSpeak: settings.autoSpeak !== false,
    bubbleStateOffsets: settings.bubbleStateOffsets || { idle: { x: 0, y: 8 } },
    bubblePreviewState: settings.bubblePreviewState || 'idle',
    llmSceneConfig
  };
}

function setPetSelection(storage, pet) {
  const petData = storage.getPetData ? storage.getPetData() : {};
  petData.emoji = pet;
  if (storage.savePetData) {
    storage.savePetData(petData);
  }
}

function setPersonalitySelection(storage, personality) {
  const petData = storage.getPetData ? storage.getPetData() : {};
  petData.personality = personality;
  if (storage.savePetData) {
    storage.savePetData(petData);
  }
  if (storage.clearChatHistory) {
    storage.clearChatHistory();
  }
}

function setMoodValue(storage, mood) {
  const numeric = Number(mood);
  const normalizedMood = Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 80;

  if (storage.setMood) {
    return storage.setMood(normalizedMood);
  }

  const petData = storage.getPetData ? storage.getPetData() : {};
  petData.mood = normalizedMood;
  petData.lastInteraction = Date.now();
  if (storage.savePetData) {
    storage.savePetData(petData);
  }
  return normalizedMood;
}

function setAutoSpeakEnabled(storage, enabled) {
  const settings = storage.getSettings ? storage.getSettings() : {};
  settings.autoSpeak = !!enabled;
  if (storage.saveSettings) {
    storage.saveSettings(settings);
  }
}

function saveBubbleStateOffsets(storage, offsets) {
  if (storage.saveBubbleStateOffsets) {
    storage.saveBubbleStateOffsets(offsets);
    return;
  }
  const settings = storage.getSettings ? storage.getSettings() : {};
  settings.bubbleStateOffsets = offsets;
  if (storage.saveSettings) {
    storage.saveSettings(settings);
  }
}

function setBubblePreviewState(storage, state) {
  if (storage.setBubblePreviewState) {
    storage.setBubblePreviewState(state);
    return;
  }
  const settings = storage.getSettings ? storage.getSettings() : {};
  settings.bubblePreviewState = state;
  if (storage.saveSettings) {
    storage.saveSettings(settings);
  }
}

function saveLLMSceneConfig(storage, sceneConfig) {
  if (storage.saveLLMSceneConfig) {
    storage.saveLLMSceneConfig(sceneConfig);
    return;
  }
  const settings = storage.getSettings ? storage.getSettings() : {};
  settings.llmSceneConfig = sceneConfig;
  if (storage.saveSettings) {
    storage.saveSettings(settings);
  }
}

const api = {
  getSettingsSnapshot,
  setPetSelection,
  setPersonalitySelection,
  setMoodValue,
  setAutoSpeakEnabled,
  saveBubbleStateOffsets,
  setBubblePreviewState,
  saveLLMSceneConfig
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SettingsWindowUtils = api;
}
