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
  bubbleTimer: null,
  reminders: [],
  pendingReminder: null  // 待确认的模糊时间提醒
};

// 初始化记忆系统
async function initMemorySystem() {
  if (!window.PetMemory) {
    console.warn('[Memory] PetMemory not available');
    return false;
  }

  try {
    console.log('[Memory] Initializing...');
    await window.PetMemory.initialize();
    console.log('[Memory] Initialized successfully');
    return true;
  } catch (error) {
    console.error('[Memory] Initialization failed:', error);
    return false;
  }
}

// 检查是否需要显示初始化表单
async function checkIfNeedsInit() {
  if (!window.PetMemory) {
    return false;
  }

  try {
    const stats = await window.PetMemory.getStats();
    console.log('[Init] Memory stats:', stats);

    // 如果没有对话记录，显示初始化表单
    if (stats.totalConversations === 0) {
      console.log('[Init] No memories found, showing init form');
      setTimeout(() => {
        openInitModal();
      }, 1000); // 延迟1秒显示，让用户先看到宠物
      return true;
    }
  } catch (error) {
    console.error('[Init] Failed to check memory stats:', error);
  }

  return false;
}

// 打开初始化表单
function openInitModal() {
  // 创建初始化子窗口
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'init',
      title: '初始化设置',
      width: 450,
      height: 550,
      html: 'windows/init-window.html'
    });

    // 监听初始化完成事件
    window.addEventListener('init-completed', handleInitCompleted, { once: true });
    window.addEventListener('init-skipped', handleInitSkipped, { once: true });
  } else {
    console.error('[App] electron API 不可用，无法打开初始化窗口');
  }
}

// 处理初始化完成
async function handleInitCompleted(event) {
  const { name, gender, birthday, interests } = event.detail;

  // 构建用户信息消息
  let userInfoMessage = `我叫${name}`;
  if (gender && gender !== '其他') {
    userInfoMessage += `，我是${gender}生`;
  }
  if (birthday) {
    userInfoMessage += `，我的生日是${birthday}`;
  }
  if (interests) {
    userInfoMessage += `，我喜欢${interests}`;
  }

  console.log('[Init] User info:', userInfoMessage);

  // 保存到记忆系统
  try {
    if (window.PetMemory) {
      await window.PetMemory.addConversation('user', userInfoMessage, {
        personality: state.currentPersonality,
        mood: state.mood,
        extra: { type: 'user_profile_init' }
      });
      console.log('[Init] User profile saved to memory');

      // 生成AI的确认回复
      const confirmMessage = `好的${name}，我记住啦！以后我会好好陪伴你的~ 💕`;
      await window.PetMemory.addConversation('assistant', confirmMessage, {
        personality: state.currentPersonality,
        mood: state.mood,
        extra: { type: 'profile_confirmation' }
      });

      // 显示欢迎消息
      showBubbleMessage(confirmMessage);

      // 保存到 LocalStorage 作为备份
      window.PetStorage.addChatMessage('user', userInfoMessage);
      window.PetStorage.addChatMessage('assistant', confirmMessage);
      state.chatHistory = window.PetStorage.getChatHistory();

    } else {
      console.error('[Init] PetMemory not available');
      showBubbleMessage('抱歉，保存失败了~');
    }
  } catch (error) {
    console.error('[Init] Failed to save user profile:', error);
    showBubbleMessage('抱歉，保存出错了~');
  }
}

// 处理跳过初始化
function handleInitSkipped() {
  showBubbleMessage('好的，我们可以慢慢了解~');
}

// 兼容性函数（保留以避免错误）
function closeInitOnBackdrop(event) {
  // 已改用子窗口，此函数保留为空
}

function skipInit() {
  // 已改用子窗口，此函数保留为空
}

async function submitInit() {
  // 已改用子窗口，此函数保留为空
}

