# Memory Upgrade Test Report: MMR + BM25

> 日期：2026-03-05（最终审查 v3）
> 测试类型：代码审查 + 逻辑验证
> 审查范围：`main-process/search.js`, `main-process/config.js`
> 审查版本：developer 最终修复版（lambda bug 修复 + BM25 实现）

---

## 总体结论

**全部通过。** MMR 去重、BM25 关键词搜索均已正确实现，之前报告的 lambda 参数传递 BUG 已修复。0 个 Fail，0 个需要修复的问题。

---

## 1. MMR 去重审查

### 1.1 实现概览

| 检查项 | 结果 | 说明 |
|--------|------|------|
| `_applyMMR()` 方法 | ✅ Pass | search.js:484-542 |
| `_cosineSimilarity()` 方法 | ✅ Pass | search.js:545-563 |
| `_textSimilarity()` Jaccard 降级 | ✅ Pass | search.js:566-574 |
| MMR 配置（config.js） | ✅ Pass | `mmr.enabled: true`, `mmr.lambda: 0.5` |
| `search()` 中调用 MMR | ✅ Pass | search.js:255-260 |
| MMR 开关检查 | ✅ Pass | 检查 `mmr?.enabled` + `hasVector` + `length > 1` |

### 1.2 lambda 参数传递（已修复）

search.js:256-259：
```javascript
filteredResults = this._applyMMR(filteredResults, {
  lambda: MEMORY_CONFIG.search.mmr.lambda,
  limit: limit
});
```

search.js:487-488：
```javascript
const lambda = options.lambda ?? 0.5;
const targetCount = options.limit || results.length;
```

✅ **Pass** -- 调用方传入对象 `{ lambda, limit }`，方法正确解构。config 中的 lambda 值现在能正确生效。`targetCount` 使用调用方传入的 `limit`，不再使用硬编码 `defaultLimit`。

### 1.3 lambda 边界条件

MMR 公式（search.js:530）：`mmrScore = lambda * relevance - (1 - lambda) * maxSim`

| 条件 | 预期 | 实际 | 状态 |
|------|------|------|------|
| lambda=1.0 | 纯相关性排序 | mmrScore = relevance | ✅ Pass |
| lambda=0.0 | 纯多样性选择 | mmrScore = -maxSim | ✅ Pass |
| lambda=0.5 (默认) | 平衡相关性和多样性 | 50/50 权重 | ✅ Pass |

### 1.4 embedding 降级

| 场景 | 行为 | 状态 |
|------|------|------|
| 全部无 embedding | `hasAnyEmbedding=false` -> 返回原结果 (search.js:494) | ✅ Pass |
| 部分有 embedding | 有 embedding 用余弦相似度，无 embedding 用 Jaccard (search.js:515-524) | ✅ Pass |
| 向量搜索未启用 | `hasVector=false` -> 跳过 MMR (search.js:255) | ✅ Pass |

### 1.5 hasVector 条件守卫

search.js:255 新增 `hasVector` 条件：
```javascript
if (MEMORY_CONFIG.search.mmr?.enabled && hasVector && filteredResults.length > 1) {
```

✅ **Pass** -- 当向量搜索未运行时（嵌入引擎未就绪），所有结果的 `embedding` 字段为 `null`，MMR 无法计算余弦相似度。`hasVector` 守卫避免了不必要的 MMR 调用。

### 1.6 embedding 数据流

| 步骤 | 位置 | 说明 |
|------|------|------|
| DB 读取 embedding blob | search.js:594 | `_vectorSearchConversations` |
| 传入 vectorResults Map | search.js:603 | `{ vectorScore, embedding }` |
| 合并到结果对象 | search.js:231 | `embedding: vs.embedding \|\| null` |
| MMR 直接使用 | search.js:515-517 | `candidates[i].embedding` |

✅ **Pass** -- 一次 DB 查询，通过结果传递，MMR 无二次查询。

### 1.7 辅助方法

