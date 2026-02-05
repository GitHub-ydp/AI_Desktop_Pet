// 提醒提取器
// 从用户对话中提取提醒任务

class ReminderExtractor {
  constructor() {
    // 用户时间偏好（从 localStorage 加载）
    this.userPreferences = this.loadPreferences();

    // 是否启用 AI 意图识别（默认关闭，因为会增加延迟）
    this.enableAIIntent = false;

    // 询问频率控制
    this.askCount = 0;
    this.lastAskTime = 0;
    this.ASK_COOLDOWN = 5 * 60 * 1000; // 5分钟内不重复询问
    this.ASK_THRESHOLD = 3; // 5分钟内超过3次询问直接执行

    // 中文数字映射
    this.chineseNumbers = {
      '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
      '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
      '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
      '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
      '三十': 30, '四十': 40, '五十': 50
    };

    // 模糊时间词映射（默认值）
    this.vagueTimeMapping = {
      '马上': 1,
      '立刻': 1,
      '立即': 1,
      '一会儿': 10,
      '过一会': 10,
      '等一下': 5,
      '等下': 5,
      '稍后': 15,
      '晚点': 30,
      '半小时': 30,
      '半天': 120
    };

    // 中文时间关键词映射（按优先级排序）
    this.timePatterns = [
      // 绝对时间 - 24小时制（最优先）
      {
        pattern: /(\d{1,2}):(\d{2})/,
        parser: (match) => this.parseAbsoluteTime(match[1], match[2])
      },
      {
        pattern: /(\d{1,2})点(\d{1,2})分/,
        parser: (match) => this.parseAbsoluteTime(match[1], match[2])
      },
      {
        pattern: /(\d{1,2})点(\d{1,2})/,
        parser: (match) => this.parseAbsoluteTime(match[1], match[2])
      },
      {
        pattern: /(\d{1,2})点/,
        parser: (match) => this.parseAbsoluteTime(match[1], '0')
      },
      // 相对时间 - 小时和分钟（阿拉伯数字）
      {
        pattern: /(\d+)\s*小时\s*(\d+)\s*分钟后?/,
        parser: (match) => this.parseRelativeHoursAndMinutes(parseInt(match[1]), parseInt(match[2]))
      },
      {
        pattern: /(\d+)\s*小时后?/,
        parser: (match) => this.parseRelativeHours(parseInt(match[1]))
      },
      {
        pattern: /(\d+)\s*分钟后?/,
        parser: (match) => this.parseRelativeMinutes(parseInt(match[1]))
      },
      // 相对时间 - 半小时、一刻钟等特殊表达
      {
        pattern: /(半|一半)小时后?/,
        parser: () => this.parseRelativeMinutes(30)
      },
      {
        pattern: /(一)?刻钟后?/,
        parser: () => this.parseRelativeMinutes(15)
      },
      {
        pattern: /三刻钟后?/,
        parser: () => this.parseRelativeMinutes(45)
      },
      // 相对时间 - 小时和分钟（中文数字）
      {
        pattern: /([一二两三四五六七八九十]+)\s*小时\s*([一二两三四五六七八九十]+)\s*分钟后?/,
        parser: (match) => this.parseRelativeHoursAndMinutes(
          this.parseChineseNumber(match[1]),
          this.parseChineseNumber(match[2])
        )
      },
      {
        pattern: /([一二两三四五六七八九十]+)\s*小时后?/,
        parser: (match) => this.parseRelativeHours(this.parseChineseNumber(match[1]))
      },
      {
        pattern: /([一二两三四五六七八九十]+)\s*分钟后?/,
        parser: (match) => this.parseRelativeMinutes(this.parseChineseNumber(match[1]))
      },
      // 相对时间 - 天
      {
        pattern: /(明天|后天|大后天)/,
        parser: (match) => this.parseRelativeDay(match[1])
      },
      {
        pattern: /(\d+)\s*天后?/,
        parser: (match) => this.parseRelativeDays(parseInt(match[1]))
      },
      // 特殊时间段
      {
        pattern: /(早上|上午|中午|下午|晚上|今晚|凌晨)/,
        parser: (match) => this.parseTimeOfDay(match[1])
      },
      // 模糊时间 - 用户自定义偏好（最后匹配）
      {
        pattern: /(马上|立刻|立即|一会儿|一会|过会|过一会|等一下|等下|稍等|稍后|晚点|晚些|半小时|半天|待会|待会儿)后?/,
        parser: (match, context) => this.parseVagueTime(match[1], context),
        isVague: true
      }
    ];

    // 提醒关键词（扩展版）
    this.reminderKeywords = [
      '提醒', '记得', '别忘了', '别忘记', '记住',
      '叫我', '喊我', '告诉我', '通知我',
      '设个提醒', '定个闹钟', '设置提醒',
      '记得去', '别忘了去', '别忘去看',
      '别忘做', '记得做', '该去', '该做',
      '到时候', '时间到了', '别忘了...',
      '提醒我', '通知我', '叫醒我'
    ];

    // 初始化时从历史加载偏好
    this.initFromHistory();
  }

