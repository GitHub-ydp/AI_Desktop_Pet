# AI Desktop Pet — 架构摘要

## 1. Tool Call 完整流程

### 调用链

```
用户消息
  ↓
chatWithAI() [src/api.js:660]
  ├── getMemoryContext(userMessage)     → 异步获取记忆上下文
  ├── 构建 system prompt（性格 + 记忆上下文）
  ├── PetWorkflow.listTools()          → 获取工具定义（12 个 MVP 工具）
  ├── callDeepSeekAPI(messages, personality, { tools })
  │     ├── getChatSceneConfig()       → 从 localStorage 读取 provider/model
  │     ├── getProviderAPIKey()        → IPC 获取 API Key
  │     ├── fetch(endpoint, requestBody) → 调用 LLM API
  │     └── 返回 { type: 'text'|'tool_calls', ... }
  │
  ├── if type === 'tool_calls':
  │     └── handleToolCallsLoop() [src/api.js:389]
  │           ├── 最多 3 轮循环
  │           ├── 将 assistant tool_calls message 加入 messages
  │           ├── for each toolCall:
  │           │     ├── PetWorkflow.execute(toolName, args)
  │           │     │     ↓ IPC: workflow:execute
  │           │     │     ↓ WorkflowManager.execute()
  │           │     │     ↓ PythonBridge → executor.py → file_ops/system_ops
  │           │     └── 将 tool result 以 role:'tool' 加入 messages
  │           └── callDeepSeekAPI(messages, personality)  ← 再次调用
  │
  └── saveConversationToMemory()       → 异步保存到 SQLite
```

### 关键细节

- **DSML 解析**: `parseDSMLToolCalls()` 处理 DeepSeek 特殊格式的工具调用（`<｜DSML｜>` 标签）
- **工具名转换**: API 格式 `file_ops_list_files` → Python 格式 `file_ops.list_files`（`_ops_` → `_ops.`）
- **安全校验**: WorkflowManager 禁止路径穿越（`..`）和系统目录访问
- **错误处理**: 连续 3 次 API 错误后降级到 `getMockResponse()`

## 2. 多模型 API Key 存储结构

### 存储位置

```
%APPDATA%/ai-desktop-pet/api-keys.json
```

### 文件格式

```json
{
  "deepseek": "sk-xxxx...",
  "openai": "sk-xxxx...",
  "openrouter": "sk-or-xxxx...",
  "siliconflow": "sk-xxxx...",
  "glm": "xxxx.xxxx",
  "qwen": "sk-xxxx..."
}
```

### 支持的 Provider

| Provider | Endpoint | 默认模型 | 环境变量 |
|----------|----------|----------|----------|
| deepseek | api.deepseek.com | deepseek-chat | DEEPSEEK_API_KEY |
| openai | api.openai.com | gpt-4o-mini | OPENAI_API_KEY |
| openrouter | openrouter.ai | openai/gpt-4o-mini | OPENROUTER_API_KEY |
| siliconflow | api.siliconflow.cn | Qwen/Qwen2.5-72B-Instruct | SILICONFLOW_API_KEY |
| glm | open.bigmodel.cn | glm-4-flash | GLM_API_KEY |
| qwen | dashscope.aliyuncs.com | qwen-turbo | DASHSCOPE_API_KEY |

### 场景配置 (LLM Scene Config)

存储在 `localStorage.settings.llmSceneConfig`：

```json
{
  "chat": { "provider": "deepseek", "model": "deepseek-chat" },
  "vision": { "provider": "deepseek", "model": "deepseek-chat" },
  "translate": { "provider": "deepseek", "model": "deepseek-chat" },
  "ocr": { "provider": "tesseract", "model": "tesseract" }
}
```

### IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `get-api-key` | renderer→main | 获取 DeepSeek Key（兼容旧版） |
| `get-provider-api-key` | renderer→main | 获取指定 provider 的 Key |
| `save-provider-api-key` | renderer→main | 保存 Key 到 api-keys.json |
| `get-all-provider-keys` | renderer→main | 获取所有 Key（脱敏）：`{ masked, configured, source }` |
| `test-provider-api-key` | renderer→main | 测试 Key 连通性（GET /v1/models） |

### Key 优先级

```
api-keys.json（UI 保存） > .env 环境变量
```

## 3. Python 工具层能力

### 架构

```
WorkflowManager (main-process/workflow-manager.js)
  ↓ IPC: workflow:execute
PythonBridge (main-process/python-bridge.js)
  ↓ stdin/stdout JSON 协议
executor.py (python-tools/executor.py)
  ├── file_ops.py    ← 文件操作
  └── system_ops.py  ← 系统操作
```

### 工具清单（12 个）

#### file_ops（8 个）

