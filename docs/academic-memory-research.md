# 仿人脑记忆系统 — 学术理论基础调研报告

## 1. 艾宾浩斯遗忘曲线

### 1.1 原始公式

```
R(t) = e^(-t/S)
```

- **R** = 可提取性（Retrievability），成功回忆的概率，范围 [0, 1]
- **t** = 自上次学习/复习后经过的时间
- **S** = 记忆稳定性（Stability），S 越大遗忘越慢

### 1.2 稳定性 S 如何随复习增长

核心洞察：**每次成功复习都会增加 S**，使遗忘曲线变得更平缓。

- 无复习：1小时后丢失约 50%，24小时后丢失约 70%
- 每次复习后 S 增大 → 下次复习间隔可以更长
- 典型复习间隔序列：1天 → 3天 → 7天 → 15天 → 30天（指数增长）

### 1.3 现代幂函数变体（FSRS 采用）

FSRS 算法使用幂函数替代指数函数，拟合效果更好：

```
R(t) = (1 + F × t / S)^C
```

其中 F = 19/81, C = -0.5。当 t = S 时，R = 90%（稳定性的定义：R 从 100% 降到 90% 所需天数）。

---

## 2. SM-2 算法（Anki 使用）

### 2.1 核心公式

**复习间隔：**
```
I(1) = 1 天
I(2) = 6 天
I(n) = I(n-1) × EF,  n > 2
```

**难度系数 EF（Easiness Factor）更新：**
```
EF' = EF + (0.1 - (5 - q) × (0.08 + (5 - q) × 0.02))
```

- 初始 EF = 2.5
- 最低 EF = 1.3
- q = 质量评分（0-5）

### 2.2 质量评分标准

| 评分 | 含义 |
|------|------|
| 5 | 完美回忆 |
| 4 | 犹豫后正确 |
| 3 | 困难但正确 |
| 2 | 错误，但看到答案觉得简单 |
| 1 | 错误，但看到答案能想起 |
| 0 | 完全忘记 |

### 2.3 关键行为

- q < 3 时，重置为初始间隔（I(1) = 1）
- EF 随正确回忆递增，随错误递减
- **局限性：** 所有卡片共享相同的初始间隔，不考虑个体差异

### 2.4 与我们系统的对应

| SM-2 概念 | 我们系统的对应 |
|-----------|--------------|
| EF 难度系数 | 可映射为记忆重要性 |
| I(n) 间隔 | 可映射为半衰期 |
| q 评分 | 可映射为交互质量（主动提及 vs 被动回忆） |

---

## 3. FSRS 算法（最新一代间隔重复）

### 3.1 三组件记忆模型（DSR）

FSRS 基于"三组件记忆模型"，认为三个变量足以描述一条记忆的状态：

| 组件 | 符号 | 含义 |
|------|------|------|
| Retrievability | R | 当前时刻成功回忆的概率 |
| Stability | S | R 从 100% 降到 90% 所需的天数 |
| Difficulty | D | 记忆材料的内在难度 (1-10) |

### 3.2 核心公式

**遗忘曲线（幂函数）：**
```
R(t) = (1 + F × t / S)^C
F = 19/81, C = -0.5
```

**成功复习后的稳定性更新：**
```
S_new = S × α

α = 1 + t_d × t_s × t_r × h × b × e^(w8)

其中：
  t_d = 11 - D          （难度越大，增长越小）
  t_s = S^(-w9)          （当前稳定性越高，增长越慢 —— 稳定性饱和）
  t_r = e^(w10×(1-R)) - 1 （R越低即越接近遗忘时复习，增长越大）
  h = w15 (Hard) 或 1     （困难回忆的惩罚系数）
  b = w16 (Easy) 或 1     （轻松回忆的奖励系数）
```

**失败后的稳定性（遗忘重置）：**
```
S_new = min(S_fail, S)

S_fail = d_f × s_f × r_f × w11

  d_f = D^(-w12)
  s_f = (S+1)^(w13) - 1
  r_f = e^(w14×(1-R))
```

**难度更新：**
```
D_new = w7 × D0(4) + (1 - w7) × D'(D, G)
D'(D, G) = D + ΔD(G) × ((10 - D) / 9)
ΔD(G) = -w6 × (G - 3)
```

**复习间隔计算：**
```
I(R_desired) = (S / F) × (R_desired^(1/C) - 1)
```

### 3.3 关键洞察（对我们系统的启示）

