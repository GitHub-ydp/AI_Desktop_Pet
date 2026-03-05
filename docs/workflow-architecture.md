# 工作流执行系统 - 架构设计文档

> 版本: 1.0 | 日期: 2026-02-22 | 作者: architect

---

## 1. 系统总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                       │
│                                                                   │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────────────┐   │
│  │ 用户输入  │──▶│  api.js      │──▶│  app-vanilla.js        │   │
│  │ (聊天框)  │   │  (AI 通信)   │   │  (工作流结果 UI 展示)   │   │
│  └──────────┘   └──────┬───────┘   └────────────────────────┘   │
│                         │                                         │
│                         │ tool_calls 检测                         │
│                         ▼                                         │
│              ┌─────────────────────┐                              │
│              │ workflow-handler.js  │  (渲染进程工具调用协调器)     │
│              │ window.WorkflowAPI   │                              │
│              └──────────┬──────────┘                              │
│                         │                                         │
├─────────────────────────┼─────────────────────────────────────────┤
│         preload.js      │  contextBridge (IPC 桥接)               │
│  window.PetWorkflow = { │                                         │
│    execute(),           │                                         │
│    listTools(),         │                                         │
│    getDesktopPath()     │                                         │
│  }                      │                                         │
├─────────────────────────┼─────────────────────────────────────────┤
│                         │                                         │
│                    主进程 (Main Process)                           │
│                         │                                         │
│              ┌──────────▼──────────┐                              │
│              │ workflow-manager.js  │  (主进程工作流管理器)         │
│              │ IPC handlers 注册    │                              │
│              └──────────┬──────────┘                              │
│                         │                                         │
│              ┌──────────▼──────────┐                              │
│              │ python-bridge.js    │  (Python 进程管理)            │
│              │ - 懒启动 / 池管理    │                              │
│              │ - stdin/stdout JSON  │                              │
│              │ - 超时 / 重启        │                              │
│              └──────────┬──────────┘                              │
│                         │                                         │
├─────────────────────────┼─────────────────────────────────────────┤
│                         │  子进程 (Child Process)                  │
│              ┌──────────▼──────────┐                              │
│              │  python executor    │                               │
│              │  (executor.py)      │                               │
│              │  ┌────────────────┐ │                               │
│              │  │ file_ops.py    │ │  文件操作工具                  │
│              │  │ system_ops.py  │ │  系统操作工具                  │
│              │  │ web_ops.py     │ │  网络操作工具                  │
│              │  └────────────────┘ │                               │
│              └─────────────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

### 架构层次说明

| 层次 | 职责 | 关键文件 |
|------|------|----------|
| 渲染层 | AI 对话、tool_calls 检测、结果展示 | `api.js`, `app-vanilla.js`, `workflow-handler.js` |
| IPC 桥接 | 安全通道、参数校验 | `preload.js` |
| 主进程层 | 工具注册、权限检查、进程管理 | `workflow-manager.js`, `python-bridge.js` |
| Python 层 | 实际桌面操作执行 | `executor.py`, `file_ops.py`, `system_ops.py` |

---

## 2. 完整数据流

