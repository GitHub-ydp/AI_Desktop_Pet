---
name: web_search
description: 在网络上搜索信息，回答用户的知识性问题
metadata: {"dangerous": false, "confirm": false, "category": "search"}
user-invocable: false
---
## 何时调用
用户询问需要联网查询的实时信息、新闻、知识时调用。包括查询今日新闻、热点、时事资讯。
注意：天气查询请使用 weather_get，不要用 web_search。

## 参数
- query (string, 必须): 搜索关键词
- maxResults (number, 可选): 最大返回结果数，默认 5

## 示例
用户: "最新的 AI 新闻" -> web_search({ query: "最新 AI 新闻", maxResults: 3 })
用户: "Python 怎么读取文件" -> web_search({ query: "Python 读取文件" })
