# 意图识别 + 多模型路由设计文档

## 一、意图分类体系

定义 6 种意图类型：

| 意图 | 触发特征 | 举例 |
|------|---------|------|
| chat | 情感词、问候、随聊 | "你好"、"陪我聊聊"、"今天好开心" |
| task | 动作词+对象（文件/系统/提醒） | "帮我新建文件夹"、"设个提醒"、"打开记事本" |
| search | 问句+未知信息 | "今天天气"、"XX 是什么"、"帮我查一下" |
| creative | 创作词 | "帮我写一首诗"、"编个故事"、"起个名字" |
| code | 代码相关词 | "帮我写个 Python 脚本"、"这段代码什么意思" |
| vision | 图片/截图相关 | "分析这张图"、"截图里写了什么"、"看看这张照片" |

## 二、轻量意图分类器设计（< 5ms，无 LLM 调用）

### 2.1 核心原理

基于关键词规则的同步分类器。每种意图配置 10-15 个中文触发词，对输入文本做关键词匹配并计算加权得分，取最高分意图作为结果。

### 2.2 关键词规则（每种意图 10-15 个触发词）

- **chat**: 你好, 嗨, 在吗, 聊聊, 陪我, 无聊, 开心, 难过, 心情, 感觉, 想你, 谢谢, 晚安, 早安, 么么
- **task**: 提醒, 打开, 新建, 创建, 删除, 移动, 复制, 重命名, 设置, 关机, 定时, 帮我做, 执行, 运行, 安装
- **search**: 是什么, 怎么, 为什么, 哪里, 谁是, 多少, 查一下, 搜索, 百科, 天气, 新闻, 什么意思, 告诉我
- **creative**: 写一首, 编一个, 故事, 诗歌, 作文, 歌词, 小说, 起名, 文案, 剧本, 创作, 想象, 编造
- **code**: 代码, 脚本, 函数, 变量, 编程, 程序, 调试, bug, Python, JavaScript, 算法, 正则, API
- **vision**: 图片, 截图, 照片, 看看, 图中, 分析图, 识别, OCR, 拍的, 屏幕, 图像

### 2.3 置信度计算

```
score(intent) = sum(matchedKeywords) / totalKeywords(intent)
confidence = maxScore / (maxScore + secondMaxScore + epsilon)
```

如果最高分 < 0.1，回退到 `chat`（默认意图）。

### 2.4 输出格式

```javascript
{ intent: 'chat', confidence: 0.85, reasoning: '匹配关键词: 你好, 聊聊' }
```

### 2.5 实现位置

`src/intent-classifier.js`（渲染进程，同步函数，通过 `window.IntentClassifier` 暴露）

## 三、多模型路由策略

基于现有 `llmSceneConfig`（存储在 localStorage `settings.llmSceneConfig`）和 `api-keys.json`（存储在 userData）。

### 3.1 意图到场景映射

现有系统已有 `llmSceneConfig` 的 `chat`/`vision`/`translate`/`ocr` 四个场景，每个场景可配置 provider 和 model。意图路由复用此机制：

| 意图 | 映射场景 | 首选模型 | 备选 |
|------|---------|---------|------|
| chat | chat | 用户配置的 chat 场景 | deepseek-chat |
| task | chat | 同 chat 场景（工具调用） | deepseek-chat |
| search | chat | 同 chat 场景 | deepseek-chat |
| creative | chat | 同 chat 场景 | deepseek-chat |
| code | chat | 同 chat 场景 | deepseek-chat |
| vision | vision | 用户配置的 vision 场景 | deepseek-chat（降级无视觉） |

### 3.2 设计决策

**为什么不新增更多场景？**

现有 `llmSceneConfig` 已支持用户在设置面板中为每个场景选择 provider + model。意图路由的核心价值是**自动选择场景**，而不是增加场景数量。用户可以在未来通过设置面板扩展场景（如单独配置 code 场景），路由器只需映射即可。

### 3.3 Provider 端点配置

复用 `src/api.js` 中已有的 `OPENAI_COMPAT_PROVIDERS`：

| Provider | Endpoint |
|----------|----------|
| deepseek | https://api.deepseek.com/v1 |
| openai | https://api.openai.com/v1 |
| openrouter | https://openrouter.ai/api/v1 |
| siliconflow | https://api.siliconflow.cn/v1 |
| glm | https://open.bigmodel.cn/api/paas/v4 |
| qwen | https://dashscope.aliyuncs.com/compatible-mode/v1 |

## 四、ModelRouter 接口设计（main-process/model-router.js）

```javascript
class ModelRouter {
  constructor() { /* 读取 api-keys.json */ }

  // 根据意图获取路由配置
  route(intent, options) {
    // 返回 { provider, model, endpoint, apiKey, scene }
  }

  // 获取可用 providers（有 key 的）
  getAvailableProviders() {
    // 返回 [{ provider, hasKey, models }]
  }

  // 降级链
  getFallbackChain(intent) {
    // 返回 [route, route, ...]
  }
}
```

### 4.1 路由逻辑

1. 意图分类器在渲染进程同步计算意图
2. 意图映射到场景（chat/vision/...）
3. 从 `llmSceneConfig` 读取该场景的 provider + model
4. 通过 IPC 从主进程获取对应 provider 的 API key
5. 组装完整路由：`{ provider, model, endpoint, apiKey }`

### 4.2 降级策略

如果首选 provider 的 key 不可用：
1. 回退到 deepseek（默认 provider）
2. 如果 deepseek 也不可用，使用 mock 响应

## 五、与 api.js 集成方案

### 5.1 修改点

`callDeepSeekAPI` 增加可选参数 `{ intent }`：

```javascript
async function callDeepSeekAPI(messages, personality, options = {}) {
  // 新增：如果有 intent，通过 ModelRouter IPC 获取路由
  // 否则使用现有的 getChatSceneConfig() 逻辑
}
```

### 5.2 集成流程

```
用户消息 → IntentClassifier.classify() → intent
         → chatWithAI() 传入 intent
         → callDeepSeekAPI() 根据 intent 选择场景配置
         → 返回结果附带 { usedModel, usedProvider }
```

### 5.3 兼容性

- 不传 intent 时，行为与现有代码完全一致
- IntentClassifier 是纯渲染进程模块，不影响主进程
- ModelRouter 是主进程模块，通过 IPC 暴露给渲染进程

## 六、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| src/intent-classifier.js | 新建 | 渲染进程意图分类器 |
| main-process/model-router.js | 新建 | 主进程模型路由器 |
| src/api.js | 修改 | 集成意图路由 |
| preload.js | 修改 | 新增 modelRouter IPC 桥接 |
| index.html | 修改 | 加载 intent-classifier.js |
