// main-process/tools/config.js
// CommonJS version - compatible with the project's module system

const path = require('path');
const { app } = require('electron');

/**
 * 工具系统配置
 */
const TOOL_CONFIG = {
  // 安全级别：deny | allowlist | full
  securityLevel: 'allowlist',

  // 批准模式：off | on-miss | always
  askMode: 'on-miss',

  // 执行超时（毫秒）
  timeout: 30000,

  // 输出大小限制（字符数）
  maxOutputSize: 100000,

  // 最大返回结果大小（字节）
  maxResultSize: 500000,

  // 允许的工具类别
  allowedCategories: [
    'system',      // 系统工具（总是允许）
    'file.read',   // 文件读取
    'file.write',  // 文件写入（需批准）
    'app.launch',  // 启动应用
    'network'      // 网络工具
  ],

  // 危险命令黑名单（防止执行危险操作）
  blockedCommands: [
    'rm -rf',
    'format',
    'del /f',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'mkfs',
    'dd if=/dev/zero',
    'mv /dev/null'
  ],

  // 安全的环境变量（只允许读取这些）
  safeEnvVars: [
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'TEMP',
    'TMP',
    'USER',
    'USERNAME',
    'SHELL',
    'LANG',
    'NODE_ENV',
    'USERDOMAIN',
    'COMPUTERNAME'
  ],

  // 文件访问限制
  fileAccess: {
    // 允许访问的目录（相对路径或 ~ 开头会自动展开）
    allowedDirs: [
      'home',
      'documents',
      'desktop',
      'downloads',
      'pictures',
      'music',
      'videos'
    ],

    // 禁止访问的目录
    blockedDirs: [
      'Windows/System32',
      'Windows/SysWOW64',
      'Program Files',
      'Program Files (x86)',
      'ProgramData',
      '/System',
      '/bin',
      '/sbin',
      '/etc',
      '/usr/bin',
      '/usr/sbin'
    ],

    // 最大读取文件大小（字节）
    maxReadSize: 1024000, // 1MB

    // 最大写入文件大小（字节）
    maxWriteSize: 10240000 // 10MB
  },

  // 网络工具限制
  network: {
    // 允许的 URL 模式
    allowedUrlPatterns: [
      'https://api.github.com/*',
      'https://api.weather.gov/*',
      'https://*.githubusercontent.com/*'
    ],

    // 请求超时（毫秒）
    requestTimeout: 10000,

    // 最大响应大小（字节）
    maxResponseSize: 5242880 // 5MB
  },

  // 应用工具限制
  applications: {
    // 允许启动的应用（白名单）
    allowedApps: [
      'notepad',
      'notepad++',
      'code',
      'vscode',
      'chrome',
      'firefox',
      'edge',
      'safari',
      'explorer',
      'finder'
    ],

    // 需要额外批准的应用
    requireApprovalApps: [
      'powershell',
      'cmd',
      'terminal',
      'bash',
      'sh'
    ]
  },

  // 日志配置
  logging: {
    // 是否记录所有工具调用
    logAllCalls: true,

    // 是否记录工具参数
    logParams: true,

    // 是否记录工具返回结果
    logResults: true,

    // 日志保留天数
    retentionDays: 30
  },

  // 学习配置
  learning: {
    // 自动批准阈值（相同工具+参数被批准N次后自动批准）
    autoApproveThreshold: 3,

    // 白名单学习阈值（被批准N次后加入白名单）
    whitelistThreshold: 5,

    // 是否启用学习功能
    enabled: true
  }
};

/**
 * 获取数据库路径
 */
function getDatabasePath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'pet-memory.db');
}

/**
 * 获取工具配置路径
 */
function getConfigPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'tools-config.json');
}

/**
 * 合并用户配置
 */
function mergeConfig(userConfig = {}) {
  return {
    ...TOOL_CONFIG,
    ...userConfig,
    fileAccess: {
      ...TOOL_CONFIG.fileAccess,
      ...(userConfig.fileAccess || {})
    },
    network: {
      ...TOOL_CONFIG.network,
      ...(userConfig.network || {})
    },
    applications: {
      ...TOOL_CONFIG.applications,
      ...(userConfig.applications || {})
    },
    learning: {
      ...TOOL_CONFIG.learning,
      ...(userConfig.learning || {})
    }
  };
}

/**
 * 验证配置
 */
function validateConfig(config) {
  const errors = [];

  // 验证安全级别
  if (!['deny', 'allowlist', 'full'].includes(config.securityLevel)) {
    errors.push(`无效的安全级别: ${config.securityLevel}`);
  }

  // 验证批准模式
  if (!['off', 'on-miss', 'always'].includes(config.askMode)) {
    errors.push(`无效的批准模式: ${config.askMode}`);
  }

  // 验证超时设置
  if (config.timeout < 1000 || config.timeout > 300000) {
    errors.push(`超时设置必须在 1000-300000 毫秒之间`);
  }

  if (errors.length > 0) {
    throw new Error('配置验证失败:\n' + errors.join('\n'));
  }

  return true;
}

module.exports = {
  TOOL_CONFIG,
  getDatabasePath,
  getConfigPath,
  mergeConfig,
  validateConfig
};
