// 技能执行器
// 接收 LLM 的 tool_call，路由到对应的处理器执行
// 支持 Node.js 内置处理器和 Python 工具层

const { exec } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
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
// 注意：使用 toLowerCase() 做不区分大小写匹配，防止大小写绕过
const DANGEROUS_COMMANDS = [
  // 磁盘/系统破坏
  'format', 'diskpart', 'bcdedit',
  'reg delete', 'reg add',
  'net stop', 'net user', 'sc delete', 'taskkill /f',
  'Remove-Item -Recurse -Force C:', 'rm -rf /',
  'del /s /q C:', 'rd /s /q C:',
  // PowerShell 编码执行绕过（-enc / -encodedcommand 可隐藏真实命令）
  '-enc', '-encodedcommand', '-encoded',
  // PowerShell 危险执行绕过策略
  '-executionpolicy bypass', '-exec bypass',
  // PowerShell 远程执行 / 下载执行
  'invoke-expression', 'iex ',
  'invoke-webrequest', 'iwr ',
  'invoke-restmethod',
  'downloadstring', 'downloadfile',
  'system.net.webclient',
  // PowerShell 进程启动
  'start-process', 'start-job',
  // 注册表写入（hklm/hkcu 高危键）
  'set-itemproperty hklm', 'set-itemproperty hkcu',
  'new-service',
];

class SkillExecutor {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.memorySystem = options.memorySystem || null;
    this.workflowManager = options.workflowManager || null;
    this.weatherService = options.weatherService || new WeatherService();
    this.screenshotOCR = typeof options.screenshotOCR === 'function' ? options.screenshotOCR : null;
    this.historyFilePath = typeof options.historyFilePath === 'string' ? options.historyFilePath : '';
    this.executionHistory = this._readExecutionHistory();
    if (options.weatherDefaultCity) {
      this.weatherService.setPreferredCity(options.weatherDefaultCity);
    }
    this.mainWindow = null;

    // 技能名 → 现有 WorkflowManager 工具名映射（向后兼容）
    this._legacyMapping = {};

