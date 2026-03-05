// 健康提醒调度器
// 负责管理周期性健康提醒（久坐、喝水、护眼）
// CommonJS 版本 - 用于主进程

const { ipcMain, Notification } = require('electron');

// 健康提醒类型
const HEALTH_TYPES = {
  SEDENTARY: 'sedentary',  // 久坐
  WATER: 'water',          // 喝水
  EYECARE: 'eyecare',      // 护眼
  CUSTOM: 'custom'         // 自定义
};

// 默认消息模板
const DEFAULT_MESSAGES = {
  [HEALTH_TYPES.SEDENTARY]: [
    '该起来活动一下啦~',
    '坐太久了，起来走走吧~',
    '站起来伸个懒腰吧~',
    '休息一下，活动活动筋骨~'
  ],
  [HEALTH_TYPES.WATER]: [
    '记得喝水哦~',
    '补充水分很重要~',
    '该喝水啦，保持水润~',
    '来杯水吧，身体健康~'
  ],
  [HEALTH_TYPES.EYECARE]: [
    '看看远处，让眼睛休息一下~',
    '20-20-20法则：看20英尺外20秒~',
    '眼睛累了，休息一下吧~',
    '眨眨眼，看看窗外~'
  ],
  [HEALTH_TYPES.CUSTOM]: [
    '别忘了~'
  ]
};

class HealthReminderScheduler {
  constructor(storage) {
    this.storage = storage;
    this.checkInterval = null;
    this.isRunning = false;
    this.mainWindow = null;
    this.checkIntervalMs = 60000; // 1 分钟检查一次
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
      console.log('[HealthReminder] Scheduler already running');
      return;
    }

    console.log('[HealthReminder] Starting scheduler...');
    this.isRunning = true;

    // 计算并设置下次触发时间
    await this.initializeNextTriggerTimes();

    // 定期检查
    this.checkInterval = setInterval(() => {
      this.checkAndTriggerReminders();
    }, this.checkIntervalMs);

    // 立即检查一次
    this.checkAndTriggerReminders();

