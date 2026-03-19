# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供项目指导信息。

## 项目概述

AI Desktop Pet 是一个基于 Electron 的桌面应用，实现了一个 AI 驱动的虚拟桌面宠物。宠物可以在桌面上拖动，通过内置 Qwen AI 与用户进行对话。

**技术栈:** Electron + 原生 JavaScript（项目中存在 Vue 3 依赖，但目前未使用）

## 当前阶段性目标（完成后删除此节）

> 总体规划：[商业化评估与阶段性目标](./docs/market-evaluation-and-roadmap.md)
> 执行计划：[Sprint 商业化第一阶段](./docs/plans/2026-03-19-sprint-commercialization-phase1.md)

**阶段一：商业化基础（P0，4-6 周，3 个 Sprint）：**

Sprint 1（第 1-2 周）— 后端网关 + 账号：
- [ ] A1: `server/` 后端服务（Express + SQLite + JWT + SSE 代理）
- [ ] A2: 客户端改造（`builtin-api.js` 删 Key，改用 JWT）
- [ ] A3: 登录/注册界面 `windows/auth-window.html`

Sprint 2（第 3-4 周）— 订阅套餐 + 支付：
- [ ] B1: 后端套餐管理 + 支付回调
- [ ] B2: 客户端套餐选择界面 + 配额耗尽引导

Sprint 3（第 5-6 周）— 部署上线：
- [ ] C1: 云服务器部署（HTTPS）
- [ ] C2: 短信验证码接入
- [ ] C3: 客户端体验完善
- [ ] C4: 安全审查（0 处 API Key 泄漏）

**致命风险提醒：** 当前 API Key 硬编码在 `builtin-api.js`（客户端），反编译即可提取。**未建网关前禁止公开发布。**

**团队分工：** Claude=计划+验收，Codex=实施，Gemini=美工，老板=测试+转达

## 常用命令

### 开发
```bash
npm install              # 安装依赖
npm start               # 运行应用
npm run dev             # 带 DevTools 运行
```

### 构建
```bash
npm run build           # 为当前平台构建
npm run build:win       # 构建 Windows 安装包 (NSIS)
npm run build:mac       # 构建 macOS DMG
npm run build:linux     # 构建 Linux AppImage
```

输出目录为 `dist/`。

## 架构

### 主进程 (main.js)
- 创建无边框、透明、置顶窗口 (400x500px)
- 管理系统托盘（显示/隐藏/退出菜单）
- 处理窗口拖动和最小化的 IPC 通信
- 单实例锁
- 开机自启动

### 渲染进程
应用使用**原生 JavaScript**，不是 Vue。关键文件通过 `index.html` 按顺序加载：

1. `src/storage.js` - LocalStorage 封装，暴露 `window.PetStorage`
2. `src/prompts.js` - 性格定义，暴露 `window.PersonalityPrompts`
3. `src/api.js` - DeepSeek API 客户端，暴露 `window.PetAPI`
4. `src/skin-registry.js` - 皮肤注册中心，暴露 `window.SkinRegistry`
5. `src/animation-config.js` - 动画状态触发规则，暴露 `window.AnimationConfig`
6. `src/lottie-controller.js` - Lottie 动画控制器，暴露 `window.LottieController`
7. `src/animations.js` - 动画状态机，暴露 `window.PetAnimations`
8. `src/app-vanilla.js` - 主应用逻辑和全局状态

### 模块模式
所有模块通过全局 `window` 对象暴露 API：
- `window.PetStorage` - 数据持久化
- `window.PersonalityPrompts` - 性格系统
- `window.PetAPI` - AI 通信
- `window.SkinRegistry` - 皮肤注册中心（多宠物动画管理）
- `window.electron` - IPC 桥接（通过 preload.js contextBridge）

### 数据流
```
用户交互 → app-vanilla.js → PetStorage/PetAPI → UI 更新
```

### 核心系统

**性格系统:** 四种性格（治愈、搞笑、高冷、助手）。每种有对应的系统提示词和 20 条自动说话短语。切换性格会清空聊天历史。

**心情系统:** 0-100 分数存储在 LocalStorage。无交互时每 2 小时衰减 10 分。交互会提升心情。

**记忆系统 v2:** 基于 SQLite 的持久记忆系统（`main-process/`）：
- 对话存储（时间戳、角色、性格、心情）
- 本地 ONNX 向量嵌入（bge-small-zh-v1.5，512 维）
- 混合搜索（关键词 + 向量语义搜索）
- LLM 事实提取（通过 DeepSeek API）
- 三层记忆架构（用户画像/重要记忆/对话历史）
- 时间衰减加权（近期记忆优先）
- LRU 缓存淘汰

**存储:**
- **LocalStorage:** `pet_data`、`chat_history`、`settings`、`reminder_time_preferences`（旧版）
- **SQLite:** `pet-memory.db`（conversations、memory_chunks、memory_facts、embedding_cache、user_profile、reminders、reminder_history）

## 记忆系统架构

### 概述
记忆系统使 AI 宠物能够记住和回忆过去的对话，创造连续感和个性化体验。与只能看到当前消息的传统聊天机器人不同，我们的宠物可以引用历史上下文。

### 核心组件

#### 1. 数据库架构 (`main-process/schema.sql`)
```
conversations       - 完整对话记录
memory_chunks       - 搜索用文本块（简化版：每条对话一个块）
memory_facts        - 提取的结构化信息（含 LLM 提取的事实）
embedding_cache     - 向量嵌入缓存
user_profile        - 用户画像汇总表（由事实提取器维护）
```

#### 2. 搜索引擎 (`main-process/search.js`)
- **混合搜索**: 关键词匹配 + 向量语义搜索
- **评分公式**: `finalScore = 0.3×关键词 + 0.4×向量 + 0.2×时间 + 0.1×重要性`
- **向量搜索**: 本地 ONNX 嵌入引擎就绪时自动启用
- **降级方案**: 嵌入引擎未就绪时回退到纯关键词搜索
- **时间衰减**: 近期记忆权重更高
- **心情相似度**: 相似心情的记忆获得加权

#### 3. 本地向量嵌入引擎 (`main-process/embedding.js`)
- **模型**: `Xenova/bge-small-zh-v1.5`（ONNX 格式，~32MB int8 量化版）
- **维度**: 512
- **运行时**: `@huggingface/transformers`（纯 JS，无需原生编译）
- **首次运行自动下载模型**，缓存到 `userData/models/` 目录
- **异步初始化**: 不阻塞应用启动

