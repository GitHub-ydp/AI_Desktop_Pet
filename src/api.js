// Renderer chat API shim.
// 所有聊天请求统一通过本地后端网关。

function getGuestModeEnabled() {
  return localStorage.getItem('guest_mode') === '1';
}

async function ensureAuthToken() {
  if (window.electron?.getAuthToken) {
    const token = await window.electron.getAuthToken();
    if (token) {
      localStorage.setItem('auth_token', token);
      return token;
    }

    localStorage.removeItem('auth_token');
    return null;
  }

  const token = localStorage.getItem('auth_token');
  if (token) {
    return token;
  }

  return null;
}

async function openAuthWindowIfNeeded() {
  if (window.electron?.openAuthWindow) {
    await window.electron.openAuthWindow();
  }
}

async function gatewayChat(userMessage, personality, chatHistory = []) {
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
    // 通过 IPC 获取后端网关路由
    const route = await window.PetModelRouter?.getRoute?.('chat');
    const endpoint = route?.endpoint || 'http://localhost:3000/api/v1/chat/completions';
    const model = route?.model || 'qwen3.5-plus';
    const token = await ensureAuthToken();
    const guestMode = getGuestModeEnabled();

    if (!token && !guestMode) {
      await openAuthWindowIfNeeded();
      throw new Error('auth_required');
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    resp = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.8,
        enable_thinking: false
      })
    });
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 401) {
    localStorage.removeItem('auth_token');
    if (window.electron?.clearAuthToken) {
      await window.electron.clearAuthToken();
    }
    await openAuthWindowIfNeeded();
    throw new Error('auth_required');
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
    const reply = await gatewayChat(userMessage, personality, chatHistory);
    if (reply) return reply;
    throw new Error('empty reply');
  } catch (error) {
    console.warn('[API] gatewayChat failed:', error.message);
    if (error.message === 'auth_required') {
      return '请先登录后再聊天哦~';
    }
    return '遇到了点问题，请稍后再试~';
  }
}

window.PetAPI = {
  chatWithAI,
  // 内置 API 始终可用
  isConfigured: async () => true
};
