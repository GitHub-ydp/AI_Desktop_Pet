# 记忆搜索升级设计：MMR 去重 + BM25 搜索

## 一、MMR（Maximal Marginal Relevance）去重算法

### 1.1 问题分析

当前 `search.js` 的 `search()` 方法返回结果按 `finalScore` 降序排列，但没有去重/多样化处理。
用户说了多条相似内容时（如多次提到"我喜欢猫"），搜索结果会返回多条高度重复的记忆，浪费上下文 token。

### 1.2 核心公式

```
MMR = argmax_{d ∈ R\S} [ λ × sim(d, query) - (1-λ) × max_{s ∈ S} sim(d, s) ]
```

- `R`: 候选结果集
- `S`: 已选中结果集
- `λ`: 平衡相关性与多样性（0.5 = 均衡，0.7 = 偏相关性，0.3 = 偏多样性）
- `sim(d, query)`: 文档与查询的相似度 → 直接使用搜索结果的 `score`
- `sim(d, s)`: 文档间的相似度 → 需要 embedding 向量计算余弦相似度

### 1.3 关键设计决策

#### 向量获取策略

**问题**：当前搜索结果（search.js:211-225）不携带 embedding 向量。`_vectorSearchConversations` 方法内部加载了 embedding，但只返回 `vectorScore` 标量。

**方案**：在 `_vectorSearchConversations` 中同时返回 embedding 向量，附加到结果中。

```javascript
// _vectorSearchConversations 返回结构变更：
// 旧: Map<conversationId, { vectorScore }>
// 新: Map<conversationId, { vectorScore, embedding: Float32Array | null }>
```

这样 MMR 可以直接使用已加载的向量，无需二次查询数据库。

#### 函数签名

```javascript
/**
 * 对搜索结果应用 MMR 去重
 * @param {Array} results - search() 返回的结果数组，每项需有 score 和可选 embedding
 * @param {Object} options
 * @param {number} options.lambda - 相关性-多样性平衡因子，默认 0.5
 * @param {number} options.limit - 最终返回数量，默认 results.length
 * @returns {Array} MMR 重排后的结果
 */
_applyMMR(results, options = {})
```

#### 插入位置

在 `search()` 方法的 **过滤排序之后、返回之前**（search.js:244-245 之后）：

```javascript
// 现有代码
.sort((a, b) => b.score - a.score)
.slice(0, limit);

// 新增 MMR 步骤
if (MEMORY_CONFIG.search.mmr.enabled && hasVector) {
  filteredResults = this._applyMMR(filteredResults, {
    lambda: MEMORY_CONFIG.search.mmr.lambda,
    limit: limit
  });
}
```

#### 降级策略

1. **embedding 为 null 时**：跳过该文档的多样性惩罚计算，退化为纯 score 排序
2. **所有文档都无 embedding 时**：完全跳过 MMR，保持原排序
3. **embedding 引擎未就绪时**（`hasVector === false`）：MMR 自动跳过（由条件判断保证）

#### 文本降级相似度

当部分结果没有 embedding 时，使用简单的文本 Jaccard 相似度作为降级：

```javascript
_textSimilarity(textA, textB) {
  const setA = new Set(textA.split(/\s+/));
  const setB = new Set(textB.split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}
```

### 1.4 config.js 新增配置

```javascript
search: {
  // ...existing...
  mmr: {
    enabled: true,       // 是否启用 MMR 去重
    lambda: 0.5          // λ 值：0=纯多样性, 1=纯相关性, 0.5=均衡
  }
}
```

---

## 二、BM25 搜索替换方案

### 2.1 问题分析

当前关键词搜索（`_keywordScoreConversations`，search.js:277-330）使用简单的 `includes()` 匹配：
- 无词频（TF）考量：一个词出现 10 次和 1 次同分
- 无逆文档频率（IDF）：常见词和罕见词同权
- 无文档长度归一化：长文本天然占优

schema.sql 定义了 FTS5 虚拟表 `memory_fts`，但 **CLAUDE.md 明确记录"SQLite 编译时未包含 FTS5 模块"**。虽然 schema 中有 FTS5 定义，但它在运行时可能失败。

### 2.2 技术选型：JS 端 BM25

**选择理由**：
1. FTS5 不可靠（编译依赖），不应依赖
2. 数据量小（memory_chunks 通常 < 10K 条），JS 端计算完全可行
3. 无外部依赖，纯 JS 实现
4. 可与现有 `_keywordScoreConversations` 方法平滑替换

**不选 FTS5 的理由**：
- `better-sqlite3` 的 FTS5 支持取决于编译时选项
- 项目已有 "FTS5 不可用" 的历史记录
- 引入 FTS5 依赖会增加原生编译问题风险

### 2.3 BM25 公式

```
BM25(q, d) = Σ IDF(t) × [ f(t,d) × (k1 + 1) ] / [ f(t,d) + k1 × (1 - b + b × |d|/avgdl) ]
```

