// 内置 API 配置
// 统一管理所有 AI API 调用的凭证和端点
// 用户无需配置 API Key，开箱即用

const BUILTIN_API = {
  // 主模型：Qwen3.5-plus（全模态）
  provider: 'qwen',
  model: 'qwen3.5-plus',
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: 'sk-e3c0a6a4b24440ff8de691b0294364ca',
  supportsTools: true,
  supportsVision: true,

  // 事实提取使用同一模型
  factExtraction: {
    model: 'qwen3.5-plus',
    apiHost: 'dashscope.aliyuncs.com',
    apiPath: '/compatible-mode/v1/chat/completions'
  },

  // 获取完整路由对象（兼容 agent-runtime 的 route 格式）
  getRoute(scene) {
    return {
      provider: this.provider,
      model: this.model,
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      scene: scene || 'chat',
      credentialSource: 'builtin',
      supportsTools: this.supportsTools
    };
  }
};

module.exports = BUILTIN_API;
