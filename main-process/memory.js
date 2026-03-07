// 主进程记忆系统核心
// 协调器 - 负责协调所有模块并通过 IPC 提供接口
// v2: 集成本地向量嵌入、LLM 事实提取、分层记忆管理
// CommonJS 版本 - 用于主进程

const MemoryStorage = require('./database');
const EmbeddingService = require('./embeddings');
const MemorySearchEngine = require('./search');
const FactExtractor = require('./extractor');
const ContextBuilder = require('./context');
const TextChunker = require('./chunker');
const ReminderScheduler = require('./reminder');
const HealthReminderScheduler = require('./health-reminder');
const TaskManager = require('./task-manager');
const WidgetManager = require('./widget-manager');
const FileOperationsManager = require('./file-operations');
const { DatabaseMigrator } = require('./migrate');
const { MEMORY_CONFIG } = require('./config');

// 新组件
const EmbeddingEngine = require('./embedding');
const FactExtractorLLM = require('./fact-extractor');
const MemoryLayerManager = require('./memory-layer');
const StrengthCalculator = require('./strength');

class MemoryMainProcess {
  constructor(options = {}) {
    this.options = {
      databasePath: options.databasePath || null,
      apiKey: options.apiKey || '',
      personality: options.personality || 'healing'
    };

    // 原有模块
    this.storage = new MemoryStorage(this.options.databasePath);
    this.embeddingService = new EmbeddingService({ apiKey: this.options.apiKey });
    this.searchEngine = new MemorySearchEngine();
    this.factExtractor = new FactExtractor({ apiKey: this.options.apiKey });
    this.contextBuilder = new ContextBuilder();
    this.textChunker = new TextChunker();
    this.reminderScheduler = new ReminderScheduler(this.storage);
    this.healthScheduler = new HealthReminderScheduler(this.storage);
    this.taskManager = new TaskManager(this.storage);
    this.widgetManager = new WidgetManager(this.storage);
    this.fileOperations = FileOperationsManager;

    // 新组件
    this.embeddingEngine = null;       // 本地 ONNX 嵌入引擎
    this.factExtractorLLM = null;      // LLM 事实提取器
    this.memoryLayerManager = null;    // 分层记忆管理器

    this.isInitialized = false;
  }

  // 初始化
  async initialize() {
    if (this.isInitialized) {
      console.log('MemoryMainProcess already initialized');
      return true;
    }

    // 第一阶段：核心存储（必须成功）
    try {
      console.log('[Memory] Step 1: Initializing storage...');
      await this.storage.initialize();
      console.log('[Memory] Step 1: Storage initialized OK');

      console.log('[Memory] Step 2: Running migrations...');
      const migrator = new DatabaseMigrator(this.storage);
      await migrator.migrate();
      console.log('[Memory] Step 2: Migrations OK');

      // 设置基础模块依赖
      this.embeddingService.setStorage(this.storage);
      this.searchEngine.setStorage(this.storage);
      this.searchEngine.setEmbeddingService(this.embeddingService);
      this.factExtractor.setStorage(this.storage);
      this.reminderScheduler.setStorage(this.storage);
      this.healthScheduler.setStorage(this.storage);
      this.taskManager.setStorage(this.storage);
      this.widgetManager.setStorage(this.storage);
      this.fileOperations.setStorage(this.storage);

      // 启动提醒调度器
      this.reminderScheduler.start();
      // 启动健康提醒调度器
      this.healthScheduler.start();
      // 启动任务管理器
      this.taskManager.start();
      // 初始化小组件管理器
      this.widgetManager.initialize();
      console.log('[Memory] Core modules ready (storage + reminder + health + task + widget)');

      // 标记为已初始化（基础功能可用）
      this.isInitialized = true;
    } catch (error) {
      console.error('[Memory] Core initialization failed:', error);
      console.error('[Memory] Stack:', error.stack);
      throw error;
    }

    // 第二阶段：高级组件（失败不影响基础功能）
    try {
      console.log('[Memory] Step 3: Initializing advanced components...');
      await this._initializeNewComponents();
      console.log('[Memory] Step 3: Advanced components OK');
    } catch (error) {
      console.error('[Memory] Advanced components failed (non-fatal):', error.message);
    }

    console.log('MemoryMainProcess initialized successfully');
    return true;
  }