#### 4. LLM 事实提取器 (`main-process/fact-extractor.js`)
- 利用 DeepSeek API 从对话中自动提取结构化事实
- 累积 3 轮对话后批量提取，减少 API 调用
- 事实类型：personal（个人信息）、preference（偏好）、relationship（关系）、event（事件）、routine（习惯）
- 新事实覆盖旧事实（高置信度优先）
- 自动更新 `user_profile` 表

#### 5. 记忆分层管理器 (`main-process/memory-layer.js`)
```
┌─────────────────────────────┐
│  Layer 1: 用户画像 (Profile) │  ← 始终加载，~200 tokens
│  名字、偏好、关系等核心事实    │
├─────────────────────────────┤
│  Layer 2: 重要记忆 (Core)    │  ← 语义搜索，~800 tokens
│  高置信度事实 + 关键对话片段   │
├─────────────────────────────┤
│  Layer 3: 对话历史 (History)  │  ← 时间衰减，~500 tokens
│  最近对话 + 相关历史对话       │
└─────────────────────────────┘
     总上下文预算: ~1500 tokens
```

#### 6. 上下文构建器 (`main-process/context.js`)
- 有分层记忆管理器时使用分层构建
- 无分层管理器时回退到传统模式
- `build()` 方法现在是异步的（返回 Promise）
- 性格感知的呈现方式
- 情感提示

#### 7. 记忆生命周期 (`main-process/memory.js`)
1. 用户发送消息 → 保存到 `conversations` 表 + 创建 `memory_chunks`
2. 异步生成向量嵌入（如果引擎就绪）
3. AI 回复 → 保存双方消息
4. 用户+AI 配对后 → 异步触发 LLM 事实提取（累积到阈值时）
5. 下次查询 → 混合搜索 → 分层上下文构建 → 返回给 AI

### 技术决策

**为什么使用本地 ONNX 模型？**
- DeepSeek 嵌入 API 返回 404，不可用
- `@huggingface/transformers` 是纯 JS，不需要像 `better-sqlite3` 那样做原生编译
- 模型 ~32MB，首次下载后缓存
- 512 维向量，10K 条记录暴力搜索 <50ms

**为什么使用简化分块？**
- 原始方案：智能文本分块带重叠
- 问题：`textChunker.chunk()` 导致应用冻结
- 方案：整条消息作为单个块
- 结果：稳定，不卡顿

**为什么不用 FTS5？**
- 问题：SQLite 编译时未包含 FTS5 模块
- 方案：JS 端 BM25 实现（`_bm25ScoreConversations()`），搭配中文 bigram 分词
- 结果：运行可靠，区分度显著优于原 LIKE 匹配，可通过 `search.bm25.enabled` 关闭回退

### 数据库位置
```
Windows: C:\Users\<用户名>\AppData\Roaming\ai-desktop-pet\pet-memory.db
```

### 记忆搜索流程
```
1. 用户发送消息 → "我叫什么名字？"
2. 搜索引擎查询 conversations 表
3. BM25 关键词评分（中文 bigram 分词 + 标准 BM25 公式，可降级为 LIKE）
4. 向量搜索：生成查询嵌入 → 余弦相似度匹配（如果引擎就绪），同时附带 embedding 向量
5. 合并评分：关键词 × 0.3 + 向量 × 0.4 + strength × 0.2 + 重要性 × 0.1
6. MMR 去重（λ=0.5，向量余弦相似度，降级 Jaccard 文本相似度）
7. 按 MMR 分数排序，返回 Top N
8. 分层上下文构建器格式化（用户画像 + 相关回忆 + 最近对话）
9. AI 使用上下文生成个性化回复
```

### 配置 (`main-process/config.js`)
```javascript
// 本地嵌入引擎
localEmbedding: {
  enabled: true,
  modelName: 'Xenova/bge-small-zh-v1.5',
  dimensions: 512,
  maxBatchSize: 32,
  migration: { batchSize: 50, delayMs: 1000 }
},
// LLM 事实提取
factExtraction: {
  enabled: true,
  bufferThreshold: 3,  // 累积 3 轮后提取
  model: 'deepseek-chat'
},
// 记忆分层
memoryLayers: {
  enabled: true,
  tokenBudget: { total: 1500, profile: 200, core: 800, history: 500 }
},
// 时间衰减
temporal: {
  halfLife: 168,        // 7天半衰期
  minWeight: 0.1,       // 10% 下限
  recentThreshold: 24,  // 24小时阈值
  moodModulation: { enabled: true, highMoodThreshold: 80, lowMoodThreshold: 40 }
},
// 搜索
search: {
  defaultLimit: 5,
  minScore: 0.6,
  vectorWeight: 0.7,
  textWeight: 0.3,
  mmr: {
    enabled: true,   // MMR 去重：λ=0.5 均衡相关性与多样性
    lambda: 0.5      // 0=纯多样性, 1=纯相关性
  },
  bm25: {
    enabled: true,   // JS 端 BM25（中文 bigram 分词），false 时退回 LIKE 匹配
    k1: 1.2,
    b: 0.75
  }
}
```

### 数据库迁移 (`main-process/migrate.js`)
- 通过 `PRAGMA user_version` 自动版本检查
- 无数据丢失的渐进式架构升级
- 每次启动时执行
- 当前版本：4（v4 新增 user_profile 表和 memory_facts 字段）

## 多皮肤系统 — SkinRegistry

### 概述
SkinRegistry（`src/skin-registry.js`）是皮肤注册中心，统一管理所有宠物类型的动画配置、路径映射和降级策略。添加新皮肤只需：
1. 在 `lottie/<pet-name>/` 放入动画 JSON 文件
2. 在 `skin-registry.js` 中调用 `register()` 添加配置
3. 无需修改其他文件

### 架构
```
SkinRegistry (皮肤注册中心)
  ├── emoji → skinId 映射
  ├── skinId → 完整皮肤配置
  ├── getAnimationForState() → 动画路径 + 配置（含降级）
  └── hasLottieSupport() → 是否有 Lottie 动画

AnimationConfig (状态触发规则)
  ├── 委托 SkinRegistry 获取动画配置
  └── 保留 triggerRules 和 decideNextState

LottieController (Lottie 播放器)
  ├── 通过 SkinRegistry 获取动画路径
  ├── 加载失败时标记 markLottieUnavailable()
  └── 不再有硬编码的 petToFolder 映射

PetAnimations (动画状态机)
  ├── setBasePet() 自动检查皮肤是否支持 Lottie
  └── 自动在 Lottie/Emoji 模式间切换
```

### 降级策略
```
状态请求 (如 "happy")
  ↓
该皮肤是否有此状态的动画？
  ├── 有 → 加载对应 Lottie 动画
  └── 无 → 该皮肤是否有 idle 动画？
        ├── 有 → 使用 idle 动画
        └── 无 (hasLottie=false) → 切换到 Emoji 模式
```

