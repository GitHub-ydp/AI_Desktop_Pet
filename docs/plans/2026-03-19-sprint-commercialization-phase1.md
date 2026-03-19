# Sprint: 商业化基础 — 第一阶段开发计划

> 日期：2026-03-19
> 周期：4-6 周（分 3 个子 Sprint）
> 团队：Claude（计划+验收）、Codex（实施）、Gemini（美工）、老板（测试+转达）

---

## 总体目标

**让项目可以安全地公开发布，并具备基本的成本控制和收入入口。**

当前致命问题：API Key `sk-e3c0a6...` 硬编码在客户端 `builtin-api.js`，任何人反编译即可盗用。

---

## Sprint 1：后端 API 网关（第 1-2 周）

### 目标
API Key 从客户端移到服务端，客户端不再持有任何密钥。

---

### 任务 A1：后端服务搭建（Codex）

**创建一个独立的后端项目** `server/`（放在仓库根目录下，与 Electron 客户端平级）

**技术选型：**
- 运行时：Node.js + Express（团队已有 Node 经验，无学习成本）
- 数据库：SQLite（开发期）→ MySQL/PostgreSQL（上线时迁移）
- 部署：先本地跑通，后续部署到阿里云

**目录结构：**
```
server/
├── package.json
├── .env                  # API_KEY, JWT_SECRET 等（不提交 Git）
├── .env.example          # 模板
├── src/
│   ├── index.js          # 入口，启动 Express
│   ├── routes/
│   │   ├── auth.js       # 注册/登录/刷新 token
│   │   └── chat.js       # AI 对话代理（核心）
│   ├── middleware/
│   │   ├── auth.js       # JWT 校验中间件
│   │   └── rate-limit.js # 限流中间件
│   ├── services/
│   │   ├── user.js       # 用户 CRUD
│   │   └── usage.js      # 用量记录
│   └── db/
│       ├── schema.sql    # 数据库建表
│       └── database.js   # SQLite 封装
└── README.md
```

**核心 API 端点：**

```
POST /api/v1/auth/register    — 注册（手机号+验证码）
POST /api/v1/auth/login       — 登录（手机号+验证码）
POST /api/v1/auth/refresh     — 刷新 JWT token

POST /api/v1/chat/completions — AI 对话代理（核心）
  请求头: Authorization: Bearer <JWT_TOKEN>
  请求体: { model, messages, stream, tools, ... }
  行为:
    1. 校验 JWT → 获取 user_id
    2. 查用量 → 检查当日配额
    3. 转发到 dashscope.aliyuncs.com（附上真实 API Key）
    4. 流式透传响应（SSE）
    5. 异步记录用量（user_id, tokens, timestamp）

GET  /api/v1/user/usage       — 查询当日用量
GET  /api/v1/user/profile     — 获取用户信息+套餐状态
```

**数据库表设计：**

```sql
-- 用户表
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone VARCHAR(20) UNIQUE NOT NULL,
  nickname VARCHAR(50) DEFAULT '',
  avatar_url VARCHAR(255) DEFAULT '',
  subscription_tier VARCHAR(20) DEFAULT 'free',  -- free/standard/pro
  subscription_expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用量记录表（按天聚合）
CREATE TABLE daily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  UNIQUE(user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 详细调用日志（可选，用于分析）
CREATE TABLE api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint VARCHAR(100),
  model VARCHAR(50),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status_code INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**限流规则：**

```javascript
const RATE_LIMITS = {
  free:     { dailyMessages: 30,  perMinute: 5  },
  standard: { dailyMessages: 200, perMinute: 15 },
  pro:      { dailyMessages: -1,  perMinute: 30 }  // -1 = 无限
};
```

**关键实现细节：**
- JWT 有效期 7 天，支持 refresh
- `/chat/completions` 必须支持 SSE 流式透传（不能等全部响应完再返回）
- 用量记录异步写入，不阻塞响应
- CORS 允许 Electron 客户端访问（`file://` origin）
- 错误码标准化：401 未登录、403 配额耗尽、429 限流、502 上游错误

---

### 任务 A2：客户端改造 — 指向后端网关（Codex）

