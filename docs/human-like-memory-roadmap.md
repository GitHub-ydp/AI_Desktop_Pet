# 仿人脑记忆系统 — 长期演进路线图

> 创建日期：2026-03-05
> 目标：让 AI 桌面宠物拥有接近人类的记忆能力
> 原则：分阶段实施，每阶段独立可交付，不影响现有功能

---

## 现状基线（已完成）

```
✅ FSRS 动态遗忘曲线（幂函数，优于指数衰减）
✅ 记忆强化机制（reinforce_count 驱动半衰期增长）
✅ 情感权重（闪光灯记忆效应，极端情绪下记忆更持久）
✅ 软删除（R < 0.1 不参与搜索）
✅ LLM 事实提取（语义记忆层）
✅ 三层记忆架构（用户画像 + 重要记忆 + 对话历史）
✅ 混合搜索（关键词 0.3 + 向量 0.4 + strength 0.2 + 重要性 0.1）
```

---

## 阶段一：搜索质量提升（难度低，2-3天）

> 目标：让搜索结果更多样、更准确

### 1.1 MMR 去重（借鉴 OpenClaw）

**问题**：当前搜索可能返回 5 条内容高度相似的记忆，浪费上下文预算。

**方案**：在搜索返回结果后，用 Maximal Marginal Relevance 算法对结果重排序。

```javascript
// 伪代码：main-process/search.js 末尾新增
function applyMMR(results, lambda = 0.5) {
  // lambda=0.5 平衡相关性和多样性
  // lambda=1.0 纯相关性（退化为原排序）
  // lambda=0.0 纯多样性
  const selected = [];
  const candidates = [...results];

  while (selected.length < Math.min(5, results.length)) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < candidates.length; i++) {
      // 相关性分
      const relevance = candidates[i].score;
      // 与已选结果的最大相似度（越低越好，代表多样）
      const maxSim = selected.length === 0 ? 0
        : Math.max(...selected.map(s => cosineSim(candidates[i].embedding, s.embedding)));

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(candidates[bestIdx]);
    candidates.splice(bestIdx, 1);
  }
  return selected;
}
```

**涉及文件**：`main-process/search.js`
**配置项**：`config.js` 中新增 `search.mmr.enabled` 和 `search.mmr.lambda`

---

### 1.2 休眠记忆唤醒机制

**问题**：R < 0.1 的记忆直接过滤，等于永久遗忘，不像人脑（人在特定线索下能想起遗忘的事）。

**方案**：休眠记忆不删除，但设 `is_dormant=true`。当查询与休眠记忆高度匹配（向量相似度 > 0.9）时，允许它"被唤醒"重新参与搜索，并重置 strength=0.3。

```javascript
// 唤醒条件：向量相似度超高阈值 + 记忆未被硬删除
if (vectorSim > 0.9 && chunk.is_dormant) {
  // 唤醒：给予最低可用强度
  awakened.push({ ...chunk, strength: 0.3, awakened: true });
}
```

**涉及文件**：`main-process/schema.sql`（新增 `is_dormant` 字段）、`main-process/search.js`

---

## 阶段二：记忆整合（难度中，1-2周）

> 目标：模拟人脑睡眠时的记忆整合，压缩碎片、提炼要点

### 2.1 记忆整合器（Memory Consolidator）

**背景**：人脑在睡眠时会把当天的碎片记忆（海马体）整合压缩成长期记忆（新皮层）。删掉情节细节，保留语义要点。

**方案**：新建 `main-process/memory-consolidator.js`，定期（每 100 轮对话或每天一次）运行：

1. 找出同一话题的多条相关记忆（向量聚类）
2. 调用 LLM 把它们压缩成一条摘要
3. 摘要存入新的 memory_chunk，原始记录降权（stability 减半）
4. 摘要 chunk 获得所有原始 chunk 的 reinforce_count 之和

```
整合前：
  [3天前] "我喜欢吃拉面，今天去了新开的那家"         strength=0.7
  [5天前] "拉面真的太好吃了，尤其是浓汤底"           strength=0.6
  [10天前] "又去吃拉面了，这次点了叉烧"              strength=0.5

整合后（LLM 压缩）：
  [摘要] "用户非常喜欢拉面，偏好浓汤底，常去附近的拉面店" strength=1.0, reinforce_count=合并值
```

