# AI Desktop Pet 记忆系统 vs OpenClaw 优劣势分析报告

> 对比日期：2026-03-10
> 参考来源：OpenClaw 官方文档、memsearch 开源提取版、Milvus 分析博客
> 撰写目的：评估当前记忆系统的竞争力，识别改进方向

---

## 一、两套系统架构概览

### 我们的系统（AI Desktop Pet）

```
存储层:   SQLite (better-sqlite3) + LocalStorage
嵌入层:   本地 ONNX (bge-small-zh-v1.5, 512维, ~32MB)
搜索层:   BM25(0.3) + 向量(0.4) + FSRS强度(0.2) + 重要性(0.1)
记忆层:   三层架构 - 用户画像(200t) / 重要记忆(800t) / 对话历史(500t)
强化层:   FSRS 幂函数衰减 R=(1+F×t/S)^C + 情感权重(1.0-1.5x)
提取层:   LLM事实提取器 (DeepSeek API, 累积3轮批量)
去重层:   MMR λ=0.5 (向量余弦 / Jaccard 降级)
```

### OpenClaw 记忆系统

```
存储层:   Markdown文件 (MEMORY.md + memory/*.md) + sqlite-vec 索引
嵌入层:   远程嵌入优先，本地 modelPath 配置后自动切换
搜索层:   向量(70%) + BM25/FTS5(30%)
记忆层:   Markdown 自由文本，LLM 直接写入更新
强化层:   无 FSRS，时间半衰期默认 30 天（固定衰减）
去重层:   MMR (Jaccard 文本相似度)
```

---

## 二、我们的优势 ✅

### 1. FSRS 仿人脑记忆模型（独有）

我们实现了完整的 **Free Spaced Repetition Scheduler**：

```
R(t) = (1 + F × t / S) ^ -0.5
```

- `S`（稳定性）随强化次数动态增长，越用越牢
- 困难奖励：R 低时被检索到，增长因子更高
- **R < 0.1 软删除**：实现自然遗忘，过时信息不再干扰搜索
- 初始稳定性 S₀ = 24h，普通记忆 3-4 周自然进入休眠

OpenClaw 用固定30天半衰期线性衰减，没有强化增长机制，无法模拟"越用越记得牢"的人脑特性。

---

### 2. 情感权重系统（独有）

记忆评分受当前心情调制，情绪强烈时（开心/悲伤）记忆权重提升至1.5x：

```javascript
// strength.js — calcEmotionalWeight()
weight = 1.0 + deviationScale × |mood - 50| / 50   // 范围 1.0-1.5
```

**效果**：和宠物开心聊的事情，宠物记得更牢；情绪平淡时记忆权重正常。OpenClaw 作为通用 Agent 框架，完全没有情感维度。

---

### 3. 结构化事实提取（精度更高）

LLM 事实提取器（`fact-extractor.js`）从对话中抽取5类结构化三元组：

| 类型 | 示例 |
|------|------|
| personal | 用户-名字-小明 |
| preference | 用户-喜欢-猫咪 |
| relationship | 用户-有-一只橘猫 |
| event | 用户-计划-周末去爬山 |
| routine | 用户-习惯-早上6点起床 |

写入独立的 `user_profile` 表，Layer 1 始终优先注入（200 token），宠物不会"忘记"用户名字。

OpenClaw 让 LLM 自由写入 MEMORY.md，格式不固定，需要再次语义搜索才能利用，精度更低。

---

### 4. 中文深度优化

- **Bigram 分词**：`_tokenize()` 生成中文双字 + 单字 token，无需外部词典
- **BM25 参数调优**：k1=1.2, b=0.75，适合中文短文本特性
- **重要关键词白名单**：「名字、叫、喜欢、生日、工作…」额外加权

OpenClaw 以英文为主设计，依赖 SQLite FTS5 分词，对中文无词边界的分词几乎无效，中文场景检索精度显著低于我们的方案。

---

### 5. 4维混合评分（更全面）

```
finalScore = 0.3×BM25关键词 + 0.4×向量语义 + 0.2×FSRS强度 + 0.1×重要性
```

