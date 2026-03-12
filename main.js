const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fsSync = require('fs');
const MemoryMainProcess = require('./main-process/memory');
const { ScreenshotManager } = require('./main-process/screenshot');
const WorkflowManager = require('./main-process/workflow-manager');
const ModelRouter = require('./main-process/model-router');
const SkillRegistry = require('./main-process/skill-registry');
const SkillExecutor = require('./main-process/skill-executor');
const McpRegistry = require('./main-process/mcp-registry');
const McpRuntime = require('./main-process/mcp-runtime');
const AgentSessionStore = require('./main-process/agent-session-store');
const AgentEventBus = require('./main-process/agent-event-bus');
const CapabilityRegistry = require('./main-process/capability-registry');
const ChannelRegistry = require('./main-process/channel-registry');
const AgentRuntime = require('./main-process/agent-runtime');
const AgentHttpServer = require('./main-process/agent-http-server');
const { createChatRequestId } = require('./src/chat-ipc-utils');
const {
  getBubbleWindowBoundsFromMain,
  getIntimacyWindowBoundsFromMain
} = require('./src/bubble-window-utils');

// 忽略 stdout/stderr 管道断开错误（npm start 关闭终端后常见，无需弹窗提示）
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') return; });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') return; });

// 加载环境变量（从 .env 文件）
require('dotenv').config();
console.log('[Main Process] dotenv loaded');
console.log('[Main Process] DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? `FOUND (${process.env.DEEPSEEK_API_KEY.length} chars)` : 'NOT FOUND');

let mainWindow = null;
let tray = null;
let memorySystem = null;
let toolSystem = null;
let screenshotSystem = null;
let workflowManager = null;
let modelRouter = null;
let skillRegistry = null;
let skillExecutor = null;
let mcpRegistry = null;
let mcpRuntime = null;
let agentSessionStore = null;
let agentEventBus = null;
let capabilityRegistry = null;
let channelRegistry = null;
let agentRuntime = null;
let agentHttpServer = null;
let resolveAgentRuntimeReady = null;
const agentRuntimeReadyPromise = new Promise((resolve) => {
  resolveAgentRuntimeReady = resolve;
});
let agentRuntimeInitState = {
  status: 'pending',
  stage: 'boot',
  detail: '',
  updatedAt: Date.now()
};
let childWindows = new Map(); // 管理所有子窗口
let lastSmallBounds = null; // 记录小窗口位置，避免缩放漂移
let isPetHidden = false; // 宠物是否已隐藏到托盘（子窗口打开时）
let menuWindow = null;
let bubbleWindow = null;
let bubbleWindowReady = false;
let pendingBubblePayload = null;
let intimacyWindow = null;
let intimacyWindowReady = false;
let pendingIntimacyPayload = null;
let intimacyWidgetVisible = false;
let legacyChatSessionId = null;
let screenshotIPCHandlersRegistered = false;
const SCREENSHOT_SHORTCUT = 'CommandOrControl+Shift+A';

// 窗口尺寸常量
const WINDOW_SIZES = {
  small: { width: 150, height: 150 },  // 只显示宠物
  medium: { width: 300, height: 300 }   // 显示菜单时
};
const MENU_WINDOW_SIZE = { width: 340, height: 340 };
const BUBBLE_WINDOW_SIZE = { width: 260, height: 110 };
const INTIMACY_WINDOW_SIZE = { width: 140, height: 58 };
const DEFAULT_BUBBLE_OFFSET = { x: 0, y: 8 };
const DEFAULT_INTIMACY_OFFSET = { x: 0, y: 0 };
let currentPetAnimationState = 'idle';
let currentPetVisualState = null;
let bubbleOffsetByState = {
  idle: { ...DEFAULT_BUBBLE_OFFSET }
};
let intimacyWidgetOffset = { ...DEFAULT_INTIMACY_OFFSET };
const SCENE_METADATA = {
  chat: {
    label: '聊天',
    description: '普通对话、陪伴聊天、默认问答',
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat'
  },
  agent: {
    label: 'Agent',
    description: '任务规划、工具调用、执行型请求',
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat'
  },
  vision: {
    label: '视觉',
    description: '看图、截图理解、图片分析',
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat'
  },
  translate: {
    label: '翻译',
    description: '文本翻译、截图翻译',
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat'
  },
  ocr: {
    label: 'OCR',
    description: '文字识别',
    defaultProvider: 'tesseract',
    defaultModel: 'tesseract'
  }
};
const DEFAULT_LLM_SCENE_CONFIG = Object.fromEntries(
  Object.entries(SCENE_METADATA).map(([scene, meta]) => [
    scene,
    {
      provider: meta.defaultProvider,
      model: meta.defaultModel,
      apiKeyMode: 'provider-fallback'
    }
  ])
);
const PROVIDER_ENV_KEY_MAP = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  glm: 'GLM_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  tesseract: null
};
const OPENAI_COMPAT_PROVIDERS = {
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
const SCREENSHOT_TEXT_NONE = '[NO_TEXT]';
let llmSceneConfig = JSON.parse(JSON.stringify(DEFAULT_LLM_SCENE_CONFIG));

function normalizeBubbleOffsetByState(input) {
  const fallback = { idle: { ...DEFAULT_BUBBLE_OFFSET } };
  if (!input || typeof input !== 'object') return fallback;

  const normalized = {};
  for (const [state, offset] of Object.entries(input)) {
    if (!offset || typeof offset !== 'object') continue;
    const x = Number(offset.x);
    const y = Number(offset.y);
    normalized[state] = {
      x: Number.isFinite(x) ? Math.max(-200, Math.min(200, Math.round(x))) : DEFAULT_BUBBLE_OFFSET.x,
      y: Number.isFinite(y) ? Math.max(-200, Math.min(200, Math.round(y))) : DEFAULT_BUBBLE_OFFSET.y
    };
  }

  if (!normalized.idle) {
    normalized.idle = { ...DEFAULT_BUBBLE_OFFSET };
  }
  return normalized;
}

function getBubbleOffsetForState(state) {
  if (currentPetVisualState && bubbleOffsetByState[currentPetVisualState]) {
    return bubbleOffsetByState[currentPetVisualState];
  }
  if (state && bubbleOffsetByState[state]) {
    return bubbleOffsetByState[state];
  }
  return bubbleOffsetByState.idle || DEFAULT_BUBBLE_OFFSET;
}

function normalizeLLMSceneConfig(config) {
  const normalized = {};
  const source = config && typeof config === 'object' ? config : {};
  for (const [scene, fallback] of Object.entries(DEFAULT_LLM_SCENE_CONFIG)) {
    const raw = source[scene] && typeof source[scene] === 'object' ? source[scene] : {};
    const provider = typeof raw.provider === 'string' && raw.provider.trim()
      ? raw.provider.trim().toLowerCase()
      : fallback.provider;
    const model = typeof raw.model === 'string' && raw.model.trim()
      ? raw.model.trim()
      : fallback.model;
    const apiKeyMode = raw.apiKeyMode === 'scene' ? 'scene' : 'provider-fallback';
    normalized[scene] = { provider, model, apiKeyMode };
  }
  return normalized;
}

function getSceneConfig(scene) {
  const normalizedScene = SCENE_METADATA[scene] ? scene : 'chat';
  const fallback = DEFAULT_LLM_SCENE_CONFIG[normalizedScene] || DEFAULT_LLM_SCENE_CONFIG.chat;
  const raw = llmSceneConfig[scene] && typeof llmSceneConfig[scene] === 'object'
    ? llmSceneConfig[scene]
    : fallback;
  const rawProvider = typeof raw.provider === 'string' && raw.provider.trim()
    ? raw.provider.trim().toLowerCase()
    : fallback.provider;
  const provider = rawProvider;
  const providerMeta = OPENAI_COMPAT_PROVIDERS[provider] || null;
  const model = typeof raw.model === 'string' && raw.model.trim()
    ? raw.model.trim()
    : (providerMeta?.defaultModel || fallback.model);
  const apiKeyMode = raw.apiKeyMode === 'scene' ? 'scene' : 'provider-fallback';
  return {
    scene: normalizedScene,
    provider,
    model,
    providerMeta,
    apiKeyMode,
    supportsTools: !!providerMeta?.supportsTools
  };
}

function getTaskSceneConfig(scene, options = {}) {
  const {
    fallbackScenes = [],
    requireImage = false
  } = options;

  const attempted = [];
  for (const sceneName of [scene, ...fallbackScenes]) {
    const config = getSceneConfig(sceneName);
    if (!config.providerMeta) {
      attempted.push(`${sceneName}:${config.provider}(unsupported)`);
      continue;
    }

    const credential = getSceneCredential(config.scene);
    const apiKey = credential.apiKey;
    if (!apiKey) {
      attempted.push(`${sceneName}:${config.provider}(missing-key)`);
      continue;
    }

    return {
      ...config,
      apiKey,
      credentialSource: credential.source,
      requireImage
    };
  }

  const mode = requireImage ? '图像处理' : '文本处理';
  throw new Error(`未找到可用的 ${mode} 模型配置。已尝试: ${attempted.join(', ') || '无'}`);
}

function getAvailableTaskSceneConfigs(sceneNames, options = {}) {
  const { requireImage = false } = options;
  const configs = [];
  const attempted = [];

  for (const scene of [...new Set(sceneNames.filter(Boolean))]) {
    const config = getSceneConfig(scene);
    if (!config.providerMeta) {
      attempted.push(`${scene}:${config.provider}(unsupported)`);
      continue;
    }

    const credential = getSceneCredential(config.scene);
    const apiKey = credential.apiKey;
    if (!apiKey) {
      attempted.push(`${scene}:${config.provider}(missing-key)`);
      continue;
    }

    configs.push({
      ...config,
      apiKey,
      credentialSource: credential.source,
      requireImage
    });
  }

  if (configs.length === 0) {
    const mode = requireImage ? '图像处理' : '文本处理';
    throw new Error(`未找到可用的 ${mode} 模型配置。已尝试: ${attempted.join(', ') || '无'}`);
  }

  return configs;
}

function getOpenAICompatibleHeaders(provider, apiKey) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://ai-desktop-pet.local';
    headers['X-Title'] = 'AI Desktop Pet';
  }

  return headers;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const rawText = await response.text();
    let data = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (error) {
        data = { rawText };
      }
    }

    if (!response.ok) {
      const detail = data?.error?.message || data?.message || data?.rawText || response.statusText;
      throw new Error(`${response.status} ${detail}`.trim());
    }

    return data || {};
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

async function requestOpenAICompatibleCompletion(config, messages, options = {}) {
  const payload = await fetchJsonWithTimeout(config.providerMeta.endpoint, {
    method: 'POST',
    headers: getOpenAICompatibleHeaders(config.provider, config.apiKey),
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 1200,
      // 关闭思考模式（qwen3 等模型支持，其他模型忽略此参数）
      enable_thinking: false
    })
  }, options.timeoutMs ?? 45000);

  const text = extractAssistantText(payload);
  if (!text) {
    throw new Error('模型返回为空');
  }
  return text;
}

async function runScreenshotOCR(dataURL) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/')) {
    throw new Error('无效的截图数据');
  }

  // 压缩图片，避免大图超时
  const compressedDataURL = compressDataURL(dataURL, 1280, 0.85);

  const configs = getAvailableTaskSceneConfigs(['ocr', 'vision'], {
    requireImage: true
  });
  const errors = [];

  for (const config of configs) {
    try {
      const text = await requestOpenAICompatibleCompletion(config, [
        {
          role: 'system',
          content: 'You are a precise OCR engine. Extract all visible text from the image, preserve line breaks, and do not add explanations. If there is no readable text, return exactly [NO_TEXT].'
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: compressedDataURL }
            },
            {
              type: 'text',
              text: 'Extract all text from this screenshot exactly as it appears.'
            }
          ]
        }
      ], {
        temperature: 0,
        maxTokens: 1800,
        timeoutMs: 60000
      });

      const normalizedText = text.trim() === SCREENSHOT_TEXT_NONE ? '' : text.trim();
      return {
        text: normalizedText,
        model: `${config.provider}:${config.model}`,
        scene: config.scene
      };
    } catch (error) {
      errors.push(`${config.scene}:${config.provider}:${config.model} -> ${error.message}`);
    }
  }

  throw new Error(`截图文字提取失败。请确认 OCR 或 Vision 场景已配置支持图片输入的模型。详细信息: ${errors.join(' | ')}`);
}

function getTargetLanguageLabel(targetLang) {
  const normalized = typeof targetLang === 'string' ? targetLang.trim().toLowerCase() : '';
  if (!normalized || normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans') {
    return '简体中文';
  }
  if (normalized === 'en' || normalized === 'en-us') {
    return '英语';
  }
  if (normalized === 'ja' || normalized === 'ja-jp') {
    return '日语';
  }
  if (normalized === 'ko' || normalized === 'ko-kr') {
    return '韩语';
  }
  return targetLang || '目标语言';
}