// 初始化
async function init() {
  if (!window.PetStorage || !window.PersonalityPrompts || !window.PetAPI) {
    console.error('Dependencies not loaded!');
    return;
  }

  // 初始化记忆系统
  await initMemorySystem();

  // 初始化动画系统
  if (window.PetAnimations) {
    window.PetAnimations.initialize();
  }

  // 初始化旋转拨号菜单
  if (window.PetMenu) {
    window.PetMenu.initialize();
  }

  loadData();
  updateUI();
  startTimers();

  // 点击事件已经在 initDrag() 中处理了，不需要单独添加

  // 点击其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (state.quickMenuVisible && 
        !e.target.closest('.rotary-menu') && 
        !e.target.closest('.dial-item') &&
        !e.target.closest('.quick-menu') && 
        !e.target.closest('.pet-wrapper')) {
      closeQuickMenu();
    }
  });

  // 添加全局键盘快捷键
  initKeyboardShortcuts();
  // 初始化聊天 IPC 监听
  initChatIpc();
  // 初始化设置 IPC 监听
  initSettingsIpc();
  // 初始化宠物状态 IPC 监听（菜单窗口 -> 主窗口）
  initPetStateIpc();
  // 初始化截图功能
  initScreenshot();

  // 启动自动状态检查
  if (window.PetAnimations) {
    window.PetAnimations.startAutoStateCheck(
      () => state.mood,  // 获取当前心情
      () => state.lastInteraction || Date.now()  // 获取最后互动时间
    );
  }

  console.log('App initialized!');

  // 检查是否需要初始化
  await checkIfNeedsInit();
}

// 聊天 IPC（子窗口 -> 主窗口）
function initChatIpc() {
  if (!window.electron || !window.electron.onChatSend) return;
  window.electron.onChatSend(async (event, data) => {
    const requestId = data && data.requestId;
    const message = data && data.message;
    if (!requestId || !message) return;
    try {
      const reply = await sendChat(message, { returnReply: true, closeChatWindow: false });
      window.electron.sendChatResponse(requestId, { success: true, reply });
    } catch (error) {
      window.electron.sendChatResponse(requestId, {
        success: false,
        error: (error && error.message) ? error.message : '聊天失败'
      });
    }
  });
}

// 设置 IPC（子窗口 -> 主窗口）
function initSettingsIpc() {
  if (!window.electron || !window.electron.onSettingsChange) return;
  window.electron.onSettingsChange((event, data) => {
    if (!data || !data.type) return;
    if (data.type === 'pet') {
      state.currentPet = data.pet;
      if (window.PetAnimations) {
        window.PetAnimations.setBasePet(data.pet);
        window.PetAnimations.updateByMood(state.mood);
      }
      saveData();
      updateUI();
    } else if (data.type === 'personality') {
      state.currentPersonality = data.personality;
      window.PetStorage.clearChatHistory();
      state.chatHistory = [];
      saveData();
      stopTimers();
      startTimers();
      showBubbleMessage('主人，我换了个性格哦~');
    } else if (data.type === 'autoSpeak') {
      state.settings.autoSpeak = !!data.autoSpeak;
      saveData();
      stopTimers();
      if (state.settings.autoSpeak) startTimers();
    } else if (data.type === 'reset') {
      window.PetStorage.resetAllData();
      loadData();
      updateUI();
      stopTimers();
      startTimers();
    }
  });
}

// 宠物状态 IPC（菜单窗口 -> 主窗口）
function initPetStateIpc() {
  if (!window.electron || !window.electron.onPetState) return;
  window.electron.onPetState((event, data) => {
    if (!data || !data.state) return;
    const s = data.state;
    console.log(`[App] 收到菜单窗口状态切换: ${s}`);
    if (window.PetAnimations) {
      if (s === 'idle') {
        window.PetAnimations.unlockManualState();
      } else {
        window.PetAnimations.setManualState(s);
      }
    }
  });
}

// 键盘快捷键
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Esc 键关闭菜单
    if (e.key === 'Escape') {
      if (state.quickMenuVisible) {
        closeQuickMenu();
      }
    }
    
    // Ctrl/Cmd + K 打开聊天
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openChat();
    }
    
    // Ctrl/Cmd + , 打开设置
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      openSettings();
    }
    
    // Ctrl/Cmd + H 打开历史
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      openHistory();
    }
    
    // 空格键切换菜单
    if (e.key === ' ' && e.target === document.body) {
      e.preventDefault();
      handlePetClick();
    }

    // Ctrl+L 切换 Lottie/Emoji 模式（调试用）
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      toggleLottieMode();
    }
  });

  console.log('[Keyboard] 快捷键已启用: Esc, Ctrl+K, Ctrl+,, Ctrl+H, Space, Ctrl+L (切换动画模式)');
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
  state.lastInteraction = petData.lastInteraction || Date.now();  // 读取最后互动时间
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
  // 更新 emoji（仅在未使用 Lottie 时）
  const petEmojiElement = document.getElementById('petEmoji');
  if (petEmojiElement && petEmojiElement.style.display !== 'none') {
    petEmojiElement.textContent = state.currentPet;
  }
  
  // 更新动画系统的基础宠物（会自动处理 Lottie 或 Emoji）
  if (window.PetAnimations) {
    window.PetAnimations.setBasePet(state.currentPet);
    window.PetAnimations.updateByMood(state.mood);
  }
  
  updateMoodDisplay();
  updatePetSelection();
  updatePersonalitySelection();
  
  // autoSpeakCheck 已移到设置子窗口，主窗口中不存在
  const autoSpeakCheck = document.getElementById('autoSpeakCheck');
  if (autoSpeakCheck) {
    autoSpeakCheck.checked = state.settings.autoSpeak;
  }
}

