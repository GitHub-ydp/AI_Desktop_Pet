const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ApprovalHumanizer = require('./humanizer');
const BUILTIN_API = require('./builtin-api');

const MAX_TOOL_ROUNDS = 15;   // 全局上限（保底）
const MAX_TOOL_ROUNDS_BY_INTENT = {
  chat:   5,   // 聊天中也可能需要多步工具操作（跟进任务）
  vision: 5,   // 允许多步视觉分析（OCR+搜索）
  search: 8,   // 搜索查询：1-2次搜索 + 3-4次 fetch + 总结，最多 8 轮
  task:   15,  // 任务执行最多 15 轮
  code:   15   // 代码任务最多 15 轮
};
const MAX_EMPTY_TOOL_ROUNDS = 2;  // 连续全部失败超过此数自动退出，防无限循环
const CODE_FILE_EXTENSIONS = /\.(js|ts|py|sh|ps1|bat|jsx|tsx|go|rs|java|cpp|c)$/i;
const APPROVAL_TIMEOUT_MS = 30000;
const RAW_HISTORY_WINDOW_MESSAGES = 8;
const SUMMARY_RECENT_MESSAGE_WINDOW = 4;
const SUMMARY_MAX_CHARS = 1200;
const AUTO_COMPACT_TOKEN_THRESHOLD = 25000;
// 工具白名单已移除 — 所有意图均暴露全量工具，让 LLM 自主决定是否使用
// 原因：基于关键词的意图分类不可靠，跟进消息常被误判为 chat，导致关键工具缺失
// 19 个工具定义 ≈ 1900 tokens（仅占 Qwen 32K 的 6%），可接受的开销
const NAG_THRESHOLD = 5;
const PROGRESS_TOOL_NAMES = new Set([
  'file_write', 'file_edit', 'multi_file_edit', 'bash_run', 'clipboard_set'
]);

// 类人思考协议 — 融合 Reflexion 自我反思 + Voyager 技能检索 + EvoSkill 失败驱动进化
const HUMAN_THINKING_PROTOCOL = `
【类人思考协议 — 遇到任务时像人一样解决问题】

你是一个有学习能力的 AI 助手。每次成功或失败的经历都会增长你的经验。请按以下协议思考和行动：

■ 第一步：理解任务
- 明确用户想要的最终结果是什么
- 将复杂任务分解为可验证的子步骤
- 识别任务类型：文件操作 / 系统命令 / 信息查询 / 内容创作

■ 第二步：能力匹配
- 你的核心能力矩阵：
  · bash_run — 执行 PowerShell / Python / 任何命令行程序
  · file_write / file_edit — 创建或修改任何文本文件
  · web_search + web_fetch — 搜索方案、获取参考资料
  · grep_search + file_read — 理解现有代码和文件
  · ask_user — 遇到需要用户决策的分叉点时主动询问
- 工具可以组合：web_search 找方案 → bash_run 执行 → file_read 验证结果

■ 第三步：检索经验
- 如果下方注入了【历史经验】，优先使用经过验证的成功方案
- 注意失败经验中的"应该避免"和"教训"部分

■ 第四步：搜索 → 合成 → 执行
- 搜索：对不确定的任务，先用 web_search 搜索方案
  · 搜索词示例："[任务关键词] powershell"、"[任务] python 脚本"
- 合成：从搜索结果中提取方案，优先选择：
  · 1) 系统自带命令（零依赖）
  · 2) 单行脚本（低复杂度）
  · 3) 需要安装的工具（高复杂度，需确认）
- 执行：运行方案，立即检查结果

■ 第五步：失败时的自我反思（关键！来自 Reflexion 论文）
当执行失败时，你必须按以下格式思考后再重试：

失败分析：
1. 具体错误是什么？（报错信息）
2. 根本原因是什么？（权限？路径？依赖？语法？）
3. 上一个方案的哪个假设是错的？
4. 下一次应该换什么方向？

然后选择一个不同的方案重试。最多尝试 3 种不同方案。
不要重复使用已经失败的命令或方案。

■ 第六步：验证与总结
- 成功后，用 file_read 或 bash_run 验证最终结果是否符合预期
- 简洁总结做了什么，让用户知道结果

【底线原则】
- bash_run + web_search 的组合意味着你理论上可以完成任何命令行可完成的任务
- 不要在第一次失败后就放弃 — 人类解决问题也需要多次尝试
- 只有在尝试了至少 2 种不同方案后仍无法解决，才说明做不到并解释原因
- 每次说"做不到"之前，问自己："我搜索过替代方案了吗？"
- 每次成功解决新问题后，这个经验会被记住，下次遇到类似问题可以直接使用
`;

function buildPersonalityPrompt(personality) {
  const prompts = {
    healing: "You are the user's desktop pet companion. Reply in Chinese with a gentle, caring, soft tone. Keep replies concise, natural, and emotionally attentive. You may use light cute particles or emoji occasionally, but avoid repetitive catchphrases.",
    funny: "You are the user's funny desktop pet companion. Reply in Chinese with playful humor, lively timing, and short helpful lines. Keep it natural and varied, and do not turn every answer into a joke.",
    cool: "You are the user's cool tsundere-style desktop companion. Reply in Chinese with a slightly aloof, sharp tone, but still be helpful and quietly caring. Keep it concise and avoid sounding rude or repetitive.",
    assistant: "You are the user's practical desktop assistant companion. Reply in Chinese with a clear, efficient, proactive style. Keep answers concise, actionable, and grounded in what actually happened."
  };
  return prompts[personality] || prompts.healing;
}

function classifyIntent(text, attachments) {
  const input = String(text || '').toLowerCase();
  if (attachments && attachments.length > 0) {
    return 'vision';
  }
  if (/(截图|图片|照片|看图|ocr|识别|图中)/.test(input)) {
    return 'vision';
  }
  // 搜索/查询意图（新闻、实时信息、百科查询）— 先于 task 判断，防止被"查看/搜索"等通用词吞噬
  if (/(新闻|热点|热搜|趣闻|要闻|资讯|最新|今天.*?(是什么|发生|有什么|怎么样)|今日|百科|天气|几点|多少度|是谁|是什么|查一下|帮我查|了解一下|latest|news|weather|search)/.test(input)) {
    return 'search';
  }
  // 代码/任务意图（文件操作、命令执行等）
  if (/(提醒|创建|新建|删除|移动|复制|重命名|打开|执行|运行|安装|下载|上传|整理|写入|修改|编辑|读取|查看|显示|统计|搜索|查找|命令|shell|bash|powershell|代码|脚本)/.test(input)) {
    return /(代码|脚本|函数|bug|调试|正则|sql|api|编程)/.test(input) ? 'code' : 'task';
  }
  return 'chat';
}

// 跟进消息检测：短消息+跟进关键词 → 可能是上一轮任务的延续
const FOLLOW_UP_PATTERNS = /^(好的|好|嗯|对|是的|可以|行|ok|继续|然后呢|接着|再|还有|那|也|帮我|不对|不行|错了|重新|重来|换一个|改一下|试试|这个)/i;

function classifyIntentWithSession(text, attachments, previousIntent) {
  const intent = classifyIntent(text, attachments);
  // 如果当前被分类为 chat，但上一轮是 task/code，且当前消息像跟进语
  if (intent === 'chat' && (previousIntent === 'task' || previousIntent === 'code')) {
    const input = String(text || '').trim();
    // 短消息（<50字）或匹配跟进模式时，继承上一轮意图
    if (input.length < 50 || FOLLOW_UP_PATTERNS.test(input)) {
      return previousIntent;
    }
  }
  return intent;
}

function buildInitialPlan(intent, userText) {
  if (intent !== 'task' && intent !== 'code') {
    return null;
  }

  const requestPreview = String(userText || '').trim().slice(0, 80) || 'Handle the user request';
  return {
    steps: [
      { id: 1, text: `Understand the request: ${requestPreview}`, status: 'in_progress' },
      { id: 2, text: 'Use tools if they are needed', status: 'pending' },
      { id: 3, text: 'Summarize the outcome clearly', status: 'pending' }
    ]
  };
}

function clonePlan(plan) {
  return {
    steps: plan.steps.map((step) => ({ ...step }))
  };
}

function updatePlanStep(plan, id, status) {
  if (!plan) return null;
  const next = clonePlan(plan);
  for (const step of next.steps) {
    if (step.id === id) {
      step.status = status;
    } else if (status === 'in_progress' && step.status === 'in_progress') {
      step.status = 'done';
    }
  }
  return next;
}

