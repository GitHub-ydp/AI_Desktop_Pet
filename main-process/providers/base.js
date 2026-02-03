// AI 提供商基础接口
// 定义所有提供商必须实现的接口

class AIProvider {
  constructor(options = {}) {
    this.name = options.name || 'BaseProvider';
    this.apiKey = options.apiKey || '';
    this.config = {
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options.config
    };
  }

  // ==================== 必须实现的抽象方法 ====================

  /**
   * 发送聊天请求
   * @param {Array} messages - 消息数组 [{role, content}]
   * @param {Object} options - 选项 {model, temperature, maxTokens, stream}
   * @returns {Promise<string>} AI 响应文本
   */
  async chat(messages, options = {}) {
    throw new Error(`${this.name}: chat() method must be implemented`);
  }

  /**
   * 发送流式聊天请求
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   * @param {Function} onChunk - 接收流式数据的回调
   * @returns {Promise<string>} 完整响应
   */
  async chatStream(messages, options = {}, onChunk) {
    throw new Error(`${this.name}: chatStream() method must be implemented`);
  }

  /**
   * 生成文本嵌入
   * @param {string} text - 输入文本
   * @returns {Promise<Array<number>>} 嵌入向量
   */
  async embed(text) {
    throw new Error(`${this.name}: embed() method must be implemented`);
  }

  /**
   * 批量生成文本嵌入
   * @param {Array<string>} texts - 文本数组
   * @returns {Promise<Array<Array<number>>>} 嵌入向量数组
   */
  async embedBatch(texts) {
    throw new Error(`${this.name}: embedBatch() method must be implemented`);
  }

  // ==================== 通用工具方法 ====================

  /**
   * 带重试的请求
   */
  async retryWithBackoff(fn, retries = this.config.maxRetries) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === retries - 1) {
          throw error;
        }

        const delay = this.config.retryDelay * Math.pow(2, attempt);
        console.log(`${this.name}: Retry ${attempt + 1}/${retries} after ${delay}ms`);
        await this.sleep(delay);
      }
    }
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 带超时的 fetch
   */
  async fetchWithTimeout(url, options, timeout = this.config.timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error.name === 'AbortError') {
        throw new Error(`${this.name}: Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * 验证 API 密钥
   */
  validateAPIKey() {
    if (!this.apiKey || typeof this.apiKey !== 'string') {
      throw new Error(`${this.name}: Invalid API key`);
    }
    if (this.apiKey.length < 10) {
      throw new Error(`${this.name}: API key too short`);
    }
    return true;
  }

  /**
   * 获取默认模型配置
   */
  getDefaultModels() {
    return {
      chat: 'default-model',
      embedding: 'default-embedding'
    };
  }

  /**
   * 检查提供商是否支持特定功能
   */
  supports(feature) {
    const features = {
      chat: true,
      stream: false,
      embedding: false,
      batchEmbedding: false
    };
    return features[feature] || false;
  }

  /**
   * 获取提供商信息
   */
  getInfo() {
    return {
      name: this.name,
      features: {
        chat: this.supports('chat'),
        stream: this.supports('stream'),
        embedding: this.supports('embedding'),
        batchEmbedding: this.supports('batchEmbedding')
      },
      models: this.getDefaultModels()
    };
  }
}

module.exports = AIProvider;
