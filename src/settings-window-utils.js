function getSettingsSnapshot(storage) {
  const petData = storage.getPetData ? storage.getPetData() : {};
  const settings = storage.getSettings ? storage.getSettings() : {};
  return {
    pet: petData.emoji || '🐱',
    personality: petData.personality || 'healing',
    mood: Number.isFinite(petData.mood) ? petData.mood : 80,
    autoSpeak: settings.autoSpeak !== false,
    bubbleStateOffsets: settings.bubbleStateOffsets || { idle: { x: 0, y: 8 } },
    bubblePreviewState: settings.bubblePreviewState || 'idle'
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

const api = {
  getSettingsSnapshot,
  setPetSelection,
  setPersonalitySelection,
  setAutoSpeakEnabled,
  saveBubbleStateOffsets,
  setBubblePreviewState
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SettingsWindowUtils = api;
}
