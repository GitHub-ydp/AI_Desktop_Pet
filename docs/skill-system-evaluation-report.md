# AI Desktop Pet 技能系统评估报告

> 评估时间：2026-03-22
> 评估者：Claude Code (Opus 4.6)
> 评估对象：AI Desktop Pet Skills System v1.0
> 对比基准：Claude Code CLI（Anthropic 官方开发工具）

---

## 一、总体评价

### 评分概览

| 维度 | 得分（/10） | 说明 |
|------|:-----------:|------|
| 架构设计 | **8.5** | 声明式 SKILL.md + 注册中心 + 执行器，分层清晰 |
| 技能覆盖度 | **6.0** | 18 个技能覆盖基本场景，但缺失关键能力 |
| 执行可靠性 | **7.0** | 有重试、截断、超时，但边界处理不够全面 |
| 安全机制 | **7.5** | 三级安全分级 + 路径校验 + 命令黑名单，有缺口 |
| 意图识别 | **5.0** | 纯正则匹配，准确度有限，无法处理复杂/歧义意图 |
| 上下文管理 | **6.5** | 有记忆系统和预读，但工具结果上下文利用不足 |
| 用户体验 | **7.0** | 有审批流程和流式输出，但反馈粒度不够 |
| **综合** | **6.8** | 作为桌面宠物的 Agent 能力，已达到可用水平 |

---

## 二、架构评价

### 优点

1. **声明式技能定义**：每个技能一个 `SKILL.md` 文件，YAML frontmatter 描述元数据，人类和机器都可读。这比 Claude Code 的硬编码工具定义更灵活，支持用户自定义技能扩展。

2. **三层路由**：`SkillRegistry → SkillExecutor → _builtinHandlers / WorkflowManager`，职责分离清晰。注册中心负责发现和过滤，执行器负责安全校验和路由，处理器负责具体逻辑。

3. **安全/危险/高危三级分级**：
   - 安全技能静默执行（file_read, web_search 等）
   - 危险技能需用户确认（file_write, file_edit）
   - 高危技能确认 + 命令审查（bash_run）

4. **执行历史可追溯**：最近 200 条执行记录持久化，包含耗时、参数、结果，便于调试。

### 与 Claude Code 对比

| 特性 | AI Desktop Pet | Claude Code |
|------|:-:|:-:|
| 技能可扩展 | SKILL.md 文件（好） | 硬编码（差） |
| 执行历史 | 200 条持久化（好） | 无持久化 |
| 权限模型 | 三级固定 | 动态权限模式（更灵活） |
| 工具定义格式 | 自定义 YAML | OpenAI function_calling 标准 |

### 改进建议

- **A1**: 缺少技能**依赖声明**。例如 `multi_file_edit` 依赖 `file_read` 预检，但这种关系未在 SKILL.md 中体现。建议增加 `depends_on` 字段。
- **A2**: `_legacyMapping`（Python WorkflowManager 桥接）已无实际技能使用，建议清理死代码。

---

## 三、技能覆盖度评估

### 现有 18 个技能分类

```
文件操作（6）: file_read, file_write, file_edit, file_list, file_search, multi_file_edit
代码搜索（1）: grep_search
版本控制（1）: git_ops
系统操作（3）: bash_run, open_app, open_url
信息检索（3）: web_search, web_fetch, weather_get
记忆/提醒（2）: memory_search, reminder_create
工具类（2）: clipboard_set, screenshot_ocr
```

### 与 Claude Code 工具对比

| 能力 | AI Desktop Pet | Claude Code | 差距评估 |
|------|:-:|:-:|------|
| 文件读取 | file_read（行范围） | Read（行范围+图片+PDF+Notebook） | **缺** 图片/PDF/Notebook |
| 文件编辑 | file_edit（str_replace） | Edit（str_replace） | 基本持平 |
| 文件写入 | file_write | Write | 持平 |
| 批量编辑 | multi_file_edit（10文件） | 无专用工具，手动多次 Edit | **优势** |
| 文件搜索 | file_search（名称） | Glob（glob 模式） | **缺** glob 通配符 |
| 内容搜索 | grep_search（正则） | Grep（ripgrep，极快） | 功能近似，**性能差距大** |
| Shell 执行 | bash_run（PowerShell） | Bash（bash/zsh） | 功能近似 |
| Git 操作 | git_ops（5种操作） | Bash + 内置 Git 协议 | **缺** rebase/cherry-pick/stash |
| 网页搜索 | web_search（DDG HTML） | WebSearch | 近似 |
| 网页抓取 | web_fetch（12KB） | WebFetch | 近似，**容量限制更紧** |
| 子任务委派 | **无** | Agent（子进程） | **严重缺失** |
| 交互式提问 | **无** | AskUserQuestion | **缺失** |
| 计划模式 | 简单3步 Plan | EnterPlanMode/ExitPlanMode | **缺失** |
| 任务跟踪 | **无** | TaskCreate/Update/List | **缺失** |
| Notebook | **无** | NotebookEdit | **缺失** |
| 后台执行 | **无** | Background Agent | **缺失** |

