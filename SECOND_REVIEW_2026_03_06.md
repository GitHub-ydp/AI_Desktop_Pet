# 多模型 API Key 管理功能 - 第二轮代码审查报告
## 执行日期：2026-03-06
## 审查员：tester（自动化测试）
## 审查对象：architect 的修改

---

## 一、审查项目清单

### ✅ 检查项 1：main.js - api-keys.json 读写逻辑

**位置**：第 109-161 行

**实现内容**：
- ✅ `getApiKeysFilePath()` - 延迟初始化，app.getPath('userData') 正确
- ✅ `readApiKeysFile()` - 读取 JSON，异常捕获完整，返回 {}
- ✅ `saveProviderApiKey()` - 写入 JSON，日志脱敏（仅显示长度）
- ✅ `maskApiKey()` - 脱敏函数正确（前 4+后 4）
- ✅ `getProviderApiKeyByProvider()` - 优先级逻辑正确（api-keys.json > .env）

**评分**：10/10 ✅

---

### ✅ 检查项 2：main.js - IPC Handler 完整性

**位置**：第 1012-1117 行

#### Handler #1：get-provider-api-key (第 1012-1015 行)
```javascript
ipcMain.handle('get-provider-api-key', (event, provider) => {
  const apiKey = getProviderApiKeyByProvider(provider);
  return apiKey;
});
```

**问题**：
- ❌ **缺失日志**：相比 get-api-key handler，此处无脱敏日志
- ✅ 其他逻辑正确

**建议**：添加日志：
```javascript
console.log('[API Keys] get-provider-api-key for:', provider, 'found:', apiKey ? apiKey.length + ' chars' : 'NO KEY');
```

#### Handler #2：save-provider-api-key (第 1018-1033 行)
```javascript
ipcMain.handle('save-provider-api-key', (event, provider, key) => {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  if (!normalizedProvider || !PROVIDER_ENV_KEY_MAP[normalizedProvider]) {
    return { success: false, error: '不支持的 provider' };
  }
  if (typeof key !== 'string') {
    return { success: false, error: 'key 必须是字符串' };
  }
  try {
    saveProviderApiKey(normalizedProvider, key.trim());
    return { success: true };
  } catch (error) {
    console.error('[API Keys] 保存失败:', error.message);
    return { success: false, error: error.message };
  }
});
```

**评估**：
- ✅ 输入验证完整（provider、key 类型检查）
- ✅ 错误处理正确
- ✅ key.trim() 清理
- ❌ **关键问题**：**未调用 `memorySystem.updateApiKey()`！**

**严重程度**：**CRITICAL**

用户保存新 API Key 后，记忆系统（FactExtractorLLM）无法感知变更。

#### Handler #3：get-all-provider-keys (第 1036-1050 行)
- ✅ 实现完整，脱敏显示正确

#### Handler #4：test-provider-api-key (第 1061-1117 行)
```javascript
ipcMain.handle('test-provider-api-key', async (event, provider) => {
  // 验证 provider，检查 API Key，发送 HTTP GET 请求
  // 根据 statusCode 返回成功/失败
})
```

**评估**：
- ✅ 异步正确处理
- ✅ 超时 10 秒设置
- ✅ 状态码检查（2xx 成功，401/403 无效 key）
- ✅ 错误处理完整
- ⚠️ 若 tesseract provider 无 HTTP 端点，应排除或返回 "local" 标记

**评分**：9/10

---

### ✅ 检查项 3：preload.js - IPC 桥接

**位置**：第 11-13 行

```javascript
saveProviderAPIKey: (provider, key) => ipcRenderer.invoke('save-provider-api-key', provider, key),
getAllProviderAPIKeys: () => ipcRenderer.invoke('get-all-provider-keys'),
testProviderAPIKey: (provider) => ipcRenderer.invoke('test-provider-api-key', provider),
```

**评估**：
- ✅ 三个 handler 全部暴露
- ✅ 命名一致（camelCase）
- ✅ 参数传递正确

