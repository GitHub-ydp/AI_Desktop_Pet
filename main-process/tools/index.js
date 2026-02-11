// main-process/tools/index.js
// CommonJS version - Tool system entry point

const { ToolRegistry, createToolRegistry } = require('./registry.js');
const { systemTools } = require('./tools/system.js');
const { screenshotTools } = require('./tools/screenshot.js');
const { getDatabasePath, TOOL_CONFIG } = require('./config.js');
const Database = require('better-sqlite3');

/**
 * 工具系统类
 * 管理整个工具系统的初始化和运行
 */
class ToolSystem {
  constructor() {
    this.registry = null;
    this.db = null;
    this.initialized = false;
  }

  /**
   * 初始化工具系统
   */
  async initialize() {
    if (this.initialized) {
      console.log('⚠️  工具系统已经初始化');
      return this.registry;
    }

    try {
      console.log('🔧 初始化工具系统...');

      // 获取数据库路径
      const dbPath = getDatabasePath();

      // 打开数据库连接
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');

      // 创建工具注册表
      this.registry = createToolRegistry(dbPath);

      // 注册内置工具
      this.registerBuiltinTools();

      // 打印摘要
      this.registry.printSummary();

      this.initialized = true;
      console.log('✅ 工具系统初始化完成\n');

      return this.registry;

    } catch (error) {
      console.error('❌ 工具系统初始化失败:', error);
      throw error;
    }
  }

  /**
   * 注册内置工具
   */
  registerBuiltinTools() {
    console.log('📦 注册内置工具...');

    // 注册系统工具
    this.registry.registerCategory('system', systemTools);

    // 注册截图工具
    this.registry.registerCategory('screenshot', screenshotTools);

    console.log('✅ 内置工具注册完成');
  }

  /**
   * 获取工具注册表
   */
  getRegistry() {
    if (!this.initialized) {
      throw new Error('工具系统未初始化');
    }
    return this.registry;
  }

  /**
   * 执行工具
   */
  async execute(toolName, params, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    return await this.registry.execute(toolName, params, context);
  }

  /**
   * 获取工具列表
   */
  listTools() {
    if (!this.initialized) {
      return [];
    }
    return this.registry.listTools();
  }

  /**
   * 获取工具执行历史
   */
  getHistory(options = {}) {
    if (!this.initialized) {
      return [];
    }
    return this.registry.getExecutionHistory(options);
  }

  /**
   * 清空历史
   */
  clearHistory() {
    if (!this.initialized) {
      return;
    }
    this.registry.clearHistory();
  }

  /**
   * 关闭工具系统
   */
  shutdown() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    console.log('🔧 工具系统已关闭');
  }
}

// 创建全局工具系统实例
const toolSystem = new ToolSystem();

/**
 * 初始化工具系统（导出函数）
 */
async function initializeTools() {
  return await toolSystem.initialize();
}

/**
 * 获取工具注册表
 */
function getToolRegistry() {
  return toolSystem.getRegistry();
}

/**
 * 获取工具系统实例
 */
function getToolSystem() {
  return toolSystem;
}

/**
 * 执行工具
 */
async function executeTool(toolName, params, context) {
  return await toolSystem.execute(toolName, params, context);
}

/**
 * 列出工具
 */
function listTools() {
  return toolSystem.listTools();
}

/**
 * 获取历史
 */
function getToolHistory(options) {
  return toolSystem.getHistory(options);
}

/**
 * 清空历史
 */
function clearToolHistory() {
  return toolSystem.clearHistory();
}

// 导出所有内容
module.exports = {
  ToolSystem,
  ToolRegistry,
  TOOL_CONFIG,
  systemTools,
  screenshotTools,
  initializeTools,
  getToolRegistry,
  getToolSystem,
  executeTool,
  listTools,
  getToolHistory,
  clearToolHistory
};
