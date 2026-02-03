#!/usr/bin/env node
/**
 * 记忆系统数据迁移脚本
 * 将 LocalStorage 中的历史对话迁移到 SQLite 数据库
 */

// 禁用 Node.js 的实验性警告
process.noDeprecation = true;

// 模拟 Electron 环境的 app.getPath
const path = require('path');
const os = require('os');

global.app = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(os.homedir(), '.ai-desktop-pet');
    }
    return os.tmpdir();
  }
};

// 动态导入 ES 模块
async function runMigration() {
  console.log('=== 记忆系统数据迁移工具 ===\n');

  try {
    // 导入所需模块
    const { MemoryManager } = await import('../src/memory/index.js');

    // 模拟 LocalStorage 数据
    // 在实际使用中，这里会读取浏览器的 LocalStorage
    const localStorageData = {
      chatHistory: [],
      petData: {
        emoji: '🐱',
        personality: 'healing',
        mood: 80
      }
    };

    // 检查是否有 LocalStorage 数据文件
    const fs = await import('fs');
    const localStoragePath = path.join(os.homedir(), '.ai-desktop-pet', 'localStorage_backup.json');

    if (fs.existsSync(localStoragePath)) {
      console.log('从备份文件读取 LocalStorage 数据...');
      const data = fs.readFileSync(localStoragePath, 'utf-8');
      localStorageData = JSON.parse(data);
    } else {
      console.log('未找到 LocalStorage 备份文件');
      console.log('提示: 请先运行应用，然后从浏览器开发者工具导出 LocalStorage 数据');
      console.log('路径:', localStoragePath);
    }

    // 创建记忆管理器
    console.log('\n初始化记忆管理器...');
    const manager = new MemoryManager({
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-13728a2d69ca41698bb5ad752194a14f'
    });

    await manager.initialize();

    // 检查现有数据
    const stats = manager.getStats();
    console.log('当前数据库统计:');
    console.log(`- 对话数: ${stats.totalConversations}`);
    console.log(`- 记忆块数: ${stats.totalChunks}`);
    console.log(`- 事实数: ${stats.totalFacts}`);

    if (stats.totalConversations > 0) {
      console.log('\n数据库中已有数据，是否继续迁移？');
      console.log('提示: 建议先清空数据库或使用新的数据库文件');
    }

    // 执行迁移
    if (localStorageData.chatHistory.length > 0) {
      console.log(`\n开始迁移 ${localStorageData.chatHistory.length} 条对话...`);

      const result = await manager.migrateFromLocalStorage(localStorageData);

      console.log('迁移完成!');
      console.log(`- 成功: ${result.imported}`);
      console.log(`- 失败: ${result.failed}`);

      // 显示新统计
      const newStats = manager.getStats();
      console.log('\n迁移后数据库统计:');
      console.log(`- 对话数: ${newStats.totalConversations}`);
      console.log(`- 记忆块数: ${newStats.totalChunks}`);
      console.log(`- 事实数: ${newStats.totalFacts}`);

    } else {
      console.log('\n没有需要迁移的数据');
    }

    // 关闭
    manager.close();
    console.log('\n迁移脚本执行完成');

  } catch (error) {
    console.error('迁移失败:', error);
    process.exit(1);
  }
}

// 运行
runMigration();
