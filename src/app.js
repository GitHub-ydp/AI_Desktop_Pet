// Vue应用主文件
const { createApp } = Vue;

createApp({
  data() {
    return {
      // 宠物配置
      pets: ['🐱', '🐶', '🐰', '🦊', '🐻'],
      personalities: window.PersonalityPrompts.getAllPersonalities(),

      // 当前状态
      currentPet: '🐱',
      currentPersonality: 'healing',
      mood: 80,

      // UI状态
      showBubble: false,
      showInput: false,
      showHistory: false,
      showSettings: false,
      currentMessage: '',
      userInput: '',

      // 对话历史
      chatHistory: [],

      // 设置
      settings: {
        autoSpeak: true
      },

      // 拖拽相关
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,

      // 定时器
      autoSpeakTimer: null,
      moodCheckTimer: null
    };
  },

  computed: {
    isLowMood() {
      return this.mood <= 60;
    },

    moodClass() {
      if (this.mood > 80) return 'high';
      if (this.mood > 60) return 'medium';
      return 'low';
    },

    moodText() {
      if (this.mood > 80) return '💚 超级开心';
      if (this.mood > 60) return '💛 不错';
      if (this.mood > 40) return '🧡 一般';
      return '🖤 有点难过';
    }
  },

  mounted() {
    this.loadData();
    this.startTimers();

    // 检查API配置
    if (!window.PetAPI.isConfigured()) {
      this.showBubbleMessage('请先在 src/api.js 中配置 DeepSeek API Key 哦~');
    }
  },

  beforeUnmount() {
    this.stopTimers();
  },

  methods: {
    // 加载数据
    loadData() {
      const petData = window.PetStorage.getPetData();
      const settings = window.PetStorage.getSettings();
      const history = window.PetStorage.getChatHistory();

      this.currentPet = petData.emoji;
      this.currentPersonality = petData.personality;
      this.mood = petData.mood;
      this.settings = settings;
      this.chatHistory = history;
    },

    // 保存数据
    saveData() {
      window.PetStorage.savePetData({
        emoji: this.currentPet,
        personality: this.currentPersonality,
        mood: this.mood,
        lastInteraction: Date.now()
      });

      window.PetStorage.saveSettings(this.settings);
    },

    // 开始定时器
    startTimers() {
      // 主动说话定时器
      if (this.settings.autoSpeak) {
        this.scheduleAutoSpeak();
      }

      // 心情值检查定时器
      this.moodCheckTimer = setInterval(() => {
        this.mood = window.PetStorage.checkMoodDecay();
      }, 60000); // 每分钟检查一次
    },

    // 停止定时器
    stopTimers() {
      if (this.autoSpeakTimer) {
        clearTimeout(this.autoSpeakTimer);
      }
      if (this.moodCheckTimer) {
        clearInterval(this.moodCheckTimer);
      }
    },

    // 安排下次主动说话
    scheduleAutoSpeak() {
      if (!this.settings.autoSpeak || this.mood <= 60) {
        return;
      }

      // 30-60秒后随机触发
      const delay = 30000 + Math.random() * 30000;

      this.autoSpeakTimer = setTimeout(() => {
        const phrase = window.PersonalityPrompts.getRandomPhrase(this.currentPersonality);
        this.showBubbleMessage(phrase, 3000);
        this.scheduleAutoSpeak(); // 继续安排下一次
      }, delay);
    },

    // 显示气泡消息
    showBubbleMessage(message, duration = 0) {
      this.currentMessage = message;
      this.showBubble = true;

      if (duration > 0) {
        setTimeout(() => {
          this.showBubble = false;
        }, duration);
      }
    },

    // 隐藏气泡
    hideBubble() {
      this.showBubble = false;
      this.currentMessage = '';
    },

    // 处理宠物点击
    handlePetClick() {
      if (this.isDragging) {
        return;
      }

      this.showInput = !this.showInput;

      if (this.showInput) {
        this.$nextTick(() => {
          if (this.$refs.messageInput) {
            this.$refs.messageInput.focus();
          }
        });
      }
    },

    // 发送消息
    async sendMessage() {
      const message = this.userInput.trim();

      if (!message) {
        return;
      }

      // 添加用户消息到历史
      window.PetStorage.addChatMessage('user', message);
      this.chatHistory = window.PetStorage.getChatHistory();
      this.userInput = '';
      this.showInput = false;

      // 显示思考中
      this.showBubbleMessage('思考中...');

      // 调用AI
      try {
        const reply = await window.PetAPI.chatWithAI(
          message,
          this.currentPersonality,
          this.chatHistory
        );

        // 添加AI回复到历史
        window.PetStorage.addChatMessage('assistant', reply);
        this.chatHistory = window.PetStorage.getChatHistory();

        // 显示回复
        this.showBubbleMessage(reply);

        // 3秒后自动隐藏（除非用户正在查看）
        setTimeout(() => {
          if (!this.showInput) {
            this.hideBubble();
          }
        }, 3000);

        // 更新心情值
        this.mood = window.PetStorage.updateMood(5);
        this.saveData();

      } catch (error) {
        console.error('Chat error:', error);
        this.showBubbleMessage('抱歉，我出错了，请稍后再试~');
      }
    },

    // 选择宠物
    selectPet(pet) {
      this.currentPet = pet;
      this.settings.selectedPet = pet;
      this.saveData();
    },

    // 选择性格
    selectPersonality(personality) {
      this.currentPersonality = personality;

      // 切换性格时清空历史，避免上下文混乱
      window.PetStorage.clearChatHistory();
      this.chatHistory = [];

      this.saveData();

      // 重新启动定时器
      this.stopTimers();
      this.startTimers();

      this.showBubbleMessage('主人，我换了个性格哦~');
    },

    // 清空历史
    clearHistory() {
      if (confirm('确定要清空所有对话历史吗？')) {
        window.PetStorage.clearChatHistory();
        this.chatHistory = [];
        this.showHistory = false;
      }
    },

    // 重置所有数据
    resetData() {
      if (confirm('确定要重置所有数据吗？这将清除所有设置和历史记录。')) {
        window.PetStorage.resetAllData();
        location.reload();
      }
    },

    // 格式化时间
    formatTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;

      if (diff < 60000) { // 1分钟内
        return '刚刚';
      } else if (diff < 3600000) { // 1小时内
        return `${Math.floor(diff / 60000)}分钟前`;
      } else if (diff < 86400000) { // 24小时内
        return `${Math.floor(diff / 3600000)}小时前`;
      } else {
        return date.toLocaleDateString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    },

    // 拖拽相关
    startDrag(event) {
      // 只在非点击区域触发拖拽
      if (event.target.classList.contains('pet-emoji')) {
        this.isDragging = false;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;

        document.addEventListener('mousemove', this.onDrag);
        document.addEventListener('mouseup', this.stopDrag);
      }
    },

    onDrag(event) {
      const deltaX = event.clientX - this.dragStartX;
      const deltaY = event.clientY - this.dragStartY;

      // 移动超过10px才算拖拽
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        this.isDragging = true;

        if (window.electron && window.electron.moveWindow) {
          window.electron.moveWindow(deltaX, deltaY);
        }

        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
      }
    },

    stopDrag() {
      setTimeout(() => {
        this.isDragging = false;
      }, 100);

      document.removeEventListener('mousemove', this.onDrag);
      document.removeEventListener('mouseup', this.stopDrag);
    }
  },

  watch: {
    'settings.autoSpeak'(newVal) {
      this.stopTimers();
      if (newVal) {
        this.startTimers();
      }
      this.saveData();
    }
  }
}).mount('#app');