| 工具名 | 说明 | 安全 |
|--------|------|------|
| file_ops_list_files | 列出目录文件，支持通配符 | 安全 |
| file_ops_read_file | 读取文本文件（≤1MB） | 安全 |
| file_ops_write_file | 写入/创建文本文件 | 危险 |
| file_ops_move_file | 移动/重命名文件 | 危险 |
| file_ops_copy_file | 复制文件 | 安全 |
| file_ops_delete_file | 删除文件（回收站） | 危险 |
| file_ops_get_file_info | 获取文件详情 | 安全 |
| file_ops_search_files | 按名称/内容搜索 | 安全 |

#### system_ops（4 个）

| 工具名 | 说明 | 安全 |
|--------|------|------|
| system_ops_open_app | 打开应用（白名单限制） | 危险 |
| system_ops_open_url | 打开 URL（仅 HTTPS） | 安全 |
| system_ops_get_system_info | 获取系统信息 | 安全 |
| system_ops_set_clipboard | 设置剪贴板 | 安全 |

### 安全机制

- **路径白名单**: 默认只允许用户家目录 `$HOME`
- **路径黑名单**: `C:\Windows`、`C:\Program Files` 等
- **扩展名黑名单**: `.exe`、`.bat`、`.cmd`、`.ps1`、`.dll` 等
- **应用白名单**: 仅 7 个应用（notepad/code/explorer/chrome/edge/firefox/calc）
- **URL 限制**: 仅 HTTPS，禁止内网地址
- **文件大小限制**: 读 1MB、写 10MB
- **递归深度**: 最大 5 层

## 4. 记忆系统构建 System Prompt

### 上下文构建流程

```
chatWithAI() [src/api.js:660]
  ↓
getMemoryContext(userMessage)
  ↓ IPC: memory:get-context
MemoryMainProcess.getContext()
  ├── searchEngine.search(query, options)     → 混合搜索（BM25 + 向量 + 时间 + 重要性）
  ├── _reinforceHitMemories(results)          → FSRS 强化被命中的记忆
  └── contextBuilder.build(results, options)
        ├── 有 memoryLayerManager → 分层构建
        │     ├── Layer 1: 用户画像（~200 tokens）
        │     ├── Layer 2: 重要记忆（~800 tokens）
        │     └── Layer 3: 对话历史（~500 tokens）
        └── 无 memoryLayerManager → 传统构建
              ├── extractUserProfile()  → 名字/性别/生日/兴趣
              ├── formatMemory()        → [日期] [心情] 角色: 内容
              └── formatFacts()         → 按性格排序的事实列表
```

### 最终 System Prompt 结构

```
[性格提示词（PersonalityPrompts）]

========== 我们的对话记录 ==========
【用户画像】
  用户名字: xxx
  性别: xx

【重要记忆/对话记录】
  [2026-03-01] [开心] 用户: xxx
  [2026-03-01] 我: xxx

【关于我的重要信息】
  偏好：xxx；事件：xxx；

【当前对话】用户说：xxx
========== 请自然地回应 ==========
```

### 搜索评分公式

```
finalScore = 0.3×keywordScore + 0.4×vectorScore + 0.2×temporalScore + 0.1×importanceScore
```

- keywordScore: BM25（中文 bigram 分词）或 LIKE 降级
- vectorScore: 本地 ONNX 嵌入余弦相似度（bge-small-zh-v1.5，512 维）
- temporalScore: `0.5^(hours/168)` 7 天半衰期
- importanceScore: 情感权重

## 5. 现有 IPC 通道清单

### window.electron

| API | IPC 通道 | 说明 |
|-----|----------|------|
| moveWindow | move-window | 窗口拖动 |
| minimizeWindow | minimize-window | 最小化 |
| getAppVersion | get-app-version | 版本号 |
| getAPIKey | get-api-key | DeepSeek Key（旧版） |
| getProviderAPIKey | get-provider-api-key | 多 Provider Key |
| saveProviderAPIKey | save-provider-api-key | 保存 Key |
| getAllProviderAPIKeys | get-all-provider-keys | 所有 Key（脱敏） |
| testProviderAPIKey | test-provider-api-key | 测试连通性 |
| openDevTools | open-devtools | 开发者工具 |
| listLottieJsonFiles | lottie:list-json-files-sync | 列出 Lottie 文件 |
| resizeWindow | resize-window | 调整窗口大小 |
| createChildWindow | create-child-window | 创建子窗口 |
| closeChildWindow | close-child-window | 关闭子窗口 |
| sendToChildWindow | send-to-child-window | 子窗口通信 |
| openMenuWindow | menu:open | 打开菜单 |
| closeMenuWindow | menu:close | 关闭菜单 |
| toggleMenuWindow | menu:toggle | 切换菜单 |
| isMenuWindowOpen | menu:is-open | 菜单状态 |
| sendChatMessage | chat:send | 发送聊天 |
| showBubble | bubble:show | 显示气泡 |
| hideBubble | bubble:hide | 隐藏气泡 |

