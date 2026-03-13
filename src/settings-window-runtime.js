const SettingsUtils = window.SettingsWindowUtils;
const PROVIDER_OPTIONS = [
  { id: 'deepseek', name: 'DeepSeek', models: 'deepseek-chat, deepseek-reasoner' },
  { id: 'openai', name: 'OpenAI', models: 'gpt-4o, gpt-4o-mini, o1-mini' },
  { id: 'openrouter', name: 'OpenRouter', models: 'openai/gpt-4o-mini, anthropic/claude-3.5-sonnet' },
  { id: 'siliconflow', name: 'SiliconFlow', models: 'Qwen/Qwen2.5-72B-Instruct' },
  { id: 'glm', name: 'GLM', models: 'glm-4-flash, glm-4-plus' },
  { id: 'qwen', name: 'Qwen（通义千问）', models: 'qwen-turbo, qwen-plus, qwen-max, qwen-long' },
  { id: 'tesseract', name: 'Tesseract（本地）', models: 'tesseract' }
];
const SCENE_DEFINITIONS = [
  { id: 'chat', label: '聊天', description: '普通对话与陪伴交流。', defaultProvider: 'deepseek', defaultModel: 'deepseek-chat' },
  { id: 'agent', label: 'Agent', description: '任务规划、工具调用、执行型请求。', defaultProvider: 'deepseek', defaultModel: 'deepseek-chat' },
  { id: 'vision', label: '视觉', description: '看图、截图理解、图像分析。', defaultProvider: 'deepseek', defaultModel: 'deepseek-chat' },
  { id: 'translate', label: '翻译', description: '文本翻译与截图翻译。', defaultProvider: 'deepseek', defaultModel: 'deepseek-chat' },
  { id: 'ocr', label: 'OCR', description: '文字识别。', defaultProvider: 'tesseract', defaultModel: 'tesseract' }
];
const DEFAULT_SCENE_CONFIG = Object.fromEntries(SCENE_DEFINITIONS.map((scene) => [scene.id, {
  provider: scene.defaultProvider,
  model: scene.defaultModel,
  apiKeyMode: 'provider-fallback'
}]));
const THEME_FALLBACK_ID = 'classic';

let allFacts = [];
let activeSectionId = 'pet';
let activeSceneTab = 'chat';
let bubbleOffsets = { idle: { x: 0, y: 8 } };
let currentBubbleState = 'idle';
let intimacyWidgetOffset = { x: 0, y: 0 };
let bubblePreviewHideTimer = null;
let llmSceneConfig = JSON.parse(JSON.stringify(DEFAULT_SCENE_CONFIG));
let providerKeyInfo = {};
let sceneKeyStatusMap = {};
let weatherDefaultCity = '';
let toastTimer = null;
let bubbleDebugStates = [];
let currentMoodValue = 80;
let savedMoodValue = 80;
const INTIMACY_LEVELS = [0, 100, 300, 600, 1000, 1500, 99999];