function updateMoodDisplay() {
  const moodDisplay = document.getElementById('moodDisplay');
  if (moodDisplay) {
    let moodText;

    if (state.mood > 80) moodText = '💚 超级开心';
    else if (state.mood > 60) moodText = '💛 不错';
    else if (state.mood > 40) moodText = '🧡 一般';
    else moodText = '🖤 有点难过';

    moodDisplay.textContent = moodText;
  }
  
  // 根据心情更新宠物表情
  if (window.PetAnimations) {
    window.PetAnimations.updateByMood(state.mood);
  }
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

async function handlePetClick() {
  // 不需要 stopPropagation，因为这是从 initDrag 内部调用的
  if (window.electron && window.electron.toggleMenuWindow) {
    const result = await window.electron.toggleMenuWindow();
    state.quickMenuVisible = !!(result && result.isOpen);
    return;
  }
  if (window.PetMenu) {
    window.PetMenu.toggle();
    state.quickMenuVisible = window.PetMenu.isOpen;
  } else {
    // 降级到旧菜单
    if (state.quickMenuVisible) {
      closeQuickMenu();
    } else {
      const oldMenu = document.getElementById('quickMenu');
      if (oldMenu) {
        oldMenu.style.display = 'flex';
        state.quickMenuVisible = true;
      }
    }
  }
}

function closeQuickMenu() {
  if (window.electron && window.electron.closeMenuWindow) {
    window.electron.closeMenuWindow();
    state.quickMenuVisible = false;
    return;
  }
  if (window.PetMenu) {
    window.PetMenu.close();
    state.quickMenuVisible = false;
  } else {
    // 降级到旧菜单
    const oldMenu = document.getElementById('quickMenu');
    if (oldMenu) {
      oldMenu.style.display = 'none';
    }
    state.quickMenuVisible = false;
  }
}

function showBubbleMessage(message) {
  if (window.electron && window.electron.showBubble) {
    window.electron.showBubble(message, 5000);
    return;
  }
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
function openChat(resetPendingReminder = true) {
  closeQuickMenu();

  // 重置待确认的提醒状态（除非指定不重置）
  if (resetPendingReminder && state.pendingReminder) {
    console.log('[Reminder] Resetting pending reminder on chat open');
    state.pendingReminder = null;
  }

  // 创建聊天子窗口
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'chat',
      title: '和宠物说话',
      width: 400,
      height: 500,
      html: 'windows/chat-window.html'
    });
  } else {
    console.error('[App] electron API 不可用，无法打开聊天窗口');
  }
}

function closeChat() {
  if (window.electron && window.electron.closeChildWindow) {
    window.electron.closeChildWindow('chat');
  }
}

function closeChatOnBackdrop(event) {
  // 子窗口模式下不需要此函数
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (message) {
    closeChat();
    sendChat(message);
  }
}

