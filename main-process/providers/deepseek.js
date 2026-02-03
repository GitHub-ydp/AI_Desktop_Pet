// DeepSeek API 提供商实现
// CommonJS 版本 - 用于主进程

const AIProvider = require('./base');

class DeepSeekProvider extends AIProvider {
  constructor(options = {}) {
    super({
      name: 'DeepSeek',
      ...options
    });

    this.endpoints = {
      chat: 'https://api.deepseek.com/v1/chat/completions',
      embeddings: 'https://api.deepseek.com/v1/embeddings'
    };

    this.models = {
      chat: options.model || 'deepseek-chat',
      embedding: 'text-embedding-ada-002' // 占位符，DeepSeek 暂不支持
    };
  }

  // ==================== Chat API ====================

  async chat(messages, options = {}) {
    this.validateAPIKey();

    const {
      model = this.models.chat,
      temperature = 0.8,
      maxTokens = 100,
      stream = false
    } = options;

    return await this.retryWithBackoff(async () => {
      const response = await this.fetchWithTimeout(this.endpoints.chat, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`DeepSeek API error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    });
  }

  async chatStream(messages, options = {}, onChunk) {
    this.validateAPIKey();

    const {
      model = this.models.chat,
      temperature = 0.8,
      maxTokens = 100
    } = options;

    let fullResponse = '';

    await this.retryWithBackoff(async () => {
      const response = await this.fetchWithTimeout(this.endpoints.chat, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: true
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`DeepSeek API error: ${error.error?.message || response.status}`);
      }

      // 处理 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的行

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;

              if (content) {
                fullResponse += content;
                if (onChunk) onChunk(content, fullResponse);
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      }

      return fullResponse;
    });

    return fullResponse;
  }

  // ==================== Embedding API ====================

  /**
   * DeepSeek 暂不支持 embedding API，使用 fallback 实现
   */
  async embed(text) {
    console.warn('DeepSeek does not support embedding API, using fallback');
    return this.getFallbackEmbedding(text);
  }

  async embedBatch(texts) {
    console.warn('DeepSeek does not support embedding API, using fallback');
    return texts.map(text => this.getFallbackEmbedding(text));
  }

  /**
   * 后备嵌入（基于字符哈希）
   */
  getFallbackEmbedding(text) {
    const dimensions = 1536;
    const embedding = new Array(dimensions).fill(0);

    // 使用字符的 Unicode 值生成简单的向量
    for (let i = 0; i < text.length && i < dimensions; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] = (charCode % 100) / 100;
    }

    // 填充剩余维度
    for (let i = text.length; i < dimensions; i++) {
      embedding[i] = (i % 10) / 100;
    }

    return embedding;
  }

  // ==================== 功能支持 ====================

  supports(feature) {
    const features = {
      chat: true,
      stream: true,
      embedding: false, // 不支持
      batchEmbedding: false
    };
    return features[feature] || false;
  }

  getDefaultModels() {
    return {
      chat: 'deepseek-chat',
      embedding: null // 不支持
    };
  }

  getInfo() {
    return {
      name: 'DeepSeek',
      description: 'DeepSeek AI 提供商（支持 Chat，不支持 Embedding）',
      endpoints: this.endpoints,
      features: {
        chat: true,
        stream: true,
        embedding: false,
        batchEmbedding: false
      },
      models: this.getDefaultModels(),
      notes: 'Embedding 功能需要使用其他提供商（如通义千问）'
    };
  }
}

module.exports = DeepSeekProvider;
