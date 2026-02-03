// API 模块

// 从环境变量获取 API 密钥（通过主进程安全获取）
const getAPIKey = () => {
  try {
    return window.electron?.getAPIKey() || '';
  } catch (error) {
    console.error('Failed to get API key:', error);
    return '';
  }
};

const API_URL = 'https://api.deepseek.com/v1/chat/completions';
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

async function callDeepSeekAPI(messages, personality) {
  if (isCallingAPI) return '请稍等，我还在思考~';

  isCallingAPI = true;

  try {
    const apiKey = getAPIKey();

    if (!apiKey) {
      console.error('API key not configured');
      return getMockResponse(personality, messages);
    }

    const response = await fetchWithTimeout(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        max_tokens: 100,
        temperature: 0.8
      })
    });

    if (!response.ok) {
      // API 出错时使用模拟回复
      return getMockResponse(personality, messages);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();

  } catch (error) {
    console.log('API error, using mock response');
    return getMockResponse(personality, messages);
  } finally {
    isCallingAPI = false;
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
    console.warn('PetMemory not available, using fallback');
    return buildMemoryContext();
  }

  try {
    const context = await window.PetMemory.getContext(query, {
      maxTokens: 1500,
      maxMemories: 3
    });
    return context;
  } catch (error) {
    console.error('[Memory] Failed to get context:', error);
    return buildMemoryContext(); // 降级到简化版
  }
}

async function chatWithAI(userMessage, personality, chatHistory) {
  if (!window.PersonalityPrompts) {
    return '我还在初始化，请稍等...';
  }

  let systemPrompt = window.PersonalityPrompts.getPersonalityPrompt(personality);

  // 获取记忆上下文
  try {
    const memoryContext = await getMemoryContext(userMessage);
    if (memoryContext) {
      systemPrompt += `\n\n【记忆上下文】\n${memoryContext}`;
    }
  } catch (error) {
    console.error('Failed to get memory context:', error);
  }

  // 提取并保存用户信息（简化版作为补充）
  const facts = extractUserInfo(userMessage);
  if (facts.length > 0) {
    facts.forEach(fact => saveUserFact(fact));
    console.log('✅ 已记住:', facts);
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  // 添加最近10条历史
  chatHistory.slice(-10).forEach(msg => {
    messages.push({ role: msg.role, content: msg.content });
  });

  messages.push({ role: 'user', content: userMessage });

  // 异步保存用户消息到记忆系统
  saveConversationToMemory('user', userMessage, { personality });

  const response = await callDeepSeekAPI(messages, personality);

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
  isConfigured: () => {
    const apiKey = getAPIKey();
    return apiKey && apiKey.length > 0;
  },
  // 查看记忆
  getMemoryFacts: getUserFacts,
  // 清空记忆
  clearMemory: () => {
    localStorage.removeItem(MEMORY_KEY);
    console.log('记忆已清空');
  }
};
