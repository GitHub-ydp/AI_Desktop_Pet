// 语义搜索引擎
// 混合搜索：向量相似度 + 全文搜索
// CommonJS 版本 - 用于主进程

const { MEMORY_CONFIG } = require('./config');
const StrengthCalculator = require('./strength');

class MemorySearchEngine {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.embeddingService = options.embeddingService || null;
    this.embeddingEngine = options.embeddingEngine || null;  // 本地 ONNX 嵌入引擎
    this.config = {
      defaultLimit: options.limit || MEMORY_CONFIG.search.defaultLimit,
      minScore: options.minScore || MEMORY_CONFIG.search.minScore,
      vectorWeight: options.vectorWeight || MEMORY_CONFIG.search.vectorWeight,
      textWeight: options.textWeight || MEMORY_CONFIG.search.textWeight,
      timeout: options.timeout || MEMORY_CONFIG.search.timeout,
      // 混合搜索权重
      hybridWeights: {
        keyword: 0.3,
        vector: 0.4,
        temporal: 0.2,
        importance: 0.1
      },
      // 情感上下文
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

  // 设置嵌入服务实例（旧 API 版嵌入）
  setEmbeddingService(service) {
    this.embeddingService = service;
  }

  // 设置本地嵌入引擎（ONNX）
  setEmbeddingEngine(engine) {
    this.embeddingEngine = engine;
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

  // 混合搜索（关键词 + 向量）
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
    const now = Date.now();

    // 获取候选对话
    const stmt = this.storage.db.prepare(`
      SELECT id, role, content, timestamp, personality, mood
      FROM conversations
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const conversations = stmt.all(limit * 10);

    if (conversations.length === 0) {
      console.log('[Memory] No conversations found in database');
      return [];
    }

    // 1. 关键词搜索（BM25 或旧版 includes 匹配）
    let keywordResults;
    if (MEMORY_CONFIG.search.bm25?.enabled) {
      keywordResults = this._bm25ScoreConversations(query, conversations, now, mood);
    } else {
      keywordResults = this._keywordScoreConversations(query, conversations, now, mood);
    }

    // 2. 向量搜索（如果嵌入引擎可用）
    let vectorResults = new Map();
    if (this.embeddingEngine && this.embeddingEngine.isReady()) {
      vectorResults = await this._vectorSearchConversations(query, limit * 3);
    }

    // 3. 合并结果
    const weights = this.config.hybridWeights;
    const hasVector = vectorResults.size > 0;

    const mergedResults = conversations.map(conv => {
      const kw = keywordResults.get(conv.id) || { keywordScore: 0, temporalScore: 0, importanceScore: 0 };
      const vs = vectorResults.get(conv.id) || { vectorScore: 0 };

      let finalScore = 0;

      // 查询该对话的 memory_chunk，获取 FSRS 强度指标
      // strength = R × emotionalWeight（归一化到0-1），直接替代 temporalScore
      // 避免时间因素双重计算：strength 已内含时间衰减+强化次数+情感权重
      let R = 1.0;
      let emotionalWeight = 1.0;
      let strengthScore = 1.0;  // 替代 temporalScore 的综合强度分
      try {
        const chunk = this.storage?.db?.prepare(`
          SELECT stability, last_triggered_at, emotional_weight
          FROM memory_chunks
          WHERE conversation_id = ? LIMIT 1
        `).get(conv.id);

        if (chunk) {
          // 实时计算当前的可提取性 R（FSRS 幂函数）
          R = StrengthCalculator.calcRetrievability(
            chunk.stability || 24,
            chunk.last_triggered_at,
            now
          );
          emotionalWeight = chunk.emotional_weight || 1.0;
          // 综合强度分：归一化到 0-1，替代 temporalScore
          strengthScore = Math.min(1.0, R * emotionalWeight);
        }
      } catch (error) {
        // 查询失败时使用默认值，不中断搜索
      }

      // 重新计算 finalScore：strength 替代 temporal（避免时间双重计算）
      if (hasVector) {
        finalScore =
          weights.keyword * kw.keywordScore +
          weights.vector * vs.vectorScore +
          weights.temporal * strengthScore +      // strength 替代 temporal
          weights.importance * kw.importanceScore;
      } else {
        finalScore = kw.keywordScore * 0.5 + strengthScore * 0.3 + kw.importanceScore * 0.2;
      }

      // 用户消息加权（重新应用，因为 finalScore 被重算了）
      if (conv.role === 'user') finalScore += 0.05;
      if (conv.mood !== undefined && mood !== undefined) {
        if (Math.abs(conv.mood - mood) < 20) finalScore += 0.05;
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
        score: finalScore,
        type: hasVector && vs.vectorScore > 0 ? 'hybrid' : 'keyword',
        // 传递 FSRS 信息供后续使用
        strength: R,
        emotionalWeight: emotionalWeight,
        // 传递 embedding 供 MMR 使用（避免二次查询 DB）
        embedding: vs.embedding || null
      };
    });

    // 过滤并排序
    let filteredResults = mergedResults
      .filter(r => {
        // 基础分数过滤
        if (r.score < minScore) return false;

        // 新增：休眠记忆过滤（R < 0.1 的记忆不参与搜索）
        // 这是 FSRS 的"软删除"机制
        const config = MEMORY_CONFIG.memoryStrength?.dormant || {};
        const softThreshold = config.softThreshold || 0.1;
        if (r.strength !== undefined && r.strength < softThreshold) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // MMR 去重：减少高度相似结果，提升多样性
    if (MEMORY_CONFIG.search.mmr?.enabled && hasVector && filteredResults.length > 1) {
      filteredResults = this._applyMMR(filteredResults, {
        lambda: MEMORY_CONFIG.search.mmr.lambda,
        limit: limit
      });
    }

    // 降级：如果没有结果，返回最近对话
    if (filteredResults.length === 0 && conversations.length > 0) {
      filteredResults = conversations.slice(0, 3).map(conv => ({
        id: conv.id,
        conversationId: conv.id,
        text: conv.content,
        content: conv.content,
        role: conv.role,
        timestamp: conv.timestamp,
        personality: conv.personality,
        mood: conv.mood,
        score: 0.05,
        type: 'recent'
      }));
    }

    const duration = Date.now() - startTime;
    console.log(`[Memory] Search completed in ${duration}ms, found ${filteredResults.length} results (vector: ${hasVector ? 'ON' : 'OFF'})`);

    if (filteredResults.length > 0) {
      console.log('[Memory] Top results:');
      filteredResults.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i+1}. [${r.role}] score=${r.score.toFixed(2)} type=${r.type}: ${r.text?.substring(0, 40)}...`);
      });
    }

    return filteredResults;
  }

  // 关键词评分（旧版 includes 匹配，BM25 禁用时的降级方案，返回 Map<id, scores>）
  _keywordScoreConversations(query, conversations, now, mood) {
    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 1);
    const results = new Map();

    const importantKeywords = ['名字', '叫', '是', '性别', '生日', '喜欢', '爱好', '工作', '职业', '住'];

    for (const conv of conversations) {
      const contentLower = (conv.content || '').toLowerCase();

      // 关键词匹配分数（归一化到 0-1）
      let keywordScore = 0.1;  // 基础分
      let matchCount = 0;
      queryWords.forEach(word => {
        if (contentLower.includes(word)) {
          matchCount++;
          keywordScore += 0.3;
        }
        if (word.length >= 2 && contentLower.includes(word.substring(0, 2))) {
          keywordScore += 0.1;
        }
      });
      // 重要关键词加权
      importantKeywords.forEach(kw => {
        if (queryLower.includes(kw) && contentLower.includes(kw)) {
          keywordScore += 0.2;
        }
      });
      // 归一化
      keywordScore = Math.min(1.0, keywordScore);

      // 时间衰减分数（归一化到 0-1）
      const ageInDays = (now - conv.timestamp) / 86400000;
      let temporalScore = 0;
      if (ageInDays < 1) temporalScore = 1.0;
      else if (ageInDays < 3) temporalScore = 0.7;
      else if (ageInDays < 7) temporalScore = 0.5;
      else if (ageInDays < 30) temporalScore = 0.3;
      else temporalScore = 0.1;

      // 重要性分数
      let importanceScore = 0;
      if (conv.content && conv.content.length > 50) importanceScore += 0.3;
      if (conv.content && conv.content.length > 100) importanceScore += 0.2;
      if (conv.role === 'user') importanceScore += 0.2;
      // 包含个人信息的更重要
      if (importantKeywords.some(kw => contentLower.includes(kw))) importanceScore += 0.3;
      importanceScore = Math.min(1.0, importanceScore);

      results.set(conv.id, { keywordScore, temporalScore, importanceScore });
    }

    return results;
  }

  // BM25 关键词评分（替代简单 includes 匹配，返回 Map<id, scores>）
  _bm25ScoreConversations(query, conversations, now, mood) {
    const bm25Config = MEMORY_CONFIG.search.bm25 || {};
    const k1 = bm25Config.k1 || 1.2;
    const b = bm25Config.b || 0.75;

    const queryTokens = this._tokenize(query);
    const results = new Map();
    const importantKeywords = ['名字', '叫', '是', '性别', '生日', '喜欢', '爱好', '工作', '职业', '住'];
    const totalDocs = conversations.length || 1;

    // 预处理：为每条对话分词 + 计算文档频率
    const docTokens = new Map(); // convId → tokens[]
    const docFreq = new Map();   // token → 包含该 token 的文档数
    let totalLen = 0;

    for (const conv of conversations) {
      const tokens = this._tokenize(conv.content || '');
      docTokens.set(conv.id, tokens);
      totalLen += tokens.length;

      // 统计 DF（每个 token 在多少文档中出现）
      const uniqueTokens = new Set(tokens);
      for (const t of uniqueTokens) {
        docFreq.set(t, (docFreq.get(t) || 0) + 1);
      }
    }

    const avgdl = totalLen / totalDocs;

    // 计算每条对话的 BM25 分数
    const rawBm25Scores = new Map();

    for (const conv of conversations) {
      const tokens = docTokens.get(conv.id);
      const dl = tokens.length;
      if (dl === 0) {
        rawBm25Scores.set(conv.id, 0);
        continue;
      }

      // 统计文档内词频
      const tf = new Map();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      // BM25 求和
      let bm25 = 0;
      for (const qt of queryTokens) {
        const f = tf.get(qt) || 0;
        if (f === 0) continue;

        const n = docFreq.get(qt) || 0;
        // IDF: ln((N - n + 0.5) / (n + 0.5) + 1)
        const idf = Math.log((totalDocs - n + 0.5) / (n + 0.5) + 1);
        // TF 饱和: f(t,d) × (k1+1) / (f(t,d) + k1 × (1 - b + b × |d|/avgdl))
        const tfSat = (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl));

        bm25 += idf * tfSat;
      }

      rawBm25Scores.set(conv.id, bm25);
    }

    // min-max 归一化 BM25 分数到 0-1
    const allScores = Array.from(rawBm25Scores.values());
    const maxBm25 = Math.max(...allScores, 0.001);

    for (const conv of conversations) {
      const contentLower = (conv.content || '').toLowerCase();
      const rawBm25 = rawBm25Scores.get(conv.id) || 0;

      // 归一化 BM25 + 基础分
      let keywordScore = 0.1 + (rawBm25 / maxBm25) * 0.9;

      // 重要关键词加权（与旧方法保持一致）
      importantKeywords.forEach(kw => {
        if (query.toLowerCase().includes(kw) && contentLower.includes(kw)) {
          keywordScore += 0.1;
        }
      });
      keywordScore = Math.min(1.0, keywordScore);

      // 时间衰减分数
      const ageInDays = (now - conv.timestamp) / 86400000;
      let temporalScore = 0;
      if (ageInDays < 1) temporalScore = 1.0;
      else if (ageInDays < 3) temporalScore = 0.7;
      else if (ageInDays < 7) temporalScore = 0.5;
      else if (ageInDays < 30) temporalScore = 0.3;
      else temporalScore = 0.1;

      // 重要性分数
      let importanceScore = 0;
      if (conv.content && conv.content.length > 50) importanceScore += 0.3;
      if (conv.content && conv.content.length > 100) importanceScore += 0.2;
      if (conv.role === 'user') importanceScore += 0.2;
      if (importantKeywords.some(kw => contentLower.includes(kw))) importanceScore += 0.3;
      importanceScore = Math.min(1.0, importanceScore);

      results.set(conv.id, { keywordScore, temporalScore, importanceScore });
    }

    return results;
  }

  // 中文 bigram + 标点分割分词器（用于 BM25）
  _tokenize(text) {
    if (!text) return [];
    const phrases = text.split(/[\s,，。！？；：""''（）\(\)、\n]+/).filter(Boolean);
    const tokens = [];

    for (const phrase of phrases) {
      // 中文字符：生成 bigram + 单字
      if (/[\u4e00-\u9fff]/.test(phrase)) {
        for (let i = 0; i < phrase.length - 1; i++) {
          if (/[\u4e00-\u9fff]/.test(phrase[i]) && /[\u4e00-\u9fff]/.test(phrase[i + 1])) {
            tokens.push(phrase[i] + phrase[i + 1]);
          }
        }
        // 单字（用于短查询匹配）
        for (const ch of phrase) {
          if (/[\u4e00-\u9fff]/.test(ch)) tokens.push(ch);
        }
      }
      // 英文/数字作为整词
      const words = phrase.match(/[a-zA-Z0-9]+/g);
      if (words) tokens.push(...words.map(w => w.toLowerCase()));
    }

    return tokens;
  }

  // MMR 去重算法（Maximal Marginal Relevance）
  // 在保持相关性的同时，减少结果间的冗余，提升多样性
  // 使用结果中附带的 embedding（由 _vectorSearchConversations 传递），无需二次查询 DB
  _applyMMR(results, options = {}) {
    if (!results || results.length <= 1) return results;

    const lambda = options.lambda ?? 0.5;
    const targetCount = options.limit || results.length;

    // 检查是否有任何 embedding 可用
    const hasAnyEmbedding = results.some(r => r.embedding);

    // 降级：所有结果都无 embedding 时，完全跳过 MMR
    if (!hasAnyEmbedding) {
      return results;
    }

    const selected = [];
    const candidates = [...results];

    // 迭代选择：每次选 MMR 得分最高的候选
    while (selected.length < targetCount && candidates.length > 0) {
      let bestScore = -Infinity;
      let bestIdx = 0;

      for (let i = 0; i < candidates.length; i++) {
        // 相关性分（原始搜索得分）
        const relevance = candidates[i].score;

        // 与已选结果的最大相似度（多样性惩罚）
        let maxSim = 0;
        if (selected.length > 0) {
          for (const s of selected) {
            let sim = 0;
            if (candidates[i].embedding && s.embedding) {
              // 优先用向量余弦相似度
              sim = this._cosineSimilarity(candidates[i].embedding, s.embedding);
            } else {
              // 降级：文本 Jaccard 相似度
              sim = this._textSimilarity(
                candidates[i].text || candidates[i].content || '',
                s.text || s.content || ''
              );
            }
            if (sim > maxSim) maxSim = sim;
          }
        }

        // MMR 公式：lambda × 相关性 - (1-lambda) × 最大相似度
        const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(candidates[bestIdx]);
      candidates.splice(bestIdx, 1);
    }

    return selected;
  }

  // 独立的余弦相似度计算（不依赖 embeddingEngine 实例）
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  // 文本 Jaccard 相似度（MMR 降级方案：无 embedding 时使用）
  _textSimilarity(textA, textB) {
    if (!textA || !textB) return 0;
    const setA = new Set(textA.split(/[\s,，。！？；：""''（）\(\)、\n]+/).filter(Boolean));
    const setB = new Set(textB.split(/[\s,，。！？；：""''（）\(\)、\n]+/).filter(Boolean));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  // 向量搜索（返回 Map<conversationId, {vectorScore, embedding}>）
  async _vectorSearchConversations(query, limit) {
    const results = new Map();

    try {
      const queryEmbedding = await this.embeddingEngine.embed(query);
      if (!queryEmbedding) return results;

      // 获取有嵌入的记忆块
      const chunks = this.storage.db.prepare(`
        SELECT id, conversation_id, embedding
        FROM memory_chunks
        WHERE embedding IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(limit);

      for (const chunk of chunks) {
        const embedding = this.storage.blobToFloatArray(chunk.embedding);
        const similarity = this.embeddingEngine.cosineSimilarity(queryEmbedding, embedding);

        // 归一化相似度到 0-1（余弦相似度已经是 -1 到 1）
        const normalizedScore = Math.max(0, (similarity + 1) / 2);

        // 取每个对话的最高分，同时保留 embedding 供 MMR 使用
        const existing = results.get(chunk.conversation_id);
        if (!existing || normalizedScore > existing.vectorScore) {
          results.set(chunk.conversation_id, { vectorScore: normalizedScore, embedding });
        }
      }

    } catch (error) {
      console.error('[Memory] Vector search failed:', error.message);
    }

    return results;
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
