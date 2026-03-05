# 仿人脑动态记忆系统 — 完整设计文档

> 版本：v1.1 | 日期：2026-03-04
> 基于 FSRS 间隔重复理论 + 现有记忆系统架构分析

---

## 1. 核心数据模型

### 1.1 memory_chunks 表新增字段

```sql
-- 强化计数（主动）：对话中被用户主动讨论或 AI 主动检索使用的次数
-- 只有 reinforce_count 驱动半衰期增长
reinforce_count INTEGER DEFAULT 0

-- 访问计数（被动）：搜索命中但未实际纳入回复上下文的次数
-- 保留原有 access_count 字段，不驱动半衰期增长
-- access_count 已存在于表中（DEFAULT 1），无需新增

-- 最后一次强化时间（毫秒时间戳）
last_triggered_at INTEGER

-- 记忆稳定性 S（单位：小时）
-- 含义：当前记忆的"半衰期"，即 R 衰减到 50% 所需的时间
-- 初始值：168（7天），每次强化后按幂律增长
-- 取值范围：[1, 8760]（1小时 ~ 1年）
-- 增长公式：S = S0 × (1 + a × n) ^ b，b=0.5（平方根，边际递减）
stability REAL DEFAULT 168.0

-- 记忆综合强度（0-1）
-- 含义：融合了时间衰减(R) + 情感权重的综合评分
-- **替代原有评分公式中的 temporal 分量**（权重 0.2）
-- 计算：strength = R × emotionalWeight（归一化到 0-1）
-- R < 0.1 时进入休眠（不参与搜索）
-- 更新策略：强化时立即设为 1.0×emotionalWeight；搜索时惰性重算
strength REAL DEFAULT 1.0

-- 情感权重（1.0-1.5）
-- 含义：该记忆形成时的情感强度乘数
-- 情绪越偏离中性（mood=50），权重越高
-- 公式：1 + 0.5 × |mood - 50| / 50
-- 注意：已融入 strength 计算，不再作为独立乘数
emotional_weight REAL DEFAULT 1.0
```

**关键设计决策：access_count vs reinforce_count 的区分**

| 字段 | 类型 | 触发场景 | 作用 |
|------|------|---------|------|
| `access_count` | 被动 | 搜索命中（出现在候选列表中） | 统计用途，不驱动 S 增长 |
| `reinforce_count` | 主动 | 被纳入 AI 回复上下文 / 用户主动提及 | 驱动半衰期 S 增长 |

理由：单纯的搜索命中不等于"回忆"。只有真正被纳入对话上下文（AI 用它来回复），才算有效的记忆强化。这避免了搜索引擎频繁查询导致 stability 虚假增长。

**`strength` 替代 `temporal`（而非并列）的原因：**

strength 通过 FSRS 公式已内含：
1. 时间衰减（R 随时间下降）
2. 强化次数（reinforce_count 驱动 S 增长，S 越大衰减越慢）
3. 情感权重（emotional_weight 作为乘数融入）

如果保留原 temporal 分量，会导致时间因素被双重计算。因此 **strength 直接替代 temporal 在评分公式中的位置**。

**难度系数 D 的 MVP 简化：**

FSRS 完整模型包含难度参数 D（1-10），但研究表明 D 对准确率影响最小，S 和 R 才是核心。MVP 阶段固定 D=5（中等难度），后续可基于隐式信号推断：
- 用户主动提及 = Easy（D 降低）
- AI 检索命中但用户无反应 = Good（D 不变）
- AI 完全遗忘（搜索未命中）= Fail（D 升高）

### 1.2 字段关系图

```
reinforce_count ──→ S = S0 × (1 + a × n) ^ 0.5 ──┐
                                                    ├──→ R = (1 + F×t/S) ^ C
last_triggered_at + 当前时间 ──→ t（经过时间）──────┘
                                                    ↓
对话时 mood ──→ emotional_weight ────────────→ strength = R × emotionalWeight
                                                    ↓
                                        融入评分公式的 0.2 权重位
```

---

## 2. FSRS 记忆强度计算

### 2.1 核心公式：幂函数衰减

FSRS（Free Spaced Repetition Scheduler）的核心衰减公式：

```
R(t) = (1 + F × t / S) ^ C

其中：
  R = 可提取性（0-1），即记忆被回忆的概率
  t = 距上次强化的经过时间（小时）
  S = 稳定性（小时），即半衰期
  F = 19/81 ≈ 0.2346（FSRS 经验常数）
  C = -0.5（衰减指数）
```

