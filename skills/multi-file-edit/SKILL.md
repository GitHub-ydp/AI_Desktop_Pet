---
name: multi_file_edit
description: 原子化编辑多个文件，任意一个失败则全部回滚，保证文件系统一致性
metadata: {"dangerous": false, "confirm": true, "category": "file"}
user-invocable: false
---
## 何时调用
需要同时修改多个文件，且要求"全部成功或全部不改"时调用。
重构、批量替换、跨文件联动修改场景优先使用此技能。

## 参数
- edits (array, 必须): 编辑操作数组，每项包含：
  - path (string): 文件绝对路径
  - old_string (string): 要替换的原始内容（空字符串表示追加）
  - new_string (string): 替换后的新内容
  - create_if_missing (boolean, 可选): 文件不存在时是否创建
- description (string, 可选): 本次批量编辑的说明

## 限制
- 单次最多 10 个文件
- 失败时自动回滚所有已写入的修改

## 示例
multi_file_edit({
  description: "重命名函数 foo → bar",
  edits: [
    { path: "C:/project/a.js", old_string: "function foo(", new_string: "function bar(" },
    { path: "C:/project/b.js", old_string: "foo(", new_string: "bar(" }
  ]
})
