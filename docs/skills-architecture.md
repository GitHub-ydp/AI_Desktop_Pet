# Skills 系统架构设计

## 概述

Skills 系统将现有的硬编码工具调用（WorkflowManager 12 个 Python 工具）升级为**声明式、可扩展的技能注册机制**。每个技能由一个 `SKILL.md` 文件描述，系统自动扫描、注册、注入到 LLM 的 function calling 流程中。

## 1. SKILL.md 格式规范

每个技能目录包含一个 `SKILL.md` 文件，使用 YAML frontmatter + Markdown body：

```yaml
---
name: bash_run
description: 执行 shell/PowerShell 命令完成系统任务
metadata:
  requires:
    os: [win32]
  dangerous: true
  confirm: true
  timeout: 30000
  category: system
user-invocable: true
---

## 何时调用

当用户要求执行系统命令、运行脚本、安装软件包或查看进程时使用。

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command | string | 是 | 要执行的命令 |
| cwd | string | 否 | 工作目录 |

## 示例

用户: "查看桌面有哪些文件"
调用: bash_run({ command: "dir ~/Desktop", cwd: "~" })

## 安全说明

- 禁止执行 `rm -rf /`、`format` 等破坏性命令
- 所有命令执行前弹出确认对话框
```

### Frontmatter 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 技能唯一标识（用于 function calling name） |
| description | string | 是 | 简短描述（注入 LLM 的 function description） |
| metadata.requires.os | string[] | 否 | 限制操作系统（`win32`/`darwin`/`linux`） |
| metadata.dangerous | boolean | 否 | 是否为危险操作（默认 false） |
| metadata.confirm | boolean | 否 | 执行前是否需要用户确认（默认 false） |
| metadata.timeout | number | 否 | 执行超时毫秒数（默认 30000） |
| metadata.category | string | 否 | 分类：`file`/`system`/`search`/`memory`/`media` |
| user-invocable | boolean | 否 | 用户是否可通过 `/skillName` 手动触发 |

## 2. 目录结构

```
项目根目录/
├── skills/                          ← 内置技能（随代码发布）
│   ├── bash-run/
│   │   └── SKILL.md
│   ├── file-read/
│   │   └── SKILL.md
│   ├── file-write/
│   │   └── SKILL.md
│   ├── file-list/
│   │   └── SKILL.md
│   ├── file-search/
│   │   └── SKILL.md
│   ├── web-search/
│   │   └── SKILL.md
│   ├── memory-search/
│   │   └── SKILL.md
│   ├── reminder-create/
│   │   └── SKILL.md
│   ├── screenshot-ocr/
│   │   └── SKILL.md
│   ├── open-app/
│   │   └── SKILL.md
│   ├── open-url/
│   │   └── SKILL.md
│   └── clipboard-set/
│       └── SKILL.md
│
├── %APPDATA%/ai-desktop-pet/skills/ ← 用户自定义技能
│   └── my-custom-skill/
│       └── SKILL.md
```

## 3. SkillRegistry 接口

文件：`main-process/skill-registry.js`

```javascript
class SkillRegistry {
  constructor(options) {
    this.builtinDir = options.builtinDir;   // skills/
    this.userDir = options.userDir;         // userData/skills/
    this.skills = new Map();               // name → SkillDefinition
  }

  // 扫描所有技能目录，解析 SKILL.md，过滤不适用的技能
  async loadSkills() {
    // 1. 扫描 builtinDir 和 userDir 下的所有子目录
    // 2. 读取每个目录的 SKILL.md
    // 3. 解析 YAML frontmatter
    // 4. 环境过滤（检查 metadata.requires.os）
    // 5. 注册到 this.skills Map
    // 用户目录的同名技能覆盖内置技能
  }

  // 返回当前环境下可用的技能列表
  getEligibleSkills() {
    // 过滤 metadata.requires 条件（os、依赖等）
    // 返回 SkillDefinition[]
  }

  // 生成 XML 格式的系统提示词片段（注入 LLM system prompt）
  formatForPrompt() {
    // 返回类似：
    // <available-tools>
    //   <tool name="bash_run">执行命令</tool>
    //   <tool name="file_read">读取文件</tool>
    //   ...
    // </available-tools>
  }

  // 生成 DeepSeek function calling 的 tools 数组
  buildToolsArray() {
    // 返回 [{ type: 'function', function: { name, description, parameters } }]
    // parameters 从 SKILL.md 的 ## 参数说明 表格自动解析
    // 或者从额外的 parameters.json 文件读取
  }

  // 获取单个技能定义
  getSkill(name) {
    return this.skills.get(name);
  }
}
```

