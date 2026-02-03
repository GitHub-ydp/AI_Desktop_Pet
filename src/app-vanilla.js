// AI Desktop Pet - 简化版

let state = {
  currentPet: '🐱',
  currentPersonality: 'healing',
  mood: 80,
  chatHistory: [],
  settings: { autoSpeak: true },
  autoSpeakTimer: null,
  moodCheckTimer: null,
  quickMenuVisible: false,
  bubbleTimer: null
};

// 初始化
function init() {
  if (!window.PetStorage || !window.PersonalityPrompts || !window.PetAPI) {
    console.error('Dependencies not loaded!');
    return;
  }

  loadData();
  updateUI();
  startTimers();

  document.getElementById('petWrapper').addEventListener('click', handlePetClick);

  // 点击其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (state.quickMenuVisible && !e.target.closest('.quick-menu') && !e.target.closest('.pet-wrapper')) {
      closeQuickMenu();
    }
  });

  console.log('App initialized!');
}

function loadData() {
  const petData = window.PetStorage.getPetData();
  const settings = window.PetStorage.getSettings();
  const history = window.PetStorage.getChatHistory();

  state.currentPet = petData.emoji;
  state.currentPersonality = petData.personality;
  state.mood = petData.mood;
  state.settings = settings;
  state.chatHistory = history;
}

function saveData() {
  window.PetStorage.savePetData({
    emoji: state.currentPet,
    personality: state.currentPersonality,
    mood: state.mood,
    lastInteraction: Date.now()
  });
  window.PetStorage.saveSettings(state.settings);
}

function updateUI() {
  document.getElementById('petEmoji').textContent = state.currentPet;
  updateMoodDisplay();
  updatePetSelection();
  updatePersonalitySelection();
  document.getElementById('autoSpeakCheck').checked = state.settings.autoSpeak;
}

function updateMoodDisplay() {
  const moodDisplay = document.getElementById('moodDisplay');
  let moodText;

  if (state.mood > 80) moodText = '💚 超级开心';
  else if (state.mood > 60) moodText = '💛 不错';
  else if (state.mood > 40) moodText = '🧡 一般';
  else moodText = '🖤 有点难过';

  moodDisplay.textContent = moodText;
}

function updatePetSelection() {
  document.querySelectorAll('.pet-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.pet === state.currentPet);
  });
}

function updatePersonalitySelection() {
  document.querySelectorAll('.personality-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.personality === state.currentPersonality);
  });
}

function handlePetClick(e) {
  e.stopPropagation();
  if (state.quickMenuVisible) {
    closeQuickMenu();
  } else {
    document.getElementById('quickMenu').style.display = 'flex';
    state.quickMenuVisible = true;
  }
}

function closeQuickMenu() {
  document.getElementById('quickMenu').style.display = 'none';
  state.quickMenuVisible = false;
}

function showBubbleMessage(message) {
  const bubble = document.getElementById('chatBubble');
  document.getElementById('bubbleMessage').textContent = message;
  bubble.style.display = 'block';
  
  // 5秒后自动消失
  if (state.bubbleTimer) clearTimeout(state.bubbleTimer);
  state.bubbleTimer = setTimeout(() => {
    bubble.style.display = 'none';
  }, 5000);
}

// 对话功能
function openChat() {
  closeQuickMenu();
  document.getElementById('chatModal').style.display = 'flex';
  setTimeout(() => {
    document.getElementById('chatInput').focus();
  }, 100);
}

function closeChat() {
  document.getElementById('chatModal').style.display = 'none';
  document.getElementById('chatInput').value = '';
}

function closeChatOnBackdrop(event) {
  if (event.target.id === 'chatModal') {
    closeChat();
  }
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (message) {
    closeChat();
    sendChat(message);
  }
}

