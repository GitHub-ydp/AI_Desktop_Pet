# Sprint 2：订阅套餐 + 支付（第 3-4 周）

> 日期：2026-03-20
> 前置完成：Sprint 1（后端网关 + 账号 + 自动启动）
> 团队：Claude（计划+验收）、Codex（实施）、Gemini（美工）、老板（测试+转达）

---

## 总体目标

**让用户可以查看套餐、购买升级、配额用尽时友好引导。**

当前状态：后端已有三档套餐限流（free=30/天、standard=200/天、pro=无限），但没有支付入口，所有用户都是 free。

---

## 任务概览

| ID | 任务 | 负责人 | 优先级 | 依赖 |
|----|------|--------|--------|------|
| B1-1 | 后端：订单表 + 套餐 API | Codex | P0 | 无 |
| B1-2 | 后端：支付集成（虎皮椒） | Codex | P0 | B1-1 |
| B1-3 | 后端：订阅到期自动降级 | Codex | P1 | B1-1 |
| B2-1 | 套餐选择窗口设计稿 | Gemini | P0 | 无 |
| B2-2 | 套餐选择窗口实现 | Codex | P0 | B1-1, B2-1 |
| B2-3 | 配额耗尽引导（聊天窗口内） | Codex | P0 | B1-1 |
| B2-4 | 设置面板"我的账号"区域 | Codex + Gemini | P1 | B1-1 |

---

## B1-1：后端 — 订单表 + 套餐查询/升级 API（Codex）

### 数据库新增

在 `server/src/db/schema.sql` 末尾追加：

```sql
-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_no VARCHAR(64) UNIQUE NOT NULL,
  plan VARCHAR(20) NOT NULL,           -- standard / pro
  amount INTEGER NOT NULL,             -- 金额，单位：分
  status VARCHAR(20) DEFAULT 'pending', -- pending / paid / cancelled / refunded
  payment_channel VARCHAR(20),          -- wechat / alipay
  payment_trade_no VARCHAR(128),        -- 第三方支付流水号
  paid_at DATETIME,
  expires_at DATETIME,                  -- 本次订阅到期时间
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
```

需要在 `server/src/db/database.js` 的初始化逻辑中加入此建表语句（或追加到 schema.sql 后统一执行）。

### 新增路由文件 `server/src/routes/subscription.js`

```
GET  /api/v1/subscription/plans      — 套餐列表（无需登录）
GET  /api/v1/subscription/status     — 当前订阅状态（需登录）
POST /api/v1/subscription/create     — 创建订单（需登录）
POST /api/v1/subscription/callback   — 支付回调（Webhook，无需登录但需签名校验）
POST /api/v1/subscription/notify     — 备用：手动确认支付（开发期测试用）
```

### 套餐定义（新增 `server/src/services/plan.js`）

```javascript
const PLANS = {
  free: {
    name: '免费版',
    price: 0,          // 分
    period: null,
    dailyMessages: 30,
    features: ['基础对话', '猫咪皮肤', '7天记忆']
  },
  standard: {
    name: '标准版',
    price: 990,         // ¥9.90/月
    period: 'monthly',
    dailyMessages: 200,
    features: ['无限对话', '全部皮肤', '永久记忆', 'Agent 技能', '提醒系统']
  },
  pro: {
    name: '专业版',
    price: 2990,        // ¥29.90/月
    period: 'monthly',
    dailyMessages: -1,   // 无限
    features: ['标准版全部', '无限对话', '优先响应', '云端同步(未来)']
  }
};
```

### 各端点详细行为

#### GET /plans（公开）
```json
{
  "plans": [
    { "id": "free", "name": "免费版", "price": 0, "period": null, "dailyMessages": 30, "features": [...] },
    { "id": "standard", "name": "标准版", "price": 990, "period": "monthly", ... },
    { "id": "pro", "name": "专业版", "price": 2990, "period": "monthly", ... }
  ]
}
```

#### GET /status（需 JWT）
```json
{
  "currentPlan": "free",
  "expiresAt": null,
  "usage": {
    "today": { "messageCount": 12, "tokenCount": 4500 },
    "limit": { "dailyMessages": 30, "remaining": 18 }
  }
}
```

#### POST /create（需 JWT）
请求体：`{ "plan": "standard", "channel": "wechat" }`

行为：
1. 校验 plan 有效且不是 free
2. 生成唯一 order_no（格式：`PET-{timestamp}-{random}`）
3. 调用虎皮椒 API 创建支付订单，获取支付 URL / 二维码
4. 存入 orders 表（status=pending）
5. 返回：`{ "orderNo": "PET-...", "payUrl": "https://...", "qrCode": "https://..." }`

