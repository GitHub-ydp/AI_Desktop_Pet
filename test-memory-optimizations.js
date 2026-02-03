// 记忆系统优化测试脚本
// 用于验证所有优化功能是否正常工作

const MemoryStorage = require('./main-process/database');
const EmbeddingService = require('./main-process/embeddings');
const MemorySearchEngine = require('./main-process/search');
const ContextBuilder = require('./main-process/context');

// 测试配置
const TEST_CONFIG = {
  apiKey: 'test-api-key', // 需要替换为真实的 API key
  databasePath: './test-memory.db'
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

async function runTests() {
  log('\n=== 记忆系统优化测试 ===\n', 'blue');

  let passCount = 0;
  let failCount = 0;

  // 1. 初始化测试
  info('测试 1: 数据库初始化和 Schema 验证');
  try {
    const storage = new MemoryStorage(TEST_CONFIG.databasePath);
    await storage.initialize();

    // 检查新字段是否存在
    const schema = storage.db.prepare("PRAGMA table_info(memory_chunks)").all();
    const hasLastAccessed = schema.some(col => col.name === 'last_accessed_at');
    const hasAccessCount = schema.some(col => col.name === 'access_count');
    const hasImportanceScore = schema.some(col => col.name === 'importance_score');

    if (hasLastAccessed && hasAccessCount && hasImportanceScore) {
      success('memory_chunks 表包含所有新字段');
      passCount++;
    } else {
      error('memory_chunks 表缺少新字段');
      failCount++;
    }

    // 检查 embedding_cache 表
    const cacheSchema = storage.db.prepare("PRAGMA table_info(embedding_cache)").all();
    const cacheHasLastAccessed = cacheSchema.some(col => col.name === 'last_accessed_at');
    const cacheHasAccessCount = cacheSchema.some(col => col.name === 'access_count');

    if (cacheHasLastAccessed && cacheHasAccessCount) {
      success('embedding_cache 表包含所有新字段');
      passCount++;
    } else {
      error('embedding_cache 表缺少新字段');
      failCount++;
    }

    // 检查索引
    const indexes = storage.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND name LIKE 'idx_%'
    `).all();
    const indexNames = indexes.map(i => i.name);

    const requiredIndexes = [
      'idx_memory_chunks_updated',
      'idx_memory_chunks_importance',
      'idx_memory_chunks_last_accessed',
      'idx_embedding_cache_lru'
    ];

    let allIndexesExist = true;
    requiredIndexes.forEach(idx => {
      if (!indexNames.includes(idx)) {
        error(`缺少索引: ${idx}`);
        allIndexesExist = false;
      }
    });

    if (allIndexesExist) {
      success('所有新索引已创建');
      passCount++;
    } else {
      failCount++;
    }

    storage.close();
  } catch (e) {
    error(`数据库初始化测试失败: ${e.message}`);
    failCount++;
  }

  // 2. LRU 缓存淘汰测试
  info('\n测试 2: LRU 缓存淘汰');
  try {
    const storage = new MemoryStorage(TEST_CONFIG.databasePath);
    await storage.initialize();

    // 清空现有缓存
    storage.db.exec('DELETE FROM embedding_cache');

    // 添加超过 maxSize 的缓存条目
    const { MEMORY_CONFIG } = require('./main-process/config');
    const maxSize = 100; // 测试用小值
    const evictionBatch = 10;

    info(`添加 ${maxSize + 50} 个缓存条目...`);

    for (let i = 0; i < maxSize + 50; i++) {
      storage.saveEmbeddingCache(`test-hash-${i}`, [1, 2, 3], 'test-model');
    }

    // 手动触发淘汰
    storage.evictLRUCache(maxSize, evictionBatch);

    // 检查缓存大小
    const count = storage.db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get();
    if (count.count <= maxSize) {
      success(`LRU 淘汰正常工作: ${count.count} 条 (max: ${maxSize})`);
      passCount++;
    } else {
      error(`LRU 淘汰失败: ${count.count} 条 > ${maxSize}`);
      failCount++;
    }

    storage.close();
  } catch (e) {
    error(`LRU 缓存测试失败: ${e.message}`);
    failCount++;
  }

  // 3. 时间衰减测试
  info('\n测试 3: 时间衰减函数');
  try {
    const searchEngine = new MemorySearchEngine();

    const now = Date.now();

    // 测试最近记忆
    const recentWeight = searchEngine.calculateTemporalWeight(now);
    if (recentWeight >= 0.9 && recentWeight <= 1.0) {
      success(`最近记忆权重正确: ${recentWeight.toFixed(2)} ≈ 1.0`);
      passCount++;
    } else {
      error(`最近记忆权重错误: ${recentWeight}`);
      failCount++;
    }

    // 测试一周前的记忆
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const weekWeight = searchEngine.calculateTemporalWeight(weekAgo);
    if (weekWeight >= 0.5 && weekWeight <= 0.7) {
      success(`一周前记忆权重正确: ${weekWeight.toFixed(2)} ≈ 0.6`);
      passCount++;
    } else {
      error(`一周前记忆权重错误: ${weekWeight}`);
      failCount++;
    }

    // 测试一个月前的记忆
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const monthWeight = searchEngine.calculateTemporalWeight(monthAgo);
    if (monthWeight >= 0.2 && monthWeight <= 0.4) {
      success(`一个月前记忆权重正确: ${monthWeight.toFixed(2)} ≈ 0.3`);
      passCount++;
    } else {
      error(`一个月前记忆权重错误: ${monthWeight}`);
      failCount++;
    }

    // 测试下限保护
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const yearWeight = searchEngine.calculateTemporalWeight(yearAgo);
    if (yearWeight >= 0.1) {
      success(`一年前记忆权重有下限保护: ${yearWeight.toFixed(2)} ≥ 0.1`);
      passCount++;
    } else {
      error(`一年前记忆权重违反下限: ${yearWeight} < 0.1`);
      failCount++;
    }
  } catch (e) {
    error(`时间衰减测试失败: ${e.message}`);
    failCount++;
  }

  // 4. 评分标准化测试
  info('\n测试 4: 评分标准化');
  try {
    const searchEngine = new MemorySearchEngine();

    // 测试 FTS rank 归一化
    const normalizedRank1 = searchEngine.normalizeFTSRank(0);
    const normalizedRank2 = searchEngine.normalizeFTSRank(10);
    const normalizedRank3 = searchEngine.normalizeFTSRank(20);

    if (normalizedRank1 >= -1 && normalizedRank1 <= 1 &&
        normalizedRank2 > normalizedRank1 &&
        normalizedRank3 > normalizedRank2) {
      success('FTS rank 归一化正确');
      passCount++;
    } else {
      error('FTS rank 归一化错误');
      failCount++;
    }

    // 测试向量分数归一化
    const vectorResults = [
      { id: '1', score: 0.8 },
      { id: '2', score: 0.6 },
      { id: '3', score: 1.0 }
    ];

    const normalized = searchEngine.normalizeVectorScores(vectorResults);
    const maxScore = Math.max(...normalized.map(r => r.score));

    if (Math.abs(maxScore - 1.0) < 0.01) {
      success(`向量分数归一化正确: max = ${maxScore.toFixed(2)}`);
      passCount++;
    } else {
      error(`向量分数归一化错误: max = ${maxScore}`);
      failCount++;
    }
  } catch (e) {
    error(`评分标准化测试失败: ${e.message}`);
    failCount++;
  }

  // 5. 重要性评分测试
  info('\n测试 5: 记忆重要性评分');
  try {
    const storage = new MemoryStorage(TEST_CONFIG.databasePath);
    await storage.initialize();

    // 测试高访问频率的记忆
    const frequentChunk = {
      text: '这是一段很长的测试文本内容，包含了足够多的字符来达到长内容奖励的阈值，这样可以验证长内容奖励机制是否正常工作',
      access_count: 15,
      last_accessed_at: Date.now()
    };

    const score1 = storage.calculateImportanceScore(frequentChunk);
    if (score1 > 1.0) {
      success(`高访问频率记忆重要性提升: ${score1.toFixed(2)} > 1.0`);
      passCount++;
    } else {
      error(`高访问频率记忆重要性未提升: ${score1.toFixed(2)}`);
      failCount++;
    }

    // 测试低访问频率的旧记忆
    const oldChunk = {
      text: '短文本',
      access_count: 2,
      last_accessed_at: Date.now() - 30 * 24 * 60 * 60 * 1000
    };

    const score2 = storage.calculateImportanceScore(oldChunk);
    if (score2 <= 1.0) {
      success(`低访问频率旧记忆重要性不提升: ${score2.toFixed(2)} ≤ 1.0`);
      passCount++;
    } else {
      error(`低访问频率旧记忆重要性异常提升: ${score2.toFixed(2)}`);
      failCount++;
    }

    storage.close();
  } catch (e) {
    error(`重要性评分测试失败: ${e.message}`);
    failCount++;
  }

  // 6. 情感权重测试
  info('\n测试 6: 情感权重系统');
  try {
    const searchEngine = new MemorySearchEngine();

    // 测试心情权重
    searchEngine.setEmotionalContext(80, 'healing');
    const moodWeight1 = searchEngine.calculateMoodWeight(85, 80); // 相似心情
    const moodWeight2 = searchEngine.calculateMoodWeight(30, 80); // 不同心情

    if (moodWeight1 > moodWeight2) {
      success(`相似心情权重更高: ${moodWeight1.toFixed(2)} > ${moodWeight2.toFixed(2)}`);
      passCount++;
    } else {
      error('心情权重计算错误');
      failCount++;
    }

    // 测试情感分析
    const sentiment1 = searchEngine.extractSentiment('我今天很开心，特别喜欢这个结果！');
    const sentiment2 = searchEngine.extractSentiment('我很难过，这个结果很糟糕');
    const sentiment3 = searchEngine.extractSentiment('这是一个普通的测试文本');

    if (sentiment1 === 'positive' && sentiment2 === 'negative' && sentiment3 === 'neutral') {
      success('情感分析正确');
      passCount++;
    } else {
      error(`情感分析错误: ${sentiment1}, ${sentiment2}, ${sentiment3}`);
      failCount++;
    }
  } catch (e) {
    error(`情感权重测试失败: ${e.message}`);
    failCount++;
  }

  // 7. 上下文构建测试
  info('\n测试 7: 情感上下文构建');
  try {
    const contextBuilder = new ContextBuilder();

    const searchResults = [
      {
        timestamp: Date.now(),
        role: 'user',
        content: '测试内容',
        mood: 85
      }
    ];

    const context = contextBuilder.build(searchResults, {
      query: '测试查询',
      currentMood: 80,
      currentPersonality: 'healing'
    });

    if (context.includes('心情') && context.includes('治愈型伙伴')) {
      success('情感上下文包含情感提示');
      passCount++;
    } else {
      error('情感上下文缺少情感提示');
      failCount++;
    }

    // 测试系统提示词
    const systemPrompt = contextBuilder.buildSystemPrompt(
      '基础提示词',
      context,
      'healing',
      85
    );

    if (systemPrompt.includes('记忆上下文') && systemPrompt.includes('对话风格')) {
      success('系统提示词格式正确');
      passCount++;
    } else {
      error('系统提示词格式错误');
      failCount++;
    }
  } catch (e) {
    error(`上下文构建测试失败: ${e.message}`);
    failCount++;
  }

  // 总结
  log('\n=== 测试结果 ===\n', 'blue');
  success(`通过: ${passCount} 项`);
  if (failCount > 0) {
    error(`失败: ${failCount} 项`);
  } else {
    success('所有测试通过！');
  }

  log(`\n总计: ${passCount + failCount} 项测试\n`, 'blue');

  return failCount === 0;
}

// 运行测试
if (require.main === module) {
  runTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      error(`测试运行失败: ${error.message}`);
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runTests };
