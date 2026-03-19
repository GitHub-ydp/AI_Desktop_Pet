// 模型路由器（简化版）
// 所有场景统一走后端网关
const BUILTIN_API = require('./builtin-api');

const INTENT_TO_SCENE = {
  chat: 'chat',
  task: 'agent',
  search: 'chat',
  creative: 'chat',
  code: 'agent',
  vision: 'vision'
};

class ModelRouter {
  constructor() {}

  // 所有意图统一返回内置路由
  route(intent) {
    const scene = INTENT_TO_SCENE[intent] || 'chat';
    return BUILTIN_API.getRoute(scene);
  }

  // 降级链：内置 API 就是唯一选项
  getFallbackChain(intent) {
    const scene = INTENT_TO_SCENE[intent] || 'chat';
    return [BUILTIN_API.getRoute(scene)];
  }

  // 可用 providers 列表
  getAvailableProviders() {
    return [{
      provider: BUILTIN_API.provider,
      hasKey: false,
      defaultModel: BUILTIN_API.model,
      supportsTools: BUILTIN_API.supportsTools
    }];
  }

  registerIPCHandlers(ipcMain) {
    ipcMain.handle('modelRouter:getRoute', (event, intent) => {
      const result = this.route(intent);
      return {
        provider: result.provider,
        model: result.model,
        endpoint: result.endpoint,
        scene: result.scene,
        hasKey: false,
        credentialSource: 'gateway',
        supportsTools: result.supportsTools
      };
    });

    ipcMain.handle('modelRouter:getAvailable', () => this.getAvailableProviders());
    ipcMain.handle('modelRouter:getFallbackChain', (event, intent) => {
      return this.getFallbackChain(intent);
    });

    console.log('[ModelRouter] IPC handlers registered (gateway mode)');
  }
}

module.exports = ModelRouter;
