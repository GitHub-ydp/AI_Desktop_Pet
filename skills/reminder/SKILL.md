---
name: reminder_create
description: 创建定时提醒，在指定时间通知用户
metadata: {"dangerous": false, "confirm": false, "category": "reminder"}
user-invocable: false
---
## 何时调用
用户需要设置提醒、闹钟、定时通知时调用。

## 参数
- content (string, 必须): 提醒内容
- remindAt (number, 必须): 提醒触发时间（Unix 时间戳毫秒）
- repeat (string, 可选): 重复模式，支持 daily/weekly/monthly

## 示例
用户: "10分钟后提醒我喝水" -> reminder_create({ content: "喝水", remindAt: Date.now() + 600000 })
用户: "每天早上9点提醒我打卡" -> reminder_create({ content: "打卡", remindAt: 明天9点时间戳, repeat: "daily" })
