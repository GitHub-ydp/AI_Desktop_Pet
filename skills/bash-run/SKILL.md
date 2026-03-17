---
name: bash_run
description: 在 Windows 系统上执行 PowerShell 或 cmd 命令，完成系统操作、文件管理、程序启动等任务
metadata: {"requires": {"os": ["win32"]}, "dangerous": true, "confirm": true, "timeout": 30000, "category": "system"}
user-invocable: false
---
## 何时调用
用户要求执行系统命令、管理文件、查询系统信息时调用。当文件操作技能无法满足需求时才使用此技能，不要用于基本文件操作。

## 参数
- command (string, 必须): 要执行的 PowerShell 命令
- timeout (number, 可选): 超时毫秒数，默认 30000

## 安全限制
- 禁止执行涉及 System32、Windows 目录的命令
- 禁止执行 format、diskpart 等破坏性命令
- 禁止修改注册表、系统服务
- 所有命令执行前需用户确认

## 示例
用户: "帮我打开计算器" -> bash_run({ command: "calc.exe" })
用户: "查看 D 盘剩余空间" -> bash_run({ command: "Get-PSDrive D | Select-Object Used,Free" })
用户: "当前目录有哪些文件" -> bash_run({ command: "Get-ChildItem | Format-Table Name,Length,LastWriteTime" })
