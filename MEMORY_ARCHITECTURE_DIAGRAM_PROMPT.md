# AI 桌面宠物 - 记忆系统架构图生成提示词

## 目标

生成一张清晰的技术架构图，展示 AI 桌面宠物记忆系统的完整架构，包括所有核心组件、数据流和技术栈。

---

## 图表类型

**推荐：** 系统架构图 (System Architecture Diagram)
**备选：** 流程图 (Flowchart) 或 分层架构图 (Layered Architecture)

---

## 核心组件要求

### 1. 用户界面层
- **桌面宠物窗口** - 400x500px 透明窗口，可拖拽
- **托盘图标** - 显示/隐藏/退出功能
- **聊天界面** - 点击宠物显示，包含：
  - 消息历史显示
  - 文本输入框
  - 性格切换按钮

### 2. 主进程层 (Main Process - Electron)
- **main.js** - 应用入口
- **IPC 通信** - preload.js 桥接渲染进程

### 3. 记忆系统核心 (main-process/)

#### 3.1 数据库层
**MemoryStorage** (`database.js`)
- SQLite 数据库: `pet-memory.db`
- 位置: `%APPDATA%\ai-desktop-pet\pet-memory.db`
- 表结构:
  - `conversations` - 完整对话记录
  - `memory_chunks` - 文本分块
  - `memory_facts` - 结构化事实（预留）
  - `embedding_cache` - 向量缓存（预留）

**关键方法：**
- `saveConversation()` - 保存对话
- `saveMemoryChunk()` - 保存分块
- `getConversations()` - 查询对话
- `getCachedEmbedding()` - 获取嵌入缓存
- `evictLRUCache()` - LRU 淘汰

#### 3.2 搜索引擎层
**MemorySearchEngine** (`search.js`)
- 关键词匹配搜索
- 时间衰减算法（7天半衰期）
- 心情相似度加权

**关键方法：**
- `search()` - 主搜索入口
- `keywordSearch()` - 关键词匹配
- `calculateTemporalWeight()` - 时间衰减计算
- `applyMoodModulation()` - 心情调制

#### 3.3 嵌入服务层
**EmbeddingService** (`embeddings.js`)
- Fallback 嵌入生成（字符级哈希）
- 批量处理支持
- LRU 缓存管理

#### 3.4 上下文构建层
**ContextBuilder** (`context.js`)
- 记忆格式化
- 情感上下文生成
- 系统提示词构建

#### 3.5 协调器层
**MemoryMainProcess** (`memory.js`)
- 统一入口
- IPC 处理器注册
- 模块初始化协调

### 4. 渲染进程层 (Renderer Process - src/)

#### 4.1 数据存储
**PetStorage** (`storage.js`)
- LocalStorage 封装
- 对话历史管理
- 用户设置存储

#### 4.2 API 客户端
**PetAPI** (`api.js`)
- DeepSeek API 调用
- 消息发送接收
- 记忆系统集成

#### 4.3 性格系统
**PersonalityPrompts** (`prompts.js`)
- 4种性格定义（治愈、搞笑、傲娇、助理）
- 系统提示词生成
- 主动说话语料

#### 4.4 主应用逻辑
**App-Vanilla** (`app-vanilla.js`)
- UI 交互逻辑
- 状态管理
- 事件处理

---

## 数据流展示

### 对话保存流程
```
用户输入消息
  ↓
app-vanilla.js: chatWithAI()
  ↓
api.js: saveConversationToMemory()
  ↓
IPC → MemoryMainProcess.addConversation()
  ↓
MemoryStorage.saveConversation() → SQLite conversations表
  ↓
同步保存分块 → saveMemoryChunk() → memory_chunks表
  ↓
返回成功
```

### 记忆搜索流程
```
用户发送新消息
  ↓
api.js: getMemoryContext()
  ↓
IPC → MemoryMainProcess.getContext()
  ↓
MemorySearchEngine.search()
  ↓
1. 关键词匹配 conversations 表
2. 应用时间衰减（24h×1.5, 7d×1.2, 30d×0.7）
3. 应用心情相似度（相似心情×1.2）
4. 排序取Top 3
  ↓
ContextBuilder.build() → 格式化为AI上下文
  ↓
注入到系统提示词
  ↓
AI 生成回复
```

---

## 技术栈标签

请在架构图中标注以下技术栈：

**核心框架:**
- Electron 40+
- Node.js (Better-SQLite3)

**前端:**
- Vanilla JavaScript (ES6+)
- CSS3

**后端:**
- CommonJS 模块系统
- SQLite 3
- IPC (Inter-Process Communication)

**AI:**
- DeepSeek API (聊天)
- Fallback 嵌入（本地哈希）

---

## 关键特性标注

### 🔤 情感智能
- **时间感知**: 24小时内记忆加权 1.5x
- **心情感知**: 相似心情记忆加权 1.2x
- **性格适配**: 根据当前性格调整回应风格

### ⚡ 性能优化
- **关键词搜索**: <1ms 响应
- **同步保存**: <50ms 对话保存
- **LRU 缓存**: 自动淘汰最久未使用

### 💾 持久化
- **数据库**: SQLite 轻量级数据库
- **位置**: `%APPDATA%\ai-desktop-pet\pet-memory.db`
- **重启保持**: 完整持久化，重启不丢失

### 🛡️ 稳定性
- **错误处理**: 多层级 try-catch
- **降级策略**: API 失败时使用 fallback
- **异步安全**: 同步关键操作，避免卡死

---

## 视觉设计建议

### 布局建议
```
┌─────────────────────────────────────────┐
│              用户桌面                   │
│  ┌──────────┐                           │
│  │ 桌面宠物  │  ← 透明、可拖拽         │
│  └──────────┘                           │
│                                           │
│  ┌─────────────────────────────────┐   │
│  │  记忆系统 (SQLite Database)      │   │
│  │  ├─ conversations               │   │
│  │  ├─ memory_chunks             │   │
│  │  ├─ memory_facts               │   │
│  │  └─ embedding_cache           │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 组件关系
- **主进程** → **记忆系统** → **SQLite**
- **渲染进程** ↔️ **IPC** ↔️ **主进程**
- **用户** → **宠物界面** → **记忆保存**

---

## 配色方案

- **数据库**: 🟦 橙色 (数据存储)
- **搜索引擎**: 🟢 绿色 (处理逻辑)
- **嵌入服务**: 🟣 紫色 (AI能力)
- **上下文构建**: 🟨 粉色 (格式化)
- **协调器**: 🟪 灰色 (中央调度)

---

## 标注要点

1. **显示文件名**: 在每个组件旁标注文件名（如 `database.js`）
2. **显示数据流**: 用箭头标注数据流向
3. **标注关键特性**: 在重要组件旁标注核心特性
4. **分层展示**: 按用户界面 → 主进程 → 数据库 三层展示
5. **技术栈标签**: 用标签标明使用的技术
6. **性能指标**: 标注关键性能数据（如 <1ms 搜索）

---

## 图表风格

- **现代、扁平化设计**
- **清晰的颜色区分**
- **适当的图标和符号**（使用 emoji）
- **专业的技术架构图风格**
- **中文标签**，英文技术术语

---

## 预期输出

一张清晰的系统架构图，适合：
- 技术文档
- 代码理解
- 团队协作
- 项目展示

应该让任何开发者一眼就能看懂：
1. 系统有哪些组件
2. 组件之间的关系
3. 数据如何流动
4. 使用了什么技术
5. 有哪些关键特性