async function runScreenshotTranslation(sourceText, targetLang = 'zh-CN') {
  const trimmedText = typeof sourceText === 'string' ? sourceText.trim() : '';
  if (!trimmedText) {
    return {
      translatedText: '未识别到可翻译的文字。',
      model: null,
      scene: null
    };
  }

  const config = getTaskSceneConfig('translate', {
    fallbackScenes: ['chat']
  });
  const targetLabel = getTargetLanguageLabel(targetLang);
  const translatedText = await requestOpenAICompatibleCompletion(config, [
    {
      role: 'system',
      content: 'You are a precise translation engine. Translate the input faithfully, preserve line breaks and list structure, and do not add commentary.'
    },
    {
      role: 'user',
      content: `请将下面的截图文字翻译为${targetLabel}。只返回译文，保留原有换行和结构。\n\n${trimmedText}`
    }
  ], {
    temperature: 0.2,
    maxTokens: 1800,
    timeoutMs: 45000
  });

  return {
    translatedText: translatedText.trim(),
    model: `${config.provider}:${config.model}`,
    scene: config.scene
  };
}

// AI 图像分析：将截图发给视觉模型，返回分析文字
async function runScreenshotAnalysis(dataURL, prompt) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/')) {
    throw new Error('无效的截图数据');
  }

  const userPrompt = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim()
    : '请详细描述这张截图的内容，包括文字、图像和界面元素。';

  // 压缩图片，避免大图超时
  const compressedDataURL = compressDataURL(dataURL, 1280, 0.85);

  const config = getTaskSceneConfig('vision', {
    fallbackScenes: ['chat'],
    requireImage: true
  });

  const result = await requestOpenAICompatibleCompletion(config, [
    {
      role: 'system',
      content: '你是一个专业的图像分析助手，请根据用户的问题对截图进行详细分析。'
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: compressedDataURL } },
        { type: 'text', text: userPrompt }
      ]
    }
  ], {
    temperature: 0.3,
    maxTokens: 1500,
    timeoutMs: 60000
  });

  return {
    result: result.trim(),
    model: `${config.provider}:${config.model}`,
    scene: config.scene
  };
}

function formatScreenshotTranslationResult(sourceText, translatedText, targetLang) {
  return translatedText || '未生成译文。';
}

// 将截图压缩到适合 API 发送的尺寸（最大宽度 1280px，JPEG 85%）
// 避免发送 3-5MB 的大图导致超时
function compressDataURL(dataURL, maxWidth = 1280, quality = 0.85) {
  try {
    const { nativeImage } = require('electron');
    const image = nativeImage.createFromDataURL(dataURL);
    if (image.isEmpty()) return dataURL;

    const size = image.getSize();
    if (size.width <= maxWidth) {
      // 尺寸已够小，只转换格式到 JPEG 节省体积
      return image.toJPEG(Math.round(quality * 100)).toString('base64')
        ? `data:image/jpeg;base64,${image.toJPEG(Math.round(quality * 100)).toString('base64')}`
        : dataURL;
    }

    const scale = maxWidth / size.width;
    const resized = image.resize({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
      quality: 'good'
    });
    const jpeg = resized.toJPEG(Math.round(quality * 100));
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch (e) {
    console.warn('[Screenshot] 图片压缩失败，使用原图:', e.message);
    return dataURL;
  }
}

function imageFromDataURL(dataURL) {
  const { nativeImage } = require('electron');
  const image = nativeImage.createFromDataURL(dataURL);
  if (image.isEmpty()) {
    throw new Error('截图数据为空');
  }
  return image;
}

function getScreenshotDataURLFromRecord(record) {
  const { nativeImage } = require('electron');
  if (!record?.file_path) {
    throw new Error('截图文件不存在');
  }

  const image = nativeImage.createFromPath(record.file_path);
  if (image.isEmpty()) {
    throw new Error('截图文件读取失败');
  }
  return image.toDataURL();
}

// api-keys.json 文件路径（延迟初始化，app ready 后才可用）
let apiKeysFilePath = null;
let appConfigFilePath = null;

function getApiKeysFilePath() {
  if (!apiKeysFilePath) {
    apiKeysFilePath = path.join(app.getPath('userData'), 'api-keys.json');
  }
  return apiKeysFilePath;
}

function getAppConfigFilePath() {
  if (!appConfigFilePath) {
    appConfigFilePath = path.join(app.getPath('userData'), 'config.json');
  }
  return appConfigFilePath;
}

function normalizeAppConfig(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }

  const normalized = {};
  if (typeof data.pythonPath === 'string' && data.pythonPath.trim()) {
    normalized.pythonPath = data.pythonPath.trim();
  }
  if (typeof data.weatherDefaultCity === 'string' && data.weatherDefaultCity.trim()) {
    normalized.weatherDefaultCity = data.weatherDefaultCity.trim();
  }

  return normalized;
}

function readAppConfig() {
  try {
    const filePath = getAppConfigFilePath();
    if (fsSync.existsSync(filePath)) {
      return normalizeAppConfig(JSON.parse(fsSync.readFileSync(filePath, 'utf-8')));
    }
  } catch (error) {
    console.error('[App Config] 读取 config.json 失败:', error.message);
  }
  return {};
}

function writeAppConfig(config) {
  const filePath = getAppConfigFilePath();
  fsSync.writeFileSync(filePath, JSON.stringify(normalizeAppConfig(config), null, 2), 'utf-8');
}

function updateAppConfig(patch = {}) {
  const nextConfig = normalizeAppConfig({
    ...readAppConfig(),
    ...patch
  });
  writeAppConfig(nextConfig);
  return nextConfig;
}

function getWorkflowPythonPath() {
  const raw = workflowManager?._bridge?._pythonPath;
  if (raw && typeof raw === 'object') {
    return String(raw.command || '').trim();
  }
  return String(raw || '').trim();
}

function getPythonConfigSnapshot() {
  const config = readAppConfig();
  const configuredPath = config.pythonPath || '';
  const effectivePath = getWorkflowPythonPath();
  return {
    configuredPath,
    effectivePath,
    source: configuredPath ? 'config' : (effectivePath ? 'auto' : 'none')
  };
}

function reloadWorkflowManager() {
  if (typeof WorkflowManager.resetPythonDetectionCache === 'function') {
    WorkflowManager.resetPythonDetectionCache();
  }

  if (!workflowManager) {
    workflowManager = new WorkflowManager();
  } else if (typeof workflowManager.shutdown === 'function') {
    workflowManager.shutdown();
  }

  workflowManager.initialize();

  if (capabilityRegistry && typeof capabilityRegistry.refresh === 'function') {
    capabilityRegistry.refresh();
  }

  return getWorkflowPythonPath();
}

// 从 api-keys.json 读取所有已保存的 key
function readApiKeysFile() {
  try {
    const filePath = getApiKeysFilePath();
    const fsSync = require('fs');
    if (fsSync.existsSync(filePath)) {
      const data = fsSync.readFileSync(filePath, 'utf-8');
      return normalizeApiKeysStore(JSON.parse(data));
    }
  } catch (error) {
    console.error('[API Keys] 读取 api-keys.json 失败:', error.message);
  }
  return normalizeApiKeysStore();
}

function normalizeApiKeysStore(data = {}) {
  const emptyStore = { providers: {}, scenes: {} };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return emptyStore;
  }

  // 兼容旧版平铺 provider key 结构
  const looksLikeLegacy = Object.keys(data).some(key => Object.prototype.hasOwnProperty.call(PROVIDER_ENV_KEY_MAP, key));
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
  for (const scene of Object.keys(SCENE_METADATA)) {
    if (typeof data.scenes?.[scene] === 'string') {
      scenes[scene] = data.scenes[scene];
    }
  }

  return { providers, scenes };
}

function writeApiKeysFile(store) {
  const filePath = getApiKeysFilePath();
  const fsSync = require('fs');
  fsSync.writeFileSync(filePath, JSON.stringify(normalizeApiKeysStore(store), null, 2), 'utf-8');
}

function saveSceneApiKey(scene, key) {
  const normalizedScene = SCENE_METADATA[scene] ? scene : '';
  if (!normalizedScene) {
    throw new Error('unsupported scene');
  }
  const store = readApiKeysFile();
  store.scenes[normalizedScene] = key;
  writeApiKeysFile(store);
  console.log(`[API Keys] 已保存 scene ${normalizedScene} key (长度: ${key.length})`);
}

function getProviderApiKeyRecord(provider) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const envKey = PROVIDER_ENV_KEY_MAP[normalizedProvider];
  if (!envKey) return { apiKey: '', source: 'none' };

  const savedKeys = readApiKeysFile();
  if (savedKeys.providers[normalizedProvider]) {
    return { apiKey: savedKeys.providers[normalizedProvider], source: 'provider' };
  }

  const envValue = process.env[envKey] || '';
  if (envValue) {
    return { apiKey: envValue, source: 'env' };
  }

  return { apiKey: '', source: 'none' };
}

function getSceneCredential(scene, sceneConfigOverride = null) {
  const normalizedConfig = normalizeLLMSceneConfig(sceneConfigOverride || llmSceneConfig);
  const normalizedScene = SCENE_METADATA[scene] ? scene : 'chat';
  const config = normalizedConfig[normalizedScene] || DEFAULT_LLM_SCENE_CONFIG[normalizedScene];
  const store = readApiKeysFile();

  if (config.apiKeyMode === 'scene') {
    const sceneKey = store.scenes[normalizedScene] || '';
    if (sceneKey) {
      return { apiKey: sceneKey, source: 'scene' };
    }
  }

  return getProviderApiKeyRecord(config.provider);
}

function getSceneKeyStatusMap(sceneConfigOverride = null) {
  const normalizedConfig = normalizeLLMSceneConfig(sceneConfigOverride || llmSceneConfig);
  const store = readApiKeysFile();
  const result = {};

  for (const scene of Object.keys(SCENE_METADATA)) {
    const config = normalizedConfig[scene] || DEFAULT_LLM_SCENE_CONFIG[scene];
    const sceneKey = store.scenes[scene] || '';
    const resolved = getSceneCredential(scene, normalizedConfig);
    result[scene] = {
      scene,
      provider: config.provider,
      model: config.model,
      apiKeyMode: config.apiKeyMode,
      sceneMasked: maskApiKey(sceneKey),
      sceneConfigured: sceneKey.length > 0,
      sceneSource: sceneKey ? 'scene' : 'none',
      activeMasked: maskApiKey(resolved.apiKey),
      activeConfigured: resolved.apiKey.length > 0,
      activeSource: resolved.source
    };
  }

  return result;
}

function syncMemoryApiKey() {
  if (!memorySystem) return;
  const chatConfig = getSceneConfig('chat');
  let deepseekKey = '';
  if (chatConfig.provider === 'deepseek') {
    deepseekKey = getSceneCredential('chat').apiKey;
  }
  if (!deepseekKey) {
    deepseekKey = getProviderApiKeyRecord('deepseek').apiKey;
  }
  memorySystem.updateApiKey(deepseekKey);
}

// 保存单个 provider 的 key 到 api-keys.json
function saveProviderApiKey(provider, key) {
  const keys = readApiKeysFile();
  keys.providers[provider] = key;
  writeApiKeysFile(keys);
  console.log(`[API Keys] 已保存 ${provider} key (长度: ${key.length})`);
}

