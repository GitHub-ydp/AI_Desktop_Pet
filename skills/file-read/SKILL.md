---
name: file_read
description: 读取本地文件内容，支持文本文件的读取操作，可指定行范围读取大文件
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
用户需要查看、读取文件内容时调用。

## 参数
- path (string, 必须): 文件绝对路径，支持 `~` 展开
- encoding (string, 可选): 文件编码，默认 `utf8`
- offset (number, 可选): 从第几行开始读取（从 1 计数），默认 `0`（从头读取）
- limit (number, 可选): 最多读取多少行，默认 `0`（读取到末尾）

## 返回字段
- content: 文件内容（字符串）
- totalLines: 文件总行数
- size: 文件大小（字节）
- truncated: 是否因 `offset/limit` 截断

## 安全限制
- 仅允许读取用户目录下的文件
- 禁止读取系统目录（`C:\Windows`、`C:\Program Files` 等）
- 最大读取文件大小：5MB

## 示例
用户: "帮我看看这个文件内容" -> `file_read({ path: "D:/work/readme.txt" })`
用户: "读取桌面上的 notes.md" -> `file_read({ path: "C:/Users/xxx/Desktop/notes.md" })`
用户: "读取日志第 50~100 行" -> `file_read({ path: "D:/app.log", offset: 50, limit: 50 })`