| 方法 | 检查项 | 状态 |
|------|--------|------|
| `_cosineSimilarity` | 零向量、长度不匹配、null 保护 | ✅ Pass |
| `_textSimilarity` | 空文本、空集合保护、中文标点分词 | ✅ Pass |

---

## 2. BM25 关键词搜索审查

### 2.1 实现概览

| 检查项 | 结果 | 说明 |
|--------|------|------|
| `_bm25ScoreConversations()` 方法 | ✅ Pass | search.js:348-452 |
| `_tokenize()` 分词器 | ✅ Pass | search.js:455-479 |
| BM25 配置（config.js） | ✅ Pass | `bm25.enabled: true`, `k1: 1.2`, `b: 0.75` |
| BM25/旧版切换逻辑 | ✅ Pass | search.js:148-153，通过 `bm25?.enabled` 切换 |
| 旧版 `_keywordScoreConversations` 保留 | ✅ Pass | search.js:292-345，作为降级方案 |

### 2.2 BM25 公式验证

search.js:396-406：
```javascript
// IDF: ln((N - n + 0.5) / (n + 0.5) + 1)
const idf = Math.log((totalDocs - n + 0.5) / (n + 0.5) + 1);
// TF 饱和: f(t,d) * (k1+1) / (f(t,d) + k1 * (1 - b + b * |d|/avgdl))
const tfSat = (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl));
```

**IDF 公式验证：**
- 标准 BM25 IDF：`log((N - n + 0.5) / (n + 0.5))`
- 实现使用 `log((N - n + 0.5) / (n + 0.5) + 1)` -- 加 +1 防止参数为负时 log 返回 NaN
- 当 n > N/2 时，`(N - n + 0.5) / (n + 0.5)` 可能 < 1，标准公式会产生负 IDF，加 1 确保 IDF >= 0
- ✅ **Pass** -- 正确且安全

**TF 饱和公式验证：**
- 标准 BM25 TF 饱和公式，参数 k1=1.2、b=0.75 是经典默认值
- 当 f->inf 时，tfSat -> (k1+1) = 2.2（饱和上限）
- 当 dl=avgdl 时，`(1-b+b*dl/avgdl)` = 1，回退到标准词频饱和
- ✅ **Pass**

### 2.3 分词器 `_tokenize()` 验证

search.js:455-479：

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 空文本保护 | ✅ Pass | `if (!text) return []` |
| 中文 bigram | ✅ Pass | 相邻中文字符生成 bigram |
| 中文单字 | ✅ Pass | 每个中文字符也作为独立 token |
| 英文整词 | ✅ Pass | 英文/数字作为整词，转小写 |
| 标点分割 | ✅ Pass | 中英文标点均作为分隔符 |

**中文 bigram + 单字策略：** 对"我叫小明"生成 `["我叫", "叫小", "小明", "我", "叫", "小", "明"]`。bigram 提供精确匹配，单字提供模糊匹配，两者叠加 BM25 分数使精确匹配得分更高。合理设计。

### 2.4 BM25 归一化

search.js:412-429：

| 检查项 | 结果 | 说明 |
|--------|------|------|
| min-max 归一化 | ✅ Pass | 相对于最高分归一化 |
| 防除零 | ✅ Pass | `Math.max(..., 0.001)` |
| 基础分 0.1 | ✅ Pass | 无匹配时 keywordScore = 0.1 |
| 上限 1.0 | ✅ Pass | `Math.min(1.0, keywordScore)` |

### 2.5 BM25 开关与降级

search.js:148-153：`bm25?.enabled` 控制切换，两个方法返回格式相同（`Map<id, { keywordScore, temporalScore, importanceScore }>`）。
✅ **Pass**

---

## 3. 之前报告问题的修复状态