function showToast(message, isError = false) {
  const toast = document.getElementById('messageToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}

function sendSettingsChange(payload) {
  if (window.electron && window.electron.sendSettingsChange) {
    window.electron.sendSettingsChange(payload);
  }
}

function switchSection(sectionId) {
  activeSectionId = sectionId;
  document.querySelectorAll('.sidebar-item').forEach((item) => item.classList.toggle('active', item.dataset.section === sectionId));
  document.querySelectorAll('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.section === sectionId));
  if (sectionId === 'memory') onMemoryPanelOpen();
  if (sectionId === 'ritual') loadRitualSettings();
}

function parseRitualTime(value, fallbackHour, fallbackMinute) {
  const [rawHour, rawMinute] = String(value || '').split(':');
  const hour = Number.parseInt(rawHour, 10);
  const minute = Number.parseInt(rawMinute, 10);
  return {
    hour: Number.isFinite(hour) ? hour : fallbackHour,
    minute: Number.isFinite(minute) ? minute : fallbackMinute
  };
}

function loadRitualSettings() {
  try {
    const raw = localStorage.getItem('ritual_settings');
    const settings = raw ? JSON.parse(raw) : {};
    const morningEnabled = document.getElementById('morningEnabled');
    const morningTime = document.getElementById('morningTime');
    const eveningEnabled = document.getElementById('eveningEnabled');
    const eveningTime = document.getElementById('eveningTime');
    const weeklyEnabled = document.getElementById('weeklyEnabled');
    const weeklyDay = document.getElementById('weeklyDay');
    const weeklyTime = document.getElementById('weeklyTime');
    if (!morningEnabled || !morningTime || !eveningEnabled || !eveningTime || !weeklyEnabled || !weeklyDay || !weeklyTime) return;

    morningEnabled.checked = settings.morningEnabled !== false;
    morningTime.value = `${String(settings.morningHour ?? 8).padStart(2, '0')}:${String(settings.morningMinute ?? 0).padStart(2, '0')}`;
    eveningEnabled.checked = settings.eveningEnabled !== false;
    eveningTime.value = `${String(settings.eveningHour ?? 22).padStart(2, '0')}:${String(settings.eveningMinute ?? 0).padStart(2, '0')}`;
    weeklyEnabled.checked = settings.weeklyEnabled !== false;
    weeklyDay.value = String(settings.weeklyDay ?? 0);
    weeklyTime.value = `${String(settings.weeklyHour ?? 20).padStart(2, '0')}:${String(settings.weeklyMinute ?? 0).padStart(2, '0')}`;
  } catch (error) {
    console.warn('[Settings] Failed to load ritual settings:', error);
  }
}

function saveRitualSettings() {
  try {
    const morning = parseRitualTime(document.getElementById('morningTime')?.value, 8, 0);
    const evening = parseRitualTime(document.getElementById('eveningTime')?.value, 22, 0);
    const weekly = parseRitualTime(document.getElementById('weeklyTime')?.value, 20, 0);
    const settings = {
      morningEnabled: !!document.getElementById('morningEnabled')?.checked,
      morningHour: morning.hour,
      morningMinute: morning.minute,
      eveningEnabled: !!document.getElementById('eveningEnabled')?.checked,
      eveningHour: evening.hour,
      eveningMinute: evening.minute,
      weeklyEnabled: !!document.getElementById('weeklyEnabled')?.checked,
      weeklyDay: Number.parseInt(document.getElementById('weeklyDay')?.value || '0', 10),
      weeklyHour: weekly.hour,
      weeklyMinute: weekly.minute
    };
    localStorage.setItem('ritual_settings', JSON.stringify(settings));
    showToast('仪式感设置已保存');
  } catch (error) {
    console.error('[Settings] Failed to save ritual settings:', error);
    showToast('仪式感设置保存失败', true);
  }
}

async function testRitual(type) {
  try {
    if (!window.PetRitual || typeof window.PetRitual.manualTrigger !== 'function') {
      throw new Error('PetRitual bridge unavailable');
    }
    const result = await window.PetRitual.manualTrigger(type);
    if (!result || result.success === false) {
      throw new Error(result?.error || 'manual trigger failed');
    }
    showToast('已触发预览');
  } catch (error) {
    console.error('[Settings] Test ritual failed:', error);
    showToast('预览触发失败', true);
  }
}

function getLevelTitle(level) {
  const titles = ['', '陌生人', '新朋友', '好朋友', '知心朋友', '灵魂伴侣', '命中注定'];
  return titles[level] || `Lv${level}`;
}

function buildMilestoneSharePayload() {
  if (!window.PetStorage || typeof window.PetStorage.getIntimacy !== 'function') {
    throw new Error('PetStorage intimacy API unavailable');
  }

  const intimacy = window.PetStorage.getIntimacy();
  const level = Math.max(1, Number(intimacy.level) || 1);
  const points = Math.max(0, Number(intimacy.points) || 0);
  const totalDays = Math.max(0, Number(intimacy.totalDays) || 0);
  const currentThreshold = INTIMACY_LEVELS[level - 1] || 0;
  const nextThreshold = INTIMACY_LEVELS[level] || INTIMACY_LEVELS[INTIMACY_LEVELS.length - 1];
  const progress = nextThreshold > currentThreshold
    ? Math.min(100, ((points - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
    : 100;

  let message = '我们的故事才刚开始';
  if (nextThreshold === 99999) {
    message = '已经来到最高羁绊，接下来只管继续并肩前行';
  } else if (progress >= 90) {
    message = '距离下一次升级只差一点点了';
  } else if (totalDays > 0) {
    message = `已经一起走过 ${totalDays} 天，陪伴还在继续升温`;
  }

  return {
    type: 'milestone',
    data: {
      level,
      levelName: getLevelTitle(level),
      message,
      points,
      progressText: `${progress.toFixed(1)}%`,
      totalDays
    }
  };
}

async function generateMilestoneCard(mode) {
  try {
    if (!window.PetShare) {
      throw new Error('PetShare bridge unavailable');
    }

    const payload = buildMilestoneSharePayload();
    const result = mode === 'save'
      ? await window.PetShare.saveCard(payload)
      : await window.PetShare.copyCard(payload);

    if (result?.success) {
      showToast(mode === 'save' ? '里程碑卡已保存' : '里程碑卡已复制到剪贴板');
      return;
    }

    if (!result?.canceled) {
      showToast(result?.error || '生成里程碑卡失败', true);
    }
  } catch (error) {
    console.error('[Settings] generateMilestoneCard failed:', error);
    showToast('生成里程碑卡失败', true);
  }
}

function getSupportedPet() {
  return '🐱';
}

function selectPet(pet) {
  if (pet !== '🐱') {
    showToast('狗狗形象暂未开放', true);
    return;
  }
  document.querySelectorAll('.pet-card').forEach((card) => card.classList.toggle('selected', card.dataset.pet === pet));
  SettingsUtils.setPetSelection(window.PetStorage, pet);
  sendSettingsChange({ type: 'pet', pet });
  showToast('已切换到猫咪');
}

function selectPersonality(personality) {
  document.querySelectorAll('.personality-option').forEach((item) => item.classList.toggle('selected', item.dataset.personality === personality));
  SettingsUtils.setPersonalitySelection(window.PetStorage, personality);
  sendSettingsChange({ type: 'personality', personality });
  showToast('性格已更新，后续对话会使用新风格');
}

function onMoodRangeInput(value) {
  currentMoodValue = Math.max(0, Math.min(100, Number(value) || 0));
  document.getElementById('moodRange').value = currentMoodValue;
  document.getElementById('moodRangeValue').textContent = String(currentMoodValue);
  updateMoodDisplay(currentMoodValue);
}

function updateMoodDisplay(mood) {
  const numeric = Math.max(0, Math.min(100, Number(mood) || 0));
  const display = document.getElementById('moodDisplay');
  document.getElementById('moodRange').value = numeric;
  document.getElementById('moodRangeValue').textContent = String(numeric);
  if (numeric >= 80) display.textContent = '💚 超级开心';
  else if (numeric >= 60) display.textContent = '😊 心情不错';
  else if (numeric >= 40) display.textContent = '😐 比较平静';
  else if (numeric >= 20) display.textContent = '😔 有点低落';
  else display.textContent = '💧 很不开心';
}

function syncMoodState(mood) {
  const numeric = Math.max(0, Math.min(100, Number(mood) || 0));
  currentMoodValue = numeric;
  savedMoodValue = numeric;
  updateMoodDisplay(numeric);
}

function notifyMoodUpdate(mood) {
  sendSettingsChange({ type: 'mood', mood });
  window.dispatchEvent(new CustomEvent('mood-updated', { detail: { mood, source: 'settings' } }));
}

function persistMoodValue(mood, withToast = true) {
  const value = SettingsUtils.setMoodValue
    ? SettingsUtils.setMoodValue(window.PetStorage, mood)
    : Math.max(0, Math.min(100, Number(mood) || 0));
  syncMoodState(value);
  notifyMoodUpdate(value);
  if (withToast) showToast(`心情已设置为 ${value}`);
  return value;
}

function persistPendingMood(withToast = false) {
  if (currentMoodValue === savedMoodValue) return savedMoodValue;
  return persistMoodValue(currentMoodValue, withToast);
}

function setManualMood() {
  const value = Math.max(0, Math.min(100, Number(document.getElementById('moodRange').value) || 0));
  currentMoodValue = value;
  persistMoodValue(value, true);
}

function getBubbleDebugStates() {
  try {
    if (window.electron && typeof window.electron.listLottieJsonFiles === 'function') {
      const files = window.electron.listLottieJsonFiles('cat') || [];
      const states = files
        .filter((name) => typeof name === 'string' && name.toLowerCase().endsWith('.json'))
        .map((name) => name.replace(/\.json$/i, '').trim())
        .filter(Boolean);
      const uniqueStates = Array.from(new Set(states));
      if (uniqueStates.length > 0) return uniqueStates;
    }
  } catch (error) {
    console.warn('[Settings] list Lottie states failed:', error);
  }
  return ['idle'];
}

function clampOffset(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-200, Math.min(200, Math.round(numeric)));
}

function ensureBubbleOffsetState(stateName) {
  if (!bubbleOffsets[stateName]) bubbleOffsets[stateName] = { x: 0, y: 8 };
  return bubbleOffsets[stateName];
}

function applyBubbleOffsetEditors() {
  const offset = ensureBubbleOffsetState(currentBubbleState);
  document.getElementById('bubbleOffsetXInput').value = offset.x;
  document.getElementById('bubbleOffsetXRange').value = offset.x;
  document.getElementById('bubbleOffsetYInput').value = offset.y;
  document.getElementById('bubbleOffsetYRange').value = offset.y;
  document.getElementById('bubbleOffsetXValue').textContent = String(offset.x);
  document.getElementById('bubbleOffsetYValue').textContent = String(offset.y);
}

function persistBubbleOffsets(preview = false) {
  SettingsUtils.saveBubbleStateOffsets(window.PetStorage, bubbleOffsets);
  SettingsUtils.setBubblePreviewState(window.PetStorage, currentBubbleState);
  sendSettingsChange({ type: 'bubble-offset-update', offsets: bubbleOffsets, state: currentBubbleState });
  if (preview) sendSettingsChange({ type: 'bubble-offset-preview', state: currentBubbleState });
}

function clearBubblePreviewHideTimer() {
  if (!bubblePreviewHideTimer) return;
  clearTimeout(bubblePreviewHideTimer);
  bubblePreviewHideTimer = null;
}

function scheduleBubblePreviewHide() {
  clearBubblePreviewHideTimer();
  bubblePreviewHideTimer = setTimeout(() => {
    if (window.electron && window.electron.hideBubble) window.electron.hideBubble();
  }, 3000);
}

function showStickyBubblePreview() {
  if (window.electron && window.electron.sendPetState) {
    window.electron.sendPetState({ state: currentBubbleState });
  }
  if (window.electron && window.electron.showBubble) {
    const offset = ensureBubbleOffsetState(currentBubbleState);
    window.electron.showBubble(`预览状态 ${currentBubbleState}（x:${offset.x}, y:${offset.y}）`, 2800, { sticky: true });
  }
  scheduleBubblePreviewHide();
}

function onBubbleStateChange() {
  currentBubbleState = document.getElementById('bubbleStateSelect').value;
  applyBubbleOffsetEditors();
  SettingsUtils.setBubblePreviewState(window.PetStorage, currentBubbleState);
  persistBubbleOffsets(false);
  showStickyBubblePreview();
}

function onBubbleOffsetInput(axis, value) {
  const offset = ensureBubbleOffsetState(currentBubbleState);
  offset[axis] = clampOffset(value);
  applyBubbleOffsetEditors();
  persistBubbleOffsets(false);
  showStickyBubblePreview();
}

function onBubbleOffsetRange(axis, value) {
  const offset = ensureBubbleOffsetState(currentBubbleState);
  offset[axis] = clampOffset(value);
  applyBubbleOffsetEditors();
  persistBubbleOffsets(false);
  showStickyBubblePreview();
}

function previewBubbleState() {
  persistBubbleOffsets(true);
  showStickyBubblePreview();
}

function resetCurrentBubbleOffset() {
  bubbleOffsets[currentBubbleState] = { x: 0, y: 8 };
  applyBubbleOffsetEditors();
  persistBubbleOffsets(true);
  showStickyBubblePreview();
  showToast('当前状态偏移已重置');
}

function normalizeIntimacyWidgetOffset(offset) {
  return { x: clampOffset(offset && offset.x), y: clampOffset(offset && offset.y) };
}

function applyIntimacyOffsetEditors() {
  const offset = normalizeIntimacyWidgetOffset(intimacyWidgetOffset);
  intimacyWidgetOffset = offset;
  document.getElementById('intimacyOffsetXInput').value = offset.x;
  document.getElementById('intimacyOffsetXRange').value = offset.x;
  document.getElementById('intimacyOffsetYInput').value = offset.y;
  document.getElementById('intimacyOffsetYRange').value = offset.y;
  document.getElementById('intimacyOffsetXValue').textContent = String(offset.x);
  document.getElementById('intimacyOffsetYValue').textContent = String(offset.y);
}

function persistIntimacyWidgetOffset() {
  intimacyWidgetOffset = normalizeIntimacyWidgetOffset(intimacyWidgetOffset);
  SettingsUtils.saveIntimacyWidgetOffset(window.PetStorage, intimacyWidgetOffset);
  sendSettingsChange({ type: 'intimacy-widget-offset-update', offset: intimacyWidgetOffset });
}

function onIntimacyOffsetInput(axis, value) {
  intimacyWidgetOffset[axis] = clampOffset(value);
  applyIntimacyOffsetEditors();
  persistIntimacyWidgetOffset();
}

function onIntimacyOffsetRange(axis, value) {
  intimacyWidgetOffset[axis] = clampOffset(value);
  applyIntimacyOffsetEditors();
  persistIntimacyWidgetOffset();
}

function resetIntimacyWidgetOffset() {
  intimacyWidgetOffset = { x: 0, y: 0 };
  applyIntimacyOffsetEditors();
  persistIntimacyWidgetOffset();
  showToast('亲密度框位置已重置');
}

function onMemoryPanelOpen() {
  loadMemoryStats();
  loadUserProfile();
  loadMemoryFacts();
}

async function loadMemoryStats() {
  try {
    const stats = await window.electron.getMemoryStats();
    if (!stats) return;
    document.getElementById('stat-conversations').textContent = stats.totalConversations ?? '—';
    document.getElementById('stat-active').textContent = stats.activeMemories ?? '—';
    document.getElementById('stat-facts').textContent = stats.totalFacts ?? '—';
    document.getElementById('stat-profile').textContent = stats.profileKeys ?? '—';
  } catch (error) {
    console.error('加载记忆统计失败', error);
  }
}

async function loadUserProfile() {
  const container = document.getElementById('profile-content');
  try {
    const profile = await window.electron.getPetProfile();
    if (!profile) {
      container.innerHTML = '<div class="memory-empty">还没有画像信息，多和宠物聊聊吧~</div>';
      return;
    }

    const typeLabels = {
      name: '姓名',
      gender: '性别',
      age: '年龄',
      birthday: '生日',
      occupation: '职业',
      location: '所在地'
    };
    const items = [];
    Object.entries(typeLabels).forEach(([key, label]) => {
      if (profile[key]) items.push({ key: label, val: profile[key] });
    });
    if (profile.preferences?.length) items.push({ key: '喜欢', val: profile.preferences.join('、') });
    if (profile.dislikes?.length) items.push({ key: '不喜欢', val: profile.dislikes.join('、') });
    if (profile.relationships?.length) items.push({ key: '关系', val: profile.relationships.map((item) => `${item.relation}：${item.target}`).join('、') });
    if (profile.other?.length) profile.other.slice(0, 4).forEach((item) => items.push({ key: item.key, val: item.value }));

    if (items.length === 0) {
      container.innerHTML = '<div class="memory-empty">还没有画像信息，多和宠物聊聊吧~</div>';
      return;
    }

    container.innerHTML = `<div class="profile-grid">${items.map((item) => `<div class="profile-item"><span class="profile-key">${item.key}</span><span class="profile-val">${item.val}</span></div>`).join('')}</div>`;
  } catch (error) {
    console.error('加载用户画像失败', error);
    container.innerHTML = '<div class="memory-empty">加载失败</div>';
  }
}

async function loadMemoryFacts() {
  try {
    allFacts = await window.electron.getMemoryFacts() || [];
    renderFacts(allFacts);
  } catch (error) {
    console.error('加载记忆事实失败', error);
    document.getElementById('facts-list').innerHTML = '<div class="memory-empty">加载失败</div>';
  }
}

function renderFacts(facts) {
  const container = document.getElementById('facts-list');
  if (!facts || facts.length === 0) {
    container.innerHTML = '<div class="memory-empty">还没有提取到记忆事实，多和宠物聊聊吧~</div>';
    return;
  }

  const typeNames = {
    personal: '个人',
    preference: '偏好',
    relationship: '关系',
    event: '事件',
    routine: '习惯'
  };
  container.innerHTML = facts.map((fact) => `<div class="fact-item" data-id="${fact.id}"><span class="fact-type-tag ${fact.fact_type}">${typeNames[fact.fact_type] || fact.fact_type}</span><span class="fact-content">${fact.subject || '用户'}${fact.predicate ? ` ${fact.predicate}` : ''}${fact.object ? `：${fact.object}` : ''}</span><span class="fact-confidence">${Math.round((fact.confidence || 0) * 100)}%</span><button class="fact-delete-btn" onclick="deleteFact('${fact.id}')" title="删除这条记忆">×</button></div>`).join('');
}

async function deleteFact(id) {
  try {
    await window.electron.deleteMemoryFact(id);
    allFacts = allFacts.filter((fact) => String(fact.id) !== String(id));
    const filterEl = document.getElementById('fact-type-filter');
    const filterVal = filterEl ? filterEl.value : '';
    const filtered = filterVal ? allFacts.filter((fact) => fact.fact_type === filterVal) : allFacts;
    renderFacts(filtered);
    const statEl = document.getElementById('stat-facts');
    if (statEl) statEl.textContent = allFacts.length;
  } catch (error) {
    console.error('删除记忆失败', error);
  }
}

function normalizeSceneConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  const normalized = {};
  for (const [sceneId, fallback] of Object.entries(DEFAULT_SCENE_CONFIG)) {
    const raw = source[sceneId] && typeof source[sceneId] === 'object' ? source[sceneId] : {};
    normalized[sceneId] = {
      provider: typeof raw.provider === 'string' && raw.provider.trim() ? raw.provider.trim().toLowerCase() : fallback.provider,
      model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : fallback.model,
      apiKeyMode: raw.apiKeyMode === 'scene' ? 'scene' : 'provider-fallback'
    };
  }
  return normalized;
}

function persistSceneConfig() {
  llmSceneConfig = normalizeSceneConfig(llmSceneConfig);
  SettingsUtils.saveLLMSceneConfig(window.PetStorage, llmSceneConfig);
  sendSettingsChange({ type: 'llm-scene-config', config: llmSceneConfig });
  refreshCredentialSettings().catch((error) => console.error('[Settings] refreshCredentialSettings failed:', error));
}

function getSceneDefinition(sceneId) {
  return SCENE_DEFINITIONS.find((scene) => scene.id === sceneId) || SCENE_DEFINITIONS[0];
}

function getProviderOptionsForScene(sceneId) {
  return sceneId === 'ocr' ? PROVIDER_OPTIONS : PROVIDER_OPTIONS.filter((provider) => provider.id !== 'tesseract');
}

function getCredentialSourceText(source) {
  if (source === 'scene') return '当前生效：场景专属 Key';
  if (source === 'provider') return '当前生效：Provider 默认 Key';
  if (source === 'env') return '当前生效：环境变量';
  return '当前生效：未配置';
}

function getSceneStatus(sceneId) {
  return sceneKeyStatusMap[sceneId] || {
    provider: llmSceneConfig[sceneId]?.provider || DEFAULT_SCENE_CONFIG[sceneId].provider,
    model: llmSceneConfig[sceneId]?.model || DEFAULT_SCENE_CONFIG[sceneId].model,
    apiKeyMode: llmSceneConfig[sceneId]?.apiKeyMode || 'provider-fallback',
    sceneMasked: '',
    sceneConfigured: false,
    activeMasked: '',
    activeConfigured: false,
    activeSource: 'none'
  };
}

function renderSceneTabs() {
  const container = document.getElementById('sceneTabs');
  container.innerHTML = SCENE_DEFINITIONS.map((scene) => `<button type="button" class="scene-tab ${scene.id === activeSceneTab ? 'active' : ''}" onclick="switchSceneTab('${scene.id}')">${scene.label}</button>`).join('');
}

function renderScenePanel() {
  const panel = document.getElementById('sceneConfigPanel');
  const scene = getSceneDefinition(activeSceneTab);
  const config = llmSceneConfig[scene.id] || DEFAULT_SCENE_CONFIG[scene.id];
  const status = getSceneStatus(scene.id);
  const providerOptions = getProviderOptionsForScene(scene.id).map((provider) => `<option value="${provider.id}" ${provider.id === config.provider ? 'selected' : ''}>${provider.name}</option>`).join('');
  const providerMeta = PROVIDER_OPTIONS.find((provider) => provider.id === config.provider);
  panel.innerHTML = `<div class="scene-panel"><div class="scene-panel-header"><div><div class="scene-panel-title">${scene.label}</div><div class="scene-panel-desc">${scene.description}</div></div><div class="scene-source-tag">${getCredentialSourceText(status.activeSource)}</div></div><div class="scene-panel-grid"><div class="scene-field"><label class="input-label">Provider</label><select class="scene-config-select" onchange="onSceneProviderChange('${scene.id}', this.value)">${providerOptions}</select></div><div class="scene-field"><label class="input-label">Model</label><input class="scene-config-input" type="text" value="${config.model || ''}" placeholder="输入模型名" onchange="onSceneModelChange('${scene.id}', this.value)"></div><div class="scene-field full"><label class="input-label"><input type="checkbox" ${config.apiKeyMode === 'scene' ? 'checked' : ''} onchange="onSceneApiKeyModeChange('${scene.id}', this.checked)"> 使用场景专属 API Key</label><div class="scene-hint">${config.apiKeyMode === 'scene' ? (status.sceneConfigured ? `已保存：${status.sceneMasked || '已配置'}` : '已启用场景专属 Key，但暂未保存具体 Key。') : '当前未启用场景专属 Key，将回退到 Provider 默认 Key 或环境变量。'}</div></div><div class="scene-field full"><label class="input-label">场景专属 API Key</label><div class="apikey-input-wrap"><input id="scene-key-input" class="apikey-input" type="password" placeholder="${status.sceneConfigured ? status.sceneMasked : '粘贴该场景专属 API Key'}" autocomplete="off" spellcheck="false"><button class="apikey-toggle-vis" type="button" onclick="toggleSceneApiKeyVis()">◐</button></div><div class="scene-hint">推荐模型：${providerMeta ? providerMeta.models : config.model}</div></div></div><div class="scene-actions"><button class="btn btn-primary btn-small" type="button" onclick="saveSceneApiKey('${scene.id}')">保存场景 Key</button><button class="btn btn-small" type="button" onclick="testSceneApiKey('${scene.id}')">测试当前场景</button></div></div>`;
}

function renderProviderKeyRows(keysInfo) {
  const container = document.getElementById('providerKeyContainer');
  container.innerHTML = PROVIDER_OPTIONS
    .filter((provider) => provider.id !== 'tesseract')
    .map((provider) => {
      const info = keysInfo[provider.id] || { masked: '', configured: false, source: 'none' };
      return `<div><div class="apikey-row" data-provider="${provider.id}"><div class="apikey-label"><span class="apikey-status ${info.configured ? 'configured' : 'not-configured'}">${info.configured ? '●' : '○'}</span>${provider.name}</div><div class="apikey-input-wrap"><input class="apikey-input" id="apikey-${provider.id}" type="password" placeholder="${info.configured ? info.masked : '粘贴 Provider 默认 API Key'}" autocomplete="off" spellcheck="false"><button class="apikey-toggle-vis" type="button" onclick="toggleApiKeyVis('${provider.id}')">◐</button></div><button class="btn btn-primary btn-small" type="button" onclick="saveApiKey('${provider.id}')">保存</button><button class="btn btn-small" type="button" id="apikey-test-${provider.id}" onclick="testApiKey('${provider.id}')" ${info.configured ? '' : 'disabled'}>测试</button></div><div class="apikey-models-hint">来源：${info.source || 'none'}；常用模型：${provider.models}</div></div>`;
    })
    .join('');
}

function switchSceneTab(sceneId) {
  activeSceneTab = sceneId;
  renderSceneTabs();
  renderScenePanel();
}

function toggleApiKeyVis(provider) {
  const input = document.getElementById(`apikey-${provider}`);
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function toggleSceneApiKeyVis() {
  const input = document.getElementById('scene-key-input');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function onSceneProviderChange(sceneId, provider) {
  if (!llmSceneConfig[sceneId]) llmSceneConfig[sceneId] = { ...DEFAULT_SCENE_CONFIG[sceneId] };
  llmSceneConfig[sceneId].provider = (provider || '').trim().toLowerCase() || DEFAULT_SCENE_CONFIG[sceneId].provider;
  persistSceneConfig();
}

function onSceneModelChange(sceneId, model) {
  if (!llmSceneConfig[sceneId]) llmSceneConfig[sceneId] = { ...DEFAULT_SCENE_CONFIG[sceneId] };
  llmSceneConfig[sceneId].model = (model || '').trim() || DEFAULT_SCENE_CONFIG[sceneId].model;
  persistSceneConfig();
}

function onSceneApiKeyModeChange(sceneId, enabled) {
  if (!llmSceneConfig[sceneId]) llmSceneConfig[sceneId] = { ...DEFAULT_SCENE_CONFIG[sceneId] };
  llmSceneConfig[sceneId].apiKeyMode = enabled ? 'scene' : 'provider-fallback';
  persistSceneConfig();
}

async function refreshCredentialSettings() {
  providerKeyInfo = window.electron && window.electron.getAllProviderAPIKeys
    ? await window.electron.getAllProviderAPIKeys()
    : {};
  sceneKeyStatusMap = window.electron && window.electron.getAllSceneKeyStatuses
    ? await window.electron.getAllSceneKeyStatuses(llmSceneConfig)
    : {};
  renderSceneTabs();
  renderScenePanel();
  renderProviderKeyRows(providerKeyInfo);
}

async function saveSceneApiKey(sceneId) {
  const input = document.getElementById('scene-key-input');
  const key = input ? input.value.trim() : '';
  if (!key) {
    showToast('请先输入场景专属 API Key', true);
    return;
  }
  try {
    const result = await window.electron.saveSceneAPIKey(sceneId, key);
    if (result && result.success) {
      input.value = '';
      showToast(`已保存 ${getSceneDefinition(sceneId).label} 场景 Key`);
      await refreshCredentialSettings();
    } else {
      showToast(`保存失败：${result?.error || '未知错误'}`, true);
    }
  } catch (error) {
    console.error('[Settings] saveSceneApiKey failed:', error);
    showToast('保存场景 Key 失败', true);
  }
}

async function testSceneApiKey(sceneId) {
  try {
    const result = await window.electron.testSceneAPIKey(sceneId, llmSceneConfig);
    if (result && result.success) showToast(`${getSceneDefinition(sceneId).label} 测试通过`);
    else showToast(`${getSceneDefinition(sceneId).label} 测试失败：${result?.error || '未知错误'}`, true);
  } catch (error) {
    console.error('[Settings] testSceneApiKey failed:', error);
    showToast('场景测试失败', true);
  }
}

async function saveApiKey(provider) {
  const input = document.getElementById(`apikey-${provider}`);
  const key = input ? input.value.trim() : '';
  if (!key) {
    showToast('请先输入 Provider API Key', true);
    return;
  }
  try {
    const result = await window.electron.saveProviderAPIKey(provider, key);
    if (result && result.success) {
      input.value = '';
      showToast(`已保存 ${provider} 默认 API Key`);
      await refreshCredentialSettings();
    } else {
      showToast(`保存失败：${result?.error || '未知错误'}`, true);
    }
  } catch (error) {
    console.error('[Settings] saveApiKey failed:', error);
    showToast('保存 Provider API Key 失败', true);
  }
}

async function testApiKey(provider) {
  try {
    const result = await window.electron.testProviderAPIKey(provider);
    if (result && result.success) showToast(`${provider} 测试通过`);
    else showToast(`${provider} 测试失败：${result?.error || '未知错误'}`, true);
  } catch (error) {
    console.error('[Settings] testApiKey failed:', error);
    showToast('Provider 测试失败', true);
  }
}

function getCurrentThemeId() {
  if (!window.ThemeManager) return THEME_FALLBACK_ID;
  if (typeof window.ThemeManager.getCurrent === 'function') return window.ThemeManager.getCurrent() || THEME_FALLBACK_ID;
  return THEME_FALLBACK_ID;
}

function updateThemeSelection() {
  const themeId = getCurrentThemeId();
  document.querySelectorAll('.theme-card').forEach((card) => card.classList.toggle('active', card.dataset.theme === themeId));
}

function selectTheme(themeId) {
  try {
    if (!window.ThemeManager) {
      showToast('主题管理器未加载', true);
      return;
    }
    if (typeof window.ThemeManager.setTheme === 'function') window.ThemeManager.setTheme(themeId);
    else if (typeof window.ThemeManager.save === 'function') window.ThemeManager.save(themeId);
    else if (typeof window.ThemeManager.apply === 'function') window.ThemeManager.apply(themeId);
    updateThemeSelection();
    showToast('主题已切换');
  } catch (error) {
    console.error('[Settings] selectTheme failed:', error);
    showToast('切换主题失败', true);
  }
}

function renderWeatherDefaultCity() {
  const input = document.getElementById('weatherDefaultCityInput');
  if (input) input.value = weatherDefaultCity || '';
}

function setLocationStatus(message, isError = false) {
  const status = document.getElementById('locationStatus');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('error', !!isError);
}

function pickCityName(address) {
  if (!address || typeof address !== 'object') return '';
  return address.city || address.town || address.village || address.municipality || address.county || address.state || '';
}

async function autoLocateWeather() {
  if (!navigator.geolocation) {
    setLocationStatus('当前环境不支持定位，请手动输入', true);
    return;
  }
  setLocationStatus('正在定位…');
  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json&accept-language=zh-CN`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`reverse geocode failed: ${response.status}`);
      const data = await response.json();
      const cityName = pickCityName(data.address);
      if (!cityName) throw new Error('city_not_found');
      document.getElementById('weatherDefaultCityInput').value = cityName;
      setLocationStatus(`已定位到：${cityName}`);
    } catch (error) {
      console.error('[Settings] autoLocateWeather failed:', error);
      setLocationStatus('定位失败，请手动输入', true);
    }
  }, () => {
    setLocationStatus('定位失败，请手动输入', true);
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

async function loadWeatherDefaultCity() {
  try {
    if (!window.electron || !window.electron.getWeatherDefaultCity) return;
    const result = await window.electron.getWeatherDefaultCity();
    weatherDefaultCity = result?.weatherDefaultCity || '';
    renderWeatherDefaultCity();
  } catch (error) {
    console.error('[Settings] loadWeatherDefaultCity failed:', error);
  }
}

async function saveWeatherDefaultCity() {
  const input = document.getElementById('weatherDefaultCityInput');
  const city = input ? input.value.trim() : '';
  try {
    if (!window.electron || !window.electron.saveWeatherDefaultCity) {
      showToast('当前版本不支持保存天气默认城市', true);
      return;
    }
    const result = await window.electron.saveWeatherDefaultCity(city);
    if (result && result.success) {
      weatherDefaultCity = result.config?.weatherDefaultCity || '';
      renderWeatherDefaultCity();
      showToast(weatherDefaultCity ? '默认城市已保存' : '默认城市已清空');
    } else {
      showToast(result?.error || '保存默认城市失败', true);
    }
  } catch (error) {
    console.error('[Settings] saveWeatherDefaultCity failed:', error);
    showToast('保存默认城市失败', true);
  }
}

function resetData() {
  document.getElementById('resetConfirmDialog').classList.add('show');
}

function cancelReset() {
  document.getElementById('resetConfirmDialog').classList.remove('show');
}

function confirmReset() {
  document.getElementById('resetConfirmDialog').classList.remove('show');
  window.PetStorage.resetAllData();
  sendSettingsChange({ type: 'reset' });
  loadSettings();
  showToast('数据已重置');
}

function saveAndClose() {
  closeWindow();
}

function closeWindow() {
  persistPendingMood(false);
  clearBubblePreviewHideTimer();
  if (window.electron && window.electron.hideBubble) window.electron.hideBubble();
  if (window.electron && window.electron.closeChildWindow) window.electron.closeChildWindow('settings');
}

const factTypeFilter = document.getElementById('fact-type-filter');
if (factTypeFilter) {
  factTypeFilter.addEventListener('change', function onFactFilterChange() {
    const filtered = this.value ? allFacts.filter((fact) => fact.fact_type === this.value) : allFacts;
    renderFacts(filtered);
  });
}

const clearProfileButton = document.getElementById('btn-clear-profile');
if (clearProfileButton) {
  clearProfileButton.addEventListener('click', async () => {
    const button = document.getElementById('btn-clear-profile');
    if (button.dataset.confirm === 'pending') {
      try {
        await window.electron.clearMemoryProfile();
        button.textContent = '清除画像';
        button.dataset.confirm = '';
        loadUserProfile();
        loadMemoryStats();
        showToast('已清除画像');
      } catch (error) {
        console.error('清除画像失败', error);
        showToast('清除画像失败', true);
      }
      return;
    }

    button.textContent = '再点一次确认清除';
    button.dataset.confirm = 'pending';
    setTimeout(() => {
      if (button.dataset.confirm === 'pending') {
        button.textContent = '清除画像';
        button.dataset.confirm = '';
      }
    }, 3000);
  });
}

async function loadSettings() {
  const snapshot = SettingsUtils.getSettingsSnapshot(window.PetStorage);
  const supportedPet = getSupportedPet(snapshot.pet);
  if (snapshot.pet !== supportedPet) {
    SettingsUtils.setPetSelection(window.PetStorage, supportedPet);
    sendSettingsChange({ type: 'pet', pet: supportedPet });
  }

  document.querySelectorAll('.pet-card').forEach((card) => card.classList.toggle('selected', card.dataset.pet === supportedPet));
  document.querySelectorAll('.personality-option').forEach((item) => item.classList.toggle('selected', item.dataset.personality === snapshot.personality));
  syncMoodState(snapshot.mood);

  bubbleDebugStates = getBubbleDebugStates();
  bubbleOffsets = snapshot.bubbleStateOffsets || { idle: { x: 0, y: 8 } };
  currentBubbleState = snapshot.bubblePreviewState || 'idle';
  if (!bubbleDebugStates.includes(currentBubbleState)) currentBubbleState = bubbleDebugStates[0] || 'idle';

  const bubbleSelect = document.getElementById('bubbleStateSelect');
  bubbleSelect.innerHTML = bubbleDebugStates.map((state) => `<option value="${state}">${state}</option>`).join('');
  bubbleSelect.value = currentBubbleState;
  applyBubbleOffsetEditors();

  intimacyWidgetOffset = snapshot.intimacyWidgetOffset || { x: 0, y: 0 };
  applyIntimacyOffsetEditors();

  llmSceneConfig = normalizeSceneConfig(snapshot.llmSceneConfig || DEFAULT_SCENE_CONFIG);
  if (!SCENE_DEFINITIONS.some((scene) => scene.id === activeSceneTab)) activeSceneTab = 'chat';

  await refreshCredentialSettings();
  updateThemeSelection();
  await loadWeatherDefaultCity();
  loadRitualSettings();
  setLocationStatus('');
  switchSection(activeSectionId);
}

if (window.electron && window.electron.onSettingsChange) {
  window.electron.onSettingsChange((event, payload) => {
    if (payload && payload.type === 'mood') syncMoodState(payload.mood);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadSettings().catch((error) => {
    console.error('[Settings] loadSettings failed:', error);
    showToast('设置加载失败', true);
  });
});

window.addEventListener('storage', (event) => {
  if (event.key === 'pet_theme') updateThemeSelection();
  if (event.key === 'pet_data') {
    const petData = window.PetStorage.getPetData ? window.PetStorage.getPetData() : null;
    if (petData) syncMoodState(petData.mood);
  }
});

window.addEventListener('mood-updated', (event) => {
  const nextMood = typeof event.detail === 'object' ? event.detail?.mood : event.detail;
  if (event.detail && typeof event.detail === 'object' && event.detail.source === 'settings') return;
  syncMoodState(nextMood);
});