#### POST /callback（虎皮椒 Webhook）
行为：
1. 验证虎皮椒签名（HMAC-MD5）
2. 查找 order_no 对应的订单
3. 更新 orders.status = 'paid'，orders.paid_at = NOW
4. 计算 expires_at = NOW + 30 天
5. 更新 users.subscription_tier 和 users.subscription_expires_at
6. 返回 `"success"`（虎皮椒要求）

---

## B1-2：后端 — 支付集成 / 虎皮椒（Codex）

### 为什么选虎皮椒

| 方案 | 个人可接 | 费率 | 接入难度 |
|------|:--------:|:----:|:--------:|
| 虎皮椒 (xunhupay.com) | ✅ | ~1% | 低 |
| Payjs | ✅ | ~1.5% | 低 |
| 微信官方支付 | ❌ 需企业 | 0.6% | 高 |
| 支付宝当面付 | ⚠️ 需个体户 | 0.6% | 中 |

### 虎皮椒对接要点

**新建 `server/src/services/payment.js`**

```javascript
// 核心方法
async function createPayment({ orderNo, amount, title, channel, notifyUrl }) {
  // channel: 'wechat' | 'alipay'
  // 调用虎皮椒 API: https://api.xunhupay.com/payment/do.html
  // 参数：appid, trade_order_id, total_fee, title, notify_url, nonce_str, sign
  // 签名方式：MD5(params + appsecret)
  // 返回：{ url, url_qrcode, ... }
}

function verifyCallback(params, appsecret) {
  // 校验回调签名
  // params: trade_order_id, total_fee, transaction_id, open_order_id, order_title, status, hash
  // 签名校验：MD5(除 hash 外所有参数排序拼接 + appsecret)
  return computedHash === params.hash;
}
```

**新增环境变量（server/.env）：**
```env
# 虎皮椒支付
XUNHU_APPID=your_appid
XUNHU_APPSECRET=your_appsecret
XUNHU_NOTIFY_URL=http://your-server/api/v1/subscription/callback
```

**开发期备选：** 如果老板还没注册虎皮椒，可以先用 `POST /subscription/notify` 手动模拟支付成功（仅开发环境），让前端流程跑通。

```javascript
// 开发期手动确认接口（生产环境务必关闭）
router.post('/notify', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'not found' });
  }
  const { orderNo } = req.body;
  // 直接把订单标记为已支付，更新用户套餐
});
```

---

## B1-3：后端 — 订阅到期自动降级（Codex，P1）

**方案：定时检查 + 请求时惰性检查**

1. **惰性检查**（零成本，立刻实现）：
   在 `auth.js` 中间件解析用户后，追加一步检查：
   ```javascript
   if (user.subscriptionTier !== 'free' && user.subscriptionExpiresAt) {
     if (new Date(user.subscriptionExpiresAt) < new Date()) {
       // 已过期，降级为 free
       db.prepare('UPDATE users SET subscription_tier = ?, subscription_expires_at = NULL WHERE id = ?')
         .run('free', user.id);
       user.subscriptionTier = 'free';
       user.subscriptionExpiresAt = null;
     }
   }
   ```

2. **定时任务**（可选，后续加）：每天凌晨扫一次过期用户批量降级。

---

## B2-1：套餐选择窗口设计稿（Gemini）

### 设计要求

**窗口规格：**
- 尺寸：550×520px（比主窗口稍宽）
- 无边框、圆角 12px、可拖动标题栏
- 主题：lazyCat 暖色（深暖棕 `#1a1210`，主色琥珀橙 `#ffb347`，次色 `#ff6b35`）

**布局结构：**
```
┌─────────────────────────────────────┐
│  拖动标题栏          [X 关闭]       │
├─────────────────────────────────────┤
│  "选择你的套餐" 标题 + 副标题       │
│                                     │
│  ┌─────────┐ ┌─────────┐ ┌────────┐│
│  │ 免费版  │ │ 标准版  │ │ 专业版 ││
│  │         │ │ ⭐推荐  │ │        ││
│  │ ¥0      │ │ ¥9.9/月 │ │¥29.9/月││
│  │         │ │         │ │        ││
│  │ ·功能1  │ │ ·功能1  │ │ ·功能1 ││
│  │ ·功能2  │ │ ·功能2  │ │ ·功能2 ││
│  │ ·功能3  │ │ ·功能3  │ │ ·功能3 ││
│  │         │ │         │ │        ││
│  │[当前套餐]│ │[立即升级]│ │[升级]  ││
│  └─────────┘ └─────────┘ └────────┘│
│                                     │
│  "支付遇到问题？联系客服"           │
└─────────────────────────────────────┘
```

