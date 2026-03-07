// API 模块

// 从环境变量获取 API 密钥（通过主进程安全获取）
const getAPIKey = async () => {
  try {
    const key = await window.electron?.getAPIKey();
    return key || '';
  } catch (error) {
    console.error('Failed to get API key:', error);
    return '';
  }
};

const API_URL = 'https://api.deepseek.com/v1/chat/completions';

const PROVIDER_ENV_HINT = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  glm: 'GLM_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  tesseract: 'TESSERACT (local)'
};

const OPENAI_COMPAT_PROVIDERS = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    supportsTools: true
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    supportsTools: true
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    supportsTools: true
  },
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    supportsTools: true
  },
  glm: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-flash',
    supportsTools: true
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo',
    supportsTools: true
  }
};

const DEFAULT_CHAT_SCENE_CONFIG = {
  provider: 'deepseek',
  model: 'deepseek-chat'
};

const getProviderAPIKey = async (provider) => {
  try {
    if (window.electron?.getProviderAPIKey) {
      const key = await window.electron.getProviderAPIKey(provider);
      return key || '';
    }
    if (provider === 'deepseek') {
      const key = await getAPIKey();
      return key || '';
    }
    return '';
  } catch (error) {
    console.error('Failed to get provider API key:', error);
    return '';
  }
};

function getChatSceneConfig() {
  const settings = window.PetStorage?.getSettings?.() || {};
  const raw = settings.llmSceneConfig?.chat || DEFAULT_CHAT_SCENE_CONFIG;
  const rawProvider = typeof raw.provider === 'string' && raw.provider.trim()
    ? raw.provider.trim().toLowerCase()
    : DEFAULT_CHAT_SCENE_CONFIG.provider;
  const provider = OPENAI_COMPAT_PROVIDERS[rawProvider] ? rawProvider : DEFAULT_CHAT_SCENE_CONFIG.provider;
  const providerMeta = OPENAI_COMPAT_PROVIDERS[provider];
  const model = typeof raw.model === 'string' && raw.model.trim()
    ? raw.model.trim()
    : providerMeta.defaultModel;
  return {
    provider,
    model,
    ...providerMeta
  };
}

let isCallingAPI = false;

// 记忆系统 - 通过 IPC 与主进程通信
// 简化版（使用 LocalStorage）作为后备方案
const MEMORY_KEY = 'pet_memory_facts';