### 当前皮肤状态
| 宠物 | Emoji | Lottie | 动画数量 |
|------|-------|--------|----------|
| 猫咪 | 🐱 | 有 | 6 个文件 |
| 狗狗 | 🐶 | 无 | - |
| 兔子 | 🐰 | 无 | - |
| 狐狸 | 🦊 | 无 | - |
| 熊   | 🐻 | 无 | - |

### 加载顺序（index.html）
```
skin-registry.js      ← 最先加载
animation-config.js   ← 依赖 SkinRegistry
lottie-controller.js  ← 依赖 SkinRegistry
animations.js         ← 依赖以上模块
app-vanilla.js        ← 最后加载
```

## UI/UX 系统（2025-02 大更新）

### 动画系统 (`src/animations.js`)
完整的动画状态机管理宠物行为：
- **状态**: idle、happy、thinking、sleeping、dragging、clicked、talking、sad
- **表情系统**: 基于心情和宠物类型的动态表情切换
- **装饰效果**: 粒子效果用于视觉反馈

### 径向菜单 (`src/radial-menu.js`)
替代旧水平菜单的可展开圆形菜单：
- **布局**: 围绕宠物的 360° 径向设计（90px 半径）
- **两级菜单**: 主菜单（6项）+ 更多菜单（5项）
- **操作**: 聊天、设置、历史、提醒、更多、关闭
- **快捷键**: 键盘支持（Esc, Ctrl+K, Ctrl+H, Ctrl+,, Space）

### 视觉增强
- **发光效果**: 带动画的径向渐变背景脉冲
- **状态粒子**: 开心时闪光、思考时气泡、睡觉时 Z、悲伤时泪滴
- **过渡动画**: 平滑的 CSS 动画配合 cubic-bezier 缓动
- **阴影**: 随状态变化的动态 drop-shadow 滤镜
- **无障碍**: 减少动画和高对比度支持

### 交互改进
- **拖动/点击分离**: 5px 阈值 + 300ms 时间限制
- **自动睡眠**: 5 分钟无操作进入睡眠模式
- **音效**: 可选的 Web Audio API 反馈（点击、开心）
- **快捷键**:
  - `Esc`: 关闭所有弹窗
  - `Ctrl+K`: 打开聊天
  - `Ctrl+,`: 打开设置
  - `Ctrl+H`: 打开历史
  - `Space`: 切换菜单

## 重要实现说明

1. **活跃文件是 `app-vanilla.js`**，不是 `app.js`（Vue 版本未使用）
2. **API Key 通过 .env 加载**: 经由主进程，不硬编码
3. **注释使用中文** - 保持此惯例
4. **NPM 使用国内镜像** (npmmirror.com)，配置在 `.npmrc`
5. **代码风格:** 2 空格缩进，单引号，基本使用分号
6. **窗口拖动** 通过 IPC 到主进程实现（见 app-vanilla.js 中的 `initDrag()`）
7. **降级响应** 在 `getMockResponse()` 中，API 失败时使用
8. **模块加载顺序**: skin-registry.js → animation-config.js → lottie-controller.js → animations.js → app-vanilla.js
9. **`context.js` 的 `build()` 方法已改为异步**（返回 Promise）
10. **`@huggingface/transformers` 无需原生编译**，不需要 `@electron/rebuild`

## 测试清单

修改后需验证：
- 宠物表情可见且可点击
- 点击弹出快捷菜单
- 聊天输入可发送消息
- 设置面板打开且宠物/性格切换正常
- 聊天历史重启后保持
- 窗口可拖动
- 托盘图标显示/隐藏/退出正常
- 心情正常更新
- **提醒创建和触发正常**
- **记忆系统：告诉宠物个人信息 → 重启 → 询问 → 应能回忆**
- **语义搜索：说过"我养了一只猫" → 问"我的宠物" → 应能关联**

## 提醒系统（2025-02 实现）

### 概述
提醒系统使用户可以通过自然对话设置定时提醒。宠物会在指定时间通过系统通知和应用内消息提醒用户。

### 核心组件

#### 1. 数据库表 (`main-process/schema.sql`)
```sql
reminders              - 活跃提醒及调度信息
reminder_history       - 已完成提醒，用于学习用户习惯
```

**关键字段:**
- `status`: pending、completed、cancelled、missed
- `vague_keyword`: 记录模糊时间表达（一会儿、晚点等）
- `repeat_pattern`: 支持 daily、weekly、monthly、yearly 或自定义间隔
- `completed_at`: 实际触发时间，用于习惯分析

#### 2. 提醒调度器 (`main-process/reminder.js`)
- **检查间隔**: 30 秒
- **过期处理**:
  - < 1 小时: 触发或标记为错过（可配置）
  - 1-2 小时: 标记为错过
  - > 2 小时: 自动取消
- **重复支持**: 自动调度下次执行

#### 3. 时间提取 (`src/reminder-extractor.js`)
智能解析自然语言中的时间表达：

**支持的时间格式:**

| 类型 | 示例 |
|------|------|
| 绝对时间 | `15点30分`、`9点`、`明天下午3点` |
| 相对分钟 | `10分钟后`、`半小时后`、`2小时30分钟后` |
| 相对天数 | `明天`、`后天`、`3天后` |
| 时段 | `早上`、`中午`、`下午`、`晚上`、`凌晨` |
| 模糊时间 | `一会儿`、`过会`、`待会`、`稍后`、`晚点` |

**模糊时间关键词:**
- `马上`、`立刻`、`立即` - 1 分钟
- `一会儿`、`一会` - 用户偏好（默认 10 分钟）
- `过会`、`过一会` - 用户偏好（默认 10 分钟）
- `待会`、`待会儿` - 用户偏好（默认 10 分钟）
- `等一下`、`等下` - 5 分钟
- `稍等`、`稍后` - 15 分钟
- `晚点`、`晚些` - 用户偏好（默认 30 分钟）
- `半小时` - 30 分钟
- `半天` - 120 分钟

**触发关键词:**
`提醒`、`记得`、`别忘了`、`别忘记`、`记住`、`叫我`、`喊我`、`告诉我`、`通知我`、`设个提醒`、`定个闹钟`、`记得去`、`别忘了去`、`该去`、`该做`

#### 4. 用户偏好学习
系统从用户行为中学习：
- 首次使用模糊时间：请求澄清
- 3 次以上使用后：自动记住偏好
- 存储在 LocalStorage 和数据库（reminder_history 表）
- 应用重启后保持