async function sendChat(message, options = {}) {
  const { returnReply = false, closeChatWindow = true } = options;

  // 更新最后互动时间
  state.lastInteraction = Date.now();

  // 用户主动聊天时解除手动状态锁定
  if (window.PetAnimations && window.PetAnimations.isManualLocked()) {
    window.PetAnimations.unlockManualState();
  }

  // 检查是否有待确认的模糊时间提醒
  if (state.pendingReminder) {
    const result = await processVagueTimeReply(message);
    
    if (result.success) {
      // 保存用户消息
      window.PetStorage.addChatMessage('user', message);
      window.PetStorage.addChatMessage('assistant', result.message);
      state.chatHistory = window.PetStorage.getChatHistory();
      
      showBubbleMessage(result.message);
      if (closeChatWindow) closeChat();
      saveData();
      if (returnReply) return result.message;
      return;
    } else if (result.needsClarify) {
      // 需要进一步澄清
      showBubbleMessage(result.message);
      if (returnReply) return result.message;
      return;
    }
    // 如果不是对模糊时间的回复，继续正常处理
  }

  // 检查是否包含提醒请求
  let reminderCreated = null;
  let needsConfirmation = false;

  if (window.ReminderExtractor) {
    console.log('[Reminder] Checking for reminder in message:', message);
    const extractedReminder = await window.ReminderExtractor.extract(message);
    console.log('[Reminder] Extract result:', extractedReminder);
    if (extractedReminder) {
      try {
        reminderCreated = await createReminderFromExtract(extractedReminder);
        
        // 如果需要确认（模糊时间），进入确认流程
        if (reminderCreated.needsConfirmation) {
          needsConfirmation = true;
          handleVagueTimeConfirmation(reminderCreated);
          
          // 保存对话但不关闭窗口
          window.PetStorage.addChatMessage('user', message);
          state.chatHistory = window.PetStorage.getChatHistory();
          if (returnReply) return reminderCreated.message || '好的，我们再确认一下时间~';
          return;
        }
      } catch (error) {
        console.error('[Reminder] Failed to create reminder:', error);
        showBubbleMessage('抱歉，创建提醒失败了：' + error.message);
        if (returnReply) return '抱歉，创建提醒失败了~';
      }
    }
  } else {
    console.log('[Reminder] ReminderExtractor not available');
  }

  // 添加用户消息到 LocalStorage
  window.PetStorage.addChatMessage('user', message);
  state.chatHistory = window.PetStorage.getChatHistory();

  try {
    let reply;

    // AI 思考中动画
    if (window.PetAnimations) {
      window.PetAnimations.thinking();
    }

    // 如果创建了提醒，给确认回复
    if (reminderCreated) {
      const timeStr = window.ReminderExtractor.formatTime(reminderCreated.remindAt);
      const responses = [
        `好的！我会在${timeStr}提醒你${reminderCreated.content}~`,
        `记住啦！${timeStr}我会叫你的~`,
        `没问题，${timeStr}准时提醒你哦！`,
        `设置好啦，${timeStr}见！`
      ];
      reply = responses[Math.floor(Math.random() * responses.length)];
    } else {
      reply = await window.PetAPI.chatWithAI(
        message,
        state.currentPersonality,
        state.chatHistory
      );
    }

    window.PetStorage.addChatMessage('assistant', reply);
    state.chatHistory = window.PetStorage.getChatHistory();

    // 说话动画
    if (window.PetAnimations) {
      window.PetAnimations.talking(2000);
    }

    // 显示回复（截短）
    const displayReply = reply.length > 60 ? reply.substring(0, 60) + '...' : reply;
    showBubbleMessage(displayReply);

    // 更新心情
    state.mood = window.PetStorage.updateMood(5);
    updateMoodDisplay();
    
    // 心情好时显示开心动画
    if (state.mood > 70 && window.PetAnimations) {
      setTimeout(() => {
        window.PetAnimations.happy(1500);
        SoundEffects.playHappy();
      }, 2000);
    }
    
    saveData();
    if (returnReply) return reply;

  } catch (error) {
    console.error('Chat error:', error);
    showBubbleMessage('抱歉，我出错了，请稍后再试~');
    if (returnReply) throw error;
  }
}

// 从提取的信息创建提醒
async function createReminderFromExtract(extracted) {
  console.log('[Reminder] Creating from extract:', extracted);
  
  if (!window.PetReminder) {
    console.error('[Reminder] PetReminder API not available');
    throw new Error('PetReminder API not available');
  }

  // 如果需要确认（模糊时间），先不创建，返回确认信息
  if (extracted.needsConfirmation) {
    console.log('[Reminder] Needs confirmation:', extracted.message);
    return {
      needsConfirmation: true,
      confirmationType: extracted.confirmationType,
      message: extracted.message,
      content: extracted.content,
      remindAt: extracted.remindAt,
      preferenceMinutes: extracted.preferenceMinutes,
      vagueKeyword: extracted.vagueKeyword
    };
  }

  const data = {
    content: extracted.content,
    remindAt: extracted.remindAt
  };
  console.log('[Reminder] Calling PetReminder.create with:', data);

  const reminder = await window.PetReminder.create(data);

  console.log('[Reminder] Created successfully:', reminder);
  return {
    ...reminder,
    needsConfirmation: false
  };
}