  // 从历史记录中加载偏好
  async initFromHistory() {
    if (window.PetReminder) {
      try {
        const habits = await window.PetReminder.analyzeHabits();
        if (habits && habits.length > 0) {
          console.log('[Reminder] Loading preferences from history:', habits);
          // 将历史偏好合并到 userPreferences
          habits.forEach(habit => {
            if (!this.userPreferences[habit.vague_keyword] && habit.count >= 3) {
              this.userPreferences[habit.vague_keyword] = habit.avg_delay;
              console.log(`[Reminder] Learned "${habit.vague_keyword}" = ${habit.avg_delay} minutes`);
            }
          });
        }
      } catch (error) {
        console.error('[Reminder] Failed to load preferences from history:', error);
      }
    }
  }

  // 获取用户偏好（优先从历史中查询）
  async getUserPreference(keyword) {
    // 先查本地缓存
    if (this.userPreferences[keyword]) {
      return this.userPreferences[keyword];
    }

    // 再从数据库查询
    if (window.PetReminder) {
      try {
        const pref = await window.PetReminder.getPreference(keyword);
        if (pref && pref.avgMinutes) {
          // 缓存到本地
          this.userPreferences[keyword] = pref.avgMinutes;
          return pref.avgMinutes;
        }
      } catch (error) {
        console.error('[Reminder] Failed to get user preference:', error);
      }
    }

    return null;
  }

  // 解析中文数字
  parseChineseNumber(chinese) {
    // 直接查表
    if (this.chineseNumbers[chinese]) {
      return this.chineseNumbers[chinese];
    }

    // 处理组合数字（如"十五"、"二十三"）
    let result = 0;
    let temp = 0;

    for (let i = 0; i < chinese.length; i++) {
      const char = chinese[i];
      const num = this.chineseNumbers[char];

      if (num === undefined) continue;

      if (char === '十') {
        if (temp === 0) temp = 1;
        result += temp * 10;
        temp = 0;
      } else {
        temp = num;
      }
    }

    result += temp;
    return result || 1; // 默认返回1
  }

  // 从文本中提取提醒
  async extract(text) {
    // 检查是否包含提醒关键词
    const hasKeyword = this.reminderKeywords.some(kw => text.includes(kw));
    if (!hasKeyword) {
      return null;
    }

    // 提取时间
    let remindAt = null;
    let matchedPattern = null;
    let isVague = false;
    let vagueKeyword = null;

    for (const timePattern of this.timePatterns) {
      const match = text.match(timePattern.pattern);
      if (match) {
        const context = { userPreferences: this.userPreferences };
        remindAt = timePattern.parser(match, context);
        matchedPattern = timePattern.pattern;
        isVague = timePattern.isVague || false;
        vagueKeyword = isVague ? match[1] : null;
        break;
      }
    }

    if (!remindAt) {
      return null;
    }

    // 提取提醒内容
    const content = this.extractContent(text, matchedPattern);

    // 处理模糊时间
    if (isVague) {
      return await this.handleVagueTime(content, remindAt, text, vagueKeyword);
    }

    return {
      content,
      remindAt,
      originalText: text,
      needsConfirmation: false
    };
  }

  // 处理模糊时间
  async handleVagueTime(content, defaultTime, originalText, keyword) {
    const now = Date.now();

    // 尝试从历史记录获取偏好
    const learnedPreference = await this.getUserPreference(keyword);
    const preference = learnedPreference || this.userPreferences[keyword];

    // 检查询问频率
    const timeSinceLastAsk = now - this.lastAskTime;
    if (timeSinceLastAsk > this.ASK_COOLDOWN) {
      // 重置计数
      this.askCount = 0;
    }

    // 如果询问频率过高，直接使用偏好
    if (this.askCount >= this.ASK_THRESHOLD) {
      const minutesToUse = preference || Math.ceil((defaultTime - Date.now()) / 60000);
      console.log('[Reminder] Ask threshold reached, using preference or default');
      return {
        content,
        remindAt: Date.now() + minutesToUse * 60 * 1000,
        originalText,
        needsConfirmation: false,
        vagueKeyword: keyword
      };
    }

    // 如果有用户偏好（从历史学习或localStorage），询问是否使用
    if (preference) {
      this.askCount++;
      this.lastAskTime = now;

      return {
        content,
        remindAt: Date.now() + preference * 60 * 1000,
        originalText,
        needsConfirmation: true,
        confirmationType: 'use_preference',
        preferenceMinutes: preference,
        vagueKeyword: keyword,
        message: `根据习惯，"${keyword}"一般是${preference}分钟，对吗？`
      };
    }

    // 没有偏好，询问具体时间
    this.askCount++;
    this.lastAskTime = now;

    return {
      content,
      remindAt: defaultTime,
      originalText,
      needsConfirmation: true,
      confirmationType: 'ask_minutes',
      vagueKeyword: keyword,
      message: `"${keyword}"是多久呢？`
    };
  }

