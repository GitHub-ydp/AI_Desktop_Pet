// 工作流管理器
// 注册工具定义，调度执行，安全校验

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const PythonBridge = require('./python-bridge');

// Python 解释器配置
const PYTHON_CONFIG = {
  fallbackPython: ''
};

const PYTHON_DETECTION_CHAIN = [
  { type: 'config', label: 'userData/config.json pythonPath' },
  { type: 'command', label: 'py -3', command: 'py', args: ['-3'] },
  { type: 'command', label: 'python3', command: 'python3', args: [] },
  { type: 'command', label: 'python', command: 'python', args: [] },
  { type: 'path', label: '%USERPROFILE%\\miniconda3\\python.exe', buildPath: () => path.join(process.env.USERPROFILE || os.homedir(), 'miniconda3', 'python.exe') },
  { type: 'path', label: '%USERPROFILE%\\anaconda3\\python.exe', buildPath: () => path.join(process.env.USERPROFILE || os.homedir(), 'anaconda3', 'python.exe') }
];

const MAX_READ_SIZE = 1 * 1024 * 1024;
const MAX_LIST_COUNT = 1000;
const MAX_RECURSIVE_DEPTH = 5;

const NODE_NATIVE_TOOL_NAMES = new Set([
  'file_ops_list_files',
  'file_ops_search_files',
  'system_ops_open_app',
  'system_ops_open_url',
  'system_ops_set_clipboard'
]);

const APP_WHITELIST = {
  notepad: 'notepad.exe',
  code: 'code',
  explorer: 'explorer.exe',
  chrome: 'chrome',
  edge: 'msedge',
  firefox: 'firefox',
  calc: 'calc.exe'
};

let cachedPythonDetection = null;

// 安全限制：禁止访问的路径关键词
const BLOCKED_PATH_KEYWORDS = [
  'Windows', 'System32', 'Program Files', 'ProgramData',
  'system32', 'syswow64'
];

class WorkflowManager {
  constructor() {
    this._bridge = null;
    this._initialized = false;
    this._toolDefinitions = this._buildToolDefinitions();
  }

  // 初始化（不启动 Python，懒启动）
  initialize() {
    const scriptPath = path.join(__dirname, '..', 'python-tools', 'executor.py');

    const pythonSpec = getConfiguredPythonPath();
    if (!pythonSpec) {
      console.error('[WorkflowManager] 所有路径均不可用');
    }

    this._bridge = new PythonBridge(pythonSpec || '', scriptPath);
    this._initialized = true;
    console.log(`[WorkflowManager] 已初始化（Python 将在首次调用时启动）: ${formatPythonSpecForLog(pythonSpec)}`);
  }

  // 执行工具
  async execute(toolName, args) {
    if (!this._initialized) {
      return { success: false, error: '工作流系统未初始化' };
    }

    const startTime = Date.now();

    // 检查工具是否存在
    const toolDef = this._toolDefinitions.find(t => t.function.name === toolName);
    if (!toolDef) {
      return { success: false, error: `未知工具: ${toolName}` };
    }

    // 安全校验
    const safetyCheck = this._validateSafety(toolName, args);
    if (!safetyCheck.safe) {
      return { success: false, error: safetyCheck.reason };
    }

    if (NODE_NATIVE_TOOL_NAMES.has(toolName)) {
      try {
        const result = await this._executeNodeNativeTool(toolName, args);
        return {
          success: true,
          result,
          duration: Date.now() - startTime
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          duration: Date.now() - startTime
        };
      }
    }

    // 将 API 格式的工具名转换为 Python 格式
    // 例如: file_ops_list_files -> file_ops.list_files
    const pythonToolName = this._convertToPythonFormat(toolName);

    // 生成请求 ID
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const response = await this._bridge.execute(pythonToolName, args, requestId);
      const duration = Date.now() - startTime;

      if (response.success) {
        return {
          success: true,
          result: response.result,
          duration
        };
      } else {
        return {
          success: false,
          error: response.error?.message || '工具执行失败',
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error.message,
        duration
      };
    }
  }

