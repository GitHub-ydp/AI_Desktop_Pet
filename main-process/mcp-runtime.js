const { spawn } = require('child_process');

function sanitizeToolName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

class McpRuntime {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.clientInfo = options.clientInfo || { name: 'ai-desktop-pet', version: '1.0.0' };
    this.protocolVersions = Array.isArray(options.protocolVersions) && options.protocolVersions.length > 0
      ? options.protocolVersions
      : ['2025-03-26', '2024-11-05'];
    this.serverStates = new Map();
    this.toolIndex = new Map();
  }

  async initialize() {
    await this.syncServers();
    return this.listServers();
  }

  async syncServers() {
    const configured = this.registry ? this.registry.listServers() : [];
    const configuredIds = new Set(configured.map((server) => server.id));

    for (const [serverId, state] of this.serverStates.entries()) {
      if (!configuredIds.has(serverId)) {
        await this.stopServer(serverId);
        this.serverStates.delete(serverId);
      }
    }

    for (const server of configured) {
      const existing = this.serverStates.get(server.id);
      if (!existing) {
        this.serverStates.set(server.id, this._createState(server));
      } else {
        const configChanged = this._didConfigChange(existing.config, server);
        existing.config = { ...server };
        if (configChanged && existing.status === 'running') {
          await this.restartServer(server.id);
          continue;
        }
      }

      if (server.enabled) {
        try {
          await this.startServer(server.id);
        } catch (error) {
          const state = this.serverStates.get(server.id);
          if (state) {
            state.status = 'error';
            state.lastError = error.message;
            this._pushLog(state, `sync start failed: ${error.message}`);
          }
        }
      } else {
        await this.stopServer(server.id);
      }
    }

    this._rebuildToolIndex();
    return this.listServers();
  }

  listServers() {
    const configured = this.registry ? this.registry.listServers() : [];
    return configured.map((server) => {
      const state = this.serverStates.get(server.id);
      return {
        ...server,
        status: state ? state.status : (server.enabled ? 'stopped' : 'disabled'),
        lastError: state?.lastError || null,
        pid: state?.process?.pid || null,
        toolCount: Array.isArray(state?.tools) ? state.tools.length : 0,
        tools: Array.isArray(state?.tools) ? state.tools.map((tool) => tool.name) : [],
        logs: Array.isArray(state?.logs) ? state.logs.slice(-10) : [],
        startedAt: state?.startedAt || null,
        stoppedAt: state?.stoppedAt || null,
        serverInfo: state?.serverInfo || null
      };
    });
  }

  listTools() {
    return Array.from(this.toolIndex.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.alias,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  hasTool(alias) {
    return this.toolIndex.has(alias);
  }

  getToolMetadata(alias) {
    return this.toolIndex.get(alias) || null;
  }

  async startServer(serverId) {
    const state = this.serverStates.get(serverId);
    if (!state) {
      throw new Error(`MCP config not found: ${serverId}`);
    }
    if (!state.config.enabled) {
      state.status = 'disabled';
      return this._serializeState(state);
    }
    if (state.status === 'running' || state.status === 'starting') {
      return this._serializeState(state);
    }

    state.status = 'starting';
    state.lastError = null;
    state.logs = [];
    state.tools = [];
    state.stdoutBuffer = Buffer.alloc(0);
    state.expectedLength = null;
    state.pendingRequests.clear();
    state.nextRequestId = 0;

    const child = this._spawnProcess(state.config);

    state.process = child;
    state.startedAt = Date.now();
    state.stoppedAt = null;

    child.stdout.on('data', (chunk) => this._handleStdout(state, chunk));
    child.stderr.on('data', (chunk) => this._pushLog(state, `stderr: ${String(chunk || '').trim()}`));
    child.on('error', (error) => {
      state.lastError = error.message;
      state.status = 'error';
      this._pushLog(state, `process error: ${error.message}`);
      this._rejectPending(state, error);
      this._rebuildToolIndex();
    });
    child.on('exit', (code, signal) => {
      const wasIntentionalStop = state.intentionalStop === true;
      state.intentionalStop = false;
      state.status = state.config.enabled ? 'stopped' : 'disabled';
      state.stoppedAt = Date.now();
      state.process = null;
      state.tools = [];
      state.serverInfo = null;
      if (!wasIntentionalStop && (code !== 0 || signal)) {
        state.status = 'error';
        state.lastError = `exit code=${code} signal=${signal || 'none'}`;
        this._pushLog(state, `process exited: code=${code} signal=${signal || 'none'}`);
      } else {
        this._pushLog(state, 'process exited');
      }
      this._rejectPending(state, new Error('MCP process exited'));
      this._rebuildToolIndex();
    });

    try {
      await this._initializeServer(state);
      state.status = 'running';
      state.lastError = null;
      this._rebuildToolIndex();
    } catch (error) {
      state.status = 'error';
      state.lastError = error.message;
      this._pushLog(state, `initialize failed: ${error.message}`);
      await this.stopServer(serverId, { preserveError: true });
      throw error;
    }

    return this._serializeState(state);
  }

  async stopServer(serverId, options = {}) {
    const state = this.serverStates.get(serverId);
    if (!state) return null;

    if (state.process) {
      const child = state.process;
      state.intentionalStop = true;
      state.status = state.config.enabled ? 'stopping' : 'disabled';
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        child.once('exit', finish);
        try {
          child.kill();
        } catch {
          finish();
        }
        setTimeout(finish, 1500);
      });
    }

    state.process = null;
    state.tools = [];
    state.stdoutBuffer = Buffer.alloc(0);
    state.expectedLength = null;
    state.pendingRequests.clear();
    state.status = options.preserveError && state.lastError
      ? 'error'
      : (state.config.enabled ? 'stopped' : 'disabled');
    state.stoppedAt = Date.now();
    this._rebuildToolIndex();
    return this._serializeState(state);
  }

  async restartServer(serverId) {
    await this.stopServer(serverId);
    return this.startServer(serverId);
  }

  async executeTool(alias, args = {}) {
    const tool = this.toolIndex.get(alias);
    if (!tool) {
      return { success: false, error: `MCP tool not found: ${alias}` };
    }

    const state = this.serverStates.get(tool.serverId);
    if (!state || state.status !== 'running') {
      return { success: false, error: `MCP server is not running: ${tool.serverName}` };
    }

    const response = await this._sendRequest(state, 'tools/call', {
      name: tool.toolName,
      arguments: args || {}
    });

    const text = Array.isArray(response?.content)
      ? response.content.filter((item) => item && item.type === 'text').map((item) => item.text).join('\n')
      : '';

    return {
      success: !response?.isError,
      result: {
        server: tool.serverName,
        tool: tool.toolName,
        text,
        content: response?.content || [],
        structuredContent: response?.structuredContent || null,
        raw: response
      },
      error: response?.isError ? (text || 'MCP tool returned error') : null
    };
  }

  async shutdown() {
    const ids = Array.from(this.serverStates.keys());
    for (const id of ids) {
      await this.stopServer(id);
    }
  }

  _createState(config) {
    return {
      config: { ...config },
      process: null,
      status: config.enabled ? 'stopped' : 'disabled',
      lastError: null,
      tools: [],
      logs: [],
      serverInfo: null,
      startedAt: null,
      stoppedAt: null,
      intentionalStop: false,
      stdoutBuffer: Buffer.alloc(0),
      expectedLength: null,
      pendingRequests: new Map(),
      nextRequestId: 0
    };
  }

  _serializeState(state) {
    return {
      ...state.config,
      status: state.status,
      lastError: state.lastError,
      pid: state.process?.pid || null,
      toolCount: state.tools.length,
      tools: state.tools.map((tool) => tool.name),
      logs: state.logs.slice(-10),
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      serverInfo: state.serverInfo || null
    };
  }

  _didConfigChange(previous, next) {
    return safeStringify({
      command: previous?.command,
      args: previous?.args,
      env: previous?.env,
      enabled: previous?.enabled
    }) !== safeStringify({
      command: next?.command,
      args: next?.args,
      env: next?.env,
      enabled: next?.enabled
    });
  }

  async _initializeServer(state) {
    let initResult = null;
    let lastError = null;
    for (const version of this.protocolVersions) {
      try {
        initResult = await this._sendRequest(state, 'initialize', {
          protocolVersion: version,
          capabilities: {},
          clientInfo: this.clientInfo
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!initResult) {
      throw lastError || new Error('MCP initialize failed');
    }

    state.serverInfo = initResult.serverInfo || null;
    await this._sendNotification(state, 'notifications/initialized', {});
    state.tools = await this._fetchTools(state);
    this._pushLog(state, `connected, discovered ${state.tools.length} tools`);
  }

  async _fetchTools(state) {
    const allTools = [];
    let cursor = undefined;

    while (true) {
      const response = await this._sendRequest(state, 'tools/list', cursor ? { cursor } : {});
      const tools = Array.isArray(response?.tools) ? response.tools : [];
      allTools.push(...tools);
      if (!response?.nextCursor) {
        break;
      }
      cursor = response.nextCursor;
    }

    return allTools;
  }

  _rebuildToolIndex() {
    this.toolIndex.clear();
    for (const [serverId, state] of this.serverStates.entries()) {
      if (state.status !== 'running') continue;
      for (const tool of state.tools) {
        const alias = sanitizeToolName(`mcp_${state.config.name}_${tool.name}`);
        let uniqueAlias = alias;
        let suffix = 2;
        while (this.toolIndex.has(uniqueAlias)) {
          uniqueAlias = `${alias}_${suffix}`;
          suffix += 1;
        }

        this.toolIndex.set(uniqueAlias, {
          alias: uniqueAlias,
          serverId,
          serverName: state.config.name,
          toolName: tool.name,
          description: `[MCP:${state.config.name}] ${tool.description || tool.name}`,
          parameters: (tool.inputSchema && typeof tool.inputSchema === 'object')
            ? tool.inputSchema
            : { type: 'object', properties: {}, required: [] },
          readOnlyHint: !!tool.annotations?.readOnlyHint,
          raw: tool
        });
      }
    }
  }

  _pushLog(state, line) {
    const text = String(line || '').trim();
    if (!text) return;
    state.logs.push(`[${formatNow()}] ${text}`);
    if (state.logs.length > 30) {
      state.logs = state.logs.slice(-30);
    }
  }

  _handleStdout(state, chunk) {
    state.stdoutBuffer = Buffer.concat([state.stdoutBuffer, Buffer.from(chunk)]);

    while (true) {
      if (state.expectedLength == null) {
        let headerEnd = state.stdoutBuffer.indexOf('\r\n\r\n');
        let separatorLength = 4;
        if (headerEnd === -1) {
          headerEnd = state.stdoutBuffer.indexOf('\n\n');
          separatorLength = 2;
        }
        if (headerEnd === -1) break;

        const headerText = state.stdoutBuffer.slice(0, headerEnd).toString('utf8');
        const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        state.stdoutBuffer = state.stdoutBuffer.slice(headerEnd + separatorLength);
        if (!lengthMatch) {
          this._pushLog(state, `invalid header: ${headerText}`);
          continue;
        }
        state.expectedLength = Number(lengthMatch[1]);
      }

      if (state.stdoutBuffer.length < state.expectedLength) {
        break;
      }

      const body = state.stdoutBuffer.slice(0, state.expectedLength);
      state.stdoutBuffer = state.stdoutBuffer.slice(state.expectedLength);
      state.expectedLength = null;

      try {
        const message = JSON.parse(body.toString('utf8'));
        void this._handleMessage(state, message);
      } catch (error) {
        this._pushLog(state, `invalid message: ${error.message}`);
      }
    }
  }

  async _handleMessage(state, message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = state.pendingRequests.get(message.id);
      if (!pending) return;
      state.pendingRequests.delete(message.id);
      clearTimeout(pending.timeoutId);

      if (message.error) {
        pending.reject(new Error(message.error.message || safeStringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === 'notifications/tools/list_changed') {
      try {
        state.tools = await this._fetchTools(state);
        this._rebuildToolIndex();
      } catch (error) {
        state.lastError = error.message;
        this._pushLog(state, `refresh tools failed: ${error.message}`);
      }
      return;
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this._sendMessage(state, {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported MCP method: ${message.method}`
        }
      });
      return;
    }

    if (message.method) {
      this._pushLog(state, `notification: ${message.method}`);
    }
  }

  _sendMessage(state, payload) {
    if (!state.process || !state.process.stdin || state.process.stdin.destroyed) {
      throw new Error('MCP stdin is not available');
    }

    const body = Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      ...payload
    }), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
    state.process.stdin.write(Buffer.concat([header, body]));
  }

  _sendRequest(state, method, params) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}_${++state.nextRequestId}`;
      const timeoutId = setTimeout(() => {
        state.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 15000);

      state.pendingRequests.set(id, { resolve, reject, timeoutId });

      try {
        this._sendMessage(state, {
          id,
          method,
          params: params || {}
        });
      } catch (error) {
        clearTimeout(timeoutId);
        state.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async _sendNotification(state, method, params) {
    this._sendMessage(state, {
      method,
      params: params || {}
    });
  }

  _rejectPending(state, error) {
    for (const [requestId, pending] of state.pendingRequests.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      state.pendingRequests.delete(requestId);
    }
  }

  _spawnProcess(config) {
    const command = String(config?.command || '').trim();
    const args = Array.isArray(config?.args) ? config.args.map((item) => String(item)) : [];
    const env = {
      ...process.env,
      ...(config?.env || {})
    };

    const useShell = /\s/.test(command);
    if (useShell) {
      const fullCommand = [command, ...args.map((item) => this._quoteShellArg(item))].filter(Boolean).join(' ');
      return spawn(fullCommand, {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true
      });
    }

    return spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
  }

  _quoteShellArg(value) {
    const text = String(value || '');
    if (!/[\s"]/g.test(text)) {
      return text;
    }
    return `"${text.replace(/"/g, '\\"')}"`;
  }
}

function formatNow() {
  try {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return String(Date.now());
  }
}

module.exports = McpRuntime;
