// main-process/tools/tools/system.js
// CommonJS version - System tools

const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * 系统工具集合
 * 提供系统信息查询、URL打开等功能
 */
const systemTools = {
  /**
   * 获取系统信息
   */
  'system.info': {
    name: '获取系统信息',
    description: '获取操作系统、CPU、内存等系统信息',
    category: 'system',
    parameters: {
      type: 'object',
      properties: {
        info_type: {
          type: 'string',
          enum: ['os', 'cpu', 'memory', 'all'],
          description: '要查询的信息类型'
        }
      }
    },
    handler: async (params) => {
      const infoType = params.info_type || 'all';
      const result = {};

      // 操作系统信息
      if (infoType === 'os' || infoType === 'all') {
        result.os = {
          platform: os.platform(),
          type: os.type(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname(),
          homedir: os.homedir(),
          tmpdir: os.tmpdir()
        };
      }

      // CPU 信息
      if (infoType === 'cpu' || infoType === 'all') {
        const cpus = os.cpus();
        result.cpu = {
          model: cpus[0]?.model || 'Unknown',
          cores: cpus.length,
          speed: cpus[0]?.speed || 0,
          architecture: os.arch()
        };
      }

      // 内存信息
      if (infoType === 'memory' || infoType === 'all') {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        result.memory = {
          total: formatBytes(totalMem),
          free: formatBytes(freeMem),
          used: formatBytes(usedMem),
          usage_percent: Math.round((usedMem / totalMem) * 100)
        };
      }

      return result;
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * 打开 URL
   */
  'system.open_url': {
    name: '打开 URL',
    description: '在默认浏览器中打开指定的 URL',
    category: 'system',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要打开的 URL（必须以 http:// 或 https:// 开头）'
        }
      },
      required: ['url']
    },
    handler: async (params, context) => {
      const { shell } = require('electron');
      const url = params.url;

      // 验证 URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('URL 必须以 http:// 或 https:// 开头');
      }

      await shell.openExternal(url);

      return {
        success: true,
        url,
        message: `已在浏览器中打开: ${url}`
      };
    },
    requiresApproval: true,
    safe: true
  },

  /**
   * 获取环境变量
   */
  'system.get_env': {
    name: '获取环境变量',
    description: '获取系统环境变量（仅限安全的变量）',
    category: 'system',
    parameters: {
      type: 'object',
      properties: {
        var_name: {
          type: 'string',
          description: '环境变量名称（留空则返回所有安全变量）'
        }
      }
    },
    handler: async (params) => {
      // 安全的环境变量白名单
      const safeVars = new Set([
        'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP',
        'USER', 'USERNAME', 'SHELL', 'LANG', 'NODE_ENV'
      ]);

      if (params.var_name) {
        // 获取单个变量
        if (!safeVars.has(params.var_name)) {
          throw new Error(`不允许访问环境变量: ${params.var_name}`);
        }
        return {
          [params.var_name]: process.env[params.var_name] || null
        };
      }

      // 获取所有安全变量
      const result = {};
      for (const key of safeVars) {
        if (process.env[key]) {
          result[key] = process.env[key];
        }
      }

      return result;
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * 获取系统运行时间
   */
  'system.uptime': {
    name: '系统运行时间',
    description: '获取系统已运行的时间',
    category: 'system',
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async (params) => {
      const uptimeSeconds = os.uptime();
      const uptime = formatUptime(uptimeSeconds);

      return {
        uptime_seconds: uptimeSeconds,
        uptime,
        timestamp: Date.now()
      };
    },
    requiresApproval: false,
    safe: true
  },

  /**
   * 获取网络接口信息
   */
  'system.network_info': {
    name: '获取网络信息',
    description: '获取网络接口和 IP 地址信息',
    category: 'system',
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async (params) => {
      const networkInterfaces = os.networkInterfaces();
      const result = {
        interfaces: [],
        public_ip: null
      };

      // 遍历网络接口
      for (const [name, addresses] of Object.entries(networkInterfaces)) {
        for (const addr of addresses) {
          // 只返回 IPv4 非内部地址
          if (addr.family === 'IPv4' && !addr.internal) {
            result.interfaces.push({
              name,
              address: addr.address,
              netmask: addr.netmask,
              mac: addr.mac
            });
          }
        }
      }

      // 尝试获取公网 IP（可选，可能失败）
      try {
        // 这里可以添加获取公网 IP 的逻辑
        // 暂时跳过，避免网络请求
      } catch (err) {
        // 忽略公网 IP 获取失败
      }

      return result;
    },
    requiresApproval: false,
    safe: true
  }
};

/**
 * 格式化字节数
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`);

  return parts.join(' ');
}

module.exports = {
  systemTools
};