**涉及文件**：
- 新建 `main-process/memory-consolidator.js`
- `main-process/memory.js`（注册定时任务）
- `main-process/schema.sql`（新增 `is_consolidated`、`source_chunk_ids` 字段）

**配置项**：
```javascript
consolidation: {
  enabled: true,
  triggerAfterConversations: 100,  // 每100轮对话触发
  clusterThreshold: 0.75,           // 向量相似度阈值，>0.75 认为同话题
  minClusterSize: 3,                // 至少3条才整合
  model: 'deepseek-chat'
}
```

---

### 2.2 情景记忆 vs 语义记忆 的明确分离

**背景**：人脑有两套记忆系统：
- **情景记忆**：发生在特定时间地点的具体事件（"上周五我们聊了什么"）
- **语义记忆**：抽象化的知识和概念（"用户喜欢猫"）

**当前问题**：conversations 表（情景）和 memory_facts 表（语义）已经分开，但搜索时没有区分策略。

**方案**：
- 情景记忆查询（"我们聊过...吗"）→ 优先搜索 conversations，按时间排序
- 语义记忆查询（"我喜欢什么"）→ 优先搜索 memory_facts + user_profile
- 在 `main-process/context.js` 的 `build()` 中加入查询意图识别

**涉及文件**：`main-process/context.js`、`main-process/search.js`

---

## 阶段三：联想激活（难度高，2-4周）

> 目标：让 AI 能主动把当前对话和历史记忆关联，而不是等用户触发检索
> 这是最接近人脑的特性，也是当前所有 AI 记忆系统的最大缺口

### 3.1 记忆关联图（Memory Graph）

**原理**：人脑记忆不是独立存储的，而是通过关联网络连接（想到"猫"→"宠物"→"上次养的那只"→"生病了很难过"）。

**方案**：在 SQLite 中建立记忆关联表，记录哪些记忆经常被一起检索或时间相近：

```sql
-- 新增表：记忆关联边
CREATE TABLE memory_relations (
  id TEXT PRIMARY KEY,
  chunk_id_a TEXT NOT NULL,          -- 记忆 A
  chunk_id_b TEXT NOT NULL,          -- 记忆 B
  relation_type TEXT,                -- 'temporal'（时间相近）| 'semantic'（语义相似）| 'causal'（因果）
  strength REAL DEFAULT 1.0,         -- 关联强度（共同出现次数驱动）
  co_occurrence_count INTEGER DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (chunk_id_a) REFERENCES memory_chunks(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id_b) REFERENCES memory_chunks(id) ON DELETE CASCADE
);
CREATE INDEX idx_memory_relations_a ON memory_relations(chunk_id_a);
CREATE INDEX idx_memory_relations_b ON memory_relations(chunk_id_b);
```

**关联建立时机**：
1. **共现强化**：同一次 getContext 中同时被检索到的两条记忆，co_occurrence_count+1
2. **时间邻近**：同一天内创建的记忆自动建立 temporal 关联
3. **语义相似**：向量余弦相似度 > 0.8 的记忆建立 semantic 关联（后台批量计算）

**涉及文件**：
- 新建 `main-process/memory-graph.js`
- `main-process/schema.sql`（新增 memory_relations 表）
- `main-process/search.js`（搜索后扩展关联记忆）

---

### 3.2 扩散激活搜索（Spreading Activation）

**原理**：人脑检索记忆时，激活会沿关联网络扩散（像涟漪），激活相关但未被直接查询的记忆。

**方案**：搜索后，沿关联图做一步扩散：

```javascript
// main-process/search.js 新增
async function spreadingActivation(db, seedResults, maxHops = 1) {
  const activated = new Map();  // chunkId → activationScore

  // 初始激活
  for (const result of seedResults) {
    activated.set(result.chunkId, result.score);
  }

  // 一阶扩散
  for (const [chunkId, score] of activated) {
    const relations = db.prepare(`
      SELECT chunk_id_b as neighbor, strength
      FROM memory_relations WHERE chunk_id_a = ?
      UNION
      SELECT chunk_id_a as neighbor, strength
      FROM memory_relations WHERE chunk_id_b = ?
    `).all(chunkId, chunkId);

    for (const rel of relations) {
      if (!activated.has(rel.neighbor)) {
        // 激活衰减：关联强度 × 源激活分 × 衰减因子0.5
        activated.set(rel.neighbor, score * rel.strength * 0.5);
      }
    }
  }

  return activated;
}
```