**为什么用幂函数而非指数衰减？**

现有系统使用 `0.5^(age/168)` 指数衰减，衰减过于"平滑"——近期衰减太慢，远期衰减太快。FSRS 幂函数更符合人脑遗忘曲线：初期遗忘快，后期遗忘渐缓。

### 2.2 calcRetrievability：计算当前可提取性

```javascript
/**
 * 计算记忆的当前可提取性 R
 * @param {number} stability - 稳定性 S（小时）
 * @param {number} lastTriggeredAt - 上次强化时间戳（毫秒）
 * @param {number} now - 当前时间戳（毫秒），默认 Date.now()
 * @returns {number} R 值（0-1）
 */
function calcRetrievability(stability, lastTriggeredAt, now = Date.now()) {
  if (!lastTriggeredAt) {
    // 从未被强化过，使用 updated_at 作为基准
    return 1.0; // 新记忆默认满强度
  }

  const elapsedHours = (now - lastTriggeredAt) / (1000 * 60 * 60);
  if (elapsedHours <= 0) return 1.0;

  const F = 19 / 81;
  const C = -0.5;
  const R = Math.pow(1 + F * elapsedHours / stability, C);

  return Math.max(0.01, Math.min(1.0, R)); // 下限 0.01 防止完全消失
}
```

**衰减速度示例**（S=168小时/7天时）：

| 经过时间 | R 值 | 含义 |
|---------|------|------|
| 0 | 1.000 | 刚刚强化 |
| 1天 | 0.875 | 基本记得 |
| 3天 | 0.763 | 还能回忆 |
| 7天 | 0.618 | 开始模糊 |
| 14天 | 0.486 | 半数遗忘 |
| 30天 | 0.340 | 大部分遗忘 |
| 90天 | 0.196 | 几乎遗忘 |
| 180天 | 0.139 | 深度遗忘 |

### 2.3 reinforceMemory：强化记忆

```javascript
/**
 * 强化一条记忆（被纳入 AI 回复上下文 或 用户主动提及时调用）
 * 注意：只有"主动强化"才调用此函数，搜索命中但未纳入上下文只更新 access_count
 * @param {string} chunkId - memory_chunks 的 id
 * @param {number} currentMood - 当前心情（0-100）
 */
function reinforceMemory(chunkId, currentMood = 80) {
  const now = Date.now();

  // 1. 读取当前状态
  const chunk = db.prepare(`
    SELECT reinforce_count, last_triggered_at, stability, emotional_weight
    FROM memory_chunks WHERE id = ?
  `).get(chunkId);

  if (!chunk) return;

  // 2. 计算新的 reinforce_count
  const newReinforceCount = (chunk.reinforce_count || 0) + 1;

  // 3. 计算新的稳定性 S（幂律增长）
  const newS = calcNewStability(newReinforceCount);

  // 4. 更新情感权重（取历史最大值）
  const newEmotionalWeight = Math.max(
    chunk.emotional_weight || 1.0,
    calcEmotionalWeight(currentMood)
  );

  // 5. 计算新的 strength = 1.0（刚强化）× emotionalWeight
  // 归一化到 [0, 1]：除以最大情感权重 1.5
  const newStrength = Math.min(1.0, 1.0 * newEmotionalWeight / 1.5);

  // 6. 写入数据库
  db.prepare(`
    UPDATE memory_chunks SET
      reinforce_count = ?,
      last_triggered_at = ?,
      stability = ?,
      strength = ?,
      emotional_weight = ?,
      last_accessed_at = ?,
      access_count = access_count + 1
    WHERE id = ?
  `).run(newReinforceCount, now, newS, newStrength, newEmotionalWeight, now, chunkId);
}
```

### 2.4 calcNewStability：幂律稳定性增长

```javascript
/**
 * 计算基于强化次数的稳定性 S（幂律增长）
 *
 * 公式：S = S0 × (1 + a × n) ^ b
 *
 * 其中：
 *   S0 = 初始稳定性（168 小时 = 7 天）
 *   a  = 增长系数（1.0，控制增长速度）
 *   n  = reinforce_count（主动强化次数）
 *   b  = 0.5（平方根增长，天然边际递减）
 *
 * 设计原则：
 *   - 幂律增长自带饱和效应（b=0.5 = 平方根，边际递减）
 *   - 无需额外的饱和函数，公式更简洁
 *   - FSRS 研究表明 D 对准确率影响最小，固定 D=5
 *
 * @param {number} reinforceCount - 主动强化次数
 * @returns {number} 新的稳定性（小时）
 */
function calcNewStability(reinforceCount) {
  const S0 = 168;    // 初始稳定性：7天
  const a = 1.0;     // 增长系数
  const b = 0.5;     // 幂指数（平方根）

  // S = S0 × (1 + a × n) ^ b
  let newS = S0 * Math.pow(1 + a * reinforceCount, b);

  // 上限：1年 = 8760 小时
  newS = Math.min(newS, 8760);

  return newS;
}
```