| # | 问题 | 之前状态 | 当前状态 |
|---|------|---------|---------|
| 1 | lambda 参数传递类型不匹配 | ❌ Fail | ✅ 已修复（传对象 `{ lambda, limit }`） |
| 2 | targetCount 使用硬编码 defaultLimit | ⚠️ Warning | ✅ 已修复（使用 `options.limit`） |
| 3 | MMR 二次查询 DB 读 embedding | ⚠️ Warning | ✅ 已修复（通过结果传递 embedding） |
| 4 | 无 BM25/TF-IDF 评分 | ❌ Fail | ✅ 已修复（完整 BM25 实现） |
| 5 | trigger_count 命名不一致 | ⚠️ Warning | ✅ 已处理（roadmap 标注统一） |

---

## 4. 测试用例总结

### MMR 测试用例

| # | 测试用例 | 预期结果 | 实际结果 | 状态 |
|---|---------|---------|---------|------|
| 1 | lambda=1.0 退化为原始排序 | mmrScore = relevance | 公式验证正确 | ✅ Pass |
| 2 | lambda=0.0 纯多样性 | 选最不相似的候选 | mmrScore = -maxSim | ✅ Pass |
| 3 | 全部无 embedding 降级 | 返回原结果 | hasAnyEmbedding=false -> return | ✅ Pass |
| 4 | 部分无 embedding 降级 | Jaccard 文本相似度 | _textSimilarity() 被调用 | ✅ Pass |
| 5 | 向量搜索未启用 | 跳过 MMR | hasVector=false 守卫 | ✅ Pass |
| 6 | config 关闭 MMR | 跳过 _applyMMR | mmr?.enabled 检查 | ✅ Pass |
| 7 | 单条结果 | 不执行 MMR | results.length > 1 | ✅ Pass |
| 8 | lambda 从 config 传递 | config 值生效 | 对象传递，正确解构 | ✅ Pass |
| 9 | limit 从调用方传递 | targetCount = limit | options.limit 正确使用 | ✅ Pass |

### BM25 测试用例

| # | 测试用例 | 预期结果 | 实际结果 | 状态 |
|---|---------|---------|---------|------|
| 1 | IDF 公式正确 | 低频词 IDF 高 | log 防负数处理正确 | ✅ Pass |
| 2 | TF 饱和 | 高频不无限增长 | f -> inf 时 tfSat -> 2.2 | ✅ Pass |
| 3 | 文档长度归一化 | 长文档不占优 | dl/avgdl 归一化 | ✅ Pass |
| 4 | 中文 bigram 分词 | "名字"作为整体 token | bigram + 单字双重策略 | ✅ Pass |
| 5 | 英文整词分词 | "hello"作为整词 | 正则匹配，转小写 | ✅ Pass |
| 6 | 多词区分度 | 多词命中 > 单词 | BM25 累加 + IDF 权重 | ✅ Pass |
| 7 | BM25 归一化 [0.1, 1.0] | 不超过 1.0 | min-max + Math.min | ✅ Pass |
| 8 | 防除零 | 全0分不崩溃 | Math.max(..., 0.001) | ✅ Pass |
| 9 | BM25 关闭降级 | 回退旧版 includes | bm25?.enabled 检查 | ✅ Pass |
| 10 | 空文本 | 分词返回空数组 | if (!text) return [] | ✅ Pass |
| 11 | config k1/b 参数 | 可自定义 | 从 bm25Config 读取 | ✅ Pass |

---

## 5. 最终结论

**通过率：20/20 测试用例全部通过，0 个 Fail，0 个需修复问题。**

实现质量优秀：
- **MMR** -- 核心算法正确，lambda 边界完善，三层降级（向量余弦 -> Jaccard 文本 -> 跳过 MMR），hasVector 守卫防止无意义调用
- **BM25** -- 标准公式正确实现（IDF 防负数、TF 饱和、文档长度归一化），中文 bigram+单字分词策略合理
- **架构** -- embedding 数据流一次查询传递，BM25/旧版通过 config 开关切换，返回格式统一
- **之前报告的所有问题均已修复**

---

*报告由 tester agent 生成 | 最终审查 v3*