**评分**：10/10 ✅

---

### ✅ 检查项 4：settings-window.html - API Key 卡片 UI

**位置**：第 261-399 行（CSS）+ 686-1157 行（HTML + JS）

#### CSS 样式检查
- ✅ `.apikey-row` - 行布局正确
- ✅ `.apikey-input` - 输入框使用 password 类型，自动完成禁用
- ✅ `.apikey-toggle-vis` - 显示/隐藏按钮
- ✅ `.apikey-save-btn` - 保存按钮样式
- ✅ `.apikey-test-btn` - 测试按钮，disabled 状态管理
- ✅ `.apikey-toast` - 提示消息，success/error 状态
- ✅ 赛博朋克主题色使用正确（--neon-cyan、--neon-magenta）

**评分**：10/10 ✅

#### HTML 卡片结构
```html
<div class="setting-group">
  <h3>API Key 管理</h3>
  <div id="apikeyContainer"></div>
  <div class="apikey-toast" id="apikeyToast"></div>
</div>
```

**评估**：
- ✅ 卡片名称清晰
- ✅ 容器 ID 正确
- ✅ Toast 提示区域

**评分**：10/10 ✅

#### JavaScript 实现检查

**1. API_KEY_PROVIDERS 配置（第 1040-1046 行）**
```javascript
const API_KEY_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', models: '...' },
  { id: 'openai', name: 'OpenAI', models: '...' },
  { id: 'openrouter', name: 'OpenRouter', models: '...' },
  { id: 'siliconflow', name: 'SiliconFlow', models: '...' },
  { id: 'glm', name: 'GLM', models: '...' }
];
```

**问题**：
- ❌ **缺失**：tesseract provider！settings-window.html 中没有显示 tesseract
- ⚠️ main.js 的 PROVIDER_ENV_KEY_MAP 中有 tesseract，但这里没有

**建议**：添加
```javascript
{ id: 'tesseract', name: 'Tesseract (本地)', models: 'OCR 文字识别' }
```

**2. renderApiKeyRows() 函数（第 1048-1074 行）**
- ✅ 动态生成 HTML
- ✅ 状态 icon（✓ / -）
- ✅ masked 显示
- ✅ placeholder 根据 configured 状态变化
- ✅ 显示/隐藏按钮
- ✅ 保存和测试按钮
- ✅ 常用模型提示

**评分**：9/10（缺 tesseract）

**3. toggleApiKeyVis() 函数（第 1076-1083 行）**
- ✅ 切换 password/text 类型

**评分**：10/10 ✅

**4. saveApiKey() 函数（第 1085-1116 行）**
```javascript
async function saveApiKey(provider) {
  const input = document.getElementById(`apikey-${provider}`);
  const key = input.value.trim();
  if (!key) return;

  const btn = input.closest('.apikey-row').querySelector('.apikey-save-btn');
  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    const result = await window.electron.saveProviderAPIKey(provider, key);
    // 处理成功/失败，刷新状态
    await loadApiKeys();
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}
```

**评估**：
- ✅ 异步调用正确
- ✅ trim() 清理
- ✅ 按钮状态管理（disabled、loading 文本）
- ✅ 成功后清空输入框
- ✅ 成功后调用 loadApiKeys() 刷新状态
- ✅ 错误提示显示
- ⚠️ 缺少 key 长度验证（应至少 20 字符）

**评分**：8/10

**5. testApiKey() 函数（第 1118-1142 行）**
- ✅ 异步调用 window.electron.testProviderAPIKey()
- ✅ 按钮状态管理
- ✅ 成功/失败提示
- ✅ 自动关闭 toast

**评分**：10/10 ✅

**6. loadApiKeys() 函数（第 1144-1157 行）**
```javascript
async function loadApiKeys() {
  try {
    if (window.electron && window.electron.getAllProviderAPIKeys) {
      const keysInfo = await window.electron.getAllProviderAPIKeys();
      renderApiKeyRows(keysInfo);
    }
  } catch (error) {
    renderApiKeyRows({});  // 降级
  }
}
```