function getUserFacts() {
  try {
    const data = localStorage.getItem(MEMORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

function saveUserFact(fact) {
  const facts = getUserFacts();
  facts.push({
    ...fact,
    timestamp: Date.now()
  });
  localStorage.setItem(MEMORY_KEY, JSON.stringify(facts));
}

// 提取用户信息
function extractUserInfo(content) {
  const facts = [];

  // 提取名字
  const nameMatch = content.match(/我叫(.{2,4})/);
  if (nameMatch) {
    facts.push({
      type: 'name',
      key: '名字',
      value: nameMatch[1].trim()
    });
  }

  // 提取性别
  if (content.includes('我是男的') || content.includes('我是男生') || content.includes('我是男人')) {
    facts.push({
      type: 'gender',
      key: '性别',
      value: '男'
    });
  }
  if (content.includes('我是女的') || content.includes('我是女生') || content.includes('我是女人')) {
    facts.push({
      type: 'gender',
      key: '性别',
      value: '女'
    });
  }

  // 提取生日
  const birthMatch = content.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (birthMatch) {
    facts.push({
      type: 'birthday',
      key: '生日',
      value: `${birthMatch[1]}年${birthMatch[2]}月${birthMatch[3]}日`
    });
  }

  // 提取喜好
  const likeMatch = content.match(/我喜欢(.{1,10})/);
  if (likeMatch) {
    facts.push({
      type: 'preference',
      key: '喜欢',
      value: likeMatch[1].trim()
    });
  }

  return facts;
}

// 构建记忆上下文（简化版 - 用于后备）
function buildMemoryContext() {
  const facts = getUserFacts();
  if (facts.length === 0) return '';

  // 按类型分组
  const byType = {};
  facts.forEach(f => {
    if (!byType[f.type]) byType[f.type] = [];
    byType[f.type].push(f.value);
  });

  const parts = [];

  if (byType.name && byType.name.length > 0) {
    parts.push(`主人叫${byType.name[0]}`);
  }

  if (byType.gender && byType.gender.length > 0) {
    parts.push(`是${byType.gender[0]}性`);
  }

  if (byType.birthday && byType.birthday.length > 0) {
    parts.push(`生日是${byType.birthday[0]}`);
  }

  if (byType.preference && byType.preference.length > 0) {
    parts.push(`喜欢${byType.preference.join('、')}`);
  }

  return parts.length > 0 ? `记住：${parts.join('，')}。` : '';
}

// 带超时的 fetch
async function fetchWithTimeout(url, options, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    fetch(url, options)
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// 记录上一次的错误，用于向用户显示
let lastApiError = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

async function callDeepSeekAPI(messages, personality, options = {}) {
  if (isCallingAPI) return { type: 'text', content: '请稍等，我还在思考~' };

  isCallingAPI = true;
  lastApiError = null;

  try {
    const sceneConfig = getChatSceneConfig();
    console.log('[API DEBUG] Attempting to get API key...');
    let apiKey = await getProviderAPIKey(sceneConfig.provider);
    console.log('[API DEBUG] Raw API key type:', typeof apiKey);
    console.log('[API DEBUG] API key result:', apiKey ? `FOUND (${apiKey.length} chars)` : 'NOT FOUND');
    console.log('[API DEBUG] provider/model:', sceneConfig.provider, sceneConfig.model);
    console.log('[API DEBUG] API key:', apiKey ? `present (${apiKey.length} chars)` : 'NOT SET');

    // 打印发送给 API 的消息内容
    console.log('[API] ========== REQUEST MESSAGES START ==========');
    console.log('[API] Total messages:', messages.length);
    messages.forEach((msg, idx) => {
      const preview = (msg.content || '').length > 100 ? msg.content.substring(0, 100) + '...' : (msg.content || '');
      console.log(`[API] Message ${idx} (${msg.role}):`, preview);
    });
    console.log('[API] ========== REQUEST MESSAGES END ==========');

    if (!apiKey) {
      const envHint = PROVIDER_ENV_HINT[sceneConfig.provider] || '对应 API KEY';
      const errorMsg = `API Key 未配置，请在 .env 文件中设置 ${envHint}`;
      console.error('[API ERROR]', errorMsg);
      lastApiError = errorMsg;
      consecutiveErrors++;
      return { type: 'text', content: generateErrorResponse(personality, errorMsg) };
    }

    // 构建请求体
    const requestBody = {
      model: sceneConfig.model,
      messages: messages,
      max_tokens: 500,
      temperature: 0.8,
      frequency_penalty: 0.5,
      presence_penalty: 0.3
    };

    // 如果启用了工具调用，附加 tools 参数
    if (sceneConfig.supportsTools && options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = 'auto';
      console.log(`[API] 附加 ${options.tools.length} 个工具定义`);
    }

    console.log(`[API DEBUG] Calling ${sceneConfig.provider} API...`);
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    if (sceneConfig.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ai-desktop-pet.local';
      headers['X-Title'] = 'AI Desktop Pet';
    }
    const response = await fetchWithTimeout(sceneConfig.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorData = await response.json();
        errorDetail = errorData.error?.message || JSON.stringify(errorData);
      } catch (e) {
        errorDetail = await response.text();
      }

      const errorMsg = `API 调用失败 (状态码: ${response.status}): ${errorDetail || '未知错误'}`;
      console.error('[API ERROR]', errorMsg);
      lastApiError = errorMsg;
      consecutiveErrors++;

      if (consecutiveErrors <= MAX_CONSECUTIVE_ERRORS) {
        return { type: 'text', content: generateErrorResponse(personality, errorMsg) };
      }
      return { type: 'text', content: getMockResponse(personality, messages) };
    }

    const data = await response.json();
    console.log('[API DEBUG] API response received successfully');
    console.log('[API DEBUG] Response structure:', JSON.stringify(data, null, 2).substring(0, 500) + '...');

    // 检查响应结构
    if (!data.choices || !data.choices[0]) {
      const errorMsg = 'API 响应格式异常：缺少 choices 字段';
      console.error('[API ERROR]', errorMsg);
      lastApiError = errorMsg;
      consecutiveErrors++;
      return { type: 'text', content: generateErrorResponse(personality, errorMsg) };
    }

    if (!data.choices[0].message) {
      const errorMsg = 'API 响应格式异常：缺少 message 字段';
      console.error('[API ERROR]', errorMsg);
      lastApiError = errorMsg;
      consecutiveErrors++;
      return { type: 'text', content: generateErrorResponse(personality, errorMsg) };
    }

    const choice = data.choices[0];

    // 检测 tool_calls（标准 JSON 格式）
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      console.log(`[API] 检测到 ${choice.message.tool_calls.length} 个工具调用`);
      return {
        type: 'tool_calls',
        toolCalls: choice.message.tool_calls,
        message: choice.message
      };
    }

    const content = choice.message.content;
    console.log('[API DEBUG] Message content length:', content?.length || 0);
    console.log('[API DEBUG] Message content preview:', content?.substring(0, 50) + '...' || 'EMPTY');

    // 检测 DSML 格式的工具调用（DeepSeek 特殊格式）
    const dsmlToolCalls = parseDSMLToolCalls(content);
    if (dsmlToolCalls) {
      return {
        type: 'tool_calls',
        toolCalls: dsmlToolCalls,
        message: choice.message
      };
    }

    // 检查 AI 返回的内容是否是重复模式
    if (isRepetitivePattern(content)) {
      console.warn('[API WARNING] AI 返回了重复模式，使用模拟回复替代');
      return { type: 'text', content: getMockResponse(personality, messages) };
    }

    // 成功调用，重置错误计数
    consecutiveErrors = 0;

    return { type: 'text', content: content.trim() };

  } catch (error) {
    const errorMsg = `请求失败: ${error.message}`;
    console.error('[API ERROR]', errorMsg);
    lastApiError = errorMsg;
    consecutiveErrors++;

    if (consecutiveErrors <= MAX_CONSECUTIVE_ERRORS) {
      return { type: 'text', content: generateErrorResponse(personality, errorMsg) };
    }
    return { type: 'text', content: getMockResponse(personality, messages) };
  } finally {
    isCallingAPI = false;
  }
}

// 工具调用循环：执行 tool_calls 并回传结果给 AI
async function handleToolCallsLoop(apiResult, messages, personality) {
  const MAX_TOOL_ROUNDS = 3;
  let currentResult = apiResult;
  let round = 0;

  while (currentResult.type === 'tool_calls' && round < MAX_TOOL_ROUNDS) {
    round++;
    console.log(`[API] 工具调用第 ${round} 轮`);

    // 将 assistant 的 tool_calls 消息加入历史
    messages.push(currentResult.message);

    // 逐个执行工具调用
    for (const toolCall of currentResult.toolCalls) {
      const { id, function: fn } = toolCall;
      const toolName = fn.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(fn.arguments || '{}');
      } catch (e) {
        console.warn('[API] 解析工具参数失败:', fn.arguments);
      }

      console.log(`[API] 执行工具: ${toolName}`, toolArgs);

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
        role: 'tool',
        tool_call_id: id,
        content: toolResult
      });
    }

    // 再次调用 API，让模型基于工具结果生成回复
    currentResult = await callDeepSeekAPI(messages, personality);
  }

  // 返回最终文本
  if (currentResult.type === 'text') {
    return currentResult.content;
  }

  // 超出最大轮数
  return '操作完成，但结果比较复杂，请问还需要我继续处理吗？';
}