  // 初始化新组件（异步，不阻塞主流程）
  async _initializeNewComponents() {
    const config = MEMORY_CONFIG;

    // 1. 本地嵌入引擎（异步初始化，不阻塞）
    if (config.localEmbedding && config.localEmbedding.enabled) {
      this.embeddingEngine = new EmbeddingEngine({
        modelName: config.localEmbedding.modelName,
        dimensions: config.localEmbedding.dimensions,
        maxBatchSize: config.localEmbedding.maxBatchSize
      });

      // 注入到搜索引擎
      this.searchEngine.setEmbeddingEngine(this.embeddingEngine);

      // 异步加载模型（不阻塞启动）
      this.embeddingEngine.initialize().then(ready => {
        if (ready) {
          console.log('[Memory] 本地嵌入引擎已就绪');
          // 启动后台批量嵌入迁移
          this._startBackgroundMigration();
        } else {
          console.log('[Memory] 本地嵌入引擎加载失败，回退到关键词搜索');
        }
      }).catch(err => {
        console.error('[Memory] 嵌入引擎初始化异常:', err.message);
      });
    }

    // 2. LLM 事实提取器
    if (config.factExtraction && config.factExtraction.enabled) {
      this.factExtractorLLM = new FactExtractorLLM({
        apiKey: this.options.apiKey,
        apiHost: config.factExtraction.apiHost,
        apiPath: config.factExtraction.apiPath,
        model: config.factExtraction.model,
        bufferThreshold: config.factExtraction.bufferThreshold,
        storage: this.storage
      });
    }

    // 3. 分层记忆管理器
    if (config.memoryLayers && config.memoryLayers.enabled) {
      this.memoryLayerManager = new MemoryLayerManager({
        storage: this.storage,
        searchEngine: this.searchEngine,
        embeddingEngine: this.embeddingEngine,
        factExtractor: this.factExtractorLLM,
        totalTokens: config.memoryLayers.tokenBudget.total,
        profileTokens: config.memoryLayers.tokenBudget.profile,
        coreTokens: config.memoryLayers.tokenBudget.core,
        historyTokens: config.memoryLayers.tokenBudget.history
      });

      // 注入到上下文构建器
      this.contextBuilder.setMemoryLayerManager(this.memoryLayerManager);
    }
  }

  // 后台批量嵌入迁移
  async _startBackgroundMigration() {
    if (!this.memoryLayerManager || !this.embeddingEngine || !this.embeddingEngine.isReady()) return;

    const config = MEMORY_CONFIG.localEmbedding?.migration || {};

    // 延迟 10 秒后开始，避免影响启动
    setTimeout(async () => {
      try {
        const result = await this.memoryLayerManager.migrateHistoryEmbeddings({
          batchSize: config.batchSize || 50,
          delayMs: config.delayMs || 1000
        });
        console.log(`[Memory] 历史嵌入迁移完成: ${result.processed}/${result.total}`);
      } catch (error) {
        console.error('[Memory] 历史嵌入迁移失败:', error.message);
      }
    }, 10000);
  }

  // 添加对话（集成新组件）
  async addConversation(role, content, metadata = {}) {
    await this._ensureInitialized();

    try {
      // 1. 保存对话
      const conversation = this.storage.saveConversation(role, content, {
        personality: metadata.personality || this.options.personality,
        mood: metadata.mood,
        extra: metadata.extra
      });

      console.log(`[Memory] Conversation saved: ${conversation.id}`);

      // 2. 同步分块处理
      try {
        const mood = metadata.mood || 80;
        const emotionalWeight = StrengthCalculator.calcEmotionalWeight(mood);
        // 初始稳定性改为 24h（1天）以实现有效自然遗忘，根据情感权重调整
        const initialStability = 24 * emotionalWeight;

        const chunk = {
          id: this.storage.generateId(),
          conversationId: conversation.id,
          chunkIndex: 0,
          text: content,
          embedding: null,
          startPos: 0,
          endPos: content.length,
          // FSRS 动态强化字段
          triggerCount: 0,
          lastTriggeredAt: null,
          stability: initialStability,
          strength: 1.0,
          emotionalWeight: emotionalWeight
        };

        this.storage.saveMemoryChunk(chunk);
      } catch (chunkError) {
        console.error('[Memory] Chunking error:', chunkError);
      }

      // 3. 异步：为新对话生成嵌入
      if (this.embeddingEngine && this.embeddingEngine.isReady()) {
        this._asyncGenerateEmbedding(content, conversation.id);
      }

      // 4. 异步：向 LLM 事实提取器添加对话
      if (this.factExtractorLLM && role === 'user') {
        // 等收到 AI 回复后再触发（在 onConversationPairComplete 中处理）
        // 这里只记录用户消息
        this._lastUserMessage = { content, conversationId: conversation.id, metadata };
      }

      // 如果是 AI 回复，配对触发事实提取
      if (this.factExtractorLLM && role === 'assistant' && this._lastUserMessage) {
        const userMsg = this._lastUserMessage;
        this._lastUserMessage = null;

        // 异步提取事实
        this.factExtractorLLM.addConversation(
          userMsg.content,
          content,
          { conversationId: userMsg.conversationId, ...metadata }
        ).catch(err => {
          console.error('[Memory] 事实提取异常:', err.message);
        });
      }

      return conversation;

    } catch (error) {
      console.error('[Memory] Failed to add conversation:', error);
      throw error;
    }
  }

