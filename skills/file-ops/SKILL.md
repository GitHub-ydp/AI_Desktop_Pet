---
name: file_read
description: 读取本地文件内容，支持文本文件的读取操作
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
用户需要查看、读取文件内容时调用。

## 参数
- path (string, 必须): 文件绝对路径
- encoding (string, 可选): 文件编码，默认 utf8

## 安全限制
- 仅允许读取用户目录下的文件
- 禁止读取系统目录（C:\Windows、C:\Program Files 等）
- 最大读取文件大小：5MB

## 示例
用户: "帮我看看这个文件内容" -> file_read({ path: "D:/work/readme.txt" })
用户: "读取桌面上的 notes.md" -> file_read({ path: "C:/Users/xxx/Desktop/notes.md" })