**效果**：用户说"猫"，不只返回直接提到猫的对话，还能联想到"宠物医院""毛茸茸的东西""之前养过的宠物"等关联记忆。

---

### 3.3 主动联想（AI 主动触发）

**目标**：AI 在对话中主动说"你之前提到过..."，而不是被动等用户触发。

**方案**：在 `src/app-vanilla.js` 的对话流程中，当新消息与某条高强度历史记忆向量相似度 > 0.85 时，自动在系统提示中注入联想提示：

```javascript
// 联想提示注入（system prompt 追加）
if (associatedMemory) {
  systemPromptExtra = `
    [联想提醒] 用户当前话题与历史记忆高度相关：
    "${associatedMemory.text}"（${daysAgo}天前）
    如果自然，可以主动提及这段记忆，展示你记得用户的生活。
  `;
}
```

**注意**：频率控制，避免每次都主动联想（令人烦躁）。建议每5轮对话最多触发1次，且只在相似度 > 0.9 时触发。

---

## 阶段四：长期愿景（难度极高，按需推进）

> 这些功能实现难度大、收益不确定，列为长期方向，不设时间表

### 4.1 情景重建（Episodic Replay）

不只返回原文，而是重建"那次对话的情境"：

```
当前：返回原始对话文本
目标：重建 → "那是2025年1月的一个晚上，用户心情很好(mood=85)，
              聊到了工作上的一件开心的事..."
```

需要：时间感知、情绪回放、叙事重构能力。

### 4.2 前瞻性记忆（Prospective Memory）

人脑能"记得要做某件事"（不同于提醒系统的被动触发）。AI 能主动在合适时机说"你之前说想学吉他，最近有进展吗？"。

需要：意图追踪 + 时机判断 + 主动发起对话能力。

### 4.3 记忆的情绪色彩（Mood-Congruent Recall）

人在开心时更容易想起开心的事，悲伤时更容易想起悲伤的事。

当前系统有 moodModulation（心情调制），但权重固定。真正的情绪一致性记忆需要根据当前心情动态调整搜索偏向。

---

## 实施优先级总览

```
现在     阶段一          阶段二          阶段三          阶段四
  │       2-3天          1-2周           2-4周           长期
  │
  ▼
[基线] → [MMR去重]  → [记忆整合]  → [联想激活]  → [情景重建]
         [休眠唤醒]    [情景/语义    [关联图]       [前瞻记忆]
                       分离]         [扩散搜索]     [情绪一致]
                                     [主动联想]
```

**投入产出比排序**：
1. MMR 去重（2天，搜索多样性立刻提升）
2. 休眠唤醒（1天，避免永久失忆）
3. 记忆整合器（1周，数据库不再无限膨胀）
4. 联想激活（2-4周，最接近人脑的突破性功能）

---

## 技术债务（同步清理）

在推进以上功能的同时，建议同步修复：

| 问题 | 优先级 | 说明 |
|------|--------|------|
| 分块质量 | 中 | 整条消息作为一块，长消息细粒度差；可改为 400 token 滑动窗口 |
| 向量搜索性能 | 中 | 10K+ 记录全表扫描；新增部分索引（已在 v7 迁移中改善）|
| context 压缩触发 | 低 | 借鉴 OpenClaw，上下文快满时自动写入长期记忆 |
| trigger_count 字段名 | 低 | 代码中实际用了 trigger_count，设计文档写的 reinforce_count，需统一 |

---

## 参考资料

- FSRS 算法论文：[Open-Source FSRS Algorithm](https://github.com/open-spaced-repetition/fsrs4anki)
- Spreading Activation 理论：Collins & Loftus (1975)
- 情景记忆 vs 语义记忆：Tulving (1972)
- 闪光灯记忆效应：Cahill & McGaugh (1995)
- MMR 算法：Carbonell & Goldstein (1998)
- MemoryBank（AI 记忆系统）：Zhong et al. (2023)
- FOREVER（参数空间记忆）：2025
