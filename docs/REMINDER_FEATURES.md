# 定时提醒功能说明文档

## 功能概述

定时提醒系统允许宠物记住用户的提醒请求，并在指定时间通过系统通知和宠物对话来提醒用户。

## 核心功能

### 1. 智能时间识别

系统支持多种时间表达方式：

#### 绝对时间
- `15点30分` / `15:30` - 今天15:30
- `9点` - 今天09:00
- `明天下午3点` - 明天15:00

#### 相对时间
- `10分钟后` / `十分钟后` - 10分钟后
- `半小时后` / `半小时后` - 30分钟后
- `2小时后` - 2小时后
- `2小时30分钟后` - 2小时30分钟后
- `明天` / `后天` / `大后天` - 相对日期
- `3天后` - 3天后的上午9点

#### 时间段
- `早上` / `上午` - 08:00
- `中午` - 12:00
- `下午` - 14:00
- `晚上` / `今晚` - 20:00
- `凌晨` - 06:00

#### 模糊时间（支持学习用户偏好）
- `马上` / `立刻` / `立即` - 默认1分钟
- `一会儿` - 默认10分钟
- `等一下` - 默认5分钟
- `稍后` - 默认15分钟
- `晚点` - 默认30分钟
- `半天` - 默认120分钟

### 2. 用户偏好学习

系统会记录用户对模糊时间词的使用习惯，并自动学习：

**示例：**
```
用户: 一会儿后提醒我喝水
宠物: "一会儿"是具体多久呢？（比如10分钟）
用户: 15分钟
系统: 记住偏好 "一会儿" = 15分钟

下次用户说"一会儿后提醒我..."时，系统会使用15分钟
```

**学习机制：**
- 使用3次以上后，系统会自动记住偏好
- 偏好存储在数据库中，程序重启后依然有效
- 可以通过 `analyzeHabits()` API 查看所有学习到的偏好

### 3. 过期任务处理

程序关闭期间的提醒会被智能处理：

| 过期时长 | 处理策略 |
|---------|---------|
| < 1小时 | 可选择立即触发或标记为错过 |
| 1-2小时 | 标记为错过，记录到历史 |
| > 2小时 | 自动取消 |

**错过提醒的通知：**
```
"你不在的时候，我错过了3个提醒..."
```

### 4. 提醒历史记录

所有完成（包括错过）的提醒都会被记录到历史表，包含：
- 提醒内容
- 创建时间
- 计划提醒时间
- 实际完成时间
- 延迟分钟数
- 模糊时间词（如有）
- 创建时的性格和心情

### 5. 重复提醒

支持以下重复模式：
- `daily` - 每天
- `weekly` - 每周
- `monthly` - 每月
- `yearly` - 每年
- 数字（毫秒） - 自定义间隔

## API 使用

### 创建提醒
```javascript
await window.PetReminder.create({
  content: '喝水',
  remindAt: Date.now() + 10 * 60 * 1000,
  metadata: {
    vagueKeyword: '一会儿',
    personality: 'healing',
    mood: 80
  }
});
```

### 获取待处理提醒
```javascript
const pending = await window.PetReminder.getPending();
```

### 获取用户偏好
```javascript
const pref = await window.PetReminder.getPreference('一会儿');
// { keyword: '一会儿', avgMinutes: 15, sampleSize: 5 }
```

### 分析用户习惯
```javascript
const habits = await window.PetReminder.analyzeHabits();
// [
//   { vague_keyword: '一会儿', count: 5, avg_delay: 15, ... },
//   { vague_keyword: '晚点', count: 3, avg_delay: 45, ... }
// ]
```

### 获取提醒历史
```javascript
const history = await window.PetReminder.getHistory({
  limit: 20,
  vagueKeyword: '一会儿'
});
```

## 数据库结构

### reminders 表
```sql
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  remind_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/completed/cancelled/missed
  source_conversation_id TEXT,
  repeat_pattern TEXT,
  repeat_end_at INTEGER,
  completed_at INTEGER,
  metadata TEXT
);
```

### reminder_history 表
```sql
CREATE TABLE reminder_history (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  remind_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  delay_minutes INTEGER,
  vague_keyword TEXT,
  personality TEXT,
  mood INTEGER
);
```

## 配置选项

在 `main-process/reminder.js` 中可配置：

```javascript
this.overdueThreshold = 3600000; // 1小时内算过期
this.overdueStrategy = 'miss';   // 过期策略: miss/catch_up/ignore
this.checkIntervalMs = 30000;    // 30秒检查一次
```

## 注意事项

1. **时区处理**：所有时间使用本地时间戳
2. **精度限制**：检查间隔为30秒，提醒可能有最多30秒延迟
3. **通知权限**：需要系统通知权限才能显示系统通知
4. **历史记录**：删除提醒会同时删除相关历史记录（级联删除）
