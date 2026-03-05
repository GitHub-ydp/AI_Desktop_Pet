// 小组件管理器
// 管理天气、日历、待办等小组件
// CommonJS 版本 - 用于主进程

const { ipcMain } = require('electron');
const WeatherService = require('./weather-service');

class WidgetManager {
  constructor(storage) {
    this.storage = storage;
    this.weatherService = new WeatherService();

    // 小组件配置
    this.config = {
      weather: { enabled: true, location: '' },
      calendar: { enabled: true },
      todo: { enabled: true }
    };

    // 缓存数据
    this.weatherData = null;
    this.calendarData = null;
    this.todoData = null;

    // 更新定时器
    this.updateTimer = null;
  }

  // 设置存储引用
  setStorage(storage) {
    this.storage = storage;
  }

  // 初始化
  async initialize() {
    // 加载配置
    this.loadConfig();

    // 获取初始数据
    await this.refreshAll();

    // 启动定时更新
    this.startAutoUpdate();

    console.log('[Widget] Manager initialized');
  }

  // 加载配置
  loadConfig() {
    if (!this.storage || !this.storage.db) return;

    try {
      // 从 settings 表或 localStorage 迁移的配置加载
      // 这里简化处理，使用默认配置
      console.log('[Widget] Config loaded');
    } catch (error) {
      console.error('[Widget] Failed to load config:', error);
    }
  }

  // 保存配置
  saveConfig() {
    if (!this.storage || !this.storage.db) return;

    try {
      // 保存配置到数据库或 localStorage
      console.log('[Widget] Config saved');
    } catch (error) {
      console.error('[Widget] Failed to save config:', error);
    }
  }

  // 启动自动更新
  startAutoUpdate() {
    // 每 5 分钟检查一次是否需要更新
    this.updateTimer = setInterval(() => {
      this.refreshAll().catch(err => {
        console.error('[Widget] Auto refresh failed:', err);
      });
    }, 5 * 60 * 1000);

    console.log('[Widget] Auto update started');
  }