```
用户输入 "帮我整理一下桌面上的图片文件"
  │
  ▼
[1] api.js: chatWithAI()
  │  构建 messages 数组（含 system prompt + 历史 + 用户消息）
  │  在 API 请求中附加 tools 参数（DeepSeek function calling）
  │
  ▼
[2] DeepSeek API 返回
  │  检查 response.choices[0].message.tool_calls
  │  ├── 无 tool_calls → 正常文本回复，流程结束
  │  └── 有 tool_calls → 进入工具调用流程
  │
  ▼
[3] api.js: handleToolCalls()
  │  遍历 tool_calls 数组
  │  对每个 tool_call:
  │    - 解析 function.name 和 function.arguments
  │    - 通过 window.PetWorkflow.execute(name, args) 调用 IPC
  │
  ▼
[4] preload.js: IPC 桥接
  │  ipcRenderer.invoke('workflow:execute', toolName, args)
  │
  ▼
[5] main.js → workflow-manager.js: IPC handler
  │  - 校验 toolName 是否在注册表中
  │  - 校验参数安全性（路径白名单、大小限制等）
  │  - 分发到 python-bridge.js 或内置 JS 工具
  │
  ▼
[6] python-bridge.js: 发送请求到 Python 子进程
  │  通过 stdin 写入单行 JSON:
  │  {"request_id":"abc123","tool":"file_ops.list_files","params":{"path":"~/Desktop","filter":"*.jpg"}}
  │
  ▼
[7] Python executor.py: 接收并执行
  │  - 解析 JSON
  │  - 路由到对应工具模块 (file_ops.list_files)
  │  - 执行操作
  │  - 通过 stdout 写入单行 JSON 结果:
  │  {"request_id":"abc123","success":true,"result":{"files":["photo1.jpg","photo2.jpg"]}}
  │
  ▼
[8] python-bridge.js: 接收结果
  │  解析 JSON，resolve 对应 Promise
  │
  ▼
[9] workflow-manager.js → IPC 返回
  │  {success: true, result: {files: [...]}}
  │
  ▼
[10] api.js: 将工具结果回传给 DeepSeek
  │  构建 tool result message:
  │  {role: "tool", tool_call_id: "call_xxx", content: JSON.stringify(result)}
  │  再次调用 API 获取最终自然语言回复
  │
  ▼
[11] app-vanilla.js: 展示最终回复
  │  "我找到了桌面上 2 张图片文件：photo1.jpg 和 photo2.jpg~"
  │  同时保存对话到记忆系统
```

---

## 3. Python <-> Electron 通信协议

### 3.1 协议规范

- **传输方式**: stdin/stdout，每条消息占一行（`\n` 分隔）
- **编码**: UTF-8
- **格式**: 单行 JSON（无换行符）
- **stderr**: 保留给 Python 日志输出，不参与协议

### 3.2 请求格式 (Electron → Python)

