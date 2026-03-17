---
name: git_ops
description: 执行 Git 基础操作：查看状态、差异、日志、分支、提交
metadata: {"dangerous": false, "confirm": true, "category": "system"}
user-invocable: false
---
## 何时调用
用户需要了解代码变更状态、查看历史、或提交修改时调用。

## 参数
- action (string, 必须): 操作类型，可选值：status / diff / log / branch / commit
- path (string, 必须): Git 仓库目录路径
- message (string, commit时必须): 提交信息（仅 action=commit 时有效）

## 示例
git_ops({ action: "status", path: "C:/project" })
git_ops({ action: "log", path: "C:/project" })
git_ops({ action: "commit", path: "C:/project", message: "fix: 修复登录bug" })