    console.log('[HealthReminder] Scheduler started');
  }

  // 停止调度器
  stop() {
    if (!this.isRunning) return;

    console.log('[HealthReminder] Stopping scheduler...');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[HealthReminder] Scheduler stopped');
  }

  // 初始化所有启用提醒的下次触发时间
  async initializeNextTriggerTimes() {
    if (!this.storage || !this.storage.db) return;

    try {
      const configs = this.getAllConfigs();
      const now = Date.now();

      for (const config of configs) {
        if (!config.enabled) continue;

        // 如果没有下次触发时间或已过期，计算新的
        if (!config.next_trigger_at || config.next_trigger_at <= now) {
          const nextTime = this.calculateNextTriggerTime(config, now);
          this.updateNextTriggerTime(config.id, nextTime);
        }
      }
    } catch (error) {
      console.error('[HealthReminder] Failed to initialize trigger times:', error);
    }
  }

  // 计算下次触发时间
  calculateNextTriggerTime(config, fromTime = Date.now()) {
    const intervalMs = config.interval_minutes * 60 * 1000;
    let nextTime = fromTime + intervalMs;

    // 检查时间范围限制
    if (config.start_time && config.end_time) {
      const now = new Date(fromTime);
      const [startH, startM] = config.start_time.split(':').map(Number);
      const [endH, endM] = config.end_time.split(':').map(Number);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      // 计算下次触发时间的分钟数
      const nextDate = new Date(nextTime);
      const nextMinutes = nextDate.getHours() * 60 + nextDate.getMinutes();

      // 如果超出时间范围，调整到第二天开始时间
      if (nextMinutes > endMinutes || nextMinutes < startMinutes) {
        nextDate.setDate(nextDate.getDate() + 1);
        nextDate.setHours(startH, startM, 0, 0);
        nextTime = nextDate.getTime();
      }
    }

    // 检查工作日限制
    if (config.workdays_only) {
      const nextDate = new Date(nextTime);
      const dayOfWeek = nextDate.getDay();
      // 0 = 周日, 6 = 周六
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        // 跳到下周一
        const daysUntilMonday = dayOfWeek === 0 ? 1 : 2;
        nextDate.setDate(nextDate.getDate() + daysUntilMonday);
        nextDate.setHours(9, 0, 0, 0); // 早上9点
        nextTime = nextDate.getTime();
      }
    }

    return nextTime;
  }

  // 更新下次触发时间
  updateNextTriggerTime(id, nextTime) {
    if (!this.storage || !this.storage.db) return;

    try {
      const stmt = this.storage.db.prepare(`
        UPDATE health_reminders
        SET next_trigger_at = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(nextTime, Date.now(), id);
    } catch (error) {
      console.error('[HealthReminder] Failed to update next trigger time:', error);
    }
  }

  // 检查并触发到期的提醒
  checkAndTriggerReminders() {
    if (!this.storage || !this.storage.db) return;

    try {
      const now = Date.now();

      // 获取所有到期的提醒
      const stmt = this.storage.db.prepare(`
        SELECT * FROM health_reminders
        WHERE enabled = 1
        AND next_trigger_at <= ?
        ORDER BY next_trigger_at ASC
      `);

      const dueReminders = stmt.all(now);

      for (const reminder of dueReminders) {
        this.triggerReminder(reminder);
      }
    } catch (error) {
      console.error('[HealthReminder] Error checking reminders:', error);
    }
  }

  // 触发提醒
  triggerReminder(reminder) {
    console.log(`[HealthReminder] Triggering: ${reminder.type}`);

    const now = Date.now();

    try {
      // 1. 更新最后触发时间
      const updateStmt = this.storage.db.prepare(`
        UPDATE health_reminders
        SET last_triggered_at = ?, updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(now, now, reminder.id);

      // 2. 记录触发历史
      this.saveTriggerHistory(reminder, now);

      // 3. 更新今日统计
      this.updateDailyStats(reminder.type, now);

      // 4. 计算并设置下次触发时间
      const nextTime = this.calculateNextTriggerTime(reminder, now);
      this.updateNextTriggerTime(reminder.id, nextTime);

      // 5. 获取提醒消息
      const message = this.getReminderMessage(reminder);

      // 6. 发送系统通知
      this.showNotification(reminder.type, message);

      // 7. 通知渲染进程（让宠物"说话"）
      this.notifyRenderer(reminder, message);

    } catch (error) {
      console.error('[HealthReminder] Failed to trigger reminder:', error);
    }
  }

  // 获取提醒消息
  getReminderMessage(reminder) {
    // 优先使用自定义消息
    if (reminder.custom_message) {
      return reminder.custom_message;
    }

    // 从默认消息池随机选择
    const messages = DEFAULT_MESSAGES[reminder.type] || DEFAULT_MESSAGES[HEALTH_TYPES.CUSTOM];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // 保存触发历史
  saveTriggerHistory(reminder, triggeredAt) {
    if (!this.storage || !this.storage.db) return;

    try {
      const id = `health-hist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const stmt = this.storage.db.prepare(`
        INSERT INTO health_reminder_history (id, reminder_id, reminder_type, triggered_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, reminder.id, reminder.type, triggeredAt, triggeredAt);
    } catch (error) {
      console.error('[HealthReminder] Failed to save history:', error);
    }
  }

  // 更新每日统计
  updateDailyStats(type, timestamp) {
    if (!this.storage || !this.storage.db) return;

    try {
      const date = new Date(timestamp).toISOString().split('T')[0]; // YYYY-MM-DD
      const now = Date.now();

      // 尝试插入或更新
      const existing = this.storage.db.prepare('SELECT id FROM health_stats WHERE date = ?').get(date);

      if (existing) {
        // 更新现有记录
        const fieldMap = {
          [HEALTH_TYPES.SEDENTARY]: 'sedentary_count',
          [HEALTH_TYPES.WATER]: 'water_count',
          [HEALTH_TYPES.EYECARE]: 'eyecare_count',
          [HEALTH_TYPES.CUSTOM]: 'custom_count'
        };
        const field = fieldMap[type] || 'custom_count';

        this.storage.db.prepare(`
          UPDATE health_stats
          SET ${field} = ${field} + 1,
              total_reminders = total_reminders + 1,
              updated_at = ?
          WHERE date = ?
        `).run(now, date);
      } else {
        // 创建新记录
        const id = `stats-${date}`;
        const counts = {
          [HEALTH_TYPES.SEDENTARY]: { sedentary_count: 1, water_count: 0, eyecare_count: 0, custom_count: 0 },
          [HEALTH_TYPES.WATER]: { sedentary_count: 0, water_count: 1, eyecare_count: 0, custom_count: 0 },
          [HEALTH_TYPES.EYECARE]: { sedentary_count: 0, water_count: 0, eyecare_count: 1, custom_count: 0 },
          [HEALTH_TYPES.CUSTOM]: { sedentary_count: 0, water_count: 0, eyecare_count: 0, custom_count: 1 }
        };
        const c = counts[type] || counts[HEALTH_TYPES.CUSTOM];

        this.storage.db.prepare(`
          INSERT INTO health_stats (id, date, sedentary_count, water_count, eyecare_count, custom_count, total_reminders, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(id, date, c.sedentary_count, c.water_count, c.eyecare_count, c.custom_count, now, now);
      }
    } catch (error) {
      console.error('[HealthReminder] Failed to update stats:', error);
    }
  }

  // 显示系统通知
  showNotification(type, message) {
    try {
      const titles = {
        [HEALTH_TYPES.SEDENTARY]: '活动提醒',
        [HEALTH_TYPES.WATER]: '喝水提醒',
        [HEALTH_TYPES.EYECARE]: '护眼提醒',
        [HEALTH_TYPES.CUSTOM]: '健康提醒'
      };

      const notification = new Notification({
        title: titles[type] || '健康提醒',
        body: message,
        icon: './assets/icon.png',
        silent: false
      });

      notification.show();

      notification.on('click', () => {
        if (this.mainWindow) {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      });

    } catch (error) {
      console.error('[HealthReminder] Failed to show notification:', error);
    }
  }

  // 通知渲染进程
  notifyRenderer(reminder, message) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('health:triggered', {
        id: reminder.id,
        type: reminder.type,
        message: message,
        timestamp: Date.now()
      });
    }
  }

  // ==================== 配置管理 ====================

  // 获取所有配置
  getAllConfigs() {
    if (!this.storage || !this.storage.db) return [];

    try {
      const stmt = this.storage.db.prepare('SELECT * FROM health_reminders ORDER BY type');
      return stmt.all();
    } catch (error) {
      console.error('[HealthReminder] Failed to get configs:', error);
      return [];
    }
  }

  // 获取单个配置
  getConfig(type) {
    if (!this.storage || !this.storage.db) return null;

    try {
      const stmt = this.storage.db.prepare('SELECT * FROM health_reminders WHERE type = ?');
      return stmt.get(type);
    } catch (error) {
      console.error('[HealthReminder] Failed to get config:', error);
      return null;
    }
  }

  // 更新配置
  updateConfig(id, updates) {
    if (!this.storage || !this.storage.db) return false;

    try {
      const allowedFields = ['enabled', 'interval_minutes', 'start_time', 'end_time', 'workdays_only', 'custom_message'];
      const setClauses = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
      }

      if (setClauses.length === 0) return false;

      values.push(Date.now()); // updated_at
      values.push(id);

      const stmt = this.storage.db.prepare(`
        UPDATE health_reminders
        SET ${setClauses.join(', ')}, updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(...values);

      // 如果更新了间隔时间，重新计算下次触发时间
      if (updates.interval_minutes !== undefined) {
        const config = this.storage.db.prepare('SELECT * FROM health_reminders WHERE id = ?').get(id);
        if (config && config.enabled) {
          const nextTime = this.calculateNextTriggerTime(config);
          this.updateNextTriggerTime(id, nextTime);
        }
      }

      return result.changes > 0;
    } catch (error) {
      console.error('[HealthReminder] Failed to update config:', error);
      return false;
    }
  }

  // 批量更新配置
  batchUpdateConfigs(updates) {
    if (!this.storage || !this.storage.db) return { success: 0, failed: 0 };

    const results = { success: 0, failed: 0 };

    for (const update of updates) {
      if (this.updateConfig(update.id, update)) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    return results;
  }

  // ==================== 统计与历史 ====================

  // 获取今日统计
  getTodayStats() {
    if (!this.storage || !this.storage.db) return null;

    try {
      const today = new Date().toISOString().split('T')[0];
      const stmt = this.storage.db.prepare('SELECT * FROM health_stats WHERE date = ?');
      return stmt.get(today);
    } catch (error) {
      console.error('[HealthReminder] Failed to get today stats:', error);
      return null;
    }
  }

  // 获取历史统计
  getStatsHistory(days = 7) {
    if (!this.storage || !this.storage.db) return [];

    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM health_stats
        ORDER BY date DESC
        LIMIT ?
      `);
      return stmt.all(days);
    } catch (error) {
      console.error('[HealthReminder] Failed to get stats history:', error);
      return [];
    }
  }

  // 获取提醒历史
  getHistory(options = {}) {
    if (!this.storage || !this.storage.db) return [];

    const { limit = 100, offset = 0, type = null } = options;

    try {
      let query = 'SELECT * FROM health_reminder_history WHERE 1=1';
      const params = [];

      if (type) {
        query += ' AND reminder_type = ?';
        params.push(type);
      }

      query += ' ORDER BY triggered_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = this.storage.db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('[HealthReminder] Failed to get history:', error);
      return [];
    }
  }

  // ==================== 用户响应 ====================

  // 记录用户响应
  recordResponse(historyId, action) {
    if (!this.storage || !this.storage.db) return false;

    try {
      const stmt = this.storage.db.prepare(`
        UPDATE health_reminder_history
        SET responded_at = ?, response_action = ?
        WHERE id = ?
      `);
      const result = stmt.run(Date.now(), action, historyId);

      // 更新统计
      if (action === 'responded') {
        const today = new Date().toISOString().split('T')[0];
        this.storage.db.prepare(`
          UPDATE health_stats SET responded_count = responded_count + 1, updated_at = ?
          WHERE date = ?
        `).run(Date.now(), today);
      } else if (action === 'snoozed') {
        const today = new Date().toISOString().split('T')[0];
        this.storage.db.prepare(`
          UPDATE health_stats SET snoozed_count = snoozed_count + 1, updated_at = ?
          WHERE date = ?
        `).run(Date.now(), today);
      }

      return result.changes > 0;
    } catch (error) {
      console.error('[HealthReminder] Failed to record response:', error);
      return false;
    }
  }

  // 延后提醒（贪睡）
  snooze(reminderId, snoozeMinutes = 5) {
    if (!this.storage || !this.storage.db) return false;

    try {
      const snoozedUntil = Date.now() + snoozeMinutes * 60 * 1000;
      this.updateNextTriggerTime(reminderId, snoozedUntil);
      return true;
    } catch (error) {
      console.error('[HealthReminder] Failed to snooze:', error);
      return false;
    }
  }

  // ==================== IPC 处理器 ====================

  registerIPCHandlers() {
    // 获取所有配置
    ipcMain.handle('health:get-all', async () => {
      return this.getAllConfigs();
    });

    // 获取单个配置
    ipcMain.handle('health:get-config', async (event, type) => {
      return this.getConfig(type);
    });

    // 更新配置
    ipcMain.handle('health:update-config', async (event, id, updates) => {
      return this.updateConfig(id, updates);
    });

    // 批量更新配置
    ipcMain.handle('health:batch-update', async (event, updates) => {
      return this.batchUpdateConfigs(updates);
    });

    // 获取今日统计
    ipcMain.handle('health:get-today-stats', async () => {
      return this.getTodayStats();
    });

    // 获取历史统计
    ipcMain.handle('health:get-stats-history', async (event, days) => {
      return this.getStatsHistory(days);
    });

    // 获取提醒历史
    ipcMain.handle('health:get-history', async (event, options) => {
      return this.getHistory(options);
    });

    // 记录用户响应
    ipcMain.handle('health:respond', async (event, historyId, action) => {
      return this.recordResponse(historyId, action);
    });

    // 延后提醒
    ipcMain.handle('health:snooze', async (event, reminderId, minutes) => {
      return this.snooze(reminderId, minutes);
    });

    console.log('[HealthReminder] IPC handlers registered');
  }
}

module.exports = HealthReminderScheduler;
