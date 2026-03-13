const { randomUUID } = require('crypto');

class DailyRitualScheduler {
  constructor(storage) {
    this.storage = storage;
    this.mainWindow = null;
    this.checkInterval = null;
    this.checkIntervalMs = 60 * 1000;
    this.isRunning = false;
    this.isChecking = false;
    this.defaultSettings = {
      morningEnabled: true,
      morningHour: 8,
      morningMinute: 0,
      eveningEnabled: true,
      eveningHour: 22,
      eveningMinute: 0,
      weeklyEnabled: true,
      weeklyDay: 0,
      weeklyHour: 20,
      weeklyMinute: 0
    };
  }

  setMainWindow(win) {
    this.mainWindow = win || null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.checkInterval = setInterval(() => {
      void this._check();
    }, this.checkIntervalMs);
    void this._check();
    console.log('[DailyRitual] Scheduler started');
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
  }

  async _getSettings() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return { ...this.defaultSettings };
    }

    try {
      const raw = await this.mainWindow.webContents.executeJavaScript(`
        (() => {
          try {
            return localStorage.getItem('ritual_settings');
          } catch (error) {
            return null;
          }
        })()
      `);

      if (!raw) {
        return { ...this.defaultSettings };
      }

      return {
        ...this.defaultSettings,
        ...JSON.parse(raw)
      };
    } catch (error) {
      console.warn('[DailyRitual] Failed to read settings:', error.message);
      return { ...this.defaultSettings };
    }
  }

  _todayKey(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  _weekKey(now = new Date()) {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const diffDays = Math.floor((now - startOfYear) / 86400000);
    const weekNum = Math.ceil((diffDays + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  _hasTriggered(ritualType, key) {
    if (!this.storage || !this.storage.db) {
      return true;
    }

    try {
      const row = this.storage.db.prepare(
        'SELECT id FROM daily_ritual_log WHERE ritual_type = ? AND date_key = ? LIMIT 1'
      ).get(ritualType, key);
      return !!row;
    } catch (error) {
      console.error('[DailyRitual] Failed to query trigger log:', error);
      return true;
    }
  }

  _markTriggered(ritualType, key) {
    if (!this.storage || !this.storage.db) {
      return;
    }

    try {
      this.storage.db.prepare(
        'INSERT INTO daily_ritual_log (id, ritual_type, triggered_at, date_key) VALUES (?, ?, ?, ?)'
      ).run(randomUUID(), ritualType, Date.now(), key);
    } catch (error) {
      console.error('[DailyRitual] Failed to mark triggered:', error);
    }
  }

  async _check() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const settings = await this._getSettings();
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const dayOfWeek = now.getDay();
      const todayKey = this._todayKey(now);
      const weekKey = this._weekKey(now);

      if (
        settings.morningEnabled &&
        hour === Number(settings.morningHour) &&
        minute === Number(settings.morningMinute) &&
        !this._hasTriggered('morning', todayKey)
      ) {
        this._markTriggered('morning', todayKey);
        await this._triggerRitual('morning');
      }

      if (
        settings.eveningEnabled &&
        hour === Number(settings.eveningHour) &&
        minute === Number(settings.eveningMinute) &&
        !this._hasTriggered('evening', todayKey)
      ) {
        this._markTriggered('evening', todayKey);
        await this._triggerRitual('evening');
      }

      if (
        settings.weeklyEnabled &&
        dayOfWeek === Number(settings.weeklyDay) &&
        hour === Number(settings.weeklyHour) &&
        minute === Number(settings.weeklyMinute) &&
        !this._hasTriggered('weekly', weekKey)
      ) {
        this._markTriggered('weekly', weekKey);
        await this._triggerRitual('weekly');
      }
    } catch (error) {
      console.error('[DailyRitual] Check error:', error);
    } finally {
      this.isChecking = false;
    }
  }

  async _triggerRitual(type) {
    console.log(`[DailyRitual] Triggering ritual: ${type}`);

    const payload = { type };
    if (type === 'weekly') {
      try {
        payload.stats = this._queryWeeklyStats(this._getWeekStartTimestamp());
      } catch (error) {
        console.error('[DailyRitual] Failed to query weekly stats:', error);
        payload.stats = {};
      }
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ritual:trigger', payload);
    }
  }

  _getWeekStartTimestamp() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
  }

  _queryWeeklyStats(weekStartTs) {
    if (!this.storage || !this.storage.db) {
      return {};
    }

    try {
      const totalMessages = this.storage.db.prepare(
        'SELECT COUNT(*) AS cnt FROM conversations WHERE timestamp >= ?'
      ).get(weekStartTs);

      const avgMood = this.storage.db.prepare(
        'SELECT AVG(mood) AS avg FROM conversations WHERE timestamp >= ? AND mood IS NOT NULL'
      ).get(weekStartTs);

      const userMessages = this.storage.db.prepare(
        'SELECT COUNT(*) AS cnt FROM conversations WHERE timestamp >= ? AND role = ?'
      ).get(weekStartTs, 'user');

      const busiestRow = this.storage.db.prepare(`
        SELECT strftime('%w', datetime(timestamp / 1000, 'unixepoch', 'localtime')) AS dow,
               COUNT(*) AS cnt
        FROM conversations
        WHERE timestamp >= ? AND role = 'user'
        GROUP BY dow
        ORDER BY cnt DESC
        LIMIT 1
      `).get(weekStartTs);

      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const busiestDay = busiestRow ? dayNames[Number.parseInt(busiestRow.dow, 10)] : null;

      return {
        totalMessages: totalMessages ? totalMessages.cnt : 0,
        userMessages: userMessages ? userMessages.cnt : 0,
        avgMood: avgMood && avgMood.avg !== null ? Math.round(avgMood.avg) : null,
        busiestDay
      };
    } catch (error) {
      console.error('[DailyRitual] Stats query error:', error);
      return {};
    }
  }

  async manualTrigger(type) {
    if (!['morning', 'evening', 'weekly'].includes(type)) {
      throw new Error(`Unsupported ritual type: ${type}`);
    }

    await this._triggerRitual(type);
  }
}

module.exports = { DailyRitualScheduler };
