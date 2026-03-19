const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  getDailyUsage,
  getRemainingDailyMessages,
  getTierLimits,
  getTodayDateString,
} = require('../services/usage');

const router = express.Router();

router.get('/usage', authMiddleware, (req, res) => {
  const usage = getDailyUsage(req.user.id);
  const limits = getTierLimits(req.user.subscriptionTier);

  return res.json({
    date: getTodayDateString(),
    subscriptionTier: req.user.subscriptionTier,
    usage,
    limits,
    remainingDailyMessages: getRemainingDailyMessages(
      req.user.subscriptionTier,
      usage.messageCount,
    ),
  });
});

router.get('/profile', authMiddleware, (req, res) => {
  const usage = getDailyUsage(req.user.id);
  const limits = getTierLimits(req.user.subscriptionTier);

  return res.json({
    user: req.user,
    usage,
    limits,
    remainingDailyMessages: getRemainingDailyMessages(
      req.user.subscriptionTier,
      usage.messageCount,
    ),
  });
});

module.exports = router;
