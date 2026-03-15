// 数据库迁移工具
// 用于在应用启动时自动检查并执行数据库升级
// CommonJS 版本

class DatabaseMigrator {
  constructor(storage) {
    this.storage = storage;
  }

  // 执行所有待执行的迁移
  async migrate() {
    if (!this.storage || !this.storage.db) {
      console.log('[Migrate] Storage not available');
      return;
    }

    console.log('[Migrate] Checking database migrations...');

    try {
      // 获取当前版本
      const currentVersion = this.getCurrentVersion();
      console.log(`[Migrate] Current version: ${currentVersion}`);

      // 执行迁移
      await this.runMigrations(currentVersion);

      // 更新版本号
      this.setVersion(LATEST_VERSION);
      console.log(`[Migrate] Migrated to version: ${LATEST_VERSION}`);

    } catch (error) {
      console.error('[Migrate] Migration failed:', error);
    }
  }

  // 获取当前数据库版本
  getCurrentVersion() {
    try {
      const row = this.storage.db.prepare('PRAGMA user_version').get();
      return row.user_version || 0;
    } catch (error) {
      return 0;
    }
  }

  // 设置数据库版本
  setVersion(version) {
    this.storage.db.prepare(`PRAGMA user_version = ${version}`).run();
  }

  // 迁移到版本1：修复 reminders 表约束
  async migrateToV1() {
    console.log('[Migrate] Migrating to v1: Fix reminders table constraints...');

    try {
      // 检查表是否存在
      const tableInfo = this.storage.db.pragma('table_info(reminders)');
      if (tableInfo.length === 0) {
        console.log('[Migrate] reminders table does not exist, skipping migration');
        return;
      }

      // 检查是否需要迁移（查看是否有 missed 状态的记录）
      const hasMissedStatus = this.storage.db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type='table' AND name='reminders'
        AND sql LIKE '%missed%'
      `).get();

      if (hasMissedStatus) {
        console.log('[Migrate] reminders table already supports missed status');
        return;
      }

      // 备份数据
      const existingData = this.storage.db.prepare('SELECT * FROM reminders').all();
      console.log(`[Migrate] Backed up ${existingData.length} reminder records`);

      // 用事务包裹 DROP → 重建 → 恢复，确保原子性
      // 若中途失败则整体回滚，不会出现数据丢失的中间状态
      const rebuildReminders = this.storage.db.transaction(() => {
        // 删除旧表
        this.storage.db.exec('DROP TABLE IF EXISTS reminders');

        // 创建新表
        this.storage.db.exec(`
          CREATE TABLE reminders (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            remind_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled', 'missed')),
            source_conversation_id TEXT,
            repeat_pattern TEXT,
            repeat_end_at INTEGER,
            completed_at INTEGER,
            metadata TEXT
          )
        `);

        // 重建索引
        this.storage.db.exec(`
          CREATE INDEX idx_reminders_remind_at ON reminders(remind_at);
          CREATE INDEX idx_reminders_status ON reminders(status);
          CREATE INDEX idx_reminders_pending ON reminders(status, remind_at);
          CREATE INDEX idx_reminders_created_at ON reminders(created_at);
        `);

        // 恢复数据
        const stmt = this.storage.db.prepare(`
          INSERT INTO reminders (id, content, remind_at, created_at, status,
            source_conversation_id, repeat_pattern, repeat_end_at, completed_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let restored = 0;
        for (const row of existingData) {
          stmt.run(
            row.id,
            row.content,
            row.remind_at,
            row.created_at,
            row.status || 'pending',
            row.source_conversation_id,
            row.repeat_pattern,
            row.repeat_end_at,
            row.completed_at,
            row.metadata
          );
          restored++;
        }
        return restored;
      });

      const restored = rebuildReminders();
      console.log(`[Migrate] Restored ${restored} reminder records`);
      console.log('[Migrate] ✓ Migration to v1 complete');

    } catch (error) {
      console.error('[Migrate] ✗ Migration to v1 failed:', error);
      throw error;
    }
  }

  // 迁移到版本2：新增显示器画像表
  async migrateToV2() {
    console.log('[Migrate] Migrating to v2: Add display_profiles table...');
    try {
      this.storage.db.exec(`
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
      `);
      console.log('[Migrate] ✓ Migration to v2 complete');
    } catch (error) {
      console.error('[Migrate] ✗ Migration to v2 failed:', error);
      throw error;
    }
  }

  // 迁移到版本3：新增截图系统表
  async migrateToV3() {
    console.log('[Migrate] Migrating to v3: Add screenshot tables...');
    try {
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS screenshots (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          file_size INTEGER,
          width INTEGER,
          height INTEGER,
          format TEXT DEFAULT 'png',
          capture_method TEXT DEFAULT 'region',
          metadata TEXT,
          tags TEXT,
          ocr_text TEXT,
          is_deleted INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_screenshots_created_at ON screenshots(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_screenshots_is_deleted ON screenshots(is_deleted);
        CREATE INDEX IF NOT EXISTS idx_screenshots_tags ON screenshots(tags);

        CREATE TABLE IF NOT EXISTS screenshot_analyses (
          id TEXT PRIMARY KEY,
          screenshot_id TEXT NOT NULL,
          analysis_type TEXT NOT NULL,
          model TEXT,
          prompt TEXT,
          result TEXT,
          confidence REAL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (screenshot_id) REFERENCES screenshots(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_screenshot_analyses_screenshot_id ON screenshot_analyses(screenshot_id);
        CREATE INDEX IF NOT EXISTS idx_screenshot_analyses_type ON screenshot_analyses(analysis_type);
        CREATE INDEX IF NOT EXISTS idx_screenshot_analyses_created_at ON screenshot_analyses(created_at DESC);
      `);
      console.log('[Migrate] ✓ Migration to v3 complete');
    } catch (error) {
      console.error('[Migrate] ✗ Migration to v3 failed:', error);
      throw error;
    }
  }

  // 迁移到版本4：记忆系统升级（向量嵌入 + 事实提取 + 用户画像）
  async migrateToV4() {
    console.log('[Migrate] Migrating to v4: Memory system upgrade...');
    try {
      // 1. memory_facts 表添加新字段
      const factsColumns = this.storage.db.pragma('table_info(memory_facts)');
      const factsColumnNames = factsColumns.map(c => c.name);

      if (!factsColumnNames.includes('last_confirmed_at')) {
        this.storage.db.exec('ALTER TABLE memory_facts ADD COLUMN last_confirmed_at INTEGER');
      }
      if (!factsColumnNames.includes('source_text')) {
        this.storage.db.exec('ALTER TABLE memory_facts ADD COLUMN source_text TEXT');
      }

      // 2. 新增 user_profile 汇总表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS user_profile (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          updated_at INTEGER NOT NULL,
          source_fact_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_user_profile_updated_at ON user_profile(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_user_profile_confidence ON user_profile(confidence DESC);
      `);

      // 3. 回填 memory_facts 新字段
      this.storage.db.exec(`
        UPDATE memory_facts SET last_confirmed_at = updated_at WHERE last_confirmed_at IS NULL
      `);

      console.log('[Migrate] ✓ Migration to v4 complete');
    } catch (error) {
      console.error('[Migrate] ✗ Migration to v4 failed:', error);
      throw error;
    }
  }

  // 迁移到版本5：健康提醒系统
  async migrateToV5() {
    console.log('[Migrate] Migrating to v5: Health reminder system...');
    try {
      // 1. 健康提醒配置表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS health_reminders (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('sedentary', 'water', 'eyecare', 'custom')),
          enabled INTEGER DEFAULT 1,
          interval_minutes INTEGER NOT NULL DEFAULT 45,
          start_time TEXT DEFAULT '09:00',
          end_time TEXT DEFAULT '22:00',
          workdays_only INTEGER DEFAULT 0,
          custom_message TEXT,
          last_triggered_at INTEGER,
          next_trigger_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_health_reminders_type ON health_reminders(type);
        CREATE INDEX IF NOT EXISTS idx_health_reminders_enabled ON health_reminders(enabled);
        CREATE INDEX IF NOT EXISTS idx_health_reminders_next_trigger ON health_reminders(next_trigger_at);
      `);

      // 2. 健康提醒触发历史表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS health_reminder_history (
          id TEXT PRIMARY KEY,
          reminder_id TEXT NOT NULL,
          reminder_type TEXT NOT NULL,
          triggered_at INTEGER NOT NULL,
          responded_at INTEGER,
          response_action TEXT,
          snoozed_until INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (reminder_id) REFERENCES health_reminders(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_health_history_reminder_id ON health_reminder_history(reminder_id);
        CREATE INDEX IF NOT EXISTS idx_health_history_triggered_at ON health_reminder_history(triggered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_health_history_type ON health_reminder_history(reminder_type);
      `);

      // 3. 每日健康统计表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS health_stats (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL UNIQUE,
          sedentary_count INTEGER DEFAULT 0,
          water_count INTEGER DEFAULT 0,
          eyecare_count INTEGER DEFAULT 0,
          custom_count INTEGER DEFAULT 0,
          total_reminders INTEGER DEFAULT 0,
          responded_count INTEGER DEFAULT 0,
          snoozed_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_health_stats_date ON health_stats(date);
      `);

      // 4. 插入默认配置
      const now = Date.now();
      const defaults = [
        { id: 'health-sedentary', type: 'sedentary', interval: 45, message: '该起来活动一下啦~' },
        { id: 'health-water', type: 'water', interval: 30, message: '记得喝水哦~' },
        { id: 'health-eyecare', type: 'eyecare', interval: 20, message: '看看远处，让眼睛休息一下~' }
      ];

      const stmt = this.storage.db.prepare(`
        INSERT OR IGNORE INTO health_reminders (id, type, enabled, interval_minutes, custom_message, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?)
      `);

      for (const item of defaults) {
        stmt.run(item.id, item.type, item.interval, item.message, now, now);
      }

      console.log('[Migrate] ✓ Migration to v5 complete');
    } catch (error) {
      console.error('[Migrate] ✗ Migration to v5 failed:', error);
      throw error;
    }
  }

  // 迁移到版本6：任务管理系统
  async migrateToV6() {
    console.log('[Migrate] Migrating to v6: Task management system...');
    try {
      // 1. 任务主表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
          priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
          category TEXT DEFAULT 'general',
          tags TEXT,
          due_date INTEGER,
          reminder_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          source_conversation_id TEXT,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
      `);

      // 2. 任务状态变更历史表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS task_history (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          old_status TEXT,
          new_status TEXT NOT NULL,
          changed_at INTEGER NOT NULL,
          note TEXT,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_history_changed_at ON task_history(changed_at DESC);
      `);

      // 3. 每日任务统计表
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS task_stats (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL UNIQUE,
          created_count INTEGER DEFAULT 0,
          completed_count INTEGER DEFAULT 0,
          overdue_count INTEGER DEFAULT 0,
          total_pending INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_task_stats_date ON task_stats(date);
      `);

      console.log('[Migrate] ✓ Migration to v6 complete');
    } catch (error) {
      console.error('[Migrate] ✗ Migration to v6 failed:', error);
      throw error;
    }
  }

  // 执行迁移
  async runMigrations(currentVersion) {
    if (currentVersion < 1) {
      await this.migrateToV1();
    }
    if (currentVersion < 2) {
      await this.migrateToV2();
    }
    if (currentVersion < 3) {
      await this.migrateToV3();
    }
    if (currentVersion < 4) {
      await this.migrateToV4();
    }
    if (currentVersion < 5) {
      await this.migrateToV5();
    }
    if (currentVersion < 6) {
      await this.migrateToV6();
    }
    if (currentVersion < 7) {
      await this.migrateToV7();
    }
    if (currentVersion < 8) {
      await this.migrateToV8();
    }
    if (currentVersion < 9) {
      await this.migrateToV9();
    }
    if (currentVersion < 10) {
      await this.migrateToV10();
    }
  }

  // 迁移到 v7：FSRS 动态记忆强化系统
  async migrateToV7() {
    console.log('[Migrate] Migrating to v7: FSRS memory strength system...');

    try {
      // 1. memory_chunks 新增字段（通过 database.js 的 runMigrations 已做，这里再做一次安全网）
      const chunksCols = this.storage.db.pragma('table_info(memory_chunks)');
      const colNames = chunksCols.map(c => c.name);

      if (!colNames.includes('trigger_count')) {
        this.storage.db.exec('ALTER TABLE memory_chunks ADD COLUMN trigger_count INTEGER DEFAULT 0');
        console.log('[Migrate] Added column: memory_chunks.trigger_count');
      }
      if (!colNames.includes('last_triggered_at')) {
        this.storage.db.exec('ALTER TABLE memory_chunks ADD COLUMN last_triggered_at INTEGER');
        console.log('[Migrate] Added column: memory_chunks.last_triggered_at');
      }
      if (!colNames.includes('stability')) {
        this.storage.db.exec('ALTER TABLE memory_chunks ADD COLUMN stability REAL DEFAULT 168.0');
        console.log('[Migrate] Added column: memory_chunks.stability');
      }
      if (!colNames.includes('strength')) {
        this.storage.db.exec('ALTER TABLE memory_chunks ADD COLUMN strength REAL DEFAULT 1.0');
        console.log('[Migrate] Added column: memory_chunks.strength');
      }
      if (!colNames.includes('emotional_weight')) {
        this.storage.db.exec('ALTER TABLE memory_chunks ADD COLUMN emotional_weight REAL DEFAULT 1.0');
        console.log('[Migrate] Added column: memory_chunks.emotional_weight');
      }

      // 2. 新增索引
      this.storage.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_strength
          ON memory_chunks(strength DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_stability
          ON memory_chunks(stability DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_last_triggered
          ON memory_chunks(last_triggered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding_exists
          ON memory_chunks(updated_at DESC)
          WHERE embedding IS NOT NULL;
      `);
      console.log('[Migrate] Created FSRS and vector search indexes');

      // 3. 修复 memory_facts 的 CHECK 约束（添加 'personal' 类型）
      // SQLite 不支持直接 ALTER CHECK 约束，需要重建表
      const factsExists = this.storage.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_facts'
      `).get();

      if (factsExists) {
        // 检查现有约束是否已包含 personal
        const createSql = this.storage.db.prepare(`
          SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_facts'
        `).get();

        if (createSql && !createSql.sql.includes("'personal'")) {
          // 备份 → 重建 → 恢复（用事务包裹，保证原子性，防止中途崩溃丢数据）
          const existingData = this.storage.db.prepare('SELECT * FROM memory_facts').all();

          const rebuildFacts = this.storage.db.transaction(() => {
            this.storage.db.exec('DROP TABLE IF EXISTS memory_facts');

            // 重建表，新增 last_confirmed_at 和 source_text 字段
            this.storage.db.exec(`
              CREATE TABLE memory_facts (
                id TEXT PRIMARY KEY,
                fact_type TEXT NOT NULL CHECK(fact_type IN ('personal', 'preference', 'event', 'relationship', 'routine')),
                subject TEXT,
                predicate TEXT NOT NULL,
                object TEXT,
                confidence REAL DEFAULT 1.0 CHECK(confidence >= 0 AND confidence <= 1),
                source_conversation_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_confirmed_at INTEGER,
                source_text TEXT,
                FOREIGN KEY (source_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
              )
            `);

            // 重建索引
            this.storage.db.exec(`
              CREATE INDEX IF NOT EXISTS idx_memory_facts_type ON memory_facts(fact_type);
              CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject);
              CREATE INDEX IF NOT EXISTS idx_memory_facts_confidence ON memory_facts(confidence);
            `);

            // 恢复数据
            const insertStmt = this.storage.db.prepare(`
              INSERT INTO memory_facts (id, fact_type, subject, predicate, object, confidence,
                source_conversation_id, created_at, updated_at, last_confirmed_at, source_text)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let count = 0;
            for (const row of existingData) {
              try {
                insertStmt.run(
                  row.id, row.fact_type, row.subject, row.predicate, row.object,
                  row.confidence, row.source_conversation_id, row.created_at,
                  row.updated_at, row.last_confirmed_at || null, row.source_text || null
                );
                count++;
              } catch (e) {
                console.warn('[Migrate] Skip fact:', row.id, e.message);
              }
            }
            return count;
          });

          const restoredCount = rebuildFacts();
          console.log(`[Migrate] Rebuilt memory_facts with 'personal' type, restored ${restoredCount} rows`);
        }
      }

      // 4. 历史数据初始化：为现有 memory_chunks 设置合理的 FSRS 初始值
      await this._initHistoryStrength();

      console.log('[Migrate] ✓ Migration to v7 complete');

    } catch (error) {
      console.error('[Migrate] ✗ Migration to v7 failed:', error);
      throw error;
    }
  }

  // 历史数据 strength 初始化
  async _initHistoryStrength() {
    const now = Date.now();
    const F = 19 / 81;
    const C = -0.5;
    const initialStability = 168;

    // 批量读取所有需要初始化的 chunk
    const chunks = this.storage.db.prepare(`
      SELECT id, updated_at, access_count, importance_score
      FROM memory_chunks
      WHERE (strength IS NULL OR stability IS NULL)
        OR (strength = 1.0 AND stability = 168.0 AND access_count > 1)
    `).all();

    if (chunks.length === 0) {
      console.log('[Migrate] No memory chunks need strength initialization');
      return;
    }

    console.log(`[Migrate] Initializing strength for ${chunks.length} memory chunks...`);

    const updateStmt = this.storage.db.prepare(`
      UPDATE memory_chunks SET
        stability = ?, strength = ?, emotional_weight = ?,
        trigger_count = ?, last_triggered_at = ?
      WHERE id = ?
    `);

    const batch = this.storage.db.transaction((items) => {
      for (const chunk of items) {
        // 根据 access_count 估算稳定性（S）
        // 注意：改为 24h 基础，以实现有效的自然遗忘机制
        const accessCount = chunk.access_count || 1;
        let estimatedS = 24; // 默认 1 天（测试反馈调整）
        if (accessCount >= 5) estimatedS = 24 * 10;      // >= 5 次访问 → 10 天
        else if (accessCount >= 3) estimatedS = 24 * 7;  // >= 3 次访问 → 7 天
        else if (accessCount >= 2) estimatedS = 24 * 3;  // 2 次访问 → 3 天

        // 计算当前 R（从 updated_at 算起）
        const elapsedHours = (now - (chunk.updated_at || now)) / (1000 * 60 * 60);
        const R = Math.max(0.01, Math.pow(1 + F * elapsedHours / estimatedS, C));

        // 情感权重：旧数据统一设为 1.0（无历史情感数据）
        const emotionalWeight = 1.0;

        // trigger_count 用 access_count 初始化（假设每次访问都是一次强化）
        const triggerCount = Math.max(0, accessCount - 1);

        updateStmt.run(
          estimatedS, R, emotionalWeight,
          triggerCount, chunk.updated_at || now,
          chunk.id
        );
      }
    });

    batch(chunks);
    console.log(`[Migrate] ✓ Initialized strength for ${chunks.length} chunks`);
  }

  async migrateToV8() {
    console.log('[Migrate] Migrating to v8: agent runtime tables...');

    try {
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          metadata_json TEXT,
          state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'archived')),
          last_active_at INTEGER NOT NULL,
          archived_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_last_active_at ON agent_sessions(last_active_at DESC);

        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
          source_text TEXT,
          source TEXT,
          attachments_json TEXT,
          final_text TEXT,
          conversation_summary TEXT,
          error_code TEXT,
          queue_position INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_events (
          event_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(run_id, seq),
          FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_session_id ON agent_events(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_events_run_id_seq ON agent_events(run_id, seq);
        CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_approvals (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          summary TEXT,
          args_json TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied', 'timed_out', 'cancelled')),
          expires_at INTEGER,
          resolved_at INTEGER,
          decision TEXT,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_approvals_run_id ON agent_approvals(run_id);
        CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON agent_approvals(status);
        CREATE INDEX IF NOT EXISTS idx_agent_approvals_expires_at ON agent_approvals(expires_at);
      `);

      console.log('[Migrate] Migration to v8 complete');
    } catch (error) {
      console.error('[Migrate] Migration to v8 failed:', error);
      throw error;
    }
  }

  async migrateToV9() {
    console.log('[Migrate] Migrating to v9: agent conversation summaries...');

    try {
      const runCols = this.storage.db.pragma('table_info(agent_runs)');
      const runColNames = runCols.map((col) => col.name);

      if (!runColNames.includes('conversation_summary')) {
        this.storage.db.exec('ALTER TABLE agent_runs ADD COLUMN conversation_summary TEXT');
        console.log('[Migrate] Added column: agent_runs.conversation_summary');
      }

      console.log('[Migrate] ✓ Migration to v9 complete');
    } catch (error) {
      console.error('[Migrate] ✗ Migration to v9 failed:', error);
      throw error;
    }
  }

  async migrateToV10() {
    console.log('[Migrate] Migrating to v10: Add daily_ritual_log table...');

    try {
      this.storage.db.exec(`
        CREATE TABLE IF NOT EXISTS daily_ritual_log (
          id TEXT PRIMARY KEY,
          ritual_type TEXT NOT NULL CHECK(ritual_type IN ('morning', 'evening', 'weekly')),
          triggered_at INTEGER NOT NULL,
          date_key TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ritual_log_date_key ON daily_ritual_log(date_key);
        CREATE INDEX IF NOT EXISTS idx_ritual_log_type ON daily_ritual_log(ritual_type);
      `);

      console.log('[Migrate] v10: daily_ritual_log table created');
    } catch (error) {
      console.error('[Migrate] v10 failed:', error);
      throw error;
    }
  }
}

// 定义最新版本号
const LATEST_VERSION = 10;

module.exports = { DatabaseMigrator, LATEST_VERSION };