// 脱敏显示 key：前4+后4，中间用 **** 替换
function maskApiKey(key) {
  if (!key || key.length <= 8) return key ? '****' : '';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

function getProviderApiKeyByProvider(provider) {
  return getProviderApiKeyRecord(provider).apiKey;
}

// 创建主窗口（只显示宠物本体）
function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_SIZES.small.width,   // 默认小尺寸
    height: WINDOW_SIZES.small.height,
    x: 100,
    y: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  lastSmallBounds = { x: 100, y: 100, width: WINDOW_SIZES.small.width, height: WINDOW_SIZES.small.height };

  // 监听渲染进程错误
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.once('ready-to-show', () => {
    // 确保窗口可见
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    console.log('Window shown and focused');
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (intimacyWindow && !intimacyWindow.isDestroyed()) {
        intimacyWindow.hide();
      }
    }
  });

  mainWindow.on('move', () => {
    if (menuWindow && menuWindow.isVisible()) {
      const bounds = getMenuWindowBounds();
      menuWindow.setBounds(bounds, false);
    }
    if (bubbleWindow && bubbleWindow.isVisible()) {
      const bounds = getBubbleWindowBounds();
      bubbleWindow.setBounds(bounds, false);
    }
    if (intimacyWindow && intimacyWidgetVisible && intimacyWindow.isVisible()) {
      intimacyWindow.setBounds(getIntimacyWindowBounds(), false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getMenuWindowBounds() {
  if (!mainWindow) {
    return { x: 100, y: 100, width: MENU_WINDOW_SIZE.width, height: MENU_WINDOW_SIZE.height };
  }
  const bounds = mainWindow.getBounds();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: Math.round(centerX - MENU_WINDOW_SIZE.width / 2),
    y: Math.round(centerY - MENU_WINDOW_SIZE.height / 2 + 10),
    width: MENU_WINDOW_SIZE.width,
    height: MENU_WINDOW_SIZE.height
  };
}

function createMenuWindow() {
  menuWindow = new BrowserWindow({
    width: MENU_WINDOW_SIZE.width,
    height: MENU_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  menuWindow.loadFile('windows/menu-window.html');

  menuWindow.on('blur', () => {
    closeMenuWindow();
  });

  menuWindow.on('closed', () => {
    notifyMainMenuState(false);
    menuWindow = null;
  });
}

function notifyMainMenuState(isOpen) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('menu:state', { isOpen: !!isOpen });
}

function getBubbleWindowBounds() {
  if (!mainWindow) {
    return { x: 0, y: 0, width: BUBBLE_WINDOW_SIZE.width, height: BUBBLE_WINDOW_SIZE.height };
  }
  const bounds = mainWindow.getBounds();
  return getBubbleWindowBoundsFromMain(
    bounds,
    BUBBLE_WINDOW_SIZE,
    getBubbleOffsetForState(currentPetAnimationState)
  );
}

function getIntimacyWindowBounds() {
  if (!mainWindow) {
    return { x: 0, y: 0, width: INTIMACY_WINDOW_SIZE.width, height: INTIMACY_WINDOW_SIZE.height };
  }

  return getIntimacyWindowBoundsFromMain(
    mainWindow.getBounds(),
    INTIMACY_WINDOW_SIZE,
    intimacyWidgetOffset
  );
}

function createBubbleWindow() {
  bubbleWindowReady = false;
  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WINDOW_SIZE.width,
    height: BUBBLE_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  bubbleWindow.loadFile('windows/bubble-window.html');
  bubbleWindow.setIgnoreMouseEvents(true, { forward: true });

  bubbleWindow.webContents.on('did-finish-load', () => {
    bubbleWindowReady = true;
    if (pendingBubblePayload && bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleWindow.webContents.send('bubble:show', pendingBubblePayload);
      pendingBubblePayload = null;
    }
  });

  bubbleWindow.on('closed', () => {
    bubbleWindow = null;
    bubbleWindowReady = false;
    pendingBubblePayload = null;
  });
}

function createIntimacyWindow() {
  intimacyWindowReady = false;
  intimacyWindow = new BrowserWindow({
    width: INTIMACY_WINDOW_SIZE.width,
    height: INTIMACY_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  intimacyWindow.loadFile('windows/intimacy-window.html');
  intimacyWindow.setIgnoreMouseEvents(true, { forward: true });

  intimacyWindow.webContents.on('did-finish-load', () => {
    intimacyWindowReady = true;
    if (pendingIntimacyPayload && intimacyWindow && !intimacyWindow.isDestroyed()) {
      intimacyWindow.webContents.send('intimacy-widget:show', pendingIntimacyPayload);
      pendingIntimacyPayload = null;
    }
  });

  intimacyWindow.on('closed', () => {
    intimacyWindow = null;
    intimacyWindowReady = false;
    intimacyWidgetVisible = false;
    pendingIntimacyPayload = null;
  });
}

function normalizeBubblePayload(payloadOrMessage, duration) {
  if (payloadOrMessage && typeof payloadOrMessage === 'object') {
    return {
      message: String(payloadOrMessage.message || ''),
      duration: Number.isFinite(Number(payloadOrMessage.duration))
        ? Number(payloadOrMessage.duration)
        : 5000,
      sticky: !!payloadOrMessage.sticky
    };
  }

  return {
    message: String(payloadOrMessage || ''),
    duration: Number.isFinite(Number(duration)) ? Number(duration) : 5000,
    sticky: false
  };
}

function normalizeIntimacyPayload(payload) {
  const source = (payload && typeof payload === 'object') ? payload : {};
  return {
    levelText: String(source.levelText || 'Lv1 陌生人'),
    pointsText: String(source.pointsText || '0.0%'),
    progressText: typeof source.progressText === 'string' && source.progressText
      ? source.progressText
      : '0.0%',
    highlight: !!source.highlight
  };
}

function showBubbleWindow(payloadOrMessage, duration) {
  if (isPetHidden) return; // 宠物隐藏到托盘时不弹气泡
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    createBubbleWindow();
  }
  const payload = normalizeBubblePayload(payloadOrMessage, duration);
  const bounds = getBubbleWindowBounds();
  bubbleWindow.setBounds(bounds, false);
  bubbleWindow.showInactive();
  if (!bubbleWindowReady || bubbleWindow.webContents.isLoading()) {
    pendingBubblePayload = payload;
    return;
  }
  bubbleWindow.webContents.send('bubble:show', payload);
}

function hideBubbleWindow() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  bubbleWindow.hide();
}

function showIntimacyWidgetWindow(payload) {
  if (isPetHidden) return;
  if (!intimacyWindow || intimacyWindow.isDestroyed()) {
    createIntimacyWindow();
  }

  const normalized = normalizeIntimacyPayload(payload);
  intimacyWindow.setBounds(getIntimacyWindowBounds(), false);
  intimacyWidgetVisible = true;
  intimacyWindow.showInactive();

  if (!intimacyWindowReady || intimacyWindow.webContents.isLoading()) {
    pendingIntimacyPayload = normalized;
    return;
  }

  intimacyWindow.webContents.send('intimacy-widget:show', normalized);
}

function hideIntimacyWidgetWindow() {
  intimacyWidgetVisible = false;
  pendingIntimacyPayload = null;
  if (!intimacyWindow || intimacyWindow.isDestroyed()) return;
  intimacyWindow.webContents.send('intimacy-widget:hide');
  intimacyWindow.hide();
}

function registerScreenshotShortcut() {
  try {
    globalShortcut.unregister(SCREENSHOT_SHORTCUT);
    const registered = globalShortcut.register(SCREENSHOT_SHORTCUT, () => {
      console.log('[Screenshot] Global shortcut triggered');
      startScreenshotCapture();
    });

    if (!registered) {
      console.error(`[Screenshot] Failed to register shortcut: ${SCREENSHOT_SHORTCUT}`);
      return false;
    }

    console.log('✅ 截图快捷键已注册');
    console.log(`   ${SCREENSHOT_SHORTCUT}: 快速截图`);
    return true;
  } catch (error) {
    console.error('Failed to register screenshot shortcuts:', error);
    return false;
  }
}

function openMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed()) {
    createMenuWindow();
  }
  const bounds = getMenuWindowBounds();
  menuWindow.setBounds(bounds, false);
  menuWindow.show();
  menuWindow.focus();
  menuWindow.webContents.send('menu:command', { type: 'open' });
  notifyMainMenuState(true);
}

function closeMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed()) {
    notifyMainMenuState(false);
    return;
  }
  menuWindow.webContents.send('menu:command', { type: 'close' });
  menuWindow.hide();
  notifyMainMenuState(false);
}

function toggleMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed() || !menuWindow.isVisible()) {
    openMenuWindow();
    return true;
  }
  closeMenuWindow();
  return false;
}

// 记录显示器信息到数据库
function recordDisplayProfiles(reason = 'unknown') {
  if (!screen) return;
  if (!memorySystem || typeof memorySystem.saveDisplayProfiles !== 'function') {
    console.log('[Display] Memory system not ready, skip recording');
    return;
  }

  const displays = screen.getAllDisplays();
  const activeDisplay = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const activeId = activeDisplay ? String(activeDisplay.id) : null;

  const profiles = displays.map(display => ({
    displayId: String(display.id),
    label: display.label || null,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
    bounds: display.bounds,
    workArea: display.workArea,
    size: display.size,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation || 0,
    internal: display.internal ? 1 : 0,
    touchSupport: display.touchSupport || 'unknown',
    monochrome: display.monochrome ? 1 : 0,
    dpi: Number.isFinite(display.scaleFactor) ? Math.round(display.scaleFactor * 96) : null,
    sizeMm: null,
    reason
  }));

  try {
    memorySystem.saveDisplayProfiles(profiles, activeId);
    console.log(`[Display] Profiles recorded (${profiles.length}) reason=${reason}`);
  } catch (error) {
    console.error('[Display] Failed to record profiles:', error.message);
  }
}

function setAgentRuntimeInitState(status, stage, detail = '') {
  agentRuntimeInitState = {
    status,
    stage,
    detail: detail ? String(detail) : '',
    updatedAt: Date.now()
  };
  console.log('[AgentRuntime] init state:', agentRuntimeInitState);
}

function getAgentRuntimeDebugSummary() {
  const parts = [
    `status=${agentRuntimeInitState.status}`,
    `stage=${agentRuntimeInitState.stage}`
  ];

  if (agentRuntimeInitState.detail) {
    parts.push(`detail=${agentRuntimeInitState.detail}`);
  }

  return parts.join(', ');
}

function markAgentRuntimeReady() {
  if (typeof resolveAgentRuntimeReady === 'function') {
    console.log('[AgentRuntime] readiness signal emitted:', {
      ready: Boolean(agentRuntime),
      state: agentRuntimeInitState
    });
    resolveAgentRuntimeReady(agentRuntime);
    resolveAgentRuntimeReady = null;
  }
}

async function waitForAgentRuntime(timeoutMs = 15000) {
  if (agentRuntime) {
    return agentRuntime;
  }

  console.log('[AgentRuntime] waitForAgentRuntime begin:', {
    timeoutMs,
    state: agentRuntimeInitState
  });

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  const runtime = await Promise.race([
    agentRuntimeReadyPromise.then(() => agentRuntime || null),
    timeoutPromise
  ]);

  console.log('[AgentRuntime] waitForAgentRuntime result:', {
    ready: Boolean(runtime),
    state: agentRuntimeInitState
  });
  return runtime;
}

function refreshAgentCapabilities() {
  if (!capabilityRegistry) {
    return;
  }

  capabilityRegistry.skillRegistry = skillRegistry;
  capabilityRegistry.skillExecutor = skillExecutor;
  capabilityRegistry.mcpRuntime = mcpRuntime;
  capabilityRegistry.workflowManager = workflowManager;
  capabilityRegistry.toolSystem = toolSystem;
  capabilityRegistry.refresh();
  console.log('[AgentRuntime] capabilities refreshed:', {
    hasSkillRegistry: Boolean(skillRegistry),
    hasSkillExecutor: Boolean(skillExecutor),
    hasMcpRuntime: Boolean(mcpRuntime),
    hasWorkflowManager: Boolean(workflowManager),
    hasToolSystem: Boolean(toolSystem)
  });
}

function reloadSkillsRegistry() {
  if (!skillRegistry) {
    throw new Error('Skills 系统未初始化');
  }

  skillRegistry.loadSkills();
  refreshAgentCapabilities();
  return skillRegistry.listDetailedSkills();
}