  // 异步生成嵌入（不阻塞）
  async _asyncGenerateEmbedding(text, conversationId) {
    try {
      const embedding = await this.embeddingEngine.embed(text);
      if (!embedding) return;

      // 更新对应 memory_chunk 的 embedding
      const chunk = this.storage.db.prepare(
        'SELECT id FROM memory_chunks WHERE conversation_id = ? LIMIT 1'
      ).get(conversationId);

      if (chunk) {
        const embeddingBlob = this.storage.floatArrayToBlob(embedding);
        this.storage.db.prepare(
          'UPDATE memory_chunks SET embedding = ? WHERE id = ?'
        ).run(embeddingBlob, chunk.id);
      }
    } catch (error) {
      console.error('[Memory] 嵌入生成失败:', error.message);
    }
  }

  // 搜索记忆
  async searchMemories(query, options = {}) {
    await this._ensureInitialized();

    return await this.searchEngine.search(query, options);
  }

  // 获取上下文（为 AI 对话准备）
  async getContext(query, options = {}) {
    await this._ensureInitialized();

    const {
      maxTokens = MEMORY_CONFIG.context.maxTokens,
      maxMemories = MEMORY_CONFIG.context.maxMemories,
      currentMood = 80
    } = options;

    // 搜索相关记忆
    const searchResults = await this.searchEngine.search(query, {
      limit: maxMemories * 2,
      minScore: 0.05,
      mood: currentMood,
      personality: this.options.personality || 'healing'
    });

    // 新增：强化被检索命中的记忆（FSRS 系统）
    if (searchResults && searchResults.length > 0) {
      this._reinforceHitMemories(searchResults, { currentMood });
    }

    // 构建上下文（context.js 会自动使用分层或传统模式）
    const context = await this.contextBuilder.build(searchResults, {
      query,
      maxTokens,
      maxMemories
    });

    return context;
  }

  // 获取事实
  async getFacts(options = {}) {
    await this._ensureInitialized();

    return this.storage.getFacts(options);
  }

  // 获取用户画像（优先使用新的分层系统）
  async getUserProfile() {
    await this._ensureInitialized();

    // 优先使用 LLM 事实提取器的画像
    if (this.factExtractorLLM) {
      const profile = this.factExtractorLLM.getUserProfile();
      if (profile && Object.keys(profile).length > 0) {
        return profile;
      }
    }

    // 优先使用分层记忆管理器的画像
    if (this.memoryLayerManager) {
      try {
        const profile = await this.memoryLayerManager.getUserProfile();
        if (profile && (profile.name || profile.preferences?.length > 0)) {
          return profile;
        }
      } catch (error) {
        // 降级
      }
    }

    // 回退到旧的事实提取器
    return await this.factExtractor.getUserProfile();
  }

  // 数据统计
  getStats() {
    if (!this.isInitialized) return {};

    const dbStats = this.storage.getStats();
    const cacheStats = this.embeddingService.getCacheStats();

    // 新增：嵌入引擎状态
    const embeddingInfo = this.embeddingEngine ? this.embeddingEngine.getInfo() : null;

    // 新增：用户画像计数
    let profileCount = 0;
    try {
      const result = this.storage.db.prepare('SELECT COUNT(*) as count FROM user_profile').get();
      profileCount = result.count;
    } catch (e) {
      // user_profile 表可能不存在
    }

    return {
      ...dbStats,
      cache: cacheStats,
      embedding: embeddingInfo,
      profileEntries: profileCount
    };
  }

  // 手动触发事实提取刷新
  async flushFactExtraction() {
    if (this.factExtractorLLM) {
      return await this.factExtractorLLM.flushBuffer();
    }
    return [];
  }

  // 保存显示器画像
  saveDisplayProfiles(profiles, activeDisplayId = null) {
    if (!this.isInitialized) return;
    return this.storage.saveDisplayProfiles(profiles, activeDisplayId);
  }