async function sendChat(message) {
  // 添加用户消息到 LocalStorage
  window.PetStorage.addChatMessage('user', message);
  state.chatHistory = window.PetStorage.getChatHistory();

  // 保存到记忆系统（如果可用）
  if (window.memoryManager && window.memoryManager.isInitialized) {
    try {
      await window.memoryManager.addConversation('user', message, {
        personality: state.currentPersonality,
        mood: state.mood
      });
    } catch (error) {
      console.error('Failed to save to memory:', error);
    }
  }

  try {
    const reply = await window.PetAPI.chatWithAI(
      message,
      state.currentPersonality,
      state.chatHistory
    );

    window.PetStorage.addChatMessage('assistant', reply);
    state.chatHistory = window.PetStorage.getChatHistory();

    // 保存 AI 回复到记忆系统（如果可用）
    if (window.memoryManager && window.memoryManager.isInitialized) {
      try {
        await window.memoryManager.addConversation('assistant', reply, {
          personality: state.currentPersonality,
          mood: state.mood
        });
      } catch (error) {
        console.error('Failed to save to memory:', error);
      }
    }

    // 显示回复（截短）
    const displayReply = reply.length > 60 ? reply.substring(0, 60) + '...' : reply;
    showBubbleMessage(displayReply);

    // 更新心情
    state.mood = window.PetStorage.updateMood(5);
    updateMoodDisplay();
    saveData();

  } catch (error) {
    console.error('Chat error:', error);
    showBubbleMessage('抱歉，我出错了，请稍后再试~');
  }
}

// 设置
function openSettings() {
  closeQuickMenu();
  document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function closeSettingsOnBackdrop(e) {
  if (e.target.id === 'settingsModal') closeSettings();
}

// 历史
function openHistory() {
  closeQuickMenu();
  renderHistory();
  document.getElementById('historyModal').style.display = 'flex';
}

function closeHistory() {
  document.getElementById('historyModal').style.display = 'none';
}

function closeHistoryOnBackdrop(e) {
  if (e.target.id === 'historyModal') closeHistory();
}

function renderHistory() {
  const historyList = document.getElementById('historyList');
  
  if (state.chatHistory.length === 0) {
    historyList.innerHTML = '<div class="empty-state">还没有对话记录哦~</div>';
    return;
  }

  let html = '';
  state.chatHistory.forEach(msg => {
    const role = msg.role === 'user' ? '你' : '宠物';
    html += `
      <div class="history-item ${msg.role}">
        <div class="role">${role}</div>
        <div class="content">${msg.content}</div>
      </div>
    `;
  });
  historyList.innerHTML = html;
}

function clearHistory() {
  if (confirm('确定要清空所有对话历史吗？')) {
    window.PetStorage.clearChatHistory();
    state.chatHistory = [];
    closeHistory();
  }
}

// 选择宠物
function selectPet(pet) {
  state.currentPet = pet;
  saveData();
  updateUI();
}

// 选择性格
function selectPersonality(personality) {
  state.currentPersonality = personality;
  window.PetStorage.clearChatHistory();
  state.chatHistory = [];
  saveData();
  stopTimers();
  startTimers();
  showBubbleMessage('主人，我换了个性格哦~');
  setTimeout(() => {
    document.getElementById('chatBubble').style.display = 'none';
    closeSettings();
  }, 1500);
}

function toggleAutoSpeak() {
  state.settings.autoSpeak = document.getElementById('autoSpeakCheck').checked;
  saveData();
  stopTimers();
  if (state.settings.autoSpeak) startTimers();
}

function resetData() {
  if (confirm('确定要重置所有数据吗？')) {
    window.PetStorage.resetAllData();
    location.reload();
  }
}

// 定时器
function startTimers() {
  if (state.settings.autoSpeak) scheduleAutoSpeak();
  state.moodCheckTimer = setInterval(() => {
    state.mood = window.PetStorage.checkMoodDecay();
    updateMoodDisplay();
  }, 60000);
}

function stopTimers() {
  if (state.autoSpeakTimer) clearTimeout(state.autoSpeakTimer);
  if (state.moodCheckTimer) clearInterval(state.moodCheckTimer);
}

function scheduleAutoSpeak() {
  if (!state.settings.autoSpeak || state.mood <= 60) return;
  
  const delay = 30000 + Math.random() * 30000;
  state.autoSpeakTimer = setTimeout(() => {
    const phrase = window.PersonalityPrompts.getRandomPhrase(state.currentPersonality);
    showBubbleMessage(phrase);
    scheduleAutoSpeak();
  }, delay);
}

// 拖拽
function initDrag() {
  const petWrapper = document.getElementById('petWrapper');
  let isDragging = false;
  let startX, startY;

  function onMouseDown(e) {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.screenX;
    startY = e.screenY;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const deltaX = e.screenX - startX;
    const deltaY = e.screenY - startY;
    if (window.electron && window.electron.moveWindow) {
      window.electron.moveWindow(deltaX, deltaY);
    }
    startX = e.screenX;
    startY = e.screenY;
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  petWrapper.addEventListener('mousedown', onMouseDown);
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  initDrag();
});
