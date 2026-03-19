const { getDatabase } = require('../db/database');

const RATE_LIMITS = {
  free: { dailyMessages: 30, perMinute: 5 },
  standard: { dailyMessages: 200, perMinute: 15 },
  pro: { dailyMessages: -1, perMinute: 30 },
};

function getTodayDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTierLimits(subscriptionTier = 'free') {
  return RATE_LIMITS[subscriptionTier] || RATE_LIMITS.free;
}

function getDailyUsage(userId, date = getTodayDateString()) {
  const db = getDatabase();
  const row = db
    .prepare(
      `
        SELECT user_id, date, message_count, token_count
        FROM daily_usage
        WHERE user_id = ? AND date = ?
      `,
    )
    .get(userId, date);

  return {
    userId,
    date,
    messageCount: row?.message_count || 0,
    tokenCount: row?.token_count || 0,
  };
}

function getRemainingDailyMessages(subscriptionTier, messageCount) {
  const limits = getTierLimits(subscriptionTier);
  if (limits.dailyMessages === -1) {
    return -1;
  }

  return Math.max(0, limits.dailyMessages - messageCount);
}

function normalizeUsageMetrics(usage = {}) {
  const source = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = Number(
    source.inputTokens ?? source.input_tokens ?? source.promptTokens ?? source.prompt_tokens ?? 0,
  );
  const outputTokens = Number(
    source.outputTokens ??
      source.output_tokens ??
      source.completionTokens ??
      source.completion_tokens ??
      0,
  );
  const totalTokens = Number(
    source.totalTokens ?? source.total_tokens ?? inputTokens + outputTokens,
  );

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : inputTokens + outputTokens,
  };
}

function recordChatUsageAsync({
  userId,
  model,
  endpoint = '/api/v1/chat/completions',
  usage,
  statusCode = 200,
  latencyMs = 0,
}) {
  setImmediate(() => {
    try {
      const db = getDatabase();
      const date = getTodayDateString();
      const normalized = normalizeUsageMetrics(usage);

      db.prepare(
        `
          INSERT INTO daily_usage (user_id, date, message_count, token_count)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(user_id, date) DO UPDATE SET
            message_count = daily_usage.message_count + 1,
            token_count = daily_usage.token_count + excluded.token_count
        `,
      ).run(userId, date, normalized.totalTokens);

      db.prepare(
        `
          INSERT INTO api_logs (
            user_id,
            endpoint,
            model,
            input_tokens,
            output_tokens,
            latency_ms,
            status_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        userId,
        endpoint,
        model || '',
        normalized.inputTokens,
        normalized.outputTokens,
        Math.max(0, Math.round(latencyMs)),
        statusCode,
      );
    } catch (error) {
      console.error('[usage] Failed to record usage:', error);
    }
  });
}

module.exports = {
  RATE_LIMITS,
  getDailyUsage,
  getRemainingDailyMessages,
  getTierLimits,
  getTodayDateString,
  normalizeUsageMetrics,
  recordChatUsageAsync,
};