### 关键缺失技能（按优先级排序）

#### P0 — 必须补充

1. **`ask_user`（交互式提问）**
   - **问题**：当前 LLM 遇到歧义时只能猜测或失败，无法主动向用户求证
   - **Claude Code 做法**：`AskUserQuestion` 工具，在工具循环中暂停等待用户输入
   - **实现思路**：利用现有的 `pendingInjections` 机制，新增 `ask_user` 技能，触发时发布 `user.question` 事件 → 聊天窗口显示问题 → 用户回复 → `injectMessage()` 注入

2. **`task_plan`（结构化计划）**
   - **问题**：当前 `buildInitialPlan()` 只有固定的 3 步模板（理解→执行→总结），对复杂任务无指导意义
   - **Claude Code 做法**：`EnterPlanMode` 让 LLM 先输出完整计划，用户确认后再执行
   - **实现思路**：增加 `task_plan` 技能，LLM 输出 JSON 格式的步骤列表，渲染为可交互的 checklist

#### P1 — 重要改进

3. **`file_read` 增强：图片/PDF 支持**
   - 当前只能读 UTF-8 文本
   - 应支持：图片→base64→视觉模型、PDF→文本提取
   - Qwen 3.5 Plus 支持视觉输入，可以利用

4. **`glob_search`（glob 模式文件搜索）**
   - 当前 `file_search` 只支持简单通配符
   - 应支持 `**/*.js`、`src/{a,b}/*.ts` 等 glob 模式
   - 实现：引入 `minimatch` 或手写 glob matcher

5. **`diff_view`（差异对比）**
   - 当前 `git_ops diff` 返回原始 diff 文本
   - 应提供结构化的行级差异，便于 LLM 理解

#### P2 — 锦上添花

6. **`background_task`（后台长任务）**
   - 当 bash_run 需要长时间运行时（如 npm install），支持后台执行 + 完成通知
   - 当前 60s 超时太短

7. **`code_analysis`（静态代码分析）**
   - AST 级别的代码理解（函数列表、引用关系、类型信息）
   - 远超 grep_search 的代码理解能力

---

## 四、意图识别系统评估

### 现状分析

```javascript
// agent-runtime.js:31-48
function classifyIntent(text, attachments) {
  // 纯正则匹配，6 种意图
  if (attachments) return 'vision';
  if (/新闻|热点|天气.../.test(input)) return 'search';
  if (/创建|删除|打开.../.test(input)) return 'task'/'code';
  return 'chat';
}
```

### 问题清单

| 编号 | 问题 | 严重度 | 示例 |
|------|------|:------:|------|
| I1 | **关键词冲突** | 高 | "帮我**查看**这个文件的**代码**" → task 还是 code？两个正则都匹配 |
| I2 | **优先级硬编码** | 高 | search 检测在 task 之前，"**搜索**桌面文件" 误判为 search |
| I3 | **无置信度** | 中 | 所有分类都是布尔判断，无法表达"可能是 task，也可能是 chat" |
| I4 | **无上下文感知** | 中 | 连续对话中 "继续" 被判为 chat，但应该继承上轮的 task 意图 |
| I5 | **英文覆盖弱** | 低 | "please create a file" 中没有匹配到创建类关键词 |

### 与 Claude Code 对比

Claude Code **不做意图分类**。它的策略是：
- 始终提供全部工具给 LLM
- 由 LLM 自主决定是否使用工具
- 通过 system prompt 引导行为

这种方式更可靠，因为 LLM 本身就是最好的意图分类器。

### 改进建议

