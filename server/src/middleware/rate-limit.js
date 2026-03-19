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
        message: '今日对话额度已用完，请明天再试或升级套餐。',
      },
    });
  }

  return next();
}

module.exports = {
  rateLimitMiddleware,
};