**学习流程:**
```
用户: "一会儿后提醒我喝水"
宠物: "一会儿"是多久呢？"
用户: "8"
系统: 保存偏好 "一会儿" = 8 分钟

下次:
用户: "一会儿后提醒我休息"
宠物: "根据习惯，'一会儿'一般是8分钟，对吗？"
用户: "好"
系统: 创建 8 分钟提醒
```

### API 使用

#### 渲染进程 (通过 `window.PetReminder`)
```javascript
// 创建提醒
await window.PetReminder.create({
  content: '喝水',
  remindAt: Date.now() + 10 * 60 * 1000,
  metadata: { vagueKeyword: '一会儿', personality: 'healing', mood: 80 }
});

// 获取待处理提醒
const pending = await window.PetReminder.getPending();

// 获取用户偏好
const pref = await window.PetReminder.getPreference('一会儿');

// 分析用户习惯
const habits = await window.PetReminder.analyzeHabits();

// 获取提醒历史
const history = await window.PetReminder.getHistory({ limit: 20 });
```

#### 渲染进程 (通过 `window.PetMemory` - 记忆系统升级 API)
```javascript
// 获取嵌入引擎状态
const status = await window.PetMemory.getEmbeddingStatus();
// 返回: { ready: true/false, loading: true/false, modelName: '...', dimensions: 512 }

// 手动触发事实提取
const facts = await window.PetMemory.flushFacts();

// 获取分层记忆上下文
const context = await window.PetMemory.getLayeredContext(query, options);
```

#### 主进程 (通过 `MemoryMainProcess`)
```javascript
await memorySystem.createReminder(data);
await memorySystem.getPendingReminders();
await memorySystem.cancelReminder(id);
await memorySystem.flushFactExtraction();
```

### 对话流程示例

#### 基本提醒
```
用户: "10分钟后提醒我喝水"
宠物: "好的！我会在10分钟后提醒你喝水~"
[10 分钟后]
系统: 显示通知 + 宠物说 "该喝水啦！"
```

#### 模糊时间（首次使用）
```
用户: "一会儿后提醒我休息"
宠物: "一会儿"是多久呢？"
[聊天框打开，placeholder: "告诉我几分钟（数字即可）"]
用户: "8"
宠物: "好的！我会在8分钟后提醒你休息~"
```

#### 模糊时间（已学习偏好）
```
用户: "一会儿后提醒我看看邮件"
宠物: "根据习惯，'一会儿'一般是8分钟，对吗？"
用户: "好"
宠物: "好的！我会在8分钟后提醒你看看邮件~"
```

### 重要实现细节

#### 1. 必须使用 Async/Await
`ReminderExtractor.extract()` 是异步的，必须 await：
```javascript
// 正确 ✅
const extracted = await window.ReminderExtractor.extract(message);

// 错误 ❌
const extracted = window.ReminderExtractor.extract(message);
```

#### 2. 纯数字输入支持
系统接受纯数字作为分钟数：
```javascript
用户输入: "8"           → 理解为 8 分钟
用户输入: "8分钟"       → 理解为 8 分钟
用户输入: "好"          → 使用建议偏好
```

#### 3. 确认状态管理
- `state.pendingReminder` 存储活跃的确认状态
- `openChat()` 默认重置此状态
- `openChat(false)` 在确认流程中保持状态
- 无待确认提醒时打开聊天 = 正常模式

#### 4. 原生模块编译
`better-sqlite3` 必须为 Electron 的 Node.js 版本编译：
```bash
# 一次性设置
npm install --save-dev @electron/rebuild
npx @electron/rebuild

# 或使用提供的脚本
fix.bat  # Windows 系统
```

注意：`@huggingface/transformers` 是纯 JS 包，**不需要** `@electron/rebuild`。

### 配置 (`main-process/reminder.js`)
```javascript
this.overdueThreshold = 3600000;  // 1 小时阈值
this.overdueStrategy = 'miss';    // miss | catch_up | ignore
this.checkIntervalMs = 30000;     // 30 秒
```

### 故障排除

**问题:** "Content and remindAt are required"
- **原因:** 忘记 `await` 调用 `extract()`
- **解决:** 始终使用 `await window.ReminderExtractor.extract(message)`

**问题:** 原生模块版本不匹配
- **原因:** `better-sqlite3` 为错误的 Node.js 版本编译
- **解决:** 运行 `npx @electron/rebuild -f`

**问题:** 模糊时间未被识别
- **原因:** 关键词不在模式列表中
- **解决:** 添加到 `reminder-extractor.js` 的 `timePatterns`

**问题:** 嵌入模型下载失败
- **原因:** 网络问题或模型仓库不可达
- **解决:** 系统自动降级到纯关键词搜索，不影响使用

### 修改文件记录

#### 2026-02 主题系统
- `src/theme-manager.js` - 新增：主题管理器，定义赛博朋克/懒猫橘两套主题，存储到 localStorage，跨窗口实时同步
- `windows/theme-window.html` - 新增：主题选择弹窗，带预览卡片
- `src/rotary-menu.js` - 修改：一级菜单"提醒"→"主题"（🎨），action 调用 `window.openTheme`
- `src/app-vanilla.js` - 新增：`openTheme()` 函数 + `window.openTheme` 暴露
- `windows/chat-window.html` - 更新：引入 theme-manager.js，所有硬编码颜色替换为 CSS 变量
- `windows/settings-window.html` - 更新：引入 theme-manager.js，所有硬编码颜色替换为 CSS 变量
- `windows/history-window.html` - 更新：引入 theme-manager.js，所有硬编码颜色替换为 CSS 变量
- `windows/bubble-window.html` - 更新：引入 theme-manager.js，气泡颜色使用 CSS 变量

**主题系统设计：**
- 默认主题：`classic`（经典主题，简约白灰橙）
- 赛博朋克：深蓝底 + 霓虹青 `#00fff0` + 品红 `#ff2d78`
- 懒猫橘：深暖棕底 + 琥珀橙 `#ffb347` + 橙红 `#ff6b35`
- 存储：`localStorage.pet_theme`，跨窗口通过 `storage` 事件实时同步
- CSS 变量：`--bg`, `--neon-cyan`, `--neon-magenta`, `--header-bg`, `--bubble-bg` 等 ~30 个变量