**方案 A（推荐）：弱化意图分类的权重**
- 意图分类只决定 `MAX_TOOL_ROUNDS`，不决定是否提供工具
- 所有意图都提供工具列表（当前 chat 意图只有 1 轮且可能不传工具）
- 调整：`chat: 1 → 3`，让聊天中也能触发 1-2 次工具调用

**方案 B：用 LLM 做意图分类**
- 在正式调用前用一次轻量 LLM 调用做分类
- 缺点：增加 1 次 API 调用的延迟（~500ms）
- 适合追求准确度的场景

**方案 C（折中）：打分制替代布尔判断**
```javascript
function classifyIntent(text) {
  const scores = { chat: 1, task: 0, code: 0, search: 0, vision: 0 };
  // 每个关键词命中加分而非直接返回
  if (/创建|删除/.test(text)) scores.task += 3;
  if (/代码|脚本/.test(text)) scores.code += 3;
  // ...
  return Object.entries(scores).sort((a,b) => b[1] - a[1])[0][0];
}
```

---

## 五、执行可靠性评估

### 已做好的

1. **工具输出截断**（`_truncateToolContent`）：超 2000 字符保留头 30 行 + 尾 10 行
2. **空轮次检测**（`MAX_EMPTY_TOOL_ROUNDS = 2`）：连续失败自动退出
3. **全局超时**（5 分钟）：防止任务无限运行
4. **Provider 降级**：主路由失败自动切换备用
5. **网络工具重试**（`_executeToolWithRetry`）：web_search/web_fetch 自动重试

### 问题清单

| 编号 | 问题 | 严重度 | 详情 |
|------|------|:------:|------|
| R1 | **file_edit 单次匹配失败无降级** | 高 | `old_string` 不唯一时直接报错退出，LLM 无法自动修正（Claude Code 会提示 LLM 提供更多上下文） |
| R2 | **bash_run stderr 未分离传递** | 中 | 成功但有 warning 的命令（exitCode=0 但 stderr 非空），stderr 信息被丢弃，LLM 无法感知潜在问题 |
| R3 | **工具参数校验不统一** | 中 | file_read 有 5MB 限制，但 file_write 无写入大小限制；bash_run 有 1MB 输出限制，但 web_fetch 是 12KB |
| R4 | **multi_file_edit 回滚不完整** | 中 | 备份→写入→失败→回滚链路中，如果回滚本身失败（磁盘满），无告警 |
| R5 | **grep_search 500 文件硬上限** | 低 | 大项目中 500 文件可能不够，且无法指定搜索深度 |
| R6 | **DSML 解析假设格式完整** | 低 | `parseDSMLToolCalls()` 遇到格式不完整的 XML 会静默返回空数组，无错误提示 |

### 与 Claude Code 对比

| 可靠性特性 | AI Desktop Pet | Claude Code |
|-----------|:-:|:-:|
| 工具失败重试 | 仅网络工具 | 所有工具（用户可手动重试） |
| 上下文压缩 | 有，基于 token 估算 | 自动上下文压缩（更成熟） |
| 并发控制 | 安全工具并发 | 安全工具并发 |
| 输出截断 | 头30+尾10行 | 类似策略 |
| 错误恢复 | emptyToolRounds 退出 | 用户交互 + 自动调整 |

---

## 六、安全机制评估

### 已做好的

1. 路径校验阻止 `../` 遍历和系统目录访问
2. 命令黑名单覆盖主要危险操作
3. UNC 路径阻止（防网络共享攻击）
4. URL 白名单（open_url 只允许 http/https）

### 安全漏洞

| 编号 | 漏洞 | 严重度 | 详情 |
|------|------|:------:|------|
| S1 | **命令黑名单可绕过** | **高** | `DANGEROUS_COMMANDS` 使用 `includes()` 子串匹配。攻击: `powershell -e <base64>` 不在黑名单中（黑名单只有 `-enc` 和 `-encodedcommand`） |
| S2 | **路径校验不区分大小写陷阱** | 中 | `BLOCKED_PATH_KEYWORDS` 同时包含 `'system32'` 和 `'System32'`，但实际校验用 `includes()` 而非 `toLowerCase()`，Windows 路径大小写不敏感可能导致绕过 |
| S3 | **file_write 无大小限制** | 中 | 理论上 LLM 可以写入任意大文件导致磁盘满 |
| S4 | **web_fetch 跟随重定向无域名校验** | 低 | 最多 5 次重定向，但不校验重定向目标是否为内网地址（SSRF 风险） |
| S5 | **bash_run 黑名单维护负担** | 设计缺陷 | 黑名单方式永远无法穷举所有危险命令。Claude Code 使用**白名单+动态权限**，更安全 |