```json
{
  "request_id": "req_1708617600_a1b2c3",
  "tool": "file_ops.list_files",
  "params": {
    "path": "C:/Users/xxx/Desktop",
    "filter": "*.jpg",
    "recursive": false
  },
  "timeout": 30000
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `request_id` | string | 是 | 唯一请求 ID，格式 `req_{timestamp}_{random}` |
| `tool` | string | 是 | 工具全名，格式 `{module}.{function}` |
| `params` | object | 是 | 工具参数，由 AI function calling 提供 |
| `timeout` | number | 否 | 超时毫秒数，默认 30000 |

### 3.3 响应格式 (Python → Electron)

**成功响应：**
```json
{
  "request_id": "req_1708617600_a1b2c3",
  "success": true,
  "result": {
    "files": [
      {"name": "photo1.jpg", "size": 1024000, "modified": "2026-02-20T10:30:00Z"}
    ],
    "total": 1
  }
}
```

**错误响应：**
```json
{
  "request_id": "req_1708617600_a1b2c3",
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "无法访问路径: C:/Windows/System32"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `request_id` | string | 是 | 与请求对应的 ID |
| `success` | boolean | 是 | 执行是否成功 |
| `result` | any | 条件 | 成功时的结果数据 |
| `error` | object | 条件 | 失败时的错误信息 |
| `error.code` | string | 是 | 错误码（枚举值） |
| `error.message` | string | 是 | 人类可读的错误描述 |

### 3.4 特殊消息

**心跳（Electron → Python）：**
```json
{"request_id": "heartbeat", "tool": "__ping__", "params": {}}
```

**心跳响应（Python → Electron）：**
```json
{"request_id": "heartbeat", "success": true, "result": "pong"}
```

**关闭（Electron → Python）：**
```json
{"request_id": "shutdown", "tool": "__shutdown__", "params": {}}
```

### 3.5 错误码枚举

| 错误码 | 说明 |
|--------|------|
| `TOOL_NOT_FOUND` | 工具不存在 |
| `INVALID_PARAMS` | 参数校验失败 |
| `PERMISSION_DENIED` | 路径或操作被安全策略拒绝 |
| `TIMEOUT` | 执行超时 |
| `FILE_NOT_FOUND` | 文件不存在 |
| `FILE_TOO_LARGE` | 文件超过大小限制 |
| `EXECUTION_ERROR` | 运行时错误 |
| `PYTHON_ERROR` | Python 内部异常 |

---

## 4. 新增 IPC 通道规范

### 4.1 `workflow:execute`

执行指定工具，返回结果。

```typescript
// 渲染进程调用
window.PetWorkflow.execute(toolName: string, args: object): Promise<WorkflowResult>

// IPC 定义
ipcMain.handle('workflow:execute', async (event, toolName, args) => {
  // 1. 安全校验（路径白名单、参数验证）
  // 2. 查找工具（优先 JS 内置，其次 Python）
  // 3. 执行并返回结果
  return { success: boolean, result?: any, error?: string }
})
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `toolName` | string | 工具名称，如 `file_ops.list_files` |
| `args` | object | 工具参数，来自 AI function calling |

**返回值：**
```typescript
interface WorkflowResult {
  success: boolean;
  result?: any;       // 成功时的数据
  error?: string;     // 失败时的错误消息
  duration?: number;  // 执行耗时(ms)
}
```

### 4.2 `workflow:get-desktop-path`

获取用户桌面路径（供 AI 工具使用）。

```typescript
// 渲染进程调用
window.PetWorkflow.getDesktopPath(): Promise<string>

// IPC 定义
ipcMain.handle('workflow:get-desktop-path', () => {
  return app.getPath('desktop');
})
```

### 4.3 `workflow:list-tools`

列出所有可用的工作流工具（包含 DeepSeek function calling 所需的 schema）。

```typescript
// 渲染进程调用
window.PetWorkflow.listTools(): Promise<ToolDefinition[]>

// IPC 定义
ipcMain.handle('workflow:list-tools', () => {
  return workflowManager.getToolDefinitions();
})
```

**返回值：**
```typescript
interface ToolDefinition {
  name: string;           // 工具名称
  description: string;    // 工具描述（中文）
  category: string;       // 分类
  parameters: {           // JSON Schema（用于 DeepSeek tools）
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  safe: boolean;          // 是否安全（不需要确认）
}
```

### 4.4 `workflow:abort`

中止正在执行的工具。

```typescript
// 渲染进程调用
window.PetWorkflow.abort(requestId: string): Promise<boolean>

// IPC 定义
ipcMain.handle('workflow:abort', (event, requestId) => {
  return workflowManager.abort(requestId);
})
```

### 4.5 preload.js 新增暴露

```javascript
// preload.js 中新增
contextBridge.exposeInMainWorld('PetWorkflow', {
  execute: (toolName, args) =>
    ipcRenderer.invoke('workflow:execute', toolName, args),
  listTools: () =>
    ipcRenderer.invoke('workflow:list-tools'),
  getDesktopPath: () =>
    ipcRenderer.invoke('workflow:get-desktop-path'),
  abort: (requestId) =>
    ipcRenderer.invoke('workflow:abort', requestId)
});
```

---

## 5. DeepSeek Function Calling 集成方案

### 5.1 在 callDeepSeekAPI 中添加 tools 参数

修改 `src/api.js` 中的 `callDeepSeekAPI` 函数：

```javascript
// api.js - callDeepSeekAPI 改动点

async function callDeepSeekAPI(messages, personality, options = {}) {
  // ... 现有 API Key 检查逻辑不变 ...

  // 构建请求 body
  const requestBody = {
    model: 'deepseek-chat',
    messages: messages,
    max_tokens: 500,
    temperature: 0.8,
    frequency_penalty: 0.5,
    presence_penalty: 0.3
  };

  // 如果启用了工具调用，附加 tools 参数
  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools;
    requestBody.tool_choice = 'auto';  // 让模型自行决定是否调用工具
  }

  const response = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { ... },
    body: JSON.stringify(requestBody)
  });

  // ... 现有错误处理不变 ...

  const data = await response.json();
  const choice = data.choices[0];

  // 检测 tool_calls
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
    // 返回特殊对象，让调用方处理工具调用
    return {
      type: 'tool_calls',
      toolCalls: choice.message.tool_calls,
      message: choice.message  // 保留完整 message 用于后续对话
    };
  }

  // 普通文本回复
  return {
    type: 'text',
    content: choice.message.content.trim()
  };
}
```

### 5.2 tools 参数格式（DeepSeek 兼容 OpenAI 格式）

```javascript
// 工具定义示例（从 workflow:list-tools 获取并转换）
const tools = [
  {
    type: "function",
    function: {
      name: "file_ops.list_files",
      description: "列出指定目录下的文件，支持过滤器",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "目录路径，如 '~/Desktop' 或绝对路径"
          },
          filter: {
            type: "string",
            description: "文件名过滤器，如 '*.jpg'、'*.txt'",
            default: "*"
          },
          recursive: {
            type: "boolean",
            description: "是否递归子目录",
            default: false
          }
        },
        required: ["path"]
      }
    }
  }
];
```

### 5.3 检测 tool_calls 响应

```javascript
// api.js 返回结果后，在 chatWithAI 中处理

