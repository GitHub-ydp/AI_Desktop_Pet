// 语义搜索引擎
// 混合搜索：向量相似度 + 全文搜索

import { MEMORY_CONFIG } from './config.js';

class MemorySearchEngine {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.embeddingService = options.embeddingService || null;
    this.config = {
      defaultLimit: options.limit || MEMORY_CONFIG.search.defaultLimit,
      minScore: options.minScore || MEMORY_CONFIG.search.minScore,
      vectorWeight: options.vectorWeight || MEMORY_CONFIG.search.vectorWeight,
      textWeight: options.textWeight || MEMORY_CONFIG.search.textWeight,
      timeout: options.timeout || MEMORY_CONFIG.search.timeout
    };
  }

  // 设置存储实例
  setStorage(storage) {
    this.storage = storage;
  }

  // 设置嵌入服务实例
  setEmbeddingService(service) {
    this.embeddingService = service;
  }

  // 混合搜索
  async search(query, options = {}) {
    const {
      limit = this.config.defaultLimit,
      minScore = this.config.minScore,
      vectorWeight = this.config.vectorWeight,
      textWeight = this.config.textWeight,
      dateRange = null,
      factTypes = []
    } = options;

    if (!this.storage || !this.embeddingService) {
      throw new Error('Storage and embedding service must be set');
    }

    const startTime = Date.now();

    // 并行执行向量搜索和全文搜索
    const [vectorResults, textResults] = await Promise.all([
      this.vectorSearch(query, limit * 2),
      this.textSearch(query, limit * 2)
    ]);

    // 合并结果
    const mergedResults = this.mergeResults(
      vectorResults,
      textResults,
      { vectorWeight, textWeight }
    );

    // 过滤低分结果
    let filteredResults = mergedResults.filter(r => r.score >= minScore);

    // 应用日期范围过滤
    if (dateRange) {
      filteredResults = filteredResults.filter(r => {
        const date = new Date(r.timestamp);
        const start = dateRange.start ? new Date(dateRange.start) : null;
        const end = dateRange.end ? new Date(dateRange.end) : null;

        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
      });
    }

    // 查询相关事实
    const facts = factTypes.length > 0
      ? this.storage.getFacts({ factType: factTypes.join('|') })
      : [];

    // 添加事实到结果
    filteredResults.forEach(result => {
      result.relatedFacts = facts.filter(f =>
        result.content.includes(f.predicate) ||
        result.content.includes(f.object || '')
      );
    });

    // 排序并限制结果数量
    const sortedResults = filteredResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const duration = Date.now() - startTime;
    console.log(`Search completed in ${duration}ms, found ${sortedResults.length} results`);

    return sortedResults;
  }

  // 向量相似度搜索
  async vectorSearch(query, limit) {
    if (!this.storage || !this.embeddingService) {
      return [];
    }

    // 生成查询向量
    const queryEmbedding = await this.embeddingService.embedText(query);

    // 获取所有记忆块
    const chunksStmt = this.storage.db.prepare(`
      SELECT id, conversation_id, text, embedding
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
        type: 'vector'
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
        fts.memory_fts.rank as rank
      FROM memory_chunks mc
      JOIN memory_fts fts ON mc.id = fts.id
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
        type: 'text'
      }));
    } catch (error) {
      console.error('Full text search error:', error);
      return [];
    }
  }

  // 合并向量和全文搜索结果
  mergeResults(vectorResults, textResults, weights) {
    const resultMap = new Map();

    // 添加向量搜索结果
    vectorResults.forEach(result => {
      resultMap.set(result.id, {
        ...result,
        score: result.score * weights.vectorWeight
      });
    });

    // 合并全文搜索结果
    textResults.forEach(result => {
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

export default MemorySearchEngine;