    this._builtinHandlers = {
      bash_run: this._bashRun.bind(this),
      file_write: this._fileWrite.bind(this),
      file_read: this._fileRead.bind(this),  // 原生实现，绕过 Python 层（< 50ms）
      file_edit: this._fileEdit.bind(this),
      multi_file_edit: this._multiFileEdit.bind(this),
      file_list: this._fileList.bind(this),
      file_search: this._fileSearch.bind(this),
      grep_search: this._grepSearch.bind(this),
      memory_search: this._memorySearch.bind(this),
      git_ops: this._gitOps.bind(this),
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
      const resolvedToolName = this._resolveToolName(toolName);
      const result = await this._route(resolvedToolName, args, skill, options);
      const duration = Date.now() - startTime;
      const finalResult = { ...result, duration };
      this._recordExecution(toolName, args, finalResult, options);
      return finalResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const finalResult = { success: false, error: error.message, duration };
      this._recordExecution(toolName, args, finalResult, options);
      return finalResult;
    }
  }

  getExecutionHistory(limit = 50) {
    return this.executionHistory.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
  }

  clearExecutionHistory() {
    this.executionHistory = [];
    this._writeExecutionHistory();
    return true;
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

  _resolveToolName(toolName) {
    if (!this.registry || typeof this.registry.getResolvedHandlerName !== 'function') {
      return toolName;
    }
    return this.registry.getResolvedHandlerName(toolName);
  }

  _readExecutionHistory() {
    if (!this.historyFilePath || !fsSync.existsSync(this.historyFilePath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fsSync.readFileSync(this.historyFilePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('[SkillExecutor] 读取执行历史失败:', error.message);
      return [];
    }
  }

  _writeExecutionHistory() {
    if (!this.historyFilePath) return;
    fsSync.writeFileSync(this.historyFilePath, JSON.stringify(this.executionHistory, null, 2), 'utf8');
  }

  _recordExecution(toolName, args, result, options = {}) {
    const entry = {
      id: `skill_exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      resolvedToolName: this._resolveToolName(toolName),
      success: result?.success !== false,
      error: result?.error || null,
      duration: result?.duration || null,
      args: args || {},
      result: Object.prototype.hasOwnProperty.call(result || {}, 'result') ? result.result : result,
      createdAt: Date.now(),
      origin: options.origin || (options?.context?.sessionId ? 'agent' : 'direct'),
      sessionId: options?.context?.sessionId || null
    };

    this.executionHistory.unshift(entry);
    if (this.executionHistory.length > 200) {
      this.executionHistory = this.executionHistory.slice(0, 200);
    }
    this._writeExecutionHistory();
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
      const MAX_OUTPUT = 1024 * 1024; // 1MB 上限，防无限累积

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        if (streamCallback) streamCallback({ type: 'stdout', text });
        if (stdout.length < MAX_OUTPUT) stdout += text;
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (streamCallback) streamCallback({ type: 'stderr', text });
        if (stderr.length < MAX_OUTPUT) stderr += text;
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

  async _multiFileEdit(args) {
    const { edits = [], description = '' } = args;

    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, error: '缺少 edits 数组参数' };
    }
    if (edits.length > 10) {
      return { success: false, error: '单次最多支持 10 个文件编辑' };
    }

    const previews = [];
    for (const edit of edits) {
      const previewResult = await this._fileEdit(edit, { previewOnly: true });
      if (!previewResult.success) {
        return {
          success: false,
          error: `预检失败 [${edit.path}]: ${previewResult.error}`,
          failedAt: edit.path
        };
      }
      previews.push(previewResult.result);
    }

    const backups = new Map();
    for (const edit of edits) {
      try {
        const expandedPath = String(edit.path || '').replace(/^~/, os.homedir());
        const content = await fs.readFile(expandedPath, 'utf8').catch(() => null);
        backups.set(expandedPath, content);
      } catch {
        backups.set(edit.path, null);
      }
    }

    const applied = [];
    for (const edit of edits) {
      const result = await this._fileEdit(edit, {});
      if (!result.success) {
        for (const [filePath, originalContent] of backups) {
          try {
            if (originalContent === null) {
              await fs.unlink(filePath).catch(() => {});
            } else {
              await fs.writeFile(filePath, originalContent, 'utf8');
            }
          } catch {
            // 回滚失败也继续
          }
        }
        return {
          success: false,
          error: `写入失败已全部回滚 [${edit.path}]: ${result.error}`,
          appliedBeforeFailure: applied,
          rolledBack: true
        };
      }
      applied.push(edit.path);
    }

    return {
      success: true,
      result: {
        description,
        filesEdited: applied.length,
        files: applied,
        previews
      }
    };
  }

  // file_read：读取文件（Node.js 原生实现，支持 offset/limit 行范围）
  async _fileRead(args) {
    const { path: filePath, encoding = 'utf8', offset = 0, limit = 0 } = args;

    if (!filePath) {
      return { success: false, error: '缺少 path 参数' };
    }

    const expandedPath = String(filePath).replace(/^~/, os.homedir());

    // 安全路径校验
    const safetyCheck = this._validatePath(expandedPath);
    if (!safetyCheck.safe) {
      return { success: false, error: safetyCheck.reason };
    }

    try {
      const stat = await fs.stat(expandedPath);
      if (stat.size > 5 * 1024 * 1024) {
        return { success: false, error: '文件超过 5MB 限制' };
      }
      let content = await fs.readFile(expandedPath, encoding);
      const lines = content.split('\n');
      const totalLines = lines.length;
      const parsedOffset = Number(offset);
      const parsedLimit = Number(limit);

      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        return { success: false, error: 'offset 必须是大于等于 0 的数字' };
      }
      if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
        return { success: false, error: 'limit 必须是大于等于 0 的数字' };
      }

      const start = parsedOffset > 0 ? parsedOffset - 1 : 0;
      const end = parsedLimit > 0 ? start + parsedLimit : lines.length;

      if (parsedOffset > 0 || parsedLimit > 0) {
        content = lines.slice(start, end).join('\n');
      }

      return {
        success: true,
        result: {
          path: expandedPath,
          content,
          totalLines,
          size: stat.size,
          truncated: parsedLimit > 0 && end < totalLines
        }
      };
    } catch (error) {
      return { success: false, error: `读取失败: ${error.message}` };
    }
  }

  async _fileWrite(args) {
    const { path: filePath, content = '', encoding = 'utf8', create_dirs = true } = args;

    if (!filePath) {
      return { success: false, error: 'missing path parameter' };
    }

    const expandedPath = String(filePath).replace(/^~/, os.homedir());
    const safeCheck = this._validatePath(expandedPath);
    if (!safeCheck.safe) {
      return { success: false, error: safeCheck.reason };
    }

    try {
      if (create_dirs) {
        await fs.mkdir(path.dirname(expandedPath), { recursive: true });
      }
      await fs.writeFile(expandedPath, content, encoding);
      const stat = await fs.stat(expandedPath);
      return {
        success: true,
        result: {
          path: expandedPath,
          size: stat.size
        }
      };
    } catch (e) {
      return { success: false, error: `write failed: ${e.message}` };
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
    const { content, repeat } = args;
    let { remindAt } = args;

    if (!content || !remindAt) {
      return { success: false, error: '缺少 content 或 remindAt 参数' };
    }

    const remindAtMs = Number(remindAt);
    if (!Number.isFinite(remindAtMs) || remindAtMs <= Date.now()) {
      return { success: false, error: 'remindAt 必须是有效的未来时间戳（Unix毫秒）' };
    }
    remindAt = remindAtMs;

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

  // web_search：多级降级搜索
  // 经过实测：html.duckduckgo.com 在本机可达（中国可用）且返回真实结果
  // Bing HTML / Bing News RSS 需要 JS 渲染或 Cookie，静态 HTML 请求无有效结果
  async _webSearch(args) {
    const { query, maxResults = 5 } = args;

    if (!query) {
      return { success: false, error: '缺少 query 参数' };
    }

    try {
      const limit = Math.max(1, Math.min(10, Number(maxResults) || 5));
      if (this._looksLikeWeiboHotQuery(query)) {
        const hotResults = await this._safeSearch(() => this._searchWeiboHotSearch(limit));
        if (hotResults.length > 0) {
          return {
            success: true,
            result: {
              count: hotResults.length,
              results: hotResults,
              mode: 'ranking',
              note: 'Structured ranking results can be answered directly without fetching every item page.'
            }
          };
        }
      }
      const isNews = this._looksLikeNewsQuery(query);
      let results = [];

      // 阶段 1：DuckDuckGo HTML（主力，静态 HTML 无 JS 依赖，经实测可用）
      results = await this._safeSearch(() => this._searchDuckDuckGoHtml(query, limit));

      // 阶段 2：DuckDuckGo Instant Answer（知识卡片补充，对新闻类查询通常无结果）
      if (results.length < limit) {
        results = await this._safeSearch(() => this._searchDuckDuckGoInstant(query, limit, results), results);
      }

      // 阶段 3：人民网 RSS（新闻类，始终追加以保证有今日实时内容）
      // 注意：不用 results.length < limit 做门控，确保今日热点混入结果
      if (isNews) {
        const rssLimit = limit + 5; // 先多取再截，保证多样性
        results = await this._safeSearch(() => this._searchPeopleNewsRss(query, rssLimit, results), results);
        results = this._dedupeSearchResults(results);
      }

      // 阶段 4：Google News RSS（新闻类最终备用）
      if (results.length < limit && isNews) {
        results = await this._safeSearch(() => this._searchGoogleNewsRss(query, limit, results), results);
      }

      return {
        success: true,
        result: {
          count: results.length,
          results,
          note: results.length === 0 ? '未找到网页结果，可能是网络问题或该内容暂无公开索引。' : undefined
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `网络搜索失败: ${error.message}`,
        originalError: error.message
      };
    }
  }

  async _safeSearch(fn, fallback = []) {
    try {
      const result = await fn();
      return Array.isArray(result) ? result : fallback;
    } catch {
      return fallback;
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
      const html = await this._fetchTextUrl(parsedUrl.toString(), 0, 8000);
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

  async _searchDuckDuckGoInstant(query, maxResults, seedResults = []) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('解析 DuckDuckGo Instant Answer 结果失败'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('DuckDuckGo Instant Answer 请求超时'));
      });
    });

    const results = Array.isArray(seedResults) ? [...seedResults] : [];
    if (data.Abstract) {
      results.push({
        title: data.Heading || '摘要',
        snippet: data.Abstract,
        url: data.AbstractURL || ''
      });
    }

    const topicQueue = Array.isArray(data.RelatedTopics) ? [...data.RelatedTopics] : [];
    while (topicQueue.length > 0 && results.length < maxResults) {
      const topic = topicQueue.shift();
      if (!topic || typeof topic !== 'object') continue;
      if (Array.isArray(topic.Topics)) {
        topicQueue.push(...topic.Topics);
        continue;
      }
      if (!topic.Text) continue;
      results.push({
        title: String(topic.Text).slice(0, 50),
        snippet: topic.Text,
        url: topic.FirstURL || ''
      });
    }

    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  // DuckDuckGo HTML 搜索（经实测：html.duckduckgo.com 返回静态 HTML，含 10 条结果）
  // 修复：旧正则匹配 class="result__body" 但实际 class 为 "links_main links_deep result__body"
  //       DDG 链接格式为 //duckduckgo.com/l/?uddg=ENCODED_URL 需要解码
  async _searchDuckDuckGoHtml(query, maxResults, seedResults = []) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await this._fetchTextUrl(url, 0);
    const results = Array.isArray(seedResults) ? [...seedResults] : [];

    // 直接从 class="result__a" 链接提取（无需依赖外层块正则）
    const titleLinks = [...html.matchAll(/<a[^>]*\bclass="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const snippets = [...html.matchAll(/<a[^>]*\bclass="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*\bclass="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];

    for (let i = 0; i < titleLinks.length && results.length < maxResults; i++) {
      const href = this._decodeHtmlEntities(titleLinks[i][1]);
      // 解码 DDG 跳转链接：//duckduckgo.com/l/?uddg=REAL_URL
      const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
      let realUrl = uddgMatch
        ? decodeURIComponent(uddgMatch[1])
        : href.startsWith('//') ? 'https:' + href : href;
      if (!realUrl.startsWith('http')) continue;
      const title = this._decodeHtmlEntities(titleLinks[i][2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (!title) continue;
      const snippetRaw = snippets[i] ? (snippets[i][1] || snippets[i][2] || '') : '';
      const snippet = this._decodeHtmlEntities(String(snippetRaw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      results.push({ title, snippet, url: realUrl });
    }

    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  // 人民网 RSS — 国内直连稳定，每日实时 100 条，实测 HTTP 200（2026-03-17）
  // 三个频道：政治/社会/国际，结合覆盖当日主要新闻
  async _searchPeopleNewsRss(query, maxResults, seedResults = []) {
    const feeds = [
      'http://www.people.com.cn/rss/society.xml',  // 社会（趣闻/生活最相关）
      'http://www.people.com.cn/rss/politics.xml', // 政治/国内
      'http://www.people.com.cn/rss/world.xml',    // 国际
    ];
    const results = Array.isArray(seedResults) ? [...seedResults] : [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;

    for (const feedUrl of feeds) {
      if (results.length >= maxResults) break;
      try {
        const xml = await this._fetchTextUrl(feedUrl, 0);
        itemRegex.lastIndex = 0;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && results.length < maxResults) {
          const item = match[1];
          const title = this._decodeHtmlEntities(
            (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
              || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
              || '').replace(/\s+/g, ' ').trim()
          );
          const rawUrl = this._decodeHtmlEntities(
            (item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim()
          );
          const description = this._decodeHtmlEntities(
            (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1]
              || item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]
              || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          );
          const pubDate = this._decodeHtmlEntities(
            (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim()
          );
          if (!title) continue;
          results.push({
            title,
            snippet: [description.slice(0, 120), pubDate].filter(Boolean).join(' | '),
            url: rawUrl
          });
        }
      } catch {
        // 单个 feed 失败不影响其他
      }
    }

    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  async _searchGoogleNewsRss(query, maxResults, seedResults = []) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
    const xml = await this._fetchTextUrl(url, 0);
    const results = Array.isArray(seedResults) ? [...seedResults] : [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && results.length < maxResults) {
      const item = match[1];
      const title = this._decodeHtmlEntities((item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
        || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
        || '').replace(/\s+/g, ' ').trim());
      const rawUrl = this._decodeHtmlEntities((item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim());
      const source = this._decodeHtmlEntities((item.match(/<source[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/source>/i)?.[1]
        || item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1]
        || '').replace(/\s+/g, ' ').trim());
      const pubDate = this._decodeHtmlEntities((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim());
      if (!title) continue;
      results.push({
        title,
        snippet: [source, pubDate].filter(Boolean).join(' | '),
        url: rawUrl
      });
    }

    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  async _searchWeiboHotSearch(maxResults, seedResults = []) {
    let results = Array.isArray(seedResults) ? [...seedResults] : [];

    results = await this._safeSearch(() => this._searchWeiboHotSearchHtml(maxResults, results), results);
    if (results.length >= maxResults) {
      return this._dedupeSearchResults(results).slice(0, maxResults);
    }

    results = await this._safeSearch(() => this._searchWeiboHotSearchAjax(maxResults, results), results);
    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  async _searchWeiboHotSearchHtml(maxResults, seedResults = []) {
    const html = await this._fetchTextUrl('https://s.weibo.com/top/summary?cate=realtimehot', 0, 10000);
    const results = Array.isArray(seedResults) ? [...seedResults] : [];
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const rowMatch of rows) {
      if (results.length >= maxResults) break;
      const rowHtml = rowMatch[1];
      const linkMatch = rowHtml.match(/<td[^>]*class="td-02"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      const rank = (rowHtml.match(/class="td-01(?: ranktop)?"[^>]*>\s*(\d+)/i)?.[1] || '').trim();
      const title = this._decodeHtmlEntities(linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (!title || /公告|主持人|话题榜/i.test(title)) continue;

      const rawUrl = this._decodeHtmlEntities(linkMatch[1]).trim();
      const url = rawUrl.startsWith('http')
        ? rawUrl
        : `https://s.weibo.com${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
      const hotValue = this._decodeHtmlEntities(
        (rowHtml.match(/<span[^>]*>\s*(\d+(?:\.\d+)?万?)\s*<\/span>/i)?.[1] || '').trim()
      );

      results.push({
        title: rank ? `${rank}. ${title}` : title,
        snippet: [rank ? `Rank ${rank}` : '', hotValue ? `Hot ${hotValue}` : '', 'Source: Weibo realtime hot search']
          .filter(Boolean)
          .join(' | '),
        url
      });
    }

    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  async _searchWeiboHotSearchAjax(maxResults, seedResults = []) {
    const body = await this._fetchTextUrl('https://weibo.com/ajax/side/hotSearch', 0, 10000);
    const data = JSON.parse(body);
    const list = Array.isArray(data?.data?.realtime) ? data.data.realtime : [];
    const results = Array.isArray(seedResults) ? [...seedResults] : [];

    for (const item of list) {
      if (results.length >= maxResults) break;
      const word = String(item?.word || '').trim();
      if (!word) continue;

      const rank = String(item?.rank || item?.realpos || '').trim();
      const hotValue = String(item?.num || item?.raw_hot || item?.hotvalue || '').trim();
      const scheme = String(item?.word_scheme || '').trim();
      const url = scheme
        ? `https://s.weibo.com/weibo?q=${encodeURIComponent(scheme)}`
        : `https://s.weibo.com/weibo?q=${encodeURIComponent(word)}`;

      results.push({
        title: rank ? `${rank}. ${word}` : word,
        snippet: [rank ? `Rank ${rank}` : '', hotValue ? `Hot ${hotValue}` : '', 'Source: Weibo hot search API']
          .filter(Boolean)
          .join(' | '),
        url
      });
    }

    return this._dedupeSearchResults(results).slice(0, maxResults);
  }

  _dedupeSearchResults(results = []) {
    const deduped = [];
    const seen = new Set();
    for (const item of results) {
      const title = String(item?.title || '').trim();
      const snippet = String(item?.snippet || '').trim();
      const url = String(item?.url || '').trim();
      if (!title && !snippet) continue;
      const key = `${url}::${title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ title, snippet, url });
    }
    return deduped;
  }

  _looksLikeNewsQuery(query) {
    return /(新闻|热点|热搜|要闻|快讯|国际|国内|今日|今天|最新|趣闻|资讯|事件|发生了什么|latest news|breaking news|headline|news|today)/i.test(String(query || ''));
  }

  _looksLikeWeiboHotQuery(query) {
    return /(微博).*(热搜|热榜|热度榜|热门榜)|((热搜|热榜).*(微博))/i.test(String(query || ''));
  }

  async _fileList(args = {}) {
    const rootPath = String(args.path || '').replace(/^~/, os.homedir());
    const filter = String(args.filter || '*');
    const recursive = !!args.recursive;

    const safetyCheck = this._validatePath(rootPath);
    if (!safetyCheck.safe) {
      return { success: false, error: safetyCheck.reason };
    }

    let stat;
    try {
      stat = await fs.stat(rootPath);
    } catch (e) {
      return { success: false, error: `路径不存在或无权访问: ${rootPath}` };
    }
    if (!stat.isDirectory()) {
      return { success: false, error: `目录不存在: ${rootPath}` };
    }

    const matcher = this._wildcardToRegExp(filter);
    const files = [];

    await this._walkDirectory(rootPath, async (fullPath, entry, relativePath) => {
      if (!matcher.test(entry.name)) return;
      let entryStat;
      try {
        entryStat = await fs.stat(fullPath);
      } catch (e) {
        return; // 无权访问或符号链接失效，跳过该条目
      }
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

    let stat;
    try {
      stat = await fs.stat(rootPath);
    } catch (e) {
      return { success: false, error: `路径不存在或无权访问: ${rootPath}` };
    }
    if (!stat.isDirectory()) {
      return { success: false, error: `目录不存在: ${rootPath}` };
    }

    const matcher = this._wildcardToRegExp(pattern);
    const files = [];

    await this._walkDirectory(rootPath, async (fullPath, entry, relativePath) => {
      if (entry.isDirectory()) return;
      if (!matcher.test(entry.name)) return;
      let entryStat;
      try {
        entryStat = await fs.stat(fullPath);
      } catch (e) {
        return; // 无权访问或符号链接失效，跳过该条目
      }
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

  async _grepSearch(args = {}) {
    const {
      path: rootPath = '',
      pattern = '',
      file_pattern = '*',
      case_sensitive = false,
      max_results = 50,
      context_lines = 2
    } = args;

    if (!pattern) return { success: false, error: '缺少 pattern 参数' };

    const expandedRoot = String(rootPath || `${os.homedir()}\\Desktop`).replace(/^~/, os.homedir());
    const safeCheck = this._validatePath(expandedRoot);
    if (!safeCheck.safe) return { success: false, error: safeCheck.reason };

    const stat = await fs.stat(expandedRoot);
    if (!stat.isDirectory()) {
      return { success: false, error: `目录不存在: ${expandedRoot}` };
    }

    const fileMatcher = this._wildcardToRegExp(file_pattern);
    let searchRegex;
    try {
      searchRegex = new RegExp(pattern, case_sensitive ? '' : 'i');
    } catch (e) {
      return { success: false, error: `无效的正则表达式: ${e.message}` };
    }

    const matches = [];

    await this._walkDirectory(expandedRoot, async (fullPath, entry) => {
      if (entry.isDirectory()) return;
      if (!fileMatcher.test(entry.name)) return;
      if (matches.length >= max_results) return;

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          searchRegex.lastIndex = 0;
          if (!searchRegex.test(lines[i])) continue;
          const start = Math.max(0, i - context_lines);
          const end = Math.min(lines.length - 1, i + context_lines);
          matches.push({
            file: fullPath,
            line: i + 1,
            match: lines[i].trim(),
            context: lines.slice(start, end + 1).map((line, idx) => ({
              line: start + idx + 1,
              text: line,
              isMatch: start + idx === i
            }))
          });
          if (matches.length >= max_results) break;
        }
      } catch {
        // 跳过无法读取的文件
      }
      return matches.length > 0;
    }, { recursive: true, includeDirectories: false, maxResults: 500 });

    return {
      success: true,
      result: { count: matches.length, matches, truncated: matches.length >= max_results }
    };
  }

  async _gitOps(args = {}) {
    const { action, path: repoPath = '', message = '' } = args;
    const ALLOWED_ACTIONS = ['status', 'diff', 'log', 'commit', 'branch'];

    if (!ALLOWED_ACTIONS.includes(action)) {
      return { success: false, error: `不支持的 git 操作: ${action}，支持: ${ALLOWED_ACTIONS.join(', ')}` };
    }

    const expandedPath = String(repoPath || `${os.homedir()}\\Desktop`).replace(/^~/, os.homedir());
    const safeCheck = this._validatePath(expandedPath);
    if (!safeCheck.safe) return { success: false, error: safeCheck.reason };

    // commit 操作使用 spawn + 参数数组，彻底避免字符串拼接命令注入
    if (action === 'commit') {
      if (!message) {
        return { success: false, error: 'commit 操作需要提供 message 参数' };
      }
      return await new Promise((resolve) => {
        const { spawn } = require('child_process');
        // 第一步：git add -A
        const addProc = spawn('git', ['add', '-A'], { cwd: expandedPath, windowsHide: true });
        let addErr = '';
        addProc.stderr.on('data', (d) => { addErr += d.toString(); });
        addProc.on('close', (code) => {
          if (code !== 0) {
            resolve({ success: false, error: `git add 失败: ${addErr.trim()}` });
            return;
          }
          // 第二步：git commit -m <message>（参数数组，无注入风险）
          const commitProc = spawn('git', ['commit', '-m', String(message)], {
            cwd: expandedPath, windowsHide: true
          });
          let out = '', err = '';
          commitProc.stdout.on('data', (d) => { out += d.toString(); });
          commitProc.stderr.on('data', (d) => { err += d.toString(); });
          commitProc.on('close', (c) => {
            if (c !== 0) {
              resolve({ success: false, error: err.trim() || '提交失败' });
            } else {
              resolve({ success: true, result: { action, output: (out || err || '提交成功').trim().slice(0, 2000) } });
            }
          });
        });
      });
    }

    const commands = {
      status: 'git status --short',
      diff: 'git diff --stat HEAD',
      log: 'git log --oneline -10',
      branch: 'git branch -a',
    };

    const cmd = commands[action];

    return await new Promise((resolve) => {
      exec(cmd, { cwd: expandedPath, windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
        if (error && action !== 'status') {
          resolve({ success: false, error: stderr.trim() || error.message });
          return;
        }
        resolve({
          success: true,
          result: {
            action,
            output: (stdout || stderr || '(无输出)').trim().slice(0, 2000)
          }
        });
      });
    });
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

    // 禁止 UNC 网络路径（\\server\share 或 //server/share）
    if (filePath.startsWith('\\\\') || filePath.startsWith('//')) {
      return { safe: false, reason: '禁止访问 UNC 网络路径' };
    }

    // 禁止系统目录（大小写不敏感，防止 c:\windows 绕过 'Windows' 检查）
    const normalized = path.normalize(filePath).toLowerCase();
    for (const keyword of BLOCKED_PATH_KEYWORDS) {
      if (normalized.includes(keyword.toLowerCase())) {
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

  _fetchTextUrl(url, redirectCount = 0, timeoutMs = 15000) {
    if (redirectCount > 5) {
      return Promise.reject(new Error('重定向过多'));
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'http:' ? http : https;
      const req = client.get(parsedUrl, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
          'Accept-Encoding': 'identity'
        }
      }, (res) => {
        const statusCode = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          resolve(this._fetchTextUrl(nextUrl, redirectCount + 1, timeoutMs));
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
    if (!/^[\w\-.]+$/.test(candidate)) {
      return '';  // 跳过不合法的候选名，防止命令注入
    }
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
