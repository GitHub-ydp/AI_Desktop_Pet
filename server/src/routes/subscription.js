const crypto = require('crypto');
const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { getDatabase } = require('../db/database');
const { getPlan, isPaidPlan, listPlans } = require('../services/plan');
const { getDailyUsage, getRemainingDailyMessages, getTierLimits } = require('../services/usage');
const { getUserById, updateUserSubscription } = require('../services/user');

const router = express.Router();

const VALID_CHANNELS = new Set(['wechat', 'alipay']);
const SUBSCRIPTION_DAYS = 30;

function normalizeChannel(channel) {
  return String(channel || '').trim().toLowerCase();
}

function generateOrderNo() {
  return `PET-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function mapOrder(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    orderNo: row.order_no,
    plan: row.plan,
    amount: row.amount,
    status: row.status,
    paymentChannel: row.payment_channel,
    paymentTradeNo: row.payment_trade_no,
    paidAt: row.paid_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function getOrderByNo(orderNo) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  return mapOrder(row);
}

function buildStatusPayload(user) {
  const usage = getDailyUsage(user.id);
  const limits = getTierLimits(user.subscriptionTier);
  const remaining = getRemainingDailyMessages(user.subscriptionTier, usage.messageCount);

  return {
    currentPlan: user.subscriptionTier,
    expiresAt: user.subscriptionExpiresAt || null,
    usage: {
      today: {
        messageCount: usage.messageCount,
        tokenCount: usage.tokenCount,
      },
      limit: {
        dailyMessages: limits.dailyMessages,
        remaining,
      },
    },
  };
}

router.get('/plans', (req, res) => {
  return res.json({
    plans: listPlans(),
  });
});

router.get('/status', authMiddleware, (req, res) => {
  return res.json(buildStatusPayload(req.user));
});

router.post('/create', authMiddleware, (req, res) => {
  const planId = String(req.body?.plan || '').trim().toLowerCase();
  const channel = normalizeChannel(req.body?.channel);
  const plan = getPlan(planId);

  if (!plan || !isPaidPlan(planId)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_PLAN',
        message: '请选择有效的付费套餐。',
      },
    });
  }

  if (!VALID_CHANNELS.has(channel)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_CHANNEL',
        message: '支付渠道仅支持 wechat 或 alipay。',
      },
    });
  }

  const db = getDatabase();

  // 幂等检查：60秒内同一用户同一套餐只允许一个 pending 订单
  const recentPending = db.prepare(
    `SELECT order_no FROM orders
     WHERE user_id = ? AND plan = ? AND status = 'pending'
       AND created_at > datetime('now', '-60 seconds')`
  ).get(req.user.id, planId);

  if (recentPending) {
    return res.status(409).json({
      error: {
        code: 'ORDER_EXISTS',
        message: '您有一个正在处理的订单，请稍后再试。',
      },
      orderNo: recentPending.order_no,
    });
  }

  const orderNo = generateOrderNo();

  db.prepare(
    `
      INSERT INTO orders (
        user_id,
        order_no,
        plan,
        amount,
        status,
        payment_channel
      ) VALUES (?, ?, ?, ?, 'pending', ?)
    `,
  ).run(req.user.id, orderNo, plan.id, plan.price, channel);

  return res.status(201).json({
    orderNo,
    status: 'pending',
  });
});

router.post('/notify', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '接口不存在。',
      },
    });
  }

  const orderNo = String(req.body?.orderNo || '').trim();
  if (!orderNo) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'orderNo 不能为空。',
      },
    });
  }

  const existingOrder = getOrderByNo(orderNo);
  if (!existingOrder) {
    return res.status(404).json({
      error: {
        code: 'ORDER_NOT_FOUND',
        message: '订单不存在。',
      },
    });
  }

  if (existingOrder.status === 'paid') {
    return res.status(409).json({
      error: {
        code: 'ORDER_ALREADY_PAID',
        message: '订单已支付，无需重复确认。',
      },
    });
  }

  const plan = getPlan(existingOrder.plan);
  if (!plan || !isPaidPlan(plan.id)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_PLAN',
        message: '订单套餐无效。',
      },
    });
  }

  const user = getUserById(existingOrder.userId);
  if (!user) {
    return res.status(404).json({
      error: {
        code: 'USER_NOT_FOUND',
        message: '订单对应用户不存在。',
      },
    });
  }

  const db = getDatabase();
  const paidAt = new Date();
  const expiresAt = addDays(paidAt, SUBSCRIPTION_DAYS).toISOString();
  const paymentTradeNo =
    String(req.body?.paymentTradeNo || '').trim() || `MANUAL-${Date.now()}`;

  const commitPayment = db.transaction(() => {
    db.prepare(
      `
        UPDATE orders
        SET
          status = 'paid',
          payment_trade_no = ?,
          paid_at = ?,
          expires_at = ?
        WHERE order_no = ?
      `,
    ).run(paymentTradeNo, paidAt.toISOString(), expiresAt, orderNo);

    return updateUserSubscription(existingOrder.userId, plan.id, expiresAt);
  });

  const updatedUser = commitPayment();

  return res.json({
    success: true,
    order: getOrderByNo(orderNo),
    user: updatedUser || getUserById(existingOrder.userId),
    status: buildStatusPayload(updatedUser || getUserById(existingOrder.userId)),
  });
});

module.exports = router;