### SkillDefinition 数据结构

```javascript
{
  name: 'bash_run',
  description: '执行 shell/PowerShell 命令',
  source: 'builtin',           // 'builtin' | 'user'
  dirPath: 'skills/bash-run',  // SKILL.md 所在目录
  metadata: {
    requires: { os: ['win32'] },
    dangerous: true,
    confirm: true,
    timeout: 30000,
    category: 'system'
  },
  userInvocable: true,
  parameters: {                // function calling 参数定义
    type: 'object',
    properties: { ... },
    required: [ ... ]
  },
  body: '## 何时调用\n...'     // SKILL.md 正文（可选注入 prompt）
}
```

## 4. SkillExecutor 路由逻辑

文件：`main-process/skill-executor.js`

```javascript
class SkillExecutor {
  constructor(options) {
    this.registry = options.registry;          // SkillRegistry
    this.workflowManager = options.workflow;   // 现有 WorkflowManager（Python 桥接）
    this.mainWindow = null;
  }

  // 执行技能（接收 LLM 的 tool_call）
  async execute(toolCall) {
    const { name, arguments: argsStr } = toolCall.function;
    const args = JSON.parse(argsStr || '{}');
    const skill = this.registry.getSkill(name);

    if (!skill) {
      return { success: false, error: `未知技能: ${name}` };
    }

    // 危险操作需要用户确认
    if (skill.metadata.confirm) {
      const approved = await this._requestConfirmation(name, args);
      if (!approved) {
        return { success: false, error: '用户取消了操作' };
      }
    }

    // 路由到对应的执行器
    return await this._route(skill, args);
  }

  // 路由逻辑
  async _route(skill, args) {
    // 路由优先级：
    // 1. 内置 Node.js 处理器（memory_search、reminder_create 等）
    // 2. Python 工具层（file_ops、system_ops 等，通过现有 WorkflowManager）
    // 3. 外部 HTTP（web_search 等，需要额外 API Key）

    switch (skill.metadata.category) {
      case 'memory':
        return await this._executeMemorySkill(skill, args);
      case 'reminder':
        return await this._executeReminderSkill(skill, args);
      case 'media':
        return await this._executeMediaSkill(skill, args);
      case 'search':
        return await this._executeSearchSkill(skill, args);
      default:
        // 默认走 Python 工具层
        return await this._executePythonSkill(skill, args);
    }
  }

  // Python 工具层执行（复用现有 WorkflowManager）
  async _executePythonSkill(skill, args) {
    return await this.workflowManager.execute(skill.name, args);
  }

  // 内置 Node.js：记忆搜索
  async _executeMemorySkill(skill, args) {
    // 通过 memorySystem.searchMemories() 直接调用
  }

  // 内置 Node.js：创建提醒
  async _executeReminderSkill(skill, args) {
    // 通过 memorySystem.createReminder() 直接调用
  }

  // 内置 Node.js：截图 OCR
  async _executeMediaSkill(skill, args) {
    // 通过 screenshotSystem 调用
  }

  // 外部 HTTP：Web 搜索
  async _executeSearchSkill(skill, args) {
    // 调用搜索 API（SearXNG / DuckDuckGo / Google 等）
  }

  // 弹出确认对话框（通过 IPC 通知渲染进程）
  async _requestConfirmation(skillName, args) {
    return new Promise((resolve) => {
      if (!this.mainWindow) {
        resolve(false);
        return;
      }
      this.mainWindow.webContents.send('skill:confirm-request', {
        skillName,
        args,
        requestId: `confirm_${Date.now()}`
      });
      // 监听确认结果
      ipcMain.once('skill:confirm-response', (event, result) => {
        resolve(result.approved);
      });
    });
  }
}
```

