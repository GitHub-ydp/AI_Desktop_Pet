---
name: open_app
description: 打开应用程序（仅限常见应用）
metadata: {"dangerous": true, "confirm": true, "category": "system", "requires": {"os": ["win32"]}}
user-invocable: false
---
## 何时调用
用户要求打开某个应用程序时调用。

## 参数
- app_name (string, 必须): 应用名称，如 "notepad"、"code"、"chrome"、"edge"、"explorer"、"calc"

## 安全限制
- 仅支持白名单内的常见应用
- 执行前需用户确认

## 示例
用户: "打开记事本" -> open_app({ app_name: "notepad" })
用户: "打开 VS Code" -> open_app({ app_name: "code" })