**幂律 vs 旧方案对比：**

旧方案用乘法链（每次 ×2.2 带饱和衰减），需要额外的 saturation 和 difficultyBonus 函数。
新方案 `S = S0 × (1 + n)^0.5` 天然边际递减，一个公式搞定，更简洁且有理论支撑。

**稳定性增长轨迹（幂律 b=0.5）：**

| reinforce_count (n) | S = 168 × (1+n)^0.5 | 约等于 | 说明 |
|---------------------|---------------------|--------|------|
| 0 (初始) | 168h | 7天 | 新记忆 |
| 1 | 238h | 10天 | √2 ≈ 1.41× |
| 2 | 291h | 12天 | √3 ≈ 1.73× |
| 3 | 336h | 14天 | 2× |
| 5 | 411h | 17天 | 2.45× |
| 8 | 504h | 21天 | 3× |
| 15 | 672h | 28天 | 4× |
| 24 | 840h | 35天 | 5× |
| 48 | 1176h | 49天 | 7× |
| 99 | 1680h | 70天 | 10× |

**注意**：增长比旧方案更保守，但更符合学术研究结论。如需更快增长，可调整 a（如 a=2.0 让第 1 次强化就到 ~291h）。

---

## 3. 情感权重设计

### 3.1 初始化：新对话保存时

当用户发送消息时，mood 值从对话 metadata 中获取（0-100），计算公式：

```javascript
/**
 * 计算情感权重
 * @param {number} mood - 心情值（0-100），50 为中性
 * @returns {number} 情感权重（1.0 - 1.5）
 */
function calcEmotionalWeight(mood) {
  if (mood === undefined || mood === null) return 1.0;

  // 偏离中性越远，情感越强烈，记忆越深刻
  // mood=50 → weight=1.0（中性）
  // mood=0 或 mood=100 → weight=1.5（极端情绪）
  const deviation = Math.abs(mood - 50) / 50;
  return 1.0 + 0.5 * deviation;
}
```

**映射表：**

| mood | 情感状态 | emotional_weight |
|------|---------|-----------------|
| 0 | 极度悲伤 | 1.5 |
| 20 | 低落 | 1.3 |
| 40 | 略低 | 1.1 |
| 50 | 中性 | 1.0 |
| 60 | 略高 | 1.1 |
| 80 | 开心 | 1.3 |
| 100 | 极度开心 | 1.5 |

### 3.2 强化时更新策略

**取历史最大值**（而非覆盖）：

```javascript
const newEmotionalWeight = Math.max(
  chunk.emotional_weight,       // 历史最大情感强度
  calcEmotionalWeight(currentMood)  // 当前强化时的情感强度
);
```

**理由**：一段记忆的"情感印记"应保留其最强烈的情感时刻。例如用户在心情低落时说"我妈妈住院了"，即使后来心情好转再次提及，这段记忆的情感权重仍应保持 1.3+。

### 3.3 极端情绪场景处理

**mood=0（极度悲伤）或 mood=100（极度开心）：**

- emotional_weight = 1.5，记忆保留能力比中性记忆强 50%
- 在评分公式中作为乘数生效，等效于将该记忆的搜索分数提升 50%
- 配合 stability 系统，极端情绪下的初始 stability 也应增加：

```javascript
// 在 addConversation 保存 chunk 时
const emotionalWeight = calcEmotionalWeight(metadata.mood);
const initialStability = 168 * emotionalWeight;
// mood=100 时 initialStability = 252h (10.5天)
// mood=50 时 initialStability = 168h (7天)
```

---

## 4. 新评分公式

### 4.1 方案选择：strength 替代 temporal（而非并列）

**将现有公式中的 `temporal`（时间衰减）分量替换为 `strength`（综合记忆强度）。**

