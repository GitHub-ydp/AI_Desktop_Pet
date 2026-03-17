---
name: open_url
description: 在默认浏览器中打开 URL
metadata: {"dangerous": false, "confirm": false, "category": "system"}
user-invocable: false
---
## 何时调用
用户需要打开网页链接时调用。

## 参数
- url (string, 必须): 要打开的 URL（支持 http:// 和 https:// 协议）

## 安全限制
- 支持 http:// 和 https:// 协议
- 禁止 file:// 和 javascript: 协议

## 示例
用户: "帮我打开百度" -> open_url({ url: "https://www.baidu.com" })