// 创建系统托盘
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    tray = new Tray(iconPath);
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示宠物',
      click: () => {
        if (mainWindow) mainWindow.show();
      }
    },
    {
      label: '隐藏宠物',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    {
      label: '技术面板',
      click: () => {
        createChildWindow({
          id: 'skills-panel',
          title: '技术面板',
          width: 1180,
          height: 760,
          html: 'windows/skills-panel.html'
        });
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AI Desktop Pet');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

// 设置开机自启
function setAutoLaunch() {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false,
    name: 'AI Desktop Pet'
  });
}

// 应用启动
app.whenReady().then(async () => {
  console.log('App is ready, creating window...');
  createWindow();
  console.log('Creating tray...');
  createTray();
  console.log('Setting auto launch...');
  setAutoLaunch();
  registerScreenshotIPCHandlers(ipcMain);
  registerScreenshotShortcut();

  // 初始化记忆系统
  console.log('Initializing memory system...');
  memorySystem = new MemoryMainProcess({
    apiKey: process.env.DEEPSEEK_API_KEY || ''
  });
  // 先注册 IPC handlers，确保渲染进程的调用不会因初始化失败而无 handler
  memorySystem.registerIPCHandlers(ipcMain);
  ['memory:get-user-profile', 'memory:get-stats', 'memory:get-facts'].forEach((channel) => {
    ipcMain.removeHandler(channel);
  });
  ipcMain.handle('memory:get-conversations', async (event, options) => {
    return memorySystem.getConversations(options);
  });
  ipcMain.handle('memory:delete-conversation', async (event, id) => {
    return memorySystem.deleteConversation(id);
  });
  ipcMain.handle('memory:delete-fact', async (event, id) => {
    return memorySystem.deleteFact(id);
  });
  ipcMain.handle('memory:clear-user-profile', async () => {
    return memorySystem.clearUserProfile();
  });
  ipcMain.handle('memory:get-user-profile', async () => {
    try {
      if (memorySystem) return await memorySystem.getUserProfile();
      return null;
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle('memory:get-stats', async () => {
    try {
      if (!memorySystem || !memorySystem.storage || !memorySystem.storage.db) return null;
      const db = memorySystem.storage.db;
      const totalConversations = db.prepare('SELECT COUNT(*) as c FROM conversations').get().c;
      const totalFacts = db.prepare('SELECT COUNT(*) as c FROM memory_facts').get().c;
      const profileKeys = db.prepare('SELECT COUNT(*) as c FROM user_profile WHERE confidence >= 0.5').get().c;

      let activeMemories = 0;
      let dormantMemories = 0;
      try {
        activeMemories = db.prepare("SELECT COUNT(*) as c FROM memory_chunks WHERE (stability IS NULL OR stability > 0) AND (last_triggered_at IS NULL OR (julianday('now') - julianday(last_triggered_at / 1000, 'unixepoch')) * 24 < stability * 3)").get().c;
        dormantMemories = db.prepare('SELECT COUNT(*) as c FROM memory_chunks').get().c - activeMemories;
        if (dormantMemories < 0) dormantMemories = 0;
      } catch (e) {
        activeMemories = db.prepare('SELECT COUNT(*) as c FROM memory_chunks').get().c;
      }

      return { totalConversations, totalFacts, profileKeys, activeMemories, dormantMemories };
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle('memory:get-facts', async () => {
    try {
      if (!memorySystem || !memorySystem.storage || !memorySystem.storage.db) return [];
      const db = memorySystem.storage.db;
      const facts = db.prepare(`
        SELECT id, fact_type, subject, predicate, object, confidence, created_at
        FROM memory_facts
        ORDER BY confidence DESC, created_at DESC
        LIMIT 100
      `).all();
      return facts;
    } catch (e) {
      return [];
    }
  });
  // 初始化模型路由器
  modelRouter = new ModelRouter();
  modelRouter.registerIPCHandlers(ipcMain);
  // 设置主窗口引用（提醒通知需要）
  memorySystem.setMainWindow(mainWindow);
  try {
    setAgentRuntimeInitState('initializing', 'memory-storage:start');
    console.log('Initializing memory storage for agent runtime...');
    await memorySystem.storage.initialize();
    setAgentRuntimeInitState('initializing', 'memory-storage:ready');
    console.log('Memory storage initialized for agent runtime');
  } catch (error) {
    setAgentRuntimeInitState('initializing', 'memory-storage:failed', error && error.message ? error.message : error);
    console.error('Failed to initialize memory storage for agent runtime:', error);
  }

  console.log('Initializing agent runtime...');
  try {
    setAgentRuntimeInitState('initializing', 'session-store:create');
    agentSessionStore = new AgentSessionStore(memorySystem?.storage?.db);
    setAgentRuntimeInitState('initializing', 'event-bus:create');
    agentEventBus = new AgentEventBus(agentSessionStore, { maxEventsPerRun: 100 });
    setAgentRuntimeInitState('initializing', 'capability-registry:create');
    capabilityRegistry = new CapabilityRegistry({
      skillRegistry,
      skillExecutor,
      mcpRuntime,
      workflowManager,
      toolSystem
    });
    setAgentRuntimeInitState('initializing', 'channel-registry:create');
    channelRegistry = new ChannelRegistry(agentEventBus, { keepAliveMs: 15000 });
    setAgentRuntimeInitState('initializing', 'runtime:create');
    agentRuntime = new AgentRuntime({
      sessionStore: agentSessionStore,
      eventBus: agentEventBus,
      capabilityRegistry,
      memorySystem,
      modelRouter,
      getSceneConfig: () => llmSceneConfig,
      getDesktopPath: () => app.getPath('desktop'),
      onSummaryEvent: (event) => {
        if (channelRegistry) {
          channelRegistry.emitSummary(event);
        }
      }
    });
    setAgentRuntimeInitState('initializing', 'runtime:initialize');
    agentRuntime.initialize();
    setAgentRuntimeInitState('initializing', 'http-server:start');
    agentHttpServer = new AgentHttpServer({
      runtime: agentRuntime,
      channelRegistry,
      host: '127.0.0.1',
      port: 47831,
      tokenFilePath: path.join(app.getPath('userData'), 'http-token.txt')
    });
    agentHttpServer.start();
    setAgentRuntimeInitState('ready', 'http-server:ready');
    console.log('Agent runtime initialized successfully');
    markAgentRuntimeReady();
  } catch (error) {
    setAgentRuntimeInitState('failed', 'runtime:init-failed', error && error.stack ? error.stack : (error && error.message ? error.message : error));
    console.error('Failed to initialize agent runtime:', error);
    markAgentRuntimeReady();
  }

  try {
    await memorySystem.initialize();
    console.log('Memory system initialized successfully');
    syncMemoryApiKey();
    recordDisplayProfiles('startup');
  } catch (error) {
    console.error('Failed to initialize memory system:', error);
  }

  // 初始化工具系统
  console.log('Initializing tool system...');
  try {
    const { initializeTools, getToolSystem } = await import('./main-process/tools/index.js');
    await initializeTools();
    toolSystem = getToolSystem();
    refreshAgentCapabilities();
    console.log('Tool system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize tool system:', error);
  }

  // 初始化截图系统
  console.log('Initializing screenshot system...');
  try {
    const userDataPath = app.getPath('userData');
    screenshotSystem = new ScreenshotManager({
      storage: memorySystem,
      dataPath: userDataPath
    });
    await screenshotSystem.initialize();
    console.log('Screenshot system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize screenshot system:', error);
  }
  // 无论截图系统是否初始化成功，都必须注册 IPC handlers
  // 否则截图窗口打开后无法关闭（capture-cancel 等无响应）
  registerScreenshotIPCHandlers(ipcMain);

  // 初始化工作流系统（Python 工具调用）
  console.log('Initializing workflow manager...');
  try {
    workflowManager = new WorkflowManager();
    workflowManager.initialize();
    refreshAgentCapabilities();
    console.log('Workflow manager initialized successfully');
  } catch (error) {
    console.error('Failed to initialize workflow manager:', error);
  }

  // 初始化 Skills 系统（声明式技能注册 + 执行器）
  console.log('Initializing skills system...');
  try {
    skillRegistry = new SkillRegistry(app);
    skillRegistry.loadSkills();

    skillExecutor = new SkillExecutor({
      registry: skillRegistry,
      memorySystem: memorySystem,
      workflowManager: workflowManager,
      historyFilePath: path.join(app.getPath('userData'), 'skill-execution-history.json'),
      screenshotOCR: async ({ imageId, dataURL }) => {
        let resolvedDataURL = dataURL;

        if (!resolvedDataURL) {
          if (!screenshotSystem) {
            throw new Error('Screenshot system not initialized');
          }
          if (!imageId) {
            throw new Error('缺少 imageId 或 dataURL 参数');
          }
          const screenshot = screenshotSystem.getScreenshotById(imageId);
          if (!screenshot) {
            throw new Error('截图不存在');
          }
          resolvedDataURL = getScreenshotDataURLFromRecord(screenshot);
        }

        const ocrResult = await runScreenshotOCR(resolvedDataURL);

        if (imageId && screenshotSystem) {
          screenshotSystem.saveAnalysis(imageId, 'ocr', ocrResult.text || '未识别到文字。', {
            model: ocrResult.model
          });
          screenshotSystem.updateOcrText(imageId, ocrResult.text);
        }

        return {
          text: ocrResult.text || '',
          result: ocrResult.text || '未识别到文字。',
          model: ocrResult.model,
          scene: ocrResult.scene,
          imageId: imageId || null
        };
      },
      weatherDefaultCity: readAppConfig().weatherDefaultCity || ''
    });
    skillExecutor.setMainWindow(mainWindow);
    refreshAgentCapabilities();
    console.log('Skills system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize skills system:', error);
  }

  console.log('Initializing MCP registry...');
  try {
    mcpRegistry = new McpRegistry(app);
    mcpRuntime = new McpRuntime({
      registry: mcpRegistry,
      clientInfo: {
        name: 'ai-desktop-pet',
        version: app.getVersion()
      }
    });
    await mcpRuntime.initialize();
    refreshAgentCapabilities();
    console.log('MCP registry initialized successfully');
  } catch (error) {
    console.error('Failed to initialize MCP registry:', error);
  }

  ipcMain.handle('skill:list', () => {
    if (!skillRegistry) return [];
    return skillRegistry.getEligibleSkills();
  });

  ipcMain.handle('skill:list-detailed', () => {
    if (!skillRegistry) return [];
    return skillRegistry.listDetailedSkills();
  });

  ipcMain.handle('skill:get-tools-array', () => {
    if (!skillRegistry) return [];
    return skillRegistry.buildToolsArray();
  });

  ipcMain.handle('skill:get-prompt-snippet', () => {
    if (!skillRegistry) return '';
    return skillRegistry.formatForPrompt();
  });

  ipcMain.handle('skill:get-storage-info', () => {
    if (!skillRegistry) {
      return {
        bundledDir: '',
        userDir: '',
        stateFilePath: '',
        historyFilePath: ''
      };
    }
    return {
      ...skillRegistry.getStorageInfo(),
      historyFilePath: skillExecutor?.historyFilePath || ''
    };
  });

  ipcMain.handle('skill:get-document', async (event, name) => {
    if (!skillRegistry) {
      throw new Error('Skills 系统未初始化');
    }
    return skillRegistry.getSkillDocument(name);
  });

  ipcMain.handle('skill:get-history', () => {
    if (!skillExecutor) return [];
    return skillExecutor.getExecutionHistory(80);
  });

  ipcMain.handle('skill:clear-history', () => {
    if (!skillExecutor) return false;
    return skillExecutor.clearExecutionHistory();
  });

  ipcMain.handle('skill:get-approval-history', () => {
    if (!agentSessionStore) return [];
    return agentSessionStore.getRecentApprovals(80);
  });

  ipcMain.handle('skill:execute', async (event, name, args) => {
    if (!skillExecutor) {
      return { success: false, error: 'Skills 系统未初始化' };
    }
    return await skillExecutor.execute(name, args);
  });

  ipcMain.handle('skill:set-enabled', async (event, name, enabled) => {
    if (!skillRegistry) {
      throw new Error('Skills 系统未初始化');
    }
    const result = skillRegistry.setSkillEnabled(name, enabled);
    refreshAgentCapabilities();
    return result;
  });

  ipcMain.handle('skill:create', async (event, payload) => {
    if (!skillRegistry) {
      throw new Error('Skills 系统未初始化');
    }
    const createdSkill = skillRegistry.createUserSkill(payload || {});
    refreshAgentCapabilities();
    return createdSkill;
  });

  ipcMain.handle('skill:remove', async (event, name) => {
    if (!skillRegistry) {
      throw new Error('Skills 系统未初始化');
    }
    skillRegistry.removeSkill(name);
    refreshAgentCapabilities();
    return true;
  });

  ipcMain.handle('skill:save-document', async (event, name, content) => {
    if (!skillRegistry) {
      throw new Error('Skills 系统未初始化');
    }
    const result = skillRegistry.saveUserSkillDocument(name, content);
    refreshAgentCapabilities();
    return result;
  });

  ipcMain.handle('skill:reload', () => reloadSkillsRegistry());

  ipcMain.handle('mcp:list', () => {
    if (mcpRuntime) return mcpRuntime.listServers();
    if (mcpRegistry) return mcpRegistry.listServers();
    return [];
  });

  ipcMain.handle('mcp:get-storage-info', () => {
    if (!mcpRegistry) {
      return { filePath: '' };
    }
    return mcpRegistry.getStorageInfo();
  });

  ipcMain.handle('mcp:create', async (event, payload) => {
    if (!mcpRegistry) {
      throw new Error('MCP 系统未初始化');
    }
    const created = mcpRegistry.createServer(payload || {});
    if (mcpRuntime) {
      await mcpRuntime.syncServers();
      refreshAgentCapabilities();
      return mcpRuntime.listServers().find((item) => item.id === created.id) || created;
    }
    return created;
  });

  ipcMain.handle('mcp:update', async (event, id, payload) => {
    if (!mcpRegistry) {
      throw new Error('MCP 系统未初始化');
    }
    const updated = mcpRegistry.updateServer(id, payload || {});
    if (mcpRuntime) {
      await mcpRuntime.syncServers();
      refreshAgentCapabilities();
      return mcpRuntime.listServers().find((item) => item.id === updated.id) || updated;
    }
    return updated;
  });

  ipcMain.handle('mcp:set-enabled', async (event, id, enabled) => {
    if (!mcpRegistry) {
      throw new Error('MCP 系统未初始化');
    }
    const updated = mcpRegistry.setEnabled(id, enabled);
    if (mcpRuntime) {
      await mcpRuntime.syncServers();
      refreshAgentCapabilities();
      return mcpRuntime.listServers().find((item) => item.id === updated.id) || updated;
    }
    return updated;
  });

  ipcMain.handle('mcp:remove', async (event, id) => {
    if (!mcpRegistry) {
      throw new Error('MCP 系统未初始化');
    }
    const result = mcpRegistry.removeServer(id);
    if (mcpRuntime) {
      await mcpRuntime.syncServers();
      refreshAgentCapabilities();
    }
    return result;
  });

  ipcMain.handle('mcp:start', async (event, id) => {
    if (!mcpRuntime) {
      throw new Error('MCP 运行时未初始化');
    }
    const result = await mcpRuntime.startServer(id);
    refreshAgentCapabilities();
    return result;
  });

  ipcMain.handle('mcp:stop', async (event, id) => {
    if (!mcpRuntime) {
      throw new Error('MCP 运行时未初始化');
    }
    const result = await mcpRuntime.stopServer(id);
    refreshAgentCapabilities();
    return result;
  });

  ipcMain.handle('mcp:restart', async (event, id) => {
    if (!mcpRuntime) {
      throw new Error('MCP 运行时未初始化');
    }
    const result = await mcpRuntime.restartServer(id);
    refreshAgentCapabilities();
    return result;
  });

  // 注册工作流 IPC handlers
  ipcMain.handle('workflow:execute', async (event, toolName, args) => {
    if (!workflowManager) {
      return { success: false, error: '工作流系统未初始化' };
    }
    return await workflowManager.execute(toolName, args);
  });

  ipcMain.handle('workflow:list-tools', () => {
    if (!workflowManager) return [];
    return workflowManager.getToolDefinitions();
  });

  ipcMain.handle('workflow:get-desktop-path', () => {
    return app.getPath('desktop');
  });

  ipcMain.handle('workflow:abort', (event, requestId) => {
    if (!workflowManager) return false;
    return workflowManager.abort(requestId);
  });

  // 注册开发者工具快捷键
  if (channelRegistry) {
    channelRegistry.onSummary((event) => {
      if (!event || !event.payload) return;

      if (event.type === 'approval.requested') {
        showBubbleWindow({
          message: `等待批准: ${event.payload.toolName}`,
          duration: 4000
        });
      }

      if (event.type === 'run.completed') {
        showBubbleWindow({
          message: event.payload.summary || '任务已完成',
          duration: 5000
        });
      }
    });
  }

  ipcMain.on('skill:confirm-response', async (event, result) => {
    if (!result || !result.requestId || !agentRuntime) return;
    try {
      await agentRuntime.approve({
        approvalId: result.requestId,
        approved: !!result.approved
      });
    } catch (error) {
      console.error('[AgentRuntime] approval bridge failed:', error);
    }
  });

  console.log('Registering developer tools shortcuts...');
  try {
    // Ctrl+Shift+I: 打开/关闭开发者工具
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          // 以独立窗口模式打开 DevTools，并设置大小
          mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
      }
    });

    // Ctrl+R: 刷新页面
    globalShortcut.register('CommandOrControl+R', () => {
      if (mainWindow) {
        mainWindow.webContents.reload();
      }
    });

    console.log('✅ 开发者工具快捷键已注册');
    console.log('   Ctrl+Shift+I: 打开/关闭开发者工具');
    console.log('   Ctrl+R: 刷新页面');
  } catch (error) {
    console.error('Failed to register shortcuts:', error);
  }

  console.log('App initialization complete');

  // 监听显示器变化并记录
  if (screen) {
    screen.on('display-added', () => recordDisplayProfiles('display-added'));
    screen.on('display-removed', () => recordDisplayProfiles('display-removed'));
    screen.on('display-metrics-changed', () => recordDisplayProfiles('display-metrics-changed'));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  console.error('App initialization failed:', error);
});

app.on('window-all-closed', () => {
  // 在 Windows 和 Linux 上，不要在窗口关闭时退出应用
  // 因为我们有系统托盘图标
  if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  // 关闭记忆系统
  if (memorySystem) {
    memorySystem.close();
  }
  if (agentHttpServer) {
    agentHttpServer.stop();
  }
  // 关闭工作流 Python 进程
  if (workflowManager) {
    workflowManager.shutdown();
  }
  if (toolSystem && typeof toolSystem.shutdown === 'function') {
    toolSystem.shutdown();
  }
  if (mcpRuntime && typeof mcpRuntime.shutdown === 'function') {
    void mcpRuntime.shutdown();
  }
});

// 创建子窗口（用于聊天、设置、历史等）
function createChildWindow(options) {
  const { id, title, width, height, html } = options;
  
  // 如果窗口已存在，聚焦并返回
  if (childWindows.has(id)) {
    const existingWindow = childWindows.get(id);
    if (!existingWindow.isDestroyed()) {
      existingWindow.focus();
      return existingWindow;
    }
    childWindows.delete(id);
  }

  // 获取主窗口位置，在旁边打开子窗口（带屏幕边界检测）
  const mainBounds = mainWindow.getBounds();
  const childW = width || 400;
  const childH = height || 500;
  const display = screen.getDisplayMatching(mainBounds);
  const workArea = display.workArea;

  // 优先在右侧，空间不够则在左侧，还不够则居中
  let childX = mainBounds.x + mainBounds.width + 20;
  if (childX + childW > workArea.x + workArea.width) {
    childX = mainBounds.x - childW - 20;
  }
  if (childX < workArea.x) {
    childX = workArea.x + Math.round((workArea.width - childW) / 2);
  }

  // Y 方向：与主窗口顶部对齐，超出底部则上移
  let childY = mainBounds.y;
  if (childY + childH > workArea.y + workArea.height) {
    childY = workArea.y + workArea.height - childH - 20;
  }
  if (childY < workArea.y) {
    childY = workArea.y;
  }

  const childWindow = new BrowserWindow({
    width: childW,
    height: childH,
    x: childX,
    y: childY,
    frame: false,
    transparent: false,
    alwaysOnTop: false,  // 子窗口不置顶
    skipTaskbar: false,
    resizable: false,
    backgroundColor: '#020810',
    parent: mainWindow,  // 设置父窗口
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 加载HTML内容
  childWindow.loadFile(html);
  childWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Child Renderer:${id}] ${message}`);
  });
  childWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[Child Renderer:${id}] Failed to load:`, errorCode, errorDescription);
  });

  // 通知主窗口：子窗口已打开
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('child-window-state', 'opened');
  }

  // 窗口关闭时从Map中移除
  childWindow.on('closed', () => {
    childWindows.delete(id);
    // 通知主窗口：子窗口已关闭
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('child-window-state', 'closed');
    }
  });

  childWindows.set(id, childWindow);
  return childWindow;
}

// IPC 通信处理
ipcMain.handle('move-window', (event, deltaX, deltaY) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
    if (bubbleWindow && bubbleWindow.isVisible()) {
      const bounds = getBubbleWindowBounds();
      bubbleWindow.setBounds(bounds, false);
    }
    if (lastSmallBounds) {
      lastSmallBounds = {
        ...lastSmallBounds,
        x: lastSmallBounds.x + deltaX,
        y: lastSmallBounds.y + deltaY
      };
    } else {
      const bounds = mainWindow.getBounds();
      lastSmallBounds = {
        x: bounds.x,
        y: bounds.y,
        width: WINDOW_SIZES.small.width,
        height: WINDOW_SIZES.small.height
      };
    }
  }
});