#### 2026-02 弹窗重设计（赛博朋克主题统一）
- `main.js` - 修复：createChildWindow() 添加屏幕边界检测（优先右侧→左侧→居中），backgroundColor 改为 #020810
- `windows/chat-window.html` - 重设计：赛博朋克深色主题（深蓝底 + 霓虹青/品红）
- `windows/settings-window.html` - 重设计：赛博朋克主题 + 替换 alert/confirm 为内联自定义对话框
- `windows/history-window.html` - 重设计：赛博朋克主题 + 替换 confirm 为内联对话框
- `windows/init-window.html` - 重设计：赛博朋克主题 + 替换 alert 为内联错误提示
- `windows/bubble-window.html` - 重设计：深色气泡 + 霓虹青边框发光效果

**统一设计规范（所有弹窗）：**
- 背景：`#020810` / `rgba(0,30,55,0.6)`
- 主色：`#00fff0`（霓虹青），危险色：`#ff2d78`（霓虹品红）
- 关闭按钮：X 形，hover 变品红发光（替代苹果红圆点）
- 按钮：透明背景 + 发光边框风格
- 滚动条：3px 细，霓虹青色

#### 2026-02 多皮肤系统 (SkinRegistry)
- `src/skin-registry.js` - 新增：皮肤注册中心，统一管理所有宠物动画配置
- `src/animation-config.js` - 重构：移除硬编码配置，委托 SkinRegistry
- `src/lottie-controller.js` - 重构：移除 petToFolder，通过 SkinRegistry 获取路径
- `src/animations.js` - 更新：setBasePet() 自动检查 Lottie 支持并切换模式
- `src/app-vanilla.js` - 更新：selectPet() 和 toggleLottieMode() 集成 SkinRegistry
- `index.html` - 更新：添加 skin-registry.js 加载（在 animation-config.js 之前）

#### 2025-02 提醒系统
- `main-process/schema.sql` - 新增 reminders 和 reminder_history 表
- `main-process/reminder.js` - 带过期处理的调度器
- `main-process/memory.js` - 与记忆系统集成
- `main-process/migrate.js` - 自动数据库迁移
- `src/reminder-extractor.js` - 时间解析与偏好学习
- `src/app-vanilla.js` - UI 流程和确认处理
- `preload.js` - 提醒 API 的 IPC 桥接
- `package.json` - 添加 rebuild 脚本

#### 2025-02 记忆系统升级
- `main-process/embedding.js` - 新增：本地 ONNX 向量嵌入引擎
- `main-process/fact-extractor.js` - 新增：LLM 事实提取器
- `main-process/memory-layer.js` - 新增：三层记忆管理器
- `main-process/schema.sql` - 新增 user_profile 表
- `main-process/migrate.js` - 新增 v4 迁移（user_profile 表 + memory_facts 字段）
- `main-process/search.js` - 升级为混合搜索（关键词 + 向量）
- `main-process/context.js` - 支持分层上下文构建，build() 改为异步
- `main-process/memory.js` - 集成所有新组件
- `main-process/config.js` - 新增 localEmbedding、factExtraction、memoryLayers 配置
- `preload.js` - 新增 getEmbeddingStatus、flushFacts、getLayeredContext 通道
- `package.json` - 添加 `@huggingface/transformers` 依赖

#### 2026-02 截图系统重构
- `windows/screenshot-capture.html` - 完全重写：4阶段状态机（选择→调整→编辑→操作），8种标注工具，放大镜，键盘快捷键支持
- `windows/pin-window.html` - 新增：Snipaste 风格贴图窗口，可拖动、调整透明度、双击关闭
- `main.js` - 重构：截图 IPC 处理器重构，支持多显示器 DPI 缩放，贴图窗口管理
- `preload.js` - 新增：ScreenshotBridge API（getScreenCapture、selectRegion、cancel、copyDataToClipboard、saveQuick、saveAs、pinToDesktop、analyze、ocr、onPinLoad、setPinOpacity、closePinWindow）
- `main-process/screenshot.js` - 新增：saveFromDataURL、copyDataToClipboard 方法支持 dataURL 直接操作
- `main-process/database.js` - 修复：添加 runMigrations() 方法自动迁移缺失的数据库列（importance_score 等）
- **删除文件**：src/screenshot-capture.js、src/screenshot-editor.js、windows/screenshot-window.html（旧代码已清理）

**截图系统特性：**
- **三阶段流程**：全屏背景 → 区域选择（带4x放大镜）→ 标注编辑 → 保存/分享
- **8种标注工具**：矩形、椭圆、箭头、直线、画笔、文字、马赛克、序号标注
- **编辑工具栏**：颜色选择器（8色）、线宽选择（2/4/6/8px）、撤销/重做
- **操作选项**：复制到剪贴板、快速保存、另存为、贴图到桌面、AI 分析、OCR 识别
- **贴图窗口**：最多 5 个置顶窗口，支持透明度调整（30-100%），可拖动缩放
- **快捷键**：ESC 取消、Enter 确认、Ctrl+Z 撤销、Ctrl+Y 重做、Ctrl+C 复制、Ctrl+S 保存、1-8 切换工具
- **多显示器支持**：虚拟屏幕边界计算，DPI 缩放处理（scaleFactor）
- **窗口检测模式**：类微信截图的窗口识别，悬停高亮边框 + 标题标签，点击直接选中窗口区域
- **安全改进**：contextIsolation: true，路径校验，输入验证

### 提醒测试清单
- 基本时间表达正常（10分钟后、半小时后）
- 模糊时间触发澄清（一会儿、晚点）
- 纯数字输入被接受（8）
- 重新打开聊天时确认状态重置
- 学习到的偏好持久保存
- 触发时通知出现
- 提醒触发时宠物说话
- 过期提醒正确处理
- 重复提醒正确调度下次执行


#### 2026-03 多模型 API Key 管理
- `main.js` - 新增：`readApiKeysFile()`、`saveProviderApiKey()`、`maskApiKey()` 工具函数；修改：`getProviderApiKeyByProvider()` 优先读 api-keys.json 降级到 .env；新增 IPC handler `save-provider-api-key`（含长度验证、deepseek 时同步更新记忆系统）、`get-all-provider-keys`（脱敏）、`test-provider-api-key`（连通性测试）；启动时从 api-keys.json 加载 deepseek key 到记忆系统
- `preload.js` - 新增：`saveProviderAPIKey`、`getAllProviderAPIKeys`、`testProviderAPIKey` 三个桥接
- `windows/settings-window.html` - 新增：「API Key 管理」卡片，支持 deepseek/openai/openrouter/siliconflow/glm 共 5 个 provider，含脱敏显示、显示/隐藏切换、保存、测试连接功能
- `main-process/memory.js` - 新增：`updateApiKey(newApiKey)` 方法，内部调用 `factExtractorLLM.setApiKey()` 实现运行时动态更新

**API Key 优先级：**`userData/api-keys.json` > `.env` 环境变量

