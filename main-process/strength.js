// FSRS 动态记忆强化核心计算
// Free Spaced Repetition Scheduler（自由间隔重复计划）
// 基于人脑遗忘曲线的幂函数衰减模型

const { MEMORY_CONFIG } = require('./config');

/**
 * 计算记忆的当前可提取性 R（Retrievability）
 * FSRS 核心衰减公式：R(t) = (1 + F × t / S) ^ C
 *
 * @param {number} stability - 稳定性 S（小时），即半衰期
 * @param {number} lastTriggeredAt - 上次强化时间戳（毫秒），可为 null
 * @param {number} now - 当前时间戳（毫秒），默认 Date.now()
 * @returns {number} R 值（0-1），即当前被回忆的概率
 */
function calcRetrievability(stability, lastTriggeredAt, now = Date.now()) {
  if (!lastTriggeredAt) {
    // 从未被强化过，认为是新记忆，满强度
    return 1.0;
  }

  const elapsedHours = (now - lastTriggeredAt) / (1000 * 60 * 60);
  if (elapsedHours <= 0) return 1.0;

  const config = MEMORY_CONFIG.memoryStrength.fsrs;
  const F = config.F;      // 19/81 ≈ 0.2346
  const C = config.C;      // -0.5
  const S = stability || config.initialStability;

  // FSRS 幂函数
  const R = Math.pow(1 + F * elapsedHours / S, C);

  // 下限保护：防止完全消失
  return Math.max(0.01, Math.min(1.0, R));
}

/**
 * 计算情感权重
 * 偏离中性心情（mood=50）越远，情感权重越高
 *
 * @param {number} mood - 心情值（0-100），50 为中性
 * @returns {number} 情感权重（1.0-1.5）
 */
function calcEmotionalWeight(mood) {
  if (mood === undefined || mood === null) return 1.0;

  const config = MEMORY_CONFIG.memoryStrength.emotional;
  const deviation = Math.abs(mood - config.neutralMood) / config.neutralMood;
  const weight = 1.0 + config.deviationScale * deviation;

  return Math.min(weight, config.maxWeight);
}

/**
 * 计算强化后的新稳定性 S（Stability）
 * 设计原则：
 *   - 每次强化后 S 增长约 2-2.5 倍
 *   - 有饱和效应：S 越大，增长越慢
 *   - 困难奖励：R 低时强化（快要遗忘时）效果更好
 *
 * @param {number} oldS - 当前稳定性（小时）
 * @param {number} R - 强化前的可提取性（0-1）
 * @param {number} triggerCount - 已强化次数
 * @returns {number} 新的稳定性（小时）
 */
function calcNewStability(oldS, R, triggerCount = 0) {
  const config = MEMORY_CONFIG.memoryStrength.fsrs;
  const baseGrowth = config.baseGrowth;  // 2.2
  const initialStability = config.initialStability;  // 24（1天）

  // 下限保护：stability=0 时视为新记忆，从 initialStability 开始恢复
  // 不加此保护时，0 * growthFactor = 0，stability 永远无法恢复
  const effectiveOldS = Math.max(oldS || 0, initialStability);

  // 饱和衰减：S 越大，增长因子越低
  // 当 S = initialStability 时 saturation ≈ 1.0
  // 当 S = initialStability × 180 时 saturation ≈ 0.5
  // 当 S = initialStability × 365 时 saturation ≈ 0.35
  const saturation = 1 / (1 + Math.log(1 + effectiveOldS / initialStability));

  // 困难奖励：R 越低（快要遗忘时被回忆起来），增长越多
  // R=1.0 时 difficultyBonus=1.0，R=0.3 时 difficultyBonus≈1.35
  const difficultyBonus = 1 + 0.5 * (1 - R);

  // 计算增长因子
  const growthFactor = 1 + (baseGrowth - 1) * saturation * difficultyBonus;

  // 计算新 S
  let newS = effectiveOldS * growthFactor;

  // 上限：1年 = 8760 小时
  newS = Math.min(newS, config.maxStability);

  // 下限：不低于有效旧值（强化只能增强，不能削弱）
  newS = Math.max(newS, effectiveOldS);

  return newS;
}

