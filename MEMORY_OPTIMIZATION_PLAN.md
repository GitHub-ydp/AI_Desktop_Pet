# 记忆系统优化实施计划

## 概述

本文档详细记录了对 AI 桌面宠物记忆系统的优化实施方案，聚焦**情感智能**和**时间相关性**。

**设计理念**：桌面宠物是情感陪伴产品，不是生产力工具。所有优化优先考虑自然对话体验。

---

## 实施阶段

### 第一阶段（P0 - 高影响低复杂度）

#### 1. 缓存 LRU 淘汰策略
**目标**：防止嵌入缓存无限增长，控制数据库大小。

**实施要点**：
- 添加 `last_accessed_at` 和 `access_count` 字段到 `embedding_cache` 表
- 实现 LRU 淘汰逻辑：达到上限时删除最久未使用的条目
- 配置参数：maxSize: 5000, evictionBatch: 100

**文件修改**：
- `main-process/schema.sql` - 添加字段和索引
- `main-process/database.js` - 添加 LRU 跟踪和淘汰方法

#### 2. 批量嵌入 API 优化
**目标**：10倍性能提升，从逐个调用改为真正的批量请求。

**实施要点**：
- 修改 `callBatchEmbeddingAPI()` 使用 DeepSeek 批量 API
- 并行处理多个批次
- 缓存检查优化

**文件修改**：
- `main-process/embeddings.js` - 重写批量逻辑

#### 3. 时间衰减系统
**目标**：解决"重复旧记忆"问题，让 AI 专注于近期对话。

**实施要点**：
- 实现时间衰减函数（7天半衰期）
- 交互刷新机制（最近访问的记忆获得加权）
- 心情调制（高心情增强记忆，低心情减弱记忆）

**文件修改**：
- `main-process/search.js` - 添加时间衰减逻辑
- `main-process/config.js` - 添加 temporal 配置
- `main-process/schema.sql` - 添加时间跟踪字段

---

### 第二阶段（P1 - 中等影响中等复杂度）

#### 4. 评分标准化
**目标**：统一向量相似度和 FTS rank 的评分标准。

**实施要点**：
- FTS rank sigmoid 归一化
- 分数合并前归一化
- 可配置的权重系统

**文件修改**：
- `main-process/search.js` - 添加归一化方法

#### 5. 情感记忆增强
**目标**：让宠物根据心情和性格优先回忆相关记忆。

**实施要点**：
- 心情权重系统（相似心情记忆加权）
- 性格偏好（不同性格关注不同类型记忆）
- 情感分析（正向情感记忆优先）

**文件修改**：
- `main-process/search.js` - 情感权重逻辑
- `main-process/context.js` - 情感上下文构建
- `main-process/config.js` - 情感配置

---

### 第三阶段（P2 - 高级功能）

#### 6. 记忆重要性评分
**目标**：智能记忆优先级，重要记忆更不容易被遗忘。

**实施要点**：
- 访问频率、活跃度、内容长度等因素
- 动态更新重要性分数

**文件修改**：
- `main-process/database.js` - 重要性评分计算
- `main-process/schema.sql` - 添加 importance_score 字段

---

## 数据库迁移

```sql
-- 001_add_temporal_and_emotional_features.sql

-- 时间跟踪
ALTER TABLE memory_chunks ADD COLUMN last_accessed_at INTEGER;
ALTER TABLE memory_chunks ADD COLUMN access_count INTEGER DEFAULT 1;
ALTER TABLE memory_chunks ADD COLUMN importance_score REAL DEFAULT 1.0;

-- LRU 跟踪
ALTER TABLE embedding_cache ADD COLUMN last_accessed_at INTEGER;
ALTER TABLE embedding_cache ADD COLUMN access_count INTEGER DEFAULT 1;

-- 索引
CREATE INDEX IF NOT EXISTS idx_memory_chunks_updated
  ON memory_chunks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_importance
  ON memory_chunks(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_lru
  ON embedding_cache(last_accessed_at ASC);

-- 回填数据
UPDATE memory_chunks SET last_accessed_at = updated_at;
UPDATE embedding_cache SET last_accessed_at = created_at;
```

---

## 配置示例

### 生产环境配置
```javascript
temporal: {
  halfLife: 168,        // 7天
  minWeight: 0.15,      // 15%下限
  recentThreshold: 24,  // 24小时
  boostWindow: 72       // 3天额外加权
},
cache: {
  maxSize: 10000,       // 大缓存
  evictionBatch: 200    // 淘汰批次
},
emotional: {
  enabled: true,
  moodWeighting: true
}
```

---

## 测试验证

### 性能基准
- 批量嵌入 10 条文本：< 1000ms（当前 ~5000ms）
- LRU 淘汰：自动保持 maxSize 以下

### 功能测试
- 时间衰减：验证旧记忆权重降低
- 情感权重：验证心情和性格影响搜索结果
- 缓存淘汰：验证 LRU 正常工作

---

## 向后兼容性

- 旧记忆的 `last_accessed_at` 默认为 `updated_at`
- 缺失的 `importance_score` 默认为 `1.0`
- 所有新功能可通过配置开关
