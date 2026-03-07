# 多模型 API Key 管理功能 - 测试报告
## 执行日期：2026-03-06
## 审查员：tester（自动化测试）

---

## 一、实现现状总结

### ✅ 已实现部分

#### 1. API Key 持久化存储层
- **文件位置**：`userData/api-keys.json`
- **实现函数**：
  - `readApiKeysFile()` - 读取 api-keys.json
  - `saveProviderApiKey(provider, key)` - 保存单个 provider 的 key
  - `getApiKeysFilePath()` - 获取文件路径（延迟初始化）

#### 2. 优先级逻辑
```javascript
// main.js 第 150-161 行
function getProviderApiKeyByProvider(provider) {
  // 1. 优先从 api-keys.json 读取
  const savedKeys = readApiKeysFile();
  if (savedKeys[normalizedProvider]) {
    return savedKeys[normalizedProvider];
  }
  // 2. 降级到环境变量
  return process.env[envKey] || '';
}
```

#### 3. IPC 处理器
- `save-provider-api-key` - 保存 API Key
- `get-all-provider-keys` - 获取所有 provider 的 key（脱敏）
- `get-provider-api-key` - 获取单个 provider 的 key

#### 4. preload.js 桥接
- `window.electron.saveProviderAPIKey(provider, key)`
- `window.electron.getAllProviderAPIKeys()`

#### 5. 日志脱敏
```javascript
// maskApiKey() 函数：前 4 位 + **** + 后 4 位
'sk-1234567890abcdef' => 'sk-1****cdef'
```

#### 6. 错误处理
- provider 校验
- key 类型检查
- 文件 I/O 异常捕获

### ❌ 缺失部分

#### 1. **settings-window.html UI**
- 无 API Key 输入界面
- 无保存按钮
- 无已配置状态显示

#### 2. **记忆系统 API Key 动态更新**
- FactExtractorLLM 创建时使用固定的 `process.env.DEEPSEEK_API_KEY`
- 无 `updateApiKey()` 或 `setApiKey()` 调用机制
- 用户在 UI 修改 API Key 后，事实提取器不会更新

#### 3. **IPC 日志**
- `get-provider-api-key` 无日志输出（对比 `get-api-key` 有脱敏日志）

---

## 二、测试执行结果

### 测试 1：API Key 保存和加载 ⚠️

**测试项**：文件重启后 key 是否保留

**代码路径验证**：
- saveProviderApiKey() 正确写入 JSON 文件 ✓
- readApiKeysFile() 正确读取 JSON 文件 ✓
- 存储逻辑：`keys[provider] = key` ✓

**依赖问题**：
- ❌ settings-window.html 无 UI 无法实际调用 saveProviderApiKey()
- 理论上正确，但未经过 UI 集成测试

**评分**：5/10（实现正确但无 UI）

---

### 测试 2：多 Provider 切换 ✅

**测试项**：设置不同场景（chat/vision）使用不同 provider，验证实际调用正确的 provider

**代码路径验证**：
```
scene config (chat/vision)
  → llmSceneConfig[scene].provider
  → getProviderApiKeyByProvider(provider)
  → 优先读 api-keys.json，再读 .env
```

**发现**：
- screenshot:analyze-image handler 使用正确的 visionConfig.provider ✓
- 场景配置 UI 存在且可正常修改 ✓
- 多 provider 支持完整（deepseek、openai、openrouter、siliconflow、glm、tesseract）✓

**评分**：9/10（实现完整，仅缺 UI 集成）

---

### 测试 3：优先级验证 ✅

**测试项**：界面设置的 key 优先于 .env 文件

**代码验证**：
```javascript
// main.js 第 154-160 行
const savedKeys = readApiKeysFile();
if (savedKeys[normalizedProvider]) {
  return savedKeys[normalizedProvider];  // 优先返回 api-keys.json
}
return process.env[envKey] || '';       // 降级到 .env
```

**测试结果**：✅ 逻辑正确

**评分**：10/10

---

### 测试 4：降级验证 ✅

**测试项**：key 为空时，回退到 .env 文件的 key

**代码验证**：
```javascript
// api-keys.json 中 provider 不存在或为空
if (savedKeys[normalizedProvider]) { ... }  // 条件不满足
return process.env[envKey] || '';          // 回退到 .env
```

**测试结果**：✅ 逻辑正确

**评分**：10/10

---

### 测试 5：安全性 - 日志脱敏 ⚠️

**测试项**：确认 key 在日志中被脱敏

**现状**：
- ✅ saveProviderApiKey() 日志：仅显示长度
- ✅ maskApiKey() 函数实现正确
- ✅ get-all-provider-keys IPC 返回脱敏的 masked key
- ❌ get-provider-api-key IPC 无任何日志

**发现问题**：
- 日志不一致：saveProviderApiKey() 有脱敏日志，但 get-provider-api-key 无日志

**评分**：7/10（基本脱敏，日志不全）

---

### 测试 6：界面兼容性 ❌

