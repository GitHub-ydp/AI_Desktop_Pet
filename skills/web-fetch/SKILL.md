---
name: web_fetch
description: 抓取网页正文内容，供研究和阅读类任务使用
metadata: {"dangerous": false, "confirm": false, "category": "search"}
user-invocable: false
---
## 何时调用
当用户已经给出 URL，或者搜索后需要进一步读取网页正文时调用。

## 参数
- url (string, 必须): 要抓取的网页地址，必须是 http 或 https

## 示例
用户: "打开这个链接看看讲了什么 https://example.com/post" -> web_fetch({ url: "https://example.com/post" })
用户: "把这篇文章的正文抓给我 https://example.com/article" -> web_fetch({ url: "https://example.com/article" })

## 配合 web_search 的研究流程
用户没有给出 URL 时，先用 web_search 找到相关页面，再用 web_fetch 读取正文：
1. web_search({ query: "用户的问题" }) → 拿到包含 URL 的结果
2. web_fetch({ url: "从搜索结果中选出最相关的 URL" }) → 读取正文
3. 基于正文内容回答用户
