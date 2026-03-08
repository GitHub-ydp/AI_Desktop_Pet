// Python 子进程管理器
// 管理 Python 子进程的生命周期，通过 stdin/stdout JSON 协议通信

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class PythonBridge {
  constructor(pythonPath, scriptPath) {
    this._pythonPath = pythonPath;
    this._scriptPath = scriptPath;
    this._process = null;
    this._status = 'idle'; // idle | starting | ready | busy | stopped | error
    this._pendingRequests = new Map(); // requestId -> { resolve, reject, timer }
    this._buffer = ''; // stdout 缓冲区（按行分割）
    this._crashCount = 0;
    this._crashWindowStart = 0;
    this._idleTimer = null;
    this._unavailableUntil = 0; // 不可用截止时间

    // 配置
    this._startupTimeout = 10000;   // 启动超时 10 秒
    this._executionTimeout = 30000; // 执行超时 30 秒
    this._idleTimeout = 300000;     // 空闲超时 5 分钟
    this._maxCrashesInWindow = 3;   // 60 秒内最大崩溃次数
    this._crashWindow = 60000;      // 崩溃统计窗口 60 秒
    this._cooldownPeriod = 300000;  // 不可用冷却 5 分钟
  }

  get status() {
    return this._status;
  }

  // 懒启动：确保 Python 进程可用
  async ensureProcess() {
    // 检查冷却期
    if (this._unavailableUntil > Date.now()) {
      throw new Error('Python 工具系统暂时不可用，请稍后再试');
    }

    // 已就绪，直接返回
    if (this._process && this._status === 'ready') {
      this._resetIdleTimer();
      return;
    }

    // 正在启动中，等待
    if (this._status === 'starting') {
      return this._waitForReady();
    }

    // 需要启动
    return this._startProcess();
  }

  // 执行工具调用
  async execute(tool, params, requestId) {
    await this.ensureProcess();

    return new Promise((resolve, reject) => {
      const request = {
        request_id: requestId,
        tool: tool,
        params: params || {},
        timeout: this._executionTimeout
      };

      // 设置超时
      const timer = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new Error(`工具执行超时 (${this._executionTimeout / 1000}秒)`));
      }, this._executionTimeout);

      this._pendingRequests.set(requestId, { resolve, reject, timer });

      // 发送请求到 Python
      const line = JSON.stringify(request) + '\n';
      try {
        this._process.stdin.write(line);
        this._status = 'busy';
        console.log(`[PythonBridge] 发送请求: ${tool} (${requestId})`);
      } catch (error) {
        this._pendingRequests.delete(requestId);
        clearTimeout(timer);
        reject(new Error(`发送请求失败: ${error.message}`));
      }
    });
  }

  // 中止请求
  abort(requestId) {
    const pending = this._pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('请求已取消'));
      this._pendingRequests.delete(requestId);
      return true;
    }
    return false;
  }

  // 优雅关闭
  shutdown() {
    this._clearIdleTimer();

    if (!this._process) {
      this._status = 'stopped';
      return;
    }

    console.log('[PythonBridge] 正在关闭 Python 进程...');

    // 发送关闭命令
    try {
      const shutdownMsg = JSON.stringify({
        request_id: 'shutdown',
        tool: '__shutdown__',
        params: {}
      }) + '\n';
      this._process.stdin.write(shutdownMsg);
    } catch (e) {
      // stdin 可能已关闭
    }

    // 等待 2 秒后强制 kill
    const proc = this._process;
    setTimeout(() => {
      if (proc && proc.exitCode == null && !proc.killed) {
        console.log('[PythonBridge] 强制终止 Python 进程');
        proc.kill('SIGKILL');
      }
    }, 2000);

    // 拒绝所有待处理请求
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Python 进程正在关闭'));
    }
    this._pendingRequests.clear();

    this._process = null;
    this._status = 'stopped';
  }

  // ==================== 内部方法 ====================

  // 启动 Python 进程
  _startProcess() {
    return new Promise((resolve, reject) => {
      this._status = 'starting';
      this._buffer = '';
      const spawnSpec = this._getSpawnSpec();

      console.log(`[PythonBridge] 启动 Python: ${[spawnSpec.command, ...spawnSpec.args, this._scriptPath].join(' ')}`);

      if (!this._isInterpreterAvailable(spawnSpec.command, spawnSpec.args)) {
        this._status = 'error';
        reject(new Error(`Python 解释器不存在或不可用: ${spawnSpec.command}`));
        return;
      }

      // 检查脚本路径是否存在
      if (!fs.existsSync(this._scriptPath)) {
        this._status = 'error';
        reject(new Error(`Python 脚本不存在: ${this._scriptPath}`));
        return;
      }

      const proc = spawn(spawnSpec.command, [...spawnSpec.args, this._scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true
      });

      this._process = proc;

      // 启动超时
      const startTimer = setTimeout(() => {
        this._status = 'error';
        proc.kill();
        reject(new Error('Python 进程启动超时'));
      }, this._startupTimeout);

      // 监听 stderr，等待 ready 信号
      let readyReceived = false;
      proc.stderr.on('data', (data) => {
        const text = data.toString();
        // 打印 Python 日志
        text.split('\n').filter(l => l.trim()).forEach(line => {
          console.error(`[Python] ${line}`);
        });

        // 检查 ready 信号
        if (!readyReceived && text.includes('[executor] ready')) {
          readyReceived = true;
          clearTimeout(startTimer);
          this._status = 'ready';
          this._resetIdleTimer();
          console.log('[PythonBridge] Python 进程已就绪');
          resolve();
        }
      });

      // 监听 stdout，按行解析 JSON
      proc.stdout.on('data', (data) => {
        this._buffer += data.toString();
        this._processBuffer();
      });

      // 监听进程退出
      proc.on('exit', (code, signal) => {
        console.log(`[PythonBridge] Python 进程退出: code=${code}, signal=${signal}`);
        this._process = null;
        this._clearIdleTimer();

        // 如果还没 ready 就退出了
        if (!readyReceived) {
          clearTimeout(startTimer);
          this._status = 'error';
          reject(new Error(`Python 进程启动失败 (exit code: ${code})`));
          return;
        }

        // 拒绝所有待处理请求
        for (const [id, pending] of this._pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Python 进程意外退出'));
        }
        this._pendingRequests.clear();

        // 记录崩溃
        this._recordCrash();

        if (this._status !== 'stopped') {
          this._status = 'idle';
        }
      });

      proc.on('error', (error) => {
        console.error('[PythonBridge] 进程错误:', error.message);
        this._process = null;
        this._status = 'error';

        if (!readyReceived) {
          clearTimeout(startTimer);
          reject(new Error(`Python 进程启动错误: ${error.message}`));
        }
      });
    });
  }

  _getSpawnSpec() {
    if (this._pythonPath && typeof this._pythonPath === 'object') {
      return {
        command: String(this._pythonPath.command || '').trim(),
        args: Array.isArray(this._pythonPath.args)
          ? this._pythonPath.args.map((arg) => String(arg))
          : []
      };
    }

    return {
      command: String(this._pythonPath || '').trim(),
      args: []
    };
  }

  _isInterpreterAvailable(command, args = []) {
    if (!command) {
      return false;
    }

    if (this._looksLikePath(command) && !fs.existsSync(command)) {
      return false;
    }

    try {
      const probe = spawnSync(command, [...args, '-c', 'import sys; print(sys.executable)'], {
        encoding: 'utf-8',
        timeout: this._startupTimeout,
        windowsHide: true
      });

      if (probe.status !== 0) {
        return false;
      }

      const resolvedExecutable = String(probe.stdout || '').trim();
      if (!resolvedExecutable) {
        return false;
      }

      if (process.platform === 'win32' && resolvedExecutable.includes('WindowsApps')) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn(`[PythonBridge] Python 可用性探测失败 (${command}): ${error.message}`);
      return false;
    }
  }

  _looksLikePath(command) {
    return /[\\/]/.test(command) || /^[A-Za-z]:/.test(command) || command.startsWith('.');
  }

  // 处理 stdout 缓冲区（按行分割 JSON）
  _processBuffer() {
    const lines = this._buffer.split('\n');
    // 最后一行可能不完整，保留
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed);
        this._handleResponse(response);
      } catch (e) {
        console.warn('[PythonBridge] 无法解析 stdout:', trimmed.substring(0, 200));
      }
    }
  }

  // 处理 Python 返回的响应
  _handleResponse(response) {
    const requestId = response.request_id;
    if (!requestId) {
      console.warn('[PythonBridge] 收到无 request_id 的响应');
      return;
    }

    // 心跳响应
    if (requestId === 'heartbeat') {
      return;
    }

    if (requestId === 'shutdown') {
      return;
    }

    const pending = this._pendingRequests.get(requestId);
    if (!pending) {
      console.warn(`[PythonBridge] 未找到请求: ${requestId}`);
      return;
    }

    clearTimeout(pending.timer);
    this._pendingRequests.delete(requestId);

    // 更新状态
    if (this._pendingRequests.size === 0) {
      this._status = 'ready';
      this._resetIdleTimer();
    }

    // resolve 结果
    pending.resolve(response);
  }

  // 等待进程就绪（启动中时使用）
  _waitForReady() {
    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (this._status === 'ready') {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        } else if (this._status === 'error' || this._status === 'stopped') {
          clearInterval(check);
          clearTimeout(timeout);
          reject(new Error('Python 进程启动失败'));
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(check);
        reject(new Error('等待 Python 进程就绪超时'));
      }, this._startupTimeout);
    });
  }

  // 记录崩溃
  _recordCrash() {
    const now = Date.now();
    if (now - this._crashWindowStart > this._crashWindow) {
      this._crashCount = 0;
      this._crashWindowStart = now;
    }
    this._crashCount++;

    if (this._crashCount >= this._maxCrashesInWindow) {
      console.error('[PythonBridge] 短时间内崩溃次数过多，标记为不可用');
      this._unavailableUntil = now + this._cooldownPeriod;
      this._status = 'error';
    }
  }

  // 空闲超时管理
  _resetIdleTimer() {
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      if (this._status === 'ready' && this._pendingRequests.size === 0) {
        console.log('[PythonBridge] 空闲超时，关闭 Python 进程');
        this.shutdown();
      }
    }, this._idleTimeout);
  }

  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}

module.exports = PythonBridge;