**测试项**：赛博朋克主题正确应用，与现有 UI 一致

**发现**：
- ❌ settings-window.html 中完全没有 API Key 管理卡片
- ✅ CSS 变量系统完整
- ⚠️ 无法评估实际界面效果

**评分**：0/10（缺失）

---

### 测试 7：错误处理 ⚠️

**测试项**：无效 key 时错误提示清晰

**代码验证**：
- ✅ IPC handler 中有 provider 和 type 验证
- ❌ 无 API Key 格式验证（如长度、字符集）
- ❌ 无 API Key 连通性测试
- ❌ 界面错误提示未实现

**评分**：6/10（基础验证，缺高级检查）

---

## 三、全局影响检查

### 影响评估 #1：记忆系统 API Key 不可动态更新 🚨

**问题描述**：

```javascript
// main.js 第 427-429 行
memorySystem = new MemoryMainProcess({
  apiKey: process.env.DEEPSEEK_API_KEY || ''
});
```

**后续流程**：
```javascript
// main-process/memory.js 第 146-147 行
this.factExtractorLLM = new FactExtractorLLM({
  apiKey: this.options.apiKey,  // 来自启动时的 process.env.DEEPSEEK_API_KEY
});
```

**问题场景**：
1. 应用启动时：.env 中 DEEPSEEK_API_KEY='old-key'
   → memorySystem 初始化，factExtractorLLM.apiKey = 'old-key'

2. 用户在 UI 保存新 key：'new-key'
   → api-keys.json 中 deepseek='new-key'
   → getProviderApiKeyByProvider() 返回 'new-key'

3. **但 factExtractorLLM 仍使用 'old-key'**
   → 事实提取失败或使用旧账户

**严重程度**：**CRITICAL**

---

### 影响评估 #2：截图 AI 分析 API Key 来源 ✅

**现状**：✅ 正确使用 getProviderApiKeyByProvider()
- 优先读取用户在 UI 配置的 key（api-keys.json）
- 次级读取 .env
- 支持动态切换场景配置

**评分**：9/10

---

### 影响评估 #3：事实提取器 API Key 使用 🚨

**问题**：同影响评估 #1

**调用链**：
```
user message → memory.addConversation()
  → factExtractorLLM.addConversation()
  → flushBuffer()
  → 调用 API 时使用 this.apiKey（启动时写入的旧 key）
```

**严重程度**：**CRITICAL**

---

## 四、缺陷列表

| ID | 严重程度 | 问题 | 文件 | 优先级 |
|----|--------|------|------|--------|
| D1 | CRITICAL | 记忆系统 API Key 无动态更新机制 | memory.js | P0 |
| D2 | CRITICAL | FactExtractorLLM API Key 使用旧值 | fact-extractor.js | P0 |
| D3 | MAJOR | settings-window.html 无 API Key UI | settings-window.html | P0 |
| D4 | MAJOR | 无 save provider key 的 UI 调用 | settings-window.html | P0 |
| D5 | MINOR | get-provider-api-key 缺日志 | main.js | P1 |
| D6 | MINOR | 无 API Key 格式验证 | main.js | P1 |
| D7 | MINOR | 无 API Key 连通性测试 | main.js | P2 |

---

## 五、测试覆盖率统计

| 测试项 | 评分 | 状态 |
|--------|------|------|
| 1. API Key 保存/加载 | 5/10 | ⚠️ 理论正确，缺 UI |
| 2. 多 Provider 切换 | 9/10 | ✅ 基本完整 |
| 3. 优先级验证 | 10/10 | ✅ 完全正确 |
| 4. 降级验证 | 10/10 | ✅ 完全正确 |
| 5. 日志脱敏 | 7/10 | ⚠️ 部分完整 |
| 6. 界面兼容 | 0/10 | ❌ 缺失 |
| 7. 错误处理 | 6/10 | ⚠️ 基础有，高级缺 |

**平均评分**：6.7/10

---

## 六、全局影响评分

- **记忆系统**：2/10（有致命缺陷）
- **截图系统**：9/10（正确使用）
- **UI 集成**：1/10（基本缺失）
- **综合评分**：4/10（功能不完整）

---

## 七、关键问题总结

### 🚨 必须立即修复

1. **记忆系统 API Key 更新机制缺失**
   - 导致事实提取器使用旧 API Key
   - 用户切换 API Key 后功能失效

2. **settings-window.html API Key UI 缺失**
   - 用户无法通过界面配置 API Key
   - IPC handlers 无法被调用

### ⚠️ 应该补完

3. 日志脱敏不一致
4. API Key 格式验证不足
5. 错误提示未实现

---

## 八、建议优化顺序

1. **第一步（最紧急）**：修复 FactExtractorLLM API Key 无法动态更新
2. **第二步（紧急）**：实现 settings-window.html API Key UI
3. **第三步（重要）**：添加 IPC 日志、增强验证
4. **第四步（可选）**：API Key 连通性测试

---

等待后续修复后重新审查。