// 处理用户确认模糊时间
function handleVagueTimeConfirmation(extracted) {
  if (extracted.confirmationType === 'ask_minutes') {
    // 询问具体时间 - 宠物说出问题，等待用户回答
    showBubbleMessage(extracted.message);

    // 打开聊天窗口让用户回答（不重置 pendingReminder）
    openChat(false);

    // 在输入框中预填充提示
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.placeholder = '告诉我几分钟（数字即可）';
    }

    // 保存当前待确认的提醒信息
    state.pendingReminder = extracted;

  } else if (extracted.confirmationType === 'use_preference') {
    // 询问是否使用之前的偏好
    const timeStr = window.ReminderExtractor.formatTime(extracted.remindAt);
    showBubbleMessage(`${extracted.message}`);

    // 打开聊天窗口（不重置 pendingReminder）
    openChat(false);

    // 保存待确认的提醒
    state.pendingReminder = extracted;
  }
}

// 处理用户对模糊时间的回复
async function processVagueTimeReply(userReply) {
  if (!state.pendingReminder) return false;

  const pending = state.pendingReminder;
  let minutes = null;

  // 清理输入，移除空格
  const cleanReply = userReply.trim();

  // 1. 尝试匹配纯数字（直接输入分钟数）
  if (/^\d+$/.test(cleanReply)) {
    minutes = parseInt(cleanReply);
    console.log('[Reminder] Parsed minutes from pure number:', minutes);
  }
  // 2. 尝试匹配 "X分钟" 格式
  else {
    const match = cleanReply.match(/(\d+)\s*分钟/);
    if (match) {
      minutes = parseInt(match[1]);
      console.log('[Reminder] Parsed minutes from pattern:', minutes);
    }
    // 3. 用户同意使用偏好值
    else if (cleanReply.includes('好') || cleanReply.includes('可以') || cleanReply.includes('行') || cleanReply.includes('嗯')) {
      minutes = pending.preferenceMinutes;
      console.log('[Reminder] User agreed to preference:', minutes);
    }
  }

  if (minutes && minutes > 0) {
    // 保存用户偏好
    if (pending.vagueKeyword) {
      window.ReminderExtractor.savePreference(pending.vagueKeyword, minutes);
      console.log('[Reminder] Saved preference:', pending.vagueKeyword, '=', minutes);
    }

    // 创建提醒
    try {
      const remindAt = Date.now() + minutes * 60 * 1000;
      const reminder = await window.PetReminder.create({
        content: pending.content,
        remindAt: remindAt,
        metadata: {
          vagueKeyword: pending.vagueKeyword,
          personality: state.currentPersonality,
          mood: state.mood
        }
      });

      state.pendingReminder = null;

      // 重置输入框提示
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.placeholder = '和宠物聊天...';
      }

      // 确认回复
      const timeStr = window.ReminderExtractor.formatTime(remindAt);
      return {
        success: true,
        message: `好的！我会在${timeStr}提醒你${pending.content}~`
      };
    } catch (error) {
      console.error('[Reminder] Failed to create:', error);
      return {
        success: false,
        message: '创建提醒失败了，请再试一次~'
      };
    }
  }

  // 没有理解用户输入
  return {
    success: false,
    needsClarify: true,
    message: '没听懂呢，告诉我具体几分钟吧~'
  };
}

// 设置
function openSettings() {
  closeQuickMenu();

  // 创建设置子窗口
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'settings',
      title: '设置',
      width: 500,
      height: 600,
      html: 'windows/settings-window.html'
    });
  } else {
    console.error('[App] electron API 不可用，无法打开设置窗口');
  }
}

function closeSettings() {
  if (window.electron && window.electron.closeChildWindow) {
    window.electron.closeChildWindow('settings');
  }
}

function closeSettingsOnBackdrop(e) {
  // 子窗口模式下不需要此函数
}

// 历史
function openHistory() {
  closeQuickMenu();

  // 创建历史记录子窗口
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'history',
      title: '对话历史',
      width: 500,
      height: 600,
      html: 'windows/history-window.html'
    });
  } else {
    console.error('[App] electron API 不可用，无法打开历史窗口');
  }
}

// 主题切换
function openTheme() {
  closeQuickMenu();

  // 创建主题选择子窗口
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'theme',
      title: '切换主题',
      width: 360,
      height: 380,
      html: 'windows/theme-window.html'
    });
  } else {
    console.error('[App] electron API 不可用，无法打开主题窗口');
  }
}
// 暴露所有菜单相关函数到全局 window 对象
window.openChat = openChat;
window.openSettings = openSettings;
window.openHistory = openHistory;
window.openTheme = openTheme;

function closeHistory() {
  if (window.electron && window.electron.closeChildWindow) {
    window.electron.closeChildWindow('history');
  }
}