// 动态调整窗口大小
ipcMain.handle('resize-window', (event, size, anchor) => {
  if (mainWindow) {
    const targetSize = WINDOW_SIZES[size] || WINDOW_SIZES.small;
    let nextBounds = null;

    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      let normalizedAnchor = { x: anchor.x, y: anchor.y };
      const display = screen ? screen.getDisplayMatching({
        x: anchor.x,
        y: anchor.y,
        width: 1,
        height: 1
      }) : null;
      if (display && Number.isFinite(display.scaleFactor)) {
        const ratio = Number.isFinite(anchor.ratio) ? anchor.ratio : display.scaleFactor;
        if (ratio > 0) {
          const scale = display.scaleFactor / ratio;
          normalizedAnchor = {
            x: anchor.x * scale,
            y: anchor.y * scale
          };
        }
      }
      const newX = Math.round(normalizedAnchor.x - targetSize.width / 2);
      const newY = Math.round(normalizedAnchor.y - targetSize.height / 2);
      nextBounds = {
        x: newX,
        y: newY,
        width: targetSize.width,
        height: targetSize.height
      };
    } else if (size === 'medium') {
      const base = mainWindow.getBounds();
      lastSmallBounds = {
        x: base.x,
        y: base.y,
        width: WINDOW_SIZES.small.width,
        height: WINDOW_SIZES.small.height
      };
      // 向下扩展：顶边保持不动，宽度向两侧均等扩展
      // 这样宠物保持同屏位置，面板只在宠物下方新增区域展开
      const centerX = base.x + base.width / 2;
      const newX = Math.round(centerX - targetSize.width / 2);
      const newY = base.y; // 顶边不动，向下扩展
      nextBounds = {
        x: newX,
        y: newY,
        width: targetSize.width,
        height: targetSize.height
      };
    } else {
      if (lastSmallBounds) {
        nextBounds = {
          x: lastSmallBounds.x,
          y: lastSmallBounds.y,
          width: targetSize.width,
          height: targetSize.height
        };
      } else {
        const bounds = mainWindow.getBounds();
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const newX = Math.round(centerX - targetSize.width / 2);
        const newY = Math.round(centerY - targetSize.height / 2);
        nextBounds = {
          x: newX,
          y: newY,
          width: targetSize.width,
          height: targetSize.height
        };
      }
      lastSmallBounds = { ...nextBounds };
    }

    mainWindow.setBounds(nextBounds, false);
    console.log(`[Main Process] Window resized to ${size}: ${nextBounds.width}x${nextBounds.height} at (${nextBounds.x}, ${nextBounds.y})`);
  }
});

// 菜单窗口控制
ipcMain.handle('menu:open', () => {
  openMenuWindow();
  return { isOpen: true };
});

ipcMain.handle('menu:close', () => {
  closeMenuWindow();
  return { isOpen: false };
});

ipcMain.handle('menu:toggle', () => {
  const isOpen = toggleMenuWindow();
  return { isOpen };
});

ipcMain.handle('menu:is-open', () => {
  return !!(menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible());
});

// Lottie 动画文件列表（由主进程读取，preload 只做桥接）
ipcMain.handle('lottie:list-json-files', (event, folder = 'cat') => {
  try {
    const safeFolder = String(folder || 'cat').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeFolder) return [];
    const target = path.join(__dirname, 'lottie', safeFolder);
    if (!fsSync.existsSync(target)) return [];
    return fsSync.readdirSync(target)
      .filter(name => typeof name === 'string' && name.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (error) {
    console.warn('[Main] list lottie files failed:', error.message);
    return [];
  }
});

ipcMain.on('lottie:list-json-files-sync', (event, folder = 'cat') => {
  try {
    const safeFolder = String(folder || 'cat').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeFolder) {
      event.returnValue = [];
      return;
    }
    const target = path.join(__dirname, 'lottie', safeFolder);
    if (!fsSync.existsSync(target)) {
      event.returnValue = [];
      return;
    }
    event.returnValue = fsSync.readdirSync(target)
      .filter(name => typeof name === 'string' && name.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (error) {
    console.warn('[Main] list lottie files sync failed:', error.message);
    event.returnValue = [];
  }
});

// 气泡窗口控制
ipcMain.handle('bubble:show', (event, payloadOrMessage, duration) => {
  showBubbleWindow(payloadOrMessage, duration);
  return { success: true };
});

ipcMain.handle('bubble:hide', () => {
  hideBubbleWindow();
  return { success: true };
});

ipcMain.handle('intimacy-widget:show', (event, payload) => {
  showIntimacyWidgetWindow(payload);
  return { success: true };
});

ipcMain.handle('intimacy-widget:hide', () => {
  hideIntimacyWidgetWindow();
  return { success: true };
});

// 快速检查 agentRuntime 是否已就绪（不等待）
ipcMain.handle('agent:is-ready', () => !!agentRuntime);

ipcMain.handle('agent:start-session', async (event, payload = {}) => {
  const runtime = agentRuntime || await waitForAgentRuntime(15000);
  if (!runtime) {
    return { error: `agent_runtime_unavailable (${getAgentRuntimeDebugSummary()})` };
  }
  console.log('[Agent IPC] start-session payload:', payload);
  const session = runtime.startSession(payload);
  console.log('[Agent IPC] start-session result:', session.id);
  return { sessionId: session.id };
});

ipcMain.handle('agent:send', async (event, payload = {}) => {
  const runtime = agentRuntime || await waitForAgentRuntime(15000);
  if (!runtime) {
    return { status: 'failed', reason: `agent_runtime_unavailable (${getAgentRuntimeDebugSummary()})` };
  }
  console.log('[Agent IPC] send payload:', {
    sessionId: payload.sessionId,
    source: payload.source,
    textLength: typeof payload.text === 'string' ? payload.text.length : 0,
    attachments: Array.isArray(payload.attachments) ? payload.attachments.length : 0
  });
  const result = await runtime.send(payload);
  console.log('[Agent IPC] send result:', result);
  return result;
});

ipcMain.handle('agent:get-state', async (event, payload = {}) => {
  if (!agentRuntime) {
    return null;
  }
  return agentRuntime.getState(payload);
});

ipcMain.handle('agent:open-stream', async (event, payload = {}) => {
  const runtime = agentRuntime || await waitForAgentRuntime(15000);
  if (!runtime || !channelRegistry) {
    return { error: `agent_runtime_unavailable (${getAgentRuntimeDebugSummary()})` };
  }
  const streamId = payload.streamId || `stream_${createChatRequestId()}`;
  const state = runtime.getState({
    sessionId: payload.sessionId,
    runId: payload.runId || null
  });
  const resolvedRunId = payload.runId || state?.activeRun?.id || null;
  return channelRegistry.createRendererStream(event.sender, {
    streamId,
    sessionId: payload.sessionId,
    runId: resolvedRunId,
    afterSeq: payload.afterSeq || 0
  });
});

ipcMain.handle('agent:approve', async (event, payload = {}) => {
  if (!agentRuntime) {
    return { ok: false };
  }
  return await agentRuntime.approve(payload);
});

ipcMain.handle('agent:cancel', async (event, payload = {}) => {
  if (!agentRuntime) {
    return { ok: false };
  }
  return await agentRuntime.cancel(payload);
});

ipcMain.handle('agent:wait', async (event, payload = {}) => {
  const runtime = agentRuntime || await waitForAgentRuntime(15000);
  if (!runtime) {
    return { ok: false, error: `agent_runtime_unavailable (${getAgentRuntimeDebugSummary()})` };
  }
  console.log('[Agent IPC] wait payload:', payload);
  const result = await runtime.wait(payload);
  console.log('[Agent IPC] wait result:', result);
  return result;
});

// 聊天 IPC
ipcMain.handle('chat:send', async (event, message) => {
  if (!agentRuntime) {
    // 降级：转发给主窗口 renderer，由 app-vanilla.js 的 initChatIpc 通过 PetAPI 处理
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: '主窗口不可用' };
    }
    return new Promise((resolve) => {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const replyChannel = `chat:response:${requestId}`;
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(replyChannel);
        resolve({ success: false, error: 'chat_timeout' });
      }, 30000);
      ipcMain.once(replyChannel, (_e, result) => {
        clearTimeout(timeout);
        resolve(result || { success: false, error: 'chat_no_result' });
      });
      mainWindow.webContents.send('chat:send', { requestId, message });
    });
  }
  try {
    if (!legacyChatSessionId) {
      legacyChatSessionId = agentRuntime.startSession({
        channel: 'legacy-chat-window',
        metadata: {
          personality: 'healing'
        }
      }).id;
    }

    const sendResult = await agentRuntime.send({
      sessionId: legacyChatSessionId,
      text: String(message || ''),
      source: 'legacy-chat-ipc'
    });

    if (sendResult.status === 'failed') {
      return { success: false, error: sendResult.reason || 'chat_failed' };
    }

    const waited = await agentRuntime.wait({
      runId: sendResult.runId,
      timeoutMs: 90000
    });

    if (!waited.ok) {
      return { success: false, error: waited.error || 'chat_failed' };
    }

    return { success: true, reply: waited.finalText || '' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 设置窗口通知 -> 主窗口
ipcMain.on('settings:change', (event, payload) => {
  if (payload && payload.type === 'bubble-offset-update') {
    bubbleOffsetByState = normalizeBubbleOffsetByState(payload.offsets);
    if (payload.state && typeof payload.state === 'string') {
      currentPetAnimationState = payload.state;
    }
    if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
      bubbleWindow.setBounds(getBubbleWindowBounds(), false);
    }
  } else if (payload && payload.type === 'bubble-offset-preview') {
    if (payload.state && typeof payload.state === 'string') {
      currentPetAnimationState = payload.state;
      if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
        bubbleWindow.setBounds(getBubbleWindowBounds(), false);
      }
    }
  } else if (payload && payload.type === 'intimacy-widget-offset-update') {
    const offset = payload.offset && typeof payload.offset === 'object' ? payload.offset : {};
    intimacyWidgetOffset = {
      x: Number.isFinite(Number(offset.x)) ? Math.max(-200, Math.min(200, Math.round(Number(offset.x)))) : 0,
      y: Number.isFinite(Number(offset.y)) ? Math.max(-200, Math.min(200, Math.round(Number(offset.y)))) : 0
    };
    if (intimacyWindow && !intimacyWindow.isDestroyed() && intimacyWidgetVisible && intimacyWindow.isVisible()) {
      intimacyWindow.setBounds(getIntimacyWindowBounds(), false);
    }
  } else if (payload && payload.type === 'llm-scene-config') {
    llmSceneConfig = normalizeLLMSceneConfig(payload.config);
    syncMemoryApiKey();
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('settings:change', payload);
});

// 菜单窗口宠物状态切换 -> 主窗口
ipcMain.on('pet:state', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('pet:state', payload);
});