### 路由表

| 技能 | 路由目标 | 执行方式 |
|------|----------|----------|
| bash_run | Python 层 | WorkflowManager → executor.py（新增 bash 模块） |
| file_read | Python 层 | WorkflowManager → file_ops.read_file |
| file_write | Python 层 | WorkflowManager → file_ops.write_file |
| file_list | Python 层 | WorkflowManager → file_ops.list_files |
| file_search | Python 层 | WorkflowManager → file_ops.search_files |
| open_app | Python 层 | WorkflowManager → system_ops.open_app |
| open_url | Python 层 | WorkflowManager → system_ops.open_url |
| clipboard_set | Python 层 | WorkflowManager → system_ops.set_clipboard |
| memory_search | Node.js 内置 | memorySystem.searchMemories() |
| reminder_create | Node.js 内置 | memorySystem.createReminder() |
| screenshot_ocr | Node.js 内置 | screenshotSystem.ocr() |
| web_search | 外部 HTTP | SearXNG / DuckDuckGo API |

## 5. 与现有 api.js 集成点

### 修改点 1：工具定义注入

当前代码（`src/api.js:708-715`）：

```javascript
// 当前：从 PetWorkflow 获取工具定义
let toolDefinitions = [];
if (window.PetWorkflow) {
  toolDefinitions = await window.PetWorkflow.listTools();
}
```

改为：

```javascript
// 新：从 SkillRegistry 获取工具定义
let toolDefinitions = [];
if (window.PetSkills) {
  toolDefinitions = await window.PetSkills.getToolsArray();
}
```

### 修改点 2：System Prompt 增强

当前代码（`src/api.js:665`）：

```javascript
let systemPrompt = window.PersonalityPrompts.getPersonalityPrompt(personality);
```

在记忆上下文之后，增加技能提示：

```javascript
// 注入可用技能描述
if (window.PetSkills) {
  const skillPrompt = await window.PetSkills.getPromptSnippet();
  systemPrompt += `\n\n${skillPrompt}`;
}
```

### 修改点 3：handleToolCallsLoop 路由

当前代码（`src/api.js:416`）：

```javascript
// 当前：直接走 PetWorkflow
const result = await window.PetWorkflow.execute(toolName, toolArgs);
```

改为：

```javascript
// 新：走 SkillExecutor 统一路由
const result = await window.PetSkills.execute(toolName, toolArgs);
```

### 新增 IPC 通道

| 通道 | 说明 |
|------|------|
| `skill:list` | 获取可用技能列表 |
| `skill:get-tools-array` | 获取 function calling tools 数组 |
| `skill:get-prompt-snippet` | 获取系统提示词片段 |
| `skill:execute` | 执行技能 |
| `skill:confirm-request` | 危险操作确认请求（main→renderer） |
| `skill:confirm-response` | 确认结果（renderer→main） |

### 新增 preload.js 桥接

```javascript
contextBridge.exposeInMainWorld('PetSkills', {
  list: () => ipcRenderer.invoke('skill:list'),
  getToolsArray: () => ipcRenderer.invoke('skill:get-tools-array'),
  getPromptSnippet: () => ipcRenderer.invoke('skill:get-prompt-snippet'),
  execute: (name, args) => ipcRenderer.invoke('skill:execute', name, args),
  onConfirmRequest: (callback) => {
    ipcRenderer.on('skill:confirm-request', (event, data) => callback(data));
  },
  respondConfirm: (requestId, approved) => {
    ipcRenderer.send('skill:confirm-response', { requestId, approved });
  }
});
```