### window.PetMemory

| API | IPC 通道 |
|-----|----------|
| initialize | memory:init |
| addConversation | memory:add-conversation |
| searchMemories | memory:search |
| getContext | memory:get-context |
| getFacts | memory:get-facts |
| getUserProfile | memory:get-user-profile |
| getStats | memory:get-stats |
| clearAll | memory:clear-all |
| export | memory:export |
| import | memory:import |
| migrateFromLocalStorage | memory:migrate-localstorage |
| getEmbeddingStatus | memory:embedding-status |
| flushFacts | memory:flush-facts |
| getLayeredContext | memory:get-layered-context |

### window.PetReminder

| API | IPC 通道 |
|-----|----------|
| create | reminder:create |
| getAll | reminder:get-all |
| getPending | reminder:get-pending |
| cancel | reminder:cancel |
| delete | reminder:delete |
| getPreference | reminder:get-preference |
| analyzeHabits | reminder:analyze-habits |
| getHistory | reminder:get-history |
| onReminderTriggered | reminder:triggered (事件) |
| onOverdue | reminder:overdue (事件) |

### window.PetTools

| API | IPC 通道 |
|-----|----------|
| execute | tool:execute |
| list | tool:list |
| getHistory | tool:get-history |
| clearHistory | tool:clear-history |

### window.PetScreenshot

| API | IPC 通道 |
|-----|----------|
| getSources | screenshot:get-sources |
| captureRegion | screenshot:capture-region |
| captureFullScreen | screenshot:capture-fullscreen |
| copyToClipboard | screenshot:copy-to-clipboard |
| getHistory | screenshot:get-history |
| getById | screenshot:get-by-id |
| delete | screenshot:delete |
| permanentlyDelete | screenshot:permanently-delete |
| analyze | screenshot:analyze |
| ocr | screenshot:ocr |
| translate | screenshot:translate |
| getAnalyses | screenshot:get-analyses |
| getStatistics | screenshot:get-statistics |
| cleanup | screenshot:cleanup |

### window.ScreenshotBridge

| API | IPC 通道 |
|-----|----------|
| getScreenCapture | screenshot:get-screen-capture |
| selectRegion | screenshot:region-selected |
| cancel | screenshot:capture-cancel |
| copyDataToClipboard | screenshot:copy-data |
| saveQuick | screenshot:save-quick |
| saveAs | screenshot:save-as |
| pinToDesktop | screenshot:pin |
| analyze | screenshot:analyze-image |
| ocr | screenshot:ocr-image |
| translate | screenshot:translate-image |
| getWindowList | screenshot:get-windows |
| setPinOpacity | pin:set-opacity |
| closePinWindow | pin:close |

### window.PetHealth

| API | IPC 通道 |
|-----|----------|
| getAll | health:get-all |
| getConfig | health:get-config |
| updateConfig | health:update-config |
| batchUpdate | health:batch-update |
| getTodayStats | health:get-today-stats |
| getStatsHistory | health:get-stats-history |
| getHistory | health:get-history |
| respond | health:respond |
| snooze | health:snooze |
| onTriggered | health:triggered (事件) |

### window.PetTask

| API | IPC 通道 |
|-----|----------|
| create | task:create |
| get | task:get |
| getAll | task:get-all |
| getToday | task:get-today |
| getPending | task:get-pending |
| update | task:update |
| complete | task:complete |
| cancel | task:cancel |
| delete | task:delete |
| getTodayStats | task:get-today-stats |
| getHistory | task:get-history |
| getCalendar | task:get-calendar |
| getPetReminder | task:get-pet-reminder |
| onEvent | task:event (事件) |

### window.PetWidget

| API | IPC 通道 |
|-----|----------|
| getAll | widget:get-all |
| refresh | widget:refresh |
| getWeather | widget:get-weather |
| setWeatherLocation | widget:set-weather-location |
| getCalendar | widget:get-calendar |
| getTodo | widget:get-todo |
| getConfig | widget:get-config |
| updateConfig | widget:update-config |
| toggle | widget:toggle |

### window.PetWorkflow

| API | IPC 通道 |
|-----|----------|
| execute | workflow:execute |
| listTools | workflow:list-tools |
| getDesktopPath | workflow:get-desktop-path |
| abort | workflow:abort |

### window.PetFile

| API | IPC 通道 |
|-----|----------|
| getFileInfo | file:get-info |
| copyPath | file:copy-path |
| copyContent | file:copy-content |
| showInFolder | file:show-in-folder |
| moveToTrash | file:move-to-trash |
| rename | file:rename |
| getPreview | file:get-preview |
| getAvailableActions | file:get-available-actions |
