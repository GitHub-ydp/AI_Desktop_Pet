---
name: file_write
description: 写入或创建文本文件
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
用户需要创建新文件或写入内容到文件时调用。

## 参数
- path (string, 必须): 文件绝对路径
- content (string, 必须): 要写入的文本内容
- create_dirs (boolean, 可选): 是否自动创建父目录，默认 true

## 安全限制
- 禁止写入系统目录
- 执行前需用户确认
- 自动备份已存在的文件

## 示例
用户: "帮我创建一个 todo.txt" -> file_write({ path: "~/Desktop/todo.txt", content: "待办事项\n1. ..." })
