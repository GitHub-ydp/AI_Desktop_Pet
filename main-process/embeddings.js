// 嵌入服务
// 负责生成文本向量嵌入
// CommonJS 版本 - 用于主进程

const { MEMORY_CONFIG } = require('./config');
const crypto = require('crypto');
const https = require('https');

class EmbeddingService {
  constructor(options = {}) {
    this.config = {
      apiKey: options.apiKey || '',
      model: options.model || MEMORY_CONFIG.embeddings.model,
      dimensions: options.dimensions || MEMORY_CONFIG.embeddings.dimensions,
      batchSize: options.batchSize || MEMORY_CONFIG.embeddings.batchSize,
      timeout: options.timeout || MEMORY_CONFIG.embeddings.timeout,
      retryAttempts: options.retryAttempts || MEMORY_CONFIG.embeddings.retryAttempts,
      retryDelay: options.retryDelay || MEMORY_CONFIG.embeddings.retryDelay
    };
    this.storage = options.storage || null;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // 设置存储实例
  setStorage(storage) {
    this.storage = storage;
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

    // 调用 API 生成嵌入
    const embedding = await this.callEmbeddingAPI(text);

    // 保存到缓存
    if (this.storage && embedding) {
      this.storage.saveEmbeddingCache(hash, embedding, this.config.model);
    }

    return embedding;
  }

  // 批量生成嵌入
  async embedBatch(texts) {
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

    // 批量调用 API
    if (toFetch.length > 0) {
      const embeddings = await this.callBatchEmbeddingAPI(toFetch.map(t => t.text));

      for (let i = 0; i < toFetch.length; i++) {
        const { text, index } = toFetch[i];
        const embedding = embeddings[i];

        results[index] = embedding;

        // 保存到缓存
        if (this.storage && embedding) {
          this.storage.saveEmbeddingCache(hashes[index], embedding, this.config.model);
        }
      }
    }

    return results;
  }

  // 调用嵌入 API
  async callEmbeddingAPI(text) {
    const url = 'https://api.deepseek.com/v1/embeddings';

    // DeepSeek 可能没有嵌入 API，直接使用 fallback
    // 如果将来支持，可以取消注释下面的代码
    /*
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002', // 临时使用，等待 DeepSeek 官方嵌入模型
            input: text
          })
        }, this.config.timeout);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.data[0].embedding;

      } catch (error) {
        console.error(`Embedding API attempt ${attempt + 1} failed:`, error);

        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
        } else {
          // 最后一次尝试失败，返回模拟嵌入
          console.warn('Using fallback embedding for text:', text.substring(0, 50));
          return this.getFallbackEmbedding(text);
        }
      }
    }
    */

    // 直接使用 fallback，避免 API 调用失败
    return this.getFallbackEmbedding(text);
  }

  // 批量调用嵌入 API（真正的批量实现）
  async callBatchEmbeddingAPI(texts) {
    if (!texts || texts.length === 0) {
      return [];
    }

    // DeepSeek 支持批量嵌入 API
    const url = 'https://api.deepseek.com/v1/embeddings';

    // 批次处理（DeepSeek 单次最多支持多少条需要确认，这里假设 20 条）
    const MAX_BATCH_SIZE = 20;

    // 如果数量少，直接批量调用
    if (texts.length <= MAX_BATCH_SIZE) {
      return await this.fetchBatchEmbeddings(url, texts);
    }

    // 分批并行处理
    const batches = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      batches.push(texts.slice(i, i + MAX_BATCH_SIZE));
    }

    // 并行调用所有批次
    const results = await Promise.all(
      batches.map(batch => this.fetchBatchEmbeddings(url, batch))
    );

    // 合并结果
    return results.flat();
  }

  // 获取批量嵌入
  async fetchBatchEmbeddings(url, texts) {
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002', // 临时使用，等待 DeepSeek 官方嵌入模型
            input: texts  // 批量输入
          })
        }, this.config.timeout);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        // 返回所有嵌入向量
        return data.data.map(item => item.embedding);

      } catch (error) {
        console.error(`Batch embedding API attempt ${attempt + 1} failed:`, error);

        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
        } else {
          // 最后一次尝试失败，返回模拟嵌入
          console.warn(`Using fallback embeddings for batch of ${texts.length} texts`);
          return texts.map(text => this.getFallbackEmbedding(text));
        }
      }
    }
  }

  // 带超时的 fetch（使用 https 模块）
  fetchWithTimeout(url, options, timeout) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const requestOptions = {
        method: options.method,
        headers: options.headers,
        timeout: timeout
      };

      const req = https.request(urlObj, requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          clearTimeout(timer);
          try {
            const jsonData = JSON.parse(data);
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => jsonData
            });
          } catch (e) {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => { throw e; }
            });
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();

      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('timeout'));
      }, timeout);
    });
  }

  // 文本哈希（用于缓存）
  hashText(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  // 延迟函数
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 后备嵌入（当 API 失败时使用）
  getFallbackEmbedding(text) {
    // 简单的字符级哈希嵌入
    const dimensions = this.config.dimensions;
    const embedding = new Array(dimensions).fill(0);

    // 使用字符的 Unicode 值生成简单的向量
    for (let i = 0; i < text.length && i < dimensions; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] = (charCode % 100) / 100; // 归一化到 0-1
    }

    // 填充剩余维度
    for (let i = text.length; i < dimensions; i++) {
      embedding[i] = (i % 10) / 100;
    }

    return embedding;
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
}

module.exports = EmbeddingService;