async function chatWithAI(userMessage, personality, chatHistory) {
  // ... 现有系统提示 + 记忆上下文构建 ...

  // 获取可用工具定义
  let toolDefinitions = [];
  if (window.PetWorkflow) {
    try {
      const tools = await window.PetWorkflow.listTools();
      toolDefinitions = tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    } catch (e) {
      console.warn('[API] Failed to get workflow tools:', e);
    }
  }

  // 调用 API（附带工具定义）
  const apiResult = await callDeepSeekAPI(messages, personality, {
    tools: toolDefinitions.length > 0 ? toolDefinitions : undefined
  });

  // 处理返回结果
  if (apiResult.type === 'tool_calls') {
    return await handleToolCallsLoop(apiResult, messages, personality);
  }

  return apiResult.content;
}
```

### 5.4 tool result 回传模型获取最终回复

```javascript
// api.js - 工具调用循环

async function handleToolCallsLoop(apiResult, messages, personality) {
  const MAX_TOOL_ROUNDS = 3;  // 最多 3 轮工具调用
  let currentResult = apiResult;
  let round = 0;

  while (currentResult.type === 'tool_calls' && round < MAX_TOOL_ROUNDS) {
    round++;
    console.log(`[API] Tool call round ${round}`);

    // 将 assistant 的 tool_calls 消息加入历史
    messages.push(currentResult.message);

    // 逐个执行工具调用
    for (const toolCall of currentResult.toolCalls) {
      const { id, function: fn } = toolCall;
      const toolName = fn.name;
      const toolArgs = JSON.parse(fn.arguments || '{}');

      console.log(`[API] Executing tool: ${toolName}`, toolArgs);

      let toolResult;
      try {
        const result = await window.PetWorkflow.execute(toolName, toolArgs);
        toolResult = result.success
          ? JSON.stringify(result.result)
          : JSON.stringify({ error: result.error });
      } catch (error) {
        toolResult = JSON.stringify({ error: error.message });
      }

      // 将工具结果以 tool role 加入消息
      messages.push({
        role: "tool",
        tool_call_id: id,
        content: toolResult
      });
    }

    // 再次调用 API，让模型基于工具结果生成最终回复
    currentResult = await callDeepSeekAPI(messages, personality, {
      tools: undefined  // 最终回复不再附带工具（可选：仍然附带以支持多轮）
    });
  }

  // 返回最终文本
  if (currentResult.type === 'text') {
    return currentResult.content;
  }

  // 超出最大轮数
  return '操作完成，但结果比较复杂，请问还需要我继续处理吗？';
}
```

---

## 6. 需修改的文件清单

### 6.1 新增文件

| 文件 | 说明 |
|------|------|
| `main-process/workflow-manager.js` | 主进程工作流管理器，注册 IPC handler，协调 Python bridge 和内置工具 |
| `main-process/python-bridge.js` | Python 子进程管理器（懒启动、stdin/stdout 通信、超时、重启） |
| `python-tools/executor.py` | Python 工具执行入口，stdin/stdout JSON 协议循环 |
| `python-tools/file_ops.py` | 文件操作工具集（列出、移动、复制、重命名、分类整理） |
| `python-tools/system_ops.py` | 系统操作工具集（打开应用、获取系统信息、剪贴板） |
| `python-tools/web_ops.py` | 网络操作工具集（HTTP 请求、网页摘要） |
| `python-tools/requirements.txt` | Python 依赖（仅标准库 + 少量安全依赖） |
| `src/workflow-handler.js` | 渲染进程工具调用协调器（可选，如果逻辑较复杂可独立） |
| `docs/workflow-architecture.md` | 本文件 |

### 6.2 修改文件

| 文件 | 改动摘要 |
|------|----------|
| **`src/api.js`** | 1. `callDeepSeekAPI` 增加 `options.tools` 参数支持 <br> 2. 返回值从 `string` 改为 `{type, content/toolCalls}` 对象 <br> 3. 新增 `handleToolCallsLoop()` 处理多轮工具调用 <br> 4. `chatWithAI` 获取工具定义并传入 API 调用 |
| **`src/app-vanilla.js`** | 1. `sendMessage()` 适配 `chatWithAI` 新返回格式 <br> 2. 新增工具执行状态 UI（loading 动画、结果展示） <br> 3. 可选：工具调用确认对话框（危险操作时） |
| **`preload.js`** | 新增 `PetWorkflow` contextBridge 暴露（execute, listTools, getDesktopPath, abort） |
| **`main.js`** | 1. 导入并初始化 `workflow-manager.js` <br> 2. 注册 `workflow:*` IPC handler <br> 3. 在 `before-quit` 中关闭 Python 进程 |
| **`index.html`** | 如果 `workflow-handler.js` 独立文件，需在 `app-vanilla.js` 前加载 |
| **`main-process/tools/config.js`** | 新增 `workflow` 配置节（Python 路径 `D:\kaifa\Anaconda\envs\main310\python.exe`、工具白名单等） |

### 6.3 改动影响范围评估

```
影响范围:
  api.js          ★★★ 核心改动（返回值类型变更）
  app-vanilla.js  ★★☆ 适配改动（sendMessage 处理新格式）
  preload.js      ★☆☆ 新增 API 暴露（纯新增，无破坏性）
  main.js         ★☆☆ 新增初始化（参考现有 toolSystem 模式）

  其他文件不受影响。
