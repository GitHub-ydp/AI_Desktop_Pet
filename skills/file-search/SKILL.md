---
name: file_search
description: 按名称搜索文件
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
用户需要按文件名查找特定文件时调用。如需搜索文件内容，请使用 grep_search 技能。

## 参数
- path (string, 必须): 搜索起始目录
- pattern (string, 必须): 文件名通配符模式，如 "*.txt"
- recursive (boolean, 可选): 是否递归搜索，默认 true

## 示例
用户: "找到所有 txt 文件" -> file_search({ path: "~/Documents", pattern: "*.txt" })
用户: "桌面有没有 pdf 文件" -> file_search({ path: "~/Desktop", pattern: "*.pdf" })
