# 记忆系统优化 - 集成指南

本文档说明如何将优化后的记忆系统集成到桌面宠物应用中。

---

## 快速开始

### 1. 更新主进程集成

在 `main.js` 中，确保记忆系统初始化时设置情感上下文：

```javascript
const { MemoryMainProcess } = require('./main-process/memory');

// 创建记忆系统实例
const memorySystem = new MemoryMainProcess({
  apiKey: 'your-deepseek-api-key',
  databasePath: null,  // 使用默认路径
  personality: 'healing'
});

// 初始化
await memorySystem.initialize();

// 设置当前情感状态（在对话前调用）
function updateMemoryEmotionalContext(mood, personality) {
  memorySystem.searchEngine.setEmotionalContext(mood, personality);
}
```

### 2. 在对话中使用记忆

在处理用户消息时，先获取相关记忆：

```javascript
// 假设这是在 IPC handler 中
ipcMain.handle('chat:message', async (event, userMessage, mood, personality) => {
  // 1. 保存用户消息
  await memorySystem.addConversation('user', userMessage, {
    mood: mood,
    personality: personality
  });

  // 2. 设置情感上下文
  updateMemoryEmotionalContext(mood, personality);

  // 3. 获取相关记忆上下文
  const memoryContext = await memorySystem.getContext(userMessage, {
    maxTokens: 2000,
    maxMemories: 5,
    currentMood: mood,
    currentPersonality: personality
  });

  // 4. 构建完整提示词
  const fullPrompt = contextBuilder.buildSystemPrompt(
    basePersonalityPrompt,
    memoryContext,
    personality,
    mood
  );

  // 5. 调用 AI API
  const aiResponse = await callAIAPI(userMessage, fullPrompt);

  // 6. 保存 AI 回复
  await memorySystem.addConversation('assistant', aiResponse, {
    mood: mood,
    personality: personality
  });

  return aiResponse;
});
```

---

## API 使用示例

### 搜索记忆

```javascript
// 基本搜索
const results = await memorySystem.searchMemories('用户喜欢吃什么', {
  limit: 5,
  minScore: 0.6
});

// 带情感感知的搜索
const results = await memorySystem.searchMemories('用户喜欢吃什么', {
  limit: 5,
  minScore: 0.6,
  mood: 80,           // 当前心情
  personality: 'healing' // 当前性格
});

// 带日期范围的搜索
const results = await memorySystem.searchMemories('过去的讨论', {
  limit: 10,
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date('2024-12-31')
  }
});
```

### 获取用户画像

```javascript
const profile = await memorySystem.getUserProfile();

// 返回示例:
{
  preferences: ['喜欢喝咖啡', '喜欢听音乐'],
  events: ['生日是6月15日'],
  relationships: ['有个朋友叫小明'],
  routines: ['每天早上都会运动']
}
```

### 数据统计

```javascript
const stats = memorySystem.getStats();

// 返回示例:
{
  totalConversations: 1523,
  totalChunks: 4569,
  totalFacts: 87,
  oldestMemory: Date('2024-01-01'),
  newestMemory: Date('2024-12-31'),
  cache: {
    hits: 3456,
    misses: 123,
    hitRate: 0.965
  }
}
```

---

## 配置调优

### 时间衰减调整

根据用户反馈调整时间参数：

```javascript
// config.js

temporal: {
  // 更快的衰减（2周半衰期）
  halfLife: 336,

  // 更慢的衰减（4周半衰期）
  halfLife: 672,

  // 调整下限
  minWeight: 0.15,  // 提高下限保留更多旧记忆
  minWeight: 0.05,  // 降低下限更专注近期
}
```

### 缓存大小调整

根据设备性能调整：

```javascript
// config.js

cache: {
  // 高性能设备
  maxSize: 20000,
  evictionBatch: 500,

  // 低性能设备
  maxSize: 2000,
  evictionBatch: 50
}
```

### 情感权重调整

根据用户性格偏好：