OpenClaw 只有 2 维：向量(70%) + BM25(30%)。我们多出了**FSRS时间强度维度**（替代简单时间衰减）和**内容重要性维度**（个人信息、情感表达、关系信息），长期记忆排序更合理。

---

### 6. 用户画像独立表

`user_profile` 表集中存储从事实提取器汇总的核心个人信息，架构上实现了：

- **始终加载**（Layer 1 第一优先）：不需要语义搜索就能读取姓名、职业等
- **高置信度过滤**：`confidence >= 0.5` 才进入画像，减少噪音
- **覆盖更新**：新的高置信度事实自动覆盖旧事实

OpenClaw 把所有记忆混在 MEMORY.md，偶尔会因语义搜索失配而"忘记"用户姓名。

---

### 7. Token 预算管理

严格的三层 Token 预算（总计 1500 token）：

```
Layer 1: 用户画像   ≤ 200 token  (始终加载)
Layer 2: 重要记忆   ≤ 800 token  (语义搜索)
Layer 3: 对话历史   ≤ 500 token  (时间排序)
```

防止上下文溢出，超出预算自动截断，保证每次对话的 prompt 成本可控。OpenClaw 无此机制，长期使用后上下文成本不可预期。

---

## 三、我们的劣势 ❌

### 1. 记忆透明度低（最大短板）

OpenClaw 的 MEMORY.md 是**纯文本文件**，用户可以直接用记事本打开查看和编辑，知道 AI 记住了什么，出错时可以手动纠正。

我们的 SQLite 数据库对普通用户完全不透明：

- 没有"查看我的记忆"UI
- 用户无法知道宠物记住了什么错误信息
- 无法主动删除特定记忆

**影响**：降低用户信任感，错误记忆无法纠正会持续影响对话质量。

---

### 2. 向量搜索无加速（扩展瓶颈）

我们使用暴力 O(n) 余弦相似度搜索，10K 以下记录 <50ms 可接受，但：

- 无 GPU 加速路径
- 无 ANN 近似最近邻索引

OpenClaw 使用 **sqlite-vec** 扩展，支持 HNSW 索引，GPU 加速时 7ms 级别，可支撑百万级记忆库。

---

### 3. 模型绑定（DeepSeek Only）

事实提取器硬绑定 DeepSeek API，OpenClaw 支持任意 LLM（本地 ollama、GPT-4o、Claude 等均可）。

DeepSeek 服务不稳定时，事实提取会静默失败，用户画像停止更新，宠物逐渐"失忆"。虽然有5分钟超时刷新机制，但根本问题未解决。

---

### 4. 分块策略过于简化

我们用"整条消息作为单个 chunk"（为避免 textChunker 导致应用冻结的历史问题），长对话语义粒度粗糙。

OpenClaw 有完整的滑动窗口分块策略，配合去重 debounce（1.5s）和异步索引更新，长对话的检索精度显著更高。

---

### 5. 嵌入模型首次启动依赖网络

`bge-small-zh-v1.5` 首次下载需要 ~32MB，在网络受限环境下可能失败，导致整个向量搜索功能不可用（降级到纯关键词）。

OpenClaw 远程嵌入默认可用，本地模型作为可选配置，可用性更高。

---

### 6. 无跨会话技能记忆

OpenClaw + MemOS 插件支持**技能进化记忆**：记住"上次用 Python 解决了类似问题"并在下次复用。

我们的记忆只存对话内容，不存技能执行结果和工作流历史，Agent Skills 的执行经验无法积累。

---

### 7. 无多 Agent 记忆共享

OpenClaw + MemOS 支持多个 AI 智能体共享同一记忆库，适合家庭或团队场景。我们是单宠物单库，无法扩展。

---

## 四、综合对比表

