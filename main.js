const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fsSync = require('fs');
const MemoryMainProcess = require('./main-process/memory');
const { ScreenshotManager } = require('./main-process/screenshot');
const WorkflowManager = require('./main-process/workflow-manager');
const { createChatRequestId, withTimeout } = require('./src/chat-ipc-utils');
const { getBubbleWindowBoundsFromMain } = require('./src/bubble-window-utils');

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
let childWindows = new Map(); // 管理所有子窗口
let lastSmallBounds = null; // 记录小窗口位置，避免缩放漂移
let menuWindow = null;
let bubbleWindow = null;
let bubbleWindowReady = false;
let pendingBubblePayload = null;
const pendingChatRequests = new Map();

// 窗口尺寸常量
const WINDOW_SIZES = {
  small: { width: 150, height: 150 },  // 只显示宠物
  medium: { width: 300, height: 300 }   // 显示菜单时
};
const MENU_WINDOW_SIZE = { width: 340, height: 340 };
const BUBBLE_WINDOW_SIZE = { width: 260, height: 110 };
const DEFAULT_BUBBLE_OFFSET = { x: 0, y: 8 };
let currentPetAnimationState = 'idle';
let currentPetVisualState = null;
let bubbleOffsetByState = {
  idle: { ...DEFAULT_BUBBLE_OFFSET }
};
const DEFAULT_LLM_SCENE_CONFIG = {
  chat: { provider: 'deepseek', model: 'deepseek-chat' },
  vision: { provider: 'deepseek', model: 'deepseek-chat' },
  translate: { provider: 'deepseek', model: 'deepseek-chat' },
  ocr: { provider: 'tesseract', model: 'tesseract' }
};
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
    defaultModel: 'deepseek-chat'
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini'
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini'
  },
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct'
  },
  glm: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-flash'
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo'
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
    normalized[scene] = { provider, model };
  }
  return normalized;
}

