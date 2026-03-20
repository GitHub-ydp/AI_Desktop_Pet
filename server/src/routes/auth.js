const express = require('express');
const jwt = require('jsonwebtoken');

const config = require('../config');
const { createUser, getUserByPhone, getUserById } = require('../services/user');

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || '').trim().replace(/\s+/g, '');
}

function isValidPhone(phone) {
  return /^\+?\d{6,20}$/.test(phone);
}

function verifyCode(code) {
  return String(code || '').trim() === config.verificationCode;
}

function createTokenPayload(user) {
  return {
    sub: String(user.id),
    phone: user.phone,
    tier: user.subscriptionTier,
  };
}

function issueTokens(user) {
  const payload = createTokenPayload(user);

  return {
    accessToken: jwt.sign({ ...payload, type: 'access' }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    }),
    refreshToken: jwt.sign({ ...payload, type: 'refresh' }, config.jwtRefreshSecret, {
      expiresIn: config.jwtRefreshExpiresIn,
    }),
  };
}

function validateAuthPayload(body, requireNickname = false) {
  const phone = normalizePhone(body?.phone);
  const code = String(body?.code || '').trim();
  const nickname = String(body?.nickname || '').trim();

  if (!isValidPhone(phone)) {
    return { error: '手机号格式不正确。' };
  }

  if (!code) {
    return { error: '验证码不能为空。' };
  }

  if (!verifyCode(code)) {
    return { error: '验证码错误。' };
  }

  if (requireNickname && nickname.length > 50) {
    return { error: '昵称长度不能超过 50 个字符。' };
  }

  return { phone, nickname };
}

router.post('/register', (req, res) => {
  const { phone, nickname, error } = validateAuthPayload(req.body, true);
  if (error) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: error,
      },
    });
  }

  const existingUser = getUserByPhone(phone);
  if (existingUser) {
    return res.status(409).json({
      error: {
        code: 'PHONE_EXISTS',
        message: '该手机号已注册。',
      },
    });
  }

  const user = createUser({ phone, nickname });
  const tokens = issueTokens(user);

  return res.status(201).json({
    user,
    ...tokens,
  });
});

router.post('/login', (req, res) => {
  const { phone, error } = validateAuthPayload(req.body);
  if (error) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: error,
      },
    });
  }

  const user = getUserByPhone(phone);
  if (!user) {
    return res.status(404).json({
      error: {
        code: 'USER_NOT_FOUND',
        message: '该手机号尚未注册。',
      },
    });
  }

  const tokens = issueTokens(user);
  return res.json({
    user,
    ...tokens,
  });
});

router.post('/refresh', (req, res) => {
  const refreshToken = String(req.body?.refreshToken || '').trim();
  if (!refreshToken) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'refreshToken 不能为空。',
      },
    });
  }

  try {
    const payload = jwt.verify(refreshToken, config.jwtRefreshSecret);
    if (payload.type !== 'refresh') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'refreshToken 类型无效。',
        },
      });
    }

    const user = getUserById(Number(payload.sub));
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: '用户不存在或 refreshToken 已失效。',
        },
      });
    }

    const tokens = issueTokens(user);
    return res.json({
      user,
      ...tokens,
    });
  } catch (error) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'refreshToken 校验失败。',
      },
    });
  }
});

module.exports = router;