  // 停止自动更新
  stopAutoUpdate() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    console.log('[Widget] Auto update stopped');
  }

  // 刷新所有小组件数据
  async refreshAll() {
    const results = await Promise.allSettled([
      this.refreshWeather(),
      this.refreshCalendar(),
      this.refreshTodo()
    ]);

    return {
      weather: results[0].status === 'fulfilled' ? results[0].value : null,
      calendar: results[1].status === 'fulfilled' ? results[1].value : null,
      todo: results[2].status === 'fulfilled' ? results[2].value : null
    };
  }

  // ==================== 天气小组件 ====================

  // 刷新天气数据
  async refreshWeather() {
    if (!this.config.weather.enabled) {
      return null;
    }

    try {
      this.weatherData = await this.weatherService.getWeather(this.config.weather.location);
      return this.weatherData;
    } catch (error) {
      console.error('[Widget] Weather refresh failed:', error);
      return this.weatherData || this.weatherService.getDefaultWeather();
    }
  }

  // 获取天气数据
  getWeatherData() {
    return this.weatherData || this.weatherService.getDefaultWeather();
  }

  // 设置天气位置
  setWeatherLocation(location) {
    this.config.weather.location = location;
    this.weatherService.setLocation(location);
    this.saveConfig();

    // 立即刷新
    return this.refreshWeather();
  }

  // ==================== 日历小组件 ====================

  // 刷新日历数据
  async refreshCalendar() {
    if (!this.config.calendar.enabled) {
      return null;
    }

    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // 获取当月日历数据
      const calendarData = this.generateCalendarData(year, month);

      // 获取任务标记
      const taskMarks = await this.getTaskMarks(year, month);

      this.calendarData = {
        ...calendarData,
        taskMarks,
        today: now.getDate()
      };

      return this.calendarData;
    } catch (error) {
      console.error('[Widget] Calendar refresh failed:', error);
      return this.calendarData || this.generateCalendarData(new Date().getFullYear(), new Date().getMonth() + 1);
    }
  }

  // 生成日历数据
  generateCalendarData(year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay(); // 0 = 周日

    const weeks = [];
    let week = [];

    // 填充月初空白
    for (let i = 0; i < startWeekday; i++) {
      week.push(null);
    }

    // 填充日期
    for (let day = 1; day <= daysInMonth; day++) {
      week.push(day);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }

    // 填充月末空白
    if (week.length > 0) {
      while (week.length < 7) {
        week.push(null);
      }
      weeks.push(week);
    }

    return {
      year,
      month,
      weeks,
      monthName: this.getMonthName(month),
      weekdays: ['日', '一', '二', '三', '四', '五', '六']
    };
  }

  // 获取月份名称
  getMonthName(month) {
    const names = ['一月', '二月', '三月', '四月', '五月', '六月',
                   '七月', '八月', '九月', '十月', '十一月', '十二月'];
    return names[month - 1] || '';
  }

  // 获取任务标记
  async getTaskMarks(year, month) {
    if (!this.storage || !this.storage.db) return {};

    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const stmt = this.storage.db.prepare(`
        SELECT due_date FROM tasks
        WHERE due_date >= ? AND due_date <= ?
        AND status IN ('pending', 'in_progress')
      `);

      const tasks = stmt.all(startDate.getTime(), endDate.getTime());

      const marks = {};
      tasks.forEach(task => {
        if (task.due_date) {
          const date = new Date(task.due_date);
          const day = date.getDate();
          marks[day] = (marks[day] || 0) + 1;
        }
      });

      return marks;
    } catch (error) {
      console.error('[Widget] Failed to get task marks:', error);
      return {};
    }
  }

  // 获取日历数据
  getCalendarData() {
    return this.calendarData || this.generateCalendarData(new Date().getFullYear(), new Date().getMonth() + 1);
  }

  // ==================== 待办小组件 ====================

  // 刷新待办数据
  async refreshTodo() {
    if (!this.config.todo.enabled) {
      return null;
    }

    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      if (!this.storage || !this.storage.db) {
        this.todoData = { todayCount: 0, overdueCount: 0, pendingCount: 0 };
        return this.todoData;
      }

      // 今日任务
      const todayStmt = this.storage.db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE status IN ('pending', 'in_progress')
        AND due_date >= ? AND due_date < ?
      `);
      const todayResult = todayStmt.get(todayStart.getTime(), todayEnd.getTime());

      // 逾期任务
      const overdueStmt = this.storage.db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE status IN ('pending', 'in_progress')
        AND due_date IS NOT NULL AND due_date < ?
      `);
      const overdueResult = overdueStmt.get(todayStart.getTime());

      // 全部待处理
      const pendingStmt = this.storage.db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE status IN ('pending', 'in_progress')
      `);
      const pendingResult = pendingStmt.get();

      this.todoData = {
        todayCount: todayResult?.count || 0,
        overdueCount: overdueResult?.count || 0,
        pendingCount: pendingResult?.count || 0,
        updated: Date.now()
      };

      return this.todoData;
    } catch (error) {
      console.error('[Widget] Todo refresh failed:', error);
      return this.todoData || { todayCount: 0, overdueCount: 0, pendingCount: 0 };
    }
  }

  // 获取待办数据
  getTodoData() {
    return this.todoData || { todayCount: 0, overdueCount: 0, pendingCount: 0 };
  }

  // ==================== 配置管理 ====================

  // 获取配置
  getConfig() {
    return this.config;
  }

  // 更新配置
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    return this.config;
  }

  // 切换小组件开关
  toggleWidget(widgetId, enabled) {
    if (this.config[widgetId]) {
      this.config[widgetId].enabled = enabled;
      this.saveConfig();
    }
    return this.config;
  }

  // ==================== 综合数据 ====================

  // 获取所有小组件数据
  getAllWidgetData() {
    return {
      weather: this.weatherData || this.weatherService.getDefaultWeather(),
      calendar: this.calendarData || this.generateCalendarData(new Date().getFullYear(), new Date().getMonth() + 1),
      todo: this.todoData || { todayCount: 0, overdueCount: 0, pendingCount: 0 },
      config: this.config,
      timestamp: Date.now()
    };
  }

  // ==================== IPC 处理器 ====================

  registerIPCHandlers() {
    // 获取所有小组件数据
    ipcMain.handle('widget:get-all', async () => {
      return this.getAllWidgetData();
    });

    // 刷新所有数据
    ipcMain.handle('widget:refresh', async () => {
      return await this.refreshAll();
    });

    // 天气相关
    ipcMain.handle('widget:get-weather', async () => {
      return this.getWeatherData();
    });

    ipcMain.handle('widget:set-weather-location', async (event, location) => {
      return await this.setWeatherLocation(location);
    });

    // 日历相关
    ipcMain.handle('widget:get-calendar', async () => {
      return this.getCalendarData();
    });

    // 待办相关
    ipcMain.handle('widget:get-todo', async () => {
      return this.getTodoData();
    });

    // 配置相关
    ipcMain.handle('widget:get-config', async () => {
      return this.getConfig();
    });

    ipcMain.handle('widget:update-config', async (event, config) => {
      return this.updateConfig(config);
    });

    ipcMain.handle('widget:toggle', async (event, widgetId, enabled) => {
      return this.toggleWidget(widgetId, enabled);
    });

    console.log('[Widget] IPC handlers registered');
  }
}

module.exports = WidgetManager;