```
旧公式：0.3×关键词 + 0.4×向量 + 0.2×时间衰减 + 0.1×重要性
新公式：0.3×关键词 + 0.4×向量 + 0.2×strength  + 0.1×重要性
```

**为什么替代而非并列？**

strength 已经内含了三层信息：
1. **时间衰减**：R 随时间按 FSRS 幂函数下降
2. **强化效果**：reinforce_count 驱动 S 增长，S 越大衰减越慢
3. **情感权重**：emotional_weight 作为乘数融入

如果保留原 temporal 分量再乘以 strength，时间因素会被双重计算（temporal 和 R 都是时间的函数）。直接替代最干净。

### 4.2 最终评分公式

```javascript
// strength 实时计算（惰性求值）
const R = calcRetrievability(chunk.stability, chunk.last_triggered_at);
const emotionalW = chunk.emotional_weight || 1.0;
// strength = R × emotionalWeight，归一化到 [0, 1]
const strengthScore = Math.min(1.0, R * emotionalW);

// 新评分公式：strength 替代 temporal
const finalScore = hasVector
  ? 0.3 * keywordScore + 0.4 * vectorScore + 0.2 * strengthScore + 0.1 * importanceScore
  : 0.5 * keywordScore + 0.3 * strengthScore + 0.2 * importanceScore;
```

**无向量回退公式也同步更新**：原来的 `0.3 * temporalScore` 改为 `0.3 * strengthScore`，因为向量不可用时 strength 的权重应更高。

### 4.3 strength 各分量的贡献

| 场景 | R | emotionalWeight | strengthScore | 说明 |
|------|---|----------------|---------------|------|
| 刚说的（中性心情） | 1.0 | 1.0 | 1.0 | 最新记忆，满分 |
| 刚说的（极端心情） | 1.0 | 1.5 | 1.0 | 上限截断 |
| 3天前（中性，未强化） | 0.76 | 1.0 | 0.76 | 开始衰减 |
| 7天前（开心，强化1次） | 0.79* | 1.3 | 1.0 | 强化延缓衰减+情感加权 |
| 30天前（中性，未强化） | 0.34 | 1.0 | 0.34 | 明显衰减 |
| 90天前（悲伤，未强化） | 0.20 | 1.5 | 0.30 | 情感权重部分补偿衰减 |
| 180天前（中性，未强化） | 0.14 | 1.0 | 0.14 | 接近休眠 |

*注：强化 1 次后 S 从 168h 增长到 238h，7天后 R 更高

### 4.4 软删除过滤规则

```javascript
// 在搜索过滤阶段（search.js:199-202）
// strengthScore 已在评分中占 0.2 权重，额外需要硬阈值过滤休眠记忆
let filteredResults = mergedResults
  .filter(r => {
    // 现有过滤
    if (r.score < minScore) return false;

    // 新增：休眠记忆过滤（R 值过低 → 不参与搜索）
    const R = calcRetrievability(r.stability, r.lastTriggeredAt);
    if (R < 0.1) return false;  // R < 10% → 休眠

    return true;
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);
```

### 4.4 硬删除规则（后台清理）

```javascript
// 可选的后台清理任务（不在搜索热路径中）
function cleanupDormantMemories() {
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;

  // R < 0.01 且超过 180 天未被强化 → 可以硬删除
  // 但保留 emotional_weight >= 1.3 的记忆（重要情感记忆永不删除）
  db.prepare(`
    DELETE FROM memory_chunks
    WHERE strength < 0.01
      AND last_triggered_at < ?
      AND emotional_weight < 1.3
  `).run(sixMonthsAgo);
}
```

---

## 5. 强化触发时机

### 5.1 两类访问行为

| 行为 | 字段 | 触发位置 | 驱动 S 增长？ |
|------|------|---------|-------------|
| **被动访问** | `access_count++` | `search()` 返回候选结果时 | 否 |
| **主动强化** | `reinforce_count++` | `getContext()` 纳入 AI 回复上下文时 | **是** |

关键区别：搜索命中 10 次但从未被 AI 使用 ≠ 记忆被强化。只有真正影响了对话的记忆才算强化。

### 5.2 实现方案

**两个入口，职责分离：**

