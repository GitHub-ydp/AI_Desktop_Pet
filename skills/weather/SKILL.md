---
name: weather_get
description: 查询当前天气和未来预报
metadata: {"dangerous": false, "confirm": false, "category": "info"}
user-invocable: false
---
## 何时调用
用户询问天气、温度、降雨、未来几天天气预报时调用。

## 参数
- location (string, 可选): 城市名，留空则自动检测当前位置

## 示例
用户: "今天天气怎么样" -> weather_get({})
用户: "上海未来三天天气" -> weather_get({ location: "上海" })
