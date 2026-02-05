// main-process/tools/registry.js
// CommonJS version - compatible with the project's module system

const crypto = require('crypto');
const Database = require('better-sqlite3');

/**
 * 工具注册表
 * 管理所有可用的工具，提供工具注册、查询、执行功能
 */
class ToolRegistry {
  constructor(dbPath = null) {
    this.tools = new Map(); // 工具存储 Map<toolName, toolDefinition>
    this.categories = new Map(); // 分类存储 Map<category, Set<toolName>>
    this.db = null;

    if (dbPath) {
      this.db = new Database(dbPath);
      this.initDatabase();
    }
  }

  /**
   * 初始化数据库表
   */
  initDatabase() {
    // 确保表存在（应该在 schema.sql 中创建）
    const tables = this.db.pragma('table_info(tool_executions)');
    if (tables.length === 0) {
      console.warn('⚠️  工具表未初始化，请运行数据库迁移');
    }
  }

  /**
   * 注册单个工具
   * @param {string} toolName - 工具名称
   * @param {object} toolDefinition - 工具定义
   */
  register(toolName, toolDefinition) {
    // 验证工具定义
    this.validateTool(toolName, toolDefinition);

    // 存储工具
    this.tools.set(toolName, {
      ...toolDefinition,
      name: toolDefinition.name || toolName,
      registeredAt: Date.now()
    });

    // 添加到分类
    const category = toolDefinition.category || 'default';
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category).add(toolName);

    console.log(`✅ 已注册工具: ${toolName} (${category})`);
  }

  /**
   * 批量注册工具（整个类别）
   * @param {string} category - 类别名称
   * @param {object} tools - 工具集合
   */
  registerCategory(category, tools) {
    for (const [toolName, definition] of Object.entries(tools)) {
      this.register(toolName, {
        ...definition,
        category
      });
    }
  }

  /**
   * 验证工具定义
   */
  validateTool(toolName, definition) {
    if (!toolName || typeof toolName !== 'string') {
      throw new Error(`工具名称无效: ${toolName}`);
    }

    if (!definition || typeof definition !== 'object') {
      throw new Error(`工具定义无效: ${toolName}`);
    }

    if (typeof definition.handler !== 'function') {
      throw new Error(`工具 ${toolName} 必须有 handler 函数`);
    }

    if (!definition.description) {
      console.warn(`⚠️  工具 ${toolName} 缺少描述`);
    }
  }

  /**
   * 获取工具定义
   * @param {string} toolName - 工具名称
   * @returns {object|null} 工具定义
   */
  getTool(toolName) {
    return this.tools.get(toolName) || null;
  }

  /**
   * 检查工具是否存在
   * @param {string} toolName - 工具名称
   * @returns {boolean}
   */
  hasTool(toolName) {
    return this.tools.has(toolName);
  }

  /**
   * 获取所有工具列表
   * @returns {Array} 工具列表
   */
  listTools() {
    const tools = [];
    for (const [name, definition] of this.tools.entries()) {
      tools.push({
        name,
        displayName: definition.name,
        description: definition.description,
        category: definition.category,
        requiresApproval: definition.requiresApproval || false,
        safe: definition.safe || false
      });
    }
    return tools;
  }

  /**
   * 按分类获取工具
   * @param {string} category - 类别名称
   * @returns {Array} 该分类下的工具列表
   */
  getToolsByCategory(category) {
    const toolNames = this.categories.get(category);
    if (!toolNames) return [];

    return Array.from(toolNames).map(name => ({
      name,
      ...this.tools.get(name)
    }));
  }

  /**
   * 获取所有分类
   * @returns {Array} 分类列表
   */
  getCategories() {
    return Array.from(this.categories.keys());
  }

  /**
   * 获取工具总数
   * @returns {number}
   */
  getToolCount() {
    return this.tools.size;
  }

  /**
   * 执行工具
   * @param {string} toolName - 工具名称
   * @param {object} params - 参数
   * @param {object} context - 执行上下文
   * @returns {Promise<object>} 执行结果
   */
  async execute(toolName, params = {}, context = {}) {
    // 检查工具是否存在
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`工具不存在: ${toolName}`);
    }

    const startTime = Date.now();
    let result = null;
    let error = null;
    let success = false;

    try {
      console.log(`🔧 执行工具: ${toolName}`, params);

      // 调用工具处理器
      result = await tool.handler(params, {
        ...context,
        toolName,
        registry: this
      });

      success = true;
      console.log(`✅ 工具执行成功: ${toolName}`);

    } catch (err) {
      error = err.message || String(err);
      success = false;
      console.error(`❌ 工具执行失败: ${toolName}`, error);

      // 记录错误到数据库
      if (this.db) {
        this.logExecution(toolName, params, context, {
          success: false,
          error,
          duration: Date.now() - startTime
        });
      }

      throw new Error(`工具执行失败: ${error}`);
    } finally {
      // 记录执行日志到数据库
      if (this.db && success) {
        this.logExecution(toolName, params, context, {
          success: true,
          result,
          duration: Date.now() - startTime
        });
      }
    }

    return result;
  }

  /**
   * 记录工具执行日志
   */
  logExecution(toolName, params, context, outcome) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO tool_executions (
          tool_name, tool_params, session_id, personality,
          approved, success, result, error_message,
          executed_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        toolName,
        JSON.stringify(params),
        context.sessionId || null,
        context.personality || null,
        outcome.approved ? 1 : 0,
        outcome.success ? 1 : 0,
        outcome.result ? JSON.stringify(outcome.result) : null,
        outcome.error || null,
        Math.floor(Date.now() / 1000),
        outcome.duration
      );
    } catch (err) {
      console.error('Failed to log tool execution:', err);
    }
  }

  /**
   * 获取工具执行历史
   * @param {object} options - 查询选项
   * @returns {Array} 执行历史
   */
  getExecutionHistory(options = {}) {
    if (!this.db) return [];

    const {
      limit = 50,
      toolName = null,
      sessionOnly = false
    } = options;

    let query = 'SELECT * FROM tool_executions';
    const params = [];

    if (toolName) {
      query += ' WHERE tool_name = ?';
      params.push(toolName);
    }

    query += ' ORDER BY executed_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map(row => ({
      ...row,
      approved: Boolean(row.approved),
      success: Boolean(row.success),
      tool_params: JSON.parse(row.tool_params || '{}'),
      result: row.result ? JSON.parse(row.result) : null
    }));
  }

  /**
   * 清空执行历史
   */
  clearHistory() {
    if (!this.db) return;

    const stmt = this.db.prepare('DELETE FROM tool_executions');
    stmt.run();
    console.log('🗑️  工具执行历史已清空');
  }

  /**
   * 打印工具注册表摘要
   */
  printSummary() {
    console.log('\n📊 工具注册表摘要:');
    console.log(`   总工具数: ${this.getToolCount()}`);
    console.log(`   总分类数: ${this.getCategories().length}`);

    for (const category of this.getCategories()) {
      const tools = this.getToolsByCategory(category);
      console.log(`\n   📁 ${category}:`);
      for (const tool of tools) {
        const safe = tool.safe ? '✅' : '⚠️';
        const approval = tool.requiresApproval ? '🔒' : '🔓';
        console.log(`      ${safe} ${approval} ${tool.name}`);
      }
    }
    console.log('');
  }
}

/**
 * 创建默认工具注册表
 */
function createToolRegistry(dbPath = null) {
  const registry = new ToolRegistry(dbPath);

  // 打印摘要
  setTimeout(() => registry.printSummary(), 100);

  return registry;
}

module.exports = {
  ToolRegistry,
  createToolRegistry
};
