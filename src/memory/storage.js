// 记忆存储管理器
// 负责数据库初始化和 CRUD 操作

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'database', 'schema.sql');

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

    const stmt = this.db.prepare(`
      INSERT INTO memory_chunks (id, conversation_id, chunk_index, text, embedding, start_pos, end_pos, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob = chunk.embedding
      ? this.floatArrayToBlob(chunk.embedding)
      : null;

    try {
      stmt.run(
        chunk.id || this.generateId(),
        chunk.conversationId,
        chunk.chunkIndex,
        chunk.text,
        embeddingBlob,
        chunk.startPos || null,
        chunk.endPos || null,
        Date.now()
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
        INSERT INTO memory_chunks (id, conversation_id, chunk_index, text, embedding, start_pos, end_pos, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const chunk of chunkList) {
        const embeddingBlob = chunk.embedding
          ? this.floatArrayToBlob(chunk.embedding)
          : null;

        stmt.run(
          chunk.id || this.generateId(),
          chunk.conversationId,
          chunk.chunkIndex,
          chunk.text,
          embeddingBlob,
          chunk.startPos || null,
          chunk.endPos || null,
          Date.now()
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

  // 获取缓存的嵌入
  getCachedEmbedding(hash) {
    if (!this.db) return null;

    const stmt = this.db.prepare('SELECT embedding FROM embedding_cache WHERE hash = ?');
    const row = stmt.get(hash);

    if (!row) return null;

    return this.blobToFloatArray(row.embedding);
  }

  // 保存嵌入缓存
  saveEmbeddingCache(hash, embedding, model) {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT INTO embedding_cache (hash, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      stmt.run(
        hash,
        this.floatArrayToBlob(embedding),
        model,
        Date.now()
      );
    } catch (error) {
      console.error('Failed to save embedding cache:', error);
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
}

export default MemoryStorage;
