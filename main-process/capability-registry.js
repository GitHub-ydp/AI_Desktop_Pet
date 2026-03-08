function summarizeData(data) {
  if (typeof data === 'string') {
    return data.slice(0, 300);
  }
  if (Array.isArray(data)) {
    return `Returned ${data.length} item(s)`;
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    return keys.length > 0 ? `Returned fields: ${keys.slice(0, 6).join(', ')}` : 'Completed';
  }
  if (data == null) {
    return 'Completed';
  }
  return String(data);
}

function normalizeToolResult(result, source, actualName) {
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
    return result;
  }

  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success')) {
    const ok = !!result.success;
    const data = Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
    return {
      ok,
      summary: ok
        ? summarizeData(data)
        : (result.error || `Tool ${actualName} failed`),
      data,
      artifacts: [],
      needsApproval: false,
      reversible: false,
      audit: {
        source,
        toolName: actualName,
        durationMs: result.duration || null,
        error: result.error || null
      }
    };
  }

  return {
    ok: true,
    summary: summarizeData(result),
    data: result,
    artifacts: [],
    needsApproval: false,
    reversible: false,
    audit: {
      source,
      toolName: actualName,
      durationMs: null,
      error: null
    }
  };
}

function sanitizeToolName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

class CapabilityRegistry {
  constructor(options = {}) {
    this.skillRegistry = options.skillRegistry || null;
    this.skillExecutor = options.skillExecutor || null;
    this.workflowManager = options.workflowManager || null;
    this.toolSystem = options.toolSystem || null;
    this.aliasToActual = new Map();
    this.toolMetadata = new Map();
    this.toolDefinitions = [];
    this.refresh();
  }

  refresh() {
    this.aliasToActual.clear();
    this.toolMetadata.clear();
    this.toolDefinitions = [];

    const seen = new Set();

    if (this.skillRegistry) {
      for (const tool of this.skillRegistry.buildToolsArray()) {
        const name = tool.function.name;
        if (seen.has(name)) continue;
        seen.add(name);
        this.aliasToActual.set(name, name);
        this.toolMetadata.set(name, {
          requiresApproval: this.skillRegistry.requiresConfirmation(name) || this.skillRegistry.isDangerous(name),
          safe: false,
          source: 'skill'
        });
        this.toolDefinitions.push(tool);
      }
    }

    if (this.workflowManager) {
      for (const tool of this.workflowManager.getToolDefinitions()) {
        const name = tool.function.name;
        if (seen.has(name)) continue;
        seen.add(name);
        this.aliasToActual.set(name, name);
        this.toolMetadata.set(name, {
          requiresApproval: this._looksMutating(name),
          safe: !this._looksMutating(name),
          source: 'workflow'
        });
        this.toolDefinitions.push(tool);
      }
    }

    const registry = this._getToolRegistry();
    if (registry && registry.tools && registry.tools.entries) {
      for (const [actualName, def] of registry.tools.entries()) {
        const alias = sanitizeToolName(actualName);
        if (seen.has(alias)) continue;
        seen.add(alias);
        this.aliasToActual.set(alias, actualName);
        this.toolMetadata.set(alias, {
          requiresApproval: !!def.requiresApproval,
          safe: !!def.safe,
          source: 'tool-system'
        });
        this.toolDefinitions.push({
          type: 'function',
          function: {
            name: alias,
            description: def.description || actualName,
            parameters: def.parameters || { type: 'object', properties: {}, required: [] }
          }
        });
      }
    }
  }

  listTools() {
    return this.toolDefinitions.slice();
  }

  hasTool(toolName) {
    const actualName = this.aliasToActual.get(toolName) || toolName;

    if (this.skillRegistry && this.skillRegistry.getSkill(actualName)) {
      return true;
    }

    if (this.workflowManager) {
      const exists = this.workflowManager.getToolDefinitions()
        .some((tool) => tool.function.name === actualName);
      if (exists) {
        return true;
      }
    }

    const registry = this._getToolRegistry();
    return !!(registry && registry.hasTool && registry.hasTool(actualName));
  }

  isMutating(toolName) {
    const metadata = this.toolMetadata.get(toolName);
    if (metadata) {
      return !!metadata.requiresApproval && !metadata.safe;
    }
    return this._looksMutating(toolName);
  }

  async execute(toolName, args = {}, options = {}) {
    const actualName = this.aliasToActual.get(toolName) || toolName;

    if (this.skillRegistry && this.skillRegistry.getSkill(actualName) && this.skillExecutor) {
      const result = await this.skillExecutor.execute(actualName, args, {
        ...options,
        streamCallback: (chunk) => {
          if (typeof options.onStream === 'function') {
            options.onStream(chunk);
          }
        }
      });
      return normalizeToolResult(result, 'skill', actualName);
    }

    if (this.workflowManager) {
      const exists = this.workflowManager.getToolDefinitions()
        .some((tool) => tool.function.name === actualName);
      if (exists) {
        const result = await this.workflowManager.execute(actualName, args);
        return normalizeToolResult(result, 'workflow', actualName);
      }
    }

    if (this.toolSystem) {
      const result = await this.toolSystem.execute(actualName, args, options.context || {});
      return normalizeToolResult(result, 'tool-system', actualName);
    }

    return {
      ok: false,
      summary: `Unknown tool: ${toolName}`,
      data: null,
      artifacts: [],
      needsApproval: false,
      reversible: false,
      audit: {
        source: 'none',
        toolName: actualName,
        durationMs: null,
        error: 'unknown_tool'
      }
    };
  }

  _getToolRegistry() {
    if (!this.toolSystem) return null;
    if (typeof this.toolSystem.getRegistry === 'function') {
      return this.toolSystem.getRegistry();
    }
    return this.toolSystem.registry || null;
  }

  _looksMutating(toolName) {
    const name = String(toolName || '').toLowerCase();
    if (name.includes('read') || name.includes('list') || name.includes('search') || name.includes('ocr') || name.includes('info')) {
      return false;
    }
    return /(write|edit|delete|remove|move|copy|rename|open|create|set|run|execute|install|reminder|task|bash)/.test(name);
  }
}

module.exports = CapabilityRegistry;