**设计规范：**
- 三栏卡片等宽排列，间距 12-16px
- 当前套餐卡片：边框高亮（琥珀橙），按钮灰色禁用态，文字「当前套餐」
- 标准版卡片：顶部「最受欢迎」标签（小横幅），视觉上最突出
- 按钮：渐变背景（`#ffb347` → `#ff6b35`），与 auth-window 登录按钮风格一致
- 功能列表：每项前加小圆点或✓图标
- 价格数字加粗放大

**支付弹层（点击"立即升级"后）：**
```
┌──────────────────────────┐
│  支付 ¥9.90              │
│                          │
│  [微信支付] [支付宝]      │  ← 两个 tab 切换
│                          │
│  ┌──────────────────┐    │
│  │                  │    │
│  │   二维码区域      │    │
│  │   200×200px      │    │
│  │                  │    │
│  └──────────────────┘    │
│                          │
│  扫码后自动检测支付结果   │
│  [取消支付]              │
└──────────────────────────┘
```

**参考现有风格：** `windows/auth-window.html` 的暖色调、圆角、发光按钮效果。

---

## B2-2：套餐选择窗口实现（Codex）

### 新建文件
- `windows/subscription-window.html` — 套餐选择 + 支付弹层
- `main.js` — 新增 `createSubscriptionWindow()` 方法 + IPC handlers

### 主进程改动（main.js）

```javascript
// 新增：创建套餐窗口
function createSubscriptionWindow() {
  // createChildWindow('subscription', 'subscription-window.html', 550, 520)
}

// 新增 IPC handlers
ipcMain.handle('subscription:get-plans', async () => {
  // 调用后端 GET /api/v1/subscription/plans
});

ipcMain.handle('subscription:get-status', async () => {
  // 调用后端 GET /api/v1/subscription/status（附带 JWT）
});

ipcMain.handle('subscription:create-order', async (event, { plan, channel }) => {
  // 调用后端 POST /api/v1/subscription/create（附带 JWT）
  // 返回 payUrl / qrCode
});

ipcMain.handle('subscription:check-order', async (event, orderNo) => {
  // 轮询后端检查订单状态
  // 也可以直接查 GET /api/v1/subscription/status 看 tier 是否变化
});
```

### 渲染进程改动（preload.js）

```javascript
PetSubscription: {
  getPlans: () => ipcRenderer.invoke('subscription:get-plans'),
  getStatus: () => ipcRenderer.invoke('subscription:get-status'),
  createOrder: (plan, channel) => ipcRenderer.invoke('subscription:create-order', { plan, channel }),
  checkOrder: (orderNo) => ipcRenderer.invoke('subscription:check-order', orderNo)
}
```

### subscription-window.html 核心交互流程

```
1. 窗口加载 → 请求 getPlans() + getStatus()
2. 渲染三栏卡片，当前套餐高亮
3. 用户点击"立即升级"→ 弹出支付弹层
4. 选择微信/支付宝 → 调用 createOrder(plan, channel)
5. 获取 qrCode URL → 生成二维码图片显示
6. 每 3 秒轮询 checkOrder(orderNo)
7. 支付成功 → 弹层显示"升级成功！" → 2 秒后关闭窗口
8. 广播 settings-change 事件通知主窗口刷新用户状态
```

**二维码生成：** 使用纯前端库 `qrcode`（CDN 加载或内联），将 payUrl 渲染为 canvas。

### 入口位置

套餐窗口的打开入口有两个：
1. **设置面板** → "我的账号"区域 → "升级套餐"按钮
2. **配额耗尽提示** → "升级套餐"链接（见 B2-3）

---

## B2-3：配额耗尽引导（Codex，P0）

### 当前问题
用户用完免费额度后，聊天窗口直接显示 `403` 错误 —— 体验极差。

### 改造方案

**改动文件：** `windows/chat-window.html`、`src/api.js`

#### (1) `src/api.js` — 识别 403 配额耗尽

```javascript
// 在 gatewayChat() 中
if (resp.status === 403) {
  const data = await resp.json().catch(() => ({}));
  if (data.error?.code === 'QUOTA_EXCEEDED') {
    throw new Error('quota_exceeded');
  }
}
```

#### (2) chat-window.html — 友好提示 UI

当捕获到 `quota_exceeded` 错误时，在聊天窗口中显示一条特殊消息：