// 主窗口动画状态上报 -> 主进程（用于按状态调整气泡位置）
ipcMain.on('pet:state-updated', (event, payload) => {
  if (!payload || typeof payload.state !== 'string') return;
  currentPetAnimationState = payload.state;
  currentPetVisualState = (payload.visualState && typeof payload.visualState === 'string')
    ? payload.visualState
    : null;
  if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
    bubbleWindow.setBounds(getBubbleWindowBounds(), false);
  }
  if (intimacyWindow && !intimacyWindow.isDestroyed() && intimacyWidgetVisible && intimacyWindow.isVisible()) {
    intimacyWindow.setBounds(getIntimacyWindowBounds(), false);
  }
});

ipcMain.on('hide-to-pet-tray', () => {
  isPetHidden = true;
  if (mainWindow) mainWindow.hide();
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
  if (intimacyWindow && !intimacyWindow.isDestroyed()) intimacyWindow.hide();
});

ipcMain.on('show-from-tray', () => {
  isPetHidden = false;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.setSkipTaskbar(true);
  }
  if (intimacyWindow && !intimacyWindow.isDestroyed() && intimacyWidgetVisible) {
    intimacyWindow.setBounds(getIntimacyWindowBounds(), false);
    intimacyWindow.showInactive();
  }
});

// 创建子窗口
ipcMain.handle('create-child-window', (event, options) => {
  try {
    createChildWindow(options);
    return { success: true };
  } catch (error) {
    console.error('Failed to create child window:', error);
    return { success: false, error: error.message };
  }
});

// 关闭子窗口
ipcMain.handle('close-child-window', (event, id) => {
  if (childWindows.has(id)) {
    const window = childWindows.get(id);
    if (!window.isDestroyed()) {
      window.close();
    }
    childWindows.delete(id);
  }
  return { success: true };
});

// 向子窗口发送数据
ipcMain.handle('send-to-child-window', (event, id, channel, data) => {
  if (childWindows.has(id)) {
    const window = childWindows.get(id);
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
      return { success: true };
    }
  }
  return { success: false };
});

// 启动截图（从工具菜单触发）
ipcMain.on('start-screenshot', () => {
  console.log('[Screenshot] Start screenshot requested from tools menu');
  startScreenshotCapture();
});

// 启动全屏截图
ipcMain.on('start-fullscreen-screenshot', () => {
  console.log('[Screenshot] Fullscreen screenshot requested');
  // 暂时使用区域截图，可以扩展为真正的全屏截图
  startScreenshotCapture();
});