**存储位置：** `C:\Users\<用户名>\AppData\Roaming\ai-desktop-pet\api-keys.json`（明文，本地安全）

**记忆系统集成：** 用户保存 deepseek key 后立即通知 FactExtractorLLM，无需重启应用

#### 2026-03 截图窗口检测模式
- `main.js` - 新增：`screenshot:get-windows` IPC handler，通过 PowerShell + Win32 `EnumWindows` 枚举可见非最小化窗口，返回标题/坐标（物理像素 ÷ scaleFactor 转 CSS 像素）
- `preload.js` - 新增：`ScreenshotBridge.getWindowList()` 桥接
- `windows/screenshot-capture.html` - 新增：`fetchWindowList()`（懒加载）、`updateWindowHighlight(x,y)`（hover 检测）；新增 `state.windowList`/`state.hoveredWindow`；修改：`onMouseMove` 窗口模式不显示放大镜而是高亮窗口，`onMouseDown` 窗口模式点击直接选中窗口区域，`resetToSelecting` 清理高亮；新增 `.window-highlight-label` 显示窗口标题；提示文字根据模式动态更新

**窗口检测流程：**
```
切换到窗口模式 → fetchWindowList()（PowerShell 枚举，~1-2s）→ 鼠标移动 → 检测包含鼠标的最顶层窗口 → 显示霓虹青高亮框+标题标签 → 点击 → 直接进入调整阶段
```

**注意：** EnumWindows 返回顺序不保证是 Z 序，可能导致部分重叠窗口检测不准确，这是 Windows API 的限制。

#### 2026-03 搜索系统升级（MMR + BM25）
- `main-process/search.js` - 新增：`_applyMMR()`（MMR 去重算法）、`_bm25ScoreConversations()`（标准 BM25 评分）、`_tokenize()`（中文 bigram + 英文整词分词）、`_textSimilarity()`（Jaccard 文本降级）、`_cosineSimilarity()`；修改：`_vectorSearchConversations()` 附带 embedding 向量、`_keywordScoreConversations()` 恢复为降级方案、`search()` 集成 MMR 和 BM25
- `main-process/config.js` - 新增：`search.mmr`（enabled/lambda）和 `search.bm25`（enabled/k1/b）配置节
- `docs/memory-upgrade-design.md` - 新增：MMR + BM25 设计文档
- `docs/memory-upgrade-test-report.md` - 新增：20/20 通过的代码审查报告

**MMR 特性：**
- λ=0.5 均衡模式，可配置（0=纯多样性，1=纯相关性）
- 三层降级：向量余弦相似度 → Jaccard 文本 → 跳过 MMR
- embedding 通过搜索结果传递，无二次 DB 查询
- `hasVector` 守卫：向量引擎未就绪时自动跳过

**BM25 特性：**
- 标准 BM25 公式（IDF 防负数 +1，TF 饱和 k1=1.2，文档长度归一化 b=0.75）
- 中文 bigram + 单字双重分词 + 英文整词，无需分词词典
- `bm25.enabled=false` 可回退到原始 LIKE 匹配
- min-max 归一化到 [0.1, 1.0]

#### 2026-02 菜单回退至旋转拨号样式
- `src/rotary-menu.js` - 恢复：`RotaryMenuController`，旋转拨号菜单（6项主菜单 + 5项二级菜单）
- `src/style.css` - 恢复：旋转拨号 CSS（`.rotary-dial`、`.dial-item` 等）
- `main.js` - 恢复：`medium` 窗口高度 420→300
- `src/app-vanilla.js` - 恢复：类名 `.rotary-menu`、`.dial-item`
- `src/menu-window-utils.js` - 恢复：类名 `.rotary-dial`、`.dial-item`
- `windows/menu-window.js` - 恢复：类名 `.rotary-dial`、`.dial-item`

#### 2026-03 Agent Skills 系统
- `skills/` - 新增：内置技能目录，12 个 SKILL.md 文件（bash-run、file-ops、file-write、file-list、file-search、web-search、memory-search、reminder、open-app、open-url、clipboard-set、screenshot-ocr）
- `main-process/skill-registry.js` - 新增：技能注册中心（扫描 bundled+user 目录、解析 YAML frontmatter、环境过滤、生成 XML 提示词和 function calling tools 数组）
- `main-process/skill-executor.js` - 新增：技能执行器（路由：Node.js 内置 → Python WorkflowManager → 外部 HTTP；安全确认机制；命令黑名单；路径校验）
- `src/intent-classifier.js` - 新增：轻量意图分类器（关键词匹配，6 种意图：chat/task/search/creative/code/vision，< 5ms 同步）
- `main-process/model-router.js` - 新增：多模型路由器（意图→场景→provider+model，支持降级链，api-keys.json 缓存读取）
- `main.js` - 更新：require SkillRegistry/SkillExecutor；app.whenReady 中初始化 Skills 系统；新增 skill:list/skill:get-tools-array/skill:get-prompt-snippet/skill:execute IPC handlers；确认弹窗机制
- `preload.js` - 更新：新增 PetSkills 桥接 API（list/getToolsArray/getPromptSnippet/execute/onConfirmRequest/respondConfirm）；新增 PetModelRouter 桥接 API
- `src/api.js` - 更新：chatWithAI 注入技能提示词到 system prompt；工具定义优先从 PetSkills 获取（降级 PetWorkflow）；handleToolCallsLoop 通过 PetSkills.execute 路由（降级 PetWorkflow）
- `docs/skills-architecture.md` - 新增：Skills 系统架构文档
- `docs/intent-routing-design.md` - 新增：意图识别与路由设计文档

**Skills 系统架构：**
```
SKILL.md 文件（声明式） → SkillRegistry（扫描/注册/过滤）
                            ↓
                    buildToolsArray() → DeepSeek function calling
                    formatForPrompt() → system prompt 注入
                            ↓
LLM tool_call → SkillExecutor（路由）
                  ├── Node.js 内置（bash_run/memory_search/reminder_create/web_search）
                  ├── Python 层（file_read/write/list/search/open_app/open_url/clipboard_set）
                  └── 外部 HTTP（web_search DuckDuckGo API）
```

**意图分类 + 模型路由：**
```
用户消息 → IntentClassifier.classify()（关键词匹配，< 5ms）
         → ModelRouter.route(intent)（场景→provider→降级链）
         → callDeepSeekAPI（使用路由结果的 endpoint/model）
```

**技能安全分级：**
| 级别 | 行为 | 技能 |
|------|------|------|
| 安全 | 静默执行 | file_read/list/search, memory_search, web_search, open_url, clipboard_set, reminder_create, screenshot_ocr |
| 危险 | 需用户确认 | file_write, open_app |
| 高危 | 需确认+命令审查 | bash_run |