**改造的文件和具体改动：**

#### (1) `main-process/builtin-api.js` — 改为后端网关地址

```javascript
// 改造前:
const BUILTIN_API = {
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: 'sk-e3c0a6a4b24440ff8de691b0294364ca',
  // ...
};

// 改造后:
const BUILTIN_API = {
  // 后端网关地址（开发期用 localhost，上线后改为正式域名）
  gatewayUrl: 'http://localhost:3000/api/v1',
  endpoint: 'http://localhost:3000/api/v1/chat/completions',
  // apiKey 删除！不再存在于客户端
  provider: 'qwen',
  model: 'qwen3.5-plus',
  supportsTools: true,
  supportsVision: true,

  getRoute(scene) {
    return {
      provider: this.provider,
      model: this.model,
      endpoint: this.endpoint,
      // apiKey 不再返回，改为返回 JWT token
      scene: scene || 'chat',
      credentialSource: 'gateway',
      supportsTools: this.supportsTools
    };
  }
};
```

#### (2) `src/api.js` — Authorization 从 API Key 改为 JWT

```javascript
// 改造前:
const apiKey = await window.electron?.getBuiltinAPIKey?.();
headers: { 'Authorization': `Bearer ${apiKey}` }

// 改造后:
const token = localStorage.getItem('auth_token');
if (!token) { /* 跳转到登录界面 */ }
headers: { 'Authorization': `Bearer ${token}` }
```

#### (3) `main-process/agent-runtime.js` — _buildProviderHeaders 改用 JWT

```javascript
// 改造前:
_buildProviderHeaders(route) {
  return { 'Authorization': `Bearer ${route.apiKey}`, ... };
}

// 改造后:
_buildProviderHeaders(route) {
  // agent-runtime 在主进程，需要从存储中获取 token
  const token = this.getAuthToken();  // 从 electron-store 或 IPC 获取
  return { 'Authorization': `Bearer ${token}`, ... };
}
```

#### (4) `main.js` — 删除 `get-builtin-api-key` IPC handler

```javascript
// 删除这个 handler:
ipcMain.handle('get-builtin-api-key', () => {
  return BUILTIN_API.apiKey;
});

// 替换为:
ipcMain.handle('get-auth-token', () => {
  // 从本地安全存储获取 JWT token
  return store.get('auth_token') || null;
});
```

#### (5) `preload.js` — 桥接更新

```javascript
// 删除:
getBuiltinAPIKey: () => ipcRenderer.invoke('get-builtin-api-key'),

// 替换为:
getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
setAuthToken: (token) => ipcRenderer.invoke('set-auth-token', token),
clearAuthToken: () => ipcRenderer.invoke('clear-auth-token'),
```

#### (6) `main-process/fact-extractor.js` 和 `main-process/extractor.js`
- 这两个也调用 Qwen API 做事实提取
- 同样改为通过后端网关转发
- 附带 JWT token

---

### 任务 A3：登录/注册界面（Gemini 美工 + Codex 实现）

**Gemini 负责：**
设计 `windows/auth-window.html` 的视觉稿，要求：
- 延续 lazyCat 暖色主题（深暖棕 + 琥珀橙）
- 两个状态：登录 / 注册（标签页切换）
- 登录：手机号输入框 + 验证码输入框 + 获取验证码按钮 + 登录按钮
- 注册：手机号 + 验证码 + 昵称（可选）+ 注册按钮
- 底部：跳过登录（游客模式，限制更严 = 每天 10 次）
- 尺寸：400x500px（与主窗口一致）
- 风格参考：当前 `windows/init-window.html` 的初始化向导风格
- 需要一个可爱的宠物 logo 或插画在顶部

**Codex 负责：**
按 Gemini 的设计稿实现 HTML/CSS/JS，集成到 Electron：
- `main.js` 中新增 `createAuthWindow()` 方法
- 应用启动时检查本地是否有有效 JWT token
  - 有 → 正常进入主界面
  - 无/过期 → 显示登录窗口
- 登录成功后 token 存储到 `electron-store` 或 `localStorage`

---

### Sprint 1 验收标准

