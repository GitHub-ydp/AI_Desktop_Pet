// Built-in gateway route configuration.
// Chat and agent stay on qwen3.5-plus; image-heavy scenes use a vision-capable model.

const SCENE_MODELS = {
  chat: 'qwen3.5-plus',
  agent: 'qwen3.5-plus',
  vision: 'qwen3-vl-plus',
  translate: 'qwen3.5-plus',
  ocr: 'qwen3-vl-plus'
};

const BUILTIN_API = {
  provider: 'qwen',
  model: SCENE_MODELS.chat,
  sceneModels: SCENE_MODELS,
  gatewayUrl: 'http://localhost:3000/api/v1',
  endpoint: 'http://localhost:3000/api/v1/chat/completions',
  supportsTools: true,
  supportsVision: true,

  factExtraction: {
    model: SCENE_MODELS.chat,
    endpoint: 'http://localhost:3000/api/v1/chat/completions'
  },

  getSceneModel(scene) {
    return this.sceneModels[scene] || this.model;
  },

  getRoute(scene) {
    const resolvedScene = scene || 'chat';
    return {
      provider: this.provider,
      model: this.getSceneModel(resolvedScene),
      endpoint: this.endpoint,
      scene: resolvedScene,
      credentialSource: 'gateway',
      supportsTools: this.supportsTools,
      supportsVision: this.supportsVision
    };
  }
};

module.exports = BUILTIN_API;