### 与 Claude Code 安全模型对比

```
AI Desktop Pet:  黑名单（列举禁止项）→ 容易遗漏
Claude Code:     白名单（列举允许项）→ 默认安全，新命令需要明确授权
```

### 改进建议

- **S-Fix-1**: bash_run 应增加**白名单模式**选项。常用安全命令（ls, cat, echo, node, python, git）放入白名单，未知命令一律需要确认。黑名单作为兜底。
- **S-Fix-2**: `_validatePath()` 全部转 `toLowerCase()` 对比。
- **S-Fix-3**: file_write 增加 10MB 写入上限。
- **S-Fix-4**: web_fetch 重定向时校验目标不是 `127.0.0.1`、`localhost`、`10.x`、`192.168.x` 等内网地址。

---

## 七、上下文管理评估

### 当前策略

```
System Prompt
  ├── 性格提示词（~100 tokens）
  ├── 记忆上下文（~1500 tokens）
  │    ├── 用户画像（~200 tokens）
  │    ├── 相关记忆（~800 tokens）
  │    └── 历史对话（~500 tokens）
  ├── 文件树预读（task/code 意图时）
  └── 技能提示词（XML 格式工具描述）

Conversation Messages
  ├── 最近 8 轮对话
  ├── 会话摘要（压缩后 ~260 tokens）
  └── 工具调用结果（截断到 2000 字符/个）
```

### 问题

| 编号 | 问题 | 严重度 | 详情 |
|------|------|:------:|------|
| C1 | **工具结果无结构化总结** | 高 | 工具结果直接 JSON.stringify 后截断送给 LLM，LLM 需要自己解析。Claude Code 的工具结果有结构化的 summary 字段 |
| C2 | **技能提示词固定注入** | 中 | 所有 18 个技能的 XML 描述总是全量注入 system prompt，浪费约 2000-3000 tokens。应根据意图按需注入 |
| C3 | **对话历史固定 8 轮** | 中 | 不管对话长短都取最近 8 轮，短对话浪费，长对话不够。应动态调整 |
| C4 | **预读文件树无缓存** | 低 | 每次 task/code 意图都重新扫描桌面目录，应缓存 30 秒 |

### 改进建议

- **C-Fix-1**: 每个技能的 `_builtinHandler` 返回值增加 `summary` 字段（一句话自然语言摘要），用于 LLM 上下文。例如 `file_read` 返回 `"已读取 main.js，共 150 行，大小 4.2KB"`。
- **C-Fix-2**: 根据意图只注入相关技能。`chat` 意图只注入 `memory_search + web_search`，`task` 意图注入全部，`vision` 意图只注入 `screenshot_ocr`。
- **C-Fix-3**: 对话历史窗口动态化：`Math.min(8, Math.floor(remainingTokenBudget / avgMessageTokens))`。

---

## 八、用户体验评估

### 已做好的

1. **审批流程**：危险操作弹窗确认，30s 超时
2. **流式输出**：LLM 回复逐字流式，bash_run stdout/stderr 实时推送
3. **计划卡片**：task/code 意图显示 3 步进度条
4. **文件编辑预览**：file_edit 先预览 diff 再确认执行

### 问题

| 编号 | 问题 | 严重度 | 详情 |
|------|------|:------:|------|
| U1 | **审批信息可读性差** | 高 | 确认弹窗显示原始 JSON 参数，非技术用户看不懂。应该用自然语言描述 |
| U2 | **无中途取消反馈** | 中 | 用户取消后只有 `'用户取消了操作'` 错误，无友好提示 |
| U3 | **工具执行无进度指示** | 中 | web_search 可能需要 3-5 秒，期间用户只看到"思考中"，不知道在搜索 |
| U4 | **错误信息技术化** | 低 | `"未知技能: xxx"` 等错误直接暴露给用户 |

### 与 Claude Code 对比

