// AI 提供商工厂
// 根据配置创建和管理 AI 提供商实例

const DeepSeekProvider = require('./deepseek');
const QwenProvider = require('./qwen');

class ProviderFactory {
  constructor() {
    this.providers = new Map();
    this.primaryProvider = null;
    this.embeddingProvider = null;
  }

  /**
   * 初始化提供商
   * @param {Object} config - 配置对象
   * @param {string} config.qwenApiKey - 通义千问 API 密钥
   * @param {string} config.deepseekApiKey - DeepSeek API 密钥
   * @param {string} config.primary - 主要提供商（'qwen' 或 'deepseek'）
   */
  initialize(config = {}) {
    const {
      qwenApiKey = '',
      deepseekApiKey = '',
      primary = 'qwen', // 默认优先使用通义千问
      qwenModel = 'qwen-plus',
      qwenEmbeddingModel = 'text-embedding-v2'
    } = config;

    // 创建通义千问提供商
    if (qwenApiKey && qwenApiKey.length > 10) {
      const qwen = new QwenProvider({
        apiKey: qwenApiKey,
        model: qwenModel,
        embeddingModel: qwenEmbeddingModel
      });
      this.providers.set('qwen', qwen);
      console.log('[ProviderFactory] Qwen provider initialized');
    }

    // 创建 DeepSeek 提供商
    if (deepseekApiKey && deepseekApiKey.length > 10) {
      const deepseek = new DeepSeekProvider({
        apiKey: deepseekApiKey
      });
      this.providers.set('deepseek', deepseek);
      console.log('[ProviderFactory] DeepSeek provider initialized');
    }

    if (this.providers.size === 0) {
      console.warn('[ProviderFactory] No providers initialized');
      return false;
    }

    // 设置主要提供商（用于 Chat）
    this.setPrimaryProvider(primary);

    // 设置嵌入提供商（优先使用支持 embedding 的提供商）
    this.setEmbeddingProvider();

    return true;
  }

  /**
   * 设置主要提供商
   */
  setPrimaryProvider(providerName) {
    if (this.providers.has(providerName)) {
      this.primaryProvider = this.providers.get(providerName);
      console.log(`[ProviderFactory] Primary provider set to: ${providerName}`);
      return true;
    }

    // 回退到第一个可用提供商
    const firstProvider = this.providers.keys().next().value;
    if (firstProvider) {
      this.primaryProvider = this.providers.get(firstProvider);
      console.log(`[ProviderFactory] Primary provider fallback to: ${firstProvider}`);
      return true;
    }

    return false;
  }

  /**
   * 设置嵌入提供商
   */
  setEmbeddingProvider() {
    // 优先使用支持 embedding 的提供商
    for (const [name, provider] of this.providers) {
      if (provider.supports('embedding')) {
        this.embeddingProvider = provider;
        console.log(`[ProviderFactory] Embedding provider set to: ${name}`);
        return true;
      }
    }

    console.warn('[ProviderFactory] No embedding provider available');
    return false;
  }

  /**
   * 获取主要提供商
   */
  getPrimaryProvider() {
    if (!this.primaryProvider) {
      throw new Error('No primary provider available');
    }
    return this.primaryProvider;
  }

  /**
   * 获取嵌入提供商
   */
  getEmbeddingProvider() {
    if (!this.embeddingProvider) {
      throw new Error('No embedding provider available');
    }
    return this.embeddingProvider;
  }

  /**
   * 获取指定提供商
   */
  getProvider(name) {
    return this.providers.get(name);
  }

  /**
   * 获取所有提供商
   */
  getAllProviders() {
    return Array.from(this.providers.values());
  }

  /**
   * 获取提供商信息
   */
  getProvidersInfo() {
    const info = {};

    for (const [name, provider] of this.providers) {
      info[name] = provider.getInfo();
    }

    return {
      primary: this.primaryProvider?.name || null,
      embedding: this.embeddingProvider?.name || null,
      providers: info
    };
  }

  /**
   * 检查是否可用
   */
  isAvailable() {
    return this.providers.size > 0;
  }

  /**
   * 检查 embedding 是否可用
   */
  hasEmbedding() {
    return this.embeddingProvider !== null;
  }
}

// 单例模式
const factory = new ProviderFactory();

module.exports = factory;
