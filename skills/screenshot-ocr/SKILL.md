---
name: screenshot_ocr
description: 对截图进行 OCR 文字识别
metadata: {"dangerous": false, "confirm": false, "category": "media"}
user-invocable: false
---
## 何时调用
用户需要识别图片或截图中的文字时调用。

## 参数
- imageId (string, 可选): 截图 ID（从截图历史中选择）
- dataURL (string, 可选): 图片的 dataURL（直接传入）

## 示例
用户: "识别一下这张截图的文字" -> screenshot_ocr({ imageId: "最近截图ID" })
