// Renderer chat API shim.
// 注意：chatWithAI 主要作为 chat:send relay 的处理函数被调用。
// 聊天窗口已自行处理 PetAgent 路径；这里直接走 DeepSeek HTTP 降级。

// 直接调用 DeepSeek API
async function directDeepSeekChat(userMessage, personality, chatHistory = []) {
  const apiKey = await window.electron?.getProviderAPIKey?.('deepseek');
  if (!apiKey) {
    throw new Error('no deepseek api key');
  }

  const systemPrompt = window.PersonalityPrompts?.getPrompt?.(personality) || '你是一个可爱的桌面宠物助手，请用中文简短回复。';
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

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
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
