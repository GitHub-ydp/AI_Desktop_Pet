---
name: clipboard_set
description: 将文本内容设置到系统剪贴板
metadata: {"dangerous": false, "confirm": false, "category": "system"}
user-invocable: false
---
## 何时调用
用户需要复制文本到剪贴板时调用。

## 参数
- text (string, 必须): 要复制到剪贴板的文本

## 示例
用户: "帮我复制这段话" -> clipboard_set({ text: "要复制的内容" })