```
[ ] 后端服务可在 localhost:3000 启动
[ ] POST /api/v1/chat/completions 能正确代理到 Qwen（流式）
[ ] 客户端 builtin-api.js 中不再包含任何 API Key
[ ] 客户端 API 请求使用 JWT token 而非 API Key
[ ] preload.js 中 getBuiltinAPIKey 已删除
[ ] 未登录时显示登录窗口，登录后自动进入主界面
[ ] 限流生效：超出配额返回 403 + 友好错误消息
[ ] 基本的注册/登录流程跑通（开发期可用固定验证码如 1234）
```

---

## Sprint 2：订阅套餐 + 支付（第 3-4 周）

### 目标
实现基本的付费能力，用户可以升级套餐。

---

### 任务 B1：后端套餐与支付（Codex）

**新增端点：**

```
GET  /api/v1/subscription/plans    — 获取套餐列表和价格
POST /api/v1/subscription/create   — 创建订单（返回支付链接）
POST /api/v1/subscription/callback — 支付回调（Webhook）
GET  /api/v1/subscription/status   — 查询当前订阅状态
```

**套餐定义：**

```javascript
const PLANS = {
  free: {
    name: '免费版',
    price: 0,
    dailyMessages: 30,
    features: ['基础对话', '猫咪皮肤', '7天记忆']
  },
  standard: {
    name: '标准版',
    price: 990,   // 单位：分 = ¥9.90
    period: 'monthly',
    dailyMessages: 200,
    features: ['无限对话', '全部皮肤', '永久记忆', 'Agent 技能', '提醒系统']
  },
  pro: {
    name: '专业版',
    price: 2990,  // ¥29.90
    period: 'monthly',
    dailyMessages: -1,
    features: ['标准版全部', '无限对话', '优先响应', '云端同步(未来)']
  }
};
```

**支付接入（建议虎皮椒/Payjs，最低门槛）：**
- 个人开发者可接入，无需企业资质
- 支持微信扫码 + 支付宝
- 手续费 ~1%
- 回调 Webhook 更新 `users.subscription_tier` 和 `subscription_expires_at`

**新增数据库表：**

```sql
-- 订单表
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_no VARCHAR(64) UNIQUE NOT NULL,
  plan VARCHAR(20) NOT NULL,         -- standard/pro
  amount INTEGER NOT NULL,           -- 金额（分）
  status VARCHAR(20) DEFAULT 'pending', -- pending/paid/cancelled/refunded
  payment_channel VARCHAR(20),       -- wechat/alipay
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

### 任务 B2：客户端套餐界面（Gemini + Codex）

**Gemini 负责：**
设计 `windows/subscription-window.html` 视觉稿：
- 三栏卡片布局：免费 / 标准 / Pro
- 每张卡片：套餐名 + 价格 + 功能列表 + 操作按钮
- 当前套餐高亮标记
- 标准版推荐标签（「最受欢迎」）
- 支付按钮点击后显示二维码（微信/支付宝）
- 延续 lazyCat 暖色主题

**Codex 负责：**
- 实现 HTML/CSS/JS
- 集成支付流程：点击付费 → 后端创建订单 → 显示支付二维码 → 轮询支付状态 → 成功后刷新
- 在设置面板 `windows/settings-window.html` 中添加「我的套餐」入口
- 配额耗尽时弹出友好提示 + 引导升级

---

### Sprint 2 验收标准

```
[ ] GET /subscription/plans 返回正确的套餐信息
[ ] 客户端可以查看当前套餐和剩余配额
[ ] 配额耗尽时显示友好提示 + 升级引导（而非报错）
[ ] 支付流程跑通（测试环境：虎皮椒沙箱 或手动改库模拟）
[ ] 支付成功后 subscription_tier 正确更新
[ ] 用量限制根据套餐动态调整
```

---

## Sprint 3：上线准备（第 5-6 周）

### 目标
部署后端、完善体验、准备发布。

---

### 任务 C1：后端部署（Codex）

```
推荐方案：
- 服务器：阿里云轻量应用服务器（¥62/月，2核2G 足够初期）
- 域名：申请一个域名（如 api.ai-pet.com），配置 HTTPS
- 数据库：初期 SQLite 文件即可（<1万用户够用），后续迁移 MySQL
- 进程管理：PM2
- 日志：PM2 logs + 简单的 error 报警（钉钉 Webhook）