#### 2026-03 OpenCode 功能借鉴
- `skills/file-edit/SKILL.md` - 新增：精确编辑技能（str_replace 模式）
- `main-process/skill-executor.js` - 新增：_fileEdit 处理器 + _bashRun 改为 spawn 流式输出
- `main.js` - 更新：skill:execute 传入 streamCallback，推送到所有窗口
- `preload.js` - 更新：PetSkills 新增 onStream/offStream
- `src/plan-manager.js` - 新增：Plan/Todo 管理器，解析和渲染执行计划卡片
- `windows/chat-window.html` - 更新：addMessage 集成计划卡片渲染 + 步骤状态更新
- `src/api.js` - 更新：task 意图时注入 Plan 系统提示
- `index.html` - 更新：加载 plan-manager.js

#### 2026-03 Agent 做事能力系统升级（P0→P3）

本次升级分四个优先级批次完成，使 Agent 工具调用成功率和复杂任务完成率大幅提升。

**涉及文件：**
- `main-process/agent-runtime.js` - 核心改动（工具循环、并发、重试、预读、截断）
- `main-process/skill-executor.js` - 新增 5 个原生技能处理器
- `main.js` / `preload.js` - 新增 IPC handler 和桥接
- `skills/grep-search/SKILL.md` - 新增
- `skills/git-ops/SKILL.md` - 新增
- `skills/multi-file-edit/SKILL.md` - 新增

**P0 — 基础稳定性修复：**
- 修复致命 Bug：`effectiveTools` 移除 `round === 0` 限制，每轮都传工具定义，多步任务不再必失败
- `MAX_TOOL_ROUNDS` 按意图分级：`chat/vision=1`，`task/code=15`（原值：全局 3）
- 新增 `MAX_EMPTY_TOOL_ROUNDS=2`：连续全部失败自动退出，防无限循环
- `_truncateToolContent(toolResult, toolName)`：工具输出超 2000 字符自动截断，防上下文溢出
- `bash_run` 失败时补充 `isError: true` + `exitCode` + `stderr`，LLM 可针对性重试

**P1 — 任务完成质量提升：**
- `_preFetchFileContext(intent, userText)`：task/code 意图时预读相关目录（桌面/提及路径），注入 system prompt
- 代码文件写入后自动注入验证提示，引导 LLM 主动用 bash_run 运行验证
- 轮次耗尽兜底：`finalText` 为空时强制追加无工具收尾调用，替代 fallback 文案
- `file_write` 从 `_legacyMapping`（Python 层）迁移到原生 `_fileWrite`，消除静默失败
- `file_read` 从 `_legacyMapping` 迁移到原生 `_fileRead`（已支持 `offset`/`limit` 行范围）

**P2 — 交互与原子性：**
- 任务中途可注入指令：`pendingInjections` Map + `injectMessage(runId, text)` 方法，每轮循环顶部消费
- IPC handler `agent:inject-message` + preload 桥接 `injectMessage`
- `multi_file_edit` 技能：原子化编辑最多 10 个文件，预检→备份→写入→失败全部回滚
- 安全工具（非 mutating）改为 `Promise.all` 并发执行，变更工具保持串行+审批

**P3 — 代码理解与项目感知：**
- `grep_search` 技能：正则搜索目录内所有文件内容，返回匹配行+上下文，支持文件名过滤
- `git_ops` 技能：status/diff/log/branch/commit 五种操作，支持指定仓库路径
- `_buildFileTree(rootPath, maxDepth, maxItems)`：层级文件树构建，过滤 node_modules/.git 等无关目录
- `_truncateToolContent` 语义升级：超长 content 保留头 30 行 + 尾 10 行，而非硬截断前 N 字符
- `_executeToolWithRetry`：网络类工具（web_search/web_fetch/weather_get）自动重试，捕获 throw 型网络异常

**当前内置技能总览（18 个）：**
| 技能 | 层 | 类型 |
|------|----|------|
| bash_run | Node 原生 | 高危+确认 |
| file_read | Node 原生 | 安全 |
| file_write | Node 原生 | 危险+确认 |
| file_edit | Node 原生 | 危险+确认 |
| file_list | Node 原生 | 安全 |
| file_search | Node 原生 | 安全 |
| multi_file_edit | Node 原生 | 危险+确认 |
| grep_search | Node 原生 | 安全 |
| git_ops | Node 原生 | 安全（commit除外） |
| memory_search | Node 原生 | 安全 |
| web_search | Node 原生 | 安全 |
| web_fetch | Node 原生 | 安全 |
| weather_get | Node 原生 | 安全 |
| open_app | Node 原生 | 危险+确认 |
| open_url | Node 原生 | 安全 |
| clipboard_set | Node 原生 | 安全 |
| reminder_create | Node 原生 | 安全 |
| screenshot_ocr | Node 原生 | 安全 |

**Agent 架构关键参数：**
```javascript
MAX_TOOL_ROUNDS_BY_INTENT = { chat:1, vision:1, task:15, code:15 }
MAX_EMPTY_TOOL_ROUNDS = 2        // 连续全失败退出阈值
_truncateToolContent MAX = 2000  // 工具输出字符上限
_preFetchFileContext 目录数 = 2  // 最多预读目录数
_buildFileTree maxItems = 60     // 文件树最多条目
grep_search max_results = 50     // 搜索结果上限
multi_file_edit 最大文件数 = 10
```

#### 2026-03 聊天窗口重设计（团队协作完善产品）

**改造目标：** 从"AI工具"转向"有温度的数字生命"

**涉及文件：**
- `windows/chat-window.html` - 聊天窗口全面重设计
- `main-process/agent-runtime.js` - P0 Bug 修复
- `src/theme-manager.js` - 默认主题改为 lazyCat（暖色）

**主要改动：**
1. **移除 240px 侧边栏** → 改为 58px 紧凑顶栏（左侧宠物头像+名字+心情条，右侧设置/历史/最小化/关闭）
2. **全新空状态设计** → Lottie 动画居中 + 暖心问候语 + 4 个快捷回复气泡按钮
3. **打字等待动画** → 从 "正在思考中..." 文本改为三点弹跳动画 + 斜体文字
4. **简化工具栏** → 只保留截图+上传，隐藏未实现的语音/视频按钮
5. **默认暖色主题** → theme-manager.js 默认改为 `lazyCat`（深暖棕+琥珀橙）
6. **宠物名称中文注入** → agent-runtime.js 宠物名用中文 prompt，避免混语言
7. **记忆系统 try-catch** → 两处 addConversation 调用增加容错，防止存储失败导致聊天崩溃
8. **快捷回复功能** → `sendQuickMsg()` 函数支持点击快捷按钮直接发送消息

