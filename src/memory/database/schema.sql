-- AI Desktop Pet Memory System Database Schema
-- 记忆系统数据库架构

-- 1. 对话表：存储完整对话
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  personality TEXT,
  mood INTEGER DEFAULT 80 CHECK(mood >= 0 AND mood <= 100),
  metadata TEXT
);

-- 2. 记忆块表：分块后的文本及向量
CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  start_pos INTEGER,
  end_pos INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- 3. 关键事实表：提取的结构化信息
CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  fact_type TEXT NOT NULL CHECK(fact_type IN ('preference', 'event', 'relationship', 'routine')),
  subject TEXT,
  predicate TEXT NOT NULL,
  object TEXT,
  confidence REAL DEFAULT 1.0 CHECK(confidence >= 0 AND confidence <= 1),
  source_conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

-- 4. 嵌入缓存表：避免重复计算
CREATE TABLE IF NOT EXISTS embedding_cache (
  hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 5. 全文搜索虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  text,
  content=memory_chunks,
  content_rowid=rowid
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_conversation ON memory_chunks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_facts_type ON memory_facts(fact_type);
CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject);
CREATE INDEX IF NOT EXISTS idx_memory_facts_confidence ON memory_facts(confidence);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_created ON embedding_cache(created_at);

-- 触发器：自动同步 FTS 索引
CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_insert AFTER INSERT ON memory_chunks BEGIN
  INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_delete AFTER DELETE ON memory_chunks BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_update AFTER UPDATE ON memory_chunks BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
END;
