---
name: file_edit
description: 精确编辑文件中的指定内容，用 new_string 替换 old_string，适合修改文件的一小部分而不覆盖整个文件
metadata: {"dangerous": false, "confirm": true, "category": "file"}
user-invocable: false
---
## 何时调用
需要修改文件中某一段内容时使用，比修改整个文件更安全。

## 参数
- path (string, 必须): 文件绝对路径，支持 ~/ 开头
- old_string (string, 必须): 要被替换的原始文本（必须在文件中唯一存在）
- new_string (string, 必须): 替换后的新内容（传空字符串即删除该段）
- create_if_missing (boolean, 可选): old_string 为空时是否创建文件，默认 false

## 安全限制
- old_string 必须唯一，否则拒绝操作
- 禁止编辑系统目录

## 示例
file_edit({ path: "~/Desktop/config.txt", old_string: "version=1", new_string: "version=2" })
