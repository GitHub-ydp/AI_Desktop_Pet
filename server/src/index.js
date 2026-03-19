const express = require('express');
const config = require('./config');
const { initializeDatabase, closeDatabase } = require('./db/database');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/user');

initializeDatabase();

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
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
