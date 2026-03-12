const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

class McpRegistry {
  constructor(app) {
    this.app = app || null;
    this.filePath = app ? path.join(app.getPath('userData'), 'mcp-servers.json') : null;
    this.state = { servers: [] };
    this.load();
  }

  load() {
    this.state = this._readState();
    return this.listServers();
  }

  listServers() {
    return (this.state.servers || []).map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description || '',
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: server.env && typeof server.env === 'object' ? server.env : {},
      enabled: server.enabled !== false,
      transport: server.transport || 'stdio',
      createdAt: server.createdAt || null,
      updatedAt: server.updatedAt || null,
      status: server.enabled === false ? 'disabled' : 'configured'
    }));
  }

  getStorageInfo() {
    return {
      filePath: this.filePath
    };
  }

  createServer(payload = {}) {
    const name = String(payload.name || '').trim();
    const command = String(payload.command || '').trim();
    if (!name) {
      throw new Error('MCP name is required');
    }
    if (!command) {
      throw new Error('MCP command is required');
    }

    const now = Date.now();
    const record = {
      id: `mcp_${randomUUID()}`,
      name,
      description: String(payload.description || '').trim(),
      command,
      args: this._normalizeArgs(payload.args),
      env: this._normalizeEnv(payload.env),
      enabled: payload.enabled !== false,
      transport: 'stdio',
      createdAt: now,
      updatedAt: now
    };

    this.state.servers.push(record);
    this._writeState();
    return this.listServers().find((server) => server.id === record.id);
  }

  updateServer(serverId, payload = {}) {
    const target = this._findServer(serverId);
    if (!target) {
      throw new Error('MCP config not found');
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
      const name = String(payload.name || '').trim();
      if (!name) throw new Error('MCP name is required');
      target.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
      target.description = String(payload.description || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'command')) {
      const command = String(payload.command || '').trim();
      if (!command) throw new Error('MCP command is required');
      target.command = command;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'args')) {
      target.args = this._normalizeArgs(payload.args);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'env')) {
      target.env = this._normalizeEnv(payload.env);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
      target.enabled = !!payload.enabled;
    }
    target.updatedAt = Date.now();
    this._writeState();
    return this.listServers().find((server) => server.id === target.id);
  }

  setEnabled(serverId, enabled) {
    return this.updateServer(serverId, { enabled: !!enabled });
  }

  removeServer(serverId) {
    const nextServers = (this.state.servers || []).filter((server) => server.id !== serverId);
    if (nextServers.length === this.state.servers.length) {
      throw new Error('MCP config not found');
    }
    this.state.servers = nextServers;
    this._writeState();
    return true;
  }

  _findServer(serverId) {
    return (this.state.servers || []).find((server) => server.id === serverId) || null;
  }

  _normalizeArgs(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    return String(value || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  _normalizeEnv(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const normalized = {};
      for (const [key, envValue] of Object.entries(value)) {
        const envKey = String(key || '').trim();
        if (!envKey) continue;
        normalized[envKey] = String(envValue == null ? '' : envValue);
      }
      return normalized;
    }

    const text = String(value || '');
    const result = {};
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) return;
      const key = trimmed.slice(0, separatorIndex).trim();
      const envValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key) return;
      result[key] = envValue;
    });
    return result;
  }

  _readState() {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return { servers: [] };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        servers: Array.isArray(parsed?.servers) ? parsed.servers : []
      };
    } catch (error) {
      console.warn('[McpRegistry] Failed to read config:', error.message);
      return { servers: [] };
    }
  }

  _writeState() {
    if (!this.filePath) return;
    fs.writeFileSync(this.filePath, JSON.stringify({
      servers: this.state.servers || []
    }, null, 2), 'utf8');
  }
}

module.exports = McpRegistry;
