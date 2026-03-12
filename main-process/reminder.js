// 提醒调度器模块
// 负责管理、调度和触发提醒任务
// CommonJS 版本 - 用于主进程

const { ipcMain, Notification } = require('electron');

// 过期任务处理策略
const OVERDUE_STRATEGY = {
  MISS: 'miss',              // 标记为错过，不触发
  CATCH_UP: 'catch_up',      // 立即触发（适用于未过期太久）
  IGNORE: 'ignore'           // 忽略，直接取消
};

class ReminderScheduler {
  constructor(storage) {
    this.storage = storage;
    this.checkInterval = null;
    this.isRunning = false;
    this.checkIntervalMs = 30000; // 30 秒检查一次
    this.mainWindow = null;

    // 过期任务配置
    this.overdueThreshold = 3600000; // 1小时内算过期，超过则忽略
    this.overdueStrategy = OVERDUE_STRATEGY.MISS;
  }

  async getNotificationTitle(reminder) {
    const metadata = this.parseReminderMetadata(reminder && reminder.metadata);
    const explicitTitle = typeof metadata.title === 'string' ? metadata.title.trim() : '';
    if (explicitTitle) return explicitTitle;

    const petName = await this.getCurrentPetName();
    return petName ? `${petName}提醒你` : '宠物提醒';
  }

  parseReminderMetadata(metadata) {
    if (!metadata) return {};
    if (typeof metadata === 'object') return metadata;

    try {
      return JSON.parse(metadata);
    } catch (error) {
      console.warn('[Reminder] Failed to parse reminder metadata:', error);
      return {};
    }
  }