```

---

## 7. 安全边界定义

### 7.1 路径白名单

```javascript
const ALLOWED_PATHS = {
  // 基于 Electron app.getPath() 的安全路径
  desktop: app.getPath('desktop'),
  documents: app.getPath('documents'),
  downloads: app.getPath('downloads'),
  pictures: app.getPath('pictures'),
  music: app.getPath('music'),
  videos: app.getPath('videos'),
  home: app.getPath('home'),
  temp: app.getPath('temp'),
  userData: app.getPath('userData')
};

// 绝对禁止访问的路径
const BLOCKED_PATHS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  '/System',
  '/bin',
  '/sbin',
  '/etc',
  '/usr'
];
```

### 7.2 文件操作限制

| 限制项 | 值 | 说明 |
|--------|-----|------|
| 最大读取文件大小 | 1 MB | 防止读取大文件导致内存溢出 |
| 最大写入文件大小 | 10 MB | 防止磁盘空间滥用 |
| 单次列出文件数上限 | 1000 | 防止大目录遍历卡死 |
| 递归深度上限 | 5 层 | 防止深层递归 |
| 禁止操作的文件扩展名 | `.exe`, `.bat`, `.cmd`, `.ps1`, `.sh`, `.dll`, `.sys` | 防止执行危险文件 |
| 禁止删除非空目录 | 是 | 防止误删 |

### 7.3 系统操作限制

| 限制项 | 说明 |
|--------|------|
| 应用启动白名单 | 只允许启动 `notepad`, `code`, `chrome`, `edge`, `firefox`, `explorer` 等常见应用 |
| 禁止执行任意命令 | 不提供 `exec` / `shell` 类工具，只有预定义的安全操作 |
| 剪贴板操作 | 只允许写入文本，不允许读取（隐私保护） |
| 环境变量 | 只允许读取白名单中的安全变量 |

### 7.4 网络操作限制

| 限制项 | 值 |
|--------|-----|
| URL 白名单模式 | `https://*`（仅 HTTPS） |
| 最大响应大小 | 5 MB |
| 请求超时 | 10 秒 |
| 禁止访问内网 | `localhost`, `127.0.0.1`, `10.*`, `192.168.*`, `172.16-31.*` |

