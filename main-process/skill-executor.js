// 技能执行器
// 接收 LLM 的 tool_call，路由到对应的处理器执行
// 支持 Node.js 内置处理器和 Python 工具层

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const WeatherService = require('./weather-service');

// 安全限制：禁止访问的路径关键词
const BLOCKED_PATH_KEYWORDS = [
  'Windows', 'System32', 'Program Files', 'ProgramData',
  'system32', 'syswow64', 'SysWOW64'
];

// 危险命令黑名单（PowerShell/cmd）
const DANGEROUS_COMMANDS = [
  'format', 'diskpart', 'bcdedit', 'reg delete', 'reg add',
  'net stop', 'net user', 'sc delete', 'taskkill /f',
  'Remove-Item -Recurse -Force C:', 'rm -rf /',
  'del /s /q C:', 'rd /s /q C:'
];

class SkillExecutor {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.memorySystem = options.memorySystem || null;
    this.workflowManager = options.workflowManager || null;
    this.weatherService = options.weatherService || new WeatherService();
    this.screenshotOCR = typeof options.screenshotOCR === 'function' ? options.screenshotOCR : null;
    if (options.weatherDefaultCity) {
      this.weatherService.setPreferredCity(options.weatherDefaultCity);
    }
    this.mainWindow = null;

    // 技能名 → 现有 WorkflowManager 工具名映射（向后兼容）
    this._legacyMapping = {
      file_read: 'file_ops_read_file',
      file_write: 'file_ops_write_file'
    };