  async getCurrentPetName() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return '宠物';
    }

    try {
      const selectedPet = await this.mainWindow.webContents.executeJavaScript(
        `(() => {
          try {
            const raw = localStorage.getItem('pet_data');
            if (!raw) return null;
            const petData = JSON.parse(raw);
            return petData.basePet || petData.emoji || petData.selectedPet || null;
          } catch (error) {
            return null;
          }
        })()`,
        true
      );

      const petNames = {
        '🐱': '猫咪',
        '🐶': '狗狗',
        '🐰': '兔兔',
        '🦊': '小狐',
        '🐻': '小熊'
      };

      return petNames[selectedPet] || '宠物';
    } catch (error) {
      console.warn('[Reminder] Failed to read current pet from renderer:', error);
      return '宠物';
    }
  }

  // 设置存储引用
  setStorage(storage) {
    this.storage = storage;
  }

  // 设置主窗口引用（用于发送 IPC 消息到渲染进程）
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  // 启动调度器
  async start() {
    if (this.isRunning) {
      console.log('[Reminder] Scheduler already running');
      return;
    }

    console.log('[Reminder] Starting scheduler...');
    this.isRunning = true;

    // 先检查过期任务
    await this.checkOverdueReminders();

    // 立即检查一次待处理任务
    this.checkAndTriggerReminders();

    // 定期检查
    this.checkInterval = setInterval(() => {
      this.checkAndTriggerReminders();
    }, this.checkIntervalMs);

    console.log('[Reminder] Scheduler started');
  }

  // 检查并处理过期任务（程序启动时调用）
  async checkOverdueReminders() {
    if (!this.storage || !this.storage.db) {
      console.log('[Reminder] Storage not available for overdue check');
      return;
    }

    try {
      const now = Date.now();
      console.log('[Reminder] Checking for overdue reminders...');

      // 获取所有过期但状态仍为 pending 的提醒
      const overdueReminders = this.storage.db.prepare(`
        SELECT * FROM reminders
        WHERE status = 'pending'
        AND remind_at < ?
        ORDER BY remind_at ASC
      `).all(now - 60000); // 至少过期1分钟

      if (overdueReminders.length === 0) {
        console.log('[Reminder] No overdue reminders found');
        return;
      }

      console.log(`[Reminder] Found ${overdueReminders.length} overdue reminders`);

      const stats = {
        markedMissed: 0,
        caughtUp: 0,
        cancelled: 0
      };

      for (const reminder of overdueReminders) {
        const overdueMs = now - reminder.remind_at;

        // 根据过期时长决定处理策略
        if (overdueMs > this.overdueThreshold * 2) {
          // 超过2小时，直接取消
          this.cancelReminder(reminder.id);
          stats.cancelled++;
          console.log(`[Reminder] Cancelled long-overdue: ${reminder.content} (${Math.round(overdueMs/60000)}min late)`);

        } else if (overdueMs > this.overdueThreshold) {
          // 1-2小时，标记为错过
          this.markReminderAsMissed(reminder.id, now);
          stats.markedMissed++;
          console.log(`[Reminder] Marked as missed: ${reminder.content} (${Math.round(overdueMs/60000)}min late)`);

        } else {
          // 1小时内，根据策略决定
          if (this.overdueStrategy === OVERDUE_STRATEGY.CATCH_UP) {
            // 立即触发
            await this.triggerReminder(reminder);
            stats.caughtUp++;
          } else {
            // 标记为错过
            this.markReminderAsMissed(reminder.id, now);
            stats.markedMissed++;
          }
        }

        // 记录到历史
        this.saveToHistory(reminder, now, null);
      }

      console.log(`[Reminder] Overdue check complete: ${stats.markedMissed} missed, ${stats.caughtUp} caught up, ${stats.cancelled} cancelled`);

      // 通知渲染进程有过期任务
      if (this.mainWindow && !this.mainWindow.isDestroyed() && stats.markedMissed > 0) {
        this.mainWindow.webContents.send('reminder:overdue', {
          total: overdueReminders.length,
          missed: stats.markedMissed,
          caughtUp: stats.caughtUp,
          cancelled: stats.cancelled
        });
      }

    } catch (error) {
      console.error('[Reminder] Error checking overdue reminders:', error);
    }
  }

  // 标记提醒为错过
  markReminderAsMissed(id, completedAt) {
    if (!this.storage || !this.storage.db) return;

    try {
      const stmt = this.storage.db.prepare(`
        UPDATE reminders
        SET status = 'missed',
            completed_at = ?
        WHERE id = ?
      `);

      stmt.run(completedAt, id);
    } catch (error) {
      console.error('[Reminder] Failed to mark reminder as missed:', error);
    }
  }

  // 保存提醒到历史表
  saveToHistory(reminder, completedAt, delayMinutes) {
    if (!this.storage || !this.storage.db) return;

    try {
      const metadata = reminder.metadata ? JSON.parse(reminder.metadata) : {};

      const stmt = this.storage.db.prepare(`
        INSERT INTO reminder_history (
          id, reminder_id, content, created_at, remind_at,
          completed_at, delay_minutes, vague_keyword, personality, mood
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        this.generateId(),
        reminder.id,
        reminder.content,
        reminder.created_at,
        reminder.remind_at,
        completedAt,
        delayMinutes,
        metadata.vagueKeyword || null,
        metadata.personality || null,
        metadata.mood || null
      );

    } catch (error) {
      console.error('[Reminder] Failed to save to history:', error);
    }
  }

  // 获取用户对模糊时间词的偏好（从历史记录中学习）
  getUserTimePreference(keyword) {
    if (!this.storage || !this.storage.db) return null;

    try {
      // 查询该关键词的平均延迟
      const stmt = this.storage.db.prepare(`
        SELECT AVG(delay_minutes) as avg_delay, COUNT(*) as count
        FROM reminder_history
        WHERE vague_keyword = ?
        GROUP BY vague_keyword
      `);

      const result = stmt.get(keyword);

      if (result && result.count >= 3) {
        // 至少有3条记录才认为是可靠数据
        return {
          keyword,
          avgMinutes: Math.round(result.avg_delay),
          sampleSize: result.count
        };
      }

      return null;
    } catch (error) {
      console.error('[Reminder] Failed to get user preference:', error);
      return null;
    }
  }

  // 分析用户的提醒习惯
  analyzeUserHabits() {
    if (!this.storage || !this.storage.db) return null;

    try {
      const stmt = this.storage.db.prepare(`
        SELECT
          vague_keyword,
          COUNT(*) as count,
          AVG(delay_minutes) as avg_delay,
          MIN(delay_minutes) as min_delay,
          MAX(delay_minutes) as max_delay
        FROM reminder_history
        WHERE vague_keyword IS NOT NULL
        GROUP BY vague_keyword
        ORDER BY count DESC
      `);

      return stmt.all();
    } catch (error) {
      console.error('[Reminder] Failed to analyze habits:', error);
      return [];
    }
  }

  // 停止调度器
  stop() {
    if (!this.isRunning) return;

    console.log('[Reminder] Stopping scheduler...');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[Reminder] Scheduler stopped');
  }

  // 检查并触发到期的提醒
  async checkAndTriggerReminders() {
    try {
      const now = Date.now();
      const dueReminders = this.getDueReminders(now);

      for (const reminder of dueReminders) {
        await this.triggerReminder(reminder);
      }
    } catch (error) {
      console.error('[Reminder] Error checking reminders:', error);
    }
  }

  // 获取到期的提醒
  getDueReminders(beforeTime) {
    if (!this.storage || !this.storage.db) {
      return [];
    }

    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM reminders 
        WHERE status = 'pending' 
        AND remind_at <= ?
        ORDER BY remind_at ASC
      `);
      
      return stmt.all(beforeTime);
    } catch (error) {
      console.error('[Reminder] Failed to get due reminders:', error);
      return [];
    }
  }

  // 触发提醒
  async triggerReminder(reminder) {
    console.log(`[Reminder] Triggering reminder: ${reminder.id} - ${reminder.content}`);

    const now = Date.now();
    const delayMinutes = Math.round((now - reminder.remind_at) / 60000); // 可能为负（提前完成）

    try {
      // 1. 更新状态为已完成
      this.completeReminder(reminder.id, now);

      // 2. 发送系统通知
      await this.showNotification(reminder);

      // 3. 通知渲染进程（让宠物"说话"）
      this.notifyRenderer(reminder);

      // 4. 保存到历史
      this.saveToHistory(reminder, now, delayMinutes);

      // 5. 处理重复任务
      if (reminder.repeat_pattern) {
        this.scheduleNextRepeat(reminder);
      }

    } catch (error) {
      console.error('[Reminder] Failed to trigger reminder:', error);
    }
  }

  // 显示系统通知
  async showNotification(reminder) {
    try {
      const title = await this.getNotificationTitle(reminder);
      const notification = new Notification({
        title,
        body: reminder.content,
        icon: './assets/icon.png',
        silent: false
      });

      notification.show();

      // 点击通知时聚焦主窗口
      notification.on('click', () => {
        if (this.mainWindow) {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      });

    } catch (error) {
      console.error('[Reminder] Failed to show notification:', error);
    }
  }

  // 通知渲染进程
  notifyRenderer(reminder) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('reminder:triggered', {
        id: reminder.id,
        content: reminder.content,
        timestamp: Date.now()
      });
    }
  }

  // 创建提醒
  createReminder(reminderData) {
    console.log('[Reminder] createReminder called with:', JSON.stringify(reminderData));
    console.log('[Reminder] this.storage:', this.storage ? 'exists' : 'null');
    console.log('[Reminder] this.storage.db:', this.storage && this.storage.db ? 'exists' : 'null');

    if (!this.storage) {
      console.error('[Reminder] Storage is null');
      throw new Error('Storage not initialized');
    }

    if (!this.storage.db) {
      console.error('[Reminder] Storage.db is null, storage:', Object.keys(this.storage));
      throw new Error('Storage database not initialized');
    }

    const {
      content,
      remindAt,
      sourceConversationId = null,
      repeatPattern = null,
      repeatEndAt = null,
      metadata = null
    } = reminderData;

    console.log('[Reminder] Extracted fields:', { content, remindAt, sourceConversationId, repeatPattern });

    if (!content || !remindAt) {
      throw new Error('Content and remindAt are required');
    }

    const id = this.generateId();
    const now = Date.now();

    try {
      const stmt = this.storage.db.prepare(`
        INSERT INTO reminders (id, content, remind_at, created_at, status, source_conversation_id, repeat_pattern, repeat_end_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        content,
        remindAt,
        now,
        'pending',
        sourceConversationId,
        repeatPattern,
        repeatEndAt,
        metadata ? JSON.stringify(metadata) : null
      );

      console.log(`[Reminder] Created: ${id} at ${new Date(remindAt).toLocaleString()}`);

      return {
        id,
        content,
        remindAt,
        status: 'pending'
      };

    } catch (error) {
      console.error('[Reminder] Failed to create reminder:', error);
      throw error;
    }
  }

  // 完成提醒
  completeReminder(id, completedAt = null) {
    if (!this.storage || !this.storage.db) return;

    const timestamp = completedAt || Date.now();

    try {
      const stmt = this.storage.db.prepare(`
        UPDATE reminders
        SET status = 'completed',
            completed_at = ?
        WHERE id = ?
      `);

      stmt.run(timestamp, id);
    } catch (error) {
      console.error('[Reminder] Failed to complete reminder:', error);
    }
  }

  // 取消提醒
  cancelReminder(id) {
    if (!this.storage || !this.storage.db) return false;

    try {
      const stmt = this.storage.db.prepare(`
        UPDATE reminders
        SET status = 'cancelled'
        WHERE id = ? AND status = 'pending'
      `);

      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      console.error('[Reminder] Failed to cancel reminder:', error);
      return false;
    }
  }

  // 删除提醒
  deleteReminder(id) {
    if (!this.storage || !this.storage.db) return false;

    try {
      const stmt = this.storage.db.prepare('DELETE FROM reminders WHERE id = ?');
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      console.error('[Reminder] Failed to delete reminder:', error);
      return false;
    }
  }

  // 获取提醒列表
  getReminders(options = {}) {
    if (!this.storage || !this.storage.db) {
      return [];
    }

    const {
      status = null,
      limit = 100,
      offset = 0,
      from = null,
      to = null
    } = options;

    let query = 'SELECT * FROM reminders WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (from) {
      query += ' AND remind_at >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND remind_at <= ?';
      params.push(to);
    }

    query += ' ORDER BY remind_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      const stmt = this.storage.db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('[Reminder] Failed to get reminders:', error);
      return [];
    }
  }

  // 获取待处理提醒
  getPendingReminders() {
    return this.getReminders({ status: 'pending' });
  }

  // 获取今日提醒
  getTodayReminders() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

    return this.getReminders({
      from: startOfDay,
      to: endOfDay
    });
  }

  // 安排下一次重复任务
  scheduleNextRepeat(reminder) {
    if (!reminder.repeat_pattern) return;

    const nextTime = this.calculateNextRepeatTime(reminder);
    if (!nextTime) return;

    // 检查是否超过结束时间
    if (reminder.repeat_end_at && nextTime > reminder.repeat_end_at) {
      console.log(`[Reminder] Repeat ended for ${reminder.id}`);
      return;
    }

    try {
      this.createReminder({
        content: reminder.content,
        remindAt: nextTime,
        sourceConversationId: reminder.source_conversation_id,
        repeatPattern: reminder.repeat_pattern,
        repeatEndAt: reminder.repeat_end_at,
        metadata: reminder.metadata ? JSON.parse(reminder.metadata) : null
      });

      console.log(`[Reminder] Scheduled next repeat for ${nextTime}`);
    } catch (error) {
      console.error('[Reminder] Failed to schedule next repeat:', error);
    }
  }

  // 计算下一次重复时间
  calculateNextRepeatTime(reminder) {
    const current = reminder.remind_at;
    const pattern = reminder.repeat_pattern;

    switch (pattern) {
      case 'daily':
        return current + 24 * 60 * 60 * 1000;
      case 'weekly':
        return current + 7 * 24 * 60 * 60 * 1000;
      case 'monthly':
        // 简化处理：加 30 天
        return current + 30 * 24 * 60 * 60 * 1000;
      case 'yearly':
        // 简化处理：加 365 天
        return current + 365 * 24 * 60 * 60 * 1000;
      default:
        // 尝试解析为毫秒数（数字字符串）
        const interval = parseInt(pattern, 10);
        if (!isNaN(interval) && interval > 0) {
          return current + interval;
        }
        return null;
    }
  }

  // 获取提醒历史
  getReminderHistory(options = {}) {
    if (!this.storage || !this.storage.db) {
      return [];
    }

    const {
      limit = 100,
      offset = 0,
      vagueKeyword = null
    } = options;

    let query = 'SELECT * FROM reminder_history WHERE 1=1';
    const params = [];

    if (vagueKeyword) {
      query += ' AND vague_keyword = ?';
      params.push(vagueKeyword);
    }

    query += ' ORDER BY completed_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      const stmt = this.storage.db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('[Reminder] Failed to get reminder history:', error);
      return [];
    }
  }

  // 注册 IPC 处理器
  registerIPCHandlers() {
    // 创建提醒
    ipcMain.handle('reminder:create', async (event, data) => {
      return this.createReminder(data);
    });

    // 获取提醒列表
    ipcMain.handle('reminder:get-all', async (event, options) => {
      return this.getReminders(options);
    });

    // 获取待处理提醒
    ipcMain.handle('reminder:get-pending', async () => {
      return this.getPendingReminders();
    });

    // 获取今日提醒
    ipcMain.handle('reminder:get-today', async () => {
      return this.getTodayReminders();
    });

    // 取消提醒
    ipcMain.handle('reminder:cancel', async (event, id) => {
      return this.cancelReminder(id);
    });

    // 删除提醒
    ipcMain.handle('reminder:delete', async (event, id) => {
      return this.deleteReminder(id);
    });

    // 获取用户时间偏好
    ipcMain.handle('reminder:get-preference', async (event, keyword) => {
      return this.getUserTimePreference(keyword);
    });

    // 分析用户习惯
    ipcMain.handle('reminder:analyze-habits', async () => {
      return this.analyzeUserHabits();
    });

    // 获取提醒历史
    ipcMain.handle('reminder:get-history', async (event, options) => {
      return this.getReminderHistory(options);
    });

    console.log('[Reminder] IPC handlers registered');
  }

  // 生成唯一 ID
  generateId() {
    return `rem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = ReminderScheduler;