**评估**：
- ✅ 异步调用
- ✅ 异常处理和降级（渲染空状态）
- ✅ 调用 renderApiKeyRows() 更新 UI

**评分**：10/10 ✅

**7. 在 loadSettings() 中调用（第 897 行）**
```javascript
function loadSettings() {
  // ...
  llmSceneConfig = normalizeSceneConfig(snapshot.llmSceneConfig || DEFAULT_SCENE_CONFIG);
  applySceneConfigEditors();

  // 加载 API Key 状态
  loadApiKeys();
}
```

**评估**：
- ✅ 在正确位置调用
- ✅ DOMContentLoaded 后执行

**评分**：10/10 ✅

**整体 UI 评分**：8/10（缺 tesseract，缺长度验证）

---

### ❌ 检查项 5：memory.js - updateApiKey() 方法

**问题**：**未实现！**

**搜索结果**：
```bash
$ grep -n "updateApiKey" /c/Users/Administrator/Desktop/jizhang/main-process/memory.js
(无结果)
```

**评估**：
- ❌ MemoryMainProcess 中没有 updateApiKey() 方法
- ❌ FactExtractorLLM 的 setApiKey() 无人调用
- ❌ 用户保存新 API Key 后，事实提取器仍使用旧 key

**严重程度**：**CRITICAL**

---

## 二、关键问题汇总

### 🚨 CRITICAL 问题

#### 问题 #1：save-provider-api-key 不触发 updateApiKey()

**位置**：main.js 第 1018-1033 行

**现象**：
```
用户在 UI 保存新 API Key
  → save-provider-api-key IPC handler
  → saveProviderApiKey() 写入文件
  → 返回 { success: true }
  → **但 memorySystem 和 factExtractorLLM 未更新**
```

**后果**：
- 用户刷新页面后，loadApiKeys() 会显示新 key
- 但事实提取器继续使用旧 key
- 用户无感知，导致 AI 功能异常

**修复方案**：
在 save-provider-api-key handler 中添加：
```javascript
ipcMain.handle('save-provider-api-key', (event, provider, key) => {
  // ... 现有验证和保存 ...
  try {
    saveProviderApiKey(normalizedProvider, key.trim());

    // 动态更新记忆系统的 API Key
    if (memorySystem && memorySystem.updateApiKey) {
      const deepseekKey = getProviderApiKeyByProvider('deepseek');
      memorySystem.updateApiKey(deepseekKey);
      console.log('[API Keys] 已更新 memorySystem API Key');
    }

    return { success: true };
  } catch (error) {
    // ...
  }
});
```

**严重程度**：**CRITICAL**（用户无法真正使用新 API Key）

---

#### 问题 #2：MemoryMainProcess 缺 updateApiKey() 方法

**位置**：main-process/memory.js（全文件）

**现象**：
- FactExtractorLLM 有 setApiKey() 方法（第 63-65 行）
- 但 MemoryMainProcess 没有调用它的机制

**修复方案**：
在 MemoryMainProcess 中添加：
```javascript
updateApiKey(newApiKey) {
  console.log('[Memory] Updating API Key');
  this.options.apiKey = newApiKey;

  // 更新各个模块
  if (this.factExtractor) {
    this.factExtractor.setApiKey(newApiKey);
  }
  if (this.embeddingService) {
    this.embeddingService.setApiKey(newApiKey);
  }
  if (this.factExtractorLLM) {
    this.factExtractorLLM.setApiKey(newApiKey);
  }
}
```

**严重程度**：**CRITICAL**

---

### ⚠️ MAJOR 问题

#### 问题 #3：settings-window.html 缺少 tesseract provider

**位置**：第 1040-1046 行

**现象**：
- API_KEY_PROVIDERS 只有 5 个 provider
- tesseract 被遗漏
- 但 main.js PROVIDER_ENV_KEY_MAP 中有 tesseract（值为 null）