  // 获取 DeepSeek function calling 格式的工具定义
  getToolDefinitions() {
    return this._toolDefinitions.map(t => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    }));
  }

  // 中止请求
  abort(requestId) {
    if (this._bridge) {
      return this._bridge.abort(requestId);
    }
    return false;
  }

  // 关闭
  shutdown() {
    if (this._bridge) {
      this._bridge.shutdown();
    }
  }

  // ==================== 内部方法 ====================

  // 安全校验
  _validateSafety(toolName, args) {
    // 检查路径参数
    const pathArgs = ['path', 'source', 'destination', 'src', 'dst'];
    for (const key of pathArgs) {
      if (args && args[key]) {
        const p = String(args[key]);

        // 禁止路径穿越
        if (p.includes('..')) {
          return { safe: false, reason: `路径不允许包含 "..": ${p}` };
        }

        // 禁止系统目录
        for (const keyword of BLOCKED_PATH_KEYWORDS) {
          if (p.includes(keyword)) {
            return { safe: false, reason: `禁止访问系统目录: ${p}` };
          }
        }
      }
    }

    return { safe: true };
  }

  // 将 API 格式的工具名转换为 Python 格式
  // 例如: file_ops_list_files -> file_ops.list_files
  // 例如: system_ops_open_app -> system_ops.open_app
  _convertToPythonFormat(toolName) {
    // 模块名格式为 xxx_ops，找到 _ops_ 并替换为 _ops.
    if (toolName.includes('_ops_')) {
      return toolName.replace('_ops_', '_ops.');
    }
    // 如果格式不匹配，原样返回
    return toolName;
  }

  // 构建 12 个 MVP 工具定义
  // 注意：工具名称必须符合 ^[a-zA-Z0-9_-]+$ 模式（不能有点号）
  _buildToolDefinitions() {
    return [
      {
        function: {
          name: 'file_ops_list_files',
          description: '列出指定目录下的文件，支持通配符过滤',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '目录路径，如 "~/Desktop" 或绝对路径'
              },
              filter: {
                type: 'string',
                description: '文件名过滤器，如 "*.jpg"、"*.txt"',
                default: '*'
              },
              recursive: {
                type: 'boolean',
                description: '是否递归子目录',
                default: false
              }
            },
            required: ['path']
          }
        }
      },
      {
        function: {
          name: 'file_ops_read_file',
          description: '读取文本文件内容（最大 1MB，自动检测编码）',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '文件路径'
              }
            },
            required: ['path']
          }
        }
      },
      {
        function: {
          name: 'file_ops_write_file',
          description: '写入或创建文本文件',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '文件路径'
              },
              content: {
                type: 'string',
                description: '要写入的文本内容'
              },
              create_dirs: {
                type: 'boolean',
                description: '是否自动创建父目录',
                default: true
              }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        function: {
          name: 'file_ops_move_file',
          description: '移动或重命名文件',
          parameters: {
            type: 'object',
            properties: {
              src: {
                type: 'string',
                description: '源文件路径'
              },
              dst: {
                type: 'string',
                description: '目标路径'
              }
            },
            required: ['src', 'dst']
          }
        }
      },
      {
        function: {
          name: 'file_ops_copy_file',
          description: '复制文件',
          parameters: {
            type: 'object',
            properties: {
              src: {
                type: 'string',
                description: '源文件路径'
              },
              dst: {
                type: 'string',
                description: '目标路径'
              }
            },
            required: ['src', 'dst']
          }
        }
      },
      {
        function: {
          name: 'file_ops_delete_file',
          description: '删除文件（移到回收站）',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '要删除的文件路径'
              }
            },
            required: ['path']
          }
        }
      },
      {
        function: {
          name: 'file_ops_get_file_info',
          description: '获取文件详细信息（大小、修改时间、类型等）',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '文件路径'
              }
            },
            required: ['path']
          }
        }
      },
      {
        function: {
          name: 'file_ops_search_files',
          description: '按名称或内容搜索文件',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '搜索目录路径'
              },
              pattern: {
                type: 'string',
                description: '文件名通配符模式，如 "*.txt"'
              },
              content_search: {
                type: 'string',
                description: '文件内容搜索关键词（可选）'
              },
              recursive: {
                type: 'boolean',
                description: '是否递归搜索',
                default: true
              }
            },
            required: ['path', 'pattern']
          }
        }
      },
      {
        function: {
          name: 'system_ops_open_app',
          description: '打开应用程序（仅限常见应用）',
          parameters: {
            type: 'object',
            properties: {
              app_name: {
                type: 'string',
                description: '应用名称，如 "notepad"、"code"、"chrome"、"edge"、"explorer"'
              }
            },
            required: ['app_name']
          }
        }
      },
      {
        function: {
          name: 'system_ops_open_url',
          description: '在默认浏览器中打开 URL',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: '要打开的 URL（必须是 https://）'
              }
            },
            required: ['url']
          }
        }
      },
      {
        function: {
          name: 'system_ops_get_system_info',
          description: '获取系统信息（操作系统、CPU、内存、磁盘等）',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        function: {
          name: 'system_ops_set_clipboard',
          description: '将文本内容设置到系统剪贴板',
          parameters: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: '要复制到剪贴板的文本'
              }
            },
            required: ['text']
          }
        }
      }
    ];
  }

  async _executeNodeNativeTool(toolName, args = {}) {
    switch (toolName) {
      case 'file_ops_list_files':
        return listFilesNode(args);
      case 'file_ops_search_files':
        return searchFilesNode(args);
      case 'system_ops_open_app':
        return openAppNode(args);
      case 'system_ops_open_url':
        return openUrlNode(args);
      case 'system_ops_set_clipboard':
        return setClipboardNode(args);
      default:
        throw new Error(`不支持的 Node 原生工具: ${toolName}`);
    }
  }
}