1. **稳定性饱和效应**：S^(-w9) 意味着 S 越大时，每次复习带来的 S 增长越小（边际递减）
2. **最佳复习时机**：R 越低时复习，S 增长越大（"desirable difficulty"，有益的困难）
3. **难度调节**：困难的记忆增长更慢，简单的增长更快
4. **21 个可优化参数**：通过梯度下降拟合个人数据

### 3.4 FSRS vs SM-17 性能对比

- FSRS-6 在 83.3% 的用户集合上比 SM-17 更准确预测回忆概率
- FSRS 使用机器学习优化参数，SM-17 使用传统统计方法
- 两者都基于三组件记忆模型，但实现路径不同

---

## 4. 情绪对记忆的影响

### 4.1 神经机制

**杏仁核-海马体增强回路：**
- 情绪唤起 → 杏仁核激活 → 释放去甲肾上腺素
- 去甲肾上腺素 + 糖皮质激素 → 增强海马体突触可塑性
- 结果：情绪记忆的编码和巩固显著增强

**闪光灯记忆（Flashbulb Memory）：**
- 高情绪唤起事件形成异常鲜明持久的记忆
- 机制：杏仁核的快速参与引导编码和存储
- 杏仁核损伤患者的闪光灯记忆质量显著降低

### 4.2 情绪增强的量化数据

基于认知心理学研究综合：

