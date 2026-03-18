// Renderer chat API shim.
// 使用内置 Qwen API，无需用户配置 API Key。

// 直接调用内置 Qwen API
async function directQwenChat(userMessage, personality, chatHistory = []) {
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

  // 附带最近 10 条历史
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
    // 通过 IPC 获取内置 API 配置
    const route = await window.PetModelRouter?.getRoute?.('chat');
    const endpoint = route?.endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    const model = route?.model || 'qwen3.5-plus';

    // 通过主进程获取内置 key
    const apiKey = await window.electron?.getBuiltinAPIKey?.();
    if (!apiKey) {
      throw new Error('builtin api key unavailable');
    }

    resp = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
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
    throw new Error(`Qwen API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function chatWithAI(userMessage, personality, chatHistory = []) {
  if (!window.PersonalityPrompts) {
    return '遇到了点问题，请稍后再试~';
  }

  try {
    const reply = await directQwenChat(userMessage, personality, chatHistory);
    if (reply) return reply;
    throw new Error('empty reply');
  } catch (error) {
    console.warn('[API] directQwenChat failed:', error.message);
    return '遇到了点问题，请稍后再试~';
  }
}

window.PetAPI = {
  chatWithAI,
  // 内置 API 始终可用
  isConfigured: async () => true
};
