const express = require('express');

const config = require('./config');
const { initializeDatabase, closeDatabase } = require('./db/database');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const subscriptionRoutes = require('./routes/subscription');
const userRoutes = require('./routes/user');

initializeDatabase();

const app = express();

app.use((req, res, next) => {
  // 仅允许 Electron 本地连接，生产环境需配置实际域名
  const allowedOrigins = ['http://localhost', 'http://127.0.0.1', 'file://'];
  const origin = req.headers.origin || '';
  if (origin && allowedOrigins.some(o => origin.startsWith(o))) {
    // 白名单 Origin：设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin && req.path === '/health') {
    // 无 Origin 仅放行 /health（运维探活）
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  // 其他情况（无 Origin 或 Origin 不在白名单）不设置 CORS 头，浏览器会拒绝跨域请求
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

// 简单 rate limiting（内存 Map，IP 维度）
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟窗口
const RATE_LIMIT_MAX = 60;              // 每分钟最多 60 次请求
// 每 5 分钟清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap) {
    if (now - data.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

app.use((req, res, next) => {
  // health check 不限流
  if (req.path === '/health') return next();

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }

  entry.count += 1;

  // 设置标准 rate limit 响应头
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - entry.count));

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试。' }
    });
  }

  return next();
});

app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ai-desktop-pet-server',
    dashscopeConfigured: Boolean(config.dashscopeApiKey),
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/subscription', subscriptionRoutes);
app.use('/api/v1/user', userRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: '请求的接口不存在。',
    },
  });
});

app.use((error, req, res, next) => {
  console.error('[server] Unhandled error:', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误。',
    },
  });
});

const server = app.listen(config.port, () => {
  console.log(`AI Desktop Pet server listening on http://localhost:${config.port}`);
  if (!config.dashscopeApiKey) {
    console.warn('DASHSCOPE_API_KEY is not configured yet. Chat proxy will return 500.');
  }
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