// 打开截图文件夹
ipcMain.on('open-screenshots-folder', () => {
  const { shell } = require('electron');
  const path = require('path');
  const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
  shell.openPath(screenshotsDir);
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle('window:minimize-current', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.minimize();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 安全地获取 API 密钥（从环境变量）
ipcMain.handle('get-api-key', () => {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  console.log('[Main Process] get-api-key called:', apiKey ? `API Key found (${apiKey.length} chars)` : 'NO API KEY FOUND');
  return apiKey;
});

ipcMain.handle('workflow:get-python-config', () => {
  return getPythonConfigSnapshot();
});

ipcMain.handle('weather:get-default-city', () => {
  const config = readAppConfig();
  return {
    weatherDefaultCity: config.weatherDefaultCity || ''
  };
});

ipcMain.handle('weather:set-default-city', async (event, city) => {
  const weatherDefaultCity = typeof city === 'string' ? city.trim() : '';
  try {
    const config = updateAppConfig({ weatherDefaultCity });
    if (skillExecutor && typeof skillExecutor.setWeatherDefaultCity === 'function') {
      skillExecutor.setWeatherDefaultCity(config.weatherDefaultCity || '');
    }
    return { success: true, config };
  } catch (error) {
    console.error('[Weather] 保存默认城市失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workflow:choose-python-interpreter', async (event) => {
  try {
    const { dialog } = require('electron');
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow || null;
    const result = await dialog.showOpenDialog(owner, {
      title: '选择 Python 解释器',
      properties: ['openFile'],
      filters: process.platform === 'win32'
        ? [
            { name: 'Python', extensions: ['exe'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        : [
            { name: '所有文件', extensions: ['*'] }
          ]
    });

    return {
      success: true,
      canceled: !!result.canceled,
      path: result.canceled ? '' : (result.filePaths[0] || '')
    };
  } catch (error) {
    console.error('[WorkflowManager] 选择 Python 解释器失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workflow:set-python-interpreter', async (event, pythonPath) => {
  const trimmedPath = typeof pythonPath === 'string' ? pythonPath.trim() : '';
  if (!trimmedPath) {
    return { success: false, error: 'Python 解释器路径不能为空' };
  }

  if (!WorkflowManager.isUsablePythonInterpreter(trimmedPath)) {
    return { success: false, error: `Python 解释器不可用: ${trimmedPath}` };
  }

  try {
    updateAppConfig({ pythonPath: trimmedPath });
    reloadWorkflowManager();
    return { success: true, config: getPythonConfigSnapshot() };
  } catch (error) {
    console.error('[WorkflowManager] 保存 Python 解释器失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workflow:reset-python-interpreter', async () => {
  try {
    writeAppConfig({});
    reloadWorkflowManager();
    return { success: true, config: getPythonConfigSnapshot() };
  } catch (error) {
    console.error('[WorkflowManager] 重置 Python 解释器失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-provider-api-key', (event, provider) => {
  const apiKey = getProviderApiKeyByProvider(provider);
  console.log(`[API Keys] get-provider-api-key called for: ${provider}, found: ${apiKey ? apiKey.length + ' chars' : 'NO KEY'}`);
  return apiKey;
});

ipcMain.handle('get-scene-api-key', (event, scene, sceneConfigOverride) => {
  return getSceneCredential(scene, sceneConfigOverride).apiKey;
});

// 保存 provider API key 到本地文件
ipcMain.handle('save-provider-api-key', (event, provider, key) => {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  if (!normalizedProvider || !PROVIDER_ENV_KEY_MAP[normalizedProvider]) {
    return { success: false, error: '不支持的 provider' };
  }
  if (typeof key !== 'string') {
    return { success: false, error: 'key 必须是字符串' };
  }
  const trimmedKey = key.trim();
  // 格式验证：长度至少 20 字符
  if (trimmedKey.length > 0 && trimmedKey.length < 20) {
    return { success: false, error: 'API Key 长度不足（至少 20 位）' };
  }
  try {
    saveProviderApiKey(normalizedProvider, trimmedKey);
    syncMemoryApiKey();
    return { success: true };
  } catch (error) {
    console.error('[API Keys] 保存失败:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-scene-api-key', (event, scene, key) => {
  const normalizedScene = SCENE_METADATA[scene] ? scene : '';
  if (!normalizedScene) {
    return { success: false, error: '不支持的场景' };
  }
  if (typeof key !== 'string') {
    return { success: false, error: 'key 必须是字符串' };
  }
  const trimmedKey = key.trim();
  if (trimmedKey.length > 0 && trimmedKey.length < 20) {
    return { success: false, error: 'API Key 长度不足（至少 20 位）' };
  }
  try {
    saveSceneApiKey(normalizedScene, trimmedKey);
    syncMemoryApiKey();
    return { success: true };
  } catch (error) {
    console.error('[API Keys] 保存 scene key 失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 获取所有 provider 的 key（脱敏显示）
ipcMain.handle('get-all-provider-keys', () => {
  const savedKeys = readApiKeysFile();
  const result = {};
  for (const provider of Object.keys(PROVIDER_ENV_KEY_MAP)) {
    const savedKey = savedKeys.providers[provider] || '';
    const envKey = process.env[PROVIDER_ENV_KEY_MAP[provider]] || '';
    const actualKey = savedKey || envKey;
    result[provider] = {
      masked: maskApiKey(actualKey),
      configured: actualKey.length > 0,
      source: savedKey ? 'provider' : (envKey ? 'env' : 'none')
    };
  }
  return result;
});

ipcMain.handle('get-all-scene-key-statuses', (event, sceneConfigOverride) => {
  return getSceneKeyStatusMap(sceneConfigOverride);
});

// 测试 provider API key 连通性（发送最小请求）
const PROVIDER_TEST_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/v1/models',
  openai: 'https://api.openai.com/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  siliconflow: 'https://api.siliconflow.cn/v1/models',
  glm: 'https://open.bigmodel.cn/api/paas/v4/models',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models'
};

ipcMain.handle('test-provider-api-key', async (event, provider) => {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const endpoint = PROVIDER_TEST_ENDPOINTS[normalizedProvider];
  if (!endpoint) {
    return { success: false, error: '不支持的 provider' };
  }
  const apiKey = getProviderApiKeyByProvider(normalizedProvider);
  if (!apiKey) {
    return { success: false, error: 'API Key 未配置' };
  }
  try {
    const { net } = require('electron');
    const result = await new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: endpoint
      });
      request.setHeader('Authorization', `Bearer ${apiKey}`);
      request.setHeader('Content-Type', 'application/json');

      let responseData = '';
      let statusCode = 0;

      request.on('response', (response) => {
        statusCode = response.statusCode;
        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });
        response.on('end', () => {
          resolve({ statusCode, data: responseData });
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      // 超时 10 秒
      setTimeout(() => {
        request.abort();
        reject(new Error('请求超时'));
      }, 10000);

      request.end();
    });

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return { success: true, message: '连接成功' };
    } else if (result.statusCode === 401 || result.statusCode === 403) {
      return { success: false, error: 'API Key 无效或已过期' };
    } else {
      return { success: false, error: `HTTP ${result.statusCode}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-scene-api-key', async (event, scene, sceneConfigOverride) => {
  const normalizedScene = SCENE_METADATA[scene] ? scene : '';
  if (!normalizedScene) {
    return { success: false, error: '不支持的场景' };
  }

  const sceneSettings = normalizeLLMSceneConfig(sceneConfigOverride || llmSceneConfig);
  const config = sceneSettings[normalizedScene] || DEFAULT_LLM_SCENE_CONFIG[normalizedScene];
  const provider = config.provider;

  if (provider === 'tesseract') {
    return { success: true, message: '本地 OCR 无需 API Key' };
  }

  const endpoint = PROVIDER_TEST_ENDPOINTS[provider];
  if (!endpoint) {
    return { success: false, error: '不支持的 provider' };
  }

  const credential = getSceneCredential(normalizedScene, sceneSettings);
  if (!credential.apiKey) {
    return { success: false, error: '当前场景没有可用的 API Key' };
  }

  try {
    const { net } = require('electron');
    const result = await new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url: endpoint
      });
      request.setHeader('Authorization', `Bearer ${credential.apiKey}`);
      request.setHeader('Content-Type', 'application/json');

      let statusCode = 0;
      request.on('response', (response) => {
        statusCode = response.statusCode;
        response.on('data', () => {});
        response.on('end', () => resolve({ statusCode }));
      });
      request.on('error', reject);
      setTimeout(() => {
        request.abort();
        reject(new Error('请求超时'));
      }, 10000);
      request.end();
    });

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return {
        success: true,
        message: '连接成功',
        source: credential.source,
        provider
      };
    }
    if (result.statusCode === 401 || result.statusCode === 403) {
      return { success: false, error: 'API Key 无效或已过期' };
    }
    return { success: false, error: `HTTP ${result.statusCode}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 打开开发者工具
ipcMain.handle('open-devtools', () => {
  if (mainWindow) {
    mainWindow.webContents.toggleDevTools();
    console.log('[Main Process] DevTools 已切换');
  }
});

// ==================== 截图捕获函数 ====================

const { desktopCapturer, nativeImage, dialog, shell } = require('electron');
const fs = require('fs').promises;
const crypto = require('crypto');

let screenshotCaptureWindow = null;
let cachedScreenCaptureData = null;
let screenshotRestoreState = null;
const pinWindows = new Map(); // 管理贴图窗口，最多 5 个
const MAX_PIN_WINDOWS = 5;

// 启动截图捕获（由快捷键或菜单触发）
// 新流程：先全屏截图获取 dataURL → 发送给覆盖窗口显示为背景
async function startScreenshotCapture() {
  console.log('[Screenshot] Starting screenshot capture...');

  // 如果截图窗口已存在，先关闭它
  if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
    screenshotCaptureWindow.close();
    screenshotCaptureWindow = null;
  }

  // 隐藏主窗口、菜单、气泡和所有子窗口（避免被截进截图）
  screenshotRestoreState = {
    mainWasVisible: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !isPetHidden),
    menuWasVisible: !!(menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()),
    bubbleWasVisible: !!(bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible() && !isPetHidden),
    intimacyWasVisible: !!(intimacyWindow && !intimacyWindow.isDestroyed() && intimacyWindow.isVisible() && intimacyWidgetVisible && !isPetHidden),
    visibleChildWindows: Array.from(childWindows.entries())
      .filter(([, win]) => win && !win.isDestroyed() && win.isVisible())
      .map(([id]) => id)
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.hide();
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.hide();
  }
  if (intimacyWindow && !intimacyWindow.isDestroyed()) {
    intimacyWindow.hide();
  }
  childWindows.forEach((win) => {
    if (win && !win.isDestroyed()) win.hide();
  });

  // 等待窗口完全隐藏
  await new Promise(resolve => setTimeout(resolve, 150));

  // 先抓屏并缓存，避免把截图覆盖窗口自身（提示文案/工具栏）截进去
  try {
    cachedScreenCaptureData = await getScreenCapture();
  } catch (error) {
    console.error('[Screenshot] Pre-capture failed:', error);
    cachedScreenCaptureData = null;
  }

  // 获取所有显示器信息
  const displays = screen.getAllDisplays();

  // 计算虚拟屏幕的总边界（DIP 坐标）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  console.log('[Screenshot] Virtual screen bounds:', { minX, minY, totalWidth, totalHeight });
  console.log('[Screenshot] Displays:', displays.length);

  // 创建全屏透明覆盖窗口（安全模式）
  screenshotCaptureWindow = new BrowserWindow({
    width: totalWidth,
    height: totalHeight,
    x: minX,
    y: minY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: false,
    focusable: true,
    backgroundColor: '#01000001',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  screenshotCaptureWindow.loadFile('windows/screenshot-capture.html');
  screenshotCaptureWindow.setAlwaysOnTop(true, 'screen-saver');
  screenshotCaptureWindow.focus();
  screenshotCaptureWindow.webContents.once('did-finish-load', () => {
    if (!screenshotCaptureWindow || screenshotCaptureWindow.isDestroyed()) return;
    screenshotCaptureWindow.focus();
  });

  screenshotCaptureWindow.on('closed', () => {
    screenshotCaptureWindow = null;
    cachedScreenCaptureData = null;
  });
}

// 获取全屏截图（主进程在此完成 desktopCapturer 调用）
// 返回每个显示器的 dataURL + 显示器信息，供覆盖窗口作为静态背景
async function getScreenCapture() {
  const displays = screen.getAllDisplays();
  const displayCaptures = [];

  for (const display of displays) {
    // 使用物理像素尺寸获取高质量截图
    const physicalWidth = Math.round(display.bounds.width * display.scaleFactor);
    const physicalHeight = Math.round(display.bounds.height * display.scaleFactor);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: physicalWidth,
        height: physicalHeight
      }
    });

    // 使用 display_id 匹配正确的屏幕源
    const source = sources.find(s =>
      s.display_id === String(display.id)
    ) || sources[0];

    if (source) {
      displayCaptures.push({
        displayId: String(display.id),
        dataURL: source.thumbnail.toDataURL(),
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        physicalWidth,
        physicalHeight
      });
    }
  }

  return {
    displays: displayCaptures,
    virtualBounds: {
      x: Math.min(...displays.map(d => d.bounds.x)),
      y: Math.min(...displays.map(d => d.bounds.y)),
      width: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)) - Math.min(...displays.map(d => d.bounds.x)),
      height: Math.max(...displays.map(d => d.bounds.y + d.bounds.height)) - Math.min(...displays.map(d => d.bounds.y))
    }
  };
}

// 创建贴图窗口（截图固定到桌面）
function createPinWindow(imageDataURL, bounds) {
  // 限制最大贴图窗口数量
  if (pinWindows.size >= MAX_PIN_WINDOWS) {
    // 关闭最早的贴图窗口
    const oldestKey = pinWindows.keys().next().value;
    const oldestWin = pinWindows.get(oldestKey);
    if (oldestWin && !oldestWin.isDestroyed()) {
      oldestWin.close();
    }
    pinWindows.delete(oldestKey);
  }

  const pinId = `pin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const pinWin = new BrowserWindow({
    width: Math.max(bounds.width || 300, 100),
    height: Math.max(bounds.height || 200, 100),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  pinWin.loadFile('windows/pin-window.html');

  pinWin.webContents.on('did-finish-load', () => {
    pinWin.webContents.send('pin:load', imageDataURL);
  });

  pinWin.on('closed', () => {
    pinWindows.delete(pinId);
  });

  pinWindows.set(pinId, pinWin);
  console.log(`[Screenshot] Pin window created: ${pinId} (total: ${pinWindows.size})`);
  return pinId;
}

// 关闭截图捕获窗口
function closeScreenshotCapture() {
  if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
    screenshotCaptureWindow.close();
    screenshotCaptureWindow = null;
  }
  cachedScreenCaptureData = null;
  showMainWindow(screenshotRestoreState);
}

// ?????????????????
function showMainWindow(restoreState = null) {
  const state = restoreState && typeof restoreState === 'object' ? restoreState : null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    const shouldShowMain = state
      ? (!!state.mainWasVisible && !isPetHidden)
      : !isPetHidden;
    if (shouldShowMain) {
      mainWindow.show();
    }
  }

  if (menuWindow && !menuWindow.isDestroyed()) {
    const shouldShowMenu = state ? !!state.menuWasVisible : menuWindow.isVisible();
    if (shouldShowMenu) {
      menuWindow.show();
    }
  }

  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    const shouldShowBubble = state ? (!!state.bubbleWasVisible && !isPetHidden) : false;
    if (shouldShowBubble) {
      bubbleWindow.showInactive();
    }
  }

  if (intimacyWindow && !intimacyWindow.isDestroyed()) {
    const shouldShowIntimacy = state ? (!!state.intimacyWasVisible && !isPetHidden && intimacyWidgetVisible) : false;
    if (shouldShowIntimacy) {
      intimacyWindow.setBounds(getIntimacyWindowBounds(), false);
      intimacyWindow.showInactive();
    }
  }

  const visibleChildIds = state && Array.isArray(state.visibleChildWindows)
    ? new Set(state.visibleChildWindows)
    : null;
  childWindows.forEach((win, id) => {
    if (!win || win.isDestroyed()) return;
    if (visibleChildIds && !visibleChildIds.has(id)) return;
    win.show();
  });

  screenshotRestoreState = null;
}

// ==================== 工具系统 IPC 处理器 ====================

// 执行工具
ipcMain.handle('tool:execute', async (event, toolName, params, context = {}) => {
  try {
    if (!toolSystem) {
      throw new Error('工具系统未初始化');
    }

    // 添加会话信息到上下文
    const enhancedContext = {
      ...context,
      sessionId: context.sessionId || generateSessionId(),
      personality: context.personality || 'healing'
    };

    const result = await toolSystem.execute(toolName, params, enhancedContext);
    return { success: true, result };
  } catch (error) {
    console.error('Tool execution error:', error);
    return { success: false, error: error.message };
  }
});

// 列出所有工具
ipcMain.handle('tool:list', async () => {
  try {
    if (!toolSystem) {
      return [];
    }
    return toolSystem.listTools();
  } catch (error) {
    console.error('Tool list error:', error);
    return [];
  }
});

// 获取工具执行历史
ipcMain.handle('tool:get-history', async (event, options = {}) => {
  try {
    if (!toolSystem) {
      return [];
    }
    return toolSystem.getHistory(options);
  } catch (error) {
    console.error('Tool history error:', error);
    return [];
  }
});

// 清空工具执行历史
ipcMain.handle('tool:clear-history', async () => {
  try {
    if (!toolSystem) {
      return { success: false };
    }
    toolSystem.clearHistory();
    return { success: true };
  } catch (error) {
    console.error('Tool clear history error:', error);
    return { success: false, error: error.message };
  }
});

// 生成会话 ID
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ==================== 截图系统 IPC 处理器 ====================

// 注册截图 IPC 处理器
function registerScreenshotIPCHandlers(ipc) {
  if (screenshotIPCHandlersRegistered) {
    return;
  }
  screenshotIPCHandlersRegistered = true;

  // ---- 新版截图流程 IPC（ScreenshotBridge 使用） ----

  // 获取系统窗口列表（窗口模式截图使用）
  ipc.handle('screenshot:get-windows', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const os = require('os');
      const fsSync = require('fs');
      const execAsync = promisify(exec);

      const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;

      // C# 代码：通过 Win32 API 枚举可见窗口
      const csCode = [
        'using System;',
        'using System.Runtime.InteropServices;',
        'using System.Text;',
        'using System.Collections.Generic;',
        'public class WinEnum {',
        '    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);',
        '    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
        '    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
        '    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
        '    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
        '    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }',
        '    public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);',
        '    static List<string> _list = new List<string>();',
        '    static bool CB(IntPtr h, IntPtr p) {',
        '        if (!IsWindowVisible(h)||IsIconic(h)) return true;',
        '        var sb = new StringBuilder(256);',
        '        GetWindowText(h, sb, 256);',
        '        string t = sb.ToString();',
        '        if (string.IsNullOrWhiteSpace(t)) return true;',
        '        RECT r; if (!GetWindowRect(h, out r)) return true;',
        '        int w=r.R-r.L, ht=r.B-r.T;',
        '        if (w<=10||ht<=10) return true;',
        '        _list.Add(r.L+"|"+r.T+"|"+w+"|"+ht+"|"+t);',
        '        return true;',
        '    }',
        '    public static string[] GetAll() { _list.Clear(); EnumWindows(CB, IntPtr.Zero); return _list.ToArray(); }',
        '}',
      ].join('\r\n');

      const psCode = `Add-Type -TypeDefinition @'\r\n${csCode}\r\n'@\r\n[WinEnum]::GetAll()`;
      const tmpPs = path.join(os.tmpdir(), `winenum_${Date.now()}.ps1`);
      fsSync.writeFileSync(tmpPs, psCode, 'utf8');

      let stdout = '';
      try {
        const result = await execAsync(
          `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpPs}"`,
          { timeout: 8000, windowsHide: true }
        );
        stdout = result.stdout;
      } finally {
        try { fsSync.unlinkSync(tmpPs); } catch {}
      }

      const windows = stdout.trim().split('\n')
        .filter(l => l.trim() && l.includes('|'))
        .map(l => {
          const line = l.trim().replace(/\r$/, '');
          // 格式: left|top|width|height|title（title 可能含 |）
          const idx1 = line.indexOf('|');
          const idx2 = line.indexOf('|', idx1 + 1);
          const idx3 = line.indexOf('|', idx2 + 1);
          const idx4 = line.indexOf('|', idx3 + 1);
          if (idx4 === -1) return null;
          const left   = parseInt(line.substring(0, idx1));
          const top    = parseInt(line.substring(idx1 + 1, idx2));
          const width  = parseInt(line.substring(idx2 + 1, idx3));
          const height = parseInt(line.substring(idx3 + 1, idx4));
          const title  = line.substring(idx4 + 1);
          if (isNaN(left) || isNaN(top) || isNaN(width) || isNaN(height)) return null;
          return {
            title,
            x: Math.round(left   / scaleFactor),
            y: Math.round(top    / scaleFactor),
            w: Math.round(width  / scaleFactor),
            h: Math.round(height / scaleFactor),
          };
        })
        .filter(w => w !== null);

      return { success: true, windows };
    } catch (err) {
      console.error('[截图] 获取窗口列表失败:', err);
      return { success: false, error: err.message, windows: [] };
    }
  });

  // 获取全屏截图 dataURL + 显示器信息（覆盖窗口加载后调用）
  ipc.handle('screenshot:get-screen-capture', async () => {
    try {
      const data = cachedScreenCaptureData || await getScreenCapture();
      return { success: true, ...data };
    } catch (error) {
      console.error('[Screenshot] Failed to get screen capture:', error);
      return { success: false, error: error.message };
    }
  });

  // 区域选择完成（由覆盖窗口通过 ScreenshotBridge.selectRegion 调用）
  ipc.handle('screenshot:region-selected', async (event, bounds) => {
    try {
      // 输入校验
      if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number'
          || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
        throw new Error('Invalid bounds format');
      }
      if (bounds.width < 1 || bounds.height < 1
          || bounds.width > 10000 || bounds.height > 10000) {
        throw new Error('Bounds out of range');
      }

      console.log('[Screenshot] Region selected:', bounds);
      // 关闭覆盖窗口（不恢复主窗口，因为操作还在继续）
      if (screenshotCaptureWindow && !screenshotCaptureWindow.isDestroyed()) {
        screenshotCaptureWindow.close();
        screenshotCaptureWindow = null;
      }
      showMainWindow(screenshotRestoreState);
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Region selection failed:', error);
      return { success: false, error: error.message };
    }
  });

  // 取消截图
  ipc.handle('screenshot:capture-cancel', async () => {
    console.log('[Screenshot] Capture cancelled');
    closeScreenshotCapture();
    return { success: true };
  });

  // 从 dataURL 复制图片到剪贴板（无需文件路径）
  ipc.handle('screenshot:copy-data', async (event, dataURL) => {
    try {
      const { clipboard, nativeImage } = require('electron');
      const image = nativeImage.createFromDataURL(String(dataURL || ''));
      if (image.isEmpty()) {
        throw new Error('截图数据无效');
      }
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Failed to copy data to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // 快速保存到 userData/screenshots/
  ipc.handle('screenshot:save-quick', async (event, dataURL) => {
    try {
      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }
      const result = await screenshotSystem.saveFromDataURL(dataURL);

      // 保存数据库记录
      const screenshotId = screenshotSystem.saveScreenshotRecord({
        filePath: result.filePath,
        fileSize: result.fileSize,
        width: result.width,
        height: result.height,
        format: 'png',
        captureMethod: 'region'
      });

      return { success: true, filePath: result.filePath, screenshotId };
    } catch (error) {
      console.error('[Screenshot] Failed to quick save:', error);
      return { success: false, error: error.message };
    }
  });

  // 另存为（弹出系统文件选择对话框）
  ipc.handle('screenshot:save-as', async (event, dataURL) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '保存截图',
        defaultPath: `screenshot_${Date.now()}.png`,
        filters: [
          { name: 'PNG 图片', extensions: ['png'] },
          { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }
        ]
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      const image = nativeImage.createFromDataURL(dataURL);
      const ext = path.extname(result.filePath).toLowerCase();
      const buffer = (ext === '.jpg' || ext === '.jpeg')
        ? image.toJPEG(90)
        : image.toPNG();

      await fs.writeFile(result.filePath, buffer);
      console.log(`[Screenshot] Saved as: ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      console.error('[Screenshot] Failed to save as:', error);
      return { success: false, error: error.message };
    }
  });

  // 贴图到桌面（创建置顶小窗口）
  ipc.handle('screenshot:pin', async (event, dataURL, bounds) => {
    try {
      const pinId = createPinWindow(dataURL, bounds || { width: 300, height: 200 });
      return { success: true, windowId: pinId };
    } catch (error) {
      console.error('[Screenshot] Failed to create pin window:', error);
      return { success: false, error: error.message };
    }
  });

  // AI 分析截图（新接口 - 直接传 dataURL）
  ipc.handle('screenshot:analyze-image', async (event, dataURL, prompt) => {
    try {
      const analysis = await runScreenshotAnalysis(dataURL, prompt);
      return { success: true, result: analysis.result, model: analysis.model };
    } catch (error) {
      console.error('[Screenshot] Failed to analyze image:', error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle('screenshot:ocr-image', async (event, dataURL) => {
    try {
      imageFromDataURL(dataURL);
      const ocrResult = await runScreenshotOCR(dataURL);
      return {
        success: true,
        text: ocrResult.text,
        result: ocrResult.text || '未识别到文字。',
        model: ocrResult.model,
        scene: ocrResult.scene
      };
    } catch (error) {
      console.error('[Screenshot] Failed to perform OCR:', error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle('screenshot:translate-image', async (event, dataURL, targetLang = 'zh-CN') => {
    try {
      imageFromDataURL(dataURL);
      const ocrResult = await runScreenshotOCR(dataURL);
      const translation = await runScreenshotTranslation(ocrResult.text, targetLang);
      return {
        success: true,
        text: ocrResult.text,
        translatedText: translation.translatedText,
        result: formatScreenshotTranslationResult(ocrResult.text, translation.translatedText, targetLang),
        model: translation.model,
        ocrModel: ocrResult.model,
        scene: translation.scene
      };
    } catch (error) {
      console.error('[Screenshot] Failed to translate image:', error);
      return { success: false, error: error.message };
    }
  });

  // 贴图窗口：设置透明度（发送者即贴图窗口本身）
  ipc.handle('pin:set-opacity', (event, opacity) => {
    try {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin && !senderWin.isDestroyed()) {
        const clamped = Math.max(0.3, Math.min(1.0, Number(opacity)));
        senderWin.setOpacity(clamped);
      }
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Failed to set pin opacity:', error);
      return { success: false, error: error.message };
    }
  });

  // 贴图窗口：关闭自身
  ipc.handle('pin:close', (event) => {
    try {
      const senderWin = BrowserWindow.fromWebContents(event.sender);
      if (senderWin && !senderWin.isDestroyed()) {
        senderWin.close();
      }
      return { success: true };
    } catch (error) {
      console.error('[Screenshot] Failed to close pin window:', error);
      return { success: false, error: error.message };
    }
  });

  // ---- 旧版 PetScreenshot API 兼容 IPC ----

  // 获取可用的屏幕源
  ipc.handle('screenshot:get-sources', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const sources = await screenshotSystem.getSources();
      return { success: true, sources };
    } catch (error) {
      console.error('Failed to get screenshot sources:', error);
      return { success: false, error: error.message };
    }
  });

  // 区域截图
  ipc.handle('screenshot:capture-region', async (event, bounds) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      return { success: true, message: 'Region capture initiated' };
    } catch (error) {
      console.error('Failed to capture region:', error);
      return { success: false, error: error.message };
    }
  });

  // 全屏截图
  ipc.handle('screenshot:capture-fullscreen', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      return { success: true, message: 'Fullscreen capture initiated' };
    } catch (error) {
      console.error('Failed to capture fullscreen:', error);
      return { success: false, error: error.message };
    }
  });

  // 从文件路径复制到剪贴板（带路径校验）
  ipc.handle('screenshot:copy-to-clipboard', async (event, filePath) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      await screenshotSystem.copyToClipboard(filePath);
      return { success: true };
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取截图历史（sortBy/sortOrder 白名单校验在 ScreenshotManager 中完成）
  ipc.handle('screenshot:get-history', async (event, options = {}) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const history = screenshotSystem.getHistory(options);
      return { success: true, history };
    } catch (error) {
      console.error('Failed to get screenshot history:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取单个截图
  ipc.handle('screenshot:get-by-id', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const screenshot = screenshotSystem.getScreenshotById(id);
      return { success: true, screenshot };
    } catch (error) {
      console.error('Failed to get screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // 软删除截图
  ipc.handle('screenshot:delete', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      screenshotSystem.deleteScreenshot(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // 永久删除截图
  ipc.handle('screenshot:permanently-delete', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      await screenshotSystem.permanentlyDeleteScreenshot(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to permanently delete screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // AI 分析（旧接口 - 按 ID）
  ipc.handle('screenshot:analyze', async (event, id, prompt) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const screenshot = screenshotSystem.getScreenshotById(id);
      if (!screenshot) {
        throw new Error('截图不存在');
      }
      const dataURL = getScreenshotDataURLFromRecord(screenshot);
      const analysis = await runScreenshotAnalysis(dataURL, prompt);
      const analysisId = screenshotSystem.saveAnalysis(id, 'analyze', analysis.result, {
        model: analysis.model,
        prompt
      });
      return { success: true, analysisId, result: analysis.result };
    } catch (error) {
      console.error('Failed to analyze screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // OCR 识别（旧接口 - 按 ID）
  ipc.handle('screenshot:ocr', async (event, id, lang = 'eng') => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const screenshot = screenshotSystem.getScreenshotById(id);
      if (!screenshot) {
        throw new Error('截图不存在');
      }

      const dataURL = getScreenshotDataURLFromRecord(screenshot);
      const ocrResult = await runScreenshotOCR(dataURL);
      const result = ocrResult.text || '未识别到文字。';
      const analysisId = screenshotSystem.saveAnalysis(id, 'ocr', result, {
        model: ocrResult.model,
        lang
      });
      screenshotSystem.updateOcrText(id, ocrResult.text);
      return { success: true, analysisId, result };
    } catch (error) {
      console.error('Failed to perform OCR:', error);
      return { success: false, error: error.message };
    }
  });

  // 翻译
  ipc.handle('screenshot:translate', async (event, id, targetLang = 'zh') => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const screenshot = screenshotSystem.getScreenshotById(id);
      if (!screenshot) {
        throw new Error('截图不存在');
      }

      let sourceText = typeof screenshot.ocr_text === 'string' ? screenshot.ocr_text.trim() : '';
      let ocrModel = null;
      if (!sourceText) {
        const dataURL = getScreenshotDataURLFromRecord(screenshot);
        const ocrResult = await runScreenshotOCR(dataURL);
        sourceText = ocrResult.text;
        ocrModel = ocrResult.model;
        screenshotSystem.updateOcrText(id, sourceText);
      }

      const translation = await runScreenshotTranslation(sourceText, targetLang);
      const result = formatScreenshotTranslationResult(sourceText, translation.translatedText, targetLang);
      const analysisId = screenshotSystem.saveAnalysis(id, 'translate', result, {
        model: translation.model,
        prompt: sourceText ? undefined : '未识别到可翻译的文字',
        targetLang
      });
      return {
        success: true,
        analysisId,
        result,
        translatedText: translation.translatedText,
        sourceText,
        ocrModel
      };
    } catch (error) {
      console.error('Failed to translate screenshot:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取分析结果
  ipc.handle('screenshot:get-analyses', async (event, id) => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const analyses = screenshotSystem.getAnalyses(id);
      return { success: true, analyses };
    } catch (error) {
      console.error('Failed to get analyses:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取统计信息
  ipc.handle('screenshot:get-statistics', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      const stats = screenshotSystem.getStatistics();
      return { success: true, statistics: stats };
    } catch (error) {
      console.error('Failed to get statistics:', error);
      return { success: false, error: error.message };
    }
  });

  // 清理过期截图
  ipc.handle('screenshot:cleanup', async () => {
    try {
      if (!screenshotSystem) {
        throw new Error('Screenshot system not initialized');
      }
      await screenshotSystem.cleanupOldDeletedScreenshots();
      return { success: true };
    } catch (error) {
      console.error('Failed to cleanup screenshots:', error);
      return { success: false, error: error.message };
    }
  });
}

// 防止多实例运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main Process] Failed to get single instance lock, quitting...');
  app.quit();
} else {
  console.log('[Main Process] Got single instance lock');
  app.on('second-instance', () => {
    console.log('[Main Process] Second instance detected, focusing main window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}
