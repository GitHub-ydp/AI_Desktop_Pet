// 记忆系统配置
// CommonJS 版本 - 用于主进程

const MEMORY_CONFIG = {
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

  // ==================== 新增：时间衰减配置 ====================
  temporal: {
    // 时间衰减参数
    halfLife: 168,           // 7天半衰期（记忆每周"减半"）
    minWeight: 0.1,          // 10% 下限保护重要记忆
    recentThreshold: 24,      // 24小时内 = "最近"
    boostWindow: 72,         // 3天内额外加权

    // 交互刷新参数
    recentAccessBoost: 1.3,  // 最近访问的记忆加权
    weekAccessBoost: 1.1,    // 一周内访问的记忆加权

    // 心情调制
    moodModulation: {
      enabled: true,
      highMoodThreshold: 80,   // 高心情阈值
      highMoodMultiplier: 1.2, // 高心情时记忆增强
      lowMoodThreshold: 40,    // 低心情阈值
      lowMoodMultiplier: 0.8   // 低心情时记忆减弱
    }
  },

  // ==================== 新增：缓存配置 ====================
  cache: {
    maxSize: 5000,        // 最大缓存条目数
    evictionBatch: 100,   // 每次淘汰的条目数
    autoEvict: true       // 自动淘汰
  },

  // ==================== 新增：情感权重配置 ====================
  emotional: {
    enabled: true,
    moodWeighting: true,

    // 心情乘数映射
    moodWeights: {
      high: { threshold: 80, multiplier: 1.5 },    // 开心记忆更强
      medium: { threshold: 50, multiplier: 1.0 },
      low: { threshold: 0, multiplier: 0.7 }       // 难过记忆减弱
    },

    // 性格偏好（不同性格关注不同类型的记忆）
    personalityPriorities: {
      healing: { preference: 0.3, event: 0.3, relationship: 0.4 },
      funny: { preference: 0.5, event: 0.3, relationship: 0.2 },
      cool: { preference: 0.2, event: 0.2, relationship: 0.6 },
      assistant: { preference: 0.4, event: 0.4, relationship: 0.2 }
    },

    // 情感权重（正向情感记忆优先）
    sentimentWeights: {
      positive: 1.3,
      neutral: 1.0,
      negative: 0.8
    },

    // 重要性评分因子
    importanceFactors: {
      accessFrequencyThreshold: 10,  // 访问次数阈值
      accessFrequencyBonus: 1.3,     // 访问频率奖励
      recentActiveDays: 7,           // 最近活跃天数
      recentActiveBonus: 1.1,        // 最近活跃奖励
      longContentThreshold: 200,     // 长内容字数阈值
      longContentBonus: 1.2,         // 长内容奖励
      factBonus: 1.1                 // 包含事实的奖励
    }
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

module.exports = { MEMORY_CONFIG };
