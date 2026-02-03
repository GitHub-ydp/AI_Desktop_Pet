// 查看记忆数据库内容
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const dbPath = join(homedir(), '.ai-desktop-pet', 'pet-memory.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== 记忆数据库内容 ===\n');

// 1. 查看所有对话
console.log('📝 对话记录:');
console.log('----------------------------------------');
const convs = db.prepare('SELECT * FROM conversations ORDER BY timestamp DESC').all();
console.log(`总共 ${convs.length} 条对话\n`);

convs.forEach((c, i) => {
  const date = new Date(c.timestamp).toLocaleString('zh-CN');
  const role = c.role === 'user' ? '你' : '宠物';
  console.log(`${i + 1}. [${date}] ${role}:`);
  console.log(`   ${c.content.substring(0, 80)}${c.content.length > 80 ? '...' : ''}`);
  console.log(`   性格: ${c.personality || 'N/A'} | 心情: ${c.mood}\n`);
});

// 2. 查看记忆块
console.log('\n🧠 记忆块:');
console.log('----------------------------------------');
const chunks = db.prepare('SELECT * FROM memory_chunks').all();
console.log(`总共 ${chunks.length} 个记忆块\n`);

chunks.forEach((c, i) => {
  console.log(`${i + 1}. 块 ${c.chunk_index}:`);
  console.log(`   ${c.text.substring(0, 80)}`);
  console.log(`   有嵌入: ${c.embedding ? '是' : '否'}\n`);
});

// 3. 查看关键事实
console.log('\n📌 关键事实:');
console.log('----------------------------------------');
const facts = db.prepare('SELECT * FROM memory_facts ORDER BY created_at DESC').all();
console.log(`总共 ${facts.length} 个事实\n`);

if (facts.length > 0) {
  const factTypeLabels = {
    preference: '偏好',
    event: '事件',
    relationship: '关系',
    routine: '习惯'
  };

  facts.forEach((f, i) => {
    const label = factTypeLabels[f.fact_type] || f.fact_type;
    console.log(`${i + 1}. [${label}] (置信度: ${f.confidence})`);
    console.log(`   ${f.subject || '用户'} ${f.predicate} ${f.object || ''}`);
    console.log(`   来源对话: ${f.source_conversation_id}\n`);
  });
} else {
  console.log('暂无提取的事实（需要对话内容匹配特定模式）\n');
}

// 4. 数据库统计
console.log('\n📊 统计信息:');
console.log('----------------------------------------');
const stats = {
  conversations: db.prepare('SELECT COUNT(*) as count FROM conversations').get().count,
  chunks: db.prepare('SELECT COUNT(*) as count FROM memory_chunks').get().count,
  facts: db.prepare('SELECT COUNT(*) as count FROM memory_facts').get().count,
  embeddings: db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get().count
};

console.log(`对话总数: ${stats.conversations}`);
console.log(`记忆块总数: ${stats.chunks}`);
console.log(`事实总数: ${stats.facts}`);
console.log(`嵌入缓存: ${stats.embeddings}`);

db.close();