```javascript
// ============ 入口1：search.js 中更新 access_count（被动） ============
// 在 search() 返回结果前，批量更新 access_count
_updateAccessCounts(resultIds) {
  if (!resultIds || resultIds.length === 0) return;
  const now = Date.now();
  const stmt = this.storage.db.prepare(`
    UPDATE memory_chunks SET
      access_count = access_count + 1,
      last_accessed_at = ?
    WHERE conversation_id = ?
  `);
  for (const id of resultIds) {
    stmt.run(now, id);
  }
}

// ============ 入口2：memory.js 的 getContext() 中强化（主动） ============
async getContext(query, options = {}) {
  // ... 现有搜索逻辑 ...
  const searchResults = await this.searchEngine.search(query, { ... });

  // 新增：强化被纳入上下文的记忆（主动强化）
  this._reinforceHitMemories(searchResults, options.mood);

  // 构建上下文（不变）
  const context = await this.contextBuilder.build(searchResults, { ... });
  return context;
}

/**
 * 批量强化被纳入上下文的记忆
 * 只在 getContext 中调用（主动强化），搜索命中不触发
 */
_reinforceHitMemories(searchResults, currentMood = 80) {
  if (!searchResults || searchResults.length === 0) return;

  const now = Date.now();

  for (const result of searchResults) {
    const chunk = this.storage.db.prepare(`
      SELECT id, reinforce_count, last_triggered_at, stability, emotional_weight
      FROM memory_chunks
      WHERE conversation_id = ? LIMIT 1
    `).get(result.conversationId);

    if (!chunk) continue;

    // 防抖：同一条记忆 1 小时内只强化一次
    if (chunk.last_triggered_at && (now - chunk.last_triggered_at) < 3600000) {
      continue;
    }

    // 计算新值
    const newReinforceCount = (chunk.reinforce_count || 0) + 1;
    const newS = calcNewStability(newReinforceCount);
    const newEW = Math.max(chunk.emotional_weight || 1.0, calcEmotionalWeight(currentMood));
    const newStrength = Math.min(1.0, 1.0 * newEW / 1.5);

    this.storage.db.prepare(`
      UPDATE memory_chunks SET
        reinforce_count = ?,
        last_triggered_at = ?,
        stability = ?,
        strength = ?,
        emotional_weight = ?,
        last_accessed_at = ?,
        access_count = access_count + 1
      WHERE id = ?
    `).run(newReinforceCount, now, newS, newStrength, newEW, now, chunk.id);
  }
}
```

### 5.3 防重复触发策略

| 策略 | 实现 | 说明 |
|------|------|------|
| **时间防抖** | 1小时冷却期 | 同一条记忆 1 小时内最多强化 1 次 |
| **职责分离** | search → access_count，getContext → reinforce_count | 搜索命中不膨胀 S |
| **异步执行** | 强化不阻塞搜索返回 | 可改为 `setTimeout(() => this._reinforceHitMemories(...), 0)` |

---

## 6. 数据库迁移策略

### 6.1 迁移版本：v7

当前最新版本为 v6（任务管理系统）。新增迁移为 v7。