function closeHistoryOnBackdrop(e) {
  // 子窗口模式下不需要此函数
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

  // 更新动画系统的基础宠物（setBasePet 会自动处理 Lottie/Emoji 切换）
  if (window.PetAnimations) {
    window.PetAnimations.setBasePet(pet);
    window.PetAnimations.updateByMood(state.mood);
  }

  // 显示当前皮肤模式提示
  if (window.SkinRegistry) {
    const hasLottie = window.SkinRegistry.hasLottieSupport(pet);
    const skin = window.SkinRegistry.getSkinByEmoji(pet);
    const modeName = hasLottie ? 'Lottie 动画' : 'Emoji';
    console.log(`[SelectPet] 切换到 ${skin.name} (${modeName} 模式)`);
  }

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
  const autoSpeakCheck = document.getElementById('autoSpeakCheck');
  if (autoSpeakCheck) {
    state.settings.autoSpeak = autoSpeakCheck.checked;
    saveData();
    stopTimers();
    if (state.settings.autoSpeak) startTimers();
  }
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
  
  // 心情检查定时器
  state.moodCheckTimer = setInterval(() => {
    state.mood = window.PetStorage.checkMoodDecay();
    updateMoodDisplay();
  }, 60000);
  
  // 无互动睡觉检查（5分钟无互动进入睡觉状态）
  let lastInteractionTime = Date.now();
  let isSleeping = false;
  
  // 记录用户互动
  const recordInteraction = () => {
    lastInteractionTime = Date.now();
    state.lastInteraction = Date.now();  // 同时更新 state

    // 解除手动状态锁定（用户交互时恢复自动模式）
    if (window.PetAnimations && window.PetAnimations.isManualLocked()) {
      window.PetAnimations.unlockManualState();
    }

    if (isSleeping && window.PetAnimations) {
      window.PetAnimations.wakeUp();
      isSleeping = false;
    }
  };
  
  // 监听用户交互
  document.addEventListener('click', recordInteraction);
  document.addEventListener('keydown', recordInteraction);
  
  // 检查是否需要睡觉
  setInterval(() => {
    // 手动锁定时不自动进入睡眠
    if (window.PetAnimations && window.PetAnimations.isManualLocked()) return;

    const inactiveTime = Date.now() - lastInteractionTime;
    const fiveMinutes = 5 * 60 * 1000;

    if (inactiveTime > fiveMinutes && !isSleeping && window.PetAnimations) {
      window.PetAnimations.sleeping();
      isSleeping = true;
      console.log('[Sleep] 进入睡觉状态');
    }
  }, 30000); // 每30秒检查一次
}

function stopTimers() {
  if (state.autoSpeakTimer) clearTimeout(state.autoSpeakTimer);
  if (state.moodCheckTimer) clearInterval(state.moodCheckTimer);
}

function scheduleAutoSpeak() {
  if (!state.settings.autoSpeak) return;
  
  const moodFactor = state.mood <= 60 ? 1.8 : 1;
  const delay = (30000 + Math.random() * 30000) * moodFactor;
  state.autoSpeakTimer = setTimeout(() => {
    const phrase = window.PersonalityPrompts.getRandomPhrase(state.currentPersonality);
    showBubbleMessage(phrase);
    scheduleAutoSpeak();
  }, delay);
}

