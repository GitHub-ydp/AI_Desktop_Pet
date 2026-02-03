// 记忆系统配置

export const MEMORY_CONFIG = {
  // 数据库配置
  database: {
    filename: 'pet-memory.db',
    maxSize: 100 * 1024 * 1024 // 100MB
  },

  // 嵌入配置
  embeddings: {
    provider: 'deepseek',
    model: 'deepseek-embeddings',
    dimensions: 1536,
    batchSize: 10,
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000
  },

  // 分块配置
  chunking: {
    maxTokens: 200,     // 块大小
    overlap: 50,        // 重叠
    minLength: 50       // 最小块长度
  },

  // 搜索配置
  search: {
    defaultLimit: 5,
    minScore: 0.6,
    vectorWeight: 0.7,
    textWeight: 0.3,
    timeout: 5000
  },

  // 上下文配置
  context: {
    maxTokens: 2000,     // AI 上下文预算
    maxMemories: 5,      // 最多引用记忆数
    includeFacts: true,
    includeTimestamp: true
  },

  // 提取配置
  extraction: {
    enabled: true,
    autoExtract: true,
    useAI: true,
    confidence: 0.7
  },

  // 清理配置
  cleanup: {
    autoPrune: false,
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1年
    maxSize: 10000
  },

  // 事实类型定义
  factTypes: {
    preference: {
      label: '用户偏好',
      keywords: ['喜欢', '爱', '讨厌', '不喜欢', '想要', '希望'],
      patterns: [
        /我喜欢?(.+)/,
        /我讨厌?(.+)/,
        /我不喜欢?(.+)/
      ]
    },
    event: {
      label: '重要事件',
      keywords: ['生日', '会议', '约会', '计划', '要去做'],
      patterns: [
        /我的生日是(.+)/,
        /我有个?(约会|会议|计划)(.+)/
      ]
    },
    relationship: {
      label: '关系信息',
      keywords: ['朋友', '同事', '家人', '老板', '老师'],
      patterns: [
        /我的(.+)是(.+)/,
        /(.+)是我的(.+)/
      ]
    },
    routine: {
      label: '日常习惯',
      keywords: ['每天', '习惯', '通常', '总是', '经常'],
      patterns: [
        /我每天?(.+)/,
        /我习惯?(.+)/
      ]
    }
  }
};

export default MEMORY_CONFIG;
