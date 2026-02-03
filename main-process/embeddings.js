// 嵌入服务
// 负责生成文本向量嵌入（使用提供商系统）
// CommonJS 版本 - 用于主进程

const { MEMORY_CONFIG } = require('./config');
const crypto = require('crypto');
const providerFactory = require('./providers/factory');

class EmbeddingService {
  constructor(options = {}) {
    this.config = {
      dimensions: options.dimensions || MEMORY_CONFIG.embeddings.dimensions,
      batchSize: options.batchSize || MEMORY_CONFIG.embeddings.batchSize,
      timeout: options.timeout || MEMORY_CONFIG.embeddings.timeout,
      retryAttempts: options.retryAttempts || MEMORY_CONFIG.embeddings.retryAttempts,
      retryDelay: options.retryDelay || MEMORY_CONFIG.embeddings.retryDelay
    };
    this.storage = options.storage || null;
    this.providerFactory = options.providerFactory || providerFactory;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // 设置存储实例
  setStorage(storage) {
    this.storage = storage;
  }

  // 获取嵌入提供商
  getEmbeddingProvider() {
    if (!this.providerFactory) {
      throw new Error('Provider factory not initialized');
    }

    const provider = this.providerFactory.getEmbeddingProvider();
    if (!provider) {
      throw new Error('No embedding provider available. Please configure QWEN_API_KEY.');
    }

    return provider;
  }

  // 生成文本嵌入（带缓存）
  async embedText(text) {
    // 检查缓存
    const hash = this.hashText(text);

    if (this.storage) {
      const cached = this.storage.getCachedEmbedding(hash);
      if (cached) {
        this.cacheHits++;
        return cached;
      }
    }

    this.cacheMisses++;

    // 使用提供商生成嵌入
    const provider = this.getEmbeddingProvider();
    const embedding = await provider.embed(text);

    // 保存到缓存
    if (this.storage && embedding) {
      const modelName = provider.getInfo().models.embedding;
      this.storage.saveEmbeddingCache(hash, embedding, modelName);
    }

    return embedding;
  }

  // 批量生成嵌入
  async embedBatch(texts) {
    if (!texts || texts.length === 0) {
      return [];
    }

    const results = [];
    const toFetch = [];
    const hashes = [];

    // 检查缓存
    for (const text of texts) {
      const hash = this.hashText(text);
      hashes.push(hash);

      if (this.storage) {
        const cached = this.storage.getCachedEmbedding(hash);
        if (cached) {
          results.push(cached);
          this.cacheHits++;
          continue;
        }
      }

      this.cacheMisses++;
      toFetch.push({ text, index: results.length });
      results.push(null);
    }

    // 批量调用提供商 API
    if (toFetch.length > 0) {
      const provider = this.getEmbeddingProvider();
      const embeddings = await provider.embedBatch(toFetch.map(t => t.text));

      for (let i = 0; i < toFetch.length; i++) {
        const { text, index } = toFetch[i];
        const embedding = embeddings[i];

        results[index] = embedding;

        // 保存到缓存
        if (this.storage && embedding) {
          const modelName = provider.getInfo().models.embedding;
          this.storage.saveEmbeddingCache(hashes[index], embedding, modelName);
        }
      }
    }

    return results;
  }

  // 文本哈希（用于缓存）
  hashText(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  // 计算余弦相似度
  cosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embedding dimensions do not match');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  // 获取缓存统计
  getCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }

  // 重置缓存统计
  resetCacheStats() {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // 获取提供商信息
  getProviderInfo() {
    try {
      const provider = this.getEmbeddingProvider();
      return provider.getInfo();
    } catch (error) {
      return {
        error: error.message,
        available: false
      };
    }
  }
}

module.exports = EmbeddingService;
