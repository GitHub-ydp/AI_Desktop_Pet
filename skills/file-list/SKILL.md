---
name: file_list
description: 列出指定目录下的文件，支持通配符过滤
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
用户需要查看某个目录下有哪些文件时调用。

## 参数
- path (string, 必须): 目录路径
- filter (string, 可选): 文件名过滤器，如 "*.jpg"，默认 *
- recursive (boolean, 可选): 是否递归子目录，默认 false

## 示例
用户: "桌面有哪些文件" -> file_list({ path: "~/Desktop" })
用户: "找出所有图片" -> file_list({ path: "~/Desktop", filter: "*.{jpg,png}", recursive: true })
