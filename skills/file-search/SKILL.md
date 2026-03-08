---
name: file_search
description: 按名称或内容搜索文件
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
用户需要搜索特定文件或在文件中查找内容时调用。

## 参数
- path (string, 必须): 搜索起始目录
- pattern (string, 必须): 文件名通配符模式，如 "*.txt"
- content_search (string, 可选): 文件内容搜索关键词
- recursive (boolean, 可选): 是否递归搜索，默认 true

## 示例
用户: "找到所有 txt 文件" -> file_search({ path: "~/Documents", pattern: "*.txt" })
用户: "哪个文件里有密码" -> file_search({ path: "~/Desktop", pattern: "*", content_search: "密码" })
