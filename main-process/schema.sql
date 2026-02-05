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
  last_accessed_at INTEGER,
  access_count INTEGER DEFAULT 1,
  importance_score REAL DEFAULT 1.0,
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
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER,
  access_count INTEGER DEFAULT 1
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

-- 时间和重要性索引
CREATE INDEX IF NOT EXISTS idx_memory_chunks_updated ON memory_chunks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_importance ON memory_chunks(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_last_accessed ON memory_chunks(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_lru ON embedding_cache(last_accessed_at ASC);

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

-- 6. 提醒任务表：存储定时提醒和任务
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  remind_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled', 'missed')),
  source_conversation_id TEXT,
  repeat_pattern TEXT, -- 重复模式：daily, weekly, monthly, yearly, 或数字毫秒间隔
  repeat_end_at INTEGER, -- 重复结束时间
  completed_at INTEGER, -- 实际完成时间
  metadata TEXT, -- JSON 格式存储额外信息
  FOREIGN KEY (source_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

-- 提醒表索引
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_created_at ON reminders(created_at);

-- 7. 提醒历史表：记录已完成的提醒，用于学习用户习惯
CREATE TABLE IF NOT EXISTS reminder_history (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL, -- 关联的提醒 ID
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL, -- 原提醒创建时间
  remind_at INTEGER NOT NULL, -- 计划提醒时间
  completed_at INTEGER NOT NULL, -- 实际完成/触发时间
  delay_minutes INTEGER, -- 延迟分钟数（正数=晚完成，负数=提前完成）
  vague_keyword TEXT, -- 如果使用了模糊时间词，记录下来
  personality TEXT, -- 创建时的宠物性格
  mood INTEGER, -- 创建时的心情
  FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
);

-- 提醒历史索引
CREATE INDEX IF NOT EXISTS idx_reminder_history_keyword ON reminder_history(vague_keyword);
CREATE INDEX IF NOT EXISTS idx_reminder_history_completed_at ON reminder_history(completed_at);
CREATE INDEX IF NOT EXISTS idx_reminder_history_reminder_id ON reminder_history(reminder_id);

-- ==================== 数据迁移 ====================
-- 为现有数据库添加新字段（如果不存在）

-- 检查并添加 memory_chunks 新字段
-- SQLite 不支持 IF NOT EXISTS for ALTER TABLE，需要使用异常处理
-- 这里提供手动迁移 SQL，应用层应捕获 "duplicate column name" 错误

-- ALTER TABLE memory_chunks ADD COLUMN last_accessed_at INTEGER;
-- ALTER TABLE memory_chunks ADD COLUMN access_count INTEGER DEFAULT 1;
-- ALTER TABLE memory_chunks ADD COLUMN importance_score REAL DEFAULT 1.0;

-- ALTER TABLE embedding_cache ADD COLUMN last_accessed_at INTEGER;
-- ALTER TABLE embedding_cache ADD COLUMN access_count INTEGER DEFAULT 1;

-- 回填数据
-- UPDATE memory_chunks SET last_accessed_at = updated_at WHERE last_accessed_at IS NULL;
-- UPDATE memory_chunks SET access_count = 1 WHERE access_count IS NULL;
-- UPDATE memory_chunks SET importance_score = 1.0 WHERE importance_score IS NULL;
-- UPDATE embedding_cache SET last_accessed_at = created_at WHERE last_accessed_at IS NULL;
-- UPDATE embedding_cache SET access_count = 1 WHERE access_count IS NULL;

-- ==================== 工具调用系统 ====================
-- Tool Execution System

-- 8. 工具执行日志表：记录所有工具调用
CREATE TABLE IF NOT EXISTS tool_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  tool_params TEXT,
  session_id TEXT,
  personality TEXT,
  approved BOOLEAN DEFAULT 0,
  success BOOLEAN,
  result TEXT,
  error_message TEXT,
  executed_at INTEGER,
  duration_ms INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 工具执行日志索引
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_name ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session_id ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_executed_at ON tool_executions(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_success ON tool_executions(success);

-- 9. 工具白名单表：存储允许自动执行的工具模式
CREATE TABLE IF NOT EXISTS tool_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 工具白名单索引
CREATE INDEX IF NOT EXISTS idx_tool_allowlist_tool_name ON tool_allowlist(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_allowlist_enabled ON tool_allowlist(enabled);

-- 10. 工具批准记录表：学习用户批准偏好
CREATE TABLE IF NOT EXISTS tool_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  params_json TEXT,
  decision TEXT NOT NULL CHECK(decision IN ('approve', 'deny')),
  auto_approve_threshold INTEGER DEFAULT 3,
  approval_count INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 工具批准记录索引
CREATE INDEX IF NOT EXISTS idx_tool_approvals_tool_name ON tool_approvals(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_params_hash ON tool_approvals(params_hash);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_decision ON tool_approvals(decision);

-- 11. 显示器画像表：记录显示器与缩放信息
CREATE TABLE IF NOT EXISTS display_profiles (
  display_id TEXT PRIMARY KEY,
  label TEXT,
  is_primary INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  bounds_json TEXT,
  work_area_json TEXT,
  size_json TEXT,
  scale_factor REAL,
  rotation INTEGER,
  internal INTEGER,
  touch_support TEXT,
  monochrome INTEGER,
  dpi REAL,
  size_mm_json TEXT,
  updated_at INTEGER,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_display_profiles_updated_at ON display_profiles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_display_profiles_active ON display_profiles(is_active);
