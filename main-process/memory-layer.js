// 记忆分层管理器
// 参考 OpenClaw 三层架构：用户画像 / 重要记忆 / 对话历史
// CommonJS 版本 - 用于主进程

class MemoryLayerManager {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.searchEngine = options.searchEngine || null;
    this.embeddingEngine = options.embeddingEngine || null;
    this.factExtractor = options.factExtractor || null;

    // Token 预算分配
    this.tokenBudget = {
      total: options.totalTokens || 1500,
      profile: options.profileTokens || 200,   // Layer 1: 用户画像
      core: options.coreTokens || 800,          // Layer 2: 重要记忆
      history: options.historyTokens || 500     // Layer 3: 对话历史
    };
  }

  setStorage(storage) { this.storage = storage; }
  setSearchEngine(engine) { this.searchEngine = engine; }
  setEmbeddingEngine(engine) { this.embeddingEngine = engine; }
  setFactExtractor(extractor) { this.factExtractor = extractor; }

  // ==================== Layer 1: 用户画像 ====================
  // 始终加载，包含核心个人信息

  async getUserProfile() {
    if (!this.storage || !this.storage.db) return {};

    try {
      // 从 user_profile 表获取
      const rows = this.storage.db.prepare(
        'SELECT key, value, confidence FROM user_profile WHERE confidence >= 0.5 ORDER BY confidence DESC'
      ).all();

      const profile = {
        name: null,
        gender: null,
        age: null,
        birthday: null,
        occupation: null,
        location: null,
        preferences: [],   // 喜好
        dislikes: [],       // 不喜欢
        relationships: [],  // 关系
        other: []           // 其他
      };

      for (const row of rows) {
        const { key, value } = row;

        if (key === 'name') profile.name = value;
        else if (key === 'gender') profile.gender = value;
        else if (key === 'age') profile.age = value;
        else if (key === 'birthday') profile.birthday = value;
        else if (key === 'occupation') profile.occupation = value;
        else if (key === 'location') profile.location = value;
        else if (key.startsWith('like.')) profile.preferences.push(value);
        else if (key.startsWith('dislike.')) profile.dislikes.push(value);
        else if (key.startsWith('relationship.')) {
          profile.relationships.push({ relation: key.replace('relationship.', ''), target: value });
        }
        else profile.other.push({ key, value });
      }

      return profile;

    } catch (error) {
      console.error('[MemoryLayer] 获取用户画像失败:', error.message);
      return {};
    }
  }

  // 格式化用户画像为上下文字符串
  formatProfile(profile) {
    if (!profile) return '';

    const lines = [];
    lines.push('=== 关于用户 ===');

    if (profile.name) lines.push(`名字：${profile.name}`);
    if (profile.gender) lines.push(`性别：${profile.gender}`);
    if (profile.age) lines.push(`年龄：${profile.age}`);
    if (profile.birthday) lines.push(`生日：${profile.birthday}`);
    if (profile.occupation) lines.push(`职业：${profile.occupation}`);
    if (profile.location) lines.push(`所在地：${profile.location}`);

    if (profile.preferences && profile.preferences.length > 0) {
      lines.push(`喜欢：${profile.preferences.join('、')}`);
    }
    if (profile.dislikes && profile.dislikes.length > 0) {
      lines.push(`不喜欢：${profile.dislikes.join('、')}`);
    }
    if (profile.relationships && profile.relationships.length > 0) {
      const relStrs = profile.relationships.map(r => `${r.relation}是${r.target}`);
      lines.push(`关系：${relStrs.join('、')}`);
    }

    // 只有标题没有内容时返回空
    if (lines.length <= 1) return '';

    return lines.join('\n');
  }

  // ==================== Layer 2: 重要记忆（语义搜索） ====================
  // 通过搜索引擎找到的高相关性记忆

  async searchCoreMemories(query, options = {}) {
    if (!this.searchEngine) return [];

    const {
      limit = 5,
      minScore = 0.1,
      mood = 80,
      personality = 'healing'
    } = options;

    try {
      const results = await this.searchEngine.search(query, {
        limit: limit * 2,  // 获取更多候选
        minScore,
        mood,
        personality
      });

      // 按重要性和相关性重排
      return results
        .map(r => ({
          ...r,
          importance: this._calculateImportance(r)
        }))
        .sort((a, b) => {
          // 综合排序：相关性 * 0.6 + 重要性 * 0.4
          const scoreA = a.score * 0.6 + a.importance * 0.4;
          const scoreB = b.score * 0.6 + b.importance * 0.4;
          return scoreB - scoreA;
        })
        .slice(0, limit);

    } catch (error) {
      console.error('[MemoryLayer] 搜索重要记忆失败:', error.message);
      return [];
    }
  }

  // 计算记忆重要性
  _calculateImportance(memory) {
    let importance = 0;
    const text = (memory.text || memory.content || '').toLowerCase();

    // 包含个人信息的对话：重要
    const personalKeywords = ['名字', '叫', '性别', '生日', '年龄', '职业', '工作', '住'];
    if (personalKeywords.some(k => text.includes(k))) {
      importance += 0.4;
    }

    // 包含情感表达的对话：重要
    const emotionalKeywords = ['喜欢', '讨厌', '开心', '难过', '想要', '害怕', '感谢', '对不起'];
    if (emotionalKeywords.some(k => text.includes(k))) {
      importance += 0.3;
    }

    // 包含关系信息的对话：重要
    const relationKeywords = ['妈妈', '爸爸', '姐姐', '哥哥', '弟弟', '妹妹', '朋友', '同事', '老板', '老婆', '老公'];
    if (relationKeywords.some(k => text.includes(k))) {
      importance += 0.3;
    }

    // 内容长度影响（更长的通常更有信息量）
    if (text.length > 50) importance += 0.1;
    if (text.length > 100) importance += 0.1;

    // 用户消息优先于 AI 回复
    if (memory.role === 'user') importance += 0.1;

    return Math.min(1.0, importance);
  }

  // 格式化重要记忆
  formatCoreMemories(memories) {
    if (!memories || memories.length === 0) return '';

    const lines = ['=== 相关回忆 ==='];

    for (const memory of memories) {
      const date = this._formatRelativeTime(memory.timestamp);
      const role = memory.role === 'user' ? '用户' : '我';
      let content = memory.text || memory.content || '';
      if (content.length > 80) content = content.substring(0, 80) + '...';
      lines.push(`[${date}] ${role}：${content}`);
    }

    return lines.join('\n');
  }

  // ==================== Layer 3: 对话历史（时间衰减） ====================
  // 最近对话 + 相关历史

  async getRelevantHistory(query, options = {}) {
    if (!this.storage || !this.storage.db) return [];

    const {
      recentLimit = 4,     // 最近对话条数
      historyLimit = 3,    // 相关历史条数
      excludeIds = []       // 排除已出现的 ID（去重用）
    } = options;

    try {
      // 获取最近 N 条对话
      const recentStmt = this.storage.db.prepare(`
        SELECT id, role, content, timestamp, personality, mood
        FROM conversations
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      let recent = recentStmt.all(recentLimit);

      // 排除重复
      if (excludeIds.length > 0) {
        recent = recent.filter(r => !excludeIds.includes(r.id));
      }

      return recent.map(r => ({
        id: r.id,
        role: r.role,
        text: r.content,
        content: r.content,
        timestamp: r.timestamp,
        personality: r.personality,
        mood: r.mood,
        type: 'history'
      }));

    } catch (error) {
      console.error('[MemoryLayer] 获取对话历史失败:', error.message);
      return [];
    }
  }

  // 格式化对话历史
  formatHistory(history) {
    if (!history || history.length === 0) return '';

    const lines = ['=== 最近对话 ==='];

    // 按时间正序排列（最早的在前）
    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

    for (const conv of sorted) {
      const date = this._formatRelativeTime(conv.timestamp);
      const role = conv.role === 'user' ? '用户' : '我';
      let content = conv.text || conv.content || '';
      if (content.length > 60) content = content.substring(0, 60) + '...';
      lines.push(`[${date}] ${role}：${content}`);
    }

    return lines.join('\n');
  }

  // ==================== 对话后更新各层 ====================

  async onConversationEnd(userMsg, aiResponse, metadata = {}) {
    // 异步执行，不阻塞对话响应
    try {
      // 1. 向事实提取器添加对话
      if (this.factExtractor) {
        await this.factExtractor.addConversation(userMsg, aiResponse, metadata);
      }

      // 2. 如果有嵌入引擎且已就绪，为新对话生成嵌入
      if (this.embeddingEngine && this.embeddingEngine.isReady() && metadata.conversationId) {
        this._generateEmbeddingAsync(userMsg, metadata.conversationId);
      }

    } catch (error) {
      console.error('[MemoryLayer] 对话后处理失败:', error.message);
    }
  }

  // 异步生成嵌入（不阻塞主流程）
  async _generateEmbeddingAsync(text, conversationId) {
    try {
      const embedding = await this.embeddingEngine.embed(text);
      if (!embedding || !this.storage || !this.storage.db) return;

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
      console.error('[MemoryLayer] 嵌入生成失败:', error.message);
    }
  }

  // ==================== 综合上下文构建 ====================

  async buildLayeredContext(query, options = {}) {
    const {
      mood = 80,
      personality = 'healing',
      maxTokens = this.tokenBudget.total
    } = options;

    let context = '';
    let usedTokens = 0;

    // Layer 1: 用户画像（始终加载）
    const profile = await this.getUserProfile();
    const profileText = this.formatProfile(profile);
    if (profileText) {
      const profileTokens = this._estimateTokens(profileText);
      if (profileTokens <= this.tokenBudget.profile) {
        context += profileText + '\n\n';
        usedTokens += profileTokens;
      }
    }

    // Layer 2: 重要记忆（语义搜索）
    const coreMemories = await this.searchCoreMemories(query, {
      limit: 5,
      mood,
      personality
    });
    const coreText = this.formatCoreMemories(coreMemories);
    if (coreText) {
      const coreTokens = this._estimateTokens(coreText);
      const remainingCoreTokens = Math.min(this.tokenBudget.core, maxTokens - usedTokens);
      if (coreTokens <= remainingCoreTokens) {
        context += coreText + '\n\n';
        usedTokens += coreTokens;
      }
    }

    // Layer 3: 对话历史（排除已在 Layer 2 出现的）
    const excludeIds = coreMemories.map(m => m.id || m.conversationId);
    const history = await this.getRelevantHistory(query, { excludeIds });
    const historyText = this.formatHistory(history);
    if (historyText) {
      const historyTokens = this._estimateTokens(historyText);
      const remainingHistoryTokens = Math.min(this.tokenBudget.history, maxTokens - usedTokens);
      if (historyTokens <= remainingHistoryTokens) {
        context += historyText + '\n\n';
        usedTokens += historyTokens;
      }
    }

    // 添加提示
    if (context.trim()) {
      context += '请记住以上信息，并在对话中自然地使用。\n';
    }

    return context;
  }

  // ==================== 历史数据批量嵌入迁移 ====================

  async migrateHistoryEmbeddings(options = {}) {
    if (!this.embeddingEngine || !this.embeddingEngine.isReady()) {
      console.log('[MemoryLayer] 嵌入引擎未就绪，跳过历史迁移');
      return { processed: 0, total: 0 };
    }

    if (!this.storage || !this.storage.db) return { processed: 0, total: 0 };

    const batchSize = options.batchSize || 50;
    const delayMs = options.delayMs || 1000;

    // 获取无嵌入的记忆块数量
    const countResult = this.storage.db.prepare(
      'SELECT COUNT(*) as count FROM memory_chunks WHERE embedding IS NULL'
    ).get();
    const total = countResult.count;

    if (total === 0) {
      console.log('[MemoryLayer] 所有记忆块已有嵌入');
      return { processed: 0, total: 0 };
    }

    console.log(`[MemoryLayer] 开始批量嵌入迁移: ${total} 条待处理`);

    let processed = 0;

    while (processed < total) {
      // 获取一批无嵌入的记忆块
      const chunks = this.storage.db.prepare(`
        SELECT id, text FROM memory_chunks
        WHERE embedding IS NULL
        LIMIT ?
      `).all(batchSize);

      if (chunks.length === 0) break;

      // 批量生成嵌入
      const texts = chunks.map(c => c.text);
      const embeddings = await this.embeddingEngine.batchEmbed(texts);

      // 更新数据库
      const updateStmt = this.storage.db.prepare(
        'UPDATE memory_chunks SET embedding = ? WHERE id = ?'
      );

      const updateBatch = this.storage.db.transaction((items) => {
        for (const { id, embedding } of items) {
          if (embedding) {
            updateStmt.run(this.storage.floatArrayToBlob(embedding), id);
          }
        }
      });

      const items = chunks.map((c, i) => ({
        id: c.id,
        embedding: embeddings[i]
      }));

      updateBatch(items);
      processed += chunks.length;

      console.log(`[MemoryLayer] 嵌入迁移进度: ${processed}/${total}`);

      // 间隔延迟，不影响使用
      if (processed < total) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`[MemoryLayer] ✓ 嵌入迁移完成: ${processed} 条`);
    return { processed, total };
  }

  // ==================== 工具方法 ====================

  // 相对时间格式化
  _formatRelativeTime(timestamp) {
    if (!timestamp) return '未知时间';

    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚才';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    return new Date(timestamp).toLocaleDateString('zh-CN');
  }

  // Token 估算
  _estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords);
  }
}

module.exports = MemoryLayerManager;
