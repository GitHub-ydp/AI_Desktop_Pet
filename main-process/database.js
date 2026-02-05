// 记忆存储管理器
// 负责数据库初始化和 CRUD 操作
// CommonJS 版本 - 用于主进程

const Database = require('better-sqlite3');
const { readFileSync, mkdirSync, existsSync } = require('fs');
const { join, dirname } = require('path');
const { homedir } = require('os');

const SCHEMA_PATH = join(__dirname, 'schema.sql');

// 获取用户数据目录（兼容测试环境）
function getUserDataPath() {
  try {
    // 在 Electron 环境中使用 app.getPath
    const electron = require('electron');
    if (electron && electron.app) {
      return electron.app.getPath('userData');
    }
  } catch (e) {
    // 测试环境或其他环境
  }
  // 回退到用户主目录
  return join(homedir(), '.ai-desktop-pet');
}

class MemoryStorage {
  constructor(dbPath = null) {
    this.db = null;
    this.dbPath = dbPath || this.getDefaultDbPath();
  }

  // 获取默认数据库路径
  getDefaultDbPath() {
    const userDataPath = getUserDataPath();
    return join(userDataPath, 'pet-memory.db');
  }

  // 初始化数据库
  async initialize() {
    try {
      // 确保目录存在
      const dbDir = dirname(this.dbPath);
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
        console.log('Created database directory:', dbDir);
      }

      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000');
      this.db.pragma('temp_store = memory');

      // 读取并执行 schema
      const schema = readFileSync(SCHEMA_PATH, 'utf-8');
      this.db.exec(schema);

      console.log('Memory database initialized at:', this.dbPath);
      return true;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  // 关闭数据库连接
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ==================== 对话操作 ====================

  // 保存对话
  saveConversation(role, content, metadata = {}) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const id = this.generateId();
    const timestamp = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, timestamp, role, content, personality, mood, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const info = stmt.run(
        id,
        timestamp,
        role,
        content,
        metadata.personality || null,
        metadata.mood || 80,
        metadata.extra ? JSON.stringify(metadata.extra) : null
      );
      return { id, timestamp, ...metadata };
    } catch (error) {
      console.error('Failed to save conversation:', error);
      throw error;
    }
  }

  // 获取对话
  getConversation(id) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = stmt.get(id);

    if (!row) return null;

    return this.parseConversation(row);
  }

  // 获取所有对话（分页）
  getConversations(options = {}) {
    const {
      limit = 100,
      offset = 0,
      role = null,
      startDate = null,
      endDate = null
    } = options;

    let query = 'SELECT * FROM conversations WHERE 1=1';
    const params = [];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map(row => this.parseConversation(row));
  }

  // ==================== 记忆块操作 ====================

  // 保存记忆块
  saveMemoryChunk(chunk) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const now = Date.now();
    const id = chunk.id || this.generateId();

    const stmt = this.db.prepare(`
      INSERT INTO memory_chunks (id, conversation_id, chunk_index, text, embedding, start_pos, end_pos, updated_at, last_accessed_at, access_count, importance_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob = chunk.embedding
      ? this.floatArrayToBlob(chunk.embedding)
      : null;

    // 计算初始重要性分数
    const initialChunk = {
      text: chunk.text,
      access_count: 1,
      last_accessed_at: now
    };
    const importanceScore = this.calculateImportanceScore(initialChunk);

    try {
      stmt.run(
        id,
        chunk.conversationId,
        chunk.chunkIndex,
        chunk.text,
        embeddingBlob,
        chunk.startPos || null,
        chunk.endPos || null,
        now,
        now,  // last_accessed_at
        1,    // access_count
        importanceScore
      );
    } catch (error) {
      console.error('Failed to save memory chunk:', error);
      throw error;
    }
  }

  // 批量保存记忆块
  batchSaveMemoryChunks(chunks) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const insertMany = this.db.transaction((chunkList) => {
      const stmt = this.db.prepare(`
        INSERT INTO memory_chunks (id, conversation_id, chunk_index, text, embedding, start_pos, end_pos, updated_at, last_accessed_at, access_count, importance_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();

      for (const chunk of chunkList) {
        const embeddingBlob = chunk.embedding
          ? this.floatArrayToBlob(chunk.embedding)
          : null;

        // 计算初始重要性分数
        const initialChunk = {
          text: chunk.text,
          access_count: 1,
          last_accessed_at: now
        };
        const importanceScore = this.calculateImportanceScore(initialChunk);

        stmt.run(
          chunk.id || this.generateId(),
          chunk.conversationId,
          chunk.chunkIndex,
          chunk.text,
          embeddingBlob,
          chunk.startPos || null,
          chunk.endPos || null,
          now,
          now,  // last_accessed_at
          1,    // access_count
          importanceScore
        );
      }
    });

    try {
      insertMany(chunks);
    } catch (error) {
      console.error('Failed to batch save memory chunks:', error);
      throw error;
    }
  }

  // 获取记忆块
  getMemoryChunks(conversationId) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
      SELECT * FROM memory_chunks
      WHERE conversation_id = ?
      ORDER BY chunk_index ASC
    `);

    const rows = stmt.all(conversationId);
    return rows.map(row => ({
      ...row,
      embedding: row.embedding ? this.blobToFloatArray(row.embedding) : null
    }));
  }

  // 更新记忆访问记录
  updateMemoryAccess(chunkId) {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE memory_chunks
        SET last_accessed_at = ?,
            access_count = access_count + 1
        WHERE id = ?
      `);

      stmt.run(Date.now(), chunkId);
    } catch (error) {
      console.error('Failed to update memory access:', error);
    }
  }

  // 批量更新记忆访问记录
  batchUpdateMemoryAccess(chunkIds) {
    if (!this.db || !chunkIds || chunkIds.length === 0) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE memory_chunks
        SET last_accessed_at = ?,
            access_count = access_count + 1
        WHERE id = ?
      `);

      const updateMany = this.db.transaction((ids) => {
        const now = Date.now();
        for (const id of ids) {
          stmt.run(now, id);
        }
      });

      updateMany(chunkIds);
    } catch (error) {
      console.error('Failed to batch update memory access:', error);
    }
  }

  // ==================== 关键事实操作 ====================

  // 保存事实
  saveFact(fact) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
      INSERT INTO memory_facts (id, fact_type, subject, predicate, object, confidence, source_conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    try {
      stmt.run(
        fact.id || this.generateId(),
        fact.factType,
        fact.subject || null,
        fact.predicate,
        fact.object || null,
        fact.confidence || 1.0,
        fact.sourceConversationId || null,
        now,
        now
      );
    } catch (error) {
      console.error('Failed to save fact:', error);
      throw error;
    }
  }

  // 批量保存事实
  batchSaveFacts(facts) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const insertMany = this.db.transaction((factList) => {
      const stmt = this.db.prepare(`
        INSERT INTO memory_facts (id, fact_type, subject, predicate, object, confidence, source_conversation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      for (const fact of factList) {
        stmt.run(
          fact.id || this.generateId(),
          fact.factType,
          fact.subject || null,
          fact.predicate,
          fact.object || null,
          fact.confidence || 1.0,
          fact.sourceConversationId || null,
          now,
          now
        );
      }
    });

    try {
      insertMany(facts);
    } catch (error) {
      console.error('Failed to batch save facts:', error);
      throw error;
    }
  }

  // 获取所有事实
  getFacts(options = {}) {
    const {
      factType = null,
      subject = null,
      minConfidence = 0
    } = options;

    let query = 'SELECT * FROM memory_facts WHERE confidence >= ?';
    const params = [minConfidence];

    if (factType) {
      query += ' AND fact_type = ?';
      params.push(factType);
    }

    if (subject) {
      query += ' AND subject = ?';
      params.push(subject);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  // ==================== 嵌入缓存操作 ====================

  // 获取缓存的嵌入（带访问跟踪）
  getCachedEmbedding(hash) {
    if (!this.db) return null;

    const stmt = this.db.prepare('SELECT embedding FROM embedding_cache WHERE hash = ?');
    const row = stmt.get(hash);

    if (!row) return null;

    // 更新访问记录
    this.updateEmbeddingCacheAccess(hash);

    return this.blobToFloatArray(row.embedding);
  }

  // 保存嵌入缓存（带 LRU 管理）
  saveEmbeddingCache(hash, embedding, model) {
    if (!this.db) return;

    const now = Date.now();

    try {
      // 检查是否已存在
      const checkStmt = this.db.prepare('SELECT hash FROM embedding_cache WHERE hash = ?');
      const exists = checkStmt.get(hash);

      if (exists) {
        // 更新访问记录而不是插入新记录
        this.updateEmbeddingCacheAccess(hash);
        return;
      }

      // 插入新缓存
      const stmt = this.db.prepare(`
        INSERT INTO embedding_cache (hash, embedding, model, created_at, last_accessed_at, access_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        hash,
        this.floatArrayToBlob(embedding),
        model,
        now,
        now,
        1
      );

      // 检查缓存大小并在必要时淘汰
      const { MEMORY_CONFIG } = require('./config');
      if (MEMORY_CONFIG.cache.autoEvict) {
        this.evictLRUCache(MEMORY_CONFIG.cache.maxSize, MEMORY_CONFIG.cache.evictionBatch);
      }

    } catch (error) {
      console.error('Failed to save embedding cache:', error);
    }
  }

  // 更新嵌入缓存访问记录
  updateEmbeddingCacheAccess(hash) {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE embedding_cache
        SET last_accessed_at = ?,
            access_count = access_count + 1
        WHERE hash = ?
      `);

      stmt.run(Date.now(), hash);
    } catch (error) {
      console.error('Failed to update embedding cache access:', error);
    }
  }

  // LRU 缓存淘汰
  evictLRUCache(maxSize, evictionBatch) {
    if (!this.db) return;

    try {
      // 获取当前缓存大小
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache');
      const { count } = countStmt.get();

      if (count <= maxSize) {
        return; // 未达到上限，无需淘汰
      }

      // 删除最久未使用的条目
      const deleteStmt = this.db.prepare(`
        DELETE FROM embedding_cache
        WHERE hash IN (
          SELECT hash FROM embedding_cache
          ORDER BY last_accessed_at ASC
          LIMIT ?
        )
      `);

      const info = deleteStmt.run(evictionBatch);
      console.log(`Evicted ${info.changes} LRU cache entries (${count} -> ${count - info.changes})`);

    } catch (error) {
      console.error('Failed to evict LRU cache:', error);
    }
  }

  // ==================== 统计操作 ====================

  // 获取数据库统计信息
  getStats() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const convCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM memory_chunks').get();
    const factCount = this.db.prepare('SELECT COUNT(*) as count FROM memory_facts').get();
    const oldest = this.db.prepare('SELECT MIN(timestamp) as ts FROM conversations').get();
    const newest = this.db.prepare('SELECT MAX(timestamp) as ts FROM conversations').get();

    return {
      totalConversations: convCount.count,
      totalChunks: chunkCount.count,
      totalFacts: factCount.count,
      oldestMemory: oldest.ts ? new Date(oldest.ts) : null,
      newestMemory: newest.ts ? new Date(newest.ts) : null
    };
  }

  // ==================== 工具方法 ====================

  // Float32Array 转 BLOB
  floatArrayToBlob(arr) {
    const buffer = new Float32Array(arr).buffer;
    return Buffer.from(buffer);
  }

  // BLOB 转 Float32Array
  blobToFloatArray(blob) {
    const buffer = new Uint8Array(blob);
    return Array.from(new Float32Array(buffer.buffer));
  }

  // 生成唯一 ID
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 解析对话记录
  parseConversation(row) {
    return {
      id: row.id,
      timestamp: row.timestamp,
      date: new Date(row.timestamp),
      role: row.role,
      content: row.content,
      personality: row.personality,
      mood: row.mood,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
  }

  // 清理旧数据
  clearOldMemories(beforeDate) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare('DELETE FROM conversations WHERE timestamp < ?');
    const info = stmt.run(beforeDate);
    return info.changes;
  }

  // 清空所有数据
  clearAll() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.exec('DELETE FROM conversations');
    this.db.exec('DELETE FROM memory_chunks');
    this.db.exec('DELETE FROM memory_facts');
    this.db.exec('DELETE FROM embedding_cache');
  }

  // ==================== 提醒操作 ====================

  // 创建提醒
  createReminder(reminder) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
      INSERT INTO reminders (id, content, remind_at, created_at, status, source_conversation_id, repeat_pattern, repeat_end_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const id = reminder.id || this.generateId();

    try {
      stmt.run(
        id,
        reminder.content,
        reminder.remindAt,
        now,
        reminder.status || 'pending',
        reminder.sourceConversationId || null,
        reminder.repeatPattern || null,
        reminder.repeatEndAt || null,
        reminder.metadata ? JSON.stringify(reminder.metadata) : null
      );
      return id;
    } catch (error) {
      console.error('Failed to create reminder:', error);
      throw error;
    }
  }

  // 获取提醒列表
  getReminders(options = {}) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const {
      status = null,
      limit = 100,
      offset = 0,
      from = null,
      to = null
    } = options;

    let query = 'SELECT * FROM reminders WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (from) {
      query += ' AND remind_at >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND remind_at <= ?';
      params.push(to);
    }

    query += ' ORDER BY remind_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  // 获取单个提醒
  getReminder(id) {
    if (!this.db) return null;

    const stmt = this.db.prepare('SELECT * FROM reminders WHERE id = ?');
    return stmt.get(id);
  }

  // 更新提醒状态
  updateReminderStatus(id, status) {
    if (!this.db) return false;

    const stmt = this.db.prepare('UPDATE reminders SET status = ? WHERE id = ?');
    const result = stmt.run(status, id);
    return result.changes > 0;
  }

  // 删除提醒
  deleteReminder(id) {
    if (!this.db) return false;

    const stmt = this.db.prepare('DELETE FROM reminders WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // 获取到期的提醒
  getDueReminders(beforeTime) {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM reminders 
      WHERE status = 'pending' 
      AND remind_at <= ?
      ORDER BY remind_at ASC
    `);
    
    return stmt.all(beforeTime);
  }

  // ==================== 记忆重要性评分 ====================

  // 计算记忆重要性分数
  calculateImportanceScore(chunk) {
    const { MEMORY_CONFIG } = require('./config');
    const factors = MEMORY_CONFIG.emotional.importanceFactors;

    let score = 1.0;

    // 访问频率奖励
    if (chunk.access_count >= factors.accessFrequencyThreshold) {
      score *= factors.accessFrequencyBonus;
    }

    // 最近活跃奖励（7天内）
    const daysSinceAccess = chunk.last_accessed_at
      ? (Date.now() - chunk.last_accessed_at) / (24 * 60 * 60 * 1000)
      : 999;
    if (daysSinceAccess <= factors.recentActiveDays) {
      score *= factors.recentActiveBonus;
    }

    // 长内容奖励
    if (chunk.text && chunk.text.length >= factors.longContentThreshold) {
      score *= factors.longContentBonus;
    }

    return score;
  }

  // 更新记忆重要性分数
  updateImportanceScore(chunkId) {
    if (!this.db) return;

    try {
      // 获取记忆块数据
      const stmt = this.db.prepare('SELECT * FROM memory_chunks WHERE id = ?');
      const chunk = stmt.get(chunkId);

      if (!chunk) return;

      // 计算新的重要性分数
      const score = this.calculateImportanceScore(chunk);

      // 更新数据库
      const updateStmt = this.db.prepare(`
        UPDATE memory_chunks
        SET importance_score = ?
        WHERE id = ?
      `);

      updateStmt.run(score, chunkId);

    } catch (error) {
      console.error('Failed to update importance score:', error);
    }
  }

  // 获取缓存统计（包含 LRU 信息）
  getCacheStats() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache');
    const { count: total } = totalStmt.get();

    const oldestStmt = this.db.prepare('SELECT MIN(last_accessed_at) as ts FROM embedding_cache');
    const { ts: oldestAccess } = oldestStmt.get();

    return {
      total,
      oldestAccess: oldestAccess ? new Date(oldestAccess) : null
    };
  }

  // ==================== 显示器画像 ====================

  saveDisplayProfiles(profiles, activeDisplayId = null) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return;
    }

    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO display_profiles (
        display_id, label, is_primary, is_active, bounds_json, work_area_json,
        size_json, scale_factor, rotation, internal, touch_support, monochrome,
        dpi, size_mm_json, updated_at, last_used_at
      ) VALUES (
        @display_id, @label, @is_primary, @is_active, @bounds_json, @work_area_json,
        @size_json, @scale_factor, @rotation, @internal, @touch_support, @monochrome,
        @dpi, @size_mm_json, @updated_at, @last_used_at
      )
      ON CONFLICT(display_id) DO UPDATE SET
        label = excluded.label,
        is_primary = excluded.is_primary,
        is_active = excluded.is_active,
        bounds_json = excluded.bounds_json,
        work_area_json = excluded.work_area_json,
        size_json = excluded.size_json,
        scale_factor = excluded.scale_factor,
        rotation = excluded.rotation,
        internal = excluded.internal,
        touch_support = excluded.touch_support,
        monochrome = excluded.monochrome,
        dpi = excluded.dpi,
        size_mm_json = excluded.size_mm_json,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at
    `);

    const upsertMany = this.db.transaction((items) => {
      for (const item of items) {
        const isActive = activeDisplayId && String(item.displayId) === String(activeDisplayId);
        stmt.run({
          display_id: String(item.displayId),
          label: item.label || null,
          is_primary: item.isPrimary ? 1 : 0,
          is_active: isActive ? 1 : 0,
          bounds_json: item.bounds ? JSON.stringify(item.bounds) : null,
          work_area_json: item.workArea ? JSON.stringify(item.workArea) : null,
          size_json: item.size ? JSON.stringify(item.size) : null,
          scale_factor: Number.isFinite(item.scaleFactor) ? item.scaleFactor : null,
          rotation: Number.isFinite(item.rotation) ? item.rotation : 0,
          internal: item.internal ? 1 : 0,
          touch_support: item.touchSupport || 'unknown',
          monochrome: item.monochrome ? 1 : 0,
          dpi: Number.isFinite(item.dpi) ? item.dpi : null,
          size_mm_json: item.sizeMm ? JSON.stringify(item.sizeMm) : null,
          updated_at: now,
          last_used_at: isActive ? now : null
        });
      }
    });

    upsertMany(profiles);
  }

  getDisplayProfiles() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const stmt = this.db.prepare('SELECT * FROM display_profiles ORDER BY updated_at DESC');
    return stmt.all();
  }
}

module.exports = MemoryStorage;