// 生成错误提示回复（比模拟回复更明确地告知用户问题）
function generateErrorResponse(personality, errorMsg) {
  const isAuthError = errorMsg.includes('401') || errorMsg.includes('unauthorized') || errorMsg.includes('API Key');
  const isRateLimit = errorMsg.includes('429') || errorMsg.includes('rate limit');
  const isTimeout = errorMsg.includes('timeout');
  
  // 根据错误类型和性格返回不同的提示
  if (isAuthError) {
    switch (personality) {
      case 'healing':
        return '💕 API Key 好像出问题了，请检查一下配置哦~';
      case 'funny':
        return '😂 API Key 好像过期了，快去充值续费吧！';
      case 'cool':
        return '😤 API Key 无效...你自己检查一下吧';
      case 'assistant':
        return '📋 API 认证失败，请检查 DEEPSEEK_API_KEY 配置';
      default:
        return 'API Key 配置错误，请在 .env 文件中检查 DEEPSEEK_API_KEY';
    }
  }
  
  if (isRateLimit) {
    switch (personality) {
      case 'healing':
        return '💕 请求太频繁了，让我休息一会儿吧~';
      case 'funny':
        return '😂 我被限流了！让我歇会儿~';
      case 'cool':
        return '😤 请求太多...等会儿再来';
      case 'assistant':
        return '📋 API 请求超限，请稍后再试';
      default:
        return 'API 请求频率超限，请稍后再试';
    }
  }
  
  if (isTimeout) {
    switch (personality) {
      case 'healing':
        return '💕 网络有点慢，让我再试试~';
      case 'funny':
        return '😂 网卡了！等我缓冲一下~';
      case 'cool':
        return '😤 网络超时...真是麻烦';
      case 'assistant':
        return '📋 请求超时，请检查网络连接';
      default:
        return '请求超时，请检查网络连接';
    }
  }
  
  // 其他错误
  switch (personality) {
    case 'healing':
      return `💕 遇到点小问题：${errorMsg.substring(0, 30)}...`;
    case 'funny':
      return `😂 出错了：${errorMsg.substring(0, 30)}...`;
    case 'cool':
      return `😤 出错了...${errorMsg.substring(0, 20)}`;
    case 'assistant':
      return `📋 错误：${errorMsg.substring(0, 40)}`;
    default:
      return `出错了：${errorMsg}`;
  }
}