| UX 特性 | AI Desktop Pet | Claude Code |
|---------|:-:|:-:|
| 审批展示 | JSON 参数 | 自然语言描述 + 代码高亮 |
| 进度指示 | "思考中" | 工具名 + 参数概要 |
| 错误展示 | 技术错误文本 | 结构化错误 + 建议 |
| 中途干预 | 取消整个任务 | 取消 + 修改 + 重试 |

### 改进建议

- **U-Fix-1**: 审批弹窗使用人话。`file_write` → "AI 想要创建文件：`xxx.txt`（内容约 200 字）"，`bash_run` → "AI 想要执行命令：`npm install express`"。
- **U-Fix-2**: 工具执行时显示："正在搜索网页..."、"正在读取文件..."、"正在编辑代码..."。

---

## 九、与 Claude Code 的核心差距总结

### 你们的优势

| 优势 | 说明 |
|------|------|
| **可扩展技能系统** | SKILL.md 声明式定义 > Claude Code 硬编码 |
| **记忆系统** | 三层记忆 + FSRS 强化 + 事实提取，Claude Code 的 Memory 只是文件 |
| **执行历史持久化** | 200 条可追溯记录，Claude Code 无此功能 |
| **multi_file_edit 原子操作** | 预检+备份+回滚，Claude Code 逐个 Edit 无原子保证 |
| **天气/提醒等生活技能** | 桌面宠物定位更贴近生活场景 |
| **安全分级 + 审批流** | 在桌面宠物场景下比 Claude Code 的权限模式更适合普通用户 |

### 你们的劣势

| 劣势 | 影响 | 修复难度 |
|------|------|:--------:|
| **无 ask_user 交互** | LLM 遇到歧义只能猜，成功率低 | 低 |
| **意图分类是瓶颈** | 正则误判导致工具轮次不够或多余 | 中 |
| **无子任务委派** | 复杂任务只能线性执行，无法分治 | 高 |
| **工具结果利用率低** | JSON 直传，LLM 需自行解析 | 低 |
| **安全模型是黑名单** | 无法穷举所有危险命令 | 中 |
| **grep_search 性能** | 纯 JS 正则逐行扫描 vs ripgrep 原生 | 中 |
| **无计划确认机制** | 复杂任务 LLM 直接开干，用户无法提前审查方案 | 中 |

---

## 十、优先级改进路线图

### Sprint 3 可插入项（按 ROI 排序）

| 优先级 | 改进项 | 预估工作量 | 预期效果 |
|:------:|--------|:----------:|----------|
| **P0** | 新增 `ask_user` 技能 | 0.5 天 | 任务成功率 +20%（消除歧义） |
| **P0** | 审批弹窗改为自然语言 | 0.5 天 | 用户体验显著提升 |
| **P0** | 意图分类 chat 轮次 1→3 | 10 分钟 | 聊天中也能用工具 |
| **P1** | 工具结果增加 summary 字段 | 1 天 | LLM 理解工具结果更准确 |
| **P1** | 技能提示词按意图裁剪 | 0.5 天 | 节省 ~1500 tokens/次 |
| **P1** | bash_run 增加白名单模式 | 0.5 天 | 安全性大幅提升 |
| **P1** | 工具执行进度提示 | 0.5 天 | 用户等待体验改善 |
| **P2** | 结构化计划 + 确认 | 2 天 | 复杂任务可控性提升 |
| **P2** | file_read 支持图片/PDF | 1 天 | 视觉理解能力扩展 |
| **P2** | 路径校验统一 toLowerCase | 10 分钟 | 修复安全漏洞 |
| **P2** | web_fetch 内网地址校验 | 30 分钟 | 防 SSRF |

---

## 十一、总结

**AI Desktop Pet 的技能系统在桌面宠物这个产品定位下已经做到了「可用且有特色」的水平。** 特别是声明式技能定义、记忆系统集成、原子化批量编辑这三个特性，是超越同类产品甚至 Claude Code 的亮点。

**最大的三个改进机会**：
1. **增加 `ask_user`** — 成本最低、收益最高的单个改进
2. **弱化意图分类的决定权** — 让 LLM 自己决定要不要用工具
3. **工具结果结构化** — 提升 LLM 对工具输出的理解准确度

这三项改进预计总计 2 天工作量，可以使 Agent 任务完成率从目前估计的 ~60% 提升到 ~80%。

---

*报告完毕。如需针对任一项展开详细实施方案，请告知。*
