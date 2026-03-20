const jwt = require('jsonwebtoken');

const config = require('../config');
const { getUserById, updateUserSubscription } = require('../services/user');

function extractBearerToken(authorizationHeader = '') {
  const [scheme, token] = String(authorizationHeader || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
}

function buildUnauthorizedResponse(message) {
  return {
    error: {
      code: 'UNAUTHORIZED',
      message,
    },
  };
}

function shouldDowngradeUser(user) {
  if (!user || user.subscriptionTier === 'free' || !user.subscriptionExpiresAt) {
    return false;
  }

  const expiresAt = new Date(user.subscriptionExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function authMiddleware(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json(buildUnauthorizedResponse('缺少有效的 JWT token。'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.type !== 'access') {
      return res.status(401).json(buildUnauthorizedResponse('Token 类型无效。'));
    }

    let user = getUserById(Number(payload.sub));
    if (!user) {
      return res.status(401).json(buildUnauthorizedResponse('用户不存在或 token 已失效。'));
    }

    if (shouldDowngradeUser(user)) {
      user = updateUserSubscription(user.id, 'free', null) || {
        ...user,
        subscriptionTier: 'free',
        subscriptionExpiresAt: null,
      };
    }

    req.auth = payload;
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json(buildUnauthorizedResponse('JWT 校验失败。'));
  }
}

module.exports = {
  authMiddleware,
  extractBearerToken,
};
