const { randomUUID } = require('crypto');
const os = require('os');
const path = require('path');

const MAX_TOOL_ROUNDS = 3;
const APPROVAL_TIMEOUT_MS = 30000;
const RAW_HISTORY_WINDOW_MESSAGES = 8;
const SUMMARY_RECENT_MESSAGE_WINDOW = 4;
const SUMMARY_MAX_CHARS = 1200;

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
  if (/(提醒|创建|删除|移动|复制|重命名|打开|执行|运行|安装|下载|上传|整理|写入|修改|编辑|命令|shell|bash|powershell|代码|脚本)/.test(input)) {
    return /(代码|脚本|函数|bug|调试|正则|sql|api|编程)/.test(input) ? 'code' : 'task';
  }
  if (/(截图|图片|照片|看图|ocr|识别|图中)/.test(input)) {
    return 'vision';
  }
  return 'chat';
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
  if (!content || !content.includes('<~DSML')) {
    return [];
  }

  const toolCalls = [];
  const invokeRegex = /<~DSML~invoke\s+name="([^"]+)">([\s\S]*?)<\/~DSML~invoke>/g;
  let match;

  while ((match = invokeRegex.exec(content)) !== null) {
    const toolName = match[1];
    const paramsBlock = match[2];
    const args = {};
    const paramRegex = /<~DSML~parameter\s+name="([^"]+)"(?:\s+string="true")?>([^<]*)<\/~DSML~parameter>/g;
    let paramMatch;

    while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
      const paramName = paramMatch[1];
      const raw = paramMatch[2];
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
    this.onSummaryEvent = options.onSummaryEvent || null;

    this.abortControllers = new Map();
    this.sessionQueues = new Map();
    this.pendingApprovals = new Map();
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
    this._finishRun(run.sessionId, runId);
    return { ok: true };
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

    const session = this.sessionStore.getSession(run.sessionId);
    const personality = session?.metadata?.personality || 'healing';
    const intent = classifyIntent(run.sourceText, run.attachments);
    const route = this.modelRouter.route(intent, {
      sceneConfig: this.getSceneConfig()
    });
    const routeAttempts = this._buildRouteAttempts(intent, route);
    let activeRoute = routeAttempts.shift() || route;

    if (!activeRoute.apiKey && activeRoute.provider !== 'tesseract') {
      this._failRun(run, 'missing_api_key', 'API key is not configured for the selected model');
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
          await this.memorySystem.addConversation('user', run.sourceText, { personality });
          await this.memorySystem.addConversation('assistant', finalText, { personality });
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

    const hasAttachments = Array.isArray(run.attachments) && run.attachments.length > 0;
    const availableTools = !hasAttachments ? this.capabilityRegistry.listTools() : [];
    let messages = this._buildMessages({
      personality,
      intent,
      memoryContext,
      sessionId: run.sessionId,
      userText: run.sourceText,
      attachments: run.attachments
    });

    let finalText = '';
    let round = 0;
    const toolOutcomes = [];

    try {
      while (round < MAX_TOOL_ROUNDS) {
        if (plan && round === 0) {
          plan = updatePlanStep(plan, 1, 'done');
          this.eventBus.publish({
            sessionId: run.sessionId,
            runId,
            type: 'plan.updated',
            payload: { plan }
          });
        }

        // 第二轮起已有工具结果，不再传工具定义，强制 LLM 生成文本总结而非重复调用工具
        const effectiveTools = round === 0 && activeRoute.supportsTools ? availableTools : [];
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
        if (providerResult.toolCalls.length === 0) {
          finalText = providerResult.content.trim();
          break;
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

        for (const toolCall of providerResult.toolCalls) {
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

          const toolResult = await this.capabilityRegistry.execute(toolName, toolArgs, {
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

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult.ok
              ? (toolResult.data == null ? { ok: true, summary: toolResult.summary } : toolResult.data)
              : { error: toolResult.summary })
          });
        }

        round += 1;
      }

      if (!finalText) {
        finalText = this._buildFallbackFinalText({ run, toolOutcomes });
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
        await this.memorySystem.addConversation('user', run.sourceText, {
          personality
        });
        await this.memorySystem.addConversation('assistant', finalText, {
          personality
        });
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
      this.abortControllers.delete(runId);
    }
  }

  _buildMessages({ personality, intent, memoryContext, sessionId, userText, attachments = null }) {
    let systemPrompt = buildPersonalityPrompt(personality);
    if (intent === 'task' || intent === 'code') {
      systemPrompt += ' Use tools when needed. Keep tool results grounded in the actual output.';
    }
    if (memoryContext && memoryContext.trim()) {
      systemPrompt += `\n\nRelevant memory:\n${memoryContext.trim()}`;
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

  _buildProviderHeaders(route) {
    const headers = {
      Authorization: `Bearer ${route.apiKey}`,
      'Content-Type': 'application/json'
    };

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
      if (!route.apiKey && route.provider !== 'tesseract') continue;
      const key = `${route.provider}:${route.model}:${route.endpoint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attempts.push(route);
    }

    return attempts;
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

  _buildFallbackFinalText({ run, toolOutcomes = [] }) {
    const successfulOutcomes = toolOutcomes.filter((item) => item && item.ok);
    if (successfulOutcomes.length === 0) {
      return '\u4efb\u52a1\u5df2\u5b8c\u6210\u3002';
    }

    const lastOutcome = successfulOutcomes[successfulOutcomes.length - 1];
    const detail = this._formatToolOutcomeSummary(lastOutcome);
    if (successfulOutcomes.length === 1) {
      return detail ? `\u5df2\u5b8c\u6210\uff1a${detail}` : '\u64cd\u4f5c\u5df2\u5b8c\u6210\u3002';
    }
    if (detail) {
      return `\u5df2\u5b8c\u6210 ${successfulOutcomes.length} \u4e2a\u64cd\u4f5c\u3002\u6700\u540e\u4e00\u6b65\uff1a${detail}`;
    }
    return `\u5df2\u5b8c\u6210 ${successfulOutcomes.length} \u4e2a\u64cd\u4f5c\u3002`;
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
        return `\u8fd4\u56de\u4e86 ${data.files.length} \u4e2a\u6587\u4ef6\u7ed3\u679c`;
      }
    }

    if (outcome.toolName) {
      return `\u5df2\u6267\u884c ${outcome.toolName}`;
    }
    return '';
  }

  async _streamProviderResponse({ route, messages, tools, run, signal }) {
    const requestBody = {
      model: route.model,
      messages,
      stream: true,
      max_tokens: 1200,
      temperature: 0.7
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

    if (!summaryRoute || !summaryRoute.apiKey || summaryRoute.provider === 'tesseract') {
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
    const summary = toolName === 'file_edit'
      ? `确认修改文件 ${preview?.path || toolArgs?.path || ''}`.trim()
      : `Approve tool ${toolName}`;
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
        summary,
        args: toolArgs,
        preview,
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