function parseDSMLToolCalls(content) {
  if (!content || (!content.includes('<~DSML') && !content.includes('<｜DSML｜'))) {
    return [];
  }

  const toolCalls = [];
  const formats = [
    {
      invokeRegex: /<~DSML~invoke\s+name="([^"]+)">([\s\S]*?)<\/~DSML~invoke>/g,
      paramRegex: /<~DSML~parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([^<]*)<\/~DSML~parameter>/g
    },
    {
      invokeRegex: /<｜DSML｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜DSML｜invoke>/g,
      paramRegex: /<｜DSML｜parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([^<]*)<\/｜DSML｜parameter>/g
    }
  ];

  for (const format of formats) {
    let match;
    while ((match = format.invokeRegex.exec(content)) !== null) {
      const toolName = match[1];
      const paramsBlock = match[2];
      const args = {};
      let paramMatch;

      while ((paramMatch = format.paramRegex.exec(paramsBlock)) !== null) {
        const paramName = paramMatch[1];
        const raw = paramMatch[3];
        if (paramMatch[2] === 'true') {
          args[paramName] = raw;
          continue;
        }
        try {
          args[paramName] = JSON.parse(raw);
        } catch {
          args[paramName] = raw;
        }
      }

      toolCalls.push({
        id: `dsml_${randomUUID()}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(args)
        }
      });
    }
  }

  return toolCalls;
}

function resolveDesktopPath(getDesktopPath) {
  if (typeof getDesktopPath === 'function') {
    const resolved = getDesktopPath();
    if (resolved) return resolved;
  }
  return path.join(os.homedir(), 'Desktop');
}

function extractFileFilter(text) {
  const lower = String(text || '').toLowerCase();
  const extensionMatch = lower.match(/(?:\.|)(txt|md|json|csv|log|js|ts|py|png|jpg|jpeg|pdf)\b/);
  if (!extensionMatch) {
    return '*';
  }
  return `*.${extensionMatch[1]}`;
}

function resolveDirectToolRequest(userText, getDesktopPath) {
  const text = String(userText || '');
  const lower = text.toLowerCase();
  const wantsList = /(列出|查看|显示|找出|有哪些|list|show|find)/i.test(text);
  const mentionsDesktop = /(桌面|desktop)/i.test(text);
  const mentionsFile = /(文件|file)/i.test(text);

  if (wantsList && mentionsDesktop && mentionsFile) {
    return {
      toolName: 'file_ops_list_files',
      args: {
        path: resolveDesktopPath(getDesktopPath),
        filter: extractFileFilter(lower),
        recursive: /(子目录|递归|recursive|所有目录)/i.test(text)
      }
    };
  }

  return null;
}

function formatDirectToolSummary(toolName, toolResult) {
  if (toolName === 'file_ops_list_files' && toolResult && toolResult.ok) {
    const files = Array.isArray(toolResult.data?.files) ? toolResult.data.files : [];
    const total = typeof toolResult.data?.total === 'number' ? toolResult.data.total : files.length;
    if (files.length === 0) {
      return 'No matching files were found.';
    }

    const lines = files.slice(0, 30).map((file) => {
      const suffix = file.is_dir ? '/' : '';
      return `- ${file.name}${suffix}`;
    });
    const suffix = total > files.length ? `\n...and ${total - files.length} more.` : '';
    return `Found ${total} matching item(s):\n${lines.join('\n')}${suffix}`;
  }

  return toolResult?.summary || 'Completed';
}

// 实时数据查询：答案完全来自工具的当前值，历史对话记忆只会引入干扰
const REALTIME_SKIP_PATTERN = /(天气|weather|气温|温度|几度|下雨|晴天|阴天|雪|台风|雾|风速|预报|当前天气|今天天气|定位|你在哪|我在哪|当前位置|ip.*位置|位置.*ip)/i;
// 文件/系统操作：只需用户画像，不需要历史对话
const SYSOP_SKIP_PATTERN = /(桌面|desktop|文件|file|目录|folder|提醒|删除|移动|复制|重命名|打开|运行|命令|shell|bash|powershell)/i;

function shouldSkipAutomaticMemory(intent, userText) {
  const text = String(userText || '');
  // 实时查询：跳过记忆，不管 intent 是什么
  if (REALTIME_SKIP_PATTERN.test(text)) return true;
  // 系统操作类 task：也跳过历史记忆
  if ((intent === 'task' || intent === 'code') && SYSOP_SKIP_PATTERN.test(text)) return true;
  return false;
}

function estimateTokenCount(text) {
  const value = String(text || '');
  const chineseChars = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (value.match(/[a-zA-Z0-9_]+/g) || []).length;
  return Math.ceil(chineseChars * 1.5 + englishWords);
}

function trimToTokenBudget(text, maxTokens) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (estimateTokenCount(value) <= maxTokens) {
    return value;
  }

  let end = value.length;
  while (end > 0) {
    const next = value.slice(0, end).trim();
    if (estimateTokenCount(next) <= maxTokens) {
      return `${next}\n...`;
    }
    end -= Math.max(8, Math.ceil(value.length / 20));
  }

  return '';
}

function formatConversationSummary(summary) {
  const value = String(summary || '').trim();
  if (!value) return '';
  return trimToTokenBudget(value, 260);
}

function formatMessagesForSummary(messages) {
  return messages
    .filter((message) => message && message.role && typeof message.content === 'string' && message.content.trim())
    .map((message) => `${message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : message.role}：${message.content.trim()}`)
    .join('\n');
}

function formatLayerOneProfile(memorySystem, profile) {
  if (!profile) return '';

  if (memorySystem?.memoryLayerManager && typeof memorySystem.memoryLayerManager.formatProfile === 'function') {
    return trimToTokenBudget(memorySystem.memoryLayerManager.formatProfile(profile), 200);
  }

  const lines = [];
  if (profile.name) lines.push(`名字：${profile.name}`);
  if (profile.gender) lines.push(`性别：${profile.gender}`);
  if (profile.age) lines.push(`年龄：${profile.age}`);
  if (profile.birthday) lines.push(`生日：${profile.birthday}`);
  if (profile.occupation) lines.push(`职业：${profile.occupation}`);
  if (profile.location) lines.push(`所在地：${profile.location}`);
  if (Array.isArray(profile.preferences) && profile.preferences.length > 0) {
    lines.push(`喜欢：${profile.preferences.join('、')}`);
  }
  if (Array.isArray(profile.dislikes) && profile.dislikes.length > 0) {
    lines.push(`不喜欢：${profile.dislikes.join('、')}`);
  }
  if (Array.isArray(profile.relationships) && profile.relationships.length > 0) {
    lines.push(`关系：${profile.relationships.map((item) => `${item.relation}是${item.target}`).join('、')}`);
  }

  return trimToTokenBudget(lines.join('\n'), 200);
}

class AgentRuntime {
  constructor(options = {}) {
    this.sessionStore = options.sessionStore;
    this.eventBus = options.eventBus;
    this.capabilityRegistry = options.capabilityRegistry;
    this.memorySystem = options.memorySystem || null;
    this.modelRouter = options.modelRouter;
    this.getSceneConfig = options.getSceneConfig || (() => ({}));
    this.getDesktopPath = options.getDesktopPath || null;
    this.getAuthToken = options.getAuthToken || (() => '');
    this.onSummaryEvent = options.onSummaryEvent || null;

    this.abortControllers = new Map();
    this.sessionQueues = new Map();
    this.pendingApprovals = new Map();
    this.pendingInjections = new Map();
  }

  initialize() {
    this.sessionStore.initialize();
    this.sessionStore.archiveExpiredSessions();
    this.sessionStore.failOpenRunsOnStartup();
  }

  startSession({ channel = 'desktop-chat', metadata = {} } = {}) {
    return this.sessionStore.createSession({ channel, metadata });
  }

  async send({ sessionId, text, attachments = null, source = 'desktop-chat' }) {
    console.log('[AgentRuntime] send called:', {
      sessionId,
      source,
      textLength: typeof text === 'string' ? text.length : 0,
      attachments: Array.isArray(attachments) ? attachments.length : 0
    });
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      console.error('[AgentRuntime] send failed: session not found', sessionId);
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.state === 'archived') {
      console.error('[AgentRuntime] send failed: session archived', sessionId);
      throw new Error('Session is archived');
    }

    const queueState = this._getOrCreateQueueState(sessionId);
    const activeExists = !!queueState.activeRunId;
    const queueDepth = queueState.queue.length;

    if (activeExists || queueDepth > 0) {
      if (queueDepth >= 5) {
        const failedRun = this.sessionStore.createRun({
          sessionId,
          sourceText: text,
          source,
          attachments,
          status: 'failed',
          queuePosition: 0
        });
        this.sessionStore.updateRun(failedRun.id, {
          errorCode: 'queue_full',
          endedAt: Date.now()
        });
        this.eventBus.publish({
          sessionId,
          runId: failedRun.id,
          type: 'run.failed',
          payload: {
            reason: 'queue_full',
            message: 'The session queue is full'
          }
        });
      return { runId: failedRun.id, status: 'failed', reason: 'queue_full' };
    }

      const queuedRun = this.sessionStore.createRun({
        sessionId,
        sourceText: text,
        source,
        attachments,
        status: 'queued',
        queuePosition: queueDepth + 1
      });
      queueState.queue.push(queuedRun.id);
      this.eventBus.publish({
        sessionId,
        runId: queuedRun.id,
        type: 'run.created',
        payload: {
          status: 'queued',
          queuePosition: queueDepth + 1
        }
      });
      return { runId: queuedRun.id, status: 'queued' };
    }

    const run = this.sessionStore.createRun({
      sessionId,
      sourceText: text,
      source,
      attachments,
      status: 'running',
      queuePosition: 0
    });
    queueState.activeRunId = run.id;
    this.eventBus.publish({
      sessionId,
      runId: run.id,
      type: 'run.created',
      payload: {
        status: 'running',
        queuePosition: 0
      }
    });
    void this._executeRun(run.id);
    console.log('[AgentRuntime] run created:', { runId: run.id, sessionId, source });
    return { runId: run.id, status: 'running' };
  }

  async approve({ approvalId, approved }) {
    const approval = this.sessionStore.getApproval(approvalId);
    if (!approval || approval.status !== 'pending') {
      return { ok: false };
    }

    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      this.sessionStore.resolveApproval(approvalId, {
        status: approved ? 'approved' : 'denied',
        decision: approved ? 'approve' : 'deny'
      });
      return { ok: true };
    }

    this.sessionStore.resolveApproval(approvalId, {
      status: approved ? 'approved' : 'denied',
      decision: approved ? 'approve' : 'deny'
    });
    clearTimeout(pending.timeoutId);
    this.pendingApprovals.delete(approvalId);
    pending.resolve(approved ? 'approved' : 'denied');
    return { ok: true };
  }

  async cancel({ runId }) {
    const run = this.sessionStore.getRun(runId);
    if (!run) return { ok: false };

    const queueState = this._getOrCreateQueueState(run.sessionId);
    const queueIndex = queueState.queue.indexOf(runId);
    if (queueIndex !== -1) {
      queueState.queue.splice(queueIndex, 1);
      this._reindexQueue(run.sessionId);
      this.sessionStore.updateRun(runId, {
        status: 'cancelled',
        errorCode: 'cancelled',
        endedAt: Date.now()
      });
      this.eventBus.publish({
        sessionId: run.sessionId,
        runId,
        type: 'run.cancelled',
        payload: {
          reason: 'cancelled'
        }
      });
      this.pendingInjections.delete(runId);
      return { ok: true };
    }

    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }

    for (const [approvalId, pending] of this.pendingApprovals.entries()) {
      if (pending.runId === runId) {
        clearTimeout(pending.timeoutId);
        this.pendingApprovals.delete(approvalId);
        this.sessionStore.resolveApproval(approvalId, {
          status: 'cancelled',
          decision: 'deny'
        });
        pending.resolve('cancelled');
      }
    }

    this.sessionStore.updateRun(runId, {
      status: 'cancelled',
      errorCode: 'cancelled',
      endedAt: Date.now()
    });
    this.eventBus.publish({
      sessionId: run.sessionId,
      runId,
      type: 'run.cancelled',
      payload: {
        reason: 'cancelled'
      }
    });
    this.pendingInjections.delete(runId);
    this._finishRun(run.sessionId, runId);
    return { ok: true };
  }

  injectMessage(runId, text) {
    if (!this.pendingInjections.has(runId)) {
      this.pendingInjections.set(runId, []);
    }
    this.pendingInjections.get(runId).push(String(text || '').trim());
    return true;
  }

  /**
   * 用户回答 ask_user 技能的提问
   * @param {string} questionId - 提问 ID
   * @param {string} answer - 用户回答
   * @returns {{ ok: boolean, error?: string }}
   */
  respondToQuestion(questionId, answer) {
    const executor = this.capabilityRegistry?.skillExecutor;
    if (!executor) {
      return { ok: false, error: 'skill executor not ready' };
    }
    return executor.respondToQuestion(questionId, answer);
  }

  wait({ runId, timeoutMs = 90000 }) {
    console.log('[AgentRuntime] wait called:', { runId, timeoutMs });
    return this.eventBus.waitForRunCompletion(runId, timeoutMs);
  }

  getState({ sessionId, runId = null }) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    const activeRun = this.sessionStore.getSessionActiveRun(sessionId);
    const queue = this.sessionStore.getQueuedRuns(sessionId);
    const targetRunId = runId || activeRun?.id || queue[0]?.id || null;
    const events = targetRunId ? this.sessionStore.getEvents(targetRunId, 0, 100) : [];
    const approvals = this.sessionStore.getPendingApprovalsForSession(sessionId);
    const lastSeq = targetRunId ? this.eventBus.getLastSeq(targetRunId) : 0;
    const selectedRun = targetRunId ? this.sessionStore.getRun(targetRunId) : null;
    const latestCompletedRun = this.sessionStore.getLatestCompletedRun(sessionId);

    let assistantPreview = '';
    let plan = null;
    for (const event of events) {
      if (event.type === 'message.delta') {
        assistantPreview += event.payload.delta || '';
      }
      if (event.type === 'plan.updated') {
        plan = event.payload.plan || null;
      }
    }

    const messages = [];
    for (const pair of this.sessionStore.getRecentConversationMessages(sessionId, 8)) {
      messages.push(pair);
    }
    if (selectedRun && selectedRun.sourceText) {
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== selectedRun.sourceText) {
        messages.push({ role: 'user', content: selectedRun.sourceText });
      }
    }
    if (assistantPreview) {
      messages.push({ role: 'assistant', content: assistantPreview });
    }

    return {
      session,
      activeRun,
      queue,
      lastSeq,
      messages,
      conversationSummary: selectedRun?.conversationSummary || latestCompletedRun?.conversationSummary || '',
      plan,
      approvals
    };
  }

  async _executeRun(runId) {
    const run = this.sessionStore.getRun(runId);
    if (!run) return;

    const controller = new AbortController();
    this.abortControllers.set(runId, controller);

    // 全局 5 分钟超时保护，防止任务卡死
    const globalTimeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        console.warn(`[AgentRuntime] run ${runId} 超时（5分钟），强制取消`);
        controller.abort();
        this._failRun(run, 'global_timeout', '任务执行超时（5分钟）');
      }
    }, 5 * 60 * 1000);
    controller.signal.addEventListener('abort', () => clearTimeout(globalTimeout), { once: true });

    const session = this.sessionStore.getSession(run.sessionId);
    const personality = session?.metadata?.personality || 'healing';
    // 会话级意图继承：跟进消息自动继承上一轮的 task/code 意图
    const previousRun = this.sessionStore.getLatestCompletedRun(run.sessionId);
    const previousIntent = previousRun ? classifyIntent(previousRun.sourceText, previousRun.attachments) : null;
    const intent = classifyIntentWithSession(run.sourceText, run.attachments, previousIntent);
    const route = this.modelRouter.route(intent, {
      sceneConfig: this.getSceneConfig()
    });
    const routeAttempts = this._buildRouteAttempts(intent, route);
    let activeRoute = routeAttempts.shift() || route;

    if (!this._hasRouteCredential(activeRoute)) {
      this._failRun(run, 'missing_auth_token', 'Authentication is required for the selected model');
      return;
    }

    let plan = buildInitialPlan(intent, run.sourceText);
    if (plan) {
      this.eventBus.publish({
        sessionId: run.sessionId,
        runId,
        type: 'plan.updated',
        payload: { plan }
      });
    }

    const directToolRequest = resolveDirectToolRequest(run.sourceText, this.getDesktopPath);
    if (directToolRequest) {
      try {
        if (plan) {
          plan = updatePlanStep(plan, 1, 'done');
          plan = updatePlanStep(plan, 2, 'in_progress');
          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'plan.updated',
            payload: { plan }
          });
        }

        this.eventBus.publish({
          sessionId: run.sessionId,
          runId,
          type: 'tool.started',
          payload: {
            toolName: directToolRequest.toolName,
            args: directToolRequest.args
          }
        });

        const toolResult = await this.capabilityRegistry.execute(directToolRequest.toolName, directToolRequest.args, {
          context: {
            sessionId: run.sessionId,
            personality
          }
        });

        this.eventBus.publish({
          sessionId: run.sessionId,
          runId,
          type: 'tool.completed',
          payload: {
            toolName: directToolRequest.toolName,
            ok: toolResult.ok,
            summary: toolResult.summary,
            audit: toolResult.audit
          }
        });

        if (!toolResult.ok) {
          this._failRun(run, 'direct_tool_failed', toolResult.summary || 'Direct tool execution failed');
          return;
        }

        const finalText = formatDirectToolSummary(directToolRequest.toolName, toolResult);
        if (plan) {
          plan = updatePlanStep(plan, 2, 'done');
          plan = updatePlanStep(plan, 3, 'done');
          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'plan.updated',
            payload: { plan }
          });
        }

        this.eventBus.publish({
          sessionId: run.sessionId,
          runId,
          type: 'message.delta',
          payload: {
            delta: finalText
          }
        });

        const conversationSummary = await this._maybeCompressConversation({
          sessionId: run.sessionId,
          userText: run.sourceText,
          finalText,
          signal: controller.signal
        });

        this.sessionStore.updateRun(runId, {
          status: 'completed',
          finalText,
          conversationSummary,
          endedAt: Date.now()
        });

        if (this.memorySystem) {
          try {
            await this.memorySystem.addConversation('user', run.sourceText, { personality });
            await this.memorySystem.addConversation('assistant', finalText, { personality });
          } catch (memErr) {
            console.warn('[AgentRuntime] memory save failed (non-fatal):', memErr.message);
          }
        }

        const completedEvent = this.eventBus.publish({
          sessionId: run.sessionId,
          runId,
          type: 'run.completed',
          payload: {
            summary: finalText
          }
        });
        if (typeof this.onSummaryEvent === 'function') {
          this.onSummaryEvent(completedEvent);
        }
        this._finishRun(run.sessionId, runId);
        return;
      } catch (error) {
        this._failRun(run, 'direct_tool_failed', error.message);
        return;
      }
    }

    const memoryContext = await this._buildMemoryContext(intent, run.sourceText);
    const fileContext = await this._preFetchFileContext(intent, run.sourceText);

    const hasAttachments = Array.isArray(run.attachments) && run.attachments.length > 0;
    // 所有意图暴露全量工具，让 LLM 自主决定是否使用
    const availableTools = this.capabilityRegistry.listTools();
    let messages = this._buildMessages({
      personality,
      intent,
      memoryContext,
      fileContext,
      sessionId: run.sessionId,
      userText: run.sourceText,
      attachments: run.attachments
    });

    let finalText = '';
    let pendingFinalText = '';
    let round = 0;
    const toolOutcomes = [];
    let directReply = null; // web_search 失败时绕过 LLM，直接用此文案作最终回复
    let roundsSinceProgress = 0;

    try {
      const maxRounds = MAX_TOOL_ROUNDS_BY_INTENT[intent] ?? MAX_TOOL_ROUNDS;
      let emptyToolRounds = 0;   // 连续全部失败轮次计数

      while (round < maxRounds && !directReply) {
        // Layer 1: 轮内旧工具结果清理（只在 round > 0 时执行，首轮无 tool 消息）
        if (round > 0) {
          this._microCompact(messages);
          messages = await this._autoCompactIfNeeded(messages, activeRoute, controller.signal);
        }

        const injections = this.pendingInjections.get(runId) || [];
        if (injections.length > 0) {
          const injected = injections.shift();
          messages.push({ role: 'user', content: `[用户插入指令] ${injected}` });
          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'message.injected',
            payload: { text: injected }
          });
        }

        // Nag Reminder: 连续多轮无实质进展时提醒 LLM
        if (roundsSinceProgress >= NAG_THRESHOLD && round > 0) {
          messages.push({
            role: 'system',
            content: '<reminder>你已经执行了多轮工具调用但尚未产出实质成果。请检查：\n'
              + '1. 是否已获得足够信息可以直接完成任务？\n'
              + '2. 是否在重复相同的操作？如果是，请换一种方案。\n'
              + '3. 如果任务无法完成，请停止工具调用并向用户说明原因。</reminder>'
          });
          roundsSinceProgress = 0;
        }

        if (plan && round === 0) {
          plan = updatePlanStep(plan, 1, 'done');
          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'plan.updated',
            payload: { plan }
          });
        }

        // 每轮都传工具定义，LLM 自主决定何时停止调用（修复：原 round===0 限制导致多步任务必失败）
        const effectiveTools = activeRoute.supportsTools ? availableTools : [];
        let providerResult;
        try {
          providerResult = await this._streamProviderResponse({
            route: activeRoute,
            messages,
            tools: effectiveTools,
            run,
            signal: controller.signal
          });
        } catch (providerError) {
          if (hasAttachments && this._isUnsupportedMultimodalError(providerError)) {
            const visionRetryRoute = this._buildVisionRetryRoute(activeRoute);
            if (visionRetryRoute) {
              console.warn('[AgentRuntime] active route rejected image content, retrying with vision-capable route:', {
                from: `${activeRoute.provider}:${activeRoute.model}`,
                to: `${visionRetryRoute.provider}:${visionRetryRoute.model}`,
                reason: providerError.message
              });
              activeRoute = visionRetryRoute;
              continue;
            }
          }
          if (this._isRetryableProviderError(providerError) && routeAttempts.length > 0) {
            const nextRoute = routeAttempts.shift();
            console.warn('[AgentRuntime] provider request failed, switching fallback route:', {
              from: `${activeRoute.provider}:${activeRoute.model}`,
              to: `${nextRoute.provider}:${nextRoute.model}`,
              reason: providerError.message
            });
            activeRoute = nextRoute;
            continue;
          }
          throw providerError;
        }
        const roundContent = (providerResult.content || '').trim();
        if (providerResult.toolCalls.length === 0) {
          finalText = roundContent;
          break;
        }
        if (roundContent) {
          pendingFinalText = roundContent;
        }

        if (plan) {
          plan = updatePlanStep(plan, 2, 'in_progress');
          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'plan.updated',
            payload: { plan }
          });
        }

        messages.push({
          role: 'assistant',
          content: providerResult.content || null,
          tool_calls: providerResult.toolCalls
        });

        // 分组：安全工具并发执行，变更工具保持串行+确认流程
        const safeToolCalls = providerResult.toolCalls.filter(
          (tc) => !this.capabilityRegistry.isMutating(tc.function.name)
        );
        const mutatingToolCalls = providerResult.toolCalls.filter(
          (tc) => this.capabilityRegistry.isMutating(tc.function.name)
        );

        // 安全工具并发执行
        if (safeToolCalls.length > 0) {
          // 先依次发布 started 事件（保持顺序）
          for (const toolCall of safeToolCalls) {
            let toolArgs = {};
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch { toolArgs = {}; }
            this.eventBus.publish({
              sessionId: run.sessionId,
              runId,
              type: 'tool.started',
              payload: { toolName: toolCall.function.name, args: toolArgs }
            });
          }

          // 并发执行
          const safeResults = await Promise.all(safeToolCalls.map(async (toolCall) => {
            const toolName = toolCall.function.name;
            let toolArgs = {};
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch { toolArgs = {}; }
            const toolResult = await this._executeToolWithRetry(toolName, toolArgs, {
              context: { sessionId: run.sessionId, personality },
              onStream: (chunk) => {
                this.eventBus.publish({
                  sessionId: run.sessionId,
                  runId,
                  type: 'tool.delta',
                  payload: { toolName, chunk, toolCallId: toolCall.id }
                });
              },
              // ask_user 回调：通过 eventBus 通知前端显示提问 UI
              onAskUser: (questionData) => {
                this.eventBus.publish({
                  sessionId: run.sessionId,
                  runId,
                  type: 'user.question.requested',
                  payload: questionData
                });
              }
            });
            return { toolCall, toolName, toolArgs, toolResult };
          }));

          // 按原始顺序处理结果（保证 tool_call_id 匹配）
          for (const { toolCall, toolName, toolArgs, toolResult } of safeResults) {
            this.eventBus.publish({
              sessionId: run.sessionId,
              runId,
              type: 'tool.completed',
              payload: { toolName, ok: toolResult.ok, summary: toolResult.summary, audit: toolResult.audit }
            });
            toolOutcomes.push({
              toolName,
              ok: toolResult.ok,
              summary: toolResult.summary,
              data: toolResult.data,
              audit: toolResult.audit
            });

            // web_search 失败时直接设置回复文案
            if (toolName === 'web_search' && !toolResult.ok) {
              directReply = this._buildSearchFailureReply(toolResult);
            }

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: this._truncateToolContent(toolResult, toolName)
            });

            if (toolResult.ok && (toolName === 'file_write' || toolName === 'file_edit')) {
              const writtenPath = toolResult.data?.path || toolArgs?.path || '';
              const isCodeFile = CODE_FILE_EXTENSIONS.test(writtenPath);
              if (isCodeFile) {
                messages.push({
                  role: 'system',
                  content: `文件 ${writtenPath} 已写入。如果需要验证结果，可以用 bash_run 运行它或执行相关测试命令。`
                });
              }
            }
          }

          if (directReply) break;
        }

        // 变更工具串行执行（保留原有审批逻辑）
        for (const toolCall of mutatingToolCalls) {
          const toolName = toolCall.function.name;
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            toolArgs = {};
          }

          if (this.capabilityRegistry.isMutating(toolName)) {
            let approvalPreview = null;
            if (toolName === 'file_edit') {
              const previewResult = await this.capabilityRegistry.execute(toolName, toolArgs, {
                context: {
                  sessionId: run.sessionId,
                  personality
                },
                previewOnly: true
              });
              if (!previewResult.ok) {
                this._failRun(run, 'file_edit_preview_failed', previewResult.summary || 'File edit preview failed');
                return;
              }
              approvalPreview = previewResult.data || null;
            }

            const decision = await this._requestApproval(run, toolName, toolArgs, approvalPreview);
            if (decision === 'denied') {
              this._failRun(run, 'approval_denied', `Approval denied for tool ${toolName}`);
              return;
            }
            if (decision === 'timeout') {
              this._failRun(run, 'approval_timeout', `Approval timed out for tool ${toolName}`);
              return;
            }
            if (decision === 'cancelled') {
              await this.cancel({ runId });
              return;
            }
          }

          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'tool.started',
            payload: {
              toolName,
              args: toolArgs
            }
          });

          const toolResult = await this._executeToolWithRetry(toolName, toolArgs, {
            context: {
              sessionId: run.sessionId,
              personality
            },
            onStream: (chunk) => {
              this.eventBus.publish({
                sessionId: run.sessionId,
                runId,
                type: 'tool.delta',
                payload: {
                  toolName,
                  chunk
                }
              });
            },
            // ask_user 回调：通过 eventBus 通知前端显示提问 UI
            onAskUser: (questionData) => {
              this.eventBus.publish({
                sessionId: run.sessionId,
                runId,
                type: 'user.question.requested',
                payload: questionData
              });
            }
          });

          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'tool.completed',
            payload: {
              toolName,
              ok: toolResult.ok,
              summary: toolResult.summary,
              audit: toolResult.audit
            }
          });
          toolOutcomes.push({
            toolName,
            ok: toolResult.ok,
            summary: toolResult.summary,
            data: toolResult.data,
            audit: toolResult.audit
          });

          // web_search 失败时直接设置回复文案，绕过 LLM 自由发挥
          if (toolName === 'web_search' && !toolResult.ok) {
            directReply = this._buildSearchFailureReply(toolResult);
            break; // 跳出 for 循环；while 条件 !directReply 将阻止下一轮
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: this._truncateToolContent(toolResult, toolName)
          });

          if (toolResult.ok && (toolName === 'file_write' || toolName === 'file_edit')) {
            const writtenPath = toolResult.data?.path || toolArgs?.path || '';
            const isCodeFile = CODE_FILE_EXTENSIONS.test(writtenPath);
            if (isCodeFile) {
              messages.push({
                role: 'system',
                content: `文件 ${writtenPath} 已写入。如果需要验证结果，可以用 bash_run 运行它或执行相关测试命令。`
              });
            }
          }
        }

        // 连续空轮防护：全部工具失败则计数，超过阈值退出防止无限循环
        const roundToolCalls = providerResult.toolCalls || [];
        const roundSuccessCount = toolOutcomes.slice(-roundToolCalls.length).filter((o) => o.ok).length;
        if (roundToolCalls.length > 0 && roundSuccessCount === 0) {
          emptyToolRounds += 1;
          if (emptyToolRounds >= MAX_EMPTY_TOOL_ROUNDS) {
            console.warn('[AgentRuntime] 连续工具调用全失败，退出防止无限循环');
            break;
          }
        } else {
          emptyToolRounds = 0;
        }

        // Nag Reminder: 跟踪实质进展
        const recentOutcomes = toolOutcomes.slice(-roundToolCalls.length);
        const hasProgress = recentOutcomes.some(o => o.ok && PROGRESS_TOOL_NAMES.has(o.toolName));
        if (hasProgress) {
          roundsSinceProgress = 0;
        } else {
          roundsSinceProgress += 1;
        }

        round += 1;
      }

      if (!directReply && !finalText && toolOutcomes.length > 0) {
        try {
          messages.push({
            role: 'user',
            content: '请用中文简洁总结刚才完成的操作和结果。'
          });
          const summaryResult = await this._streamProviderResponse({
            route: activeRoute,
            messages,
            tools: [],
            run,
            signal: controller.signal
          });
          finalText = (summaryResult.content || '').trim();
        } catch {
          // 收尾失败则继续走 fallback
        }
      }

      if (directReply) {
        finalText = directReply; // ???????????? LLM
      } else if (!finalText && pendingFinalText && toolOutcomes.length === 0) {
        finalText = pendingFinalText;
      } else if (!finalText) {
        finalText = this._buildFallbackFinalText({ run, toolOutcomes });
      }

      // 经验记忆标记：多工具任务成功完成时，发布经验事件供记忆系统记录
      if (round > 1 && toolOutcomes.length > 0) {
        const successCount = toolOutcomes.filter(o => o.ok).length;
        if (successCount > 0) {
          try {
            this.eventBus.publish({
              sessionId: run.sessionId,
              runId: run.id,
              type: 'experience.recorded',
              payload: {
                task: userText.slice(0, 200),
                toolsUsed: [...new Set(toolOutcomes.filter(o => o.ok).map(o => o.toolName))],
                rounds: round,
                success: true
              }
            });
          } catch (e) {
            // 静默失败，不影响主流程
          }
        }
      }

      if (plan) {
        plan = updatePlanStep(plan, 2, 'done');
        plan = updatePlanStep(plan, 3, 'done');
        this.eventBus.publish({
          sessionId: run.sessionId,
          runId,
          type: 'plan.updated',
          payload: { plan }
        });
      }

      const conversationSummary = await this._maybeCompressConversation({
        sessionId: run.sessionId,
        userText: run.sourceText,
        finalText,
        signal: controller.signal
      });

      this.sessionStore.updateRun(runId, {
        status: 'completed',
        finalText,
        conversationSummary,
        endedAt: Date.now()
      });

      if (this.memorySystem) {
        try {
          await this.memorySystem.addConversation('user', run.sourceText, { personality });
          await this.memorySystem.addConversation('assistant', finalText, { personality });
        } catch (memErr) {
          console.warn('[AgentRuntime] memory save failed (non-fatal):', memErr.message);
        }
      }

      const completedEvent = this.eventBus.publish({
        sessionId: run.sessionId,
        runId,
        type: 'run.completed',
        payload: {
          summary: finalText
        }
      });
      if (typeof this.onSummaryEvent === 'function') {
        this.onSummaryEvent(completedEvent);
      }
      this._finishRun(run.sessionId, runId);
    } catch (error) {
      if (error.name === 'AbortError') {
        this.sessionStore.updateRun(runId, {
          status: 'cancelled',
          errorCode: 'cancelled',
          endedAt: Date.now()
        });
        this.eventBus.publish({
          sessionId: run.sessionId,
          runId,
          type: 'run.cancelled',
          payload: {
            reason: 'cancelled'
          }
        });
        this._finishRun(run.sessionId, runId);
      } else {
        console.error('[AgentRuntime] runtime error:', error);
        this._failRun(run, 'runtime_error', error.message);
      }
    } finally {
      clearTimeout(globalTimeout);
      this.abortControllers.delete(runId);
    }
  }

  _buildMessages({ personality, intent, memoryContext, fileContext = '', sessionId, userText, attachments = null }) {
    let systemPrompt = buildPersonalityPrompt(personality);
    const session = this.sessionStore.getSession(sessionId);
    const petName = session?.metadata?.petName || '';
    const userName = session?.metadata?.userName || '';
    if (petName || userName) {
      let identityParts = [];
      if (petName) identityParts.push(`你的名字是「${petName}」，主人这样叫你，被问名字时请用这个名字回答。`);
      if (userName) identityParts.push(`你的主人叫「${userName}」，请记住并在对话中自然地使用这个称呼。`);
      // 注入用户兴趣爱好标签
      const interests = session?.metadata?.interests;
      if (Array.isArray(interests) && interests.length > 0) {
        identityParts.push(`${userName || '主人'}的兴趣爱好包括：${interests.join('、')}。可以适时围绕这些话题展开聊天。`);
      }
      systemPrompt = identityParts.join('\n') + `\n\n${systemPrompt}`;
    }
    // 注入当前日期，防止 LLM 使用训练数据中的历史日期
    const _now = new Date();
    const _todayStr = `${_now.getFullYear()}年${String(_now.getMonth() + 1).padStart(2, '0')}月${String(_now.getDate()).padStart(2, '0')}日`;
    systemPrompt += `\n\n当前日期：${_todayStr}。`;
    // 类人思考协议（所有意图注入，引导 LLM 分步思考、组合工具、不轻言放弃）
    systemPrompt += '\n\n' + HUMAN_THINKING_PROTOCOL;
    // 通用工具使用指南（所有意图都注入，确保 LLM 知道可以使用工具）
    systemPrompt += '\n\n你拥有多种工具能力，当用户请求需要实际操作（文件、命令、搜索等）时，请主动使用工具完成，而不是仅用语言描述。';
    if (intent === 'task' || intent === 'code') {
      systemPrompt += '\n工具调用规范：\n'
        + '1. 优先使用工具完成任务，不要猜测文件内容或命令结果\n'
        + '2. 文件过长时（返回 _truncated:true）请用 offset/limit 参数分段读取\n'
        + '3. 写入代码文件后，主动用 bash_run 验证运行结果\n'
        + '4. 工具调用失败时，根据错误信息调整参数或换方案重试\n'
        + '完成任务后用中文简洁总结实际完成的内容和结果。';
    }
    if (intent === 'search') {
      systemPrompt += '\n\n【搜索强制规范 — 必须严格遵守】\n'
        + '• 询问今日新闻/热点/趣闻时：直接调用 web_search 获取实时结果。\n'
        + '• 其他搜索：用简短关键词（不含年份）调用 web_search，最多 2 次。\n'
        + '• 搜索后【必须】对最相关的 URL 逐个调用 web_fetch 读取真实内容。\n'
        + '  - fetch 超时或失败时立刻换下一个，至少尝试 3 个 URL。\n'
        + '• 根据 fetch 到的真实内容作答，不允许只凭搜索摘要回答。\n'
        + '【禁止】连续多次 web_search 却不调用 web_fetch。';
    }
    if (intent === 'search') {
      systemPrompt += '\nAdditional search handling:\n'
        + '- For leaderboard queries like Weibo hot search, if web_search already returns a structured ranking list, answer directly from that list and do not force web_fetch for every item.\n'
        + '- Do not keep changing keywords for the same leaderboard query.\n'
        + '- If repeated search/fetch attempts fail, stop and explain the failure instead of looping until timeout.\n';
    }
    if (memoryContext && memoryContext.trim()) {
      systemPrompt += `\n\nRelevant memory:\n${memoryContext.trim()}`;
    }
    if (fileContext && fileContext.trim()) {
      systemPrompt += `\n\n当前文件上下文：\n${fileContext.trim()}`;
    }

    const latestCompletedRun = this.sessionStore.getLatestCompletedRun(sessionId);
    const conversationSummary = formatConversationSummary(latestCompletedRun?.conversationSummary || '');
    const historyRunLimit = conversationSummary ? 2 : 4;
    const history = this.sessionStore.getRecentConversationMessages(sessionId, historyRunLimit);
    return [
      { role: 'system', content: systemPrompt },
      ...(conversationSummary ? [{ role: 'assistant', content: `之前对话摘要：\n${conversationSummary}` }] : []),
      ...history,
      { role: 'user', content: this._buildUserContent(userText, attachments) }
    ];
  }
  _buildUserContent(userText, attachments = null) {
    const normalizedText = String(userText || '').trim();
    const imageAttachments = Array.isArray(attachments)
      ? attachments.filter((attachment) =>
          attachment &&
          typeof attachment.dataURL === 'string' &&
          attachment.dataURL.startsWith('data:image/')
        )
      : [];

    if (imageAttachments.length === 0) {
      return normalizedText;
    }

    const content = [
      {
        type: 'text',
        text: normalizedText || '请结合这张图片回答。'
      }
    ];

    imageAttachments.slice(0, 4).forEach((attachment) => {
      content.push({
        type: 'image_url',
        image_url: { url: attachment.dataURL }
      });
    });

    return content;
  }

  async _buildMemoryContext(intent, userText) {
    if (!this.memorySystem) {
      return '';
    }

    if (intent === 'task') {
      try {
        const profile = await this.memorySystem.getUserProfile();
        return formatLayerOneProfile(this.memorySystem, profile);
      } catch (error) {
        console.warn('[AgentRuntime] task profile context failed:', error.message);
        return '';
      }
    }

    if (shouldSkipAutomaticMemory(intent, userText)) {
      return '';
    }

    try {
      return await this.memorySystem.getContext(userText, {
        maxTokens: 1000,
        maxMemories: 8,
        currentMood: 80
      });
    } catch (error) {
      console.warn('[AgentRuntime] memory context failed:', error.message);
      return '';
    }
  }

  async _preFetchFileContext(intent, userText) {
    if (intent !== 'task' && intent !== 'code') return '';

    const sourceText = String(userText || '');
    const mentionedPaths = [];
    const desktopPath = resolveDesktopPath(this.getDesktopPath);

    if (/桌面|desktop/i.test(sourceText)) {
      mentionedPaths.push({ dir: desktopPath, depth: 1 });
    }

    const pathMatches = sourceText.match(/[A-Za-z]:[\\/][^\s"'，。！？]+/g) || [];
    for (const rawPath of pathMatches) {
      const normalized = rawPath.replace(/\//g, '\\').replace(/[\\]+$/, '');
      const dirPath = path.extname(normalized) ? path.dirname(normalized) : normalized;
      if (!mentionedPaths.find((item) => item.dir === dirPath)) {
        mentionedPaths.push({ dir: dirPath, depth: 2 });
      }
    }

    if (mentionedPaths.length === 0) return '';

    const sections = [];

    for (const { dir: dirPath, depth } of mentionedPaths.slice(0, 2)) {
      try {
        const tree = await this._buildFileTree(dirPath, depth, 60);
        if (tree.length > 0) {
          sections.push(`目录 ${dirPath}:\n${tree.join('\n')}`);
        }
      } catch {
        // 跳过不可读目录
      }
    }

    return sections.join('\n\n');
  }

  async _buildFileTree(rootPath, maxDepth, maxItems) {
    const lines = [];
    const queue = [{ dir: rootPath, prefix: '', depth: 0 }];
    let count = 0;

    while (queue.length > 0 && count < maxItems) {
      const { dir, prefix, depth } = queue.shift();
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      const filtered = entries
        .filter((entry) => !entry.name.startsWith('.') && !['node_modules', '__pycache__', 'dist', '.git'].includes(entry.name))
        .slice(0, 20);

      for (const entry of filtered) {
        if (count >= maxItems) break;
        const icon = entry.isDirectory() ? '' : '';
        lines.push(`${prefix}${icon} ${entry.name}`);
        count += 1;
        if (entry.isDirectory() && depth < maxDepth - 1) {
          queue.push({ dir: path.join(dir, entry.name), prefix: `${prefix}  `, depth: depth + 1 });
        }
      }
    }
    return lines;
  }
  _buildProviderHeaders(route) {
    const authToken = route?.authToken || this.getAuthToken();
    const apiKey = route?.apiKey || '';
    const bearerToken = apiKey || authToken;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    if (route.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ai-desktop-pet.local';
      headers['X-Title'] = 'AI Desktop Pet';
    }

    return headers;
  }


  _buildRouteAttempts(intent, primaryRoute) {
    const fallbackChain = typeof this.modelRouter?.getFallbackChain === 'function'
      ? this.modelRouter.getFallbackChain(intent)
      : [];
    const attempts = [];
    const seen = new Set();

    for (const route of [primaryRoute, ...fallbackChain]) {
      if (!route || !route.provider || !route.endpoint) continue;
      const key = `${route.provider}:${route.model}:${route.endpoint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attempts.push(route);
    }

    return attempts;
  }

  _hasRouteCredential(route) {
    if (!route) {
      return false;
    }
    if (route.provider === 'tesseract') {
      return true;
    }
    return Boolean(route.apiKey || route.authToken || this.getAuthToken());
  }

  _isRetryableProviderError(error) {
    const message = String(error && error.message ? error.message : error || '').toLowerCase();
    return message.includes('fetch failed')
      || message.includes('timed out')
      || message.includes('timeout')
      || message.includes('econnreset')
      || message.includes('enotfound')
      || message.includes('eai_again')
      || message.includes('socket hang up')
      || message.includes('und_err_connect_timeout')
      || message.includes('503')
      || message.includes('502')
      || message.includes('504');
  }

  _isUnsupportedMultimodalError(error) {
    const message = String(error && error.message ? error.message : error || '').toLowerCase();
    return message.includes('unknown variant `image_url`')
      || message.includes("expected `text`")
      || message.includes('expected text')
      || message.includes('deserialize the json body')
      || message.includes('image_url');
  }

  _buildVisionRetryRoute(activeRoute) {
    const candidates = [];

    if (activeRoute && activeRoute.provider === 'qwen' && activeRoute.model !== BUILTIN_API.getSceneModel('vision')) {
      candidates.push({
        ...activeRoute,
        model: BUILTIN_API.getSceneModel('vision'),
        supportsVision: true
      });
    }

    candidates.push({
      ...BUILTIN_API.getRoute('vision'),
      authToken: this.getAuthToken()
    });

    const seen = new Set();
    for (const route of candidates) {
      if (!route) continue;
      const key = `${route.provider}:${route.model}:${route.endpoint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this._hasRouteCredential(route)) {
        return route;
      }
    }

    return null;
  }

  _buildSearchFailureReply(toolResult) {
    return [
      toolResult.summary,
      toolResult.audit?.error && toolResult.audit.error !== toolResult.summary
        ? `底层错误: ${toolResult.audit.error}`
        : ''
    ].filter(Boolean).join('\n');
  }

  // 可重试工具配置（仅网络类工具，非网络错误不重试）
  _truncateToolContent(toolResult, toolName) {
    const MAX_CHARS = 2000;

    let raw;
    if (!toolResult.ok) {
      raw = {
        error: toolResult.summary,
        isError: true,
        ...(toolName === 'bash_run' && toolResult.data ? {
          exitCode: toolResult.data.exitCode,
          stderr: String(toolResult.data.stderr || '').slice(0, 500),
          stdout: String(toolResult.data.stdout || '').slice(0, 200)
        } : {})
      };
    } else {
      raw = toolResult.data == null
        ? { ok: true, summary: toolResult.summary }
        : toolResult.data;
    }

    const jsonStr = JSON.stringify(raw);
    if (jsonStr.length <= MAX_CHARS) return jsonStr;

    if (raw && typeof raw.content === 'string') {
      const lines = raw.content.split('\n');
      const totalLines = lines.length;
      const omittedLines = Math.max(0, totalLines - 40);
      const buildCompressed = (lineLimit = null) => {
        const trimLine = (line) => {
          if (!lineLimit || line.length <= lineLimit) return line;
          return `${line.slice(0, lineLimit)}...`;
        };
        const headLines = lines.slice(0, 30).map(trimLine).join('\n');
        const tailLines = lines.slice(-10).map(trimLine).join('\n');
        return {
          ...raw,
          content: `${headLines}\n\n... [省略中间 ${omittedLines} 行] ...\n\n${tailLines}`,
          _compressed: true,
          _totalLines: totalLines
        };
      };

      const compressed = buildCompressed();
      const compressedStr = JSON.stringify(compressed);
      if (compressedStr.length <= MAX_CHARS * 1.2) return compressedStr;

      const compactCompressed = buildCompressed(80);
      const compactCompressedStr = JSON.stringify(compactCompressed);
      if (compactCompressedStr.length <= MAX_CHARS * 1.2) return compactCompressedStr;

      const ultraCompactCompressed = buildCompressed(40);
      const ultraCompactCompressedStr = JSON.stringify(ultraCompactCompressed);
      if (ultraCompactCompressedStr.length <= MAX_CHARS * 1.2) return ultraCompactCompressedStr;

      const summaryCompressed = {
        ...raw,
        content: `前30行预览:\n${lines.slice(0, 30).map((line) => line.slice(0, 40)).join('\n')}\n\n... [省略中间 ${omittedLines} 行] ...\n\n尾10行预览:\n${lines.slice(-10).map((line) => line.slice(0, 40)).join('\n')}`,
        _compressed: true,
        _totalLines: totalLines
      };
      const summaryCompressedStr = JSON.stringify(summaryCompressed);
      if (summaryCompressedStr.length <= MAX_CHARS * 1.2) return summaryCompressedStr;
    }

    return JSON.stringify({
      _truncated: true,
      _originalLength: jsonStr.length,
      _preview: jsonStr.slice(0, 1500),
      summary: toolResult.summary || '内容过长已截断，可用 offset/limit 参数分段读取'
    });
  }

  /**
   * 轮内旧工具结果清理（micro compact）
   * 按"关联的 assistant 消息"分组保留最近 2 个 assistant 轮次的所有 tool 消息，
   * 更旧的 tool 消息连同对应的 assistant.tool_calls 条目和紧随的 system 验证提示一起删除。
   * 这样即使某轮并发执行 4+ 个安全工具（Promise.all），也不会破坏 tool_call_id 对应关系。
   * 始终保留 messages[0]（system prompt）。
   */
  _microCompact(messages) {
    // 1. 找到所有含 tool_calls 的 assistant 消息（按出现顺序）
    const assistantIndices = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'assistant' && Array.isArray(messages[i].tool_calls) && messages[i].tool_calls.length > 0) {
        assistantIndices.push(i);
      }
    }

    // 保留最近 2 个 assistant 轮次不动
    if (assistantIndices.length <= 2) return;

    // 2. 收集需要保留的 tool_call_id（最近 2 个 assistant 消息的所有 tool_calls）
    const keepCallIds = new Set();
    const keepAssistantIndices = new Set();
    for (let k = assistantIndices.length - 2; k < assistantIndices.length; k++) {
      const aIdx = assistantIndices[k];
      keepAssistantIndices.add(aIdx);
      for (const tc of messages[aIdx].tool_calls) {
        keepCallIds.add(tc.id);
      }
    }

    // 3. 找到所有不在保留集合中的 tool 消息
    const removeSet = new Set();
    for (let i = 1; i < messages.length; i++) {
      if (messages[i].role === 'tool' && !keepCallIds.has(messages[i].tool_call_id)) {
        const toolCallId = messages[i].tool_call_id;

        // 从对应的 assistant 消息中移除该 tool_calls 条目
        for (let j = i - 1; j >= 1; j--) {
          const msg = messages[j];
          if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
            const callIdx = msg.tool_calls.findIndex(tc => tc.id === toolCallId);
            if (callIdx !== -1) {
              msg.tool_calls.splice(callIdx, 1);
              // tool_calls 被清空时：Qwen API 拒绝空数组，必须处理
              if (msg.tool_calls.length === 0) {
                if (!msg.content || msg.content.trim() === '') {
                  // 无 content 也无 tool_calls → 删除整条消息
                  removeSet.add(j);
                } else {
                  // 有 content 但 tool_calls 为空 → 删除 tool_calls 属性，保留消息
                  delete msg.tool_calls;
                }
              }
              break;
            }
          }
        }

        // 标记该 tool 消息为待删除
        removeSet.add(i);

        // 删除紧跟在该 tool 消息之后的 system 消息（验证提示）
        if (i + 1 < messages.length && messages[i + 1].role === 'system') {
          removeSet.add(i + 1);
        }
      }
    }

    if (removeSet.size === 0) return;

    // 从后往前删除，避免索引偏移（不删除 messages[0]）
    const sortedIndices = Array.from(removeSet).sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      if (idx === 0) continue; // 保护 system prompt
      messages.splice(idx, 1);
    }
  }

  /**
   * Token 超阈值自动压缩（auto compact）
   * 当 messages 总 token 超过 AUTO_COMPACT_TOKEN_THRESHOLD 时，
   * 保留 system prompt + 最近 SUMMARY_RECENT_MESSAGE_WINDOW 条消息，
   * 中间部分调用 _summarizeConversation 压缩为摘要。
   */
  async _autoCompactIfNeeded(messages, route, signal) {
    // 计算总 token
    let totalTokens = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalTokens += estimateTokenCount(msg.content);
      } else if (Array.isArray(msg.content)) {
        // 多模态消息（text + image_url）
        for (const part of msg.content) {
          if (part.type === 'text') {
            totalTokens += estimateTokenCount(part.text);
          }
        }
      }
      // tool_calls 参数也计入
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          totalTokens += estimateTokenCount(tc.function?.arguments || '');
        }
      }
    }

    if (totalTokens <= AUTO_COMPACT_TOKEN_THRESHOLD) {
      return messages;
    }

    console.log(`[AgentRuntime] auto compact 触发: ${totalTokens} tokens > ${AUTO_COMPACT_TOKEN_THRESHOLD} 阈值`);

    const systemMsg = messages[0]; // 始终保留
    const recentCount = Math.min(SUMMARY_RECENT_MESSAGE_WINDOW, messages.length - 1);
    const recentMessages = messages.slice(-recentCount);
    const middleMessages = messages.slice(1, messages.length - recentCount);

    if (middleMessages.length === 0) {
      return messages;
    }

    try {
      // 从中间部分提取可读文本用于摘要
      const summaryRoute = route || this.modelRouter.route('chat', {
        sceneConfig: this.getSceneConfig()
      });

      if (!summaryRoute || !this._hasRouteCredential(summaryRoute)) {
        // 无可用路由：直接丢弃中间消息
        return [systemMsg, ...recentMessages];
      }

      const summary = await this._summarizeConversation({
        route: summaryRoute,
        previousSummary: '',
        recentMessages: middleMessages.filter(m => m.role && typeof m.content === 'string' && m.content.trim()),
        signal
      });

      if (summary) {
        return [
          systemMsg,
          { role: 'assistant', content: `对话上下文摘要：\n${summary}` },
          ...recentMessages
        ];
      }

      // 摘要为空：直接丢弃中间消息
      return [systemMsg, ...recentMessages];
    } catch (err) {
      console.warn('[AgentRuntime] auto compact 压缩失败，直接丢弃中间消息:', err.message);
      // 降级方案：直接删除中间消息
      return [systemMsg, ...recentMessages];
    }
  }

  async _executeToolWithRetry(toolName, toolArgs, options) {
    const RETRYABLE_TOOLS = {
      web_search:  { maxRetries: 2, delayMs: 1000 },
      web_fetch:   { maxRetries: 2, delayMs: 1000 },
      weather_get: { maxRetries: 1, delayMs: 500 }
    };

    const retryConfig = RETRYABLE_TOOLS[toolName];
    if (!retryConfig) {
      return await this.capabilityRegistry.execute(toolName, toolArgs, options);
    }

    let lastResult = null;
    let lastError = null;
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, retryConfig.delayMs));
        console.warn(`[AgentRuntime] ${toolName} 第${attempt + 1}次重试`);
      }
      let result;
      try {
        result = await this.capabilityRegistry.execute(toolName, toolArgs, options);
      } catch (error) {
        lastError = error;
        if (!this._isRetryableProviderError(error)) {
          throw error;
        }
        continue;
      }
      if (result.ok) return result;
      const err = String(result.summary || result.audit?.error || '').toLowerCase();
      const isNet = /fetch failed|timed? ?out|econnreset|enotfound|network|网络|超时|连接/.test(err);
      if (!isNet) return result;   // 非网络错误不重试
      lastResult = result;
    }
    if (!lastResult && lastError) {
      throw lastError;
    }
    return {
      ...lastResult,
      summary: `${lastResult.summary}（已重试 ${retryConfig.maxRetries} 次）`
    };
  }

  _buildFallbackFinalText({ run, toolOutcomes = [] }) {
    const successfulOutcomes = toolOutcomes.filter((item) => item && item.ok);
    if (successfulOutcomes.length === 0) {
      const failedOutcomes = toolOutcomes.filter((item) => item && item.ok === false);
      const lastFailure = failedOutcomes[failedOutcomes.length - 1];
      const failureSummary = String(lastFailure?.summary || '').trim();
      if (failureSummary) {
        return `任务失败：${failureSummary}`;
      }
      return toolOutcomes.length > 0 ? '任务失败。' : '任务已完成。';
    }

    const lastOutcome = successfulOutcomes[successfulOutcomes.length - 1];
    const detail = this._formatToolOutcomeSummary(lastOutcome);
    if (successfulOutcomes.length === 1) {
      return detail ? `已完成：${detail}` : '操作已完成。';
    }
    if (detail) {
      return `已完成 ${successfulOutcomes.length} 个操作。最后一步：${detail}`;
    }
    return `已完成 ${successfulOutcomes.length} 个操作。`;
  }

  _formatToolOutcomeSummary(outcome) {
    if (!outcome) return '';

    const summary = String(outcome.summary || '').trim();
    if (summary && !/^completed$/i.test(summary) && !/^returned fields:/i.test(summary)) {
      return summary.slice(0, 240);
    }

    const data = outcome.data;
    if (data && typeof data === 'object') {
      const action = typeof data.action === 'string' ? data.action : '';
      const targetPath = typeof data.path === 'string'
        ? data.path
        : (typeof data.relative_path === 'string' ? data.relative_path : '');
      if (action && targetPath) {
        return `${action} ${targetPath}`;
      }
      if (targetPath) {
        return `${outcome.toolName} ${targetPath}`;
      }
      if (typeof data.content === 'string' && data.content.trim()) {
        return data.content.trim().slice(0, 240);
      }
      if (Array.isArray(data.files) && data.files.length > 0) {
        return `返回了 ${data.files.length} 个文件结果`;
      }
    }

    if (outcome.toolName) {
      return `已执行 ${outcome.toolName}`;
    }
    return '';
  }

  async _streamProviderResponse({ route, messages, tools, run, signal }) {
    const requestBody = {
      model: route.model,
      messages,
      stream: true,
      max_tokens: 1200,
      temperature: 0.7,
      enable_thinking: false
    };

    if (route.supportsTools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const headers = this._buildProviderHeaders(route);

    const response = await fetch(route.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        detail = '';
      }
      throw new Error(`provider_error_${response.status}: ${detail || response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Provider response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let aggregate = '';
    let pendingDelta = '';
    let lastFlushAt = 0;
    let firstDeltaSent = false;
    const toolCalls = new Map();

    const flushDelta = (force = false) => {
      if (!pendingDelta) return;
      const now = Date.now();
      if (!force && pendingDelta.length < 128 && now - lastFlushAt < 50) {
        return;
      }
      aggregate += pendingDelta;
      this.eventBus.publish({
        sessionId: run.sessionId,
        runId: run.id,
        type: 'message.delta',
        payload: {
          delta: pendingDelta
        }
      });
      pendingDelta = '';
      lastFlushAt = now;
      firstDeltaSent = true;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const lines = frame.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') {
            flushDelta(true);
            continue;
          }

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = parsed.choices && parsed.choices[0];
          if (!choice) continue;
          const delta = choice.delta || {};

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            pendingDelta += delta.content;
            if (!firstDeltaSent) {
              flushDelta(true);
            } else {
              flushDelta(false);
            }
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const partialCall of delta.tool_calls) {
              const index = partialCall.index ?? toolCalls.size;
              const existing = toolCalls.get(index) || {
                id: partialCall.id || `tool_${randomUUID()}`,
                type: 'function',
                function: {
                  name: '',
                  arguments: ''
                }
              };

              if (partialCall.id) {
                existing.id = partialCall.id;
              }
              if (partialCall.function?.name) {
                existing.function.name += partialCall.function.name;
              }
              if (partialCall.function?.arguments) {
                existing.function.arguments += partialCall.function.arguments;
              }
              toolCalls.set(index, existing);
            }
          }
        }
      }
    }

    flushDelta(true);
    const dsmlToolCalls = parseDSMLToolCalls(aggregate);
    const finalizedToolCalls = toolCalls.size > 0
      ? Array.from(toolCalls.values())
      : dsmlToolCalls;

    return {
      content: aggregate,
      toolCalls: finalizedToolCalls
    };
  }

  async _maybeCompressConversation({ sessionId, userText, finalText, signal }) {
    const latestCompletedRun = this.sessionStore.getLatestCompletedRun(sessionId);
    const previousSummary = formatConversationSummary(latestCompletedRun?.conversationSummary || '');
    const recentMessages = this.sessionStore.getRecentConversationMessages(sessionId, 4);
    const nextMessages = [
      ...recentMessages,
      { role: 'user', content: userText },
      { role: 'assistant', content: finalText }
    ].filter((message) => message.content);

    // 没有历史摘要且消息量未超阈值：直接跳过，不压缩
    if (!previousSummary && nextMessages.length <= RAW_HISTORY_WINDOW_MESSAGES) {
      return '';
    }
    // 已有摘要但本轮消息很短：沿用旧摘要，避免每轮都发一次摘要 API 请求
    if (previousSummary && nextMessages.length <= SUMMARY_RECENT_MESSAGE_WINDOW) {
      return previousSummary;
    }

    const summaryRoute = this.modelRouter.route('chat', {
      sceneConfig: this.getSceneConfig()
    });

    if (!summaryRoute || !this._hasRouteCredential(summaryRoute) || summaryRoute.provider === 'tesseract') {
      return previousSummary;
    }

    try {
      const summary = await this._summarizeConversation({
        route: summaryRoute,
        previousSummary,
        recentMessages: nextMessages.slice(-SUMMARY_RECENT_MESSAGE_WINDOW),
        signal
      });
      return summary || previousSummary;
    } catch (error) {
      console.warn('[AgentRuntime] conversation summary failed:', error.message);
      return previousSummary;
    }
  }

  async _summarizeConversation({ route, previousSummary, recentMessages, signal }) {
    const response = await fetch(route.endpoint, {
      method: 'POST',
      headers: this._buildProviderHeaders(route),
      body: JSON.stringify({
        model: route.model,
        stream: false,
        max_tokens: 300,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You compress prior conversation into a concise continuation summary. Preserve user goals, constraints, decisions, important facts, file paths, URLs, completed results, and pending tasks. Output concise Chinese in at most 6 short lines.'
          },
          {
            role: 'user',
            content: [
              '请把下面的对话历史压缩成一条后续任务可恢复的摘要。',
              '保留：用户目标、约束、重要偏好、文件路径、URL、已完成结果、未完成事项。',
              '删除：寒暄、重复表述、无关细节。',
              previousSummary ? `已有摘要：\n${previousSummary}` : '已有摘要：无',
              recentMessages.length > 0 ? `最近对话：\n${formatMessagesForSummary(recentMessages)}` : '最近对话：无'
            ].join('\n\n')
          }
        ]
      }),
      signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`summary_provider_error_${response.status}: ${detail || response.statusText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return String(content).trim().slice(0, SUMMARY_MAX_CHARS);
  }

  async _requestApproval(run, toolName, toolArgs, preview = null) {
    // 使用 humanizer 生成自然语言描述，替代原始 JSON 参数展示
    const humanized = ApprovalHumanizer.humanize(toolName, toolArgs, preview);
    const summary = humanized.description;
    const approval = this.sessionStore.createApproval({
      runId: run.id,
      toolName,
      summary,
      args: toolArgs,
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS
    });

    this.sessionStore.updateRun(run.id, {
      status: 'awaiting_approval'
    });

    const event = this.eventBus.publish({
      sessionId: run.sessionId,
      runId: run.id,
      type: 'approval.requested',
      payload: {
        approvalId: approval.id,
        toolName,
        title: humanized.title,
        summary,
        isDangerous: humanized.isDangerous,
        args: toolArgs,
        preview: humanized.preview || preview,
        expiresAt: approval.expiresAt
      }
    });

    if (typeof this.onSummaryEvent === 'function') {
      this.onSummaryEvent(event);
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingApprovals.delete(approval.id);
        this.sessionStore.resolveApproval(approval.id, {
          status: 'timed_out',
          decision: 'deny'
        });
        resolve('timeout');
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(approval.id, {
        runId: run.id,
        timeoutId,
        resolve: (decision) => {
          this.sessionStore.updateRun(run.id, {
            status: 'running'
          });
          resolve(decision);
        }
      });
    });
  }

  _failRun(run, code, message) {
    this.sessionStore.updateRun(run.id, {
      status: 'failed',
      errorCode: code,
      endedAt: Date.now()
    });
    const event = this.eventBus.publish({
      sessionId: run.sessionId,
      runId: run.id,
      type: 'run.failed',
      payload: {
        reason: code,
        message
      }
    });
    if (typeof this.onSummaryEvent === 'function') {
      this.onSummaryEvent(event);
    }
    this._finishRun(run.sessionId, run.id);
  }

  _finishRun(sessionId, runId) {
    this.pendingInjections.delete(runId);
    const queueState = this._getOrCreateQueueState(sessionId);
    if (queueState.activeRunId === runId) {
      queueState.activeRunId = null;
    } else {
      queueState.queue = queueState.queue.filter((id) => id !== runId);
    }

    if (!queueState.activeRunId && queueState.queue.length > 0) {
      const nextRunId = queueState.queue.shift();
      queueState.activeRunId = nextRunId;
      const nextRun = this.sessionStore.updateRun(nextRunId, {
        status: 'running',
        queuePosition: 0,
        startedAt: Date.now()
      });
      this._reindexQueue(sessionId);
      this.eventBus.publish({
        sessionId,
        runId: nextRunId,
        type: 'run.created',
        payload: {
          status: 'running',
          queuePosition: 0
        }
      });
      if (nextRun) {
        void this._executeRun(nextRunId);
      }
    } else {
      this._reindexQueue(sessionId);
    }
  }

  _reindexQueue(sessionId) {
    const queueState = this._getOrCreateQueueState(sessionId);
    queueState.queue.forEach((runId, index) => {
      this.sessionStore.updateRun(runId, {
        queuePosition: index + 1
      });
    });
  }

  _getOrCreateQueueState(sessionId) {
    if (!this.sessionQueues.has(sessionId)) {
      const activeRun = this.sessionStore.getSessionActiveRun(sessionId);
      const queuedRuns = this.sessionStore.getQueuedRuns(sessionId);
      this.sessionQueues.set(sessionId, {
        activeRunId: activeRun ? activeRun.id : null,
        queue: queuedRuns.map((run) => run.id)
      });
    }
    return this.sessionQueues.get(sessionId);
  }
}

module.exports = AgentRuntime;
