// 主进程记忆系统核心
// 协调器 - 负责协调所有模块并通过 IPC 提供接口
// CommonJS 版本 - 用于主进程

const MemoryStorage = require('./database');
const EmbeddingService = require('./embeddings');
const MemorySearchEngine = require('./search');
const FactExtractor = require('./extractor');
const ContextBuilder = require('./context');
const TextChunker = require('./chunker');
const ReminderScheduler = require('./reminder');
const { DatabaseMigrator } = require('./migrate');
const { MEMORY_CONFIG } = require('./config');

class MemoryMainProcess {
  constructor(options = {}) {
    this.options = {
      databasePath: options.databasePath || null,
      apiKey: options.apiKey || '',
      personality: options.personality || 'healing'
    };

    // 模块实例
    this.storage = new MemoryStorage(this.options.databasePath);
    this.embeddingService = new EmbeddingService({ apiKey: this.options.apiKey });
    this.searchEngine = new MemorySearchEngine();
    this.factExtractor = new FactExtractor({ apiKey: this.options.apiKey });
    this.contextBuilder = new ContextBuilder();
    this.textChunker = new TextChunker();
    this.reminderScheduler = new ReminderScheduler(this.storage);

    this.isInitialized = false;
  }

  // 初始化
  async initialize() {
    if (this.isInitialized) {
      console.log('MemoryMainProcess already initialized');
      return true;
    }

    try {
      // 初始化存储
      await this.storage.initialize();

      // 执行数据库迁移
      const migrator = new DatabaseMigrator(this.storage);
      await migrator.migrate();

      // 设置模块依赖关系
      this.embeddingService.setStorage(this.storage);
      this.searchEngine.setStorage(this.storage);
      this.searchEngine.setEmbeddingService(this.embeddingService);
      this.factExtractor.setStorage(this.storage);
      this.reminderScheduler.setStorage(this.storage);

      // 启动提醒调度器
      this.reminderScheduler.start();

      this.isInitialized = true;
      console.log('MemoryMainProcess initialized successfully');
      return true;

    } catch (error) {
      console.error('Failed to initialize MemoryMainProcess:', error);
      throw error;
    }
  }

  // 添加对话（分步启用功能）
  async addConversation(role, content, metadata = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    try {
      // 1. 保存对话
      const conversation = this.storage.saveConversation(role, content, {
        personality: metadata.personality || this.options.personality,
        mood: metadata.mood,
        extra: metadata.extra
      });

      console.log(`[Memory] Conversation saved: ${conversation.id}`);

      // 2. 同步分块处理（不使用异步，避免卡死）
      try {
        console.log('[Memory] Starting chunking...');

        // 简化版分块：直接保存整个文本作为一个块
        const chunk = {
          id: this.storage.generateId(),
          conversationId: conversation.id,
          chunkIndex: 0,
          text: content,
          embedding: null,
          startPos: 0,
          endPos: content.length
        };

        this.storage.saveMemoryChunk(chunk);
        console.log('[Memory] Chunk saved successfully');
      } catch (chunkError) {
        console.error('[Memory] Chunking error:', chunkError);
        // 分块失败不影响主流程
      }

      return conversation;

    } catch (error) {
      console.error('[Memory] Failed to add conversation:', error);
      throw error;
    }
  }

  // 搜索记忆
  async searchMemories(query, options = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return await this.searchEngine.search(query, options);
  }

  // 获取上下文（为 AI 对话准备）
  async getContext(query, options = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    const {
      maxTokens = MEMORY_CONFIG.context.maxTokens,
      maxMemories = MEMORY_CONFIG.context.maxMemories
    } = options;

    // 搜索相关记忆（降低阈值以获取更多结果）
    const searchResults = await this.searchEngine.search(query, {
      limit: maxMemories * 2,  // 获取更多候选
      minScore: 0.05,  // 大幅降低阈值，让更多记忆通过
      mood: 80,
      personality: this.options.personality || 'healing'
    });

    // 构建上下文
    const context = this.contextBuilder.build(searchResults, {
      query,
      maxTokens,
      maxMemories
    });

    return context;
  }

  // 获取事实
  async getFacts(options = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.storage.getFacts(options);
  }

  // 获取用户画像
  async getUserProfile() {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return await this.factExtractor.getUserProfile();
  }

  // 数据统计
  getStats() {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    const dbStats = this.storage.getStats();
    const cacheStats = this.embeddingService.getCacheStats();

    return {
      ...dbStats,
      cache: cacheStats
    };
  }