### 7.5 参数注入防护

```python
# Python 端参数校验示例
def validate_path(path: str) -> str:
    """校验并规范化路径，防止路径穿越攻击"""
    # 1. 展开 ~ 为用户主目录
    path = os.path.expanduser(path)
    # 2. 转换为绝对路径
    path = os.path.abspath(path)
    # 3. 解析符号链接
    path = os.path.realpath(path)
    # 4. 检查是否在白名单目录内
    if not any(path.startswith(allowed) for allowed in ALLOWED_PATHS):
        raise PermissionError(f"路径不在允许范围内: {path}")
    # 5. 检查是否在黑名单目录内
    if any(path.startswith(blocked) for blocked in BLOCKED_PATHS):
        raise PermissionError(f"禁止访问系统路径: {path}")
    return path
```

---

## 8. 进程管理策略

### 8.1 懒启动 (Lazy Startup)

```
应用启动
  │
  ├── 记忆系统初始化 ✓（立即启动，核心功能）
  ├── 工具系统初始化 ✓（立即启动，JS 内置工具）
  └── Python 进程    ✗（不启动，等待首次工具调用）

用户首次发出需要 Python 工具的请求
  │
  ▼
python-bridge.js: ensureProcess()
  │
  ├── Python 进程不存在 → 启动子进程
  │   ├── 执行 python executor.py
  │   ├── 等待 "ready" 信号（超时 10 秒）
  │   └── 标记为可用
  │
  └── Python 进程已存在且健康 → 直接使用
```

### 8.2 Python 解释器路径

```javascript
const PYTHON_CONFIG = {
  // 优先使用的 Python 解释器（本地 Anaconda 环境）
  preferredPython: 'D:\\kaifa\\Anaconda\\envs\\main310\\python.exe',

  // fallback：如果优先路径不存在，从系统 PATH 中查找
  fallbackPython: 'python',

  // 启动时自动检测：优先路径 → fallback → 报错
  // python-bridge.js 的 resolvePythonPath() 方法实现此逻辑
};
```

python-bridge.js 启动子进程时的路径解析顺序：

```
1. 检查 PYTHON_CONFIG.preferredPython 是否存在且可执行
   → D:\kaifa\Anaconda\envs\main310\python.exe
2. 不存在则 fallback 到系统 PATH 中的 python
3. 都不可用则标记 Python 工具系统不可用，返回友好错误
```

### 8.3 超时策略

```javascript
const PROCESS_CONFIG = {
  // 启动超时：Python 进程启动后等待 ready 信号的最大时间
  startupTimeout: 10000,   // 10 秒

  // 执行超时：单个工具调用的最大执行时间
  executionTimeout: 30000, // 30 秒

  // 空闲超时：无请求时自动关闭 Python 进程
  idleTimeout: 300000,     // 5 分钟

  // 心跳间隔：检测 Python 进程是否存活
  heartbeatInterval: 60000 // 60 秒
};
```

### 8.4 自动重启

```
Python 进程异常退出
  │
  ├── 退出码非 0 → 记录错误日志
  ├── 短时间内（60秒）重启次数 < 3 → 标记需要重启
  │   └── 下次请求时自动重启
  └── 短时间内重启次数 >= 3 → 标记为不可用
      └── 返回错误 "工具系统暂时不可用，请稍后再试"
      └── 5 分钟后重置计数器，允许再次尝试
```

### 8.5 进程生命周期状态机

