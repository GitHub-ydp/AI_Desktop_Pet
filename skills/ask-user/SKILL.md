---
name: ask_user
description: 暂停任务向用户提问，等待回答后继续执行
metadata: {"dangerous": false, "confirm": false, "category": "interaction"}
user-invocable: false
---

## 何时调用

当 AI 遇到歧义、缺少必要信息或有多种等价方案需要用户选择时。

## 参数

- question (string, 必须): 向用户提出的问题（简洁明了）
- options (array, 可选): 选项列表，格式 [{"label":"选项A","value":"a"}, ...]
- timeout_seconds (number, 可选): 等待超时秒数，默认 60

## 返回

- 成功: { "answer": "用户的回答" }
- 超时: { "answer": null, "timed_out": true }
