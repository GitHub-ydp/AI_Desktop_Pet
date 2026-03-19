// 内置 API 配置
// 统一管理所有 AI API 调用的凭证和端点
// 用户无需配置 API Key，开箱即用

const BUILTIN_API = {
  // 主模型：Qwen3.5-plus（全模态）
  provider: 'qwen',
  model: 'qwen3.5-plus',
  gatewayUrl: 'http://localhost:3000/api/v1',
  endpoint: 'http://localhost:3000/api/v1/chat/completions',
  supportsTools: true,
  supportsVision: true,

  // 事实提取和主对话都通过后端网关
  factExtraction: {
    model: 'qwen3.5-plus',
    endpoint: 'http://localhost:3000/api/v1/chat/completions'
  },

  // 获取完整路由对象（兼容 agent-runtime 的 route 格式）
  getRoute(scene) {
    return {
      provider: this.provider,
      model: this.model,
      endpoint: this.endpoint,
      scene: scene || 'chat',
      credentialSource: 'gateway',
      supportsTools: this.supportsTools
    };
  }
};

module.exports = BUILTIN_API;