// 拖拽与点击分离
function initDrag() {
  console.log('[Init] 初始化拖动功能...');
  const petWrapper = document.getElementById('petWrapper');
  console.log('[Init] 宠物元素找到:', !!petWrapper);

  if (!petWrapper) {
    console.error('[Init] 错误：找不到宠物元素！');
    return;
  }

  // 拖拽/点击分离的阈值
  const CLICK_THRESHOLD = 5;      // 移动距离小于5px视为点击
  const CLICK_TIME_LIMIT = 300;   // 按住时间小于300ms视为点击
  
  let isDragging = false;
  let startX, startY;
  let startTime = 0;
  let hasMoved = false;

  function onMouseDown(e) {
    console.log('[Drag] 鼠标按下');
    if (e.button !== 0) return;
    
    // 记录起始状态
    startTime = Date.now();
    startX = e.screenX;
    startY = e.screenY;
    isDragging = false;
    hasMoved = false;
    
    console.log('[Drag] 起始位置:', startX, startY);
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    const deltaX = e.screenX - startX;
    const deltaY = e.screenY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    
    // 检测是否超过点击阈值
    if (!isDragging && distance > CLICK_THRESHOLD) {
      isDragging = true;
      hasMoved = true;
      petWrapper.classList.add('dragging');
      if (window.PetAnimations) {
        window.PetAnimations.dragging();
      }
      console.log('[Drag] 开始拖拽模式');
    }
    
    if (!isDragging) return;
    
    console.log('[Drag] 移动中...', deltaX, deltaY);

    if (window.electron && window.electron.moveWindow) {
      window.electron.moveWindow(deltaX, deltaY).then(() => {
        console.log('[Drag] [OK] 移动成功');
      }).catch(err => {
        console.error('[Drag] [ERROR] 移动失败:', err);
      });
    } else {
      console.error('[Drag] [ERROR] window.electron.moveWindow 不可用！');
      console.log('[Debug] window.electron:', window.electron);
    }
    startX = e.screenX;
    startY = e.screenY;
  }

  function onMouseUp() {
    const duration = Date.now() - startTime;
    console.log('[Drag] 鼠标释放，持续时间:', duration, 'ms, 是否移动:', hasMoved);
    
    petWrapper.classList.remove('dragging');
    
    // 判断是点击还是拖拽
    if (!hasMoved && duration < CLICK_TIME_LIMIT) {
      console.log('[Drag] 识别为点击事件');
      if (window.PetAnimations) {
        window.PetAnimations.clicked();
      }
      SoundEffects.playClick();
      handlePetClick();
    } else if (isDragging) {
      console.log('[Drag] 完成拖拽');
      if (window.PetAnimations) {
        window.PetAnimations.stopDragging();
      }
    }
    
    isDragging = false;
    hasMoved = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  petWrapper.addEventListener('mousedown', onMouseDown);
  console.log('[Init] [OK] 拖动功能初始化完成');
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  initDrag();
  initReminderListener();
  
  // 暴露测试函数到全局，方便调试
  window.testReminder = async () => {
    console.log('[Test] Testing reminder creation...');
    try {
      if (!window.PetReminder) {
        console.error('[Test] PetReminder not available');
        return;
      }
      const result = await window.PetReminder.create({
        content: '测试提醒',
        remindAt: Date.now() + 60000
      });
      console.log('[Test] Reminder created:', result);
      showBubbleMessage('测试提醒已创建！');
    } catch (error) {
      console.error('[Test] Failed:', error);
      showBubbleMessage('创建失败：' + error.message);
    }
  };
});

// 初始化提醒监听
function initReminderListener() {
  if (!window.PetReminder) {
    console.log('[Reminder] PetReminder API not available');
    return;
  }

  // 监听提醒触发事件
  window.PetReminder.onReminderTriggered((event, data) => {
    console.log('[Reminder] Triggered:', data);

    // 让宠物"说话"提醒用户
    const reminderPhrases = [
      `⏰ 提醒时间到！${data.content}`,
      `该${data.content}啦！`,
      `主人，记得${data.content}哦~`,
      `叮叮！${data.content}的时间到啦！`
    ];

    const phrase = reminderPhrases[Math.floor(Math.random() * reminderPhrases.length)];
    showBubbleMessage(phrase);

    // 播放提醒音效（如果支持）
    playReminderSound();
  });

  // 监听过期提醒事件
  window.PetReminder.onOverdue((event, data) => {
    console.log('[Reminder] Overdue reminders detected:', data);

    // 根据过期情况显示不同的提示
    let message = '';
    if (data.missed > 0) {
      message = `你不在的时候，我错过了${data.missed}个提醒...`;
    } else if (data.caughtUp > 0) {
      message = `你不在的时候，有${data.caughtUp}个提醒已触发~`;
    }

    if (message) {
      setTimeout(() => {
        showBubbleMessage(message);
      }, 2000); // 延迟2秒显示，避免与启动消息冲突
    }
  });

  // 加载现有提醒
  loadReminders();
}

// 加载提醒列表
async function loadReminders() {
  try {
    const reminders = await window.PetReminder.getPending();
    state.reminders = reminders || [];
    console.log('[Reminder] Loaded pending reminders:', state.reminders.length);
  } catch (error) {
    console.error('[Reminder] Failed to load reminders:', error);
  }
}

// 播放提醒音效（可选）
function playReminderSound() {
  // 可以添加简单的提示音
  // const audio = new Audio('./assets/notification.mp3');
  // audio.play().catch(e => console.log('Audio play failed:', e));
}