function getSceneConfig(scene) {
  const fallback = DEFAULT_LLM_SCENE_CONFIG[scene] || DEFAULT_LLM_SCENE_CONFIG.chat;
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
  return {
    scene,
    provider,
    model,
    providerMeta
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

    const apiKey = getProviderApiKeyByProvider(config.provider);
    if (!apiKey) {
      attempted.push(`${sceneName}:${config.provider}(missing-key)`);
      continue;
    }

    return {
      ...config,
      apiKey,
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

    const apiKey = getProviderApiKeyByProvider(config.provider);
    if (!apiKey) {
      attempted.push(`${scene}:${config.provider}(missing-key)`);
      continue;
    }

    configs.push({
      ...config,
      apiKey,
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

function getApiKeysFilePath() {
  if (!apiKeysFilePath) {
    apiKeysFilePath = path.join(app.getPath('userData'), 'api-keys.json');
  }
  return apiKeysFilePath;
}

// 从 api-keys.json 读取所有已保存的 key
function readApiKeysFile() {
  try {
    const filePath = getApiKeysFilePath();
    const fsSync = require('fs');
    if (fsSync.existsSync(filePath)) {
      const data = fsSync.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[API Keys] 读取 api-keys.json 失败:', error.message);
  }
  return {};
}

// 保存单个 provider 的 key 到 api-keys.json
function saveProviderApiKey(provider, key) {
  const keys = readApiKeysFile();
  keys[provider] = key;
  const filePath = getApiKeysFilePath();
  const fsSync = require('fs');
  fsSync.writeFileSync(filePath, JSON.stringify(keys, null, 2), 'utf-8');
  console.log(`[API Keys] 已保存 ${provider} key (长度: ${key.length})`);
}

// 脱敏显示 key：前4+后4，中间用 **** 替换
function maskApiKey(key) {
  if (!key || key.length <= 8) return key ? '****' : '';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

function getProviderApiKeyByProvider(provider) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const envKey = PROVIDER_ENV_KEY_MAP[normalizedProvider];
  if (!envKey) return '';
  // 优先从 api-keys.json 读取
  const savedKeys = readApiKeysFile();
  if (savedKeys[normalizedProvider]) {
    return savedKeys[normalizedProvider];
  }
  // 降级到环境变量
  return process.env[envKey] || '';
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
    alwaysOnTop: true,
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
    menuWindow = null;
  });
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

function createBubbleWindow() {
  bubbleWindowReady = false;
  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WINDOW_SIZE.width,
    height: BUBBLE_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
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

function showBubbleWindow(message, duration) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    createBubbleWindow();
  }
  const bounds = getBubbleWindowBounds();
  bubbleWindow.setBounds(bounds, false);
  bubbleWindow.showInactive();
  if (!bubbleWindowReady || bubbleWindow.webContents.isLoading()) {
    pendingBubblePayload = { message, duration };
    return;
  }
  bubbleWindow.webContents.send('bubble:show', { message, duration });
}

function hideBubbleWindow() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  bubbleWindow.hide();
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
}

function closeMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed()) return;
  menuWindow.webContents.send('menu:command', { type: 'close' });
  menuWindow.hide();
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

  // 初始化记忆系统
  console.log('Initializing memory system...');
  memorySystem = new MemoryMainProcess({
    apiKey: process.env.DEEPSEEK_API_KEY || ''
  });
  // 先注册 IPC handlers，确保渲染进程的调用不会因初始化失败而无 handler
  memorySystem.registerIPCHandlers(ipcMain);
  // 设置主窗口引用（提醒通知需要）
  memorySystem.setMainWindow(mainWindow);
  try {
    await memorySystem.initialize();
    console.log('Memory system initialized successfully');
    // 启动后从 api-keys.json 读取已保存的 deepseek key，覆盖环境变量的值
    const savedDeepseekKey = readApiKeysFile()['deepseek'] || '';
    if (savedDeepseekKey && memorySystem) {
      memorySystem.updateApiKey(savedDeepseekKey);
      console.log('[API Keys] 启动时从 api-keys.json 加载 deepseek key');
    }
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
    // 注册截图 IPC 处理器
    registerScreenshotIPCHandlers(ipcMain);
    console.log('Screenshot system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize screenshot system:', error);
  }

  // 初始化工作流系统（Python 工具调用）
  console.log('Initializing workflow manager...');
  try {
    workflowManager = new WorkflowManager();
    workflowManager.initialize();
    console.log('Workflow manager initialized successfully');
  } catch (error) {
    console.error('Failed to initialize workflow manager:', error);
  }

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

  // 注册截图快捷键
  console.log('Registering screenshot shortcuts...');
  try {
    // Ctrl+Shift+A: 快速截图
    globalShortcut.register('CommandOrControl+Shift+A', () => {
      console.log('[Screenshot] Global shortcut triggered');
      startScreenshotCapture();
    });
    console.log('✅ 截图快捷键已注册');
    console.log('   Ctrl+Shift+A: 快速截图');
  } catch (error) {
    console.error('Failed to register screenshot shortcuts:', error);
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
  // 关闭记忆系统
  if (memorySystem) {
    memorySystem.close();
  }
  // 关闭工作流 Python 进程
  if (workflowManager) {
    workflowManager.shutdown();
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

  // 窗口关闭时从Map中移除
  childWindow.on('closed', () => {
    childWindows.delete(id);
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
ipcMain.handle('bubble:show', (event, message, duration) => {
  showBubbleWindow(message, duration);
  return { success: true };
});

ipcMain.handle('bubble:hide', () => {
  hideBubbleWindow();
  return { success: true };
});

// 聊天 IPC
ipcMain.handle('chat:send', async (event, message) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: '主窗口不可用' };
  }
  const requestId = createChatRequestId();
  const responsePromise = new Promise((resolve) => {
    pendingChatRequests.set(requestId, resolve);
  });
  mainWindow.webContents.send('chat:send', { requestId, message });
  return withTimeout(responsePromise, 30000, () => {
    pendingChatRequests.delete(requestId);
    return { success: false, error: '聊天超时' };
  });
});

ipcMain.on('chat:response', (event, requestId, payload) => {
  if (!pendingChatRequests.has(requestId)) return;
  const resolve = pendingChatRequests.get(requestId);
  pendingChatRequests.delete(requestId);
  resolve(payload);
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
  } else if (payload && payload.type === 'llm-scene-config') {
    llmSceneConfig = normalizeLLMSceneConfig(payload.config);
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

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 安全地获取 API 密钥（从环境变量）
ipcMain.handle('get-api-key', () => {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  console.log('[Main Process] get-api-key called:', apiKey ? `API Key found (${apiKey.length} chars)` : 'NO API KEY FOUND');
  return apiKey;
});

ipcMain.handle('get-provider-api-key', (event, provider) => {
  const apiKey = getProviderApiKeyByProvider(provider);
  console.log(`[API Keys] get-provider-api-key called for: ${provider}, found: ${apiKey ? apiKey.length + ' chars' : 'NO KEY'}`);
  return apiKey;
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
    // 如果修改的是 deepseek key，同步更新记忆系统的事实提取器
    if (normalizedProvider === 'deepseek' && memorySystem) {
      memorySystem.updateApiKey(trimmedKey);
    }
    return { success: true };
  } catch (error) {
    console.error('[API Keys] 保存失败:', error.message);
    return { success: false, error: error.message };
  }
});

// 获取所有 provider 的 key（脱敏显示）
ipcMain.handle('get-all-provider-keys', () => {
  const savedKeys = readApiKeysFile();
  const result = {};
  for (const provider of Object.keys(PROVIDER_ENV_KEY_MAP)) {
    const savedKey = savedKeys[provider] || '';
    const envKey = process.env[PROVIDER_ENV_KEY_MAP[provider]] || '';
    const actualKey = savedKey || envKey;
    result[provider] = {
      masked: maskApiKey(actualKey),
      configured: actualKey.length > 0,
      source: savedKey ? 'file' : (envKey ? 'env' : 'none')
    };
  }
  return result;
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

  // 隐藏主窗口和所有子窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.hide();
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.hide();
  }

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
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  screenshotCaptureWindow.loadFile('windows/screenshot-capture.html');

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
  showMainWindow();
}

// 显示主窗口
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
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
      showMainWindow();
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
      if (!screenshotSystem) {
        throw new Error('截图系统未初始化');
      }
      screenshotSystem.copyDataToClipboard(dataURL);
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
