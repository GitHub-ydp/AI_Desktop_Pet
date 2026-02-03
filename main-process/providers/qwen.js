// 阿里通义千问 API 提供商实现
// CommonJS 版本 - 用于主进程

const AIProvider = require('./base');

class QwenProvider extends AIProvider {
  constructor(options = {}) {
    super({
      name: 'Qwen',
      ...options
    });

    this.endpoints = {
      chat: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      embeddings: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding'
    };

    this.models = {
      chat: options.model || 'qwen-plus',
      embedding: options.embeddingModel || 'text-embedding-v2'
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
      const requestBody = {
        model,
        input: {
          messages
        },
        parameters: {
          result_format: 'message',
          temperature,
          max_tokens: maxTokens,
          stream
        }
      };

      const response = await this.fetchWithTimeout(this.endpoints.chat, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Qwen API error: ${error.message || response.status}`);
      }

      const data = await response.json();
      return data.output.choices[0].message.content.trim();
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
      const requestBody = {
        model,
        input: {
          messages
        },
        parameters: {
          result_format: 'message',
          temperature,
          max_tokens: maxTokens,
          stream: true,
          incremental_output: true
        }
      };

      const response = await this.fetchWithTimeout(this.endpoints.chat, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Qwen API error: ${error.message || response.status}`);
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
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();

            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.output?.choices[0]?.message?.content;

              if (content) {
                fullResponse += content;
                if (onChunk) onChunk(content, fullResponse);
              }
            } catch (e) {
              // 忽略解析错误
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
   * 生成单个文本嵌入
   */
  async embed(text) {
    this.validateAPIKey();

    return await this.retryWithBackoff(async () => {
      const requestBody = {
        model: this.models.embedding,
        input: {
          texts: [text]
        },
        parameters: {
          text_type: 'document'
        }
      };

      const response = await this.fetchWithTimeout(this.endpoints.embeddings, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Qwen Embedding API error: ${error.message || response.status}`);
      }

      const data = await response.json();
      return data.output.embeddings[0].embedding;
    });
  }

  /**
   * 批量生成文本嵌入（最多 25 条）
   */
  async embedBatch(texts) {
    if (!texts || texts.length === 0) {
      return [];
    }

    this.validateAPIKey();

    const MAX_BATCH_SIZE = 25;

    // 如果数量少，直接批量调用
    if (texts.length <= MAX_BATCH_SIZE) {
      return await this.fetchBatchEmbeddings(texts);
    }

    // 分批并行处理
    const batches = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      batches.push(texts.slice(i, i + MAX_BATCH_SIZE));
    }

    // 并行调用所有批次
    const results = await Promise.all(
      batches.map(batch => this.fetchBatchEmbeddings(batch))
    );

    // 合并结果
    return results.flat();
  }

  /**
   * 获取批量嵌入
   */
  async fetchBatchEmbeddings(texts) {
    return await this.retryWithBackoff(async () => {
      const requestBody = {
        model: this.models.embedding,
        input: {
          texts: texts
        },
        parameters: {
          text_type: 'document'
        }
      };

      const response = await this.fetchWithTimeout(this.endpoints.embeddings, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Qwen Batch Embedding API error: ${error.message || response.status}`);
      }

      const data = await response.json();
      return data.output.embeddings.map(item => item.embedding);
    });
  }

  // ==================== 功能支持 ====================

  supports(feature) {
    const features = {
      chat: true,
      stream: true,
      embedding: true,
      batchEmbedding: true
    };
    return features[feature] || false;
  }

  getDefaultModels() {
    return {
      chat: 'qwen-plus',
      embedding: 'text-embedding-v2'
    };
  }

  getInfo() {
    return {
      name: 'Qwen',
      description: '阿里云通义千问提供商（支持 Chat 和 Embedding）',
      endpoints: this.endpoints,
      features: {
        chat: true,
        stream: true,
        embedding: true,
        batchEmbedding: true
      },
      models: this.getDefaultModels(),
      availableModels: {
        chat: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
        embedding: ['text-embedding-v1', 'text-embedding-v2']
      },
      limits: {
        maxBatchSize: 25,
        maxTokens: 8192,
        timeout: 60000
      }
    };
  }
}

module.exports = QwenProvider;