## 6. 内置 Skills 清单

### 6.1 bash_run（新增）

- **描述**: 执行 PowerShell/cmd 命令
- **危险级别**: 高（confirm: true）
- **路由**: Python 层新增 bash_ops 模块
- **安全**: 命令黑名单（format、del /s、rm -rf 等）+ 用户确认弹窗

### 6.2 file_read / file_write / file_list / file_search

- **描述**: 文件系统操作
- **路由**: 复用现有 Python file_ops 模块
- **安全**: 路径白名单 + 扩展名黑名单

### 6.3 open_app / open_url / clipboard_set

- **描述**: 系统操作
- **路由**: 复用现有 Python system_ops 模块
- **安全**: 应用白名单、HTTPS only

### 6.4 web_search（新增）

- **描述**: 调用搜索 API 获取网页摘要
- **路由**: Node.js 内置（HTTP 请求）
- **方案**: 优先 SearXNG 本地实例，降级 DuckDuckGo Instant Answer API（免费无 Key）
- **安全**: 安全（只读），无需确认

### 6.5 memory_search（新增）

- **描述**: 主动搜索记忆库（让 AI 可以自主查询历史）
- **路由**: Node.js 内置（memorySystem.searchMemories）
- **安全**: 安全（只读），无需确认

### 6.6 reminder_create（新增）

- **描述**: 创建定时提醒
- **路由**: Node.js 内置（memorySystem.createReminder）
- **安全**: 安全，无需确认

### 6.7 screenshot_ocr（新增）

- **描述**: 调用现有截图 OCR 能力
- **路由**: Node.js 内置（screenshotSystem）
- **安全**: 安全，无需确认

## 7. 安全设计

### 分级策略

| 级别 | 行为 | 适用技能 |
|------|------|----------|
| 安全（静默执行） | 直接执行，无需确认 | file_read, file_list, file_search, memory_search, web_search, open_url, clipboard_set, reminder_create, screenshot_ocr |
| 危险（需确认） | 弹出确认对话框，用户同意后执行 | file_write, open_app |
| 高危（需确认+审查） | 弹出确认对话框，显示完整命令内容 | bash_run, file_delete |

### 确认对话框设计

```
┌─────────────────────────────────────┐
│  ⚠ AI 请求执行以下操作              │
│                                     │
│  技能: bash_run                     │
│  命令: dir ~/Desktop                │
│                                     │
│  [允许]     [拒绝]     [始终允许]    │
└─────────────────────────────────────┘
```

### 安全保障

1. **路径沙箱**: 继承现有 file_ops 的白名单/黑名单机制
2. **命令黑名单**: bash_run 禁止执行破坏性命令
3. **超时保护**: 默认 30 秒执行超时
4. **用户覆盖**: 用户可在 SKILL.md 中修改 `confirm` 字段
5. **日志审计**: 所有技能执行记录到 SQLite（复用现有 tool:get-history）

## 8. 实施顺序

### Phase 1: 基础设施

1. 创建 `skills/` 目录 + 内置 SKILL.md 文件
2. 实现 `SkillRegistry`（SKILL.md 解析 + 扫描注册）
3. 实现 `SkillExecutor`（路由 + 确认弹窗）

### Phase 2: 集成

4. 新增 IPC 通道 + preload.js 桥接
5. 修改 `api.js`：工具定义注入 + handleToolCallsLoop 路由
6. 迁移现有 WorkflowManager 工具到 Skills 系统

### Phase 3: 新增技能

7. 实现 `bash_run`（Python bash_ops 模块）
8. 实现 `memory_search`（Node.js 内置）
9. 实现 `reminder_create`（Node.js 内置）
10. 实现 `web_search`（HTTP 调用）

### 向后兼容

- `PetWorkflow` API 保持不变，SkillExecutor 内部复用
- 现有 12 个工具全部映射为 Skills
- 工具名从 `file_ops_list_files` 风格迁移到 `file_list` 简化风格
- 旧名称通过别名映射兼容