**团队角色（本轮）：**
- 设计师分析：23个UX问题，重点：空状态/侧边栏/气泡对比度/加载状态
- 开发者分析：5个P0 Bug（DOM泄漏/无try-catch/无stream/宠物名混语言/历史10条）
- 测试员：下一轮验证

**待处理（P1 下一轮）：**
- 消息气泡对比度（bubble-bg 在 lazyCat 主题下的可读性）
- 消息时间戳显示
- 右键消息菜单（复制、重新生成）
- 气泡最大宽度优化 `max-width: min(520px, 85%)`

#### 2026-03 网络搜索系统彻底修复

**根本原因分析（经实机测试）：**
- DuckDuckGo Instant API (`api.duckduckgo.com`) 对新闻/趣闻类查询返回空结果（只适合知识卡片）
- `_searchDuckDuckGoHtml` 正则 `class="result__body"` 与实际 class `"links_main links_deep result__body"` 不匹配，导致 0 个 block 被解析
- DDG HTML 跳转 URL 格式为 `//duckduckgo.com/l/?uddg=ENCODED_URL`，旧代码未解码直接使用
- `html.duckduckgo.com` **在中国可正常访问且返回 10 条真实结果**（Bing HTML/RSS、Google News RSS 均不可用）
- 意图分类遗漏：「今天的新闻」无任务关键词 → chat 意图 → MAX_TOOL_ROUNDS=1，搜索失败无法重试

**修复内容：**
- `main-process/skill-executor.js`：
  - `_fetchTextUrl`：User-Agent 从 `AI-Desktop-Pet/1.0` 改为真实 Chrome UA，添加 Accept-Language
  - `_searchDuckDuckGoHtml`（重写）：直接匹配 `class="result__a"` 链接，解码 uddg URL，与 snippets 数组对齐提取摘要
  - `_webSearch`：降级链改为 DDG HTML（主力）→ DDG Instant（知识补充）→ Google News RSS（新闻备用）
  - 删除 `_searchBingHtml` 和 `_searchBingNewsRss`（Bing 需要 JS 渲染或 Cookie，静态 HTTP 请求无效）
  - `_looksLikeNewsQuery`：扩展匹配词（趣闻/资讯/最新/today/news 等）
- `main-process/agent-runtime.js`：
  - 新增 `search` 意图：`MAX_TOOL_ROUNDS_BY_INTENT.search = 3`
  - `classifyIntent`：添加搜索意图检测（新闻/热点/趣闻/天气/查一下 等关键词 → search），优先级低于 task/code
  - 意图顺序调整：先检测 vision，再 task/code，再 search，最后 chat

**搜索降级链（当前）：**
```
html.duckduckgo.com → DDG Instant API → Google News RSS（新闻类）
```
**关键数字：** html.duckduckgo.com 实测返回 10 条中文搜索结果，URL 经 uddg 解码为真实链接

#### 2026-03 内置 API Key + 切换 Qwen（重大架构简化）

**改造目标：** 从"用户自带 API Key"转向"内置 AI 服务，开箱即用"，为后续订阅套餐模式做准备。

**涉及文件：**
- `main-process/builtin-api.js` - **新增**：集中式内置 API 配置（Qwen 3.5 Plus，单一数据源）
- `main-process/model-router.js` - **重写**：从 300 行多 provider 路由简化为 70 行，所有意图统一走内置 API
- `main-process/config.js` - **更新**：事实提取从 DeepSeek 改为 Qwen
- `main-process/fact-extractor.js` - **更新**：默认使用内置 API 配置
- `main-process/extractor.js` - **更新**：API 端点从 DeepSeek 改为 Qwen
- `main-process/embeddings.js` - **更新**：远程嵌入端点更新（实际使用本地 ONNX）
- `main.js` - **大幅删减**：移除 ~250 行 API Key 管理代码（readApiKeysFile/writeApiKeysFile/saveProviderApiKey/maskApiKey/syncMemoryApiKey/getSceneCredential 等）；移除所有 API Key IPC handlers；getSceneConfig/getTaskSceneConfig 简化为直接返回内置配置
- `preload.js` - **精简**：移除 10+ 个 API Key 桥接方法，新增 `getBuiltinAPIKey` 单一桥接
- `src/api.js` - **重写**：从 DeepSeek 直连改为通过内置 Qwen API 路由
- `src/storage.js` - **更新**：默认场景配置从 DeepSeek 改为 Qwen
- `src/settings-window-utils.js` - **更新**：默认场景配置从 DeepSeek 改为 Qwen
- `src/settings-window-runtime.js` - **精简**：移除 API Key CRUD 函数
- `src/app-vanilla.js` - **精简**：移除初始化向导中的 API Key 保存逻辑
- `windows/settings-window.html` - **重设计**："AI 模型"→"AI 引擎"信息卡，移除整个 API Key 管理面板
- `windows/init-window.html` - **精简**：从 4 步向导缩减为 3 步（移除 API Key 配置步骤）
- `src/memory/extractor.js` - **更新**：渲染端事实提取改用 Qwen
- `src/memory/embeddings.js` - **更新**：渲染端嵌入端点更新

**关键设计决策：**
- **内置 API**: `main-process/builtin-api.js` 是所有 AI 调用的唯一凭证来源
- **模型**: Qwen 3.5 Plus（全模态：文本+视觉+工具调用）
- **端点**: `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`（OpenAI 兼容格式）
- **用户不再需要**: 配置任何 API Key、选择 Provider、管理场景密钥
- **删除文件/功能**: `api-keys.json` 读写、`PROVIDER_ENV_KEY_MAP`、`OPENAI_COMPAT_PROVIDERS`、多 provider 降级链、场景专属 Key、Provider 测试连通性
- **保留兼容**: `dotenv` 加载保留（其他功能可能用）、`llmSceneConfig` 变量保留（内部消费者可能引用）

**API 调用链路（简化后）：**
```
用户消息 → agent-runtime.classifyIntent()
         → modelRouter.route(intent) → BUILTIN_API.getRoute(scene)
         → HTTP 调用 dashscope.aliyuncs.com
```

**迁移影响：**
- 已有用户的 `api-keys.json` 不会被删除，但不再读取
- 设置面板 AI Key 管理区域替换为引擎信息展示
- 初始化向导减少一步，体验更流畅

### 重要提醒
- 必须回复我中文
- 每次重大改动，都要更新CLAUDE.md文件，保证后续开发顺利
- 每次对话后都要添加hello