  // 保存显示器画像
  saveDisplayProfiles(profiles, activeDisplayId = null) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }
    return this.storage.saveDisplayProfiles(profiles, activeDisplayId);
  }

  // 清理旧数据
  clearOldMemories(beforeDate) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.storage.clearOldMemories(beforeDate);
  }

  // 清空所有数据
  clearAll() {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    this.storage.clearAll();
    console.log('All memories cleared');
  }

  // 关闭
  close() {
    // 停止提醒调度器
    if (this.reminderScheduler) {
      this.reminderScheduler.stop();
    }
    
    if (this.storage) {
      this.storage.close();
    }
    this.isInitialized = false;
    console.log('MemoryMainProcess closed');
  }

  // ==================== 提醒功能 ====================

  // 设置主窗口（用于提醒通知）
  setMainWindow(mainWindow) {
    if (this.reminderScheduler) {
      this.reminderScheduler.setMainWindow(mainWindow);
    }
  }

  // 创建提醒
  async createReminder(reminderData) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.reminderScheduler.createReminder(reminderData);
  }

  // 获取提醒列表
  async getReminders(options = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.reminderScheduler.getReminders(options);
  }

  // 获取待处理提醒
  async getPendingReminders() {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.reminderScheduler.getPendingReminders();
  }

  // 取消提醒
  async cancelReminder(id) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.reminderScheduler.cancelReminder(id);
  }

  // 删除提醒
  async deleteReminder(id) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    return this.reminderScheduler.deleteReminder(id);
  }

  // 数据迁移：从 LocalStorage 导入历史
  async migrateFromLocalStorage(localStorageData) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    const { chatHistory = [], petData = {} } = localStorageData;

    console.log(`Starting migration of ${chatHistory.length} conversations`);

    let imported = 0;
    let failed = 0;

    for (const msg of chatHistory) {
      try {
        await this.addConversation(msg.role, msg.content, {
          personality: petData.personality || 'healing',
          mood: petData.mood || 80,
          extra: { migrated: true, originalTimestamp: msg.timestamp }
        });
        imported++;
      } catch (error) {
        console.error(`Failed to migrate message:`, error);
        failed++;
      }
    }

    console.log(`Migration complete: ${imported} imported, ${failed} failed`);

    return { imported, failed };
  }

  // 导出数据
  exportData() {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    const conversations = this.storage.getConversations({ limit: 10000 });
    const facts = this.storage.getFacts();
    const stats = this.getStats();

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      stats,
      conversations,
      facts
    };
  }

  // 导入数据
  async importData(data) {
    if (!this.isInitialized) {
      throw new Error('MemoryMainProcess not initialized');
    }

    console.log('Starting data import');

    // 导入对话
    if (data.conversations && Array.isArray(data.conversations)) {
      for (const conv of data.conversations) {
        try {
          await this.addConversation(conv.role, conv.content, {
            personality: conv.personality,
            mood: conv.mood,
            extra: conv.metadata
          });
        } catch (error) {
          console.error('Failed to import conversation:', error);
        }
      }
    }

    // 导入事实
    if (data.facts && Array.isArray(data.facts)) {
      this.storage.batchSaveFacts(data.facts);
    }

    console.log('Data import complete');
  }

  // 注册 IPC handlers
  registerIPCHandlers(ipcMain) {
    // 初始化
    ipcMain.handle('memory:init', async () => {
      return await this.initialize();
    });

    // 添加对话
    ipcMain.handle('memory:add-conversation', async (event, role, content, metadata) => {
      return await this.addConversation(role, content, metadata);
    });

    // 搜索记忆
    ipcMain.handle('memory:search', async (event, query, options) => {
      return await this.searchMemories(query, options);
    });

    // 获取上下文
    ipcMain.handle('memory:get-context', async (event, query, options) => {
      return await this.getContext(query, options);
    });

    // 获取事实
    ipcMain.handle('memory:get-facts', async (event, options) => {
      return await this.getFacts(options);
    });

    // 获取用户画像
    ipcMain.handle('memory:get-user-profile', async () => {
      return await this.getUserProfile();
    });

    // 获取统计
    ipcMain.handle('memory:get-stats', async () => {
      return this.getStats();
    });

    // 清空数据
    ipcMain.handle('memory:clear-all', async () => {
      return this.clearAll();
    });

    // 导出数据
    ipcMain.handle('memory:export', async () => {
      return this.exportData();
    });

    // 导入数据
    ipcMain.handle('memory:import', async (event, data) => {
      return await this.importData(data);
    });

    // 迁移 LocalStorage
    ipcMain.handle('memory:migrate-localstorage', async (event, data) => {
      return await this.migrateFromLocalStorage(data);
    });

    // ==================== 提醒 IPC ====================

    // 创建提醒
    ipcMain.handle('reminder:create', async (event, data) => {
      console.log('[IPC] reminder:create called with:', JSON.stringify(data));
      try {
        const result = await this.createReminder(data);
        console.log('[IPC] reminder:create success:', result);
        return result;
      } catch (error) {
        console.error('[IPC] reminder:create error:', error);
        throw error;
      }
    });

    // 获取提醒列表
    ipcMain.handle('reminder:get-all', async (event, options) => {
      return await this.getReminders(options);
    });

    // 获取待处理提醒
    ipcMain.handle('reminder:get-pending', async () => {
      return await this.getPendingReminders();
    });

    // 取消提醒
    ipcMain.handle('reminder:cancel', async (event, id) => {
      return await this.cancelReminder(id);
    });

    // 删除提醒
    ipcMain.handle('reminder:delete', async (event, id) => {
      return await this.deleteReminder(id);
    });

    // 获取用户时间偏好
    ipcMain.handle('reminder:get-preference', async (event, keyword) => {
      return this.reminderScheduler.getUserTimePreference(keyword);
    });

    // 分析用户习惯
    ipcMain.handle('reminder:analyze-habits', async () => {
      return this.reminderScheduler.analyzeUserHabits();
    });

    // 获取提醒历史
    ipcMain.handle('reminder:get-history', async (event, options) => {
      return this.reminderScheduler.getReminderHistory(options);
    });

    // 注意：提醒调度器的 IPC 已在上面单独注册，不需要重复调用
    // this.reminderScheduler.registerIPCHandlers();

    console.log('Memory IPC handlers registered');
  }
}

module.exports = MemoryMainProcess;