```
                   ┌─────────┐
                   │  IDLE   │  (未启动)
                   └────┬────┘
                        │ 首次调用
                        ▼
                   ┌─────────┐
                   │STARTING │  (启动中，等待 ready)
                   └────┬────┘
                   ┌────┤
                   │    ▼
            超时   │ ┌─────────┐
          ┌────────┤ │  READY  │◄──────────── 请求完成
          │        │ └────┬────┘
          ▼        │      │ 收到请求
     ┌─────────┐   │      ▼
     │  ERROR  │   │ ┌─────────┐
     └────┬────┘   │ │  BUSY   │──── 执行超时 ──▶ kill
          │        │ └─────────┘
          │        │
          │  空闲超时│
          │        ▼
          │   ┌─────────┐
          └──▶│ STOPPED │──── 下次请求 ──▶ STARTING
              └─────────┘
```

### 8.6 应用退出清理

```javascript
// main.js - before-quit
app.on('before-quit', () => {
  app.isQuitting = true;

  // 关闭记忆系统
  if (memorySystem) {
    memorySystem.close();
  }

  // 关闭 Python 工作流进程
  if (workflowManager) {
    workflowManager.shutdown();  // 发送 __shutdown__ → 等待 2s → kill
  }
});
```

---

## 9. 与现有系统的集成点

### 9.1 与现有 ToolSystem 的关系

现有 `main-process/tools/` 是 JS 内置工具系统（系统信息、截图等）。新的工作流系统**扩展**而非替代它：

```
workflow-manager.js
  │
  ├── JS 内置工具 → 委托给现有 ToolSystem (tool:execute)
  │   如: system.getInfo, screenshot.capture
  │
  └── Python 工具 → 委托给 python-bridge.js
      如: file_ops.list_files, system_ops.open_app
```

### 9.2 与记忆系统的集成

工具调用结果会被保存到记忆系统，使宠物能记住执行过的操作：

```javascript
// 工具执行后保存到记忆
await saveConversationToMemory('assistant', `[工具调用] ${toolName}: ${summary}`, {
  personality,
  extra: { type: 'tool_execution', toolName, success }
});
```

### 9.3 与主题系统的兼容

工具执行状态 UI（loading、结果卡片）需要使用 CSS 变量，兼容现有主题系统。

---

## 10. 初期工具清单（MVP）

| 工具名 | 分类 | 说明 | 安全级别 |
|--------|------|------|----------|
| `file_ops.list_files` | file | 列出目录文件 | safe |
| `file_ops.read_file` | file | 读取文本文件内容 | safe |
| `file_ops.write_file` | file | 写入/创建文本文件 | requires_approval |
| `file_ops.move_file` | file | 移动/重命名文件 | requires_approval |
| `file_ops.copy_file` | file | 复制文件 | safe |
| `file_ops.delete_file` | file | 删除文件（移到回收站） | requires_approval |
| `file_ops.get_file_info` | file | 获取文件详细信息 | safe |
| `file_ops.search_files` | file | 按名称/内容搜索文件 | safe |
| `system_ops.open_app` | system | 打开应用程序 | requires_approval |
| `system_ops.open_url` | system | 在浏览器中打开 URL | safe |
| `system_ops.get_system_info` | system | 获取系统信息 | safe |
| `system_ops.set_clipboard` | system | 设置剪贴板文本 | safe |

---

## 附录 A: 目录结构预览

```
jizhang/
├── main.js                          # + 导入 workflow-manager, before-quit 清理
├── preload.js                       # + PetWorkflow contextBridge
├── src/
│   ├── api.js                       # + tools 参数, tool_calls 处理
│   ├── app-vanilla.js               # + 工具执行 UI
│   └── workflow-handler.js          # 新增：渲染进程工具调用协调（可选）
├── main-process/
│   ├── workflow-manager.js          # 新增：主进程工作流管理器
│   ├── python-bridge.js             # 新增：Python 子进程管理
│   └── tools/                       # 现有 JS 工具系统（不变）
│       ├── index.js
│       ├── registry.js
│       └── config.js
└── python-tools/                    # 新增：Python 工具层
    ├── executor.py                  # 入口，stdin/stdout 循环
    ├── file_ops.py                  # 文件操作
    ├── system_ops.py                # 系统操作
    ├── web_ops.py                   # 网络操作
    └── requirements.txt             # Python 依赖
```