  // 清理旧数据
  clearOldMemories(beforeDate) {
    if (!this.isInitialized) return;

    return this.storage.clearOldMemories(beforeDate);
  }

  // 清空所有数据
  clearAll() {
    if (!this.isInitialized) return;

    this.storage.clearAll();
    // 也清空 user_profile 表
    try {
      this.storage.db.exec('DELETE FROM user_profile');
    } catch (e) {
      // 表可能不存在
    }
    console.log('All memories cleared');
  }

  // 强化被检索命中的记忆（FSRS 系统）
  _reinforceHitMemories(searchResults, options = {}) {
    if (!searchResults || !this.storage || !this.storage.db) return;

    const { currentMood = 80, preventDuplicates = true } = options;
    const config = MEMORY_CONFIG.memoryStrength?.reinforcement || {};
    const cooldownMs = config.cooldownMs || 3600000; // 默认 1 小时
    const now = Date.now();

    // 防重复：记录本次强化的 ID，避免多条结果中同一条 chunk 被重复强化
    const reinforcedIds = new Set();

    for (const result of searchResults) {
      if (!result.conversationId) continue;

      // 获取该对话的 memory_chunk
      try {
        const chunk = this.storage.db.prepare(`
          SELECT id, trigger_count, last_triggered_at, stability, emotional_weight
          FROM memory_chunks
          WHERE conversation_id = ? LIMIT 1
        `).get(result.conversationId);

        if (!chunk) continue;

        // 防重复触发：同一条记忆本次不强化第二次
        if (preventDuplicates && reinforcedIds.has(chunk.id)) {
          continue;
        }

        // 防重复触发：同一条记忆冷却期内不强化
        if (preventDuplicates && chunk.last_triggered_at) {
          const timeSinceLastTrigger = now - chunk.last_triggered_at;
          if (timeSinceLastTrigger < cooldownMs) {
            continue;
          }
        }

        // 执行强化
        StrengthCalculator.reinforceMemory(this.storage.db, chunk.id, currentMood);
        reinforcedIds.add(chunk.id);

      } catch (error) {
        console.error('[Memory] Error reinforcing memory:', error.message);
      }
    }

    if (reinforcedIds.size > 0) {
      console.log(`[Memory] Reinforced ${reinforcedIds.size} memories`);
    }
  }

  // 关闭
  close() {
    // 停止提醒调度器
    if (this.reminderScheduler) {
      this.reminderScheduler.stop();
    }

    // 停止健康提醒调度器
    if (this.healthScheduler) {
      this.healthScheduler.stop();
    }

    // 停止任务管理器
    if (this.taskManager) {
      this.taskManager.stop();
    }

    // 停止小组件管理器
    if (this.widgetManager) {
      this.widgetManager.stopAutoUpdate();
    }

    // 刷新待处理的事实提取
    if (this.factExtractorLLM) {
      this.factExtractorLLM.flushBuffer().catch(() => {});
    }

    if (this.storage) {
      this.storage.close();
    }
    this.isInitialized = false;
    console.log('MemoryMainProcess closed');
  }

  // 动态更新 API Key（用于用户通过 UI 修改 key 后同步到事实提取器）
  updateApiKey(newApiKey) {
    if (this.factExtractorLLM && typeof this.factExtractorLLM.setApiKey === 'function') {
      this.factExtractorLLM.setApiKey(newApiKey);
      console.log(`[Memory] API Key 已更新 (长度: ${newApiKey ? newApiKey.length : 0})`);
    }
  }

  // ==================== 提醒功能 ====================

  // 设置主窗口（用于提醒通知）
  setMainWindow(mainWindow) {
    if (this.reminderScheduler) {
      this.reminderScheduler.setMainWindow(mainWindow);
    }
    if (this.healthScheduler) {
      this.healthScheduler.setMainWindow(mainWindow);
    }
    if (this.taskManager) {
      this.taskManager.setMainWindow(mainWindow);
    }
    if (this.fileOperations) {
      this.fileOperations.setMainWindow(mainWindow);
    }
  }

  // 确保记忆系统已初始化（自动重试）
  async _ensureInitialized() {
    if (this.isInitialized) return;
    console.log('[Memory] Not initialized, attempting auto-init...');
    await this.initialize();
  }

  // 创建提醒
  async createReminder(reminderData) {
    await this._ensureInitialized();
    return this.reminderScheduler.createReminder(reminderData);
  }

