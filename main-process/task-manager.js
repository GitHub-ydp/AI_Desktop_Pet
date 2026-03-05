// 任务管理调度器
// 负责任务 CRUD、到期检测、提醒集成
// CommonJS 版本 - 用于主进程

const { ipcMain, Notification } = require('electron');

// 任务状态
const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

// 任务优先级
const TASK_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
};

// 优先级显示名称
const PRIORITY_LABELS = {
  [TASK_PRIORITY.LOW]: '低',
  [TASK_PRIORITY.MEDIUM]: '中',
  [TASK_PRIORITY.HIGH]: '高',
  [TASK_PRIORITY.URGENT]: '紧急'
};

// 默认分类
const DEFAULT_CATEGORIES = ['general', 'work', 'personal', 'study', 'health', 'other'];

class TaskManager {
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

  // 设置主窗口引用
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  // 启动调度器
  async start() {
    if (this.isRunning) {
      console.log('[TaskManager] Scheduler already running');
      return;
    }

    console.log('[TaskManager] Starting scheduler...');
    this.isRunning = true;
    this.ensureSchedulerIndexes();

    // 检查到期任务
    await this.checkDueTasks();

    // 定期检查
    this.checkInterval = setInterval(() => {
      this.checkDueTasks();
    }, this.checkIntervalMs);

    console.log('[TaskManager] Scheduler started');
  }

  // 停止调度器
  stop() {
    if (!this.isRunning) return;

    console.log('[TaskManager] Stopping scheduler...');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[TaskManager] Scheduler stopped');
  }