参数：
- `k1 = 1.2`：词频饱和参数
- `b = 0.75`：文档长度归一化参数
- `f(t,d)`：词 t 在文档 d 中的出现次数
- `|d|`：文档长度（字符数或词数）
- `avgdl`：平均文档长度
- `IDF(t) = ln((N - n(t) + 0.5) / (n(t) + 0.5) + 1)`
  - `N`：总文档数
  - `n(t)`：包含词 t 的文档数

### 2.4 实现方案

#### 新类：BM25Scorer

```javascript
/**
 * BM25 评分器
 * 纯 JS 实现，用于替换简单的 includes() 关键词匹配
 */
class BM25Scorer {
  constructor(options = {}) {
    this.k1 = options.k1 || 1.2;
    this.b = options.b || 0.75;
  }

  /**
   * 对一组文档计算 BM25 分数
   * @param {string} query - 查询文本
   * @param {Array<{id, text}>} documents - 文档数组
   * @returns {Map<id, {bm25Score: number}>} 每个文档的 BM25 分数
   */
  score(query, documents) { ... }
}
```

#### 中文分词策略

BM25 需要分词。对于中文，采用**字符 bigram + 标点分割**策略：

```javascript
// 中文分词（简单但有效）
_tokenize(text) {
  // 1. 按标点和空白分割为短语
  const phrases = text.split(/[\s,，。！？；：""''（）\(\)、\n]+/).filter(Boolean);
  const tokens = [];
  for (const phrase of phrases) {
    // 2. 对中文字符生成 bigram
    if (/[\u4e00-\u9fff]/.test(phrase)) {
      for (let i = 0; i < phrase.length - 1; i++) {
        if (/[\u4e00-\u9fff]/.test(phrase[i]) && /[\u4e00-\u9fff]/.test(phrase[i+1])) {
          tokens.push(phrase[i] + phrase[i+1]);
        }
      }
      // 也保留单字（用于短查询）
      for (const ch of phrase) {
        if (/[\u4e00-\u9fff]/.test(ch)) tokens.push(ch);
      }
    }
    // 3. 英文/数字作为整词
    const words = phrase.match(/[a-zA-Z0-9]+/g);
    if (words) tokens.push(...words.map(w => w.toLowerCase()));
  }
  return tokens;
}
```

**为什么用 bigram 而不是词典分词**：
- 无需引入分词词典（几 MB）
- Bigram 对中文搜索召回率高
- 与现有 `includes()` 行为兼容
- 性能好：纯字符串操作

#### 集成位置

替换 `_keywordScoreConversations` 方法中的关键词匹配逻辑：

```javascript
// search.js search() 方法中
// 旧: const keywordResults = this._keywordScoreConversations(query, conversations, now, mood);
// 新:
let keywordResults;
if (MEMORY_CONFIG.search.bm25.enabled) {
  keywordResults = this._bm25ScoreConversations(query, conversations, now, mood);
} else {
  keywordResults = this._keywordScoreConversations(query, conversations, now, mood);
}
```

新方法 `_bm25ScoreConversations` 与旧方法返回相同结构 `Map<id, { keywordScore, temporalScore, importanceScore }>`，其中 `keywordScore` 由 BM25 分数（归一化到 0-1）替代。

#### BM25 分数归一化

BM25 原始分数无界，需归一化到 0-1：

```javascript
// 对一批结果的 BM25 分数做 min-max 归一化
const scores = Array.from(bm25Results.values());
const maxScore = Math.max(...scores, 0.001);
// 归一化: score / maxScore
```

### 2.5 数据库迁移（v8）

**不需要数据库迁移**。BM25 是纯 JS 计算，不依赖数据库表结构变更。

如果未来需要缓存 IDF 统计或倒排索引，可以考虑 v8 迁移，但当前数据量（< 10K）不需要。

### 2.6 config.js 新增配置

```javascript
search: {
  // ...existing...
  bm25: {
    enabled: true,       // 是否启用 BM25（否则退回 includes 匹配）
    k1: 1.2,             // 词频饱和参数
    b: 0.75              // 文档长度归一化参数
  }
}
```

---

## 三、配置总览

### config.js 新增项

```javascript
search: {
  defaultLimit: 5,
  minScore: 0.6,
  vectorWeight: 0.7,
  textWeight: 0.3,
  timeout: 5000,
  // === 新增 ===
  mmr: {
    enabled: true,
    lambda: 0.5
  },
  bm25: {
    enabled: true,
    k1: 1.2,
    b: 0.75
  }
}
```

---

## 四、实现优先级

1. **BM25 先行**：独立于向量搜索，可单独测试
2. **MMR 后做**：依赖 embedding 向量传递的改动
3. **两者互不依赖**，可并行开发

## 五、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `main-process/search.js` | 修改 | 新增 `_applyMMR()`、`_bm25ScoreConversations()`、`_textSimilarity()`；修改 `_vectorSearchConversations()` 返回 embedding；修改 `search()` 集成 MMR 和 BM25 |
| `main-process/config.js` | 修改 | search 配置新增 mmr 和 bm25 子项 |
| `main-process/migrate.js` | 无变更 | BM25 纯 JS 实现，无需数据库迁移 |
