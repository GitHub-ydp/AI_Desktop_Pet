// 语义搜索引擎
// 混合搜索：向量相似度 + 全文搜索
// CommonJS 版本 - 用于主进程

const { MEMORY_CONFIG } = require('./config');

class MemorySearchEngine {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.embeddingService = options.embeddingService || null;
    this.config = {
      defaultLimit: options.limit || MEMORY_CONFIG.search.defaultLimit,
      minScore: options.minScore || MEMORY_CONFIG.search.minScore,
      vectorWeight: options.vectorWeight || MEMORY_CONFIG.search.vectorWeight,
      textWeight: options.textWeight || MEMORY_CONFIG.search.textWeight,
      timeout: options.timeout || MEMORY_CONFIG.search.timeout,
      // 新增：情感上下文
      currentMood: options.currentMood || 80,
      currentPersonality: options.currentPersonality || 'healing'
    };
  }

  // 设置当前情感状态
  setEmotionalContext(mood, personality) {
    this.config.currentMood = mood;
    this.config.currentPersonality = personality;
  }

  // 设置存储实例
  setStorage(storage) {
    this.storage = storage;
  }

  // 设置嵌入服务实例
  setEmbeddingService(service) {
    this.embeddingService = service;
  }

  // ==================== 时间衰减系统 ====================

  // 计算时间权重（核心衰减函数）
  calculateTemporalWeight(timestamp, currentTime = Date.now()) {
    const { MEMORY_CONFIG } = require('./config');
    const temporal = MEMORY_CONFIG.temporal;

    const ageInHours = (currentTime - timestamp) / (1000 * 60 * 60);

    // 使用指数衰减
    const halfLife = temporal.halfLife; // 7天半衰期
    const decayFactor = Math.pow(0.5, ageInHours / halfLife);

    // 应用下限保护
    return Math.max(decayFactor, temporal.minWeight);
  }

  // 应用交互刷新机制
  applyAccessBoost(lastAccessedAt, accessCount) {
    const { MEMORY_CONFIG } = require('./config');
    const temporal = MEMORY_CONFIG.temporal;

    if (!lastAccessedAt) return 1.0;

    const hoursSinceAccess = (Date.now() - lastAccessedAt) / (1000 * 60 * 60);

    // 最近访问（24小时内）获得 1.3x 加权
    if (hoursSinceAccess < temporal.recentThreshold) {
      return temporal.recentAccessBoost;
    }

    // 一周内访问获得 1.1x 加权
    if (hoursSinceAccess < 168) { // 7天
      return temporal.weekAccessBoost;
    }

    return 1.0;
  }

  // 应用心情调制
  applyMoodModulation(baseScore) {
    const { MEMORY_CONFIG } = require('./config');
    const moodModulation = MEMORY_CONFIG.temporal.moodModulation;

    if (!moodModulation.enabled) {
      return baseScore;
    }

    const currentMood = this.config.currentMood;

    // 高心情（>80）：宠物更专注，记忆增强 20%
    if (currentMood >= moodModulation.highMoodThreshold) {
      return baseScore * moodModulation.highMoodMultiplier;
    }

    // 低心情（<40）：宠物"分心"，记忆减弱 20%
    if (currentMood <= moodModulation.lowMoodThreshold) {
      return baseScore * moodModulation.lowMoodMultiplier;
    }

    return baseScore;
  }

  // 混合搜索（关键词版本 - 不依赖嵌入）
  async search(query, options = {}) {
    const {
      limit = this.config.defaultLimit,
      minScore = this.config.minScore,
      dateRange = null,
      mood = this.config.currentMood || 80,
      personality = this.config.currentPersonality || 'healing'
    } = options;

    if (!this.storage) {
      throw new Error('Storage must be set');
    }

    const startTime = Date.now();

    // 使用关键词搜索（基于 conversations 表）
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

    const stmt = this.storage.db.prepare(`
      SELECT id, role, content, timestamp, personality, mood
      FROM conversations
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const conversations = stmt.all(limit * 5); // 获取更多候选
    const now = Date.now();

    const results = conversations.map(conv => {
      const contentLower = (conv.content || '').toLowerCase();
      let score = 0;

      // 关键词匹配分数
      queryWords.forEach(word => {
        if (contentLower.includes(word)) {
          score += 0.4;
        }
      });

      // 时间衰减（24小时内额外加权）
      const ageInHours = (now - conv.timestamp) / (1000 * 60 * 60);
      if (ageInHours < 24) {
        score *= 1.5;
      } else if (ageInHours < 168) { // 一周内
        score *= 1.2;
      } else if (ageInHours > 720) { // 30天前，降权
        score *= 0.7;
      }

      // 心情相似度加权
      if (conv.mood !== undefined && mood !== undefined) {
        const moodDiff = Math.abs(conv.mood - mood);
        if (moodDiff < 20) {
          score *= 1.2;
        }
      }

      return {
        id: conv.id,
        conversationId: conv.id,
        text: conv.content,
        content: conv.content,
        role: conv.role,
        timestamp: conv.timestamp,
        personality: conv.personality,
        mood: conv.mood,
        score: score,
        type: 'keyword'
      };
    });

    // 过滤并排序
    let filteredResults = results
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const duration = Date.now() - startTime;
    console.log(`[Memory] Search completed in ${duration}ms, found ${filteredResults.length} results`);

    return filteredResults;
  }

  // 应用时间衰减和情感权重
  applyTemporalAndEmotionalWeights(results, mood, personality) {
    if (!results || results.length === 0) return [];

    return results.map(result => {
      let adjustedScore = result.score;

      // 1. 时间衰减
      if (result.updated_at) {
        const temporalWeight = this.calculateTemporalWeight(result.updated_at);
        adjustedScore *= temporalWeight;
      }

      // 2. 交互刷新
      if (result.last_accessed_at) {
        const accessBoost = this.applyAccessBoost(result.last_accessed_at, result.access_count);
        adjustedScore *= accessBoost;
      }

      // 3. 心情调制
      adjustedScore = this.applyMoodModulation(adjustedScore);

      // 4. 情感权重（简单实现）
      const emotionalWeight = this.calculateEmotionalWeight(result, mood, personality);
      adjustedScore *= emotionalWeight;

      result.score = adjustedScore;
      return result;
    });
  }

  // 计算情感权重（完整版）
  calculateEmotionalWeight(result, currentMood, currentPersonality) {
    const { MEMORY_CONFIG } = require('./config');
    const emotional = MEMORY_CONFIG.emotional;

    if (!emotional.enabled) {
      return 1.0;
    }

    let weight = 1.0;

    // 1. 心情权重（相似心情加权）
    if (emotional.moodWeighting && result.mood !== undefined) {
      weight *= this.calculateMoodWeight(result.mood, currentMood);
    }

    // 2. 性格偏好权重
    if (currentPersonality && emotional.personalityPriorities[currentPersonality]) {
      weight *= this.calculatePersonalityWeight(result, currentPersonality);
    }

    // 3. 情感分析权重（正向情感优先）
    const sentiment = this.extractSentiment(result.text || result.content);
    weight *= emotional.sentimentWeights[sentiment] || 1.0;

    return weight;
  }

  // 计算心情权重
  calculateMoodWeight(resultMood, currentMood) {
    const { MEMORY_CONFIG } = require('./config');
    const moodWeights = MEMORY_CONFIG.emotional.moodWeights;

    // 判断当前心情等级
    let currentLevel;
    if (currentMood >= moodWeights.high.threshold) {
      currentLevel = 'high';
    } else if (currentMood >= moodWeights.medium.threshold) {
      currentLevel = 'medium';
    } else {
      currentLevel = 'low';
    }

    // 判断结果心情等级
    let resultLevel;
    if (resultMood >= moodWeights.high.threshold) {
      resultLevel = 'high';
    } else if (resultMood >= moodWeights.medium.threshold) {
      resultLevel = 'medium';
    } else {
      resultLevel = 'low';
    }

    // 相似心情加权
    if (currentLevel === resultLevel) {
      return moodWeights[currentLevel].multiplier;
    }

    return 1.0;
  }

  // 计算性格偏好权重
  calculatePersonalityWeight(result, currentPersonality) {
    const { MEMORY_CONFIG } = require('./config');
    const priorities = MEMORY_CONFIG.emotional.personalityPriorities;

    if (!priorities[currentPersonality]) {
      return 1.0;
    }

    // 根据事实类型判断偏好
    if (result.relatedFacts && result.relatedFacts.length > 0) {
      const factTypes = result.relatedFacts.map(f => f.fact_type);
      const personalityPrefs = priorities[currentPersonality];

      // 计算匹配度
      let matchScore = 0;
      factTypes.forEach(type => {
        if (personalityPrefs[type] !== undefined) {
          matchScore += personalityPrefs[type];
        }
      });

      return 1.0 + matchScore * 0.1; // 微调
    }

    return 1.0;
  }

  // 简单情感分析
  extractSentiment(text) {
    if (!text || typeof text !== 'string') {
      return 'neutral';
    }

    const { MEMORY_CONFIG } = require('./config');
    const emotional = MEMORY_CONFIG.emotional;

    // 简单的关键词匹配
    const positiveKeywords = ['开心', '高兴', '快乐', '喜欢', '爱', '棒', '好', '幸福', '满意', '不错'];
    const negativeKeywords = ['难过', '伤心', '讨厌', '不喜欢', '差', '坏', '痛苦', '失望', '烦', '生气'];

    const lowerText = text.toLowerCase();

    let positiveCount = 0;
    let negativeCount = 0;

    positiveKeywords.forEach(keyword => {
      if (lowerText.includes(keyword)) positiveCount++;
    });

    negativeKeywords.forEach(keyword => {
      if (lowerText.includes(keyword)) negativeCount++;
    });

    if (positiveCount > negativeCount) {
      return 'positive';
    } else if (negativeCount > positiveCount) {
      return 'negative';
    }

    return 'neutral';
  }

  // 向量相似度搜索（带降级方案）
  async vectorSearch(query, limit) {
    if (!this.storage || !this.embeddingService) {
      return [];
    }

    try {
      // 生成查询向量
      const queryEmbedding = await this.embeddingService.embedText(query);

      // 获取所有记忆块（包含时间信息）
      const chunksStmt = this.storage.db.prepare(`
        SELECT id, conversation_id, text, embedding, updated_at, last_accessed_at, access_count
        FROM memory_chunks
        WHERE embedding IS NOT NULL
      `);
      const chunks = chunksStmt.all();

      // 计算相似度
      const results = chunks.map(chunk => {
        const embedding = this.storage.blobToFloatArray(chunk.embedding);
        const similarity = this.embeddingService.cosineSimilarity(queryEmbedding, embedding);

        return {
          id: chunk.id,
          conversationId: chunk.conversation_id,
          text: chunk.text,
          score: similarity,
          type: 'vector',
          updated_at: chunk.updated_at,
          last_accessed_at: chunk.last_accessed_at,
          access_count: chunk.access_count
        };
      });

      // 过滤并排序
      return results
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      console.error('Vector search failed, using keyword matching fallback:', error.message);
      return this.keywordSearch(query, limit);
    }
  }

  // 关键词匹配搜索（降级方案）
  keywordSearch(query, limit) {
    if (!this.storage) {
      return [];
    }

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

    const stmt = this.storage.db.prepare(`
      SELECT id, conversation_id, text, updated_at, last_accessed_at, access_count
      FROM memory_chunks
      ORDER BY updated_at DESC
      LIMIT ?
    `);

    const chunks = stmt.all(limit * 3); // 获取更多候选
    const now = Date.now();

    const results = chunks.map(chunk => {
      const textLower = (chunk.text || '').toLowerCase();
      let score = 0;

      // 计算关键词匹配分数
      queryWords.forEach(word => {
        if (textLower.includes(word)) {
          score += 0.3;
        }
      });

      // 时间衰减
      const ageInHours = (now - chunk.updated_at) / (1000 * 60 * 60);
      const temporalWeight = Math.max(Math.pow(0.5, ageInHours / 168), 0.1);
      score *= temporalWeight;

      // 访问加权
      if (chunk.last_accessed_at) {
        const hoursSinceAccess = (now - chunk.last_accessed_at) / (1000 * 60 * 60);
        if (hoursSinceAccess < 24) {
          score *= 1.3;
        } else if (hoursSinceAccess < 168) {
          score *= 1.1;
        }
      }

      return {
        id: chunk.id,
        conversationId: chunk.conversation_id,
        text: chunk.text,
        score: score,
        type: 'keyword',
        updated_at: chunk.updated_at,
        last_accessed_at: chunk.last_accessed_at,
        access_count: chunk.access_count
      };
    });

    // 过滤并排序
    return results
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // 全文搜索
  textSearch(query, limit) {
    if (!this.storage) {
      return [];
    }

    const stmt = this.storage.db.prepare(`
      SELECT
        mc.id,
        mc.conversation_id,
        mc.text,
        mc.updated_at,
        mc.last_accessed_at,
        mc.access_count,
        rank
      FROM memory_fts
      JOIN memory_chunks mc ON memory_fts.rowid = mc.rowid
      WHERE memory_fts MATCH ?
      ORDER BY rank DESC
      LIMIT ?
    `);

    try {
      const rows = stmt.all(query, limit);

      return rows.map(row => ({
        id: row.id,
        conversationId: row.conversation_id,
        text: row.text,
        score: Math.min(row.rank / 10, 1), // 归一化到 0-1
        type: 'text',
        updated_at: row.updated_at,
        last_accessed_at: row.last_accessed_at,
        access_count: row.access_count
      }));
    } catch (error) {
      console.error('Full text search error:', error);
      return [];
    }
  }

  // ==================== 评分标准化 ====================

  // FTS rank 归一化（使用 sigmoid）
  normalizeFTSRank(rank) {
    // sigmoid 函数：2 / (1 + e^(-x/10)) - 1
    // 将无界的 rank 归一化到 0-1
    return 2 / (1 + Math.exp(-rank / 10)) - 1;
  }

  // 向量分数归一化（min-max 归一化）
  normalizeVectorScores(results) {
    if (!results || results.length === 0) return [];

    const maxScore = Math.max(...results.map(r => r.score), 1);

    return results.map(result => ({
      ...result,
      score: result.score / maxScore
    }));
  }

  // FTS 分数归一化
  normalizeTextScores(results) {
    if (!results || results.length === 0) return [];

    const maxScore = Math.max(...results.map(r => r.score), 1);

    return results.map(result => ({
      ...result,
      score: result.score / maxScore
    }));
  }

  // 合并向量和全文搜索结果（使用归一化分数）
  mergeResults(vectorResults, textResults, weights) {
    // 归一化分数
    const normalizedVectorResults = this.normalizeVectorScores(vectorResults);
    const normalizedTextResults = this.normalizeTextScores(textResults);

    const resultMap = new Map();

    // 添加向量搜索结果（应用权重）
    normalizedVectorResults.forEach(result => {
      resultMap.set(result.id, {
        ...result,
        score: result.score * weights.vectorWeight
      });
    });

    // 合并全文搜索结果（应用权重）
    normalizedTextResults.forEach(result => {
      const existing = resultMap.get(result.id);

      if (existing) {
        // 加权合并
        existing.score =
          existing.score +
          result.score * weights.textWeight;
        existing.type = 'hybrid';
      } else {
        resultMap.set(result.id, {
          ...result,
          score: result.score * weights.textWeight
        });
      }
    });

    // 添加对话信息
    const results = Array.from(resultMap.values());

    results.forEach(result => {
      const conversation = this.storage.getConversation(result.conversationId);
      if (conversation) {
        result.content = conversation.content;
        result.role = conversation.role;
        result.timestamp = conversation.timestamp;
        result.personality = conversation.personality;
        result.mood = conversation.mood;
      }
    });

    return results;
  }

  // 查找相关事实
  findRelatedFacts(query, factTypes = []) {
    if (!this.storage) {
      return [];
    }

    const facts = this.storage.getFacts({
      factType: factTypes.length > 0 ? factTypes.join('|') : null
    });

    // 简单的关键词匹配
    const queryLower = query.toLowerCase();

    return facts
      .map(fact => {
        let score = 0;
        const predicate = fact.predicate.toLowerCase();
        const object = (fact.object || '').toLowerCase();

        if (predicate.includes(queryLower) || queryLower.includes(predicate)) {
          score += 0.5;
        }

        if (object.includes(queryLower) || queryLower.includes(object)) {
          score += 0.5;
        }

        return { ...fact, score };
      })
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score);
  }
}

module.exports = MemorySearchEngine;
