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
- remindAt (number, 必须): 提醒触发时间，值为 Unix 毫秒时间戳（数字类型），不要传入 JS 表达式
- repeat (string, 可选): 重复模式，支持 daily/weekly/monthly

## 示例
用户: "10分钟后提醒我喝水" -> reminder_create({ content: "喝水", remindAt: <当前Unix毫秒时间戳 + 偏移量，例如: 1742190600000> })
用户: "每天早上9点提醒我打卡" -> reminder_create({ content: "打卡", remindAt: <明天9点对应的Unix毫秒时间戳>, repeat: "daily" })