/**
 * 强化一条记忆
 * 调用时机：
 *   - 搜索命中（被检索到）
 *   - 构建上下文（AI 使用了该记忆）
 *   - 用户主动提及（新消息与旧记忆高度相关）
 *
 * @param {object} db - better-sqlite3 数据库实例
 * @param {string} chunkId - memory_chunks 的 id
 * @param {number} currentMood - 当前心情（0-100），默认 80
 * @returns {object} 更新后的 chunk 信息
 */
function reinforceMemory(db, chunkId, currentMood = 80) {
  if (!db) {
    console.error('[Strength] Database instance required');
    return null;
  }

  const now = Date.now();

  try {
    // 1. 读取当前状态
    const chunk = db.prepare(`
      SELECT id, trigger_count, last_triggered_at, stability, emotional_weight
      FROM memory_chunks WHERE id = ?
    `).get(chunkId);

    if (!chunk) {
      console.warn('[Strength] Chunk not found:', chunkId);
      return null;
    }

    // 2. 计算当前 R（强化前的可提取性）
    const currentR = calcRetrievability(
      chunk.stability || 24,
      chunk.last_triggered_at,
      now
    );

    // 3. 计算新的稳定性 S
    const oldS = chunk.stability || 24;
    const newS = calcNewStability(oldS, currentR, chunk.trigger_count || 0);

    // 4. 更新情感权重（取历史最大值）
    const newEmotionalWeight = Math.max(
      chunk.emotional_weight || 1.0,
      calcEmotionalWeight(currentMood)
    );

    // 5. 写入数据库
    db.prepare(`
      UPDATE memory_chunks SET
        trigger_count = trigger_count + 1,
        last_triggered_at = ?,
        stability = ?,
        strength = 1.0,
        emotional_weight = ?,
        last_accessed_at = ?,
        access_count = access_count + 1
      WHERE id = ?
    `).run(now, newS, newEmotionalWeight, now, chunkId);

    return {
      id: chunkId,
      triggerCount: (chunk.trigger_count || 0) + 1,
      lastTriggeredAt: now,
      stability: newS,
      strength: 1.0,
      emotionalWeight: newEmotionalWeight
    };

  } catch (error) {
    console.error('[Strength] reinforce Memory failed:', error.message);
    return null;
  }
}

/**
 * 批量强化被检索命中的记忆
 * 在 getContext() 中调用，作为强化的统一入口
 *
 * @param {object} db - better-sqlite3 数据库实例
 * @param {array} searchResults - 搜索结果数组
 * @param {object} options - 选项
 *   - currentMood: 当前心情值（默认 80）
 *   - preventDuplicates: 是否启用防重复触发（默认 true）
 */
function reinforceHitMemories(db, searchResults, options = {}) {
  if (!db || !searchResults || searchResults.length === 0) return;

  const { currentMood = 80, preventDuplicates = true } = options;
  const config = MEMORY_CONFIG.memoryStrength.reinforcement;
  const now = Date.now();
  const cooldownMs = config.cooldownMs;

  // 防重复：记录本次强化的 ID，避免多条结果中同一条 chunk 被重复强化
  const reinforcedIds = new Set();

  for (const result of searchResults) {
    if (!result.conversationId) continue;

    // 获取该对话的 memory_chunk
    const chunk = db.prepare(`
      SELECT id, trigger_count, last_triggered_at, stability, emotional_weight
      FROM memory_chunks
      WHERE conversation_id = ? LIMIT 1
    `).get(result.conversationId);

    if (!chunk) continue;

    // 防重复触发：同一条记忆本次不强化第二次
    if (preventDuplicates && reinforcedIds.has(chunk.id)) {
      continue;
    }

    // 防重复触发：同一条记忆冷却期内不强化
    if (preventDuplicates && chunk.last_triggered_at) {
      const timeSinceLastTrigger = now - chunk.last_triggered_at;
      if (timeSinceLastTrigger < cooldownMs) {
        // 冷却期内，跳过
        continue;
      }
    }

    // 执行强化
    const result_reinforced = reinforceMemory(db, chunk.id, currentMood);
    if (result_reinforced) {
      reinforcedIds.add(chunk.id);
    }
  }
}

module.exports = {
  calcRetrievability,
  calcEmotionalWeight,
  calcNewStability,
  reinforceMemory,
  reinforceHitMemories
};