function getConfiguredPythonPath() {
  const detection = detectPythonInterpreter();
  return detection.spec || PYTHON_CONFIG.fallbackPython;
}

function readConfiguredPythonPath() {
  try {
    const electron = require('electron');
    if (electron && electron.app) {
      const configPath = path.join(electron.app.getPath('userData'), 'config.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.pythonPath === 'string' && parsed.pythonPath.trim()) {
          return parsed.pythonPath.trim();
        }
      }
    }
  } catch (error) {
    console.warn('[WorkflowManager] Failed to read config.json:', error.message);
  }
  return '';
}

function detectPythonInterpreter() {
  if (cachedPythonDetection) {
    return cachedPythonDetection;
  }

  const attempts = [];
  let spec = null;

  for (const candidate of PYTHON_DETECTION_CHAIN) {
    const resolved = resolvePythonCandidate(candidate);
    if (!resolved) {
      attempts.push({ label: candidate.label, ok: false, reason: 'empty' });
      continue;
    }

    const usable = isUsablePythonInterpreter(resolved);
    attempts.push({
      label: candidate.label,
      ok: usable,
      resolved: formatPythonSpecForLog(resolved)
    });

    if (usable) {
      spec = resolved;
      console.log(`[WorkflowManager] Python 探测命中: ${candidate.label} -> ${formatPythonSpecForLog(resolved)}`);
      break;
    }
  }

  if (!spec) {
    console.error('[WorkflowManager] 所有路径均不可用');
  }

  cachedPythonDetection = { spec, attempts };
  return cachedPythonDetection;
}

function resolvePythonCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if (candidate.type === 'config') {
    const configuredPath = readConfiguredPythonPath();
    return configuredPath ? configuredPath : null;
  }

  if (candidate.type === 'command') {
    return {
      command: candidate.command,
      args: Array.isArray(candidate.args) ? candidate.args : []
    };
  }

  if (candidate.type === 'path' && typeof candidate.buildPath === 'function') {
    const resolvedPath = candidate.buildPath();
    return resolvedPath ? resolvedPath : null;
  }

  return null;
}

function isUsablePythonInterpreter(candidate) {
  if (!candidate) {
    return false;
  }

  const spec = normalizePythonSpec(candidate);
  const command = spec.command;
  if (!command) {
    return false;
  }

  if (looksLikePath(command) && !fs.existsSync(command)) {
    return false;
  }

  try {
    const probe = spawnSync(command, [...spec.args, '-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true
    });

    if (probe.status !== 0) {
      return false;
    }

    const resolvedExecutable = String(probe.stdout || '').trim();
    if (!resolvedExecutable) {
      return false;
    }

    if (process.platform === 'win32' && resolvedExecutable.includes('WindowsApps')) {
      return false;
    }

    return true;
  } catch (error) {
    console.warn(`[WorkflowManager] Python 探测失败 (${command}): ${error.message}`);
    return false;
  }
}

function looksLikePath(candidate) {
  return /[\\/]/.test(candidate) || /^[A-Za-z]:/.test(candidate) || candidate.startsWith('.');
}

function normalizePythonSpec(candidate) {
  if (candidate && typeof candidate === 'object') {
    return {
      command: String(candidate.command || '').trim(),
      args: Array.isArray(candidate.args) ? candidate.args.map((arg) => String(arg)) : []
    };
  }

  return {
    command: String(candidate || '').trim(),
    args: []
  };
}

function formatPythonSpecForLog(candidate) {
  if (!candidate) return 'unavailable';
  const spec = normalizePythonSpec(candidate);
  return [spec.command, ...spec.args].filter(Boolean).join(' ');
}

function validateFileToolPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('路径不能为空');
  }

  const resolvedPath = path.resolve(inputPath.replace(/^~(?=$|[\\/])/, os.homedir()));
  const normalizedLower = resolvedPath.toLowerCase();

  for (const keyword of BLOCKED_PATH_KEYWORDS) {
    if (normalizedLower.includes(String(keyword).toLowerCase())) {
      throw new Error(`禁止访问系统目录: ${resolvedPath}`);
    }
  }

  return resolvedPath;
}

function wildcardToRegExp(pattern) {
  const escaped = String(pattern || '*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function fileInfo(fullPath, rootPath = null) {
  const stat = fs.statSync(fullPath);
  return {
    name: path.basename(fullPath),
    path: fullPath,
    relative_path: rootPath ? path.relative(rootPath, fullPath) : path.basename(fullPath),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    is_dir: stat.isDirectory()
  };
}

function listFilesNode(args = {}) {
  const targetPath = validateFileToolPath(args.path);
  const filterPattern = wildcardToRegExp(args.filter || '*');
  const recursive = !!args.recursive;

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    throw new Error(`目录不存在: ${targetPath}`);
  }

  const files = [];
  const queue = [{ dir: targetPath, depth: 0 }];

  while (queue.length > 0 && files.length < MAX_LIST_COUNT) {
    const current = queue.shift();
    const entries = fs.readdirSync(current.dir, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= MAX_LIST_COUNT) break;
      const fullPath = path.join(current.dir, entry.name);

      if (filterPattern.test(entry.name)) {
        files.push(fileInfo(fullPath, targetPath));
      }

      if (recursive && entry.isDirectory() && current.depth < MAX_RECURSIVE_DEPTH) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return { files, total: files.length };
}

function searchFilesNode(args = {}) {
  const targetPath = validateFileToolPath(args.path);
  const filterPattern = wildcardToRegExp(args.pattern || '*');
  const recursive = args.recursive !== false;
  const contentSearch = typeof args.content_search === 'string' ? args.content_search.trim().toLowerCase() : '';

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    throw new Error(`目录不存在: ${targetPath}`);
  }

  const files = [];
  const queue = [{ dir: targetPath, depth: 0 }];

  while (queue.length > 0 && files.length < MAX_LIST_COUNT) {
    const current = queue.shift();
    const entries = fs.readdirSync(current.dir, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= MAX_LIST_COUNT) break;
      const fullPath = path.join(current.dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive && current.depth < MAX_RECURSIVE_DEPTH) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!filterPattern.test(entry.name)) {
        continue;
      }

      if (contentSearch) {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_READ_SIZE) {
          continue;
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        if (!content.toLowerCase().includes(contentSearch)) {
          continue;
        }
      }

      files.push(fileInfo(fullPath, targetPath));
    }
  }

  return { files, total: files.length };
}

async function openUrlNode(args = {}) {
  const { shell } = require('electron');
  const rawUrl = String(args.url || '').trim();
  if (!rawUrl) {
    throw new Error('URL 不能为空');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`无效的 URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`只允许 HTTPS 协议，当前: ${parsed.protocol || '无协议'}`);
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    throw new Error(`禁止访问内网地址: ${hostname || rawUrl}`);
  }
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
    throw new Error(`禁止访问内网地址: ${hostname}`);
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) {
    throw new Error(`禁止访问内网地址: ${hostname}`);
  }

  await shell.openExternal(parsed.toString());
  return { url: parsed.toString() };
}

function openAppNode(args = {}) {
  const appName = String(args.app_name || '').trim().toLowerCase();
  if (!appName) {
    throw new Error('应用名称不能为空');
  }

  const command = APP_WHITELIST[appName];
  if (!command) {
    throw new Error(`应用 "${appName}" 不在白名单中，允许的应用: ${Object.keys(APP_WHITELIST).sort().join(', ')}`);
  }

  try {
    const proc = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', command], {
          detached: true,
          shell: false,
          stdio: 'ignore',
          windowsHide: true
        })
      : spawn(command, [], {
          detached: true,
          stdio: 'ignore'
        });

    proc.unref();
    return { app_name: appName, pid: proc.pid };
  } catch (error) {
    throw new Error(`启动应用失败: ${error.message}`);
  }
}

function setClipboardNode(args = {}) {
  const { clipboard } = require('electron');
  if (args.text == null) {
    throw new Error('文本内容不能为空');
  }

  const text = String(args.text);
  clipboard.writeText(text);
  return { length: text.length };
}

WorkflowManager.isUsablePythonInterpreter = isUsablePythonInterpreter;
WorkflowManager.getConfiguredPythonPath = getConfiguredPythonPath;
WorkflowManager.resetPythonDetectionCache = () => {
  cachedPythonDetection = null;
};

module.exports = WorkflowManager;
