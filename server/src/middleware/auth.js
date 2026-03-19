const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserById } = require('../services/user');

function extractBearerToken(authorizationHeader = '') {
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
}

function authMiddleware(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: '缺少有效的 JWT token。',
      },
    });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.type !== 'access') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token 类型无效。',
        },
      });
    }

    const user = getUserById(Number(payload.sub));
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: '用户不存在或 token 已失效。',
        },
      });
    }

    req.auth = payload;
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'JWT 校验失败。',
      },
    });
  }
}

module.exports = {
  authMiddleware,
  extractBearerToken,
};