```javascript
// config.js

emotional: {
  // 增强心情影响
  moodWeights: {
    high: { threshold: 80, multiplier: 2.0 },
    medium: { threshold: 50, multiplier: 1.0 },
    low: { threshold: 0, multiplier: 0.5 }
  },

  // 调整性格偏好
  personalityPriorities: {
    healing: { preference: 0.5, event: 0.2, relationship: 0.3 } // 更关注偏好
  }
}
```

---

## 监控和调试

### 启用详细日志

```javascript
// 在开发环境中启用
if (process.env.NODE_ENV === 'development') {
  // 搜索引擎会输出性能日志
  // 如: "Search completed in 234ms, found 5 results"
}
```

### 性能监控

```javascript
// 定期检查性能
setInterval(() => {
  const stats = memorySystem.getStats();
  console.log('Cache hit rate:', stats.cache.hitRate);
  console.log('Total memories:', stats.totalChunks);
}, 60000); // 每分钟
```

### 缓存清理

```javascript
// 手动触发缓存清理
if (memorySystem.storage) {
  memorySystem.storage.evictLRUCache(
    MEMORY_CONFIG.cache.maxSize,
    MEMORY_CONFIG.cache.evictionBatch
  );
}
```

---

## 常见问题

### Q: 为什么旧记忆还在被提及？

A: 时间衰减系统会逐渐降低旧记忆权重，但不会完全消除。如果旧记忆仍然频繁出现，可以：
- 降低 `temporal.minWeight`（如从 0.1 降到 0.05）
- 缩短 `temporal.halfLife`（如从 168 降到 120）

### Q: 搜索变慢了怎么办？

A: 如果搜索性能下降：
- 减少 `search.defaultLimit`（如从 5 降到 3）
- 提高 `search.minScore`（如从 0.6 降到 0.7）
- 检查 `cache.hitRate`，如果低于 0.8，考虑增加 `cache.maxSize`

### Q: 如何禁用某个优化功能？

A: 所有优化都可通过配置禁用：

```javascript
// 禁用时间衰减
temporal: {
  halfLife: 87600,  // 设置为非常大的值
  minWeight: 1.0    // 不衰减
}

// 禁用情感权重
emotional: {
  enabled: false
}

// 禁用缓存淘汰
cache: {
  autoEvict: false
}
```

### Q: 数据库迁移失败怎么办？

A: 如果升级时出现字段错误：
1. 备份现有数据库
2. 删除数据库文件，让应用重新创建
3. 或手动运行迁移 SQL（见 MEMORY_SYSTEM_CHANGES.md）

---

## 向后兼容性

### 旧数据导入

如果用户有旧版本的 LocalStorage 数据：

```javascript
// 1. 读取旧数据
const oldData = {
  chatHistory: localStorage.getItem('chat_history'),
  petData: localStorage.getItem('pet_data')
};

// 2. 迁移到新系统
await memorySystem.migrateFromLocalStorage(oldData);

// 3. 验证迁移
const stats = memorySystem.getStats();
console.log('迁移完成:', stats);
```

### 降级处理

如果需要回退到旧版本：
- 新字段会自动使用默认值
- 旧版本会忽略新字段
- 不会破坏现有数据

---

## 性能基准

在标准测试环境下的预期性能：

| 操作 | 预期时间 | 备注 |
|------|----------|------|
| 保存对话 | < 50ms | 异步处理 |
| 搜索记忆 | < 500ms | 含嵌入生成 |
| 获取上下文 | < 200ms | 使用缓存 |
| 批量嵌入(10条) | < 1000ms | 优化前 ~5000ms |
| 缓存查询 | < 10ms | LRU 缓存 |

---

## 下一步

1. **测试**: 运行 `test-memory-optimizations.js` 验证所有功能
2. **调优**: 根据实际使用反馈调整配置参数
3. **监控**: 添加性能和用户体验监控
4. **迭代**: 根据用户反馈持续优化

---

## 技术支持

如有问题或建议，请查看：
- `MEMORY_SYSTEM_CHANGES.md` - 详细的实现文档
- `MEMORY_OPTIMIZATION_PLAN.md` - 原始优化方案
- `test-memory-optimizations.js` - 测试脚本