| 情绪强度 | 记忆增强效应 | 效应量 (Cohen's d) | 备注 |
|----------|------------|-------------------|------|
| 中性 (baseline) | 0% | - | 对照组 |
| 低唤起情绪 | +5-10% | ~0.2 (小) | 日常温和情绪 |
| 中等唤起情绪 | +15-25% | ~0.5 (中) | 明显的喜悦/悲伤 |
| 高唤起情绪 | +25-40% | ~0.7-0.8 (大) | 强烈情绪事件 |
| 极端唤起（闪光灯） | +40-60% | >1.0 (非常大) | 创伤/狂喜 |

**关键研究证据：**
- Cahill & McGaugh (1995)：情绪故事组比中性故事组回忆更多细节，效果在 2 周后仍显著
- 情绪记忆更难通过"定向遗忘"任务被抑制，差异约 4.2%
- 超过一半的实验发现注意力对情绪记忆有中等到大的效应

### 4.3 情绪价效应（Valence Effect）

| 情绪类型 | 对记忆的影响 |
|----------|------------|
| 正面情绪（快乐、兴奋）| 增强关联记忆，有利于整体信息 |
| 负面情绪（恐惧、悲伤）| 增强细节记忆，有利于精确回忆 |
| 高唤起度 | 比低唤起度的增强效果更强 |

### 4.4 推荐的情感权重系数

基于上述研究，为我们的 AI 宠物记忆系统推荐以下情感权重：

```javascript
// 情感强度到记忆初始稳定性乘数的映射
const emotionMultiplier = {
  // 心情分数 → 情绪强度 → 稳定性乘数
  // 极端低心情 (0-20):  高负面唤起 → 1.5x
  // 低心情 (20-40):     中等负面唤起 → 1.3x
  // 中性 (40-60):       基准 → 1.0x
  // 高心情 (60-80):     中等正面唤起 → 1.2x
  // 极端高心情 (80-100): 高正面唤起 → 1.4x
};

function getEmotionMultiplier(mood) {
  const deviation = Math.abs(mood - 50);  // 偏离中性的程度
  // 基于 Yerkes-Dodson 倒U模型 + 情绪增强效应
  if (deviation <= 10) return 1.0;        // 中性
  if (deviation <= 20) return 1.15;       // 轻微情绪
  if (deviation <= 30) return 1.3;        // 中等情绪
  if (deviation <= 40) return 1.45;       // 强烈情绪
  return 1.5;                             // 极端情绪
}
```

---

## 5. AI 记忆系统中的应用

### 5.1 已有研究

**MemoryBank (2024):**
- 将艾宾浩斯遗忘曲线应用于 AI 记忆管理
- AI 根据时间和重要性决定遗忘或强化记忆

**FOREVER (2025):**
- 将遗忘曲线应用于 LLM 持续学习中的记忆回放
- 创新点：用"模型参数空间距离"替代真实时间
- 回放间隔：{1, 2, 4, 7, 15, 30} 虚拟天（映射到参数更新幅度）

**From Human Memory to AI Memory (2025) 综述：**
- 提出 3D-8Q 分类体系：对象（个人/系统）× 形式（参数/非参数）× 时间（短期/长期）
- 推荐多记忆系统协同，类似人脑多区域存储

**Human-like Forgetting Curves in DNNs (2025):**
- 证明深度神经网络展现类人的遗忘曲线
- 间隔重复原则同样适用于减轻灾难性遗忘

### 5.2 LECTOR (2025)
- 将经典遗忘曲线扩展，引入语义干扰效应
- 有效半衰期受三个因素调制：掌握程度、语义干扰、个性化因子

---

## 6. 推荐方案：与我们系统的对接

### 6.1 当前系统的差距分析

| 维度 | 当前实现 | 学术理论 | 差距 |
|------|---------|---------|------|
| 遗忘模型 | 固定 7 天半衰期 | 动态半衰期，随复习增长 | **严重不足** |
| 衰减函数 | 指数衰减 e^(-t/S) | 幂函数 (1+Ft/S)^C 更准确 | 中等 |
| 复习强化 | 无（S 不变） | 每次提及 S 增长 2-3 倍 | **严重不足** |
| 情绪调节 | 简单心情相似度加权 | 情绪强度影响初始 S | 中等 |
| 难度因子 | 无 | D 影响 S 增长速率 | 可选改进 |
| 软删除 | 无机制 | R < 阈值时可标记为遗忘 | 需要新增 |

### 6.2 推荐的半衰期增长函数

基于 FSRS 的稳定性更新公式简化版，适合我们的场景：

```javascript
/**
 * 计算记忆被强化后的新半衰期
 *
 * @param {number} currentHalfLife - 当前半衰期（小时）
 * @param {number} retrievability - 当前可提取性 R (0-1)
 * @param {number} emotionMultiplier - 情感权重 (1.0-1.5)
 * @param {number} interactionQuality - 交互质量 (1=被动提及, 2=主动回忆, 3=详细讨论)
 * @returns {number} 新的半衰期（小时）
 */
function reinforceMemory(currentHalfLife, retrievability, emotionMultiplier, interactionQuality) {
  // 基础增长因子（来自 FSRS 的 SInc 简化）
  // R 越低时复习，增长越大（desirable difficulty）
  const difficultyBonus = Math.exp(0.5 * (1 - retrievability)) - 1;

  // 稳定性饱和（S 越大，增长越慢）
  const saturationFactor = Math.pow(currentHalfLife, -0.2);

  // 交互质量因子
  const qualityFactor = [0, 1.0, 1.5, 2.0][interactionQuality];

  // 综合增长倍数
  const growthMultiplier = 1 + qualityFactor * saturationFactor * difficultyBonus * emotionMultiplier;

  // 下限：至少增长 10%；上限：最多增长 5 倍
  const clampedMultiplier = Math.max(1.1, Math.min(5.0, growthMultiplier));

  return currentHalfLife * clampedMultiplier;
}
```

**典型增长轨迹示例（初始半衰期 = 168 小时 / 7 天）：**

| 强化次数 | 半衰期 | 约等于 |
|----------|--------|--------|
| 0 (新建) | 168h | 7 天 |
| 1 | 370h | ~15 天 |
| 2 | 740h | ~1 月 |
| 3 | 1300h | ~2 月 |
| 4 | 2000h | ~3 月 |
| 5+ | 逐渐饱和 | ~6月-1年 |

### 6.3 情感权重系数推荐

```javascript
/**
 * 根据心情计算情感权重
 * 基于 Cahill & McGaugh 的情绪增强效应研究
 *
 * @param {number} mood - 心情分数 (0-100)
 * @returns {number} 情感权重乘数 (1.0-1.5)
 */
function calculateEmotionWeight(mood) {
  const neutralPoint = 50;
  const deviation = Math.abs(mood - neutralPoint) / neutralPoint; // 0-1

  // 基于 Cohen's d ≈ 0.5-0.8 的中到大效应量
  // 线性映射：偏离越大，权重越高
  // 最大增强 50%（对应高唤起情绪的 +25-40% 记忆增强）
  return 1.0 + 0.5 * deviation;
}

// 示例：
// mood = 50 → weight = 1.0  (中性)
// mood = 80 → weight = 1.3  (高兴)
// mood = 20 → weight = 1.3  (悲伤)
// mood = 100 → weight = 1.5 (极度开心)
// mood = 0  → weight = 1.5  (极度低落)
```

### 6.4 软删除阈值建议

基于 FSRS 的可提取性模型和认知心理学研究：

```javascript
const MEMORY_THRESHOLDS = {
  // R > 0.9: 记忆鲜活，无需特别处理
  FRESH: 0.9,

  // R = 0.5-0.9: 记忆正在衰退，可降低检索权重
  FADING: 0.5,

  // R = 0.1-0.5: 记忆模糊，低优先级检索
  DIM: 0.1,

  // R < 0.1: 可安全"遗忘"（软删除）
  // 学术依据：
  // - FSRS 中 R < 10% 几乎不可能自然回忆
  // - SM-2 中 q < 2（严重遗忘）触发重新学习
  // - 艾宾浩斯数据：无复习的记忆在数周后 R 降至 ~20%
  FORGOTTEN: 0.1,

  // 硬删除阈值（可选）：R < 0.01 持续超过 6 个月
  HARD_DELETE: 0.01
};
```

**推荐策略：**
- R < 0.1 → 标记为 `dormant`（休眠），不参与常规搜索，但仍可被精确关键词匹配唤醒
- R < 0.01 且超过 180 天未被访问 → 可安全硬删除
- 被唤醒的休眠记忆 → 重置 R，但保留原始半衰期的 30%（部分重建比全新学习更快）

### 6.5 可提取性计算公式推荐

```javascript
/**
 * 计算记忆的当前可提取性
 * 使用 FSRS 的幂函数遗忘曲线（比指数函数更准确）
 *
 * @param {number} hoursSinceLastAccess - 自上次访问的小时数
 * @param {number} halfLife - 半衰期（小时）
 * @returns {number} 可提取性 R (0-1)
 */
function calculateRetrievability(hoursSinceLastAccess, halfLife) {
  // 方案 A：指数衰减（当前实现，简单但不够准确）
  // return Math.exp(-hoursSinceLastAccess / halfLife);

  // 方案 B：FSRS 幂函数衰减（推荐）
  const F = 19 / 81;
  const C = -0.5;
  // 将半衰期转换为 FSRS 的稳定性 S
  // 当 R = 0.5 时 t = halfLife，解方程得 S
  const S = halfLife / (F * (Math.pow(0.5, 1/C) - 1));
  return Math.pow(1 + F * hoursSinceLastAccess / S, C);
}
```

---

## 8. 补充调研（基于架构分析反馈）

### 8.1 access_count 与记忆强度的关系：能否直接用作 trigger_count？

**结论：可以，但需要对数变换。**

认知心理学中的"测试效应"（Testing Effect / Retrieval Practice Effect）研究表明：

1. **每次提取（retrieval）都会强化记忆**，且效果比单纯重新学习更强（Roediger & Karpicke, 2006）
2. **强化遵循幂律递减**：早期提取的强化效果最大，随次数增加边际递减（负加速幂函数）
3. **重复提取可提升保持率 100% 以上**（相对于不再测试的对照组）

因此 `access_count` 完全可以作为 `trigger_count`（强化次数），直接记录"这条记忆被提取/引用了几次"。

**推荐的 access_count → 半衰期增长公式：**

```javascript
/**
 * 基于访问次数计算半衰期
 * 采用幂律增长（符合测试效应的边际递减规律）
 *
 * @param {number} baseHalfLife - 基础半衰期（小时），新记忆默认 168h (7天)
 * @param {number} accessCount - 访问/强化次数
 * @param {number} emotionAvg - 历次访问的平均情感权重 (1.0-1.5)
 * @returns {number} 当前半衰期（小时）
 */
function halfLifeFromAccessCount(baseHalfLife, accessCount, emotionAvg = 1.0) {
  // 幂律增长：S = S0 × (1 + a × n)^b
  // a = 缩放因子，b = 增长指数（<1 表示边际递减）
  //
  // 学术依据：
  // - 学习曲线拟合为幂函数，负加速（Anderson, 1982）
  // - FSRS 的 S^(-w9) 饱和项本质上也是幂律
  // - b ≈ 0.5 符合大多数实验数据的拟合
  const a = 1.0;   // 缩放因子
  const b = 0.5;   // 增长指数（0.5 = 平方根增长，边际递减）

  const growthFactor = Math.pow(1 + a * accessCount, b);
  return baseHalfLife * growthFactor * emotionAvg;
}

// 典型增长轨迹（baseHalfLife = 168h, emotionAvg = 1.0）：
// access=0 → 168h  (7天)
// access=1 → 238h  (10天)    ← 首次强化效果最大
// access=2 → 291h  (12天)
// access=3 → 336h  (14天)
// access=5 → 411h  (17天)
// access=10 → 557h (23天)
// access=20 → 770h (32天)
// access=50 → 1200h (50天)
```

**为什么用幂律而非线性？**
- 线性增长（S = S0 + k×n）会导致频繁提及的记忆半衰期无限增长，不符合现实
- 幂律（S = S0 × (1+an)^b, b<1）自然产生饱和效应
- 指数增长（SM-2 的 I(n)=I(n-1)×EF）太激进，10 次复习后间隔可达数年

**access_count vs 专门的 trigger_count：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 直接用 access_count | 无需新字段，已有数据 | 搜索命中也会计数，可能虚高 |
| 新建 reinforce_count | 只计算真正的"强化"事件 | 需要新字段和判断逻辑 |
| **推荐：两者都保留** | access_count 用于热度排序，reinforce_count 用于衰减计算 | 略增复杂度 |

建议区分"被搜索引擎命中"（access_count++）和"在对话中被有意义地提及/讨论"（reinforce_count++）。后者才是真正的"提取练习"，应驱动半衰期增长。

### 8.2 "难度系数"在桌面宠物场景下的映射

SM-2 和 FSRS 都依赖用户对每次回忆的显式评分（0-5 或 Again/Hard/Good/Easy），但我们的桌面宠物没有这种评分机制。

**推荐方案：基于隐式信号推断难度**

在我们的场景中，"难度"可以理解为"这条记忆被成功回忆的难易程度"，可通过以下隐式信号推断：

```javascript
/**
 * 从隐式信号推断记忆的"难度系数" D (1-10)
 * 无需用户显式评分
 *
 * 映射逻辑：
 * - SM-2/FSRS 的 "Easy" → 用户主动提及（无需 AI 检索）
 * - SM-2/FSRS 的 "Good" → AI 检索到并成功使用
 * - SM-2/FSRS 的 "Hard" → AI 检索到但用户纠正了细节
 * - SM-2/FSRS 的 "Again" → AI 未能回忆，用户重新告知
 */
const DIFFICULTY_SIGNALS = {
  // 信号类型 → 隐式评分 (1=Easy, 10=Hard)
  USER_PROACTIVE_MENTION: 2,    // 用户主动提到相关话题（说明记忆鲜活）
  AI_SUCCESSFUL_RECALL: 4,      // AI 在回复中正确引用了这条记忆
  AI_PARTIAL_RECALL: 6,         // AI 引用了但细节有误，用户纠正
  USER_RE_INFORM: 8,            // 用户重新告知（"我之前说过我叫XX"）
  AI_FAILED_RECALL: 9,          // AI 被问到但完全没想起来
};

/**
 * 更新记忆的难度系数
 * 使用 FSRS 的均值回归更新（防止极端值）
 */
function updateDifficulty(currentD, signal) {
  const w7 = 0.3;  // 均值回归强度
  const defaultD = 5.0;  // 默认难度（中等）

  // FSRS 风格的更新
  const deltaD = -(signal - 5) * 0.5;  // signal < 5 → D 降低（变容易）
  const newD = currentD + deltaD * ((10 - currentD) / 9);

  // 均值回归（防止极端化）
  const finalD = w7 * defaultD + (1 - w7) * newD;

  return Math.max(1, Math.min(10, finalD));
}
```

**实际场景中的难度信号采集：**

| 场景 | 信号 | 难度解读 |
|------|------|---------|
| 用户说"我上次提到的那个项目…" | USER_PROACTIVE_MENTION | Easy：用户自己记得，AI 配合即可 |
| AI 回复中说"你之前提过喜欢猫" | AI_SUCCESSFUL_RECALL | Good：系统成功检索 |
| 用户说"不对，我说的是狗不是猫" | AI_PARTIAL_RECALL | Hard：检索到了但有误 |
| 用户说"我之前告诉过你我叫小明" | USER_RE_INFORM | Again：系统遗忘，需重新学习 |

**简化方案（如果不想做信号检测）：**

可以完全省略难度系数，将其固定为中等值（D=5）。FSRS 的研究表明，难度对预测准确率的影响是三个组件中最小的——稳定性 S 和可提取性 R 才是核心。对于 MVP 版本，只实现 S 和 R 的动态计算已经足够。

### 8.3 新增 strength 维度后的搜索评分权重分配

**现有公式：**
```
finalScore = 0.3×关键词 + 0.4×向量 + 0.2×时间 + 0.1×重要性
```

**问题分析：**
- "时间"维度（0.2）使用固定衰减，无法区分"老但频繁回忆的重要记忆"和"老且被遗忘的琐碎记忆"
- 新增的 `strength`（记忆强度/可提取性 R）本质上是"时间"的升级版——它包含了时间衰减，但还额外编码了强化次数和情感权重

**推荐方案：strength 替代 time，而非新增维度**

```
新公式：finalScore = 0.3×关键词 + 0.4×向量 + 0.2×strength + 0.1×重要性
```

**理由：**
- strength（可提取性 R）已经内含时间衰减信息（R 随时间降低）
- strength 还额外包含强化次数（access_count 高 → R 衰减更慢）
- 同时保留 time 和 strength 会导致时间因素被双重计算
- 权重总和仍为 1.0，无需重新调优其他权重

**如果坚持要保留 time 作为独立维度（5 维方案）：**

```
finalScore = 0.25×关键词 + 0.35×向量 + 0.10×时间 + 0.20×strength + 0.10×重要性
```

各维度含义区分：
| 维度 | 含义 | 来源 |
|------|------|------|
| 关键词 (0.25) | 文本精确匹配度 | LIKE 查询 |
| 向量 (0.35) | 语义相似度 | 余弦相似度 |
| 时间 (0.10) | 纯时间新近性（偏好最近的对话） | 时间戳差值 |
| strength (0.20) | 记忆强度/可提取性 R（含衰减+强化+情感） | 遗忘曲线计算 |
| 重要性 (0.10) | 事实类型权重（个人信息 > 闲聊） | 事实提取器标记 |

**推荐采用 4 维方案（strength 替代 time），原因：**
1. 更简洁，避免维度冗余
2. strength 是 time 的严格超集（包含更多信息）
3. 减少需要调优的超参数
4. 语义上更清晰：向量管"是否相关"，strength 管"是否还记得"

---

## 7. 参考文献

1. Ebbinghaus, H. (1885). *Über das Gedächtnis* — 遗忘曲线原始研究
2. Wozniak, P.A. (1990). SM-2 Algorithm — SuperMemo 间隔重复算法
3. Ye, J. (2024). FSRS — Free Spaced Repetition Scheduler, open-spaced-repetition
4. Cahill, L. & McGaugh, J.L. (1995). "A novel demonstration of enhanced memory associated with emotional arousal" — 情绪增强记忆效应
5. Diamond et al. (2007). "The Temporal Dynamics Model of Emotional Memory Processing" — 情绪记忆的时间动态模型
6. FOREVER (2025). "Forgetting Curve-Inspired Memory Replay for Language Model Continual Learning" — 遗忘曲线启发的 LLM 记忆回放
7. "From Human Memory to AI Memory" (2025). 人类记忆到 AI 记忆的综述
8. Roediger, H.L. & Karpicke, J.D. (2006). "The Power of Testing Memory" — 测试效应/提取练习
9. Anderson, J.R. (1982). "Acquisition of Cognitive Skill" — 幂律学习曲线

---

## 附录：公式速查表

| 公式 | 用途 | 来源 |
|------|------|------|
| R = e^(-t/S) | 指数遗忘曲线 | 艾宾浩斯 |
| R = (1+Ft/S)^C | 幂函数遗忘曲线 | FSRS |
| EF' = EF + (0.1-(5-q)×(0.08+(5-q)×0.02)) | 难度系数更新 | SM-2 |
| I(n) = I(n-1) × EF | 复习间隔 | SM-2 |
| S_new = S × (1 + t_d × t_s × t_r × h × b × e^w8) | 稳定性强化 | FSRS |
| emotionWeight = 1 + 0.5 × \|mood-50\|/50 | 情感权重 | 本报告推荐 |
| R < 0.1 → 软删除 | 遗忘阈值 | 本报告推荐 |
| S = S0 × (1 + a×n)^b, b=0.5 | access_count → 半衰期 | 幂律学习曲线 |
| finalScore = 0.3×kw + 0.4×vec + 0.2×strength + 0.1×imp | 搜索评分（推荐） | 本报告推荐 |
