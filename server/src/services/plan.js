const PLANS = {
  free: {
    name: '免费版',
    price: 0,
    period: null,
    dailyMessages: 30,
    features: ['基础对话', '基础宠物皮肤', '7 天记忆'],
  },
  standard: {
    name: '标准版',
    price: 990,
    period: 'monthly',
    dailyMessages: 200,
    features: ['更多对话额度', '全部宠物皮肤', '长期记忆', 'Agent 技能', '提醒系统'],
  },
  pro: {
    name: '专业版',
    price: 2990,
    period: 'monthly',
    dailyMessages: -1,
    features: ['包含标准版全部功能', '不限量对话', '优先响应', '云端同步（待上线）'],
  },
};

function getPlan(planId) {
  if (!planId || !PLANS[planId]) {
    return null;
  }

  return {
    id: planId,
    ...PLANS[planId],
  };
}

function listPlans() {
  return Object.keys(PLANS).map((planId) => getPlan(planId));
}

function isPaidPlan(planId) {
  return planId === 'standard' || planId === 'pro';
}

module.exports = {
  PLANS,
  getPlan,
  listPlans,
  isPaidPlan,
};