  // 解析模糊时间
  parseVagueTime(keyword, context) {
    // 优先使用用户偏好
    const userPref = context?.userPreferences?.[keyword];
    if (userPref) {
      return Date.now() + userPref * 60 * 1000;
    }

    // 使用默认值
    const minutes = this.vagueTimeMapping[keyword] || 10;
    return Date.now() + minutes * 60 * 1000;
  }

  // 加载用户偏好
  loadPreferences() {
    try {
      const prefs = localStorage.getItem('reminder_time_preferences');
      return prefs ? JSON.parse(prefs) : {};
    } catch (e) {
      return {};
    }
  }

  // 保存用户偏好
  savePreference(keyword, minutes) {
    this.userPreferences[keyword] = minutes;
    try {
      localStorage.setItem('reminder_time_preferences', JSON.stringify(this.userPreferences));
    } catch (e) {
      console.error('[Reminder] Failed to save preference:', e);
    }
  }

  // 解析绝对时间 (如 "15点30分")
  parseAbsoluteTime(hour, minute) {
    const now = new Date();
    let targetHour = parseInt(hour);
    let targetMinute = minute ? parseInt(minute) : 0;

    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0);

    // 如果目标时间已过，默认是明天
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return target.getTime();
  }

  // 解析相对分钟
  parseRelativeMinutes(minutes) {
    return Date.now() + minutes * 60 * 1000;
  }

  // 解析相对小时
  parseRelativeHours(hours) {
    return Date.now() + hours * 60 * 60 * 1000;
  }

  // 解析相对小时和分钟
  parseRelativeHoursAndMinutes(hours, minutes) {
    return Date.now() + (hours * 60 + minutes) * 60 * 1000;
  }

  // 解析相对天数
  parseRelativeDays(days) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    target.setDate(target.getDate() + days);
    return target.getTime();
  }

  // 解析相对日期
  parseRelativeDay(keyword) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

    switch (keyword) {
      case '明天':
        target.setDate(target.getDate() + 1);
        break;
      case '后天':
        target.setDate(target.getDate() + 2);
        break;
      case '大后天':
        target.setDate(target.getDate() + 3);
        break;
    }

    return target.getTime();
  }

  // 解析时间段
  parseTimeOfDay(keyword) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (keyword) {
      case '凌晨':
        target.setHours(6, 0, 0);
        break;
      case '早上':
      case '上午':
        target.setHours(8, 0, 0);
        break;
      case '中午':
        target.setHours(12, 0, 0);
        break;
      case '下午':
        target.setHours(14, 0, 0);
        break;
      case '晚上':
      case '今晚':
        target.setHours(20, 0, 0);
        break;
    }

    // 如果目标时间已过，设为明天
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return target.getTime();
  }

  // 提取提醒内容
  extractContent(text, matchedPattern) {
    // 移除时间部分，保留动作描述
    let content = text;

    // 移除常见前缀
    content = content.replace(/(记得|别忘了|别忘记|记住|叫我|喊我|告诉我|通知我)/, '');
    content = content.replace(/(设个提醒|定个闹钟|设置提醒)/, '');
    content = content.replace(/(提醒[我你]?)/, '');

    // 移除时间部分 - 需要将正则转换为字符串来替换
    if (matchedPattern) {
      content = content.replace(matchedPattern, '');
    }

    // 清理
    content = content
      .replace(/[，,、。]/g, '')
      .replace(/\s+/g, '')
      .trim();

    // 如果内容为空，使用默认值
    if (!content) {
      content = '该做某件事了';
    }

    return content;
  }

  // 格式化时间显示
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = timestamp - now.getTime();
    const diffMinutes = Math.ceil(diff / (60 * 1000)); // 使用 ceil 向上取整
    const diffHours = Math.floor(diff / (60 * 60 * 1000));

    // 今天
    if (date.getDate() === now.getDate() && date.getMonth() === now.getMonth()) {
      if (diffMinutes <= 1) {
        return '马上';
      }
      if (diffMinutes < 60) {
        return `${diffMinutes}分钟后`;
      }
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    // 明天
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date.getDate() === tomorrow.getDate() && date.getMonth() === tomorrow.getMonth()) {
      return `明天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    // 后天
    const dayAfterTomorrow = new Date(now);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    if (date.getDate() === dayAfterTomorrow.getDate() && date.getMonth() === dayAfterTomorrow.getMonth()) {
      return `后天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    // 其他日期
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}

// 创建全局实例
window.ReminderExtractor = new ReminderExtractor();
