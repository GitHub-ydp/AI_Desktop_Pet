---
name: memory_search
description: 在记忆系统中搜索历史对话和用户信息
metadata: {"dangerous": false, "confirm": false, "category": "memory"}
user-invocable: false
---
## 何时调用
需要回忆历史对话、查找用户之前提到的信息时调用。

## 参数
- query (string, 必须): 搜索关键词或语义查询
- maxResults (number, 可选): 最大返回结果数，默认 5

## 示例
用户: "我之前说过我喜欢什么" -> memory_search({ query: "用户喜好偏好" })
用户: "我上次聊了什么" -> memory_search({ query: "最近对话内容", maxResults: 3 })
