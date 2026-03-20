const {
  getDailyUsage,
  getRemainingDailyMessages,
  getTierLimits,
} = require('../services/usage');

const minuteBuckets = new Map();
const WINDOW_MS = 60 * 1000;

function rateLimitMiddleware(req, res, next) {
  const user = req.user;
  const limits = getTierLimits(user.subscriptionTier);
  const key = `${user.id}:chat`;
  const now = Date.now();
  const recent = (minuteBuckets.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);

  if (limits.perMinute !== -1 && recent.length >= limits.perMinute) {
    minuteBuckets.set(key, recent);
    return res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请稍后再试。',
        retryAfter: 60,
      },
    });
  }

  recent.push(now);
  minuteBuckets.set(key, recent);

  const usage = getDailyUsage(user.id);
  const remainingDailyMessages = getRemainingDailyMessages(
    user.subscriptionTier,
    usage.messageCount,
  );

  req.rateLimit = {
    limits,
    usage,
    remainingDailyMessages,
  };

  if (limits.dailyMessages !== -1 && usage.messageCount >= limits.dailyMessages) {
    return res.status(403).json({
      error: {
        code: 'QUOTA_EXCEEDED',
        message: '今天的对话次数已经用完啦，请明天再来或升级套餐。',
        usage: {
          used: usage.messageCount,
          limit: limits.dailyMessages,
          remaining: remainingDailyMessages,
        },
        upgradeTip: '升级标准版后，每天可用 200 次对话额度。',
      },
    });
  }

  return next();
}

module.exports = {
  rateLimitMiddleware,
};