  // 获取提醒列表
  async getReminders(options = {}) {
    await this._ensureInitialized();
    return this.reminderScheduler.getReminders(options);
  }

  // 获取待处理提醒
  async getPendingReminders() {
    await this._ensureInitialized();
    return this.reminderScheduler.getPendingReminders();
  }

  // 取消提醒
  async cancelReminder(id) {
    await this._ensureInitialized();
    return this.reminderScheduler.cancelReminder(id);
  }

  // 删除提醒
  async deleteReminder(id) {
    await this._ensureInitialized();
    return this.reminderScheduler.deleteReminder(id);
  }

  // 数据迁移：从 LocalStorage 导入历史
  async migrateFromLocalStorage(localStorageData) {
    await this._ensureInitialized();

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

    // 迁移 localStorage 中的用户事实到 user_profile 表
    if (localStorageData.userFacts && this.storage && this.storage.db) {
      try {
        const now = Date.now();
        const stmt = this.storage.db.prepare(`
          INSERT OR IGNORE INTO user_profile (key, value, confidence, updated_at)
          VALUES (?, ?, ?, ?)
        `);
        const facts = localStorageData.userFacts;
        if (facts.name) stmt.run('name', facts.name, 0.9, now);
        if (facts.gender) stmt.run('gender', facts.gender, 0.9, now);
        if (facts.birthday) stmt.run('birthday', facts.birthday, 0.9, now);
        if (facts.interests) {
          const interests = Array.isArray(facts.interests) ? facts.interests : [facts.interests];
          interests.forEach(i => stmt.run(`like.${i}`, i, 0.8, now));
        }
        console.log('[Memory] 用户事实已迁移到 user_profile 表');
      } catch (error) {
        console.error('[Memory] 用户事实迁移失败:', error.message);
      }
    }

    console.log(`Migration complete: ${imported} imported, ${failed} failed`);

    return { imported, failed };
  }

  // 导出数据
  exportData() {
    if (!this.isInitialized) return { conversations: [], facts: [], stats: {} };

    const conversations = this.storage.getConversations({ limit: 10000 });
    const facts = this.storage.getFacts();
    const stats = this.getStats();

    // 新增：导出用户画像
    let userProfile = {};
    try {
      const rows = this.storage.db.prepare('SELECT * FROM user_profile').all();
      userProfile = rows;
    } catch (e) {
      // 表可能不存在
    }

    return {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      stats,
      conversations,
      facts,
      userProfile
    };
  }

  // 导入数据
  async importData(data) {
    await this._ensureInitialized();

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

    // 导入用户画像
    if (data.userProfile && Array.isArray(data.userProfile)) {
      try {
        const stmt = this.storage.db.prepare(`
          INSERT OR REPLACE INTO user_profile (key, value, confidence, updated_at, source_fact_id)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const row of data.userProfile) {
          stmt.run(row.key, row.value, row.confidence, row.updated_at, row.source_fact_id);
        }
      } catch (e) {
        console.error('Failed to import user profile:', e.message);
      }
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

    // ==================== 新增：记忆系统升级 IPC ====================

    // 获取嵌入引擎状态
    ipcMain.handle('memory:embedding-status', async () => {
      if (!this.embeddingEngine) return { ready: false, loading: false };
      return this.embeddingEngine.getInfo();
    });

    // 手动触发事实提取
    ipcMain.handle('memory:flush-facts', async () => {
      return await this.flushFactExtraction();
    });

    // 获取分层记忆上下文
    ipcMain.handle('memory:get-layered-context', async (event, query, options) => {
      if (!this.memoryLayerManager) {
        return await this.getContext(query, options);
      }
      return await this.memoryLayerManager.buildLayeredContext(query, options);
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

    // ==================== 健康提醒 IPC ====================

    // 注册健康提醒 IPC 处理器
    if (this.healthScheduler) {
      this.healthScheduler.registerIPCHandlers();
    }

    // ==================== 任务管理 IPC ====================

    // 注册任务管理 IPC 处理器
    if (this.taskManager) {
      this.taskManager.registerIPCHandlers();
    }

    // ==================== 小组件 IPC ====================

    // 注册小组件 IPC 处理器
    if (this.widgetManager) {
      this.widgetManager.registerIPCHandlers();
    }

    // ==================== 文件操作 IPC ====================

    // 注册文件操作 IPC 处理器
    if (this.fileOperations) {
      this.fileOperations.registerIPCHandlers(ipcMain);
    }

    console.log('Memory IPC handlers registered');
  }
}

module.exports = MemoryMainProcess;
