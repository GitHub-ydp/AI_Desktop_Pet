const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const PROVIDER_ENV_KEY_MAP = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  glm: 'GLM_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  tesseract: null
};

const PROVIDER_ENDPOINTS = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    supportsTools: true
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    supportsTools: true
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    supportsTools: true
  },
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    supportsTools: true
  },
  glm: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-flash',
    supportsTools: true
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo',
    supportsTools: true
  }
};

const DEFAULT_SCENE_CONFIG = {
  chat: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  agent: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  vision: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  translate: { provider: 'deepseek', model: 'deepseek-chat', apiKeyMode: 'provider-fallback' },
  ocr: { provider: 'tesseract', model: 'tesseract', apiKeyMode: 'provider-fallback' }
};

const INTENT_TO_SCENE = {
  chat: 'chat',
  task: 'agent',
  search: 'chat',
  creative: 'chat',
  code: 'agent',
  vision: 'vision'
};

class ModelRouter {
  constructor() {
    this._apiKeysCache = null;
    this._apiKeysCacheTime = 0;
    this._cacheMaxAge = 5000;
  }

  _normalizeSceneConfig(sceneConfig) {
    const source = sceneConfig && typeof sceneConfig === 'object' ? sceneConfig : {};
    const normalized = {};

    for (const [scene, fallback] of Object.entries(DEFAULT_SCENE_CONFIG)) {
      const raw = source[scene] && typeof source[scene] === 'object' ? source[scene] : {};
      const provider = typeof raw.provider === 'string' && raw.provider.trim()
        ? raw.provider.trim().toLowerCase()
        : fallback.provider;
      const providerMeta = PROVIDER_ENDPOINTS[provider];
      const model = typeof raw.model === 'string' && raw.model.trim()
        ? raw.model.trim()
        : (providerMeta?.defaultModel || fallback.model);
      const apiKeyMode = raw.apiKeyMode === 'scene' ? 'scene' : 'provider-fallback';
      normalized[scene] = { provider, model, apiKeyMode };
    }

    return normalized;
  }

  _readApiKeys() {
    const now = Date.now();
    if (this._apiKeysCache && (now - this._apiKeysCacheTime) < this._cacheMaxAge) {
      return this._apiKeysCache;
    }

    try {
      const filePath = path.join(app.getPath('userData'), 'api-keys.json');
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        this._apiKeysCache = this._normalizeApiKeysStore(JSON.parse(data));
        this._apiKeysCacheTime = now;
        return this._apiKeysCache;
      }
    } catch (error) {
      console.error('[ModelRouter] read api-keys.json failed:', error.message);
    }

