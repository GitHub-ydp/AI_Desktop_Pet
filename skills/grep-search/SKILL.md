---
name: grep_search
description: 在目录中按正则表达式搜索文件内容，返回匹配行及上下文，用于代码分析和内容定位
metadata: {"dangerous": false, "confirm": false, "category": "file"}
user-invocable: false
---
## 何时调用
需要在多个文件中查找特定内容、函数名、变量名、错误信息时调用。
优先于逐个 file_read，适合"找到所有调用 foo 函数的地方"类任务。

## 参数
- path (string, 必须): 搜索根目录
- pattern (string, 必须): 搜索模式（支持正则表达式）
- file_pattern (string, 可选): 文件名过滤，默认 * （如 *.js、*.py）
- case_sensitive (boolean, 可选): 是否区分大小写，默认 false
- max_results (number, 可选): 最多返回结果数，默认 50
- context_lines (number, 可选): 匹配行前后展示几行，默认 2

## 示例
grep_search({ path: "C:/project", pattern: "function foo", file_pattern: "*.js" })
grep_search({ path: "C:/project", pattern: "import.*axios", file_pattern: "*.ts" })
grep_search({ path: "C:/Users/xxx/Desktop", pattern: "错误|error|exception", case_sensitive: false })
