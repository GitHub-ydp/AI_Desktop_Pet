const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const defaultDbPath = path.resolve(__dirname, '../data/app.db');

const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH
    ? path.resolve(__dirname, '..', process.env.DB_PATH)
    : defaultDbPath,
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  dashscopeBaseUrl:
    process.env.DASHSCOPE_BASE_URL ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  jwtSecret: process.env.JWT_SECRET || 'development-only-jwt-secret',
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'development-only-refresh-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  verificationCode: process.env.VERIFICATION_CODE || '1234',
};

module.exports = config;
