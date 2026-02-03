// 记忆管理器
// 高层 API，协调各模块工作

import MemoryStorage from './storage.js';
import EmbeddingService from './embeddings.js';
import MemorySearchEngine from './search.js';
import FactExtractor from './extractor.js';
import ContextBuilder from './context.js';
import TextChunker from './chunker.js';
import { MEMORY_CONFIG } from './config.js';

class MemoryManager {
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

    this.isInitialized = false;
  }

  // 初始化
  async initialize() {
    if (this.isInitialized) {
      console.log('MemoryManager already initialized');
      return true;
    }

    try {
      // 初始化存储
      await this.storage.initialize();

      // 设置模块依赖关系
      this.embeddingService.setStorage(this.storage);
      this.searchEngine.setStorage(this.storage);
      this.searchEngine.setEmbeddingService(this.embeddingService);
      this.factExtractor.setStorage(this.storage);

      this.isInitialized = true;
      console.log('MemoryManager initialized successfully');
      return true;

    } catch (error) {
      console.error('Failed to initialize MemoryManager:', error);
      throw error;
    }
  }

  // 添加对话（自动分块、嵌入、存储）
  async addConversation(role, content, metadata = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    try {
      // 1. 保存对话
      const conversation = this.storage.saveConversation(role, content, {
        personality: metadata.personality || this.options.personality,
        mood: metadata.mood,
        extra: metadata.extra
      });

      console.log(`Conversation saved: ${conversation.id}`);

      // 2. 分块处理
      const chunks = this.textChunker.chunk(content, {
        conversationId: conversation.id
      });

      console.log(`Text chunked into ${chunks.length} parts`);

      // 3. 生成嵌入
      const texts = chunks.map(c => c.text);
      const embeddings = await this.embeddingService.embedBatch(texts);

      // 4. 为每个块添加嵌入
      chunks.forEach((chunk, index) => {
        chunk.embedding = embeddings[index];
      });

      // 5. 批量保存记忆块
      this.storage.batchSaveMemoryChunks(chunks);

      console.log(`Memory chunks saved: ${chunks.length}`);

      // 6. 提取并保存事实
      if (this.factExtractor.config.autoExtract) {
        setTimeout(() => {
          this.factExtractor.extractAndSaveFacts({
            id: conversation.id,
            role,
            content
          }).catch(err => {
            console.error('Fact extraction error:', err);
          });
        }, 0);
      }

      return conversation;

    } catch (error) {
      console.error('Failed to add conversation:', error);
      throw error;
    }
  }

  // 搜索记忆
  async searchMemories(query, options = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    return await this.searchEngine.search(query, options);
  }

  // 获取上下文（为 AI 对话准备）
  async getContextForQuery(query, options = {}) {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    const {
      maxTokens = MEMORY_CONFIG.context.maxTokens,
      maxMemories = MEMORY_CONFIG.context.maxMemories
    } = options;

    // 搜索相关记忆
    const searchResults = await this.searchEngine.search(query, {
      limit: maxMemories,
      minScore: 0.5
    });

    // 构建上下文
    const context = this.contextBuilder.build(searchResults, {
      query,
      maxTokens,
      maxMemories
    });

    return context;
  }

  // 获取用户画像
  async getUserProfile() {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    return await this.factExtractor.getUserProfile();
  }

  // 数据统计
  getStats() {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    const dbStats = this.storage.getStats();
    const cacheStats = this.embeddingService.getCacheStats();

    return {
      ...dbStats,
      cache: cacheStats
    };
  }

  // 清理旧数据
  clearOldMemories(beforeDate) {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    return this.storage.clearOldMemories(beforeDate);
  }

  // 清空所有数据
  clearAll() {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
    }

    this.storage.clearAll();
    console.log('All memories cleared');
  }

  // 关闭
  close() {
    if (this.storage) {
      this.storage.close();
    }
    this.isInitialized = false;
    console.log('MemoryManager closed');
  }

  // 数据迁移：从 LocalStorage 导入历史
  async migrateFromLocalStorage(localStorageData) {
    if (!this.isInitialized) {
      throw new Error('MemoryManager not initialized');
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
      throw new Error('MemoryManager not initialized');
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
      throw new Error('MemoryManager not initialized');
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
}

export default MemoryManager;
