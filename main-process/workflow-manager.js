// 工作流管理器
// 注册工具定义，调度执行，安全校验

const path = require('path');
const PythonBridge = require('./python-bridge');

// Python 解释器配置
const PYTHON_CONFIG = {
  preferredPython: 'D:\\kaifa\\Anaconda\\envs\\main310\\python.exe',
  fallbackPython: 'python'
};

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

    // 检测 Python 路径
    const fs = require('fs');
    let pythonPath = PYTHON_CONFIG.preferredPython;
    if (!fs.existsSync(pythonPath)) {
      console.warn(`[WorkflowManager] 优先 Python 路径不存在: ${pythonPath}，使用 fallback`);
      pythonPath = PYTHON_CONFIG.fallbackPython;
    }

    this._bridge = new PythonBridge(pythonPath, scriptPath);
    this._initialized = true;
    console.log('[WorkflowManager] 已初始化（Python 将在首次调用时启动）');
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
}

module.exports = WorkflowManager;