// 保存对话到记忆系统（异步，不阻塞）
async function saveConversationToMemory(role, content, metadata = {}) {
  if (!window.PetMemory) {
    console.warn('PetMemory not available');
    return;
  }

  try {
    await window.PetMemory.addConversation(role, content, metadata);
    console.log(`[Memory] Saved ${role} conversation`);
  } catch (error) {
    console.error('[Memory] Failed to save conversation:', error);
  }
}

// 获取记忆上下文（用于 AI 对话）
async function getMemoryContext(query) {
  if (!window.PetMemory) {
    console.warn('[Memory] PetMemory not available, using fallback');
    return buildMemoryContext();
  }

  try {
    console.log('[Memory] Querying context for:', query.substring(0, 50) + (query.length > 50 ? '...' : ''));

    // 从 PetStorage 获取当前实际心情和性格
    const petData = window.PetStorage ? window.PetStorage.getPetData() : {};
    const context = await window.PetMemory.getContext(query, {
      maxTokens: 1000,
      maxMemories: 8,
      currentMood: petData.mood || 80,
      currentPersonality: petData.personality || 'healing'
    });

    // 检查是否有实际内容
    if (context && context.trim().length > 0) {
      console.log('[Memory] Context retrieved successfully');
      console.log('[Memory] Context preview:', context.substring(0, 300) + '...');
      return context;
    }

    console.log('[Memory] Empty context returned');
    return '';
  } catch (error) {
    console.error('[Memory] Failed to get context:', error.message);
    console.error('[Memory] Error stack:', error.stack);
    // 降级方案：使用 localStorage 中的简单事实
    const simpleContext = buildMemoryContext();
    if (simpleContext) {
      console.log('[Memory] Using fallback context:', simpleContext);
    }
    return simpleContext;
  }
}