```javascript
// migrate.js 新增

async migrateToV7() {
  console.log('[Migrate] Migrating to v7: FSRS memory strength system...');
  try {
    // 1. memory_chunks 新增字段
    const chunksCols = this.storage.db.pragma('table_info(memory_chunks)');
    const colNames = chunksCols.map(c => c.name);

    if (!colNames.includes('reinforce_count')) {
      this.storage.db.exec(
        'ALTER TABLE memory_chunks ADD COLUMN reinforce_count INTEGER DEFAULT 0'
      );
    }
    if (!colNames.includes('last_triggered_at')) {
      this.storage.db.exec(
        'ALTER TABLE memory_chunks ADD COLUMN last_triggered_at INTEGER'
      );
    }
    if (!colNames.includes('stability')) {
      this.storage.db.exec(
        'ALTER TABLE memory_chunks ADD COLUMN stability REAL DEFAULT 168.0'
      );
    }
    // strength 已存在概念（importance_score），但含义不同
    // 新增独立的 strength 字段
    if (!colNames.includes('strength')) {
      this.storage.db.exec(
        'ALTER TABLE memory_chunks ADD COLUMN strength REAL DEFAULT 1.0'
      );
    }
    if (!colNames.includes('emotional_weight')) {
      this.storage.db.exec(
        'ALTER TABLE memory_chunks ADD COLUMN emotional_weight REAL DEFAULT 1.0'
      );
    }

    // 2. 新增索引
    this.storage.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_strength
        ON memory_chunks(strength DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_stability
        ON memory_chunks(stability DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_last_triggered
        ON memory_chunks(last_triggered_at DESC);
    `);

    // 3. 修复 memory_facts 的 CHECK 约束（添加 'personal' 类型）
    // SQLite 不支持直接 ALTER CHECK 约束，需要重建表
    const factsExists = this.storage.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memory_facts'
    `).get();

    if (factsExists) {
      // 检查现有约束是否已包含 personal
      const createSql = this.storage.db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_facts'
      `).get();

      if (createSql && !createSql.sql.includes("'personal'")) {
        // 备份 → 重建 → 恢复
        const existingData = this.storage.db.prepare('SELECT * FROM memory_facts').all();
        this.storage.db.exec('DROP TABLE memory_facts');
        this.storage.db.exec(`
          CREATE TABLE memory_facts (
            id TEXT PRIMARY KEY,
            fact_type TEXT NOT NULL CHECK(fact_type IN ('personal', 'preference', 'event', 'relationship', 'routine')),
            subject TEXT,
            predicate TEXT NOT NULL,
            object TEXT,
            confidence REAL DEFAULT 1.0 CHECK(confidence >= 0 AND confidence <= 1),
            source_conversation_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_confirmed_at INTEGER,
            source_text TEXT,
            FOREIGN KEY (source_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
          )
        `);
        // 重建索引
        this.storage.db.exec(`
          CREATE INDEX idx_memory_facts_type ON memory_facts(fact_type);
          CREATE INDEX idx_memory_facts_subject ON memory_facts(subject);
          CREATE INDEX idx_memory_facts_confidence ON memory_facts(confidence);
        `);
        // 恢复数据
        const insertStmt = this.storage.db.prepare(`
          INSERT INTO memory_facts (id, fact_type, subject, predicate, object, confidence,
            source_conversation_id, created_at, updated_at, last_confirmed_at, source_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of existingData) {
          try {
            insertStmt.run(
              row.id, row.fact_type, row.subject, row.predicate, row.object,
              row.confidence, row.source_conversation_id, row.created_at,
              row.updated_at, row.last_confirmed_at, row.source_text
            );
          } catch (e) {
            console.warn('[Migrate] Skip fact:', e.message);
          }
        }
        console.log(`[Migrate] Rebuilt memory_facts with 'personal' type, restored ${existingData.length} rows`);
      }
    }

    // 4. 历史数据初始化
    this._initHistoryStrength();

    // 5. 为向量搜索添加部分索引
    this.storage.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding_exists
        ON memory_chunks(updated_at DESC)
        WHERE embedding IS NOT NULL;
    `);

    console.log('[Migrate] ✓ Migration to v7 complete');
  } catch (error) {
    console.error('[Migrate] ✗ Migration to v7 failed:', error);
    throw error;
  }
}

/**
 * 历史数据 strength 初始化策略
 *
 * 方案：用 access_count 保守估算 reinforce_count
 * - reinforce_count = max(0, floor(access_count / 3))
 *   （假设每 3 次搜索命中有 1 次实际被纳入上下文）
 * - stability 通过幂律公式计算：S = 168 × (1 + reinforce_count)^0.5
 * - strength 通过 FSRS 公式从 updated_at 计算
 */
