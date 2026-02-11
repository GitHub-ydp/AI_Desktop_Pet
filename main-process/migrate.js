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
        try {
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
        } catch (error) {
          console.error(`[Migrate] Failed to restore reminder ${row.id}:`, error.message);
        }
      }

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
}

// 定义最新版本号
const LATEST_VERSION = 4;

module.exports = { DatabaseMigrator, LATEST_VERSION };