```
┌────────────────────────────────────┐
│ 🐾 今天的对话次数已经用完啦～      │
│                                    │
│ 免费版每天可以聊 30 次             │
│ 升级标准版（¥9.9/月）每天聊 200 次  │
│                                    │
│ [查看套餐详情]     [明天再来]       │
└────────────────────────────────────┘
```

- **用宠物语气**，不是冷冰冰的系统错误
- "查看套餐详情"按钮 → 打开套餐窗口（`window.electron.openSubscription()`）
- "明天再来"按钮 → 关闭提示
- 输入框显示为禁用态 + placeholder "今日对话次数已用完～"

#### (3) 聊天气泡旁显示剩余额度（可选，P2）

在聊天窗口顶栏或底部状态栏显示：`今日剩余：18/30 次`

---

## B2-4：设置面板"我的账号"区域（Codex + Gemini，P1）

### 改动文件
- `windows/settings-window.html` — 新增"我的账号"卡片

### 设计（Gemini）

在设置面板现有内容的合适位置（建议在"AI 引擎"信息卡下方）新增一个卡片：

```
┌─ 我的账号 ─────────────────────────┐
│                                    │
│  手机号：138****1234               │
│  当前套餐：免费版                   │
│  今日用量：12 / 30 次              │
│  ████████░░░░  40%                 │
│                                    │
│  [升级套餐]          [退出登录]     │
└────────────────────────────────────┘
```

- 手机号脱敏显示（中间 4 位 ****）
- 付费用户额外显示：到期时间
- 进度条用琥珀橙色
- "升级套餐"→ 打开套餐窗口
- "退出登录"→ 清除 token + 弹出登录窗口

---

## 服务端限流错误码规范

确保 `rate-limit.js` 返回的错误格式统一，便于客户端识别：

```javascript
// 每分钟超频
res.status(429).json({
  error: {
    code: 'RATE_LIMITED',
    message: '请求太频繁，请稍后再试。',
    retryAfter: 60  // 秒
  }
});

// 每日配额用尽
res.status(403).json({
  error: {
    code: 'QUOTA_EXCEEDED',
    message: '今日对话次数已用完。',
    usage: { used: 30, limit: 30 },
    upgradeTip: '升级标准版可获得每天 200 次对话额度。'
  }
});
```

---

## 执行顺序（推荐）

```
第 1 天：
  Codex → B1-1（订单表 + 套餐 API）
  Gemini → B2-1（套餐窗口设计稿）

第 2-3 天：
  Codex → B2-3（配额耗尽引导 — 不依赖支付，可先做）
  Codex → B2-2（套餐窗口实现 — 等 Gemini 设计稿）

第 4-5 天：
  Codex → B1-2（支付集成 — 需要老板提供虎皮椒账号）
  Codex → B2-4（设置面板"我的账号"）

第 6-7 天：
  Codex → B1-3（订阅到期自动降级）
  全员 → 联调测试
```

---

## Sprint 2 验收标准

```
[ ] GET /subscription/plans 返回正确的三档套餐信息
[ ] GET /subscription/status 返回当前用户套餐 + 用量
[ ] POST /subscription/create 能创建订单并返回支付链接
[ ] 套餐选择窗口可正确渲染三栏卡片
[ ] 当前套餐高亮标记
[ ] 支付流程跑通（开发期可用手动确认模拟）
[ ] 支付成功后 subscription_tier 正确更新
[ ] 用量限制根据套餐动态调整（从 30 变为 200）
[ ] 配额耗尽时聊天窗口显示友好提示（宠物语气）
[ ] 配额耗尽提示中有"升级套餐"入口
[ ] 设置面板显示：当前套餐、今日用量、手机号
```

---

## 风险与应对

| 风险 | 概率 | 应对 |
|------|:----:|------|
| 虎皮椒注册/审核延迟 | 中 | 先用手动确认接口跑通流程，支付后接 |
| 二维码在 Electron 中显示异常 | 低 | 备选：直接打开系统浏览器跳支付页面 |
| 回调地址需公网 IP | 高 | 开发期用 ngrok 隧道 / 手动确认模拟 |
| 用户支付后回调延迟 | 中 | 客户端轮询 + 回调双保险 |

---

## 给老板的行动项

1. **注册虎皮椒账号** (xunhupay.com)，获取 `appid` + `appsecret`
2. 在虎皮椒后台配置回调 URL（后续部署时用正式域名）
3. 提供微信收款和支付宝收款的账号绑定
4. 如果暂时不注册虎皮椒，我们先用模拟支付把流程跑通