_initHistoryStrength() {
  const now = Date.now();
  const F = 19 / 81;
  const C = -0.5;
  const S0 = 168;

  // 批量读取所有 chunk
  const chunks = this.storage.db.prepare(`
    SELECT id, updated_at, access_count, importance_score
    FROM memory_chunks
    WHERE strength IS NULL OR stability IS NULL
  `).all();

  if (chunks.length === 0) return;

  const updateStmt = this.storage.db.prepare(`
    UPDATE memory_chunks SET
      stability = ?, strength = ?, emotional_weight = ?,
      reinforce_count = ?, last_triggered_at = ?
    WHERE id = ?
  `);

  const batch = this.storage.db.transaction((items) => {
    for (const chunk of items) {
      // 保守估算 reinforce_count：每 3 次 access 算 1 次真正强化
      const accessCount = chunk.access_count || 1;
      const estimatedReinforce = Math.max(0, Math.floor(accessCount / 3));

      // 幂律计算 stability
      const estimatedS = S0 * Math.pow(1 + estimatedReinforce, 0.5);

      // 计算当前 R
      const elapsedHours = (now - (chunk.updated_at || now)) / (1000 * 60 * 60);
      const R = Math.max(0.01, Math.pow(1 + F * elapsedHours / estimatedS, C));

      // 情感权重：旧数据统一设为 1.0
      const emotionalWeight = 1.0;
      const strength = Math.min(1.0, R * emotionalWeight);

      updateStmt.run(
        estimatedS, strength, emotionalWeight,
        estimatedReinforce, chunk.updated_at || now,
        chunk.id
      );
    }
  });

  batch(chunks);
  console.log(`[Migrate] Initialized strength for ${chunks.length} memory chunks`);
}
```

### 6.2 database.js 的 runMigrations 也需新增列检查

```javascript
// database.js:runMigrations() 新增（作为安全网）
if (!chunksCols.includes('reinforce_count')) {
  this.db.exec('ALTER TABLE memory_chunks ADD COLUMN reinforce_count INTEGER DEFAULT 0');
}
if (!chunksCols.includes('last_triggered_at')) {
  this.db.exec('ALTER TABLE memory_chunks ADD COLUMN last_triggered_at INTEGER');
}
if (!chunksCols.includes('stability')) {
  this.db.exec('ALTER TABLE memory_chunks ADD COLUMN stability REAL DEFAULT 168.0');
}
if (!chunksCols.includes('strength')) {
  this.db.exec('ALTER TABLE memory_chunks ADD COLUMN strength REAL DEFAULT 1.0');
}
if (!chunksCols.includes('emotional_weight')) {
  this.db.exec('ALTER TABLE memory_chunks ADD COLUMN emotional_weight REAL DEFAULT 1.0');
}
```

### 6.3 runMigrations 入口更新

```javascript
// migrate.js:runMigrations()
async runMigrations(currentVersion) {
  // ... 现有 v1-v6 ...
  if (currentVersion < 7) {
    await this.migrateToV7();
  }
}

