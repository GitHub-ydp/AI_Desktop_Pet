// Renderer chat API shim.
// 注意：chatWithAI 主要作为 chat:send relay 的处理函数被调用。
// 聊天窗口已自行处理 PetAgent 路径；这里直接走 DeepSeek HTTP 降级。

// 直接调用 DeepSeek API
async function directDeepSeekChat(userMessage, personality, chatHistory = []) {
  const apiKey = await window.electron?.getProviderAPIKey?.('deepseek');
  if (!apiKey) {
    throw new Error('no deepseek api key');
  }

  const basePrompt = window.PersonalityPrompts?.getPersonalityPrompt?.(personality)
    || '你是一个可爱的桌面宠物助手，请用中文简短回复。';
  let systemPrompt = basePrompt;
  try {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    if (settings.petName) {
      systemPrompt = `你的名字是「${settings.petName}」，主人这样称呼你。\n\n${basePrompt}`;
    }
  } catch (e) {}
  const messages = [{ role: 'system', content: systemPrompt }];

  // 附带最近 10 条历史（来自 app-vanilla.js 的 state.chatHistory）
  const recent = Array.isArray(chatHistory) ? chatHistory.slice(-10) : [];
  for (const h of recent) {
    messages.push({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.content || ''
    });
  }
  messages.push({ role: 'user', content: userMessage });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let resp;
  try {
    resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: 500,
        temperature: 0.8
      })
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.status);
    throw new Error(`DeepSeek API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function chatWithAI(userMessage, personality, chatHistory = []) {
  if (!window.PersonalityPrompts) {
    return '遇到了点问题，请稍后再试~';
  }

  try {
    const reply = await directDeepSeekChat(userMessage, personality, chatHistory);
    if (reply) return reply;
    throw new Error('empty reply');
  } catch (error) {
    console.warn('[API] directDeepSeekChat failed:', error.message);
    // 区分"未配置 API Key"和其他错误，给出明确的引导而非模糊提示
    if (error.message === 'no deepseek api key') {
      return '还没有配置 API Key 哦~\n点击菜单 → 设置 → API Key 管理，填入 DeepSeek Key 就能开始聊天啦！';
    }
    return '遇到了点问题，请稍后再试~';
  }
}

window.PetAPI = {
  chatWithAI,
  isConfigured: async () => {
    const apiKey = await window.electron?.getProviderAPIKey?.('deepseek');
    return !!apiKey;
  }
};