// 简单的音效系统（使用 Web Audio API）
const SoundEffects = {
  audioContext: null,
  
  init() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[Sound] 音效系统已初始化');
    } catch (e) {
      console.log('[Sound] 音效系统不可用');
    }
  },
  
  // 播放点击音效
  playClick() {
    if (!this.audioContext) return;
    
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
    
    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.1);
  },
  
  // 播放开心音效
  playHappy() {
    if (!this.audioContext) return;
    
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    oscillator.frequency.setValueAtTime(523, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(784, this.audioContext.currentTime + 0.2);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
    
    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.3);
  }
};

// 初始化音效系统（用户首次交互后）
document.addEventListener('click', () => {
  if (!SoundEffects.audioContext) {
    SoundEffects.init();
  }
}, { once: true });

// 切换 Lottie/Emoji 动画模式（调试功能）
function toggleLottieMode() {
  if (!window.PetAnimations) {
    console.warn('[Toggle] 动画系统未初始化');
    return;
  }

  const isLottie = window.PetAnimations.useLottie;
  const mode = isLottie ? 'Emoji' : 'Lottie';

  console.log(`[Toggle] 切换到 ${mode} 模式`);

  if (isLottie) {
    // 切换到 Emoji
    window.PetAnimations.forceEmojiMode = true;
    window.PetAnimations.switchToEmoji();
    console.log('[Toggle] Emoji 显示状态:', document.getElementById('petEmoji').style.display);
    console.log('[Toggle] Emoji 内容:', document.getElementById('petEmoji').textContent);
    showBubbleMessage(`已切换到 Emoji 模式\n按 Ctrl+L 切换回 Lottie`);
  } else {
    // 检查当前皮肤是否支持 Lottie
    const skinHasLottie = window.SkinRegistry
      ? window.SkinRegistry.hasLottieSupport(state.currentPet)
      : false;

    if (!skinHasLottie) {
      const skin = window.SkinRegistry ? window.SkinRegistry.getSkinByEmoji(state.currentPet) : null;
      const name = skin ? skin.name : state.currentPet;
      showBubbleMessage(`${name} 暂无 Lottie 动画\n保持 Emoji 模式`);
      return;
    }

    // 切换到 Lottie
    const petLottie = document.getElementById('petLottie');
    const petEmoji = document.getElementById('petEmoji');

    console.log('[Toggle] petLottie 存在:', !!petLottie);
    console.log('[Toggle] petEmoji 存在:', !!petEmoji);

    if (petLottie && window.LottieController) {
      window.PetAnimations.forceEmojiMode = false;
      petLottie.style.display = 'block';
      petLottie.classList.add('lottie-active');
      petEmoji.style.display = 'none';

      window.LottieController.initialize('petLottie');
      window.LottieController.loadPet(state.currentPet, window.PetAnimations.currentState);

      window.PetAnimations.useLottie = true;
      showBubbleMessage(`已切换到 Lottie 模式\n按 Ctrl+L 切换回 Emoji`);
    } else {
      showBubbleMessage('Lottie 系统不可用，保持 Emoji 模式');
    }
  }

  // 打印调试信息
  setTimeout(() => {
    const wrapper = document.getElementById('petWrapper');
    const lottie = document.getElementById('petLottie');
    const emoji = document.getElementById('petEmoji');

    console.log('\n[DEBUG] 宠物容器状态:');
    console.log('  wrapper 尺寸:', wrapper ? `${wrapper.offsetWidth}x${wrapper.offsetHeight}` : '不存在');
    console.log('  lottie display:', lottie ? lottie.style.display : '不存在');
    console.log('  lottie 可见:', lottie ? (lottie.offsetWidth > 0 && lottie.offsetHeight > 0) : '不存在');
    console.log('  emoji display:', emoji ? emoji.style.display : '不存在');
    console.log('  emoji 内容:', emoji ? emoji.textContent : '不存在');

    if (lottie && lottie.querySelector('svg')) {
      const svg = lottie.querySelector('svg');
      console.log('  SVG 存在: 是');
      console.log('  SVG 尺寸:', svg.getAttribute('width'), 'x', svg.getAttribute('height'));
      console.log('  SVG 实际尺寸:', svg.offsetWidth, 'x', svg.offsetHeight);
      console.log('  SVG viewBox:', svg.getAttribute('viewBox'));
      console.log('  SVG overflow:', svg.style.overflow);
    }
  }, 500);
}

// ==================== 截图功能 ====================

// 初始化截图功能
function initScreenshot() {
  console.log('[Screenshot] Screenshot functionality initialized (快捷键: Ctrl+Shift+A)');
}