    this._apiKeysCache = this._normalizeApiKeysStore();
    this._apiKeysCacheTime = now;
    return this._apiKeysCache;
  }

  _normalizeApiKeysStore(data = {}) {
    const emptyStore = { providers: {}, scenes: {} };
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return emptyStore;
    }

    const looksLikeLegacy = Object.keys(data).some((key) => Object.prototype.hasOwnProperty.call(PROVIDER_ENV_KEY_MAP, key));
    if (looksLikeLegacy && !data.providers && !data.scenes) {
      const providers = {};
      for (const provider of Object.keys(PROVIDER_ENV_KEY_MAP)) {
        if (typeof data[provider] === 'string') {
          providers[provider] = data[provider];
        }
      }
      return { providers, scenes: {} };
    }

    const providers = {};
    for (const provider of Object.keys(PROVIDER_ENV_KEY_MAP)) {
      if (typeof data.providers?.[provider] === 'string') {
        providers[provider] = data.providers[provider];
      }
    }

    const scenes = {};
    for (const scene of Object.keys(DEFAULT_SCENE_CONFIG)) {
      if (typeof data.scenes?.[scene] === 'string') {
        scenes[scene] = data.scenes[scene];
      }
    }

    return { providers, scenes };
  }

  _getProviderApiKeyRecord(provider) {
    const normalized = (provider || '').trim().toLowerCase();
    const envKey = PROVIDER_ENV_KEY_MAP[normalized];
    if (!envKey) return { apiKey: '', source: 'none' };

    const savedKeys = this._readApiKeys();
    if (savedKeys.providers[normalized]) {
      return { apiKey: savedKeys.providers[normalized], source: 'provider' };
    }

    const envValue = process.env[envKey] || '';
    if (envValue) {
      return { apiKey: envValue, source: 'env' };
    }

    return { apiKey: '', source: 'none' };
  }

  _getSceneCredential(scene, config) {
    const savedKeys = this._readApiKeys();
    if (config.apiKeyMode === 'scene') {
      const sceneKey = savedKeys.scenes[scene] || '';
      if (sceneKey) {
        return { apiKey: sceneKey, source: 'scene' };
      }
    }
    return this._getProviderApiKeyRecord(config.provider);
  }

  _buildRoute(scene, config, credential) {
    const providerMeta = PROVIDER_ENDPOINTS[config.provider];
    return {
      provider: config.provider,
      model: config.model,
      endpoint: providerMeta?.endpoint || '',
      apiKey: credential.apiKey,
      scene,
      credentialSource: credential.source,
      supportsTools: !!providerMeta?.supportsTools
    };
  }

  route(intent, options = {}) {
    const scene = INTENT_TO_SCENE[intent] || 'chat';
    const sceneConfig = this._normalizeSceneConfig(options.sceneConfig);
    const config = sceneConfig[scene] || DEFAULT_SCENE_CONFIG[scene];
    const providerMeta = PROVIDER_ENDPOINTS[config.provider];

    if (!providerMeta) {
      return this._fallback(intent, config.provider, { sceneConfig });
    }

    const credential = this._getSceneCredential(scene, config);
    if (intent === 'task' && !providerMeta.supportsTools) {
      return this._fallback(intent, config.provider, { sceneConfig, requireTools: true });
    }
    if (!credential.apiKey && config.provider !== 'tesseract') {
      return this._fallback(intent, config.provider, { sceneConfig, requireTools: intent === 'task' });
    }

    return this._buildRoute(scene, config, credential);
  }

  _fallback(intent, failedProvider, options = {}) {
    const scene = INTENT_TO_SCENE[intent] || 'chat';
    const requireTools = !!options.requireTools;
    const order = ['deepseek', 'qwen', 'glm', 'siliconflow', 'openai', 'openrouter'];

    for (const provider of order) {
      if (provider === failedProvider) continue;
      const providerMeta = PROVIDER_ENDPOINTS[provider];
      if (!providerMeta) continue;
      if (requireTools && !providerMeta.supportsTools) continue;
      const credential = this._getProviderApiKeyRecord(provider);
      if (!credential.apiKey) continue;
      return this._buildRoute(scene, {
        provider,
        model: providerMeta.defaultModel,
        apiKeyMode: 'provider-fallback'
      }, credential);
    }

    return {
      provider: failedProvider || 'deepseek',
      model: PROVIDER_ENDPOINTS.deepseek.defaultModel,
      endpoint: PROVIDER_ENDPOINTS.deepseek.endpoint,
      apiKey: '',
      scene,
      credentialSource: 'none',
      supportsTools: true
    };
  }

  getAvailableProviders() {
    return Object.entries(PROVIDER_ENDPOINTS).map(([provider, meta]) => {
      const credential = this._getProviderApiKeyRecord(provider);
      return {
        provider,
        hasKey: !!credential.apiKey,
        defaultModel: meta.defaultModel,
        supportsTools: !!meta.supportsTools
      };
    });
  }

  getFallbackChain(intent) {
    const scene = INTENT_TO_SCENE[intent] || 'chat';
    const chain = [];
    const requireTools = intent === 'task';
    const order = ['deepseek', 'qwen', 'glm', 'siliconflow', 'openai', 'openrouter'];

    for (const provider of order) {
      const meta = PROVIDER_ENDPOINTS[provider];
      if (!meta) continue;
      if (requireTools && !meta.supportsTools) continue;
      const credential = this._getProviderApiKeyRecord(provider);
      if (!credential.apiKey) continue;
      chain.push({
        provider,
        model: meta.defaultModel,
        endpoint: meta.endpoint,
        apiKey: credential.apiKey,
        scene,
        credentialSource: credential.source,
        supportsTools: !!meta.supportsTools
      });
    }

    return chain;
  }

  registerIPCHandlers(ipcMain) {
    ipcMain.handle('modelRouter:getRoute', (event, intent, sceneConfig) => {
      const result = this.route(intent, { sceneConfig });
      return {
        provider: result.provider,
        model: result.model,
        endpoint: result.endpoint,
        scene: result.scene,
        hasKey: !!result.apiKey,
        credentialSource: result.credentialSource,
        supportsTools: result.supportsTools
      };
    });

    ipcMain.handle('modelRouter:getAvailable', () => this.getAvailableProviders());
    ipcMain.handle('modelRouter:getFallbackChain', (event, intent) => {
      return this.getFallbackChain(intent);
    });

    console.log('[ModelRouter] IPC handlers registered');
  }
}

module.exports = ModelRouter;