部署后修改：
- builtin-api.js 的 gatewayUrl 改为正式域名
- 确保 CORS 配置正确
```

### 任务 C2：短信验证码接入（Codex）

```
开发期：固定验证码 1234（方便测试）
上线前：接入阿里云短信（¥0.045/条）
- 签名报备 + 模板审核（需 1-3 天）
- 60秒发送间隔 + 每日 10 次上限（防刷）
```

### 任务 C3：客户端体验完善（Codex + Gemini）

```
必做：
- 登录状态失效时自动跳转登录（401 全局拦截）
- 配额用完的温和提示（不是报错，是宠物语气引导升级）
- 网络断开时的离线降级体验
- 设置面板显示：当前套餐、剩余次数、到期时间

Gemini：
- 配额耗尽弹窗的设计稿
- 设置面板「我的账号」区域设计稿
```

### 任务 C4：安全审查（Codex）

```
检查清单：
[ ] 客户端代码中不含任何 API Key（全文搜索 sk-）
[ ] JWT Secret 不在代码中（通过 .env 加载）
[ ] 支付回调有签名校验
[ ] SQL 注入防护（参数化查询）
[ ] 手机号脱敏存储或传输加密
[ ] rate-limit 对匿名请求也生效（防 DDoS）
```

---

### Sprint 3 验收标准

```
[ ] 后端部署到云服务器，HTTPS 可访问
[ ] 客户端指向正式域名，全流程跑通
[ ] 新用户注册 → 免费使用 → 达到限额 → 提示升级 → 支付 → 解锁 全链路OK
[ ] 全文搜索客户端代码，0 处出现 API Key
[ ] 连续 24 小时无崩溃运行测试
```

---

## 人员分工速查

| 任务 | Codex | Gemini | 老板（测试） | Claude（验收） |
|------|:-----:|:------:|:----------:|:------------:|
| A1 后端服务搭建 | 主力 | | | 代码审查 |
| A2 客户端改造 | 主力 | | 功能测试 | 改动点审查 |
| A3 登录界面 | 实现 | 设计稿 | 体验测试 | |
| B1 套餐+支付后端 | 主力 | | | API 审查 |
| B2 套餐界面 | 实现 | 设计稿 | 支付测试 | |
| C1 部署 | 主力 | | 线上测试 | |
| C2 短信接入 | 主力 | | 注册测试 | |
| C3 体验完善 | 实现 | 设计稿 | 全流程测试 | |
| C4 安全审查 | 执行 | | | 审查确认 |

---

## 当前行动项（立即开始）

### 转达给 Codex：
> 请先完成 Sprint 1 的任务 A1（后端服务搭建）。在仓库根目录下创建 `server/` 目录，按上面的结构搭建 Express 服务。核心是 `/api/v1/chat/completions` 端点，要支持 SSE 流式透传。开发期 JWT 和限流可以简化，但架构要到位。完成后告诉我，我来验收。

### 转达给 Gemini：
> 请设计登录/注册窗口（auth-window）的视觉稿。尺寸 400x500px，暖色主题（深暖棕底色 `#1a1210`，主色琥珀橙 `#ffb347`，次色橙红 `#ff6b35`）。包含：顶部宠物插画/logo、手机号+验证码输入、登录/注册切换、底部「游客模式」链接。参考现有 `windows/init-window.html` 的风格。

---

## 风险与应对

| 风险 | 概率 | 应对 |
|------|:----:|------|
| 阿里云短信审核不通过 | 中 | 备选：腾讯云短信 / 邮箱验证码 |
| 虎皮椒/Payjs 个人限制 | 低 | 备选：面对面收款码 + 手动开通 |
| SSE 流式透传实现复杂 | 中 | 可参考 OpenAI 代理方案，社区有大量示例 |
| Electron file:// CORS 问题 | 高 | 后端配置 `Access-Control-Allow-Origin: *` 或使用 `app://` scheme |