**修复**：添加 tesseract 到 API_KEY_PROVIDERS

**严重程度**：**MAJOR**（UI 不完整）

---

### ⚠️ MINOR 问题

#### 问题 #4：saveApiKey() 缺少长度验证

**位置**：第 1085-1116 行

**现象**：
```javascript
const key = input.value.trim();
if (!key) return;  // 只检查是否为空，不检查长度
```

**建议**：
```javascript
const key = input.value.trim();
if (!key) return;
if (key.length < 20) {
  toast.textContent = 'API Key 太短，长度应至少 20 字符';
  toast.className = 'apikey-toast error';
  return;
}
```

**严重程度**：**MINOR**

---

#### 问题 #5：get-provider-api-key handler 缺日志

**位置**：main.js 第 1012-1015 行

**修复**：添加脱敏日志

**严重程度**：**MINOR**

---

## 三、审查总结

### 代码正确性评分

| 项目 | 评分 | 状态 |
|------|------|------|
| main.js - 存储逻辑 | 10/10 | ✅ |
| main.js - IPC Handlers | 6/10 | 🚨 缺关键更新 |
| preload.js - 桥接 | 10/10 | ✅ |
| settings-window.html - 样式 | 10/10 | ✅ |
| settings-window.html - 逻辑 | 8/10 | ⚠️ 缺验证 |
| memory.js - updateApiKey | 0/10 | ❌ 未实现 |

### 全局影响评估

**记忆系统的 API Key 更新机制**：❌ 完全缺失

- 用户在 UI 保存新 key → api-keys.json 写入 ✓
- loadApiKeys() 显示新 key ✓
- **但 FactExtractorLLM.apiKey 仍为旧值** ❌

**用户体验**：
```
预期：用户切换 API Key 后，系统立即使用新 key
实际：保存后刷新页面，但事实提取器仍用旧 key
      用户尝试触发事实提取 → API 失败或计费错账户
      用户困惑，以为功能坏了
```

**修复难度**：⭐ 简单（仅需 2 处改动）

---

## 四、修复建议优先级

### P0（阻断性，必须立即修复）

**修复 1**：main.js save-provider-api-key handler 添加 updateApiKey() 调用
- 预计 5 分钟
- 文件：main.js 第 1018-1033 行

**修复 2**：MemoryMainProcess 添加 updateApiKey() 方法
- 预计 10 分钟
- 文件：main-process/memory.js

### P1（重要）

**修复 3**：settings-window.html 添加 tesseract provider
- 预计 2 分钟

**修复 4**：saveApiKey() 添加长度验证
- 预计 3 分钟

### P2（可选）

**修复 5**：get-provider-api-key handler 添加日志
- 预计 1 分钟

---

## 五、最终评分

**代码审查评分**：**4/10** 🚨

### 分项评分

| 维度 | 分数 | 备注 |
|------|------|------|
| UI 实现 | 9/10 | 样式和交互完整，缺 tesseract |
| IPC 桥接 | 10/10 | 完整且正确 |
| 存储逻辑 | 10/10 | api-keys.json 读写正确 |
| 动态更新机制 | 0/10 | 完全缺失！CRITICAL |
| 测试功能 | 9/10 | 连通性测试完整 |
| **综合** | **4/10** | 功能 70% 完成，但**核心机制缺失** |

---

## 六、建议后续步骤

1. **立即修复** P0 问题（2 处）
2. 运行完整测试，验证 API Key 动态更新是否生效
3. 修复 P1 问题
4. 进行集成测试

---

## 七、测试清单（待修复后）

- [ ] 用户保存新 API Key，刷新页面，确认显示新 key
- [ ] 触发对话和事实提取，确认使用新 key 而非旧 key
- [ ] 测试连接，验证新 key 有效性
- [ ] 多 provider 切换，确认每个都能独立配置
- [ ] 重启应用，确认 api-keys.json 被正确加载

---

等待 architect 修复 P0 问题后，将进行重新审查。