// 检测消息是否是重复模式（用于过滤污染的历史记录）
function isRepetitivePattern(content) {
  if (!content) return false;
  // 检测 "主人说"XXX"我听到啦" 这种模式
  const repetitivePatterns = [
    /主人说["']?.*["']?我听到啦/,
    /主人说["']?.*["']?.*摸摸头/,
    /["']?.*["']?太有意思了/,
    /["']?.*["']?我知道啦/,
    /已收到：["']?.*["']?/
  ];
  return repetitivePatterns.some(pattern => pattern.test(content));
}

// 解析 DeepSeek 的 DSML 格式工具调用
// 格式示例: <｜DSML｜function_calls><｜DSML｜invoke name="tool_name"><｜DSML｜parameter name="arg">value</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>
function parseDSMLToolCalls(content) {
  if (!content || !content.includes('<｜DSML｜')) {
    return null;
  }

  console.log('[API] 检测到 DSML 格式工具调用');
  const toolCalls = [];

  // 匹配所有 invoke 块
  const invokeRegex = /<｜DSML｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜DSML｜invoke>/g;
  let match;

  while ((match = invokeRegex.exec(content)) !== null) {
    const toolName = match[1];
    const paramsBlock = match[2];
    const args = {};

    // 解析参数
    const paramRegex = /<｜DSML｜parameter\s+name="([^"]+)"(?:\s+string="true")?>([^<]*)<\/｜DSML｜parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
      const paramName = paramMatch[1];
      let paramValue = paramMatch[2];

      // 尝试解析为 JSON，否则保持字符串
      try {
        args[paramName] = JSON.parse(paramValue);
      } catch (e) {
        args[paramName] = paramValue;
      }
    }

    toolCalls.push({
      id: `dsml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(args)
      }
    });
  }

  if (toolCalls.length === 0) {
    return null;
  }

  console.log(`[API] DSML 解析到 ${toolCalls.length} 个工具调用`);
  return toolCalls;
}

// 清理历史消息，过滤掉重复模式
function cleanChatHistory(history, maxMessages = 6) {
  if (!history || history.length === 0) return [];
  
  // 从最新的消息开始，跳过重复模式的 AI 回复
  const cleaned = [];
  let skippedCount = 0;
  
  // 倒序遍历，保留最新的有效消息
  for (let i = history.length - 1; i >= 0 && cleaned.length < maxMessages; i--) {
    const msg = history[i];
    // 如果是 AI 回复且是重复模式，跳过
    if (msg.role === 'assistant' && isRepetitivePattern(msg.content)) {
      console.log(`[API] 跳过重复模式的 AI 回复: ${msg.content.substring(0, 30)}...`);
      skippedCount++;
      continue;
    }
    cleaned.unshift(msg);
  }
  
  if (skippedCount > 0) {
    console.log(`[API] 共跳过 ${skippedCount} 条重复模式的历史消息`);
  }
  
  return cleaned;
}

async function chatWithAI(userMessage, personality, chatHistory) {
  if (!window.PersonalityPrompts) {
    return '我还在初始化，请稍等...';
  }

  let systemPrompt = window.PersonalityPrompts.getPersonalityPrompt(personality);

  // 获取记忆上下文（异步开始，不阻塞）
  const memoryContextPromise = getMemoryContext(userMessage);

  // 提取并保存用户信息（简化版作为补充）
  const facts = extractUserInfo(userMessage);
  if (facts.length > 0) {
    facts.forEach(fact => saveUserFact(fact));
    console.log('✅ 已记住:', facts);
  }

  // 等待记忆上下文
  let memoryContext = '';
  try {
    memoryContext = await memoryContextPromise;
  } catch (error) {
    console.error('[Memory] Error getting context:', error);
  }

  // 整合记忆上下文到系统提示
  if (memoryContext && memoryContext.trim()) {
    systemPrompt += `\n\n========== 我们的对话记录 ==========\n${memoryContext}\n========== 请自然地回应 ==========`;
    console.log('[API] Memory context added to system prompt');
  } else {
    console.log('[API] No memory context available');
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  // 清理并添加历史消息（只添加最近4条，避免重复）
  const cleanedHistory = cleanChatHistory(chatHistory, 4);
  cleanedHistory.forEach(msg => {
    messages.push({ role: msg.role, content: msg.content });
  });

  messages.push({ role: 'user', content: userMessage });

  // 异步保存用户消息到记忆系统
  saveConversationToMemory('user', userMessage, { personality });

  // 获取可用工具定义
  let toolDefinitions = [];
  if (window.PetWorkflow) {
    try {
      toolDefinitions = await window.PetWorkflow.listTools();
      console.log(`[API] 获取到 ${toolDefinitions.length} 个工具定义`);
    } catch (e) {
      console.warn('[API] 获取工具定义失败:', e);
    }
  }

  // 调用 API（附带工具定义）
  const apiResult = await callDeepSeekAPI(messages, personality, {
    tools: toolDefinitions.length > 0 ? toolDefinitions : undefined
  });

  let response;
  // 处理返回结果
  if (apiResult.type === 'tool_calls') {
    response = await handleToolCallsLoop(apiResult, messages, personality);
  } else {
    response = apiResult.content;
  }

  // 异步保存 AI 回复到记忆系统
  saveConversationToMemory('assistant', response, { personality });

  return response;
}

function getMockResponse(personality, messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const lastMessage = userMessages[userMessages.length - 1]?.content?.slice(0, 10) || '';

  const responses = {
    healing: [
      `主人说"${lastMessage}..."我听到啦~摸摸头💕`,
      '嗯嗯，我在听呢~主人辛苦啦！',
      '记得要照顾好自己哦~💕',
      '主人想聊什么都可以呢~'
    ],
    funny: [
      `哈哈哈，"${lastMessage}..."太有意思了😂`,
      '来来来，给你讲个笑话！',
      '主人你今天也很幽默啊！',
      '生活就是要开心呀！🤣'
    ],
    cool: [
      `哼、"${lastMessage}..."我知道啦`,
      '哼、才不是想理你呢...',
      '真是的，拿你没办法...',
      '别太依赖我了...'
    ],
    assistant: [
      `已收到："${lastMessage}..."`,
      '了解。需要我做什么吗？',
      '建议休息5分钟。',
      '需要设置提醒吗？'
    ]
  };

  const list = responses[personality] || responses.healing;
  return list[Math.floor(Math.random() * list.length)];
}

window.PetAPI = {
  chatWithAI,
  isConfigured: async () => {
    const sceneConfig = getChatSceneConfig();
    const apiKey = await getProviderAPIKey(sceneConfig.provider);
    return apiKey && apiKey.length > 0;
  },
  // 查看记忆
  getMemoryFacts: getUserFacts,
  // 清空记忆
  clearMemory: () => {
    localStorage.removeItem(MEMORY_KEY);
    console.log('记忆已清空');
  },
  // 获取最后一次 API 错误详情
  getLastError: () => lastApiError,
  // 获取 API 状态
  getApiStatus: async () => {
    const sceneConfig = getChatSceneConfig();
    const apiKey = await getProviderAPIKey(sceneConfig.provider);
    return {
      provider: sceneConfig.provider,
      model: sceneConfig.model,
      hasKey: !!apiKey,
      keyLength: apiKey?.length || 0,
      lastError: lastApiError,
      consecutiveErrors
    };
  },
  // 重置错误计数
  resetErrorCount: () => {
    consecutiveErrors = 0;
    lastApiError = null;
    console.log('[API] 错误计数已重置');
  }
};