const LATEST_VERSION = 7;
```

---

## 7. 实施风险与边界情况

### 7.1 "一次性重要事件"问题

**问题**：用户说"我妈妈去世了"只说一次，trigger_count=0，按 FSRS 公式 stability=168h，90天后 R≈0.20，180天后 R≈0.14，很快跌破 0.1 阈值进入休眠。

**解决方案（多重保护）**：

1. **情感权重保护**：极端情绪（mood接近0或100）时 emotional_weight=1.5，初始 stability 也提升至 252h
2. **硬删除豁免**：emotional_weight >= 1.3 的记忆永不被硬删除
3. **事实提取保护**：重要事件会被 LLM 事实提取器提取为 memory_facts（类型=event），事实表没有衰减机制，永久保留
4. **用户画像兜底**：核心个人信息（如家庭成员去世）会进入 user_profile 表，始终加载

**综合效果**：即使 memory_chunks 中的原始对话记录衰减到休眠，memory_facts 和 user_profile 中的结构化信息仍会被三层记忆架构的 Layer1（用户画像）和 Layer2（重要记忆）检索到。

### 7.2 难度系数 D 的 MVP 简化（替代 SM-2 的 EF 因子）

**FSRS 完整模型**包含难度参数 D（1-10），但学术研究表明 **D 对准确率影响最小**，S（稳定性）和 R（可提取性）才是核心。

**MVP 策略：固定 D=5（中等难度）**

理由：
- FSRS 论文实验显示，D 的准确率贡献不到 5%
- 桌面宠物场景没有用户主动评分（SM-2 的 1-5 分）
- 简化实现，减少参数调优负担

**后续演进方向**（非 MVP 范围）：

| 隐式信号 | 对应 FSRS 评级 | D 调整 |
|---------|--------------|--------|
| 用户主动提及（"还记得...吗"） | Easy | D -= 1 |
| AI 检索命中，用户无反应 | Good | D 不变 |
| AI 完全遗忘（搜索未命中用户追问的内容） | Fail | D += 1 |

当前幂律增长公式 `S = S0 × (1+n)^0.5` 中 S0=168 对应 D=5 的默认值。如果后续引入 D，可以让 S0 随 D 变化：`S0 = 168 × (11-D)/6`，D=5 时 S0=168，D=1 时 S0=280。

### 7.3 性能影响评估

| 操作 | 额外开销 | 缓解措施 |
|------|---------|---------|
| 搜索时计算 R | 每条结果 1 次幂运算 | O(1) 运算，可忽略 |
| 强化写入 | 每次 getContext 写 N 条 | 防抖 1 小时 + 批量事务 |
| 历史迁移 | 一次性全表更新 | 事务批量处理 |
| strength 批量刷新 | 定期后台任务 | 可选，用惰性计算替代 |

### 7.4 与现有系统的兼容性

| 现有模块 | 影响 | 兼容策略 |
|---------|------|---------|
| search.js | temporal 分量替换为 strength | 权重不变（0.2），语义从"时间"变为"记忆强度" |
| memory-layer.js | _calculateImportance 需适配 | 读取新字段，缺省值兜底 |
| memory.js | addConversation 初始化新字段 + getContext 调用强化 | 新增参数有默认值 |
| fact-extractor.js | 不受影响 | 无需修改 |
| context.js | 不受影响 | 无需修改 |
| config.js | 新增 FSRS 配置节 | 新增配置不影响旧功能 |

### 7.5 config.js 新增配置

```javascript
// 记忆强度系统（FSRS）
memoryStrength: {
  enabled: true,
  // FSRS 参数
  fsrs: {
    F: 19 / 81,           // 衰减因子
    C: -0.5,              // 衰减指数
    D: 5,                 // 难度系数（MVP 固定值，1-10）
    initialStability: 168, // 初始稳定性（小时）= 7天，对应 D=5
    maxStability: 8760,    // 最大稳定性（小时）= 1年
    growthCoeff: 1.0,      // 幂律增长系数 a
    growthExponent: 0.5    // 幂律增长指数 b（平方根）
  },
  // 强化控制
  reinforcement: {
    cooldownMs: 3600000,   // 同一记忆强化冷却时间（1小时）
    maxDailyReinforcements: 50  // 每日最大强化次数（防滥用）
  },
  // 休眠阈值
  dormant: {
    softThreshold: 0.1,    // R < 0.1 → 不参与搜索
    hardThreshold: 0.01,   // R < 0.01 + 180天 → 可硬删除
    hardDeleteDays: 180,   // 硬删除等待天数
    protectedEmotionalWeight: 1.3  // 高情感记忆豁免硬删除
  },
  // 情感权重
  emotional: {
    maxWeight: 1.5,        // 最大情感权重
    neutralMood: 50,       // 中性心情值
    deviationScale: 0.5    // 偏差缩放因子
  }
}
```

---

## 8. 实施文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `main-process/config.js` | 新增 | 添加 `memoryStrength` 配置节 |
| `main-process/strength.js` | **新建** | FSRS 核心计算函数（calcRetrievability、calcNewStability、calcEmotionalWeight、reinforceMemory） |
| `main-process/migrate.js` | 修改 | 新增 migrateToV7()，LATEST_VERSION = 7 |
| `main-process/database.js` | 修改 | runMigrations() 新增 5 个列检查 |
| `main-process/schema.sql` | 修改 | memory_chunks 表新增 4 个字段（reinforce_count、last_triggered_at、stability、strength、emotional_weight）+ 索引 |
| `main-process/memory.js` | 修改 | addConversation() 初始化新字段；getContext() 调用 _reinforceHitMemories()（主动强化） |
| `main-process/search.js` | 修改 | temporal 替换为 strength；_updateAccessCounts()（被动）；过滤休眠记忆 |
| `main-process/memory-layer.js` | 修改 | _calculateImportance() 中应用 strength |

---

## 9. 设计决策总结

| 决策点 | 选择 | 理由 |
|-------|------|------|
| 衰减公式 | FSRS 幂函数 R=(1+Ft/S)^C | 比指数衰减更符合人脑遗忘曲线 |
| S 增长公式 | 幂律 S=S0×(1+an)^0.5 | 天然边际递减，一个公式搞定，有学术支撑 |
| 难度系数 D | MVP 固定 D=5 | FSRS 研究表明 D 对准确率影响最小 |
| 评分集成 | **strength 替代 temporal** | strength 已内含时间衰减+强化+情感，避免双重计算 |
| 访问分离 | access_count（被动）vs reinforce_count（主动） | 只有主动强化驱动 S 增长 |
| strength 含义 | R × emotionalWeight 的综合分 | 融合三层信息，直接占评分公式 0.2 权重 |
| 情感权重更新 | 取历史最大值 | 保留最强烈的情感印记 |
| 强化入口 | 仅 getContext（主动） | searchMemories 只更新 access_count |
| 防抖 | 1 小时冷却 | 平衡精度和性能 |
| 迁移版本 | v7 | 当前最新为 v6 |
| 历史初始化 | access_count/3 推算 reinforce_count | 保守估算，每 3 次访问约 1 次真正强化 |
| 重要事件保护 | 情感权重 + 事实表 + 画像表 | 三重兜底，确保不丢失 |