  // 检查到期任务
  async checkDueTasks() {
    if (!this.storage || !this.storage.db) return;

    try {
      const now = Date.now();

      // 检查需要提醒的任务
      const reminderTasks = this.storage.db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('pending', 'in_progress')
        AND reminder_at IS NOT NULL
        AND reminder_at <= ?
      `).all(now);

      for (const task of reminderTasks) {
        await this.triggerTaskReminder(task);
      }

      // 全部待办数量（pending + in_progress）
      const pendingTasks = this.storage.db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE status IN ('pending', 'in_progress')
      `).get();

      // 逾期数量（有截止时间且已过期）
      const overdueTasks = this.storage.db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE status IN ('pending', 'in_progress')
        AND due_date IS NOT NULL
        AND due_date < ?
      `).get(now);

      // 更新今日统计
      this.updateDailyStats(pendingTasks.count || 0, overdueTasks.count || 0);

    } catch (error) {
      console.error('[TaskManager] Error checking due tasks:', error);
    }
  }

  // 触发任务提醒
  async triggerTaskReminder(task) {
    console.log(`[TaskManager] Triggering task reminder: ${task.title}`);

    try {
      // 清除提醒时间（避免重复触发）
      this.storage.db.prepare(`
        UPDATE tasks SET reminder_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), task.id);

      // 发送系统通知
      this.showNotification(task);

      // 通知渲染进程
      this.notifyRenderer(task, 'reminder');

    } catch (error) {
      console.error('[TaskManager] Failed to trigger reminder:', error);
    }
  }

  // 显示系统通知
  showNotification(task) {
    try {
      const notification = new Notification({
        title: `任务提醒: ${task.title}`,
        body: task.description || '任务即将到期',
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
      console.error('[TaskManager] Failed to show notification:', error);
    }
  }

  // 通知渲染进程
  notifyRenderer(task, action) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('task:event', {
        action,
        task: this.formatTask(task),
        timestamp: Date.now()
      });
    }
  }

  // ==================== 任务 CRUD ====================

  // 创建任务
  createTask(taskData) {
    if (!this.storage || !this.storage.db) {
      throw new Error('Storage not initialized');
    }

    const {
      title,
      description = null,
      priority = TASK_PRIORITY.MEDIUM,
      category = 'general',
      tags = null,
      dueDate = null,
      reminderAt = null,
      sourceConversationId = null,
      metadata = null
    } = taskData;

    if (!title) {
      throw new Error('Task title is required');
    }

    const id = this.generateId();
    const now = Date.now();

    try {
      const stmt = this.storage.db.prepare(`
        INSERT INTO tasks (
          id, title, description, status, priority, category, tags,
          due_date, reminder_at, created_at, updated_at,
          source_conversation_id, metadata
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id, title, description, priority, category, tags,
        dueDate, reminderAt, now, now,
        sourceConversationId, metadata ? JSON.stringify(metadata) : null
      );

      // 记录历史
      this.recordHistory(id, null, TASK_STATUS.PENDING, '任务创建');

      // 更新统计
      this.incrementTodayStat('created_count');

      console.log(`[TaskManager] Created task: ${id} - ${title}`);

      return this.getTaskById(id);

    } catch (error) {
      console.error('[TaskManager] Failed to create task:', error);
      throw error;
    }
  }

  // 获取任务
  getTaskById(id) {
    if (!this.storage || !this.storage.db) return null;

    try {
      const stmt = this.storage.db.prepare('SELECT * FROM tasks WHERE id = ?');
      const task = stmt.get(id);
      return task ? this.formatTask(task) : null;
    } catch (error) {
      console.error('[TaskManager] Failed to get task:', error);
      return null;
    }
  }

  // 获取任务列表
  getTasks(options = {}) {
    if (!this.storage || !this.storage.db) return [];

    const {
      status = null,
      priority = null,
      category = null,
      dueBefore = null,
      dueAfter = null,
      search = null,
      limit = 100,
      offset = 0,
      orderBy = 'due_date',
      orderDir = 'ASC'
    } = options;

    try {
      let query = 'SELECT * FROM tasks WHERE 1=1';
      const params = [];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      if (priority) {
        query += ' AND priority = ?';
        params.push(priority);
      }

      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }

      if (dueBefore) {
        query += ' AND due_date <= ?';
        params.push(dueBefore);
      }

      if (dueAfter) {
        query += ' AND due_date >= ?';
        params.push(dueAfter);
      }

      if (search) {
        query += ' AND (title LIKE ? OR description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      // 安全的排序
      const validOrderBy = ['due_date', 'priority', 'created_at', 'updated_at', 'title'].includes(orderBy)
        ? orderBy : 'due_date';
      const validOrderDir = ['ASC', 'DESC'].includes(orderDir.toUpperCase()) ? orderDir.toUpperCase() : 'ASC';

      query += ` ORDER BY ${validOrderBy} ${validOrderDir} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const stmt = this.storage.db.prepare(query);
      const tasks = stmt.all(...params);

      return tasks.map(t => this.formatTask(t));

    } catch (error) {
      console.error('[TaskManager] Failed to get tasks:', error);
      return [];
    }
  }

  // 获取今日任务
  getTodayTasks() {
    if (!this.storage || !this.storage.db) return [];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('pending', 'in_progress')
        AND due_date IS NOT NULL
        AND due_date >= ? AND due_date < ?
        ORDER BY priority DESC, due_date ASC
      `);
      return stmt.all(todayStart.getTime(), todayEnd.getTime()).map(t => this.formatTask(t));
    } catch (error) {
      console.error('[TaskManager] Failed to get today tasks:', error);
      return [];
    }
  }

  // 获取待处理任务（包括进行中）
  getPendingTasks() {
    return this.getTasks({
      status: null, // 不过滤，后面用 SQL
      orderBy: 'due_date',
      orderDir: 'ASC',
      limit: 50
    }).filter(t => t.status === TASK_STATUS.PENDING || t.status === TASK_STATUS.IN_PROGRESS);
  }

  // 更新任务
  updateTask(id, updates) {
    if (!this.storage || !this.storage.db) return false;

    const allowedFields = ['title', 'description', 'status', 'priority', 'category', 'tags', 'due_date', 'reminder_at'];
    const setClauses = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key === 'dueDate' ? 'due_date' : key === 'reminderAt' ? 'reminder_at' : key;
      if (allowedFields.includes(dbKey)) {
        setClauses.push(`${dbKey} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) return false;

    const now = Date.now();
    setClauses.push('updated_at = ?');
    values.push(now);
    values.push(id);

    try {
      // 获取旧状态
      const oldTask = this.storage.db.prepare('SELECT status FROM tasks WHERE id = ?').get(id);

      const stmt = this.storage.db.prepare(`
        UPDATE tasks SET ${setClauses.join(', ')}
        WHERE id = ?
      `);

      const result = stmt.run(...values);

      // 如果状态变更，记录历史
      if (updates.status && oldTask && oldTask.status !== updates.status) {
        this.recordHistory(id, oldTask.status, updates.status);

        // 如果完成，更新统计
        if (updates.status === TASK_STATUS.COMPLETED) {
          this.incrementTodayStat('completed_count');
          this.storage.db.prepare(`
            UPDATE tasks SET completed_at = ? WHERE id = ?
          `).run(now, id);
        }
      }

      if (result.changes > 0) {
        const updatedTask = this.getTaskById(id);
        this.notifyRenderer(updatedTask, 'updated');
      }

      return result.changes > 0;

    } catch (error) {
      console.error('[TaskManager] Failed to update task:', error);
      return false;
    }
  }

  // 完成任务
  completeTask(id) {
    return this.updateTask(id, { status: TASK_STATUS.COMPLETED });
  }

  // 取消任务
  cancelTask(id) {
    return this.updateTask(id, { status: TASK_STATUS.CANCELLED });
  }

  // 删除任务
  deleteTask(id) {
    if (!this.storage || !this.storage.db) return false;

    try {
      // 先删除历史记录
      this.storage.db.prepare('DELETE FROM task_history WHERE task_id = ?').run(id);

      // 再删除任务
      const stmt = this.storage.db.prepare('DELETE FROM tasks WHERE id = ?');
      const result = stmt.run(id);

      if (result.changes > 0) {
        this.notifyRenderer({ id }, 'deleted');
      }

      return result.changes > 0;

    } catch (error) {
      console.error('[TaskManager] Failed to delete task:', error);
      return false;
    }
  }

  // ==================== 辅助方法 ====================

  // 格式化任务
  formatTask(task) {
    if (!task) return null;

    return {
      ...task,
      priorityLabel: PRIORITY_LABELS[task.priority] || task.priority,
      tags: task.tags ? task.tags.split(',').filter(t => t) : [],
      metadata: task.metadata ? JSON.parse(task.metadata) : null
    };
  }

  // 生成唯一 ID
  generateId() {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 记录状态变更历史
  recordHistory(taskId, oldStatus, newStatus, note = null) {
    if (!this.storage || !this.storage.db) return;

    try {
      const id = `hist-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const stmt = this.storage.db.prepare(`
        INSERT INTO task_history (id, task_id, old_status, new_status, changed_at, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, taskId, oldStatus, newStatus, Date.now(), note);
    } catch (error) {
      console.error('[TaskManager] Failed to record history:', error);
    }
  }

  // 更新每日统计
  updateDailyStats(pendingCount, overdueCount = 0) {
    if (!this.storage || !this.storage.db) return;

    try {
      const date = new Date().toISOString().split('T')[0];
      const now = Date.now();

      const existing = this.storage.db.prepare('SELECT id FROM task_stats WHERE date = ?').get(date);

      if (existing) {
        this.storage.db.prepare(`
          UPDATE task_stats SET total_pending = ?, overdue_count = ?, updated_at = ?
          WHERE date = ?
        `).run(pendingCount, overdueCount, now, date);
      } else {
        const id = `stats-${date}`;
        this.storage.db.prepare(`
          INSERT INTO task_stats (id, date, overdue_count, total_pending, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, date, overdueCount, pendingCount, now, now);
      }
    } catch (error) {
      console.error('[TaskManager] Failed to update stats:', error);
    }
  }

  // 为调度查询补充索引，避免任务量上来后全表扫描
  ensureSchedulerIndexes() {
    if (!this.storage || !this.storage.db) return;
    try {
      this.storage.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_status_reminder_at
        ON tasks(status, reminder_at);
      `);
      this.storage.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_status_due_date
        ON tasks(status, due_date);
      `);
    } catch (error) {
      console.error('[TaskManager] Failed to ensure scheduler indexes:', error);
    }
  }

  // 增加今日统计
  incrementTodayStat(field) {
    if (!this.storage || !this.storage.db) return;

    try {
      const date = new Date().toISOString().split('T')[0];
      const now = Date.now();

      const existing = this.storage.db.prepare('SELECT id FROM task_stats WHERE date = ?').get(date);

      if (existing) {
        this.storage.db.prepare(`
          UPDATE task_stats SET ${field} = ${field} + 1, updated_at = ?
          WHERE date = ?
        `).run(now, date);
      } else {
        const id = `stats-${date}`;
        const initialCounts = {
          created_count: field === 'created_count' ? 1 : 0,
          completed_count: field === 'completed_count' ? 1 : 0,
          overdue_count: 0,
          total_pending: field === 'created_count' ? 1 : 0
        };

        this.storage.db.prepare(`
          INSERT INTO task_stats (id, date, created_count, completed_count, overdue_count, total_pending, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, date, initialCounts.created_count, initialCounts.completed_count,
               initialCounts.overdue_count, initialCounts.total_pending, now, now);
      }
    } catch (error) {
      console.error('[TaskManager] Failed to increment stat:', error);
    }
  }

  // 获取今日统计
  getTodayStats() {
    if (!this.storage || !this.storage.db) return null;

    try {
      const date = new Date().toISOString().split('T')[0];
      const stmt = this.storage.db.prepare('SELECT * FROM task_stats WHERE date = ?');
      return stmt.get(date);
    } catch (error) {
      console.error('[TaskManager] Failed to get today stats:', error);
      return null;
    }
  }

  // 获取任务历史
  getTaskHistory(taskId) {
    if (!this.storage || !this.storage.db) return [];

    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM task_history WHERE task_id = ?
        ORDER BY changed_at DESC
      `);
      return stmt.all(taskId);
    } catch (error) {
      console.error('[TaskManager] Failed to get task history:', error);
      return [];
    }
  }

  // 获取日历数据（某月的任务分布）
  getCalendarData(year, month) {
    if (!this.storage || !this.storage.db) return [];

    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const stmt = this.storage.db.prepare(`
        SELECT date(due_date / 1000, 'unixepoch', 'localtime') as date,
               COUNT(*) as count,
               GROUP_CONCAT(id) as task_ids
        FROM tasks
        WHERE due_date >= ? AND due_date <= ?
        AND status IN ('pending', 'in_progress')
        GROUP BY date
      `);

      const results = stmt.all(startDate.getTime(), endDate.getTime());

      return results.map(r => ({
        date: r.date,
        count: r.count,
        taskIds: r.task_ids ? r.task_ids.split(',') : []
      }));

    } catch (error) {
      console.error('[TaskManager] Failed to get calendar data:', error);
      return [];
    }
  }

  // 获取宠物提醒消息
  getPetReminderMessage() {
    if (!this.storage || !this.storage.db) return null;

    try {
      const todayStats = this.getTodayStats();
      const pendingTasks = this.getPendingTasks();

      const pendingCount = pendingTasks.length;
      const todayCompleted = todayStats?.completed_count || 0;

      if (pendingCount === 0) {
        return { message: '太棒了！所有任务都完成了~', type: 'success' };
      }

      if (pendingCount <= 3) {
        return {
          message: `还有 ${pendingCount} 个任务待完成，加油哦~`,
          type: 'info',
          count: pendingCount
        };
      }

      // 有高优先级任务
      const urgentTasks = pendingTasks.filter(t => t.priority === TASK_PRIORITY.URGENT || t.priority === TASK_PRIORITY.HIGH);
      if (urgentTasks.length > 0) {
        return {
          message: `有 ${urgentTasks.length} 个紧急任务需要处理！`,
          type: 'warning',
          count: pendingCount,
          urgentCount: urgentTasks.length
        };
      }

      return {
        message: `今天还有 ${pendingCount} 个任务哦~`,
        type: 'info',
        count: pendingCount
      };

    } catch (error) {
      console.error('[TaskManager] Failed to get pet reminder:', error);
      return null;
    }
  }

  // ==================== IPC 处理器 ====================

  registerIPCHandlers() {
    // 创建任务
    ipcMain.handle('task:create', async (event, data) => {
      return this.createTask(data);
    });

    // 获取任务
    ipcMain.handle('task:get', async (event, id) => {
      return this.getTaskById(id);
    });

    // 获取任务列表
    ipcMain.handle('task:get-all', async (event, options) => {
      return this.getTasks(options);
    });

    // 获取今日任务
    ipcMain.handle('task:get-today', async () => {
      return this.getTodayTasks();
    });

    // 获取待处理任务
    ipcMain.handle('task:get-pending', async () => {
      return this.getPendingTasks();
    });

    // 更新任务
    ipcMain.handle('task:update', async (event, id, updates) => {
      return this.updateTask(id, updates);
    });

    // 完成任务
    ipcMain.handle('task:complete', async (event, id) => {
      return this.completeTask(id);
    });

    // 取消任务
    ipcMain.handle('task:cancel', async (event, id) => {
      return this.cancelTask(id);
    });

    // 删除任务
    ipcMain.handle('task:delete', async (event, id) => {
      return this.deleteTask(id);
    });

    // 获取今日统计
    ipcMain.handle('task:get-today-stats', async () => {
      return this.getTodayStats();
    });

    // 获取任务历史
    ipcMain.handle('task:get-history', async (event, taskId) => {
      return this.getTaskHistory(taskId);
    });

    // 获取日历数据
    ipcMain.handle('task:get-calendar', async (event, year, month) => {
      return this.getCalendarData(year, month);
    });

    // 获取宠物提醒消息
    ipcMain.handle('task:get-pet-reminder', async () => {
      return this.getPetReminderMessage();
    });

    console.log('[TaskManager] IPC handlers registered');
  }
}

module.exports = TaskManager;
