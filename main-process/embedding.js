// 本地向量嵌入引擎
// 使用 ONNX 模型在本地生成中文向量嵌入，支持语义搜索
// CommonJS 版本 - 用于主进程

const { join } = require('path');
const { existsSync, mkdirSync } = require('fs');

class EmbeddingEngine {
  constructor(config = {}) {
    this.config = {
      modelName: config.modelName || 'Xenova/bge-small-zh-v1.5',
      dimensions: config.dimensions || 512,
      cacheDir: config.cacheDir || this._getDefaultCacheDir(),
      maxBatchSize: config.maxBatchSize || 32,
      ...config
    };

    this._pipeline = null;
    this._loading = false;
    this._loadPromise = null;
    this._ready = false;
  }

  // 获取默认模型缓存目录
  _getDefaultCacheDir() {
    try {
      const electron = require('electron');
      if (electron && electron.app) {
        return join(electron.app.getPath('userData'), 'models');
      }
    } catch (e) {
      // 非 Electron 环境
    }
    const { homedir } = require('os');
    return join(homedir(), '.ai-desktop-pet', 'models');
  }

  // 初始化：加载 ONNX 模型（懒加载）
  async initialize() {
    if (this._ready) return true;
    if (this._loadPromise) return this._loadPromise;

    this._loading = true;
    this._loadPromise = this._doInitialize();
    return this._loadPromise;
  }

  async _doInitialize() {
    try {
      console.log('[Embedding] 正在加载向量模型...');
      console.log(`[Embedding] 模型: ${this.config.modelName}`);
      console.log(`[Embedding] 缓存目录: ${this.config.cacheDir}`);

      // 确保缓存目录存在
      if (!existsSync(this.config.cacheDir)) {
        mkdirSync(this.config.cacheDir, { recursive: true });
      }

      // 动态导入 @huggingface/transformers（ESM 模块）
      const { pipeline, env } = await import('@huggingface/transformers');

      // 配置缓存目录
      env.cacheDir = this.config.cacheDir;
      // 不使用远程模型（离线优先，首次需要下载）
      env.allowRemoteModels = true;

      // 创建 feature-extraction pipeline
      this._pipeline = await pipeline('feature-extraction', this.config.modelName, {
        quantized: true,  // 使用 int8 量化版本，更小更快
        revision: 'main'
      });

      this._ready = true;
      this._loading = false;
      console.log('[Embedding] ✓ 向量模型加载完成');
      return true;

    } catch (error) {
      this._loading = false;
      this._loadPromise = null;
      console.error('[Embedding] ✗ 向量模型加载失败:', error.message);
      return false;
    }
  }

  // 单文本嵌入
  async embed(text) {
    if (!this._ready) {
      const ok = await this.initialize();
      if (!ok) return null;
    }

    try {
      // 截断过长文本（模型最大 512 tokens）
      const truncated = text.length > 500 ? text.substring(0, 500) : text;

      const output = await this._pipeline(truncated, {
        pooling: 'cls',
        normalize: true
      });

      // 转为普通数组
      return Array.from(output.data);

    } catch (error) {
      console.error('[Embedding] 嵌入失败:', error.message);
      return null;
    }
  }

  // 批量嵌入
  async batchEmbed(texts) {
    if (!this._ready) {
      const ok = await this.initialize();
      if (!ok) return texts.map(() => null);
    }

    const results = [];
    // 分批处理
    for (let i = 0; i < texts.length; i += this.config.maxBatchSize) {
      const batch = texts.slice(i, i + this.config.maxBatchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.embed(text))
      );
      results.push(...batchResults);
    }
    return results;
  }

  // 余弦相似度
  cosineSimilarity(a, b) {
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

  // 模型是否已加载
  isReady() {
    return this._ready;
  }

  // 是否正在加载
  isLoading() {
    return this._loading;
  }

  // 获取模型信息
  getInfo() {
    return {
      modelName: this.config.modelName,
      dimensions: this.config.dimensions,
      ready: this._ready,
      loading: this._loading,
      cacheDir: this.config.cacheDir
    };
  }
}

module.exports = EmbeddingEngine;
