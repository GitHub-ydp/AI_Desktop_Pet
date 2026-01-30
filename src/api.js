// AI API 集成模块 - DeepSeek

// TODO: 在这里配置你的 DeepSeek API Key
// 获取API Key: https://platform.deepseek.com/
const API_KEY = 'YOUR_DEEPSEEK_API_KEY_HERE';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// API调用状态
let isCallingAPI = false;

// 调用DeepSeek API
async function callDeepSeekAPI(messages, personality = 'healing') {
  if (!API_KEY || API_KEY === 'YOUR_DEEPSEEK_API_KEY_HERE') {
    console.error('Please configure your DeepSeek API Key in src/api.js');
    return '请先在 src/api.js 中配置你的 DeepSeek API Key 😊';
  }

  if (isCallingAPI) {
    return '请稍等，我还在思考上一个问题呢~';
  }

  isCallingAPI = true;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        max_tokens: 100,
        temperature: 0.8,
        top_p: 0.9
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error:', errorData);
      throw new Error(`API请求失败: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices[0].message.content.trim();

    isCallingAPI = false;
    return reply;

  } catch (error) {
    console.error('Error calling DeepSeek API:', error);
    isCallingAPI = false;
    return '抱歉，我现在有点晕，等下再试试吧~';
  }
}

// 主聊天函数
async function chatWithAI(userMessage, personality, chatHistory) {
  // 获取性格prompt
  const systemPrompt = window.PersonalityPrompts.getPersonalityPrompt(personality);

  // 构建消息列表
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  // 添加历史对话（最近10条）
  const recentHistory = chatHistory.slice(-10);
  recentHistory.forEach(msg => {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  });

  // 添加当前消息
  messages.push({
    role: 'user',
    content: userMessage
  });

  // 调用API
  const reply = await callDeepSeekAPI(messages, personality);

  return reply;
}

// 测试API连接
async function testAPIConnection() {
  if (!API_KEY || API_KEY === 'YOUR_DEEPSEEK_API_KEY_HERE') {
    return {
      success: false,
      message: '请先配置 DeepSeek API Key'
    };
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'user',
            content: '你好'
          }
        ],
        max_tokens: 10
      })
    });

    if (response.ok) {
      return {
        success: true,
        message: 'API连接成功'
      };
    } else {
      return {
        success: false,
        message: `API连接失败: ${response.status}`
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error.message}`
    };
  }
}

// 导出
window.PetAPI = {
  chatWithAI,
  testAPIConnection,
  isConfigured: () => API_KEY !== 'YOUR_DEEPSEEK_API_KEY_HERE'
};