| 维度 | AI Desktop Pet | OpenClaw | 说明 |
|------|:--------------:|:--------:|------|
| FSRS 动态记忆强化 | ✅ 完整实现 | ❌ 无 | 越用越牢，自然遗忘 |
| 情感权重调制 | ✅ 独有 | ❌ 无 | 心情影响记忆权重 |
| 用户画像独立表 | ✅ | ❌ | 始终保证姓名等不丢失 |
| 结构化事实提取 | ✅ 5类三元组 | ⚠️ 自由文本 | 我们精度更高 |
| 中文分词优化 | ✅ Bigram | ❌ FTS5 | 中文场景我们领先 |
| 4维混合评分 | ✅ | ⚠️ 2维 | 评分维度更全面 |
| Token 预算管理 | ✅ 1500t三层 | ❌ 无 | 成本可控 |
| MMR 去重 | ✅ | ✅ | 相当 |
| 记忆透明度/可编辑 | ❌ SQLite黑盒 | ✅ 纯文本 | OpenClaw 领先 |
| 向量加速(sqlite-vec/GPU) | ❌ 暴力O(n) | ✅ | OpenClaw 领先 |
| 多 LLM 支持 | ❌ DeepSeek绑定 | ✅ | OpenClaw 领先 |
| 智能分块策略 | ❌ 整条消息 | ✅ 滑动窗口 | OpenClaw 领先 |
| 跨会话技能记忆 | ❌ | ✅ (MemOS) | OpenClaw 领先 |
| 多 Agent 共享 | ❌ | ✅ (MemOS) | OpenClaw 领先 |
| 宠物情感叙事 | ✅ 独有 | ❌ | 差异化竞争力 |

---

## 五、核心竞争力定位

我们与 OpenClaw 面向不同市场：

| 维度 | AI Desktop Pet | OpenClaw |
|------|---------------|----------|
| 定位 | 情感型桌面宠物 | 通用生产力 Agent |
| 用户 | 需要陪伴的个人用户 | 开发者/专业用户 |
| 核心价值 | 情感连接、拟真记忆 | 任务执行、工作效率 |
| 记忆特色 | FSRS + 情感权重 | 透明可编辑 + 扩展性 |

**我们的不可替代性**：情感维度（心情调制、FSRS强化、宠物性格）是 OpenClaw 作为通用 Agent 框架天生不会做的，这是核心护城河。

---

## 六、建议优先改进项

按性价比（影响/成本）排序：

### 高优先级

**① 记忆可视化 UI**
- 在设置窗口增加「我的记忆」面板
- 展示 user_profile 表内容（姓名/喜好/关系等）
- 支持单条删除，允许用户纠错
- 预计工作量：1-2天，解决最大信任感问题

**② 多 LLM 后备链**
- 事实提取失败时降级到规则提取（正则匹配姓名/偏好短语）
- 减少对 DeepSeek 稳定性的单点依赖
- 预计工作量：0.5天

### 中优先级

**③ 长消息句子级分块**
- 对超过 150 字的消息做句子级分块（按「。！？」切分）
- 提升长对话的语义检索粒度
- 预计工作量：1天

**④ 记忆健康度监控**
- 定期统计 R 分布，展示"活跃记忆 / 休眠记忆 / 已遗忘"数量
- 让用户感知记忆系统在运转
- 预计工作量：0.5天

### 低优先级

**⑤ sqlite-vec 向量索引**（需要测试兼容性）
- 替换暴力余弦搜索，支撑更大记忆库
- 前置条件：测试 sqlite-vec 在 Electron 中的兼容性

---

## 七、参考资料

- [Memory - OpenClaw 官方文档](https://docs.openclaw.ai/concepts/memory)
- [We Extracted OpenClaw's Memory System and Open-Sourced It - Milvus Blog](https://milvus.io/blog/we-extracted-openclaws-memory-system-and-opensourced-it-memsearch.md)
- [GitHub - zilliztech/memsearch](https://github.com/zilliztech/memsearch)
- [GitHub - coolmanns/openclaw-memory-architecture](https://github.com/coolmanns/openclaw-memory-architecture)
- [Deep Dive: How OpenClaw's Memory System Works](https://snowan.gitbook.io/study-notes/ai-blogs/openclaw-memory-system-deep-dive)
- [MemOS: A Memory OS for AI System](https://memos.openmem.net/)
- 本项目源码：`main-process/search.js`, `main-process/strength.js`, `main-process/memory-layer.js`, `main-process/fact-extractor.js`