    // 内置 Node.js 处理器映射
    this._builtinHandlers = {
      bash_run: this._bashRun.bind(this),
      file_edit: this._fileEdit.bind(this),
      file_list: this._fileList.bind(this),
      file_search: this._fileSearch.bind(this),
      memory_search: this._memorySearch.bind(this),
      open_app: this._openApp.bind(this),
      open_url: this._openUrl.bind(this),
      clipboard_set: this._clipboardSet.bind(this),
      reminder_create: this._reminderCreate.bind(this),
      screenshot_ocr: this._screenshotOCR.bind(this),
      web_fetch: this._webFetch.bind(this),
      web_search: this._webSearch.bind(this),
      weather_get: this._weatherGet.bind(this)
    };
  }

  // 设置主窗口引用（确认弹窗需要）
  setMainWindow(win) {
    this.mainWindow = win;
  }

  setWeatherDefaultCity(city) {
    this.weatherService.setPreferredCity(city || '');
  }

  // 主执行入口
  async execute(toolName, args, options = {}) {
    const startTime = Date.now();

    // 检查技能是否注册
    const skill = this.registry ? this.registry.getSkill(toolName) : null;
    if (!skill) {
      return { success: false, error: `未知技能: ${toolName}` };
    }

    // 危险操作需要用户确认
    if (skill.metadata.confirm && options.confirmCallback) {
      try {
        const approved = await options.confirmCallback(
          `AI 请求执行: ${skill.description}\n参数: ${JSON.stringify(args, null, 2)}`
        );
        if (!approved) {
          return { success: false, error: '用户取消了操作' };
        }
      } catch (e) {
        console.warn('[SkillExecutor] 确认回调失败:', e.message);
      }
    }

    try {
      const result = await this._route(toolName, args, skill, options);
      const duration = Date.now() - startTime;
      return { ...result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      return { success: false, error: error.message, duration };
    }
  }

  // 路由逻辑
  async _route(toolName, args, skill, options = {}) {
    // 1. 优先使用内置 Node.js 处理器
    if (this._builtinHandlers[toolName]) {
      return await this._builtinHandlers[toolName](args, options);
    }

    // 2. 检查是否有旧 WorkflowManager 映射
    const legacyName = this._legacyMapping[toolName];
    if (legacyName && this.workflowManager) {
      return await this.workflowManager.execute(legacyName, args);
    }

    // 3. 直接尝试 WorkflowManager（可能是自定义工具）
    if (this.workflowManager) {
      return await this.workflowManager.execute(toolName, args);
    }

    return { success: false, error: `无可用执行器: ${toolName}` };
  }

  // ==================== 内置处理器 ====================

  // bash_run：执行 PowerShell 命令（支持流式输出）
  async _bashRun(args, options = {}) {
    const { command, timeout = 30000 } = args;
    const { confirmCallback, streamCallback } = options;

    if (!command || typeof command !== 'string') {
      return { success: false, error: '缺少 command 参数' };
    }

    // 安全检查：危险命令黑名单
    const lowerCmd = command.toLowerCase();
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (lowerCmd.includes(dangerous.toLowerCase())) {
        return { success: false, error: `禁止执行危险命令: ${dangerous}` };
      }
    }

    // 危险操作需要用户确认
    if (confirmCallback) {
      try {
        const approved = await confirmCallback(`执行命令: ${command}`);
        if (!approved) return { success: false, error: '用户取消了操作' };
      } catch (e) {
        return { success: false, error: '用户取消了操作' };
      }
    }

    const effectiveTimeout = Math.min(timeout, 60000);

    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (streamCallback) streamCallback({ type: 'stdout', text });
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (streamCallback) streamCallback({ type: 'stderr', text });
      });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: `命令执行超时（${effectiveTimeout}ms）` });
      }, effectiveTimeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          result: {
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code
          }
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });
    });
  }

  // file_edit：精确编辑文件（str_replace 模式）
  async _fileEdit(args, options = {}) {
    const { path: filePath, old_string = '', new_string = '', create_if_missing = false } = args;
    const previewOnly = !!options.previewOnly;

    if (!filePath) {
      return { success: false, error: '缺少 path 参数' };
    }

    try {
      const expandedPath = filePath.replace(/^~/, require('os').homedir());
      const safeCheck = this._validatePath(expandedPath);
      if (!safeCheck.safe) {
        return { success: false, error: safeCheck.reason };
      }

      // 文件不存在的处理
      let content;
      try {
        content = await fs.readFile(expandedPath, 'utf8');
      } catch (e) {
        if (create_if_missing && old_string === '') {
          const preview = this._buildFileEditPreview({
            action: 'created',
            filePath: expandedPath,
            oldString: '',
            newString: new_string,
            startLine: 1
          });
          if (!previewOnly) {
            await fs.mkdir(path.dirname(expandedPath), { recursive: true });
            await fs.writeFile(expandedPath, new_string, 'utf8');
          }
          return { success: true, result: preview };
        }
        return { success: false, error: `文件不存在: ${expandedPath}` };
      }

      // old_string 为空时追加到末尾
      if (old_string === '') {
        const newContent = content + new_string;
        const startLine = content.length === 0 ? 1 : content.split('\n').length;
        const preview = this._buildFileEditPreview({
          action: 'appended',
          filePath: expandedPath,
          oldString: '',
          newString: new_string,
          startLine
        });
        if (!previewOnly) {
          await fs.writeFile(expandedPath, newContent, 'utf8');
        }
        return { success: true, result: preview };
      }

      // 检查 old_string 是否存在
      const firstIdx = content.indexOf(old_string);
      if (firstIdx === -1) {
        return { success: false, error: '未找到要替换的内容，请确认原始文本是否正确' };
      }

      // 检查 old_string 是否唯一
      const secondIdx = content.indexOf(old_string, firstIdx + 1);
      if (secondIdx !== -1) {
        const escaped = old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const count = (content.match(new RegExp(escaped, 'g')) || []).length;
        return { success: false, error: `要替换的内容不唯一（共出现 ${count} 次），请提供更多上下文以精确定位` };
      }

      // 执行替换
      const newContent = content.slice(0, firstIdx) + new_string + content.slice(firstIdx + old_string.length);
      const startLine = content.slice(0, firstIdx).split('\n').length;
      const preview = this._buildFileEditPreview({
        action: 'replaced',
        filePath: expandedPath,
        oldString: old_string,
        newString: new_string,
        startLine
      });

      if (previewOnly) {
        return { success: true, result: preview };
      }

      await fs.writeFile(expandedPath, newContent, 'utf8');

      return { success: true, result: preview };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // file_read：读取文件（Node.js 原生实现）
  async _fileRead(args) {
    const { path: filePath, encoding = 'utf8' } = args;

    if (!filePath) {
      return { success: false, error: '缺少 path 参数' };
    }

    // 安全路径校验
    const safetyCheck = this._validatePath(filePath);
    if (!safetyCheck.safe) {
      return { success: false, error: safetyCheck.reason };
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 5 * 1024 * 1024) {
        return { success: false, error: '文件超过 5MB 限制' };
      }
      const content = await fs.readFile(filePath, encoding);
      return { success: true, result: { content, size: stat.size } };
    } catch (error) {
      return { success: false, error: `读取失败: ${error.message}` };
    }
  }

  // memory_search：记忆系统搜索
  async _memorySearch(args) {
    const { query, maxResults = 5 } = args;

    if (!query) {
      return { success: false, error: '缺少 query 参数' };
    }

    if (!this.memorySystem) {
      return { success: false, error: '记忆系统未初始化' };
    }

    try {
      const results = await this.memorySystem.searchMemories(query, {
        limit: maxResults
      });
      return {
        success: true,
        result: {
          count: results.length,
          memories: results.map(r => ({
            content: r.content || r.text,
            score: r.score,
            timestamp: r.timestamp || r.created_at,
            role: r.role
          }))
        }
      };
    } catch (error) {
      return { success: false, error: `记忆搜索失败: ${error.message}` };
    }
  }

  // reminder_create：创建提醒
  async _reminderCreate(args) {
    const { content, remindAt, repeat } = args;

    if (!content || !remindAt) {
      return { success: false, error: '缺少 content 或 remindAt 参数' };
    }

    if (!this.memorySystem) {
      return { success: false, error: '记忆系统未初始化' };
    }

    try {
      const reminder = await this.memorySystem.createReminder({
        content,
        remindAt,
        repeatPattern: repeat || null
      });
      return {
        success: true,
        result: {
          id: reminder.id || reminder,
          content,
          remindAt: new Date(remindAt).toLocaleString('zh-CN'),
          repeat: repeat || '不重复'
        }
      };
    } catch (error) {
      return { success: false, error: `创建提醒失败: ${error.message}` };
    }
  }

  // screenshot_ocr：截图 OCR 识别
  async _screenshotOCR(args) {
    if (!this.screenshotOCR) {
      return { success: false, error: '截图 OCR 管道未初始化' };
    }

    try {
      const result = await this.screenshotOCR({
        imageId: typeof args.imageId === 'string' ? args.imageId.trim() : '',
        dataURL: typeof args.dataURL === 'string' ? args.dataURL.trim() : ''
      });
      return {
        success: true,
        result
      };
    } catch (error) {
      return { success: false, error: `截图 OCR 失败: ${error.message}` };
    }
  }

  // web_search：网络搜索
  async _webSearch(args) {
    const { query, maxResults = 5 } = args;

    if (!query) {
      return { success: false, error: '缺少 query 参数' };
    }

    // 使用 DuckDuckGo Instant Answer API（免费无 Key）
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const https = require('https');

      const data = await new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 10000 }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error('解析搜索结果失败'));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('搜索请求超时'));
        });
      });

      const results = [];

      // 提取摘要
      if (data.Abstract) {
        results.push({
          title: data.Heading || '摘要',
          snippet: data.Abstract,
          url: data.AbstractURL || ''
        });
      }

      // 提取相关话题
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.Text) {
            results.push({
              title: topic.Text.substring(0, 50),
              snippet: topic.Text,
              url: topic.FirstURL || ''
            });
          }
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          result: {
            message: '未找到相关结果，建议用更具体的关键词搜索',
            query
          }
        };
      }

      return {
        success: true,
        result: {
          count: results.length,
          results
        }
      };
    } catch (error) {
      return { success: false, error: `搜索失败: ${error.message}` };
    }
  }

  async _webFetch(args) {
    const rawUrl = String(args.url || '').trim();
    if (!rawUrl) {
      return { success: false, error: '缺少 url 参数' };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return { success: false, error: `无效的 URL: ${rawUrl}` };
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, error: `禁止抓取协议: ${parsedUrl.protocol}` };
    }

    try {
      const html = await this._fetchTextUrl(parsedUrl.toString(), 0);
      const extracted = this._extractReadableHtml(html);
      return {
        success: true,
        result: {
          url: parsedUrl.toString(),
          title: extracted.title,
          content: extracted.content
        }
      };
    } catch (error) {
      return { success: false, error: `网页抓取失败: ${error.message}` };
    }
  }

  async _fileList(args = {}) {
    const rootPath = String(args.path || '').replace(/^~/, os.homedir());
    const filter = String(args.filter || '*');
    const recursive = !!args.recursive;

    const safetyCheck = this._validatePath(rootPath);
    if (!safetyCheck.safe) {
      return { success: false, error: safetyCheck.reason };
    }

    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      return { success: false, error: `目录不存在: ${rootPath}` };
    }

    const matcher = this._wildcardToRegExp(filter);
    const files = [];

    await this._walkDirectory(rootPath, async (fullPath, entry, relativePath) => {
      if (!matcher.test(entry.name)) return;
      const entryStat = await fs.stat(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        relative_path: relativePath,
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
        is_dir: entry.isDirectory()
      });
      return true;
    }, { recursive, includeDirectories: true, maxResults: 1000 });

    return {
      success: true,
      result: {
        files,
        total: files.length
      }
    };
  }

  async _fileSearch(args = {}) {
    const rootPath = String(args.path || '').replace(/^~/, os.homedir());
    const pattern = String(args.pattern || '*');
    const recursive = args.recursive !== false;

    const safetyCheck = this._validatePath(rootPath);
    if (!safetyCheck.safe) {
      return { success: false, error: safetyCheck.reason };
    }

    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      return { success: false, error: `目录不存在: ${rootPath}` };
    }

    const matcher = this._wildcardToRegExp(pattern);
    const files = [];

    await this._walkDirectory(rootPath, async (fullPath, entry, relativePath) => {
      if (entry.isDirectory()) return;
      if (!matcher.test(entry.name)) return;
      const entryStat = await fs.stat(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        relative_path: relativePath,
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
        is_dir: false
      });
      return true;
    }, { recursive, includeDirectories: false, maxResults: 1000 });

    return {
      success: true,
      result: {
        files,
        total: files.length
      }
    };
  }

  async _weatherGet(args = {}) {
    const location = typeof args.location === 'string' ? args.location.trim() : '';
    const weather = await this.weatherService.getWeather(location || null);
    if (!weather || weather.unavailable || weather.source === 'default') {
      return {
        success: true,
        result: location
          ? `暂时无法获取 ${location} 的天气，请稍后重试。`
          : '暂时无法获取当前天气，请告诉我城市名后再试一次。'
      };
    }

    const forecastLines = Array.isArray(weather.forecast)
      ? weather.forecast.slice(0, 3).map((day) => {
          const label = day.date || '未来';
          return `${label} ${day.weatherIcon || '🌡️'} ${day.weatherDesc || '未知'} ${day.minTemp}~${day.maxTemp}°C`;
        })
      : [];

    const summaryParts = [
      `${weather.weatherIcon || '🌡️'} ${weather.location || (location || '当前位置')} 当前${weather.weatherDesc || '未知'}，${weather.temperature}°C`,
      `体感 ${weather.feelsLike}°C`,
      `湿度 ${weather.humidity}%`,
      `风速 ${weather.windSpeed} km/h`
    ];

    const summary = forecastLines.length > 0
      ? `${summaryParts.join('，')}\n未来预报：\n${forecastLines.join('\n')}`
      : summaryParts.join('，');

    return {
      success: true,
      result: summary
    };
  }

  async _openApp(args = {}) {
    const { shell } = require('electron');
    const appName = String(args.app_name || '').trim().toLowerCase();
    if (!appName) {
      return { success: false, error: '缺少 app_name 参数' };
    }

    const resolvedPath = await this._resolveAppPath(appName);
    if (!resolvedPath) {
      return { success: false, error: `未找到可打开的应用: ${appName}` };
    }

    const openError = await shell.openPath(resolvedPath);
    if (openError) {
      return { success: false, error: openError };
    }

    return { success: true, result: { app_name: appName, path: resolvedPath } };
  }

  async _openUrl(args = {}) {
    const { shell } = require('electron');
    const rawUrl = String(args.url || '').trim();
    if (!rawUrl) {
      return { success: false, error: '缺少 url 参数' };
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { success: false, error: `无效的 URL: ${rawUrl}` };
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'http:') {
      return { success: false, error: `禁止打开协议: ${protocol}` };
    }

    await shell.openExternal(parsed.toString());
    return { success: true, result: { url: parsed.toString() } };
  }

  async _clipboardSet(args = {}) {
    const { clipboard } = require('electron');
    if (args.text == null) {
      return { success: false, error: '缺少 text 参数' };
    }

    const text = String(args.text);
    clipboard.writeText(text);
    return { success: true, result: { length: text.length } };
  }

  // ==================== 安全工具 ====================

  // 路径安全校验
  _validatePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      return { safe: false, reason: '无效路径' };
    }

    // 禁止路径穿越
    if (filePath.includes('..')) {
      return { safe: false, reason: '路径不允许包含 ".."' };
    }

    // 禁止系统目录
    const normalized = path.normalize(filePath);
    for (const keyword of BLOCKED_PATH_KEYWORDS) {
      if (normalized.includes(keyword)) {
        return { safe: false, reason: `禁止访问系统目录: ${keyword}` };
      }
    }

    return { safe: true };
  }

  _wildcardToRegExp(pattern) {
    const escaped = String(pattern || '*')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }

  _buildFileEditPreview({ action, filePath, oldString, newString, startLine }) {
    const removedLines = oldString === '' ? [] : String(oldString || '').split('\n');
    const addedLines = newString === '' ? [] : String(newString || '').split('\n');
    const diff = [];

    if (action === 'replaced' || action === 'deleted') {
      removedLines.forEach((line, index) => {
        diff.push({
          type: 'remove',
          lineNumber: startLine + index,
          text: line
        });
      });
    }

    if (action === 'created' || action === 'appended' || action === 'replaced') {
      addedLines.forEach((line, index) => {
        diff.push({
          type: 'add',
          lineNumber: startLine + index,
          text: line
        });
      });
    }

    return {
      path: filePath,
      action,
      startLine,
      linesChanged: Math.max(removedLines.length, addedLines.length),
      stats: {
        removed: action === 'created' || action === 'appended' ? 0 : removedLines.length,
        added: action === 'deleted' ? 0 : addedLines.length
      },
      diff
    };
  }

  _fetchTextUrl(url, redirectCount = 0) {
    if (redirectCount > 5) {
      return Promise.reject(new Error('重定向过多'));
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'http:' ? http : https;
      const req = client.get(parsedUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'AI-Desktop-Pet/1.0',
          Accept: 'text/html,application/xhtml+xml'
        }
      }, (res) => {
        const statusCode = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          resolve(this._fetchTextUrl(nextUrl, redirectCount + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) {
            req.destroy(new Error('网页内容过大'));
          }
        });
        res.on('end', () => resolve(body));
      });

      req.on('timeout', () => {
        req.destroy(new Error('请求超时'));
      });
      req.on('error', reject);
    });
  }

  _extractReadableHtml(html) {
    const source = String(html || '');
    const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = this._decodeHtmlEntities((titleMatch?.[1] || '').replace(/\s+/g, ' ').trim());

    let cleaned = source
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<main\b[^>]*>/gi, '\n')
      .replace(/<\/main>/gi, '\n')
      .replace(/<article\b[^>]*>/gi, '\n')
      .replace(/<\/article>/gi, '\n')
      .replace(/<section\b[^>]*>/gi, '\n')
      .replace(/<\/section>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    cleaned = this._decodeHtmlEntities(cleaned)
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 20)
      .join('\n')
      .slice(0, 12000);

    return {
      title: title || '网页正文',
      content: cleaned || '未能提取到有效正文'
    };
  }

  _decodeHtmlEntities(text) {
    return String(text || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  }

  async _walkDirectory(rootPath, onEntry, options = {}) {
    const recursive = !!options.recursive;
    const includeDirectories = options.includeDirectories !== false;
    const maxResults = options.maxResults || 1000;
    const queue = [{ dir: rootPath, depth: 0 }];
    let count = 0;

    while (queue.length > 0 && count < maxResults) {
      const current = queue.shift();
      const entries = await fs.readdir(current.dir, { withFileTypes: true });

      for (const entry of entries) {
        if (count >= maxResults) break;
        const fullPath = path.join(current.dir, entry.name);
        const relativePath = path.relative(rootPath, fullPath) || entry.name;

        if (entry.isDirectory()) {
          if (includeDirectories) {
            const added = await onEntry(fullPath, entry, relativePath);
            if (added) count += 1;
            if (count >= maxResults) break;
          }

          if (recursive && current.depth < 5) {
            queue.push({ dir: fullPath, depth: current.depth + 1 });
          }
          continue;
        }

        const added = await onEntry(fullPath, entry, relativePath);
        if (added) count += 1;
      }
    }
  }

  async _resolveAppPath(appName) {
    const knownPaths = {
      notepad: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe'),
      explorer: path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'),
      calc: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'calc.exe')
    };

    if (knownPaths[appName]) {
      try {
        await fs.access(knownPaths[appName]);
        return knownPaths[appName];
      } catch {
        // fall through
      }
    }

    const aliases = {
      code: 'Code.exe',
      chrome: 'chrome.exe',
      edge: 'msedge.exe',
      firefox: 'firefox.exe'
    };

    const candidate = aliases[appName] || appName;
    return new Promise((resolve) => {
      exec(`where ${candidate}`, { windowsHide: true }, (error, stdout) => {
        if (error || !stdout) {
          resolve('');
          return;
        }
        const firstLine = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        resolve(firstLine || '');
      });
    });
  }
}

module.exports = SkillExecutor;
