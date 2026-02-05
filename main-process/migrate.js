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
}

// 定义最新版本号
const LATEST_VERSION = 2;

module.exports = { DatabaseMigrator, LATEST_VERSION };
